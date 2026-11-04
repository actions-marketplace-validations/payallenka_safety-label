import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog, loadDisclosures } from "../src/catalog.js";
import { PURPOSE_ORDER } from "../src/scan.js";

// Google Play's Data safety vocabulary: every category and type the form offers.
const PLAY_TYPES = {
  Location: ["Approximate location", "Precise location"],
  "Personal info": ["Name", "Email address", "User IDs", "Address", "Phone number", "Race and ethnicity", "Political or religious beliefs", "Sexual orientation", "Other info"],
  "Financial info": ["User payment info", "Purchase history", "Credit score", "Other financial info"],
  "Health and fitness": ["Health info", "Fitness info"],
  Messages: ["Emails", "SMS or MMS", "Other in-app messages"],
  "Photos and videos": ["Photos", "Videos"],
  "Audio files": ["Voice or sound recordings", "Music files", "Other audio files"],
  "Files and docs": ["Files and docs"],
  Calendar: ["Calendar events"],
  Contacts: ["Contacts"],
  "App activity": ["App interactions", "In-app search history", "Installed apps", "Other user-generated content", "Other actions"],
  "Web browsing": ["Web browsing history"],
  "App info and performance": ["Crash logs", "Diagnostics", "Other app performance data"],
  "Device or other IDs": ["Device or other IDs"],
};

test("every disclosure uses Play's vocabulary, cites an https source and maps to real catalog ids", () => {
  const catalogIds = new Set(loadCatalog().trackers.map((t) => t.id));
  const { sdks } = loadDisclosures();
  assert.equal(new Set(sdks.map((s) => s.key)).size, sdks.length, "keys are unique");
  for (const sdk of sdks) {
    assert.match(sdk.source, /^https:\/\//, sdk.key);
    for (const id of sdk.trackerIds) assert.ok(catalogIds.has(id), `${sdk.key}: ${id} not in catalog`);
    assert.ok(sdk.trackerIds.length > 0 || sdk.codeSignatures?.length > 0, `${sdk.key} can never be matched`);
    for (const sig of sdk.codeSignatures ?? []) assert.match(sig, /^[A-Za-z0-9_$.]+$/, sdk.key);
    for (const item of sdk.collected) {
      const where = `${sdk.key}: ${item.category} / ${item.type}`;
      assert.ok(PLAY_TYPES[item.category], where);
      assert.ok(item.type === null || PLAY_TYPES[item.category].includes(item.type), where);
      for (const p of item.purposes) assert.ok(PURPOSE_ORDER.includes(p), `${where}: ${p}`);
      assert.ok([true, false, null].includes(item.shared), where);
    }
  }
});

test("permission hints use Play's vocabulary too", async () => {
  const { permissionHints } = await import("../src/permissions.js");
  const all = permissionHints([
    "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_CONTACTS", "android.permission.READ_CALENDAR", "android.permission.RECORD_AUDIO", "android.permission.CAMERA",
    "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE", "android.permission.READ_SMS", "android.permission.BODY_SENSORS",
    "android.permission.ACTIVITY_RECOGNITION", "android.permission.QUERY_ALL_PACKAGES", "com.google.android.gms.permission.AD_ID",
    "android.permission.health.READ_STEPS",
  ]);
  for (const h of all) assert.ok(PLAY_TYPES[h.category]?.includes(h.type), `${h.permission}: ${h.category} / ${h.type}`);
});
