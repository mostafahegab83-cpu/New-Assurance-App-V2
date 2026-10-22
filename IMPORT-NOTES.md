# CSV Import Rules (added in the import-safety update)

The date parser and the eight normalized date fields are unchanged. These rules
cover how imported rows merge with records already in the database, and how
large imports are saved.

## Matching and merging (updating existing records)

A row is matched to an existing record by the **id** column. Per field:

| Situation | What happens |
|---|---|
| Column present with a valid value | Field is updated from the file |
| Column absent from the file entirely | Existing value is **kept** |
| Column present but cell is blank or N/A | Existing value is **kept by default**; the import dialog asks, and you can choose **Clear those fields** (set to N/A) instead |
| Date cell that cannot be parsed | Import stops before saving; nothing is changed |

The confirmation dialog shows, per field, how many records will be updated,
kept as-is, or cleared before you confirm.

Never overwritten on an update, in any case:
- **Attachments** (files stay linked to the record)
- **Original creation timestamp** (createdAt)
- Any other stored data not present as a column in the file

New records behave as before: blank cells become N/A and the app's default
values apply.

## Large imports

- **All rows are validated first.** Any date or mapping error stops the import
  before a single record is saved.
- Records are saved in batches of **450** (Firestore's limit is 500 writes per
  batch). **The import is therefore not atomic**: if a later batch fails,
  earlier batches are already saved.
- A live progress bar shows **"Saving X of N records"** while saving runs.
- If a batch fails, the dialog shows the Firestore error and exactly how many
  records were saved.

## Retrying after a failure

Record IDs for rows without an id are derived from the **file's contents**
(hash) plus row number — not from the time of the import. Re-running the
import with **the same file** therefore produces the same IDs: records already
saved are updated in place instead of being duplicated. Editing the file
(changes a value, adds/removes a row, re-saving from Excel) changes the hash,
so only rows whose id column still matches are treated as updates.

## Files

- `import-merge.js` — merge rules, stable IDs, batch saving (pure logic, unit-tested)
- `tests/import-merge.test.mjs` — merge/retry/failure regression tests
- `tests/import-dates.test.mjs` — date parsing tests (unchanged)
- `app.js` — import dialogs, preview, progress and error reporting

Run tests with: `node --test tests/import-dates.test.mjs tests/import-merge.test.mjs`
