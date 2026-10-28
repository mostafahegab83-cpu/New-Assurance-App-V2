# Project notes (merged)

Contents: roadmap, IMPORT-NOTES, DASHBOARD-MONTH-VERIFICATION, REVIEW-MONTH-VERIFICATION, PROCESS-COUNT-VERIFICATION, PROCESS-SEARCH-VERIFICATION

---

## Source: roadmap.md

## Review Records update
- [x] Add calendar-month filter and distinct-process counter using existing Records data.
- [x] Run rule tests and actual-app local browser integration with isolated Firebase mock.
- [x] Package inspected GitHub-ready source and report exact verification scope.
## Dashboard update
- [x] Add shared calendar-month filtering and distinct reviewed-process count to Dashboard.
- [x] Run unit and isolated actual-app dashboard checks and Records regressions.
- [x] Package inspected GitHub-ready files with verification notes.
## Process count correction
- [x] Count distinct process names rather than process/department combinations.
- [x] Verify 114 review entries with 17 processes in unit and isolated browser tests.
- [x] Package GitHub-ready correction with verification scope.

---

## Source: IMPORT-NOTES.md

## CSV Import Rules (added in the import-safety update)

The date parser and the eight normalized date fields are unchanged. These rules
cover how imported rows merge with records already in the database, and how
large imports are saved.

### Matching and merging (updating existing records)

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

### Large imports

- **All rows are validated first.** Any date or mapping error stops the import
  before a single record is saved.
- Records are saved in batches of **450** (Firestore's limit is 500 writes per
  batch). **The import is therefore not atomic**: if a later batch fails,
  earlier batches are already saved.
- A live progress bar shows **"Saving X of N records"** while saving runs.
- If a batch fails, the dialog shows the Firestore error and exactly how many
  records were saved.

### Retrying after a failure

Record IDs for rows without an id are derived from the **file's contents**
(hash) plus row number — not from the time of the import. Re-running the
import with **the same file** therefore produces the same IDs: records already
saved are updated in place instead of being duplicated. Editing the file
(changes a value, adds/removes a row, re-saving from Excel) changes the hash,
so only rows whose id column still matches are treated as updates.

### Files

- `import-merge.js` — merge rules, stable IDs, batch saving (pure logic, unit-tested)
- `tests/import-merge.test.mjs` — merge/retry/failure regression tests
- `tests/import-dates.test.mjs` — date parsing tests (unchanged)
- `app.js` — import dialogs, preview, progress and error reporting

Run tests with: `node --test tests/import-dates.test.mjs tests/import-merge.test.mjs`

---

## Source: DASHBOARD-MONTH-VERIFICATION.md

## Dashboard Review Month update

### Upload files
Replace app.js, index.html and records-filters.js in the GitHub repository together.
No styles.css changes are needed for this update; it reuses the Records filter styling.
The full ZIP includes all existing files, including the prior Records and import fixes.

### Behavior
Dashboard has its own Review Month dropdown and Reviewed Processes counter, shared by Findings and Risk views. Month selection uses valid normalized auditDate calendar strings, not creation/import dates or IDs. All Months retains unknown dates. Month choices are newest first. Existing dashboard filters combine with month using AND. Clear resets month. Repeated process steps count once per normalized processName + processOwner pair. Counter, existing charts, KPIs, schedule table and findings calculations use the same filtered records. Snapshot refreshes update choices and counts. An active month remains selected with zero results when its last record is moved/deleted. Records and Dashboard selections remain independent.

