# Changelog

## 0.1.0

First release.

- Scans APK, AAB, APKS and XAPK files for tracking and data SDKs (Exodus Privacy catalog, 428 trackers, plus disclosure-only SDKs).
- Drafts Google Play Data safety answers from 12 vendors' published disclosures, citing a source for every answer.
- Reads package, version and permissions from APK manifests, and flags permissions that give access to a data type.
- `--baseline` comparison that exits 1 when a build adds a tracker, data type or permission.
- Text, Markdown and JSON output; GitHub Action with job summary and outputs.
