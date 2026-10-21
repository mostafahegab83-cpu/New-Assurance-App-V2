/* Non-Compliance by Department: pure, browser-safe helpers. Never mutates records. */

// Compliance % below this value gets a red badge in the department table.
export const DEPT_COMPLIANCE_THRESHOLD = 90;

export const DEPT_SCOPES = { all: "All steps", internal: "Internal only", inter: "Interdepartmental only" };

const EMPTY = new Set(["", "n/a", "na", "-", "—"]);
const clean = value => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return EMPTY.has(text.toLowerCase()) ? "" : text;
};
export const deptKey = value => clean(value).toLowerCase();

export const owningDept = record => clean(record.processOwner);
export const performingDept = record => clean(record.department);
// NCs are attributed to the responsible department, never to the process owner.
export const responsibleDept = record => clean(record.ncResponsibleDept) || clean(record.department);

export function isInterdepartmental(record) {
  const performer = deptKey(record.department), owner = deptKey(record.processOwner);
  return !!performer && !!owner && performer !== owner;
}

export const isNc = record => record.compliance === "Non-Compliant" || record.compliance === "Observation";
const isAssessed = record => ["Compliant", "Non-Compliant", "Observation"].includes(record.compliance);

export function scopeRecords(records, scope = "all") {
  if (scope === "internal") return records.filter(r => !isInterdepartmental(r));
  if (scope === "inter") return records.filter(isInterdepartmental);
  return records;
}

// Department chip / heatmap pair filter (case-insensitive, trimmed).
export function matchesDeptFilter(record, { responsible = "", owner = "" } = {}) {
  if (responsible && deptKey(responsibleDept(record)) !== deptKey(responsible)) return false;
  if (owner && deptKey(owningDept(record)) !== deptKey(owner)) return false;
  return true;
}

export const compliancePct = (compliant, base) => base ? Math.round(compliant / base * 100) : null;

const topOf = counts => {
  let best = "", n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
};
const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);

export function departmentStats(records) {
  const groups = new Map();
  for (const r of records) {
    const name = responsibleDept(r);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { department: name, steps: 0, nc: 0, observation: 0, compliant: 0,
      base: 0, slaBreaches: 0, openCapas: 0, reasons: new Map(), processes: new Map() });
    const g = groups.get(key);
    g.steps++;
    if (isAssessed(r)) g.base++;
    if (r.compliance === "Compliant") g.compliant++;
    if (r.compliance === "Non-Compliant") g.nc++;
    if (r.compliance === "Observation") g.observation++;
    const target = parseFloat(r.targetSla), actual = parseFloat(r.actualSla);
    if (!isNaN(target) && !isNaN(actual) && actual > target) g.slaBreaches++;
    if (r.capaNeeded === "Yes" && !["Closed", "Cancelled"].includes(r.capaStatus)) g.openCapas++;
    if (isNc(r)) {
      const reason = clean(r.complianceReason) || clean(r.complianceReasonCategory);
      if (reason) bump(g.reasons, reason);
      const proc = clean(r.processName);
      if (proc) bump(g.processes, proc);
    }
  }
  return [...groups.values()].map(g => ({
    department: g.department, steps: g.steps, nc: g.nc, observation: g.observation,
    ncs: g.nc + g.observation, compliancePct: compliancePct(g.compliant, g.base),
    slaBreaches: g.slaBreaches, openCapas: g.openCapas,
    topReason: topOf(g.reasons), worstProcess: topOf(g.processes)
  })).sort((a, b) => b.ncs - a.ncs || a.department.localeCompare(b.department));
}

// rows = owning department, columns = responsible department, cell = NC count.
export function handoffMatrix(records) {
  const owners = new Map(), resps = new Map(), cells = new Map();
  for (const r of records) {
    if (!isNc(r)) continue;
    const owner = owningDept(r), resp = responsibleDept(r);
    if (!owner || !resp) continue;
    const ok = owner.toLowerCase(), rk = resp.toLowerCase();
    if (!owners.has(ok)) owners.set(ok, owner);
    if (!resps.has(rk)) resps.set(rk, resp);
    bump(cells, ok + "\u0001" + rk);
  }
  const sortNames = m => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = sortNames(owners), cols = sortNames(resps);
  return {
    owners: rows.map(([, v]) => v),
    responsible: cols.map(([, v]) => v),
    counts: rows.map(([ok]) => cols.map(([rk]) => cells.get(ok + "\u0001" + rk) || 0)),
    max: Math.max(0, ...cells.values())
  };
}

// One auto-generated Summary line about the top responsible department.
export function handoffSummary(records) {
  const ncRows = records.filter(isNc);
  if (!ncRows.length) return null;
  const top = departmentStats(ncRows)[0];
  if (!top) return null;
  const topKey = deptKey(top.department);
  const share = Math.round(top.ncs / ncRows.length * 100);
  const senders = new Map(), names = new Map();
  for (const r of ncRows) {
    if (deptKey(responsibleDept(r)) !== topKey) continue;
    const owner = owningDept(r);
    if (!owner || deptKey(owner) === topKey) continue;
    names.set(owner.toLowerCase(), owner);
    bump(senders, owner.toLowerCase());
  }
  const senderKey = topOf(senders);
  return { department: top.department, ncs: top.ncs, share, fromDepartment: senderKey ? names.get(senderKey) : "" };
}
