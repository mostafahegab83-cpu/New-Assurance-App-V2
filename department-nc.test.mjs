import { test } from "node:test";
import assert from "node:assert/strict";
import { responsibleDept, isInterdepartmental, scopeRecords, departmentStats, handoffMatrix,
  handoffSummary, matchesDeptFilter, DEPT_COMPLIANCE_THRESHOLD } from "./department-nc.js";
import { countReviewedProcesses, filterDashboardRecords } from "./records-filters.js";

const r = (processOwner, department, compliance, extra = {}) =>
  ({ processName: "Billing", processOwner, department, compliance, ...extra });

test("NC goes to ncResponsibleDept, falls back to department, never processOwner", () => {
  assert.equal(responsibleDept(r("Finance", "IT", "Non-Compliant", { ncResponsibleDept: "HR" })), "HR");
  assert.equal(responsibleDept(r("Finance", "IT", "Non-Compliant", { ncResponsibleDept: " " })), "IT");
  assert.equal(responsibleDept(r("Finance", "", "Non-Compliant")), "");
});

test("interdepartmental compares department vs processOwner, trimmed and case-insensitive", () => {
  assert.equal(isInterdepartmental(r(" finance ", "FINANCE", "Compliant")), false);
  assert.equal(isInterdepartmental(r("Finance", "IT", "Compliant")), true);
  const rows = [r("Finance", "finance", "Compliant"), r("Finance", "IT", "Compliant")];
  assert.equal(scopeRecords(rows, "internal").length, 1);
  assert.equal(scopeRecords(rows, "inter").length, 1);
  assert.equal(scopeRecords(rows, "all").length, 2);
});

test("NC includes Observation; compliance % = Compliant / (Compliant + NC + Observation)", () => {
  const rows = [r("F", "IT", "Compliant"), r("F", "IT", "Compliant"), r("F", "IT", "Non-Compliant"), r("F", "IT", "Observation"), r("F", "IT", "N/A")];
  const [it] = departmentStats(rows);
  assert.equal(it.ncs, 2);
  assert.equal(it.compliancePct, 50);
  assert.equal(DEPT_COMPLIANCE_THRESHOLD, 90);
});

test("heatmap counts NCs per owning x responsible department", () => {
  const m = handoffMatrix([r("Finance", "IT", "Non-Compliant"), r("Finance", "IT", "Observation"), r("Finance", "Finance", "Non-Compliant"), r("HR", "IT", "Compliant")]);
  assert.deepEqual(m.owners, ["Finance"]);
  assert.deepEqual(m.responsible, ["Finance", "IT"]);
  assert.deepEqual(m.counts, [[1, 2]]);
});

test("summary line names top responsible department, share and main sender", () => {
  const s = handoffSummary([r("Finance", "IT", "Non-Compliant"), r("Sales", "IT", "Non-Compliant"), r("Finance", "IT", "Observation"), r("HR", "HR", "Non-Compliant")]);
  assert.deepEqual(s, { department: "IT", ncs: 3, share: 75, fromDepartment: "Finance" });
  assert.equal(handoffSummary([r("F", "IT", "Compliant")]), null);
});

test("department chip and pair filter", () => {
  const x = r("Finance", "IT", "Non-Compliant", { ncResponsibleDept: "HR" });
  assert.equal(matchesDeptFilter(x, { responsible: "hr" }), true);
  assert.equal(matchesDeptFilter(x, { responsible: "Finance" }), false);
  assert.equal(matchesDeptFilter(x, { responsible: "HR", owner: "finance" }), true);
});

test("17 processes / 114 entries stays 17 across department filters and scopes", () => {
  const depts = ["Finance", "IT", "HR"];
  const rows = Array.from({ length: 114 }, (_, i) => ({
    processName: `Process ${i % 17}`, processOwner: depts[i % 3], department: depts[(i * 7) % 3],
    compliance: i % 5 ? "Compliant" : "Non-Compliant", auditDate: "2026-09-01"
  }));
  const data = filterDashboardRecords(rows, {});
  assert.equal(data.length, 114);
  assert.equal(countReviewedProcesses(data), 17);
  const total = departmentStats(data).reduce((s, d) => s + d.steps, 0);
  assert.equal(total, 114);
  const it = filterDashboardRecords(rows, { responsibleDept: "IT" });
  assert.ok(it.every(x => x.department === "IT"));
});