### Exact verification executed
- Automated: 38/38 Node unit tests passed in UTC, America/Los_Angeles and Pacific/Auckland (114 passing executions). Includes four new dashboard rule tests. app.js syntax check passed.
- Local actual-app Dashboard integration, isolated Firebase mock: passed in Los Angeles and Auckland. Verified September 30 versus October 1; missing/invalid dates excluded from selected months; newest-first options; distinct counter; All Months; Department/search AND; empty results; Clear; Findings compliance KPIs/chart; Risk KPIs/chart; schedule table; snapshot update/add/remove; no record mutation or writes; no console JavaScript errors. Inspected screenshots of both dashboard filter rows.
- Local Records regression using actual CSV parser and mocked Firebase: passed in Los Angeles and Auckland. New/update import, IDs/no duplicates, three Action Owner values, export/reimport, invalid-date save blocking, attachments/creation timestamps, edit/add/delete, backup/restore, NC/Risk date input and existing module navigation. Records mobile filter/counter/clear check passed.
- No live Firebase requests occurred. No production data was accessed or changed.
- Deployed GitHub Pages and real Firebase: NOT tested. PDF generation was not exercised; the existing export calculations call the shared filtered-data path, but the new toolbar counter is not added to PDF captures.

### Changes relative to New-Assurance-App-V2-review-month.zip
Application: app.js, index.html, records-filters.js.
Tests: new tests/dashboard-filters.test.mjs.
Notes: updated AGENTS.md and roadmap.md; new DASHBOARD-MONTH-VERIFICATION.md.
All other existing files are byte-for-byte unchanged.

---

## Source: REVIEW-MONTH-VERIFICATION.md

## Review Month + Reviewed Processes

### Upload to GitHub
This is the complete updated application, based on the previous import-safety download. Nothing was published from Lovable.

Replace these three existing files: `app.js`, `index.html`, `styles.css`.
Add `records-filters.js` beside `app.js`. It is required at runtime; do not omit it.
All other existing application files are byte-for-byte unchanged from the import-safety version.

New supporting files: `tests/records-filters.test.mjs`, `tests/records-month-browser.py`, `AGENTS.md`, `roadmap.md`, and this report.

### Behavior and counting identity
- The dropdown uses valid normalized `auditDate` strings, newest first. Months are compared as calendar `YYYY-MM` strings without timezone conversion.
- All Months includes records with unknown/invalid dates; selecting a month excludes those records.
- `processName` + `processOwner` (the existing Department field) identifies a distinct process. There is no process ID in the Review record schema. Case and repeated spaces are ignored for identity. Review IDs, phases and steps do not split one process into multiple processes. Missing/N/A process names do not create a fabricated process count; missing departments form an unknown-department group for a known process name.
- The counter uses exactly the table's filtered rows, including all existing filters with AND logic.
- The existing snapshot listener refreshes both controls after imports, adds, edits, deletes and restores. No additional data store or subscription was introduced.
- Clear Filters resets everything. If the last record in an actively selected month is moved/deleted, that month stays selected and shows zero until cleared, rather than silently expanding to All Months.
- CSV export scope is deliberately unchanged: the existing exporter does not apply every Records filter. Review Month changes the table and counter, not the export's existing scope.

### Changed functions
`app.js`: only the Records view helper import and `renderRecords()` were changed.
`records-filters.js`: `reviewMonth`, `monthLabel`, `availableReviewMonths`, `processKey`, `countReviewedProcesses`, `filterReviewRecords`.
`index.html`: new month dropdown, clipboard-check counter and app script cache version.
`styles.css`: scoped styles for the two new controls, using existing color tokens.

### Executed automated unit tests
Command: `TZ=<timezone> node --test tests/*.test.mjs`.

| Timezone | Passed | Failed |
| --- | ---: | ---: |
| UTC | 34 | 0 |
| America/Los_Angeles | 34 | 0 |
| Pacific/Auckland | 34 | 0 |

The 34 tests comprise 17 existing date tests, 7 existing import-safety tests, and 10 new Records tests. Each of the three complete runs executed: 102 test executions total.
`node --check app.js` also passed.

### Executed local browser integration
Actual application HTML and JavaScript served locally, with only `firebase.js` request-intercepted by an in-memory mock. Authentication, snapshot reads, document writes and write batches were mocked; no real Firebase rules, network writes or transactions were tested. External chart/export libraries loaded normally. Firebase network requests were blocked.

