# Process counter correction

## Cause and correction
The counter used a combination of Process Name and Department (`processOwner`). A process reviewed across different departments was counted repeatedly, while the dashboard timeline grouped by Process Name. The shared counter now counts normalized Process Names only (case-insensitive, collapsed whitespace), excluding blank/N/A placeholders. Records and Dashboard use the same corrected helper. No stored records are changed.

## Files to replace in GitHub
- `records-filters.js`: corrected `processKey`; `countReviewedProcesses` uses this identity.
- `app.js`: updated the helper import cache version.
- `index.html`: updated the application cache version.

These three files are the only runtime changes relative to the process-search download. The full ZIP includes the existing application, updated maintenance notes, the revised unit test, and a new browser test.

## Executed verification
- Automated unit tests: 39 passed, 0 failed in each of UTC, America/Los_Angeles and Pacific/Auckland (117 executions). Includes an explicit 114-review-entry / 17-process regression, different departments, name normalization, month filters, date parsing and import merge safety.
- Local actual-app browser integration: passed in those three time zones. Request interception served the actual HTML and JavaScript, replacing Firebase with an isolated in-memory mock.
- Dashboard counter displayed 17 for 114 review entries across 17 names and 114 different departments; the timeline displayed 17 rows. September and October each counted 17. Selecting one department counted 1.
- Records counter displayed 17 while all 114 review entries remained present; no-match filtering displayed 0; Clear restored 17.
- All seeded records, attachments and creation timestamps remained identical. Zero mock writes, zero live Firebase requests, and zero JavaScript or console errors.
- Inspected the dashboard screenshot showing the 17 counter and 17 timeline rows.

## Not executed
No deployed GitHub Pages or live Firebase verification was performed. The supplied screenshot was not a data export, so the actual production dataset was not read; the 114/17 regression uses controlled test data. Nothing was published or written to production.

Upload the three runtime files together to your existing repository, then reload the GitHub Pages page after deployment. Other modules and their files are unchanged.