# Application maintenance
- Keep Records view filtering and distinct-process aggregation in a pure browser-safe helper module consumed by the existing renderer; this gives the table and KPI a single filtering path without altering persisted records.
- Keep date validation delegated to import-dates.js and use calendar-string month keys; this avoids timezone shifts and duplicate normalization rules.
- Exercise browser integration with request-intercepted Firebase mocks only; this prevents local verification from touching production data.