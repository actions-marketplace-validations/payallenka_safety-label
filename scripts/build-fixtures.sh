#!/usr/bin/env bash
# Rebuilds test/fixtures/*.apk|apks|aab with the real Android toolchain (javac -> d8 -> aapt2), so tests
# read the same DEX and binary-XML layouts a production build produces. The outputs are committed;
# only rerun this when the fixtures need to change.
# Needs: a JDK and an Android SDK (build-tools and one platform) at ANDROID_HOME.
set -euo pipefail
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "set ANDROID_HOME"; exit 2; }
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
AJ=$(ls "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)
OUT="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# compile <dir> <class>... : one DEX defining the given classes.
compile() {
  local d=$1; shift
  mkdir -p "$d/src" "$d/cls" "$d/dex"
  for c in "$@"; do
    local f="$d/src/${c//.//}.java"; mkdir -p "$(dirname "$f")"
    echo "package ${c%.*}; public class ${c##*.} {}" > "$f"
  done
  javac --release 11 -d "$d/cls" $(find "$d/src" -name '*.java')
  "$BT/d8" --min-api 28 --output "$d/dex" $(find "$d/cls" -name '*.class')
}

# apk <name> <versionCode> <permissions> <class>... : an unsigned APK (signing doesn't affect scanning).
apk() {
  local name=$1 v=$2 perms=$3; shift 3
  local d="$WORK/$name"
  compile "$d" com.example.fixture.Main "$@"
  {
    echo "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.example.fixture\""
    echo "    android:versionCode=\"$v\" android:versionName=\"$v.0\">"
    for p in $perms; do echo "  <uses-permission android:name=\"$p\"/>"; done
    echo "  <application android:label=\"Fixture\"/>"
    echo "</manifest>"
  } > "$d/AndroidManifest.xml"
  "$BT/aapt2" link -o "$d/out.apk" --manifest "$d/AndroidManifest.xml" -I "$AJ"
  (cd "$d/dex" && zip -q ../out.apk classes.dex)
  cp "$d/out.apk" "$OUT/$name.apk"
}

apk clean 1 "android.permission.INTERNET"
apk tracked-v1 1 "android.permission.INTERNET android.permission.ACCESS_COARSE_LOCATION" \
  com.google.firebase.analytics.FirebaseAnalytics com.google.android.gms.ads.AdView
apk tracked-v2 2 "android.permission.INTERNET android.permission.ACCESS_COARSE_LOCATION android.permission.ACCESS_FINE_LOCATION com.google.android.gms.permission.AD_ID" \
  com.google.firebase.analytics.FirebaseAnalytics com.google.android.gms.ads.AdView com.facebook.appevents.AppEventsLogger

# A split install (APKS): the base APK plus a second APK carrying more code.
compile "$WORK/split" io.sentry.Sentry
(cd "$WORK/split/dex" && zip -q ../split_feature.apk classes.dex)
cp "$OUT/tracked-v1.apk" "$WORK/split/base.apk"
rm -f "$OUT/split.apks"
(cd "$WORK/split" && zip -q "$OUT/split.apks" base.apk split_feature.apk)

# An App Bundle layout: protobuf manifest (not read) and code under base/dex/.
mkdir -p "$WORK/aab/base/manifest" "$WORK/aab/base/dex"
printf '\x0a\x00' > "$WORK/aab/base/manifest/AndroidManifest.xml"
compile "$WORK/aabsrc" com.example.fixture.Main com.appsflyer.AppsFlyerLib
cp "$WORK/aabsrc/dex/classes.dex" "$WORK/aab/base/dex/classes.dex"
rm -f "$OUT/bundle.aab"
(cd "$WORK/aab" && zip -qr "$OUT/bundle.aab" base)

ls -la "$OUT"
