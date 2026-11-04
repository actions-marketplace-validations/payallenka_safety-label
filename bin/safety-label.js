#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { FormatError, LimitError } from "../src/errors.js";
import { compare, parseBaseline, renderJson, renderMarkdown, renderText } from "../src/report.js";
import { scanFile, TOOL_VERSION } from "../src/scan.js";

const USAGE = `Usage: safety-label <app.apk|app.aab|app.apks|app.xapk> [options]

Finds the tracker SDKs inside an Android app and drafts Google Play Data safety answers
from the SDK vendors' own disclosures. Everything runs locally; nothing is uploaded.

Options:
  -f, --format <text|markdown|json>  Output format (default: text)
  -o, --output <file>                Write the report to a file instead of stdout
  -b, --baseline <report.json>       Compare with an earlier JSON report; exit 1 if this build
                                     adds a tracker, data type or permission
  -h, --help                         Show this help
  -v, --version                      Show the version

Exit codes: 0 done, 1 new findings compared with the baseline, 2 usage or input error.
`;

const RENDER = { text: renderText, markdown: renderMarkdown, json: renderJson };

function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f", default: "text" },
        output: { type: "string", short: "o" },
        baseline: { type: "string", short: "b" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    return fail(e.message);
  }
  const { values, positionals } = args;
  if (values.help) return process.stdout.write(USAGE), 0;
  if (values.version) return console.log(TOOL_VERSION), 0;
  if (positionals.length !== 1) return fail("give exactly one app file to scan");
  const render = RENDER[values.format];
  if (!render) return fail(`unknown format "${values.format}"; use text, markdown or json`);

  try {
    const baseline = values.baseline ? parseBaseline(readFileSync(values.baseline, "utf8")) : null;
    const report = scanFile(positionals[0]);
    const diff = baseline ? compare(baseline, report) : null;
    const text = render(report, diff);
    if (values.output) writeFileSync(values.output, text);
    else process.stdout.write(text);
    if (diff && values.output) process.stderr.write(diff.changed ? "New findings compared with the baseline.\n" : "No new findings compared with the baseline.\n");
    return diff?.changed ? 1 : 0;
  } catch (e) {
    if (e instanceof FormatError || e instanceof LimitError || e.code === "ENOENT" || e.code === "EISDIR" || e.code === "EACCES") return fail(e.message, false);
    throw e;
  }
}

function fail(message, usage = true) {
  process.stderr.write(`safety-label: ${message}\n${usage ? "Run safety-label --help for usage.\n" : ""}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
