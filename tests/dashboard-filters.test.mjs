import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDashboardRecords, countReviewedProcesses } from "../records-filters.js";

const rows = [
  { id: "a", auditDate: "2026-09-30", processName: "Billing", processOwner: "Finance", processPreparedBy: "Alice", department: "Team A", compliance: "Non-Compliant", riskLevel: "High", mitigation: "Open", stepNumber: "1" },
  { id: "b", auditDate: "2026-09-01", processName: "Billing", processOwner: "Finance", compliance: "Compliant", stepNumber: "2" },
  { id: "c", auditDate: "2026-10-01", processName: "Hiring", processOwner: "HR" },
  { id: "d", auditDate: "N/A", processName: "Legacy" },
  { id: "e", auditDate: "2026-09-31", processName: "Invalid", createdAt: "2026-09-01", auditId: "R-20260901-01" }
];
test("Dashboard month uses only valid Review Date and counts repeated steps once", () => {
  const filtered = filterDashboardRecords(rows, { month: "2026-09" });
  assert.deepEqual(filtered.map(r => r.id), ["a", "b"]);
  assert.equal(countReviewedProcesses(filtered), 1);
  assert.deepEqual(filterDashboardRecords(rows, { month: "2026-10" }).map(r => r.id), ["c"]);
});
test("Dashboard All Months retains records with missing and invalid dates", () => {
  assert.deepEqual(filterDashboardRecords(rows, { month: "" }), rows);
  assert.equal(countReviewedProcesses(filterDashboardRecords(rows)), 4);
});
test("Dashboard month combines with every existing filter using AND", () => {
  const filters = { month: "2026-09", dept: ["Finance"], actionOwners: ["Team A"], processes: ["Billing"], owners: ["Alice"], compliance: ["Non-Compliant"], riskLevels: ["High"], mitigation: ["Open"], search: "BILL" };
  assert.deepEqual(filterDashboardRecords(rows, filters).map(r => r.id), ["a"]);
  for (const key of ["dept", "actionOwners", "processes", "owners", "compliance", "riskLevels", "mitigation"])
    assert.equal(filterDashboardRecords(rows, { ...filters, [key]: ["no match"] }).length, 0);
  assert.equal(countReviewedProcesses(filterDashboardRecords(rows, { ...filters, search: "no match" })), 0);
});
test("Dashboard refresh follows read-only changed record data", () => {
  const before = structuredClone(rows);
  const updated = rows.map(r => r.id === "c" ? { ...r, auditDate: "2026-09-15" } : r);
  assert.equal(countReviewedProcesses(filterDashboardRecords(updated, { month: "2026-09" })), 2);
  assert.equal(countReviewedProcesses(filterDashboardRecords(updated.filter(r => r.id !== "c"), { month: "2026-09" })), 1);
  assert.deepEqual(rows, before);
});