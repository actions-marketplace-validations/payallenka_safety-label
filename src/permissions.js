/**
 * Permissions that give an app access to a Google Play Data safety data type. Holding one does not
 * mean the data is collected: it is collected only if it leaves the device. Each hint is a question
 * for the developer, never an answer.
 */
const HINTS = {
  "android.permission.ACCESS_FINE_LOCATION": [["Location", "Precise location"]],
  "android.permission.ACCESS_COARSE_LOCATION": [["Location", "Approximate location"]],
  "android.permission.ACCESS_BACKGROUND_LOCATION": [["Location", "Approximate location"], ["Location", "Precise location"]],
  "android.permission.READ_CONTACTS": [["Contacts", "Contacts"]],
  "android.permission.READ_CALENDAR": [["Calendar", "Calendar events"]],
  "android.permission.RECORD_AUDIO": [["Audio files", "Voice or sound recordings"]],
  "android.permission.CAMERA": [["Photos and videos", "Photos"], ["Photos and videos", "Videos"]],
  "android.permission.READ_MEDIA_IMAGES": [["Photos and videos", "Photos"]],
  "android.permission.READ_MEDIA_VIDEO": [["Photos and videos", "Videos"]],
  "android.permission.READ_MEDIA_AUDIO": [["Audio files", "Music files"], ["Audio files", "Other audio files"]],
  "android.permission.READ_EXTERNAL_STORAGE": [["Photos and videos", "Photos"], ["Photos and videos", "Videos"], ["Files and docs", "Files and docs"]],
  "android.permission.READ_SMS": [["Messages", "SMS or MMS"]],
  "android.permission.RECEIVE_SMS": [["Messages", "SMS or MMS"]],
  "android.permission.RECEIVE_MMS": [["Messages", "SMS or MMS"]],
  "android.permission.BODY_SENSORS": [["Health and fitness", "Health info"]],
  "android.permission.ACTIVITY_RECOGNITION": [["Health and fitness", "Fitness info"]],
  "android.permission.QUERY_ALL_PACKAGES": [["App activity", "Installed apps"]],
  "com.google.android.gms.permission.AD_ID": [["Device or other IDs", "Device or other IDs"]],
};

/** Health Connect permissions (android.permission.health.READ_*) all grant health or fitness data. */
const HEALTH_CONNECT = /^android\.permission\.health\.READ_/;

export function permissionHints(permissions) {
  const hints = [];
  for (const permission of permissions) {
    const types = HINTS[permission] ?? (HEALTH_CONNECT.test(permission) ? [["Health and fitness", "Health info"], ["Health and fitness", "Fitness info"]] : []);
    for (const [category, type] of types) hints.push({ permission, category, type });
  }
  return hints;
}
