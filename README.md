# Compliance & Risk Tracker — Firestore migration

These 3 files replace the old localStorage version with Firebase Firestore (records) + Firebase Storage (file attachments).

## Files to upload to your GitHub repo

1. **index.html** — replaces existing
2. **app.js** — replaces existing
3. **firebase.js** — NEW file, place next to app.js
4. **styles.css** — KEEP your current one, no changes
5. **idh-logo.png** — KEEP your current one

## STEP 1 — Get your Firebase config

In Firebase Console for project `stock-manager-5dc93`:
- Project settings → Your apps → click **"Compliance & Risk Tracker"** Web App
- Under "SDK setup and configuration", select **Config**
- Copy the `firebaseConfig = { ... }` object

Open `firebase.js`, find the `firebaseConfig` block near the top, and paste your real values (especially `apiKey`).
The `appId`, `messagingSenderId`, `projectId`, `storageBucket`, `authDomain` shown are already filled from your screenshot — verify they match.

## STEP 2 — Enable Firestore (if not already)

Firebase Console → **Firestore Database** → Create database (Production mode is fine).

## STEP 3 — Enable Firebase Storage (REQUIRED for attachments)

Firebase Console → **Storage** → Get started → choose location.

## STEP 4 — Set security rules

### Firestore rules (Firestore → Rules → Publish):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /compliance_records/{id} {
      allow read, write: if true;
    }
  }
}
```

### Storage rules (Storage → Rules → Publish):
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /attachments/{recordId}/{fileName} {
      allow read, write: if true;
    }
  }
}
```

> Open access — same trust level as before. Anyone with your project ID can read/write. To restrict, add Firebase Auth later.

## STEP 5 — Push to GitHub

Commit & push the 3 changed files. GitHub Pages redeploys in ~30s.

## STEP 6 — Verify

Open the site. Top header should show **"Connected — syncs across devices"** in green.
Add a record in one browser → it appears instantly in another browser/device.
Refresh → data is still there.

## Differences from localStorage version

- **Records** stored in Firestore collection `compliance_records`. Live sync across all devices via `onSnapshot`.
- **Attachments** stored in Firebase Storage at `attachments/{recordId}/{attachmentId}_{filename}`. Records hold only metadata + download URL.
- Click an attachment chip in the table to open the file via its Firebase Storage URL.
- "Clear All" deletes records AND their files from Storage.

## Existing localStorage data

This version does NOT auto-migrate your old localStorage records. If you need them:
1. Open the OLD site → Records tab → Export CSV.
2. Open the NEW site → Records tab → Import CSV.
   (CSV import re-creates records but NOT their old attachments — those will need to be re-uploaded.)
