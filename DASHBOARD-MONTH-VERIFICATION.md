# Dashboard Review Month update

## Upload files
Replace app.js, index.html and records-filters.js in the GitHub repository together.
No styles.css changes are needed for this update; it reuses the Records filter styling.
The full ZIP includes all existing files, including the prior Records and import fixes.

## Behavior
Dashboard has its own Review Month dropdown and Reviewed Processes counter, shared by Findings and Risk views. Month selection uses valid normalized auditDate calendar strings, not creation/import dates or IDs. All Months retains unknown dates. Month choices are newest first. Existing dashboard filters combine with month using AND. Clear resets month. Repeated process steps count once per normalized processName + processOwner pair. Counter, existing charts, KPIs, schedule table and findings calculations use the same filtered records. Snapshot refreshes update choices and counts. An active month remains selected with zero results when its last record is moved/deleted. Records and Dashboard selections remain independent.

## Exact verification executed
- Automated: 38/38 Node unit tests passed in UTC, America/Los_Angeles and Pacific/Auckland (114 passing executions). Includes four new dashboard rule tests. app.js syntax check passed.
- Local actual-app Dashboard integration, isolated Firebase mock: passed in Los Angeles and Auckland. Verified September 30 versus October 1; missing/invalid dates excluded from selected months; newest-first options; distinct counter; All Months; Department/search AND; empty results; Clear; Findings compliance KPIs/chart; Risk KPIs/chart; schedule table; snapshot update/add/remove; no record mutation or writes; no console JavaScript errors. Inspected screenshots of both dashboard filter rows.
- Local Records regression using actual CSV parser and mocked Firebase: passed in Los Angeles and Auckland. New/update import, IDs/no duplicates, three Action Owner values, export/reimport, invalid-date save blocking, attachments/creation timestamps, edit/add/delete, backup/restore, NC/Risk date input and existing module navigation. Records mobile filter/counter/clear check passed.
- No live Firebase requests occurred. No production data was accessed or changed.
- Deployed GitHub Pages and real Firebase: NOT tested. PDF generation was not exercised; the existing export calculations call the shared filtered-data path, but the new toolbar counter is not added to PDF captures.

## Changes relative to New-Assurance-App-V2-review-month.zip
Application: app.js, index.html, records-filters.js.
Tests: new tests/dashboard-filters.test.mjs.
Notes: updated AGENTS.md and roadmap.md; new DASHBOARD-MONTH-VERIFICATION.md.
All other existing files are byte-for-byte unchanged.
