import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { readManifest } from "./axml.js";
import { loadCatalog, loadDisclosures, matchableSdks, TrackerMatcher } from "./catalog.js";
import { forEachClassName } from "./dex.js";
import { FormatError, LimitError } from "./errors.js";
import { permissionHints } from "./permissions.js";
import { clean } from "./text.js";
import { extract, readZip } from "./zip.js";

export const SCHEMA_VERSION = 1;
export const TOOL_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/**
 * Limits follow real apps: the largest single DEX files are tens of MB. Files are read whole, and
 * Node reads at most 2 GiB at once.
 */
export const LIMITS = {
  file: 2 * 1024 ** 3 - 1,
  dex: 128 * 1024 ** 2,
  manifest: 16 * 1024 ** 2,
  nestedApk: 1024 ** 3,
  inflated: 4 * 1024 ** 3,
};

const DEX = /(^|\/)classes\d*\.dex$/;
const APK_MANIFEST = "AndroidManifest.xml";
const AAB_MANIFEST = /^[^/]+\/manifest\/AndroidManifest\.xml$/;

/** Google Play's Data safety categories, in the order the form shows them. */
export const CATEGORY_ORDER = [
  "Location", "Personal info", "Financial info", "Health and fitness", "Messages", "Photos and videos",
  "Audio files", "Files and docs", "Calendar", "Contacts", "App activity", "Web browsing",
  "App info and performance", "Device or other IDs",
];

/** Google Play's Data safety purposes, in the order the form shows them. */
export const PURPOSE_ORDER = [
  "App functionality", "Analytics", "Developer communications", "Advertising or marketing",
  "Fraud prevention, security, and compliance", "Personalization", "Account management",
];

export function scanFile(path, { catalog = loadCatalog(), disclosures = loadDisclosures() } = {}) {
  const size = statSync(path).size;
  if (size > LIMITS.file) throw new LimitError(`${basename(path)} is ${size} bytes; the limit is ${LIMITS.file}`);
  const buf = readFileSync(path);
  const result = scanArchive(buf, new TrackerMatcher(matchableSdks(catalog, disclosures)));
  return buildReport({
    input: { file: basename(path), sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length },
    result,
    catalog,
    disclosures,
  });
}

/** Scans an APK, AAB, or a bundle of APKs (APKS/XAPK). Entry-level failures are recorded, not fatal. */
export function scanArchive(buf, matcher) {
  const entries = readZip(buf);
  const names = new Set(entries.map((e) => e.name));
  const state = { found: new Map(), dexFiles: 0, classes: 0, skipped: [], manifests: [], inflated: 0 };

  if (names.has(APK_MANIFEST)) {
    scanApk(buf, entries, "", matcher, state);
    return { kind: "apk", ...state };
  }
  const aabManifests = entries.filter((e) => AAB_MANIFEST.test(e.name));
  if (aabManifests.length > 0) {
    scanDex(buf, entries, "", matcher, state);
    // A bundle's manifests are protocol buffers, not binary XML; permissions are not read from them.
    state.manifestNote = "Android App Bundle manifests are not read yet; scan an APK built from the bundle for permissions.";
    return { kind: "aab", ...state };
  }
  const nested = entries.filter((e) => e.name.endsWith(".apk") && !e.name.includes("/"));
  if (nested.length === 0) throw new FormatError("no Android app found (no AndroidManifest.xml, bundle manifest or APKs)");
  for (const entry of nested) {
    try {
      const inner = take(buf, entry, LIMITS.nestedApk, state);
      scanApk(inner, readZip(inner), `${entry.name}!`, matcher, state);
    } catch (e) {
      skip(state, entry.name, e);
    }
  }
  return { kind: "apks", ...state };
}

function scanApk(buf, entries, prefix, matcher, state) {
  const manifest = entries.find((e) => e.name === APK_MANIFEST);
  if (manifest) {
    try {
      state.manifests.push(readManifest(take(buf, manifest, LIMITS.manifest, state)));
    } catch (e) {
      skip(state, prefix + manifest.name, e);
    }
  }
  scanDex(buf, entries, prefix, matcher, state);
}

function scanDex(buf, entries, prefix, matcher, state) {
  for (const entry of entries) {
    if (!DEX.test(entry.name)) continue;
    try {
      const dex = take(buf, entry, LIMITS.dex, state);
      state.classes += forEachClassName(dex, (name) => matcher.matchInto(state.found, name));
      state.dexFiles++;
    } catch (e) {
      skip(state, prefix + entry.name, e);
    }
  }
}

