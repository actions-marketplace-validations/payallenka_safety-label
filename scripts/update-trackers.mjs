// Regenerates data/trackers.json from the Exodus Privacy tracker database (ODbL 1.0).
// Run by a maintainer before a release, never by the tool at scan time: scans stay offline.
// Usage: node scripts/update-trackers.mjs [path-to-downloaded-trackers.json]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://reports.exodus-privacy.eu.org/api/trackers";
async function download() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Exodus API returned HTTP ${res.status}`);
  return res.json();
}
const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : await download();

const trackers = Object.values(raw.trackers)
  .map((t) => ({
    id: `exodus:${t.id}`,
    name: t.name.trim(),
    categories: t.categories ?? [],
    website: t.website || null,
    codeSignatures: t.code_signature.split("|").map((s) => s.trim()).filter(Boolean),
  }))
  .filter((t) => t.codeSignatures.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

// Refuse to write a catalog that would silently report "no trackers" everywhere.
const MIN_TRACKERS = 300;
if (trackers.length < MIN_TRACKERS) throw new Error(`only ${trackers.length} trackers; expected at least ${MIN_TRACKERS}`);
const bad = trackers.flatMap((t) => t.codeSignatures).filter((s) => !/^[A-Za-z0-9_$.\-]+$/.test(s));
if (bad.length) throw new Error(`unexpected signature format: ${bad.slice(0, 5).join(", ")}`);

const catalog = {
  version: new Date().toISOString().slice(0, 10),
  source: SOURCE_URL,
  license: "ODbL-1.0 (database), DbCL-1.0 (contents); derived from the Exodus Privacy tracker database",
  trackers,
};
const out = fileURLToPath(new URL("../data/trackers.json", import.meta.url));
writeFileSync(out, JSON.stringify(catalog) + "\n");
console.log(`wrote ${trackers.length} trackers to ${out}`);
