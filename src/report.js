import { FormatError } from "./errors.js";
import { SCHEMA_VERSION } from "./scan.js";

const DISCLAIMER =
  "This is a draft from the SDKs found in your app's code, not legal advice. Your own code, your servers, " +
  "and how each SDK is configured also decide what you must declare. Check every answer before submitting.";

const sharedText = (s) => (s === true ? "shared" : s === false ? "not shared" : "sharing: check vendor page");
const typeLabel = (r) => (r.type == null ? `${r.category} (type not named by the vendor)` : r.category === r.type ? r.type : `${r.category} › ${r.type}`);
const purposesText = (p) => (p.length > 0 ? p.join(", ") : "purposes not stated by the vendor");

function coverageLine(c) {
  const base = `${c.dexFiles} DEX file${c.dexFiles === 1 ? "" : "s"}, ${c.classes.toLocaleString("en-US")} classes`;
  if (c.complete) return `Scanned ${base}.`;
  const gaps = [
    ...(c.dexFiles === 0 ? ["no code could be read, so an empty result proves nothing"] : []),
    ...c.skipped.map((s) => `${s.entry} skipped (${s.reason})`),
    ...(c.permissionsRead ? [] : [c.note ?? "permissions could not be read"]),
  ];
  return `Scanned ${base}. Incomplete: ${gaps.join("; ")}.`;
}

function title(r) {
  const app = r.app?.package ? `${r.app.package}${r.app.versionName ? ` ${r.app.versionName}` : ""}` : r.input.file;
  return `${app} (${r.input.kind.toUpperCase()}, sha256 ${r.input.sha256.slice(0, 12)}…)`;
}

export function renderText(r, diff) {
  const out = [`safety-label ${r.tool.version}: ${title(r)}`, coverageLine(r.coverage), ""];
  out.push(`Tracking and data SDKs found: ${r.trackers.length}`);
  for (const t of r.trackers) out.push(`  ${t.name}${t.categories.length ? ` [${t.categories.join(", ")}]` : ""}`, `      found ${t.evidence.exampleClass}`);
  out.push("");
  if (r.dataSafety.length > 0) {
    out.push("Draft Data safety answers (from the SDK vendors' own disclosures)");
    for (const row of r.dataSafety) {
      out.push(`  ${typeLabel(row)}: collected, ${sharedText(row.shared)}${row.optional ? ", optional" : ""}; ${purposesText(row.purposes)}`);
      for (const s of row.sources) out.push(`      ${s.sdk}${s.note ? ` (${s.note})` : ""}`);
    }
    out.push("");
  }
  const review = reviewLines(r);
  if (review.length > 0) out.push("Check these yourself", ...review.map((l) => `  ${l}`), "");
  if (diff) out.push(...diffLines(diff), "");
  out.push(DISCLAIMER);
  return out.join("\n") + "\n";
}

function reviewLines(r) {
  const lines = [];
  if (r.needsReview.length > 0) lines.push(`No vendor disclosure on file for: ${r.needsReview.join(", ")}. Check what these SDKs collect.`);
  const byPermission = Map.groupBy(r.permissionHints, (h) => h.permission);
  for (const [permission, hints] of byPermission) {
    const byCategory = Map.groupBy(hints, (h) => h.category);
    const types = [...byCategory].map(([c, hs]) => (hs.length === 1 ? typeLabel(hs[0]) : `${c} › ${hs.map((h) => h.type).join(", ")}`)).join("; ");
    lines.push(`${permission.replace(/^android\.permission\./, "")} gives access to ${types}. Declare it if that data leaves the device.`);
  }
  return lines;
}

function diffLines(d) {
  if (!d.changed) return ["Compared with the baseline: nothing new."];
  return [
    "Compared with the baseline:",
    ...d.newTrackers.map((n) => `  + tracker ${n}`),
    ...d.newDataTypes.map((n) => `  + data type ${n}`),
    ...d.newPermissions.map((n) => `  + permission ${n}`),
    ...d.removedTrackers.map((n) => `  - tracker ${n}`),
  ];
}