Complete desktop workflow passed in **America/Los_Angeles** and **Pacific/Auckland**:
- Six controlled initial rows: All Months displayed six rows and four distinct processes.
- September displayed rows dated September 1, 20 and 30, with two distinct processes; October 1 excluded. September 20 remained in September in both timezones.
- Month options were October 2026, September 2026; no arbitrary month for N/A or February 30.
- Department Finance displayed two September review steps but one process. Process Name Billing produced the same result. Billing + HR produced zero with AND logic.
- Clear Filters restored six rows/four processes and reset the month. Filtering caused zero writes and no object changes.
- Real CSV upload/parser/header mapping/date normalization/confirmation/batch writes/snapshot rendering created one Procurement process and updated one existing ID. September count changed from two to three.
- Original attachment metadata and creation timestamp on the updated record remained unchanged. Three Action Owner values remained distinct through import and actual browser CSV download.
- Valid exported subset re-imported as zero new/five updates, with no duplicate IDs. An export including a pre-existing invalid date was correctly rejected; legacy invalid data was not silently corrected.
- Incoming CSV containing September 31 and a valid second row caused zero writes; the error dialog listed Review Date and the invalid original value. Existing date unit tests also cover row reporting.
- Editing Procurement's Review Date through the actual form from September 30 to October 1 immediately removed it from September and increased October's process count. Form input read back September 30 before editing.
- Form creation and deletion refreshed the KPI/month options. Deleting the last November record retained November selection with zero.
- Clear All and Restore Last Backup were exercised **only against the mock**; restored record objects, including attachments and timestamps, exactly matched the pre-backup objects.
- The existing NC/Risk exact Review Date filter returned one matching row dated September 21.
- Existing module tabs (NC/Risk & CAPA, Dashboard, Document Control, Process Inventory, Gap Analysis, Process Map) opened without JavaScript errors. This is navigation smoke coverage, not exhaustive module regression testing.
- No JavaScript page or error-level console messages in the final complete runs. The new helper module loaded successfully locally.

Mobile 390 × 844, America/Los_Angeles: month selection, Department/Process filtering, zero-state, Clear Filters and counter passed. The filter area was visually inspected; controls wrapped without overlap. Desktop screenshots were also inspected. Existing horizontally scrolling table layout was retained.

Reproduce browser checks with Python + Playwright installed: serve this folder on port 8099, then run `python3 tests/records-month-browser.py`. The script blocks live Firebase and uses local mock data only.

### Not executed / remaining limitations
- No deployed GitHub Pages test; no deployed URL was supplied or changed.
- No live Firebase integration or security-rules test. Production was never touched.
- Other modules were unchanged and navigation-smoke-tested, not exhaustively exercised.
- The process identity depends on consistent Process Name and Department data. Spelling differences beyond case/spacing remain distinct; unrelated processes with identical names within one department cannot be distinguished without a canonical process identifier.
- No new sorting, charts or broad redesign were added.

Firestore configuration, collections, rules, record IDs, field names, date normalization, import/export implementation, attachments, backup/restore and unrelated modules were not changed.

---

## Source: PROCESS-COUNT-VERIFICATION.md

## Process counter correction

### Cause and correction
The counter used a combination of Process Name and Department (`processOwner`). A process reviewed across different departments was counted repeatedly, while the dashboard timeline grouped by Process Name. The shared counter now counts normalized Process Names only (case-insensitive, collapsed whitespace), excluding blank/N/A placeholders. Records and Dashboard use the same corrected helper. No stored records are changed.

### Files to replace in GitHub
- `records-filters.js`: corrected `processKey`; `countReviewedProcesses` uses this identity.
- `app.js`: updated the helper import cache version.
- `index.html`: updated the application cache version.

These three files are the only runtime changes relative to the process-search download. The full ZIP includes the existing application, updated maintenance notes, the revised unit test, and a new browser test.

### Executed verification
- Automated unit tests: 39 passed, 0 failed in each of UTC, America/Los_Angeles and Pacific/Auckland (117 executions). Includes an explicit 114-review-entry / 17-process regression, different departments, name normalization, month filters, date parsing and import merge safety.
- Local actual-app browser integration: passed in those three time zones. Request interception served the actual HTML and JavaScript, replacing Firebase with an isolated in-memory mock.
- Dashboard counter displayed 17 for 114 review entries across 17 names and 114 different departments; the timeline displayed 17 rows. September and October each counted 17. Selecting one department counted 1.
- Records counter displayed 17 while all 114 review entries remained present; no-match filtering displayed 0; Clear restored 17.
- All seeded records, attachments and creation timestamps remained identical. Zero mock writes, zero live Firebase requests, and zero JavaScript or console errors.
- Inspected the dashboard screenshot showing the 17 counter and 17 timeline rows.

