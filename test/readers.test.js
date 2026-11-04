import assert from "node:assert/strict";
import { test } from "node:test";
import { readManifest } from "../src/axml.js";
import { TrackerMatcher } from "../src/catalog.js";
import { forEachClassName } from "../src/dex.js";
import { FormatError } from "../src/errors.js";
import { clean } from "../src/text.js";
import { readZip } from "../src/zip.js";
import { fakeDex } from "./helpers.js";

const names = (dex) => {
  const out = [];
  forEachClassName(dex, (n) => out.push(n));
  return out;
};

test("DEX: defined classes as dotted names", () => {
  assert.deepEqual(names(fakeDex(["Lcom/foo/Bar;", "Lcom/foo/Bar$Inner;"])), ["com.foo.Bar", "com.foo.Bar$Inner"]);
});

test("DEX: rejects bad magic and tables outside the file", () => {
  assert.throws(() => names(Buffer.alloc(0x70)), FormatError);
  const dex = fakeDex(["La;"]);
  dex.writeUInt32LE(0xfffffff0, 0x64);
  assert.throws(() => names(dex), /class_defs table out of bounds/);
});

test("DEX: non-descriptors, non-ASCII and over-long names are skipped, not delivered", () => {
  const long = `L${"a/".repeat(600)}B;`;
  const dex = fakeDex(["I", Buffer.from([0x4c, 0xc3, 0xa9, 0x3b]), long, "Lok/Fine;"]);
  assert.deepEqual(names(dex), ["ok.Fine"]);
});

test("DEX: duplicate class_defs cost nothing extra", () => {
  const dex = fakeDex(["Lcom/a/B;"], { classDefTypes: Array(1000).fill(0) });
  assert.deepEqual(names(dex), ["com.a.B"]);
});

test("DEX: many types aliasing one long string hit the decode budget", () => {
  const long = `L${"x".repeat(1000)};`;
  const dex = fakeDex([long], { typeStrings: Array(5000).fill(0), classDefTypes: [...Array(5000).keys()] });
  assert.throws(() => names(dex), /decoded beyond file size/);
});

test("matcher: signatures match at package and inner-class boundaries only", () => {
  const m = new TrackerMatcher([{ id: "fb", name: "FB", codeSignatures: ["com.facebook.ads."] }, { id: "c", name: "C", codeSignatures: ["com.x.Tracker"] }]);
  const hit = (cls) => {
    const found = new Map();
    m.matchInto(found, cls);
    return [...found.keys()];
  };
  assert.deepEqual(hit("com.facebook.ads.AdView"), ["fb"]);
  assert.deepEqual(hit("com.facebook.adsx.Thing"), []);
  assert.deepEqual(hit("com.x.Tracker$1"), ["c"]);
  assert.deepEqual(hit("com.x.TrackerFactory"), []);
});

test("ZIP and manifest readers reject what they are not", () => {
  assert.throws(() => readZip(Buffer.from("not a zip at all, just some text bytes")), /not a ZIP archive/);
  assert.throws(() => readManifest(Buffer.from("<manifest/>")), /not a binary XML manifest/);
  const truncated = Buffer.from([3, 0, 8, 0, 0xff, 0, 0, 0, 1, 0, 28, 0, 0xff, 0, 0, 0]);
  assert.throws(() => readManifest(truncated), FormatError);
});

test("untrusted text is printable and bounded", () => {
  assert.equal(clean("a‮b\nc"), "a�b�c");
  assert.equal(clean("x".repeat(1000)).length, 301);
});
