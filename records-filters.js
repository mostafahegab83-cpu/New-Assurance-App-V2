/* Read-only Records view helpers. Calendar strings never pass through Date. */
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

// Review records have no process ID: processName + processOwner (Department)
// identifies the process, independently of Review ID, phase or step number.
export function processKey(record) {
  const name = identityPart(record.processName);
  return name ? JSON.stringify([name, identityPart(record.processOwner)]) : "";
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