import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

export const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const testDisclosures = {
  verified: "test",
  sdks: [
    {
      key: "fa",
      name: "Firebase Analytics",
      trackerIds: ["exodus:49"],
      source: "https://example.test/firebase",
      collected: [
        { category: "App activity", type: "App interactions", purposes: ["Analytics"], shared: false, optional: false },
        { category: "Device or other IDs", type: "Device or other IDs", purposes: ["Analytics"], shared: false, optional: false },
      ],
    },
    {
      key: "ads",
      name: "AdMob",
      trackerIds: ["exodus:312"],
      source: "https://example.test/admob",
      collected: [
        { category: "Device or other IDs", type: "Device or other IDs", purposes: ["Advertising or marketing"], shared: true, optional: false },
        { category: "Location", type: "Approximate location", purposes: ["Advertising or marketing"], shared: null, optional: false, note: "IP address" },
      ],
    },
  ],
};

function uleb128(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/**
 * Builds a minimal DEX holding only the tables the reader uses. [classDefTypes] gives each
 * class_def's type index and [typeStrings] each type's string index, so hostile layouts can be made.
 */
export function fakeDex(descriptors, { classDefTypes = descriptors.map((_, i) => i), typeStrings = descriptors.map((_, i) => i) } = {}) {
  const bytes = descriptors.map((d) => (typeof d === "string" ? Buffer.from(d, "latin1") : d));
  const stringIdsOff = 0x70;
  const typeIdsOff = stringIdsOff + bytes.length * 4;
  const classDefsOff = typeIdsOff + typeStrings.length * 4;
  const dataOff = classDefsOff + classDefTypes.length * 32;
  const data = bytes.map((b) => Buffer.concat([Buffer.from(uleb128(b.length)), b, Buffer.from([0])]));
  const buf = Buffer.alloc(dataOff + data.reduce((n, d) => n + d.length, 0));
  buf.write("dex\n035\0", 0, "latin1");
  buf.writeUInt32LE(bytes.length, 0x38);
  buf.writeUInt32LE(stringIdsOff, 0x3c);
  buf.writeUInt32LE(typeStrings.length, 0x40);
  buf.writeUInt32LE(typeIdsOff, 0x44);
  buf.writeUInt32LE(classDefTypes.length, 0x60);
  buf.writeUInt32LE(classDefsOff, 0x64);
  let p = dataOff;
  data.forEach((d, i) => {
    buf.writeUInt32LE(p, stringIdsOff + i * 4);
    d.copy(buf, p);
    p += d.length;
  });
  typeStrings.forEach((s, i) => buf.writeUInt32LE(s, typeIdsOff + i * 4));
  classDefTypes.forEach((t, i) => buf.writeUInt32LE(t, classDefsOff + i * 32));
  return buf;
}

/** Builds a ZIP from [name, contents, {deflate}] entries, enough for the reader's needs. */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, contents, { deflate = false, declaredSize } = {}] of entries) {
    const data = deflate ? deflateRawSync(contents) : contents;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declaredSize ?? contents.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
