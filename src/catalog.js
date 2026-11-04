import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));

/** The Exodus Privacy tracker catalog (ODbL): tracker id, name, categories and code signatures. */
export const loadCatalog = () => read("trackers.json");

/** Vendor-published Data safety disclosures, keyed to catalog tracker ids. */
export const loadDisclosures = () => read("sdk-disclosures.json");

/**
 * Everything the matcher looks for: the catalog's trackers, plus SDKs that have a vendor disclosure
 * and their own code signatures but no catalog entry (Exodus lists trackers, not every SDK that
 * collects data). Those get the id `sdk:<key>`.
 */
export function matchableSdks(catalog, disclosures) {
  const extra = disclosures.sdks
    .filter((s) => s.codeSignatures?.length)
    .map((s) => ({ id: `sdk:${s.key}`, name: s.name, categories: [], codeSignatures: s.codeSignatures }));
  return [...catalog.trackers, ...extra];
}

/** Evidence is stored and displayed; keep it bounded whatever the input. */
const MAX_EVIDENCE_CHARS = 200;

/**
 * Matches class names against catalog signatures with a character trie: one walk per class name,
 * linear in its length. Signatures match only at `.`/`$` boundaries, so `com.facebook.ads` matches
 * `com.facebook.ads.AdView` but not `com.facebook.adsx.Thing`.
 */
export class TrackerMatcher {
  #root = newNode();

  constructor(definitions) {
    for (const tracker of definitions) {
      for (const sig of tracker.codeSignatures) {
        const key = sig.trim().replace(/\.+$/, "");
        if (!key) continue;
        let node = this.#root;
        for (const c of key) {
          if (!node.next.has(c)) node.next.set(c, newNode());
          node = node.next.get(c);
        }
        node.trackers.push(tracker);
        node.signature = key;
      }
    }
  }

  /** Adds tracker id -> first matching class (kept as evidence) to [found] for one class name. */
  matchInto(found, className) {
    let node = this.#root;
    for (let i = 0; i <= className.length; i++) {
      if (i === className.length || className[i] === "." || className[i] === "$") {
        for (const tracker of node.trackers) {
          if (!found.has(tracker.id)) {
            found.set(tracker.id, { tracker, signature: node.signature, exampleClass: className.slice(0, MAX_EVIDENCE_CHARS) });
          }
        }
      }
      if (i === className.length) break;
      node = node.next.get(className[i]);
      if (!node) break;
    }
  }
}

function newNode() {
  return { next: new Map(), trackers: [], signature: "" };
}
