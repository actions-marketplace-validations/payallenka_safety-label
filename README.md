# safety-label

**Know what your Android app's SDKs collect before Google Play asks.**

`safety-label` scans an APK, AAB or split APK set and finds the tracking and data SDKs compiled into it. It then drafts your Google Play **Data safety** answers from the SDK vendors' own published disclosures, with a link to the source for every answer.

In CI it compares each build with your last release. The build fails when an update adds a tracker, a data type or a permission, so a dependency bump can't make your Data safety form wrong without anyone noticing.

- **Offline.** The app never leaves your machine or runner; nothing is uploaded.
- **Zero dependencies.** Plain Node.js 22+, on Linux, macOS and Windows.
- **Fast.** A 191 MB production APK (21,793 classes) scans in about 0.4 s.
- **Evidence-based.** Every SDK comes with the class that proves it is there, and every drafted answer with the vendor page it came from.

```
npx safety-label app-release.apk
```

## Why

Every app on Google Play must fill in the Data safety form, and the app is responsible for what its SDKs collect too. Most teams don't know exactly which SDKs ship in their release build (transitive dependencies included) or what each one collects, so they guess. Wrong answers can lead to an enforcement notice or the app being removed.

`safety-label` reads the build you actually ship, not your dependency list, so it also sees SDKs pulled in transitively.

## Example

```
$ npx safety-label app-release.apk
safety-label 0.1.0: com.example.app 2.0 (APK, sha256 db6edaff7283…)
Scanned 1 DEX file, 4 classes.

Tracking and data SDKs found: 3
  Facebook Analytics [Analytics]
      found com.facebook.appevents.AppEventsLogger
  Google AdMob [Advertisement]
      found com.google.android.gms.ads.AdView
  Google Firebase Analytics [Analytics]
      found com.google.firebase.analytics.FirebaseAnalytics

Draft Data safety answers (from the SDK vendors' own disclosures)
  Location › Approximate location: collected, shared; Analytics, Advertising or marketing, …
      Google Mobile Ads (AdMob) (Vendor lists 'IP address', 'which may be used to estimate the general location of a device'.)
      Firebase Analytics (Vendor: 'Derives coarse location data from the masked IP addresses of the device.' Mapping derived.)
  App activity › App interactions: collected, shared; Analytics, Advertising or marketing, …
  Device or other IDs: collected, shared; Analytics, Advertising or marketing, …
  …

Check these yourself
  No vendor disclosure on file for: Facebook Analytics. Check what these SDKs collect.
  ACCESS_FINE_LOCATION gives access to Location › Precise location. Declare it if that data leaves the device.
```

`--format markdown` gives the same report as tables, ready for a pull request or job summary. `--format json` gives the full machine-readable report.

## GitHub Action

```yaml
- name: Build
  run: ./gradlew assembleRelease

- name: Check Data safety
  uses: payallenka/safety-label@v0.1.0
  with:
    path: app/build/outputs/apk/release/app-release.apk
    baseline: .github/safety-label-baseline.json
```

The report appears in the job summary. With a `baseline`, the step fails when the build adds something, and the error lists what was added. After you update your Data safety form, refresh the baseline:

```
npx safety-label app-release.apk --format json --output .github/safety-label-baseline.json
```

| Input | Default | |
|---|---|---|
| `path` | required | APK, AAB, APKS or XAPK to scan |
| `baseline` | none | Earlier JSON report to compare with |
| `report` | `safety-label-report.json` | Where to write this run's JSON report |

Outputs: `report` (path), `trackers` (count), `new-findings` (`true`/`false`, empty without a baseline).

## CLI

```
safety-label <app.apk|app.aab|app.apks|app.xapk> [options]
  -f, --format <text|markdown|json>  Output format (default: text)
  -o, --output <file>                Write the report to a file
  -b, --baseline <report.json>       Exit 1 if this build adds a tracker, data type or permission
```

Exit codes: `0` done, `1` new findings compared with the baseline, `2` usage or input error.

## How it works

1. **Reads the archive.** APKs, App Bundles, and APK sets (APKS/XAPK) are read directly. Each DEX file is read only as far as its class list.
2. **Finds SDKs.** Class names are matched against the [Exodus Privacy](https://exodus-privacy.eu.org) tracker catalog (428 trackers), plus code signatures for SDKs that collect data but aren't in that catalog, such as Firebase Cloud Messaging. Matches happen only at package boundaries, so `com.facebook.ads` never matches `com.facebook.adsx`.
3. **Reads the manifest.** The package, version and requested permissions come from the compiled `AndroidManifest.xml`.
4. **Drafts answers.** Each SDK found is looked up in [`data/sdk-disclosures.json`](data/sdk-disclosures.json), which records what the vendor says it collects in Play's own vocabulary, with the source URL and any conditions. Answers are merged per data type, keeping who declared what.
5. **Flags what it can't decide.** These include SDKs with no disclosure on file, and permissions that give access to a data type. Holding a permission doesn't mean the data is collected; that depends on whether it leaves the device.

Apps are untrusted input: every offset is bounds-checked, decompression and decoding are capped, and text from the app is sanitised before display.

## Disclosure coverage

Vendor disclosures on file (12): Firebase Analytics, Firebase Crashlytics, Firebase Cloud Messaging, Firebase Performance Monitoring, Google Mobile Ads (AdMob), Adjust, Branch, OneSignal, Unity Ads, ironSource/LevelPlay, Braze, Bugsnag.

No usable official disclosure found yet: Meta (Facebook) SDK, Meta Audience Network, AppsFlyer, Sentry, Mixpanel, Amplitude, AppLovin MAX, Segment, Google Sign-In, Google Play Billing. These are still detected and listed under "Check these yourself". If you know an official vendor page for one of them, please [open an issue](https://github.com/payallenka/safety-label/issues).

On 5 November 2026 every phrase quoted in the data was checked word for word against the vendor's live page, except Branch, whose page blocks automated downloads. The sharing answers for AdMob and Firebase were also checked by hand.

Many vendors don't use Play's exact type names. Where an answer maps a vendor's wording onto a Play type, its note says "Mapping derived" and quotes the vendor.

## What it can't see

- SDKs in native libraries, or code downloaded at runtime
- Data your own code or your servers collect
- How you configured each SDK (for example, whether you turned off Advertising ID collection)
- Permissions inside an App Bundle (`.aab`); its manifest isn't read yet, so scan an APK built from the bundle

The result is a draft for you to check, not legal advice.

## Data and licenses

- Code: [Apache-2.0](LICENSE).
- Tracker catalog: derived from the Exodus Privacy database, [ODbL 1.0](TRACKER_DATA_LICENSE.md). It is refreshed monthly by a workflow that opens a pull request.
- SDK disclosures: facts summarised from each vendor's public page, linked per entry.

## Roadmap

- Read App Bundle manifests
- More SDK disclosures, starting with the list above
- Apple privacy manifest (`PrivacyInfo.xcprivacy`) checks for iOS builds
