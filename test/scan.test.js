import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog, TrackerMatcher } from "../src/catalog.js";
import { compare, renderMarkdown, renderText } from "../src/report.js";
import { scanArchive, scanFile } from "../src/scan.js";
import { fakeDex, fixture, makeZip, testDisclosures } from "./helpers.js";

const catalog = loadCatalog();
const scan = (name) => scanFile(fixture(name), { catalog, disclosures: testDisclosures });

test("an APK built by the Android toolchain: trackers with evidence, manifest facts, permissions", () => {
  const r = scan("tracked-v1.apk");
  assert.equal(r.input.kind, "apk");
  assert.deepEqual(r.app, { package: "com.example.fixture", versionName: "1.0", versionCode: 1 });
  assert.deepEqual(
    r.trackers.map((t) => [t.name, t.evidence.exampleClass]),
    [
      ["Google AdMob", "com.google.android.gms.ads.AdView"],
      ["Google Firebase Analytics", "com.google.firebase.analytics.FirebaseAnalytics"],
    ],
  );
  assert.deepEqual(r.permissions, ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.INTERNET"]);
  assert.equal(r.coverage.complete, true);
  assert.equal(r.coverage.classes, 3);
  assert.match(r.input.sha256, /^[0-9a-f]{64}$/);
});

test("the draft merges disclosures per data type and keeps who declared what", () => {
  const rows = scan("tracked-v1.apk").dataSafety;
  assert.deepEqual(
    rows.map((r) => [r.category, r.type, r.shared, r.purposes]),
    [
      ["Location", "Approximate location", null, ["Advertising or marketing"]],
      ["App activity", "App interactions", false, ["Analytics"]],
      ["Device or other IDs", "Device or other IDs", true, ["Analytics", "Advertising or marketing"]],
    ],
  );
  assert.deepEqual(rows[2].sources.map((s) => s.sdk), ["AdMob", "Firebase Analytics"]);
  assert.equal(rows[0].sources[0].note, "IP address");
});

test("comparing an update with its baseline reports what it adds", () => {
  const diff = compare(scan("tracked-v1.apk"), scan("tracked-v2.apk"));
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.newTrackers, ["Facebook Analytics"]);
  assert.deepEqual(diff.newPermissions, ["android.permission.ACCESS_FINE_LOCATION", "com.google.android.gms.permission.AD_ID"]);
  assert.deepEqual(compare(scan("tracked-v2.apk"), scan("tracked-v1.apk")).removedTrackers, ["Facebook Analytics"]);
  assert.equal(compare(scan("tracked-v1.apk"), scan("tracked-v1.apk")).changed, false);
});

test("split APKs: code from every split, package from the base", () => {
  const r = scan("split.apks");
  assert.equal(r.input.kind, "apks");
  assert.deepEqual(r.trackers.map((t) => t.name), ["Google AdMob", "Google Firebase Analytics", "Sentry"]);
  assert.equal(r.app.package, "com.example.fixture");
});

test("an App Bundle: code is scanned and unread permissions are reported as unknown, not empty", () => {
  const r = scan("bundle.aab");
  assert.equal(r.input.kind, "aab");
  assert.deepEqual(r.trackers.map((t) => t.name), ["AppsFlyer"]);
  assert.equal(r.permissions, null);
  assert.equal(r.coverage.complete, false);
  assert.match(renderText(r), /Incomplete: Android App Bundle manifests are not read yet/);
});

test("a clean app reports no trackers and no draft rows", () => {
  const r = scan("clean.apk");
  assert.deepEqual([r.trackers, r.dataSafety, r.permissionHints], [[], [], []]);
  assert.equal(r.coverage.complete, true);
});

test("permission hints name the data type and never claim collection", () => {
  const hints = scan("tracked-v2.apk").permissionHints;
  assert.deepEqual(
    hints.map((h) => [h.permission, h.type]),
    [
      ["android.permission.ACCESS_COARSE_LOCATION", "Approximate location"],
      ["android.permission.ACCESS_FINE_LOCATION", "Precise location"],
      ["com.google.android.gms.permission.AD_ID", "Device or other IDs"],
    ],
  );
  assert.match(renderText(scan("tracked-v2.apk")), /Declare it if that data leaves the device/);
});

test("a corrupt DEX is skipped with its reason while the rest of the app is still reported", () => {
  const matcher = new TrackerMatcher(catalog.trackers);
  const good = fakeDex(["Lio/sentry/Sentry;"]);
  const r = scanArchive(
    makeZip([
      ["AndroidManifest.xml", Buffer.from([3, 0, 8, 0, 8, 0, 0, 0])],
      ["classes.dex", good],
      ["classes2.dex", Buffer.from("dex\n035\0 truncated")],
    ]),
    matcher,
  );
  assert.deepEqual([...r.found.keys()], ["exodus:447"]);
  assert.equal(r.dexFiles, 1);
  assert.deepEqual(r.skipped.map((s) => [s.entry, s.kind]), [["classes2.dex", "malformed"]]);
});

test("a decompression bomb stops at the limit instead of exhausting memory", () => {
  const bomb = Buffer.alloc(200 * 1024 ** 2); // compresses to ~200 KB, declares a tiny size
  const zip = makeZip([
    ["AndroidManifest.xml", Buffer.from([3, 0, 8, 0, 8, 0, 0, 0])],
    ["classes.dex", bomb, { deflate: true, declaredSize: 10 }],
  ]);
  const r = scanArchive(zip, new TrackerMatcher(catalog.trackers));
  assert.equal(r.skipped[0].kind, "limit");
  assert.equal(r.dexFiles, 0);
});

test("renderers escape app-controlled text", () => {
  const r = scan("tracked-v1.apk");
  r.app.package = "evil|pkg<script>";
  const md = renderMarkdown(r);
  assert.ok(md.includes("evil\\|pkg\\<script\\>"));
});
