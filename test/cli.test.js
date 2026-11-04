import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/safety-label.js", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
const dir = mkdtempSync(join(tmpdir(), "safety-label-"));

test("CLI: JSON report to a file, then a baseline run that fails on additions", () => {
  const base = join(dir, "v1.json");
  const first = run(fixture("tracked-v1.apk"), "-f", "json", "-o", base);
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(readFileSync(base, "utf8"));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.app.package, "com.example.fixture");

  const same = run(fixture("tracked-v1.apk"), "--baseline", base);
  assert.equal(same.status, 0);
  assert.match(same.stdout, /Compared with the baseline: nothing new/);

  const update = run(fixture("tracked-v2.apk"), "--baseline", base, "-f", "markdown");
  assert.equal(update.status, 1);
  assert.match(update.stdout, /New tracker: \*\*Facebook Analytics\*\*/);
});

test("CLI: usage and input errors exit 2 with a message, never a stack trace", () => {
  for (const args of [[], ["a", "b"], [fixture("clean.apk"), "-f", "xml"], ["--nope"], [join(dir, "missing.apk")]]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args}: ${r.stderr}`);
    assert.match(r.stderr, /^safety-label: /);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  const notApk = join(dir, "notes.txt");
  writeFileSync(notApk, "hello");
  assert.match(run(notApk).stderr, /not a ZIP archive/);
  const badBaseline = join(dir, "bad.json");
  writeFileSync(badBaseline, '{"hello":1}');
  assert.match(run(fixture("clean.apk"), "-b", badBaseline).stderr, /baseline is not a safety-label report/);
});

test("CLI: --version and --help", () => {
  assert.match(run("--version").stdout, /^\d+\.\d+\.\d+\n$/);
  assert.match(run("--help").stdout, /Usage: safety-label/);
});
