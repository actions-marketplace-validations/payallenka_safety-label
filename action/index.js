// GitHub Action entry point: scans the build, writes the JSON report, and puts the Markdown
// report in the job summary. No dependencies, so nothing is installed at run time.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { FormatError, LimitError } from "../src/errors.js";
import { compare, parseBaseline, renderJson, renderMarkdown } from "../src/report.js";
import { scanFile } from "../src/scan.js";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const escapeCommand = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

try {
  const path = input("path");
  if (!path) throw new FormatError("the 'path' input is required");
  const reportPath = input("report") || "safety-label-report.json";
  const baselinePath = input("baseline");

  const baseline = baselinePath ? parseBaseline(readFileSync(baselinePath, "utf8")) : null;
  const report = scanFile(path);
  const diff = baseline ? compare(baseline, report) : null;

  writeFileSync(reportPath, renderJson(report));
  const summary = renderMarkdown(report, diff);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);

  setOutput("report", reportPath);
  setOutput("trackers", String(report.trackers.length));
  setOutput("new-findings", diff ? String(diff.changed) : "");
  if (diff?.changed) {
    const added = [...diff.newTrackers.map((t) => `tracker ${t}`), ...diff.newDataTypes.map((t) => `data type ${t}`), ...diff.newPermissions];
    console.log(`::error title=Safety Label::${escapeCommand(`This build adds: ${added.join(", ")}. Update your Data safety form, then refresh the baseline.`)}`);
    process.exitCode = 1;
  }
} catch (e) {
  if (!(e instanceof FormatError || e instanceof LimitError || e.code === "ENOENT")) throw e;
  console.log(`::error title=Safety Label::${escapeCommand(e.message)}`);
  process.exitCode = 2;
}
