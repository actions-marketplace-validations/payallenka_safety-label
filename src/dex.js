import { FormatError } from "./errors.js";

const HEADER_SIZE = 0x70;
const CLASS_DEF_SIZE = 32;

/** Real class descriptors are well under 300 bytes; anything longer is not a genuine SDK class. */
export const MAX_DESCRIPTOR_BYTES = 1024;

/**
 * Streams the dotted names of classes *defined* in one DEX file (class_defs) to [visit] and
 * returns how many were delivered. Only the header, type_ids, string_ids and the referenced string
 * data are read. The file is untrusted: every offset is bounds-checked, each type is decoded at
 * most once, and total decoding work is capped at the file's own size, which also covers many
 * entries aliasing one long string.
 */
export function forEachClassName(dex, visit) {
  if (dex.length < HEADER_SIZE) throw new FormatError("file shorter than DEX header");
  if (dex[0] !== 0x64 || dex[1] !== 0x65 || dex[2] !== 0x78 || dex[3] !== 0x0a) throw new FormatError("missing dex magic");
  const stringIdsSize = dex.readUInt32LE(0x38);
  const stringIdsOff = dex.readUInt32LE(0x3c);
  const typeIdsSize = dex.readUInt32LE(0x40);
  const typeIdsOff = dex.readUInt32LE(0x44);
  const classDefsSize = dex.readUInt32LE(0x60);
  const classDefsOff = dex.readUInt32LE(0x64);
  checkTable(dex, stringIdsOff, stringIdsSize, 4, "string_ids");
  checkTable(dex, typeIdsOff, typeIdsSize, 4, "type_ids");
  checkTable(dex, classDefsOff, classDefsSize, CLASS_DEF_SIZE, "class_defs");

  // A valid DEX defines each type at most once; seen-tracking stops repeated entries costing anything.
  const seen = new Uint8Array(typeIdsSize);
  let budget = dex.length;
  let delivered = 0;
  for (let i = 0; i < classDefsSize; i++) {
    const typeIdx = dex.readUInt32LE(classDefsOff + i * CLASS_DEF_SIZE);
    if (typeIdx >= typeIdsSize) throw new FormatError(`class_def ${i} has bad type index`);
    if (seen[typeIdx]) continue;
    seen[typeIdx] = 1;
    const stringIdx = dex.readUInt32LE(typeIdsOff + typeIdx * 4);
    if (stringIdx >= stringIdsSize) throw new FormatError(`type ${typeIdx} has bad string index`);
    const name = readClassName(dex, dex.readUInt32LE(stringIdsOff + stringIdx * 4));
    // Charge every byte examined, including failed decodes, so aliased strings can't multiply the work.
    budget -= typeof name === "string" ? Math.max(name.length, 1) : -name;
    if (budget < 0) throw new FormatError("string data decoded beyond file size");
    if (typeof name === "string") {
      visit(name);
      delivered++;
    }
  }
  return delivered;
}

function checkTable(dex, off, count, entrySize, name) {
  if (count !== 0 && off + count * entrySize > dex.length) throw new FormatError(`${name} table out of bounds`);
}

/**
 * Decodes a `Lcom/foo/Bar;` descriptor (string_data_item: uleb128 length, then MUTF-8) to
 * `com.foo.Bar`. For anything that is not a plain ASCII class descriptor within
 * MAX_DESCRIPTOR_BYTES (such entries can't match a signature) it returns minus the number of bytes
 * examined, so the caller can charge the work.
 */
function readClassName(dex, off) {
  if (off >= dex.length) throw new FormatError("string data out of bounds");
  let p = off;
  let lebBytes = 0;
  while (p < dex.length && dex[p] & 0x80) {
    p++;
    if (++lebBytes > 4) throw new FormatError("bad uleb128 length");
  }
  p++;
  if (p >= dex.length || dex[p] !== 0x4c /* L */) return -(p - off + 1);
  const start = p + 1;
  const limit = Math.min(dex.length, start + MAX_DESCRIPTOR_BYTES);
  for (let q = start; q < limit; q++) {
    const b = dex[q];
    if (b === 0x3b /* ; */) {
      if (q === start || q + 1 >= dex.length || dex[q + 1] !== 0) return -(q - off + 1);
      return dex.toString("latin1", start, q).replaceAll("/", ".");
    }
    if (b <= 0x20 || b >= 0x7f) return -(q - off + 1); // NUL, control or non-ASCII: not a descriptor we can match
  }
  return -(limit - off + 1); // unterminated or longer than the cap
}
