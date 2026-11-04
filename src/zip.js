import { inflateRawSync } from "node:zlib";
import { FormatError, LimitError } from "./errors.js";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Lists the entries of a ZIP archive (APK, AAB, APKS, XAPK) held in memory. Every offset comes
 * from an untrusted file, so each one is bounds-checked before it is read.
 */
export function readZip(buf) {
  if (buf.length < 22) throw new FormatError("not a ZIP archive (too short)");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FormatError("not a ZIP archive (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw new FormatError("ZIP64 archives are not supported");
  }
  const cdEnd = cdOff + cdSize;
  if (cdEnd > eocd) throw new FormatError("central directory out of bounds");

  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== CENTRAL) throw new FormatError(`bad central directory entry ${i}`);
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const next = p + 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (next > cdEnd) throw new FormatError(`central directory entry ${i} out of bounds`);
    entries.push({
      name: buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
      encrypted: (flags & 1) !== 0,
    });
    p = next;
  }
  return entries;
}

/**
 * Returns an entry's contents. The declared size can lie, so inflation itself is capped at
 * [maxBytes]: a small entry that expands enormously stops at the cap with a LimitError.
 */
export function extract(buf, entry, maxBytes) {
  if (entry.encrypted) throw new FormatError("entry is encrypted");
  if (entry.size > maxBytes) throw new LimitError(`entry is ${entry.size} bytes; the limit is ${maxBytes}`);
  const h = entry.localOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== LOCAL) throw new FormatError("bad local header");
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new FormatError("entry data out of bounds");
  const data = buf.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new FormatError(`unsupported compression method ${entry.method}`);
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (e) {
    if (e.code === "ERR_BUFFER_TOO_LARGE") throw new LimitError(`entry inflates beyond ${maxBytes} bytes`);
    throw new FormatError(`cannot inflate: ${e.message}`);
  }
}