### Not executed
No deployed GitHub Pages or live Firebase verification was performed. The supplied screenshot was not a data export, so the actual production dataset was not read; the 114/17 regression uses controlled test data. Nothing was published or written to production.

Upload the three runtime files together to your existing repository, then reload the GitHub Pages page after deployment. Other modules and their files are unchanged.

---

## Source: PROCESS-SEARCH-VERIFICATION.md

## Process Name Dropdown Search — Verification

Date: 2026-10-20 (UTC)

### What was added

The Process Name filter dropdown on the Review → Records tab now has a
type-to-search box. You can type any part of a process name and the checkbox
list instantly narrows to the matches — no more scrolling through the full
list. The same search box also appears in the Dashboard filter dropdowns
(Process, Department, etc.) because they share the same widget.

Behaviour:
- Case-insensitive "contains" matching, live as you type.
- The box keeps focus while you type, so you can keep typing or refine.
- "Select all" only selects the currently visible (searched) matches;
  "Clear" still clears everything.
- If nothing matches, the panel shows "No matches".
- Reopening the dropdown starts a fresh, empty search.
- Single-option dropdowns do not get a search box.

### Files changed (vs New-Assurance-App-V2-dashboard-month.zip)

- `app.js` — search box added inside the shared multi-select widget
  (`initMultiSelect`); no data, import, filter or export logic touched.
- `index.html` — search box styles + cache buster `app.js?v=20261020-process-search`.
- `tests/process-search-browser.py` — new automated browser test (new file).
- `tests/records-month-browser.py` — test-harness only: scoped the
  `.reviewed-processes` selector to `#records` (the previous session's fix
  that had not been included in the last zip). No app behaviour involved.

Everything else is byte-for-byte identical to the previous version.

### Verification performed

#### 1. Local integration tests (real app code, mocked Firebase, no production data)

Automated browser test `tests/process-search-browser.py`, executed in the
UTC, America/Los_Angeles and Pacific/Auckland time zones — PASS in all three:

- Search box appears and starts empty; typing "care" narrows to
  "Care-Clinic Branch" only.
- Case-insensitive: "BLOOD" matches "Blood Bank El-Khair".
- Focus stays in the search box while the panel re-renders.
- Selecting a found option applies the filter (Records table shows only that
  process; Reviewed Processes counter updates). The panel closes after a
  checkbox click — this is the pre-existing behaviour, unchanged.
- Reopening resets the search and shows all options.
- "zzz" shows "No matches"; a new search recovers matches.
- "Select all" with an active search selects only the visible matches.
- "Clear" clears all selections.
- Dashboard Process filter dropdown has the same working search.
- No JavaScript console/page errors; zero writes to records.

#### 2. Existing unit tests

All 42 unit tests pass (records-filters 11, dashboard-filters 5,
import-dates 18, import-merge 8).

#### 3. Records regression

`tests/records-month-browser.py` re-run in America/Los_Angeles and
Pacific/Auckland (desktop + mobile): month boundaries, all filters AND,
distinct counter, import/update/export roundtrip, invalid-date blocking,
backup/restore, module navigation — all passed, no console errors, zero
live Firebase requests.

#### 4. Visual check

Screenshots confirmed the search box renders inside the dropdown panel and
the filtered result list is correct.

### Not tested

- The deployed GitHub Pages site (push the files first; hard-refresh with
  Ctrl+F5 so the new cache buster loads).
- The live Firebase database (all testing used an in-memory mock; no
  production record was read or written).

### Remaining notes

- The Review Form's "Process Name" field already accepts typing (it is a
  text input with suggestions), so it was not changed.
- The panel still closes after clicking a checkbox, exactly as before —
  selecting several processes means reopening the dropdown (search restarts
  empty each time).

