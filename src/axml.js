import { FormatError } from "./errors.js";

const RES_XML = 0x0003;
const STRING_POOL = 0x0001;
const RESOURCE_MAP = 0x0180;
const START_ELEMENT = 0x0102;
const NO_INDEX = 0xffffffff;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

// Framework attribute ids; shrunk manifests may drop attribute names and keep only these.
const ATTR_NAME = 0x01010003;
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;

const PERMISSION_ELEMENTS = new Set(["uses-permission", "uses-permission-sdk-23"]);

/**
 * Reads an APK's compiled AndroidManifest.xml (Android binary XML) for the package, version and
 * requested permissions. The file is untrusted: chunks and strings are bounds-checked and decoding
 * work is capped relative to the file size.
 */
export function readManifest(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML) throw new FormatError("not a binary XML manifest");
  const headerSize = buf.readUInt16LE(2);
  const end = Math.min(buf.length, buf.readUInt32LE(4));
  if (headerSize < 8 || headerSize > end) throw new FormatError("bad binary XML header");

  const out = { package: null, versionName: null, versionCode: null, permissions: [] };
  let str = () => {
    throw new FormatError("element before string pool");
  };
  let resourceIds = [];
  for (let p = headerSize; p + 8 <= end; ) {
    const type = buf.readUInt16LE(p);
    const chunkHeader = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || chunkHeader > size || p + size > end) throw new FormatError("chunk out of bounds");
    if (type === STRING_POOL) str = stringPool(buf, p, chunkHeader, size);
    else if (type === RESOURCE_MAP) {
      resourceIds = [];
      for (let q = p + chunkHeader; q + 4 <= p + size; q += 4) resourceIds.push(buf.readUInt32LE(q));
    } else if (type === START_ELEMENT) readElement(buf, p, chunkHeader, size, str, resourceIds, out);
    p += size;
  }
  return out;
}

function readElement(buf, p, chunkHeader, size, str, resourceIds, out) {
  const ext = p + chunkHeader;
  if (ext + 20 > p + size) throw new FormatError("element header out of bounds");
  const element = str(buf.readUInt32LE(ext + 4));
  const isManifest = element === "manifest";
  if (!isManifest && !PERMISSION_ELEMENTS.has(element)) return;
  const attrStart = ext + buf.readUInt16LE(ext + 8);
  const attrSize = buf.readUInt16LE(ext + 10);
  const attrCount = buf.readUInt16LE(ext + 12);
  if (attrSize < 20 || attrStart + attrCount * attrSize > p + size) throw new FormatError("attributes out of bounds");

  for (let i = 0; i < attrCount; i++) {
    const a = attrStart + i * attrSize;
    const nameIdx = buf.readUInt32LE(a + 4);
    const is = (id, name) => resourceIds[nameIdx] === id || str(nameIdx) === name;
    const raw = buf.readUInt32LE(a + 8);
    const dataType = buf[a + 15];
    const data = buf.readUInt32LE(a + 16);
    const text = () => (raw !== NO_INDEX ? str(raw) : dataType === TYPE_STRING ? str(data) : null);
    if (isManifest) {
      if (str(nameIdx) === "package") out.package = text();
      else if (is(ATTR_VERSION_NAME, "versionName")) out.versionName = text();
      else if (is(ATTR_VERSION_CODE, "versionCode") && (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX)) out.versionCode = data;
    } else if (is(ATTR_NAME, "name")) {
      const permission = text();
      if (permission && !out.permissions.includes(permission)) out.permissions.push(permission);
    }
  }
}

/** Returns a lazy, cached lookup for one string pool, with total decoding capped at 4x the file size. */
function stringPool(buf, p, chunkHeader, size) {
  if (chunkHeader < 28) throw new FormatError("bad string pool header");
  const limit = p + size;
  const count = buf.readUInt32LE(p + 8);
  const utf8 = (buf.readUInt32LE(p + 16) & 0x100) !== 0;
  const offsets = p + chunkHeader;
  const base = p + buf.readUInt32LE(p + 20);
  if (offsets + count * 4 > limit || base > limit) throw new FormatError("string pool out of bounds");
  const cache = new Map();
  let budget = buf.length * 4;
  const need = (q) => {
    if (q > limit) throw new FormatError("string out of bounds");
  };

  return (i) => {
    if (i === NO_INDEX) return null;
    if (i >= count) throw new FormatError("string index out of range");
    let s = cache.get(i);
    if (s !== undefined) return s;
    let q = base + buf.readUInt32LE(offsets + i * 4);
    let n;
    if (utf8) {
      need(q + 1);
      q += buf[q] & 0x80 ? 2 : 1; // UTF-16 length, unused
      need(q + 1);
      n = buf[q];
      if (n & 0x80) {
        need(q + 2);
        n = ((n & 0x7f) << 8) | buf[q + 1];
        q += 2;
      } else q += 1;
      need(q + n);
      s = buf.toString("utf8", q, q + n);
    } else {
      need(q + 2);
      n = buf.readUInt16LE(q);
      q += 2;
      if (n & 0x8000) {
        need(q + 2);
        n = ((n & 0x7fff) << 16) | buf.readUInt16LE(q);
        q += 2;
      }
      need(q + n * 2);
      s = buf.toString("utf16le", q, q + n * 2);
    }
    budget -= Math.max(n, 1);
    if (budget < 0) throw new FormatError("string data decoded beyond file size");
    cache.set(i, s);
    return s;
  };
}