/** Extracts an entry, charging its size to the whole scan's inflation budget. */
function take(buf, entry, max, state) {
  const remaining = LIMITS.inflated - state.inflated;
  if (remaining <= 0) throw new LimitError("the scan's total decompression budget is used up");
  const data = extract(buf, entry, Math.min(max, remaining));
  state.inflated += data.length;
  return data;
}

function skip(state, entry, e) {
  if (!(e instanceof FormatError || e instanceof LimitError)) throw e;
  state.skipped.push({ entry: clean(entry), reason: clean(e.message), kind: e instanceof LimitError ? "limit" : "malformed" });
}

export function buildReport({ input, result, catalog, disclosures }) {
  const bySdkTracker = new Map();
  for (const sdk of disclosures.sdks) {
    for (const id of [...sdk.trackerIds, `sdk:${sdk.key}`]) bySdkTracker.set(id, [...(bySdkTracker.get(id) ?? []), sdk]);
  }

  const trackers = [...result.found.values()]
    .map(({ tracker, signature, exampleClass }) => ({
      id: tracker.id,
      name: tracker.name,
      categories: tracker.categories,
      evidence: { signature, exampleClass },
      disclosures: (bySdkTracker.get(tracker.id) ?? []).map((s) => s.key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // One SDK can match several catalog entries; each disclosure is applied once.
  const sdks = new Map();
  for (const t of trackers) for (const sdk of bySdkTracker.get(t.id) ?? []) sdks.set(sdk.key, sdk);
  const dataSafety = draftDataSafety([...sdks.values()]);
  const vendorConditions = [...sdks.values()].filter((s) => s.conditions).map((s) => ({ sdk: s.name, url: s.source, conditions: s.conditions }));

  const manifest = mergeManifests(result.manifests);
  const app = manifest
    ? { package: manifest.package, versionName: manifest.versionName, versionCode: manifest.versionCode }
    : null;
  const permissions = manifest ? manifest.permissions : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "safety-label", version: TOOL_VERSION },
    data: {
      trackers: { version: catalog.version, source: catalog.source, license: catalog.license, count: catalog.trackers.length },
      disclosures: { verified: disclosures.verified, sdks: disclosures.sdks.length },
    },
    input: { ...input, kind: result.kind },
    app,
    coverage: {
      dexFiles: result.dexFiles,
      classes: result.classes,
      skipped: result.skipped,
      permissionsRead: permissions !== null,
      ...(result.manifestNote ? { note: result.manifestNote } : {}),
      complete: result.dexFiles > 0 && result.skipped.length === 0 && permissions !== null,
    },
    trackers,
    dataSafety,
    vendorConditions,
    permissions,
    permissionHints: permissions ? permissionHints(permissions) : [],
    needsReview: trackers.filter((t) => t.disclosures.length === 0).map((t) => t.name),
  };
}

/** Merges vendor disclosures into one row per Play data type, keeping which SDK said what. */
export function draftDataSafety(sdks) {
  const rows = new Map();
  for (const sdk of sdks) {
    for (const item of sdk.collected) {
      // A vendor may name only a category; that stays an explicit unknown type, never a guess.
      const key = `${item.category}\u0000${item.type ?? ""}`;
      const row = rows.get(key) ?? { category: item.category, type: item.type, purposes: [], shared: false, optional: true, sources: [] };
      for (const p of item.purposes) if (!row.purposes.includes(p)) row.purposes.push(p);
      // Shared if any SDK shares it; unknown if any SDK doesn't say and none confirms it.
      if (item.shared === true) row.shared = true;
      else if (item.shared == null && row.shared === false) row.shared = null;
      row.optional &&= item.optional === true;
      row.sources.push({ sdk: sdk.name, url: sdk.source, ...(item.note ? { note: item.note } : {}) });
      rows.set(key, row);
    }
  }
  for (const row of rows.values()) row.purposes.sort((a, b) => rank(PURPOSE_ORDER, a) - rank(PURPOSE_ORDER, b));
  return [...rows.values()].sort((a, b) => rank(CATEGORY_ORDER, a.category) - rank(CATEGORY_ORDER, b.category) || (a.type ?? "").localeCompare(b.type ?? ""));
}

/** Position in Play's form order; anything unrecognised goes last. */
function rank(order, value) {
  const i = order.indexOf(value);
  return i < 0 ? order.length : i;
}

/** For split APKs: the base APK names the package; permissions from every split apply. */
function mergeManifests(manifests) {
  if (manifests.length === 0) return null;
  const base = manifests.find((m) => m.package) ?? manifests[0];
  const permissions = [...new Set(manifests.flatMap((m) => m.permissions))].map(clean).sort();
  return {
    package: base.package == null ? null : clean(base.package),
    versionName: base.versionName == null ? null : clean(base.versionName),
    versionCode: base.versionCode,
    permissions,
  };
}
