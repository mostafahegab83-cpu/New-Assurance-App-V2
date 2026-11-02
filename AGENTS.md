# Application maintenance
- Keep Records and Dashboard filtering and distinct-process aggregation in the records-filters section of app.js consumed by their existing renderers; each view's count and content share one filtered dataset without altering persisted records.
- Derive process identity centrally from the normalized processName only; department belongs to filtering, not identity, so repeated review steps do not inflate either counter.
- Keep date validation delegated to the import-dates section of app.js and use calendar-string month keys; this avoids timezone shifts and duplicate normalization rules.
- Exercise browser integration with request-intercepted Firebase mocks only; this prevents local verification from touching production data.