const md = (s) => String(s).replace(/[\\`*_[\]<>|]/g, "\\$&");
/** A code span: Markdown escapes don't apply inside one, but a table cell still needs its pipes escaped. */
const code = (s) => `\`${String(s).replace(/`/g, "'").replace(/\|/g, "\\|")}\``;

export function renderMarkdown(r, diff) {
  const out = [`## Data safety draft: ${md(title(r))}`, "", md(coverageLine(r.coverage)), ""];
  if (diff) {
    out.push(diff.changed ? "### ⚠️ New since the baseline" : "### No change since the baseline", "");
    for (const n of diff.newTrackers) out.push(`- New tracker: **${md(n)}**`);
    for (const n of diff.newDataTypes) out.push(`- New data type: **${md(n)}**`);
    for (const n of diff.newPermissions) out.push(`- New permission: ${code(n)}`);
    for (const n of diff.removedTrackers) out.push(`- Removed tracker: ${md(n)}`);
    out.push("");
  }
  out.push(`### Tracking and data SDKs found (${r.trackers.length})`, "");
  if (r.trackers.length > 0) {
    out.push("| SDK | Category | Evidence |", "|---|---|---|");
    for (const t of r.trackers) out.push(`| ${md(t.name)} | ${md(t.categories.join(", "))} | ${code(t.evidence.exampleClass)} |`);
    out.push("");
  }
  if (r.dataSafety.length > 0) {
    out.push("### Draft answers", "", "| Data type | Shared | Purposes | Declared by |", "|---|---|---|---|");
    for (const row of r.dataSafety) {
      const by = row.sources.map((s) => `[${md(s.sdk)}](${s.url})${s.note ? ` (${md(s.note)})` : ""}`).join("<br>");
      out.push(`| ${md(typeLabel(row))} | ${sharedText(row.shared)} | ${md(purposesText(row.purposes))} | ${by} |`);
    }
    out.push("");
  }
  if (r.vendorConditions.length > 0) {
    out.push("### What the vendors say depends on your setup", "");
    for (const v of r.vendorConditions) out.push(`- [${md(v.sdk)}](${v.url}): ${md(v.conditions)}`);
    out.push("");
  }
  const review = reviewLines(r);
  if (review.length > 0) out.push("### Check these yourself", "", ...review.map((l) => `- ${md(l)}`), "");
  out.push(`_${DISCLAIMER}_`);
  return out.join("\n") + "\n";
}

export const renderJson = (r, diff) => JSON.stringify(diff ? { ...r, baseline: diff } : r, null, 2) + "\n";

/** Parses a report saved by an earlier run, rejecting anything that isn't one. */
export function parseBaseline(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch (e) {
    throw new FormatError(`baseline is not JSON: ${e.message}`);
  }
  if (r?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(r.trackers) || !Array.isArray(r.dataSafety)) {
    throw new FormatError(`baseline is not a safety-label report (schema ${SCHEMA_VERSION})`);
  }
  return r;
}

/** What the current build adds (or drops) compared with a baseline report. */
export function compare(base, cur) {
  const baseIds = new Set(base.trackers.map((t) => t.id));
  const curIds = new Set(cur.trackers.map((t) => t.id));
  const baseTypes = new Set(base.dataSafety.map(typeLabel));
  const basePerms = new Set(base.permissions ?? []);
  const diff = {
    package: { baseline: base.app?.package ?? null, current: cur.app?.package ?? null },
    newTrackers: cur.trackers.filter((t) => !baseIds.has(t.id)).map((t) => t.name),
    removedTrackers: base.trackers.filter((t) => !curIds.has(t.id)).map((t) => t.name),
    newDataTypes: cur.dataSafety.map(typeLabel).filter((t) => !baseTypes.has(t)),
    // Without both permission lists, additions are unknown rather than none.
    newPermissions: base.permissions && cur.permissions ? cur.permissions.filter((p) => !basePerms.has(p)) : [],
    permissionsCompared: Boolean(base.permissions && cur.permissions),
  };
  diff.changed = diff.newTrackers.length + diff.newDataTypes.length + diff.newPermissions.length > 0;
  return diff;
}
