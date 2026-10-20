/* Read-only Records and Dashboard helpers. Calendar strings never pass through Date. */
import { parseDateCell } from "./import-dates.js";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function reviewMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return parseDateCell(value).status === "ok" ? value.slice(0, 7) : "";
}

export function monthLabel(month) {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1]} ${year}`;
}

export function availableReviewMonths(records) {
  return [...new Set(records.map(r => reviewMonth(r.auditDate)).filter(Boolean))]
    .sort().reverse();
}

const identityPart = value => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return ["", "n/a", "na", "-", "—"].includes(text) ? "" : text;
};

// A process is identified by its name, not its department, review or step.
export function processKey(record) {
  return identityPart(record.processName);
}

export function countReviewedProcesses(records) {
  return new Set(records.map(processKey).filter(Boolean)).size;
}

export function filterReviewRecords(records, filters = {}) {
  const match = (value, term) => !term || String(value || "").toLowerCase()
    .includes(String(term).trim().toLowerCase());
  return records.filter(r =>
    match(r.auditId, filters.auditId) &&
    match(r.userName, filters.user) &&
    (!filters.processes?.length || filters.processes.includes(r.processName)) &&
    match(r.processPhase, filters.phase) &&
    match(r.processOwner, filters.department) &&
    (!filters.month || reviewMonth(r.auditDate) === filters.month)
  );
}

export function filterDashboardRecords(records, filters = {}) {
  const fields = { dept: "processOwner", actionOwners: "department", processes: "processName",
    owners: "processPreparedBy", compliance: "compliance", riskLevels: "riskLevel", mitigation: "mitigation" };
  const q = String(filters.search || "").toLowerCase().trim();
  return filterReviewRecords(records, { month: filters.month }).filter(record => {
    for (const [key, field] of Object.entries(fields)) {
      if (filters[key]?.length && !filters[key].includes(record[field])) return false;
    }
    return !q || Object.values(record).some(value => value && typeof value !== "object" &&
      String(value).toLowerCase().includes(q));
  });
}