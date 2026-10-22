# Review Month + Reviewed Processes

## Upload to GitHub
This is the complete updated application, based on the previous import-safety download. Nothing was published from Lovable.

Replace these three existing files: `app.js`, `index.html`, `styles.css`.
Add `records-filters.js` beside `app.js`. It is required at runtime; do not omit it.
All other existing application files are byte-for-byte unchanged from the import-safety version.

New supporting files: `tests/records-filters.test.mjs`, `tests/records-month-browser.py`, `AGENTS.md`, `roadmap.md`, and this report.

## Behavior and counting identity
- The dropdown uses valid normalized `auditDate` strings, newest first. Months are compared as calendar `YYYY-MM` strings without timezone conversion.
- All Months includes records with unknown/invalid dates; selecting a month excludes those records.
- `processName` + `processOwner` (the existing Department field) identifies a distinct process. There is no process ID in the Review record schema. Case and repeated spaces are ignored for identity. Review IDs, phases and steps do not split one process into multiple processes. Missing/N/A process names do not create a fabricated process count; missing departments form an unknown-department group for a known process name.
- The counter uses exactly the table's filtered rows, including all existing filters with AND logic.
- The existing snapshot listener refreshes both controls after imports, adds, edits, deletes and restores. No additional data store or subscription was introduced.
- Clear Filters resets everything. If the last record in an actively selected month is moved/deleted, that month stays selected and shows zero until cleared, rather than silently expanding to All Months.
- CSV export scope is deliberately unchanged: the existing exporter does not apply every Records filter. Review Month changes the table and counter, not the export's existing scope.

## Changed functions
`app.js`: only the Records view helper import and `renderRecords()` were changed.
`records-filters.js`: `reviewMonth`, `monthLabel`, `availableReviewMonths`, `processKey`, `countReviewedProcesses`, `filterReviewRecords`.
`index.html`: new month dropdown, clipboard-check counter and app script cache version.
`styles.css`: scoped styles for the two new controls, using existing color tokens.

## Executed automated unit tests
Command: `TZ=<timezone> node --test tests/*.test.mjs`.

| Timezone | Passed | Failed |
| --- | ---: | ---: |
| UTC | 34 | 0 |
| America/Los_Angeles | 34 | 0 |
| Pacific/Auckland | 34 | 0 |

The 34 tests comprise 17 existing date tests, 7 existing import-safety tests, and 10 new Records tests. Each of the three complete runs executed: 102 test executions total.
`node --check app.js` also passed.

## Executed local browser integration
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

## Not executed / remaining limitations
- No deployed GitHub Pages test; no deployed URL was supplied or changed.
- No live Firebase integration or security-rules test. Production was never touched.
- Other modules were unchanged and navigation-smoke-tested, not exhaustively exercised.
- The process identity depends on consistent Process Name and Department data. Spelling differences beyond case/spacing remain distinct; unrelated processes with identical names within one department cannot be distinguished without a canonical process identifier.
- No new sorting, charts or broad redesign were added.

Firestore configuration, collections, rules, record IDs, field names, date normalization, import/export implementation, attachments, backup/restore and unrelated modules were not changed.