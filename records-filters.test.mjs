import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewMonth, monthLabel, availableReviewMonths, filterReviewRecords, countReviewedProcesses } from "../records-filters.js";

const row = (id, auditDate, processName = "Billing", processOwner = "Finance", extra = {}) =>
  ({ id, auditDate, processName, processOwner, auditId: id, userName: "Reviewer", processPhase: "Prepare", ...extra });
const rows = [row("a", "2026-09-20"), row("b", "2026-09-30"), row("c", "2026-10-01"),
  row("d", "2026-09-01", "Hiring", "HR"), row("e", "N/A", "Legacy"), row("f", "2026-02-30", "Invalid")];

test("September uses auditDate, includes Sep 30 and excludes Oct 1", () => {
  assert.deepEqual(filterReviewRecords(rows, { month: "2026-09" }).map(r => r.id), ["a", "b", "d"]);
  assert.equal(reviewMonth("2026-09-20"), "2026-09");
});
test("missing, invalid and non-normalized dates never get a month", () => {
  for (const value of [null, undefined, "", "N/A", "2026-02-30", "2026-09-31", "20/09/2026", "2026-9-20", "2026-09-20T00:00:00Z"])
    assert.equal(reviewMonth(value), "");
  assert.equal(reviewMonth("2024-02-29"), "2024-02");
});
test("month options are available audit months newest first", () => {
  assert.deepEqual(availableReviewMonths([...rows, row("g", "2025-12-31", "Other", "HR", { createdAt: "2027-06-01", importedAt: "2028-07-01", auditId: "R-20291001-01" })]), ["2026-10", "2026-09", "2025-12"]);
  assert.equal(monthLabel("2026-09"), "September 2026");
});
test("All Months restores all matching rows including unknown dates", () => {
  assert.deepEqual(filterReviewRecords(rows, { month: "" }), rows);
  assert.equal(filterReviewRecords(rows, { month: "", department: "Finance" }).length, 5);
});
test("distinct process count ignores steps, phase and review IDs", () => {
  const steps = [row("a", "2026-09-01"), row("b", "2026-09-02", " billing ", " FINANCE ", { stepNumber: "2", processPhase: "End" }), row("c", "2026-09-03", "Billing", "HR")];
  assert.equal(countReviewedProcesses(steps), 2);
  assert.equal(countReviewedProcesses([{ processName: "N/A" }, { processName: "" }]), 0);
});
test("same process counts once in each month", () => {
  assert.equal(countReviewedProcesses(filterReviewRecords(rows, { month: "2026-09" })), 2);
  assert.equal(countReviewedProcesses(filterReviewRecords(rows, { month: "2026-10" })), 1);
  assert.equal(countReviewedProcesses(filterReviewRecords(rows)), 4);
});
test("Department and Process Name filters apply AND to table and count", () => {
  const filtered = filterReviewRecords(rows, { month: "2026-09", department: "finance", processes: ["Billing"] });
  assert.deepEqual(filtered.map(r => r.id), ["a", "b"]);
  assert.equal(countReviewedProcesses(filtered), 1);
  assert.equal(countReviewedProcesses(filterReviewRecords(rows, { month: "2026-09", department: "HR", processes: ["Billing"] })), 0);
});
test("Review ID, user and phase retain their existing substring matching", () => {
  assert.deepEqual(filterReviewRecords(rows, { auditId: "A", user: "VIEW", phase: "prep", month: "2026-09" }).map(r => r.id), ["a"]);
});
test("empty result and empty collection show zero", () => {
  assert.equal(countReviewedProcesses(filterReviewRecords(rows, { month: "2025-01" })), 0);
  assert.deepEqual(availableReviewMonths([]), []);
  assert.equal(countReviewedProcesses([]), 0);
});
test("filtering and counting do not mutate records, attachments or timestamps", () => {
  const input = [row("a", "2026-09-20", "Billing", "Finance", { createdAt: "original", attachments: [{ name: "evidence.pdf" }] })];
  const before = structuredClone(input);
  countReviewedProcesses(filterReviewRecords(input, { month: "2026-09" })); availableReviewMonths(input);
  assert.deepEqual(input, before);
});