// plan-progress.js — Gap Analysis Roadmap: "Plan Progress" (data entry, login only)
// and "Progress Dashboard" (public, view-only).
// Firestore collections:
//   planProgress  — one document per roadmap action (public read, signed-in write)
//   planSettings  — doc "main": { projectStart: "YYYY-MM-DD" } (Week 1 start date)
//   planAttachments — file metadata (signed-in only; files live in Storage "planAttachments/…")
// Each action holds its own sub-actions in the array field "subs".
// The 24 seed actions come from slides 6 & 7 of the Gap Analysis Roadmap presentation.
import { db, auth, storage, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp, onAuthStateChanged, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "./firebase.js";

try {

/* =====================================================================
   Constants
   ===================================================================== */
const COL = "planProgress";
const COL_SET = "planSettings";
const COL_ATT = "planAttachments";
const ATT_EXT = ["msg", "eml", "pdf", "doc", "docx", "xls", "xlsx"];
const ATT_MAX = 10 * 1024 * 1024;
const SET_DOC = "main";

const PHASES = ["Define", "Measure", "Analysis", "Improvement", "Control"];
const PHASE_COLOR = { Define: "#0ea5e9", Measure: "#2563eb", Analysis: "#7c3aed", Improvement: "#0d9488", Control: "#475569" };
const STATUSES = ["Not Started", "In Progress", "Completed", "On Hold", "No Reply", "Escalated"];
const HEALTHS = ["Completed", "On track", "At risk", "Delayed", "Escalated", "No reply", "Not started", "On hold", "Unscheduled"];
const HEALTH_STYLE = {
  "Completed":   { bg: "#dcfce7", fg: "#166534", icon: "✓" },
  "On track":    { bg: "#dbeafe", fg: "#1e40af", icon: "▶" },
  "At risk":     { bg: "#fef3c7", fg: "#92400e", icon: "⚠" },
  "Delayed":     { bg: "#fee2e2", fg: "#991b1b", icon: "!" },
  "Not started": { bg: "#f1f5f9", fg: "#475569", icon: "○" },
  "On hold":     { bg: "#ede9fe", fg: "#5b21b6", icon: "⏸" },
  "Escalated":   { bg: "#ffe4e6", fg: "#9f1239", icon: "↑" },
  "No reply":    { bg: "#ffedd5", fg: "#9a3412", icon: "✉" },
  "Unscheduled": { bg: "#f1f5f9", fg: "#64748b", icon: "◌" },
};
const MILESTONES = ["1st Main Milestone", "2nd Main Milestone", "Main Deliverable"];

// [phase, action, responsible, startWeek, dueWeek, expected result, milestone]
const SEED = [
  ["Define", "Prepare processes' lists for each department (IDH, MK, AB and BS)", "PEX / PA – DC", "1", "4", "Current processes list", ""],
  ["Define", "Send lists for department heads to validate the needed processes", "PEX", "4", "5", "Updated processes list / Required processes list", ""],
  ["Define", "Select SPOC from each (list) department to formulate the team", "PEX / Dept. Heads", "5", "6", "SPOCs names list", ""],
  ["Measure", "Conduct kick-off meeting with SPOCs", "PEX / PA – SPOCs", "7", "8", "Validated processes list", ""],
  ["Measure", "Set and agree on the critical few for each department", "PEX / PA – SPOCs", "8", "9", "Critical processes (Initial KPIs) / (5–10 process for each dept.)", ""],
  ["Measure", "Obtain approval from department heads (review / update / approve)", "PEX / Dept. Heads", "10", "12", "Approved processes list / (management alignment)", ""],
  ["Measure", "Determine ownership for critical processes", "PEX / SPOCs", "12", "13", "Processes' owners list", ""],
  ["Measure", "Capture baseline KPIs (cycle time, defects, SLA)", "PA - SPOCs", "14", "24", "Baseline performance", "1st Main Milestone"],
  ["Measure", "Develop AS-IS process maps", "PEX - SPOCs", "14", "24", "As-Is process maps", "1st Main Milestone"],
  ["Analysis", "Data analysis for discovered issues in processes (implement Pareto)", "PEX", "24", "26", "Data analysis", ""],
  ["Analysis", "Identify bottlenecks (delays, SLAs, redundant approval, decision points)", "PEX", "27", "28", "Bottlenecks / (Refine KPIs for processes)", ""],
  ["Analysis", "Validate causes", "PEX / SPOCs", "29", "30", "Root Causes (RCA) / Confirmed causes list", ""],
  ["Analysis", "Define KPIs for processes", "PA / SPOCs", "31", "32", "Key Performance Indicators / (Final KPIs)", ""],
  ["Improvement", "Brainstorm solutions (workshops with department SPOCs)", "PEX – PA / SPOCs", "33", "36", "Solutions / ideas list", ""],
  ["Improvement", "Prioritize solutions / (evaluate applicability for solutions and ideas)", "PEX – PA", "37", "40", "Priority solutions", "2nd Main Milestone"],
  ["Improvement", "Process reengineering (design To-Be workflows)", "PEX", "41", "TBD", "Draft updated workflows / (To-Be processes)", ""],
  ["Improvement", "Pilot implementation (limited scope for testing and evaluation)", "PEX – PA / SPOCs", "TBD", "TBD", "Pilot results", ""],
  ["Improvement", "Approval of improved processes (to start full implementation)", "PEX – DC / Dept. Heads", "TBD", "TBD", "Management Approval", ""],
  ["Improvement", "Full-scope implementation", "PEX – PA / Dept. Heads", "TBD", "TBD", "Reduction in cycle time / SLA improvement", ""],
  ["Control", "Develop processes and procedures (documentation and DC)", "PEX", "TBD", "TBD", "Policies, Processes and SOPs", ""],
  ["Control", "Training for new workflows and updated processes / KPIs", "PEX – PA / SPOCs – HR", "TBD", "TBD", "Training completed", ""],
  ["Control", "Monitor performance and track approved KPIs / SLAs for each process", "PA", "Ongoing", "Ongoing", "Performance tracking (Monthly)", ""],
  ["Control", "Create dashboards and results / trends analysis (escalate findings)", "PA", "Ongoing", "Ongoing", "Dashboards and findings reporting for management", ""],
  ["Control", "Mature Effective Management System", "TBD", "TBD", "TBD", "IDH ONE HANDBOOK", "Main Deliverable"],
];

/* =====================================================================
   Small helpers
   ===================================================================== */
const DAY = 86400000;
const $ = (s, root = document) => root.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad2 = n => String(n).padStart(2, "0");
const clamp01 = n => Math.max(0, Math.min(1, n));
const clampPct = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const normText = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

// Calendar-string dates only (no timezone shifts): "YYYY-MM-DD" <-> whole days since epoch.
function isoToDays(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const n = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  return daysToISO(n) === s ? n : null;
}
const daysToISO = n => new Date(n * DAY).toISOString().slice(0, 10);
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtDate(iso) {
  const n = isoToDays(iso); if (n === null) return "";
  const d = new Date(n * DAY);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function timeAgo(ms) {
  if (!ms) return "";
  const days = Math.floor((Date.now() - ms) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return fmtDate(daysToISO(Math.floor(ms / DAY)));
}
function tint(hex, a) {   // hex -> rgba (html2canvas-safe, no color-mix)
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// "Week" values: a number, "TBD" or "Ongoing"
function parseWeek(v) {
  const s = String(v ?? "").trim();
  if (!s) return { k: "tbd" };
  const m = /^(?:w(?:ee)?k\.?\s*)?(\d{1,3})$/i.exec(s);
  if (m && +m[1] > 0) return { k: "w", n: +m[1] };
  if (/^ongoing$/i.test(s)) return { k: "ongoing" };
  return { k: "tbd" };
}
function normWeek(v) {   // -> "12" | "TBD" | "Ongoing" | null (invalid)
  const s = String(v ?? "").trim();
  if (!s) return "TBD";
  const p = parseWeek(s);
  if (p.k === "w") return String(p.n);
  if (p.k === "ongoing") return "Ongoing";
  return /^tbd$/i.test(s) ? "TBD" : null;
}
function weekLabel(v) { const p = parseWeek(v); return p.k === "w" ? `Wk ${p.n}` : p.k === "ongoing" ? "Ongoing" : "TBD"; }

// "PEX / PA – DC" -> ["PEX","PA","DC"]
function tokens(resp) {
  return [...new Set(String(resp ?? "").split(/\s*[\/–—,]\s*|\s+-\s+/).map(t => t.trim()).filter(Boolean))];
}

/* =====================================================================
   State
   ===================================================================== */
let rows = [];
let settings = { projectStart: "" };
let loadError = "";
let atts = [];            // attachment metadata (signed-in users only)
let unsubAtt = null;
const charts = {};

const ctx = () => ({ today: todayISO(), start: settings.projectStart });
const canEdit = () => !!window.__session?.user;
const displayId = r => "A" + pad2(r.seq || 0);

function normRow(id, d) {
  const phase = PHASES.includes(d.phase) ? d.phase : "Control";
  const status = STATUSES.includes(d.status) ? d.status : "Not Started";
  return {
    id, seq: Number(d.seq) || 0, phase,
    action: String(d.action ?? ""), responsible: String(d.responsible ?? ""), subDepartment: String(d.subDepartment ?? ""),
    startWeek: normWeek(d.startWeek) ?? "TBD", dueWeek: normWeek(d.dueWeek) ?? "TBD",
    expected: String(d.expected ?? ""), milestone: String(d.milestone ?? ""),
    status, percent: clampPct(d.percent),
    actualStart: isoToDays(d.actualStart) !== null ? d.actualStart : "",
    actualEnd: isoToDays(d.actualEnd) !== null ? d.actualEnd : "",
    note: String(d.note ?? ""), updatedAtMs: Number(d.updatedAtMs) || 0, updatedBy: String(d.updatedBy ?? ""),
    subs: (Array.isArray(d.subs) ? d.subs : []).map(normSub),
  };
}
function normSub(x) {
  return {
    id: String(x?.id || "s" + Math.random().toString(36).slice(2, 9)), title: String(x?.title ?? ""), owner: String(x?.owner ?? ""),
    due: isoToDays(x?.due) !== null ? x.due : "", status: STATUSES.includes(x?.status) ? x.status : "Not Started", note: String(x?.note ?? ""),
  };
}
const newSubId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sortRows = list => list.slice().sort((a, b) =>
  PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.seq - b.seq || a.action.localeCompare(b.action));

/* =====================================================================
   Schedule logic: health of each action, as of today
   ===================================================================== */
function derive(r, c = ctx()) {
  const sw = parseWeek(r.startWeek), dw = parseWeek(r.dueWeek);
  const pct = clampPct(r.percent);
  const S = isoToDays(c.start), T = isoToDays(c.today);
  const wStart = n => S + (n - 1) * 7, wEnd = n => S + n * 7 - 1;
  let startD = null, dueD = null;
  if (S !== null) { if (sw.k === "w") startD = wStart(sw.n); if (dw.k === "w") dueD = wEnd(dw.n); }
  let health, daysLate = 0;
  if (r.status === "Completed") health = "Completed";
  else if (r.status === "On Hold") health = "On hold";
  else if (r.status === "Escalated") health = "Escalated";
  else if (r.status === "No Reply") health = "No reply";
  else if (S === null) health = r.status === "In Progress" ? "On track" : (sw.k === "tbd" ? "Unscheduled" : "Not started");
  else if (r.status === "In Progress") {
    if (dueD !== null && T > dueD) { health = "Delayed"; daysLate = T - dueD; }
    else {
      health = "On track";
      if (startD !== null && dueD !== null) {
        const exp = clamp01((T - startD + 1) / (dueD - startD + 1));
        if (pct / 100 < exp - 0.15) health = "At risk";
      }
    }
  } else {
    if (sw.k === "w") { const e = wEnd(sw.n); if (T > e) { health = "Delayed"; daysLate = T - e; } else health = "Not started"; }
    else health = sw.k === "ongoing" ? "Not started" : "Unscheduled";
  }
  const expected = (startD !== null && dueD !== null) ? clamp01((T - startD + 1) / (dueD - startD + 1)) : null;
  return { sw, dw, pct, health, expected, startD, dueD, daysLate };
}

// Keeps Status, % and actual dates consistent after the user changes one of them.
function applyRules(cur, changed) {
  const t = todayISO();
  let { status, percent, actualStart, actualEnd } = cur;
  percent = clampPct(percent);
  const reopen = () => { status = "In Progress"; percent = 90; actualEnd = ""; };
  if (changed === "status") {
    if (status === "Completed") { percent = 100; actualStart = actualStart || t; actualEnd = actualEnd || t; }
    else if (status === "In Progress") { actualStart = actualStart || t; actualEnd = ""; if (percent >= 100) percent = 90; }
    else if (status === "Not Started") { percent = 0; actualStart = ""; actualEnd = ""; }
  } else if (changed === "percent") {
    if (percent >= 100) { status = "Completed"; percent = 100; actualStart = actualStart || t; actualEnd = actualEnd || t; }
    else if (percent > 0) { if (status === "Not Started" || status === "Completed") status = "In Progress"; actualStart = actualStart || t; actualEnd = ""; }
    else if (status === "In Progress" || status === "Completed") { status = "Not Started"; actualStart = ""; actualEnd = ""; }
  } else if (changed === "actualEnd") {
    if (actualEnd) { status = "Completed"; percent = 100; actualStart = actualStart || actualEnd; }
    else if (status === "Completed") reopen();
  } else if (changed === "actualStart") {
    if (actualStart && status === "Not Started") status = "In Progress";
  }
  return { status, percent, actualStart, actualEnd };
}
// When an action has sub-actions: % = closed / total, and the action closes automatically
// once every sub-action is Completed (and re-opens if one is added or re-opened).
function rollup(r, subs) {
  const total = subs.length; if (!total) return null;
  const done = subs.filter(x => x.status === "Completed").length, t = todayISO();
  let { status, actualStart, actualEnd } = r;
  const percent = Math.round(done / total * 100);
  if (done === total) { status = "Completed"; actualStart = actualStart || t; actualEnd = actualEnd || t; }
  else {
    if (status === "Completed") { status = "In Progress"; actualEnd = ""; }
    if (status === "Not Started" && subs.some(x => x.status !== "Not Started")) { status = "In Progress"; actualStart = actualStart || t; }
  }
  return { status, percent, actualStart, actualEnd };
}
function normalizeImported(r) {   // lighter: never invents dates
  let { status, percent } = r;
  percent = clampPct(percent);
  if (status === "Completed") percent = 100;
  else if (percent >= 100 && (status === "Not Started" || status === "In Progress")) { status = "Completed"; percent = 100; }
  else if (percent > 0 && status === "Not Started") status = "In Progress";
  return { ...r, status, percent };
}

/* =====================================================================
   Filters (multi-select) + text search — shared by both pages
   ===================================================================== */
function selVals(sel) { return sel ? Array.from(sel.selectedOptions).map(o => o.value) : []; }
function fillSelect(sel, values) {
  if (!sel) return;
  const sig = values.join("\u0001");
  if (sel.dataset.opts === sig && sel.dataset.msInit) return;
  const keep = new Set(selVals(sel));
  sel.innerHTML = values.map(v => `<option value="${esc(v)}"${keep.has(v) ? " selected" : ""}>${esc(v)}</option>`).join("");
  sel.dataset.opts = sig;
  window.__initMultiSelect?.(sel);
  sel._msRefresh?.();
}
function respOptions() {
  const seen = [];
  sortRows(rows).forEach(r => tokens(r.responsible).forEach(t => { if (!seen.includes(t)) seen.push(t); }));
  return seen;
}
function subDeptOptions() {
  const v = [...new Set(rows.map(r => r.subDepartment.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return rows.some(r => !r.subDepartment.trim()) ? [...v, "(Blank)"] : v;
}
function populateFilters(prefix) {
  const root = document.getElementById(prefix === "pp" ? "planProgress" : "planDashboard");
  if (!root) return;
  const lists = { phase: PHASES, status: STATUSES, health: HEALTHS, responsible: respOptions(), subDepartment: subDeptOptions() };
  root.querySelectorAll(`[data-${prefix}-filter]`).forEach(sel => fillSelect(sel, lists[sel.dataset[prefix + "Filter"]] || []));
}
function filtered(prefix) {
  const root = document.getElementById(prefix === "pp" ? "planProgress" : "planDashboard");
  const f = {};
  root?.querySelectorAll(`[data-${prefix}-filter]`).forEach(sel => { f[sel.dataset[prefix + "Filter"]] = new Set(selVals(sel)); });
  const terms = normText($(`#${prefix}Search`)?.value).split(",").map(s => s.trim()).filter(Boolean);
  const c = ctx();
  return sortRows(rows).filter(r => {
    const d = derive(r, c);
    if (f.phase?.size && !f.phase.has(r.phase)) return false;
    if (f.status?.size && !f.status.has(r.status)) return false;
    if (f.health?.size && !f.health.has(d.health)) return false;
    if (f.responsible?.size && !tokens(r.responsible).some(t => f.responsible.has(t))) return false;
    if (f.subDepartment?.size && !f.subDepartment.has(r.subDepartment.trim() || "(Blank)")) return false;
    if (terms.length) {
      const hay = normText([displayId(r), r.phase, r.action, r.responsible, r.subDepartment, r.subs.map(x => x.title + " " + x.owner + " " + x.note).join(" "), r.startWeek, r.dueWeek, r.expected, r.milestone, r.status, d.health, r.note].join(" | "));
      if (!terms.some(t => hay.includes(t))) return false;
    }
    return true;
  });
}
function resetFilters(prefix) {
  const root = document.getElementById(prefix === "pp" ? "planProgress" : "planDashboard");
  root?.querySelectorAll(`[data-${prefix}-filter]`).forEach(sel => { Array.from(sel.options).forEach(o => { o.selected = false; }); sel._msRefresh?.(); });
  const s = $(`#${prefix}Search`); if (s) s.value = "";
}

/* =====================================================================
   Saving
   ===================================================================== */
let saveTimer = null;
function setSaveState(kind, msg) {
  const el = $("#ppSaveState"); if (!el) return;
  clearTimeout(saveTimer);
  if (kind === "saving") { el.textContent = "Saving…"; el.style.color = "#64748b"; }
  else if (kind === "saved") { el.textContent = "✓ All changes saved"; el.style.color = "#16a34a"; saveTimer = setTimeout(() => { el.textContent = ""; }, 3000); }
  else { el.textContent = "⚠ Not saved: " + (msg || "error"); el.style.color = "#dc2626"; }
}
const stamp = () => ({ updatedAtMs: Date.now(), updatedBy: window.__session?.email || "", updatedAt: serverTimestamp() });

async function saveRow(id, patch) {
  if (!canEdit()) { toast("Please sign in to edit."); return; }
  const row = rows.find(r => r.id === id);
  const st = stamp();
  if (row) Object.assign(row, patch, { updatedAtMs: st.updatedAtMs, updatedBy: st.updatedBy });
  setSaveState("saving");
  try { await setDoc(doc(db, COL, id), { ...patch, ...st }, { merge: true }); setSaveState("saved"); }
  catch (e) { console.error("[plan-progress] save failed", e); setSaveState("error", e.message); }
}

/* =====================================================================
   PLAN PROGRESS (data entry)
   ===================================================================== */
function planCellHtml(r, d) {
  const hs = HEALTH_STYLE[d.health];
  return `<span>${weekLabel(r.startWeek)} → ${weekLabel(r.dueWeek)}</span>
    <div class="pp-health" style="background:${hs.bg};color:${hs.fg};">${hs.icon} ${d.health}${d.daysLate ? ` · ${d.daysLate}d` : ""}</div>`;
}
const attCount = (aid, sid) => atts.filter(a => a.actionId === aid && (sid === undefined || (a.subId || "") === sid)).length;
function chipsHtml(r) {
  const n = r.subs.length, done = r.subs.filter(x => x.status === "Completed").length, a = attCount(r.id);
  return `<button type="button" class="pp-subchip${n ? " has" : ""}" data-a="detail" title="Open sub-actions & attachments">${n ? `▸ ${done}/${n} sub-actions` : "＋ Sub-actions"}${a ? ` · 📎 ${a}` : ""}</button>`;
}
function rowHtml(r, c) {
  const d = derive(r, c);
  const opts = STATUSES.map(s => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("");
  return `<tr data-id="${esc(r.id)}" data-st="${esc(r.status)}">
    <td class="pp-id">${displayId(r)}</td>
    <td><span class="pp-phase" style="background:${tint(PHASE_COLOR[r.phase] || "#64748b", .12)};color:${PHASE_COLOR[r.phase] || "#475569"};border-color:${tint(PHASE_COLOR[r.phase] || "#64748b", .45)}">${esc(r.phase)}</span></td>
    <td class="pp-action"><div>${esc(r.action)}</div>${r.milestone ? `<span class="pp-ms">★ ${esc(r.milestone)}</span>` : ""}<div class="pp-chips">${chipsHtml(r)}</div></td>
    <td class="pp-resp">${esc(r.responsible)}</td>
    <td><input class="pp-in" type="text" list="ppSubList" data-f="subDepartment" value="${esc(r.subDepartment)}" placeholder="Sub-department" aria-label="Sub-department"></td>
    <td class="pp-plan">${planCellHtml(r, d)}</td>
    <td><select class="pp-in" data-f="status" aria-label="Status">${opts}</select></td>
    <td><div class="pp-pct"><input class="pp-in" type="number" min="0" max="100" step="5" data-f="percent" value="${r.percent}" aria-label="Percent complete"${r.subs.length ? ' disabled title="Calculated from the sub-actions"' : ""}><span>%</span></div><div class="pp-bar"><i style="width:${r.percent}%"></i></div></td>
    <td><input class="pp-in" type="date" data-f="actualStart" value="${esc(r.actualStart)}" aria-label="Actual start"></td>
    <td><input class="pp-in" type="date" data-f="actualEnd" value="${esc(r.actualEnd)}" aria-label="Actual end"></td>
    <td><input class="pp-in" type="text" data-f="note" value="${esc(r.note)}" placeholder="Add an update…" aria-label="Latest update"></td>
    <td class="pp-act">
      <button type="button" data-a="start" title="Start today (In Progress)" ${r.status !== "Not Started" ? "disabled" : ""}>▶</button>
      <button type="button" data-a="done" title="Mark complete today" ${r.status === "Completed" ? "disabled" : ""}>✓</button>
      <button type="button" data-a="detail" title="Sub-actions & attachments">☰</button>
    </td></tr>`;
}
// Update controls in place (keeps keyboard focus while tabbing through a row)
function syncRow(tr, r) {
  const c = ctx(), d = derive(r, c), active = document.activeElement;
  tr.dataset.st = r.status;
  tr.querySelectorAll("[data-f]").forEach(el => {
    if (el === active) return;
    const v = r[el.dataset.f] ?? "";
    if (el.value !== String(v)) el.value = v;
  });
  const bar = tr.querySelector(".pp-bar i"); if (bar) bar.style.width = r.percent + "%";
  const pin = tr.querySelector('[data-f="percent"]'); if (pin) { pin.disabled = r.subs.length > 0; pin.title = r.subs.length ? "Calculated from the sub-actions" : ""; }
  const ch = tr.querySelector(".pp-chips"); if (ch) ch.innerHTML = chipsHtml(r);
  const plan = tr.querySelector(".pp-plan"); if (plan) plan.innerHTML = planCellHtml(r, d);
  const st = tr.querySelector('[data-a="start"]'); if (st) st.disabled = r.status !== "Not Started";
  const dn = tr.querySelector('[data-a="done"]'); if (dn) dn.disabled = r.status === "Completed";
}

function renderEntry() {
  const root = document.getElementById("planProgress");
  if (!root) return;
  populateFilters("pp");
  const tbody = $("#ppTbody"), c = ctx();
  const list = filtered("pp");
  const dl = $("#ppSubList"); if (dl) dl.innerHTML = subDeptOptions().filter(v => v !== "(Blank)").map(v => `<option value="${esc(v)}">`).join("");

  // banners
  const err = $("#ppError");
  if (err) { err.style.display = loadError ? "" : "none"; err.textContent = loadError ? loadMessage() : ""; }
  const startInput = $("#ppStartDate");
  if (startInput && document.activeElement !== startInput) startInput.value = settings.projectStart || "";
  const wk = $("#ppWeekNow");
  if (wk) {
    const S = isoToDays(settings.projectStart), T = isoToDays(c.today);
    wk.textContent = S === null ? "Set the Week 1 date to detect delays automatically" : T < S ? `Starts in ${S - T} day(s)` : `Today = Week ${Math.floor((T - S) / 7) + 1}`;
  }
  const empty = $("#ppEmpty"), wrap = $("#ppTableWrap");
  if (empty) empty.style.display = rows.length ? "none" : "";
  if (wrap) wrap.style.display = rows.length ? "" : "none";
  const none = $("#ppNoMatch"); if (none) none.style.display = rows.length && !list.length ? "" : "none";

  // table (patch in place when typing; full render otherwise)
  const sig = list.map(r => r.id).join("|");
  if (tbody.dataset.sig === sig && tbody.contains(document.activeElement)) {
    list.forEach(r => { const tr = tbody.querySelector(`tr[data-id="${CSS.escape(r.id)}"]`); if (tr) syncRow(tr, r); });
  } else {
    tbody.innerHTML = list.map(r => rowHtml(r, c)).join("");
    tbody.dataset.sig = sig;
  }
  renderEntrySummary(list, c);
}
function renderEntrySummary(list, c) {
  const el = $("#ppSummary"); if (!el) return;
  const D = list.map(r => derive(r, c));
  const n = list.length;
  const chip = (label, val, color) => `<span class="pp-chip"><b style="color:${color}">${val}</b> ${label}</span>`;
  el.innerHTML = n ? [
    chip("actions shown", `${n}${n !== rows.length ? " / " + rows.length : ""}`, "#1f3a8a"),
    chip("completed", list.filter(r => r.status === "Completed").length, "#16a34a"),
    chip("in progress", list.filter(r => r.status === "In Progress").length, "#2563eb"),
    chip("delayed", D.filter(d => d.health === "Delayed").length, "#dc2626"),
    chip("escalated", list.filter(r => r.status === "Escalated").length, "#9f1239"),
    chip("no reply", list.filter(r => r.status === "No Reply").length, "#9a3412"),
    chip("overall progress", Math.round(avg(list.map(r => r.percent))) + "%", "#1f3a8a"),
  ].join("") : "";
}
function loadMessage() {
  return /permission|insufficient/i.test(loadError)
    ? "Cannot read the plan data: the Firestore rules for 'planProgress' / 'planSettings' have not been published yet (see firestore.rules)."
    : "Cannot load plan data: " + loadError;
}

/* ---------- Modal helpers ---------- */
function closeModal() { document.getElementById("ppModal")?.remove(); detailId = null; }
function openModal(inner, width = 640) {
  closeModal();
  const ov = document.createElement("div");
  ov.className = "detail-overlay"; ov.id = "ppModal";
  ov.innerHTML = `<div class="detail-card pp-modal" style="max-width:${width}px">${inner}</div>`;
  ov.addEventListener("mousedown", e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  return ov;
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ---------- Add / edit action ---------- */
function openActionModal(id) {
  if (!canEdit()) return toast("Please sign in to edit.");
  const r = id ? rows.find(x => x.id === id) : null;
  const v = r || { phase: "Define", action: "", responsible: "", subDepartment: "", startWeek: "TBD", dueWeek: "TBD", expected: "", milestone: "" };
  const ov = openModal(`
    <h3>${r ? "Edit action " + displayId(r) : "Add a new action"}</h3>
    <div class="pp-form">
      <label>Phase<select id="pmPhase">${PHASES.map(p => `<option${p === v.phase ? " selected" : ""}>${p}</option>`).join("")}</select></label>
      <label>Milestone (optional)<input id="pmMs" list="pmMsList" value="${esc(v.milestone)}" placeholder="—"><datalist id="pmMsList">${MILESTONES.map(m => `<option value="${m}">`).join("")}</datalist></label>
      <label class="full">Action<textarea id="pmAction" rows="2" placeholder="What needs to be done?">${esc(v.action)}</textarea></label>
      <label>Responsible <small>(separate with “/” — e.g. PEX / PA – SPOCs)</small><input id="pmResp" value="${esc(v.responsible)}"></label>
      <label>Sub-department<input id="pmSub" list="ppSubList" value="${esc(v.subDepartment)}"></label>
      <label>Planned start (week number, TBD or Ongoing)<input id="pmStart" value="${esc(v.startWeek)}"></label>
      <label>Planned due (week number, TBD or Ongoing)<input id="pmDue" value="${esc(v.dueWeek)}"></label>
      <label class="full">Expected result<input id="pmExp" value="${esc(v.expected)}"></label>
    </div>
    <div class="pp-modal-btns">
      ${r ? `<button class="btn ghost" id="pmDel" style="color:#b91c1c;margin-right:auto;">Delete action</button>` : ""}
      <button class="btn ghost" id="pmCancel">Cancel</button>
      <button class="btn primary" id="pmSave">${r ? "Save changes" : "Add action"}</button>
    </div>`);
  $("#pmCancel", ov).onclick = closeModal;
  if (r) $("#pmDel", ov).onclick = async () => {
    if (!confirm(`Delete action ${displayId(r)}?\n\n${r.action}\n\nThis cannot be undone.`)) return;
    try {
      for (const a of atts.filter(x => x.actionId === r.id)) await removeAttachment(a, true);
      const b = writeBatch(db); b.delete(doc(db, COL, r.id)); await b.commit(); closeModal(); toast("Action deleted.");
    }
    catch (e) { toast("Delete failed: " + e.message); }
  };
  $("#pmSave", ov).onclick = async () => {
    const action = $("#pmAction", ov).value.trim();
    const sw = normWeek($("#pmStart", ov).value), dw = normWeek($("#pmDue", ov).value);
    if (!action) return toast("Please enter the action.");
    if (sw === null || dw === null) return toast("Weeks must be a number (e.g. 12), TBD or Ongoing.");
    const plan = { phase: $("#pmPhase", ov).value, action, responsible: $("#pmResp", ov).value.trim(), subDepartment: $("#pmSub", ov).value.trim(), startWeek: sw, dueWeek: dw, expected: $("#pmExp", ov).value.trim(), milestone: $("#pmMs", ov).value.trim() };
    if (r) { await saveRow(r.id, plan); }
    else {
      const seq = Math.max(0, ...rows.map(x => x.seq)) + 1;
      const id = "act-" + Date.now().toString(36);
      setSaveState("saving");
      try {
        await setDoc(doc(db, COL, id), { seq, ...plan, subs: [], status: "Not Started", percent: 0, actualStart: "", actualEnd: "", note: "", createdAt: serverTimestamp(), ...stamp() });
        setSaveState("saved");
      } catch (e) { setSaveState("error", e.message); return; }
    }
    closeModal();
    const tb = $("#ppTbody"); if (tb) tb.dataset.sig = "";
    renderEntry();
  };
}


/* ---------- Attachments (signed-in only; files in Storage, metadata in planAttachments) ---------- */
const extOf = n => (String(n).split(".").pop() || "").toLowerCase();
const fileIcon = n => ({ pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗", msg: "✉️", eml: "✉️" }[extOf(n)] || "📄");
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
function attChips(actionId, subId) {
  const list = atts.filter(a => a.actionId === actionId && (a.subId || "") === (subId || "")).sort((a, b) => a.atMs - b.atMs);
  return list.map(a => `<span class="pp-file"><a href="#" data-dl="${esc(a.id)}" title="Open / download · added ${esc(fmtDate(daysToISO(Math.floor(a.atMs / DAY))))} by ${esc(a.by)}">${fileIcon(a.name)} ${esc(a.name)} <small>${fmtSize(a.size)}</small></a><button type="button" data-delatt="${esc(a.id)}" title="Remove attachment">×</button></span>`).join("");
}
async function uploadFiles(files, actionId, subId) {
  if (!canEdit()) return toast("Please sign in to attach files.");
  let ok = 0;
  for (const f of Array.from(files)) {
    if (!ATT_EXT.includes(extOf(f.name))) { toast(`${f.name}: only email, PDF, Word and Excel files are allowed.`); continue; }
    if (f.size > ATT_MAX) { toast(`${f.name} is larger than 10 MB.`); continue; }
    const id = "att-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const path = `${COL_ATT}/${actionId}/${id}_${f.name.replace(/[^\w.\-]+/g, "_")}`;
    try {
      toast(`Uploading ${f.name}…`);
      await uploadBytes(sRef(storage, path), f, { contentType: f.type || undefined });
      await setDoc(doc(db, COL_ATT, id), { actionId, subId: subId || "", name: f.name, size: f.size, path, by: window.__session?.email || "", atMs: Date.now() });
      ok++;
    } catch (e) { console.error(e); toast(`Could not upload ${f.name}: ${e.message}`); }
  }
  if (ok) { toast(`${ok} file${ok > 1 ? "s" : ""} attached.`); saveRow(actionId, {}); }   // stamps the action as updated
}
async function removeAttachment(a, silent) {
  if (!silent && !confirm(`Remove “${a.name}”?`)) return;
  try { await deleteObject(sRef(storage, a.path)); } catch (e) { console.warn("storage delete", e); }
  try { await deleteDoc(doc(db, COL_ATT, a.id)); } catch (e) { toast("Could not remove: " + e.message); }
}
async function openAttachment(id) {
  const a = atts.find(x => x.id === id); if (!a) return;
  const w = window.open("", "_blank");
  try { const url = await getDownloadURL(sRef(storage, a.path)); if (w) w.location.href = url; else location.href = url; }
  catch (e) { if (w) w.close(); toast("Could not open the file: " + e.message); }
}

/* ---------- Sub-actions + attachments window ---------- */
let detailId = null;
function openDetail(id) {
  if (!canEdit()) return toast("Please sign in to edit.");
  const ov = openModal(`<div id="ppDetailBody"></div>`, 1060);
  detailId = id;   // after openModal (it closes any previous window, which clears detailId)
  ov.addEventListener("click", detailClick); ov.addEventListener("change", detailChange);
  ov.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "pdNewSub" && !e.shiftKey) { e.preventDefault(); addSubs(); } });
  renderDetail();
}
function renderDetail() {
  const body = document.getElementById("ppDetailBody"); if (!body) { detailId = null; return; }
  const r = rows.find(x => x.id === detailId); if (!r) { closeModal(); return; }
  const c = ctx(), d = derive(r, c), hs = HEALTH_STYLE[d.health];
  const n = r.subs.length, done = r.subs.filter(x => x.status === "Completed").length;
  const opts = cur => STATUSES.map(s => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("");
  const subRows = r.subs.map(sb => `
    <tr data-sid="${esc(sb.id)}" class="${sb.status === "Completed" ? "done" : ""}">
      <td><input type="checkbox" data-sdone title="Close / re-open this sub-action" ${sb.status === "Completed" ? "checked" : ""}></td>
      <td><input class="pp-in" data-sf="title" value="${esc(sb.title)}" aria-label="Sub-action"></td>
      <td><input class="pp-in" data-sf="owner" value="${esc(sb.owner)}" placeholder="Owner" aria-label="Owner"></td>
      <td><input class="pp-in" type="date" data-sf="due" value="${esc(sb.due)}" aria-label="Due date"></td>
      <td><select class="pp-in" data-sf="status" aria-label="Status">${opts(sb.status)}</select></td>
      <td><input class="pp-in" data-sf="note" value="${esc(sb.note)}" placeholder="Update / note" aria-label="Note"></td>
      <td class="pp-sub-btns"><label class="pp-clip" title="Attach email / PDF / Word / Excel">📎${attCount(r.id, sb.id) ? ` ${attCount(r.id, sb.id)}` : ""}<input type="file" multiple hidden data-up="${esc(sb.id)}" accept=".msg,.eml,.pdf,.doc,.docx,.xls,.xlsx"></label><button type="button" data-delsub title="Delete sub-action">🗑</button></td>
    </tr>${attCount(r.id, sb.id) ? `<tr class="pp-sub-att"><td></td><td colspan="6">${attChips(r.id, sb.id)}</td></tr>` : ""}`).join("");
  const keep = document.activeElement?.id === "pdNewSub" ? $("#pdNewSub").value : "";
  body.innerHTML = `
    <div class="pp-dh">
      <div><div class="pp-dh-id">${displayId(r)} · ${esc(r.phase)}${r.milestone ? ` · ★ ${esc(r.milestone)}` : ""}</div>
        <h3>${esc(r.action)}</h3>
        <div class="pp-dh-m">${esc(r.responsible || "—")}${r.subDepartment ? ` · ${esc(r.subDepartment)}` : ""} · ${weekLabel(r.startWeek)} → ${weekLabel(r.dueWeek)} ·
          <span class="pp-health" style="background:${hs.bg};color:${hs.fg}">${hs.icon} ${d.health}</span> · ${r.status} ${r.percent}%</div></div>
      <div class="pp-dh-b"><button class="btn ghost" id="pdEdit">✎ Edit action</button><button class="btn primary" id="pdClose">Done</button></div>
    </div>
    <div class="pp-sec"><h4>Sub-actions <span>${n ? `${done} of ${n} closed · ${Math.round(done / n * 100)}%` : "none yet"}</span></h4>
      <p class="pp-hint2">When every sub-action is <b>Completed</b>, the action closes automatically (and re-opens if you add or re-open one).</p>
      ${n ? `<div class="pp-subwrap"><table class="pp-subtable"><colgroup><col style="width:34px"><col><col style="width:130px"><col style="width:128px"><col style="width:118px"><col style="width:22%"><col style="width:84px"></colgroup>
        <thead><tr><th></th><th>Sub-action</th><th>Owner</th><th>Due</th><th>Status</th><th>Update / note</th><th>Files</th></tr></thead><tbody>${subRows}</tbody></table></div>` : ""}
      <div class="pp-addsub"><textarea id="pdNewSub" rows="1" placeholder="Type a sub-action and press Enter (paste several lines to add many at once)"></textarea><button class="btn primary" id="pdAdd">+ Add</button></div>
    </div>
    <div class="pp-sec"><h4>Attachments for this action <span>email (.msg / .eml), PDF, Word, Excel · max 10 MB each</span></h4>
      <div class="pp-files">${attChips(r.id, "") || '<span class="pp-none">No files attached.</span>'}</div>
      <label class="btn" style="margin-top:8px;cursor:pointer;">📎 Attach files<input type="file" multiple hidden data-up="" accept=".msg,.eml,.pdf,.doc,.docx,.xls,.xlsx"></label>
    </div>`;
  if (keep) { const t = $("#pdNewSub"); t.value = keep; t.focus(); }
}
async function saveSubs(id, subs) {
  const r = rows.find(x => x.id === id); if (!r) return;
  const ru = rollup(r, subs) || {};
  const was = r.status;
  await saveRow(id, { subs, ...ru });
  if (ru.status === "Completed" && was !== "Completed") toast("All sub-actions closed → action completed ✓");
  else if (was === "Completed" && ru.status && ru.status !== "Completed") toast("Action re-opened (a sub-action is open).");
  renderDetail(); renderEntry();
}
function addSubs() {
  const t = $("#pdNewSub"), r = rows.find(x => x.id === detailId); if (!t || !r) return;
  const titles = t.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!titles.length) return;
  t.value = "";
  saveSubs(r.id, [...r.subs.map(x => ({ ...x })), ...titles.map(title => ({ id: newSubId(), title, owner: "", due: "", status: "Not Started", note: "" }))]).then(() => $("#pdNewSub")?.focus());
}
function detailClick(e) {
  const r = rows.find(x => x.id === detailId); if (!r) return;
  if (e.target.closest("#pdClose")) return closeModal();
  if (e.target.closest("#pdEdit")) { const id = r.id; closeModal(); return openActionModal(id); }
  if (e.target.closest("#pdAdd")) return addSubs();
  const dl = e.target.closest("[data-dl]"); if (dl) { e.preventDefault(); return openAttachment(dl.dataset.dl); }
  const da = e.target.closest("[data-delatt]"); if (da) { const a = atts.find(x => x.id === da.dataset.delatt); if (a) removeAttachment(a); return; }
  if (e.target.closest("[data-delsub]")) {
    const sid = e.target.closest("tr").dataset.sid, sb = r.subs.find(x => x.id === sid);
    if (!confirm(`Delete sub-action “${sb?.title}”${attCount(r.id, sid) ? " and its attachments" : ""}?`)) return;
    atts.filter(a => a.actionId === r.id && a.subId === sid).forEach(a => removeAttachment(a, true));
    saveSubs(r.id, r.subs.filter(x => x.id !== sid).map(x => ({ ...x })));
  }
}
function detailChange(e) {
  const r = rows.find(x => x.id === detailId); if (!r) return;
  const up = e.target.closest("[data-up]");
  if (up) { uploadFiles(up.files, r.id, up.dataset.up).finally(() => { up.value = ""; }); return; }
  const tr = e.target.closest("tr[data-sid]"); if (!tr) return;
  const subs = r.subs.map(x => ({ ...x })), sb = subs.find(x => x.id === tr.dataset.sid); if (!sb) return;
  if (e.target.matches("[data-sdone]")) sb.status = e.target.checked ? "Completed" : "In Progress";
  else if (e.target.dataset.sf) {
    const f = e.target.dataset.sf, v = e.target.value.trim();
    if (f === "title" && !v) { renderDetail(); return toast("A sub-action needs a title."); }
    sb[f] = v;
  } else return;
  saveSubs(r.id, subs);
}

/* ---------- Seed the roadmap from the slides ---------- */
async function seedRoadmap() {
  if (!canEdit()) return toast("Please sign in to edit.");
  if (rows.length) return toast("The plan already has actions.");
  try {
    const b = writeBatch(db), st = stamp();
    SEED.forEach(([phase, action, responsible, startWeek, dueWeek, expected, milestone], i) => {
      b.set(doc(db, COL, "act-" + pad2(i + 1)), {
        seq: i + 1, phase, action, responsible, subDepartment: "", startWeek, dueWeek, expected, milestone, subs: [],
        status: "Not Started", percent: 0, actualStart: "", actualEnd: "", note: "", createdAt: serverTimestamp(), ...st,
      }, { merge: true });
    });
    await b.commit();
    toast(`Loaded ${SEED.length} actions from the roadmap slides.`);
  } catch (e) { console.error(e); toast("Could not load roadmap: " + e.message); }
}

/* ---------- Excel export ---------- */
const XCOLS = [
  { key: "id", label: "ID", al: ["id", "#", "no", "no.", "action id", "seq"], w: 6 },
  { key: "phase", label: "Phase", al: ["phase", "stage"], w: 13 },
  { key: "action", label: "Action", al: ["action", "task", "activity"], w: 60 },
  { key: "responsible", label: "Responsible", al: ["responsible", "owner", "responsibility"], w: 24 },
  { key: "subDepartment", label: "Sub-department", al: ["sub-department", "sub department", "subdepartment", "sub dept", "sub-dept"], w: 20 },
  { key: "startWeek", label: "Planned Start (Week)", al: ["planned start (week)", "planned start", "start", "start week", "start (week)"], w: 14 },
  { key: "dueWeek", label: "Planned Due (Week)", al: ["planned due (week)", "planned due", "due", "due week", "due (week)"], w: 14 },
  { key: "expected", label: "Expected Result", al: ["expected result", "expected results", "result", "deliverable"], w: 36 },
  { key: "milestone", label: "Milestone", al: ["milestone"], w: 18 },
  { key: "status", label: "Status", al: ["status", "progress status"], w: 13 },
  { key: "percent", label: "% Complete", al: ["% complete", "percent", "percent complete", "% done", "progress", "progress %", "completion", "completion %"], w: 11 },
  { key: "actualStart", label: "Actual Start", al: ["actual start", "actual start date", "started"], w: 13 },
  { key: "actualEnd", label: "Actual End", al: ["actual end", "actual end date", "completed on", "actual finish"], w: 13 },
  { key: "note", label: "Latest Update", al: ["latest update", "update", "comment", "comments", "notes", "note", "remarks"], w: 40 },
];
const INFO_COLS = ["Schedule Health", "Planned Start Date", "Planned Due Date"];   // export-only, ignored on import

function exportExcel() {
  if (typeof XLSX === "undefined") return toast("Excel library not loaded.");
  const c = ctx(), S = isoToDays(c.start);
  const list = sortRows(rows);
  const head = [...XCOLS.map(x => x.label), ...INFO_COLS];
  const aoa = [head];
  list.forEach(r => {
    const d = derive(r, c);
    aoa.push([
      ...XCOLS.map(x => x.key === "id" ? displayId(r) : x.key === "startWeek" || x.key === "dueWeek" ? (parseWeek(r[x.key]).k === "w" ? "Week " + parseWeek(r[x.key]).n : weekLabel(r[x.key])) : r[x.key] ?? ""),
      d.health,
      S !== null && d.startD !== null ? daysToISO(d.startD) : "",
      S !== null && d.dueD !== null ? daysToISO(d.dueD) : "",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colIdx = k => XCOLS.findIndex(x => x.key === k);
  for (let i = 1; i < aoa.length; i++) {   // real Excel dates / percentages (serial maths, no timezone)
    [["actualStart", colIdx("actualStart")], ["actualEnd", colIdx("actualEnd")], [null, XCOLS.length + 1], [null, XCOLS.length + 2]].forEach(([, ci]) => {
      const addr = XLSX.utils.encode_cell({ r: i, c: ci }), n = isoToDays(aoa[i][ci]);
      if (n !== null) ws[addr] = { t: "n", v: n + 25569, z: "yyyy-mm-dd" };
    });
    const pa = XLSX.utils.encode_cell({ r: i, c: colIdx("percent") });
    ws[pa] = { t: "n", v: list[i - 1].percent / 100, z: "0%" };
  }
  ws["!cols"] = [...XCOLS.map(x => ({ wch: x.w })), { wch: 14 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan Progress");
  const subAoa = [["Action ID", "Action", "Sub-action", "Owner", "Due", "Status", "Note"]];
  list.forEach(r => r.subs.forEach(sb => subAoa.push([displayId(r), r.action, sb.title, sb.owner, sb.due, sb.status, sb.note])));
  const ws2 = XLSX.utils.aoa_to_sheet(subAoa);
  for (let i = 1; i < subAoa.length; i++) { const dn = isoToDays(subAoa[i][4]); if (dn !== null) ws2[XLSX.utils.encode_cell({ r: i, c: 4 })] = { t: "n", v: dn + 25569, z: "yyyy-mm-dd" }; }
  ws2["!cols"] = [{ wch: 10 }, { wch: 50 }, { wch: 46 }, { wch: 18 }, { wch: 13 }, { wch: 13 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Sub-actions");
  XLSX.writeFile(wb, `plan-progress-${todayISO()}.xlsx`);
}

/* ---------- Excel import ---------- */
function parseDateCell(v) {
  if (v === "" || v == null) return "";
  if (typeof v === "number") { if (v < 1 || v > 80000) return null; return daysToISO(Math.floor(v) - 25569); }
  const s = String(v).trim(); if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }   // day first
  else if ((m = /^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-,]*(\d{4})$/.exec(s))) {
    mo = MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1; d = +m[1]; y = +m[3];
    if (!mo) return null;
  } else return null;
  const iso = `${y}-${pad2(mo)}-${pad2(d)}`;
  return isoToDays(iso) !== null ? iso : null;
}
function parseStatus(v) {
  const s = normText(v);
  if (["", "not started", "pending", "open", "todo", "to do", "planned"].includes(s)) return "Not Started";
  if (["in progress", "in-progress", "inprogress", "ongoing", "started", "wip"].includes(s)) return "In Progress";
  if (["completed", "complete", "done", "closed", "finished"].includes(s)) return "Completed";
  if (["on hold", "hold", "paused", "blocked"].includes(s)) return "On Hold";
  if (["no reply", "noreply", "no response", "not replied", "no answer"].includes(s)) return "No Reply";
  if (["escalated", "escalate", "escalation"].includes(s)) return "Escalated";
  return null;
}
function parsePercent(v) {
  if (v === "" || v == null) return "";
  if (typeof v === "number") return clampPct(v <= 1 ? v * 100 : v);
  const n = parseFloat(String(v).replace("%", "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return clampPct(String(v).includes("%") || n > 1 ? n : n * 100);
}
function parsePhase(v) {
  const s = normText(v).replace(/ phase$/, "");
  if (s === "analyze" || s === "analyse") return "Analysis";
  if (s === "improve") return "Improvement";
  return PHASES.find(p => p.toLowerCase() === s) || null;
}

function buildHeaderMap(aoa) {
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const map = {}, used = new Set();
    aoa[i].forEach((h, ci) => {
      const n = normText(h); if (!n) return;
      const col = XCOLS.find(x => !used.has(x.key) && (x.label.toLowerCase() === n || x.al.includes(n)));
      if (col) { map[ci] = col.key; used.add(col.key); }
    });
    if (used.size >= 2 && used.has("action")) return { map, headerRow: i };
  }
  return null;
}

async function readImportFile(file) {
  if (typeof XLSX === "undefined") return toast("Excel library not loaded.");
  let aoa, subAoa = null;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const name = wb.SheetNames.find(n => /plan/i.test(n)) || wb.SheetNames.find(n => !/^sub/i.test(n)) || wb.SheetNames[0];
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
    const sn = wb.SheetNames.find(n => /^sub/i.test(n) && n !== name);
    if (sn) subAoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: true });
  } catch (e) { return toast("Could not read this file: " + e.message); }
  const hm = buildHeaderMap(aoa);
  if (!hm) return toast("Could not find an 'Action' column. Use the exported file as your template.");

  const errors = [], ops = [];
  const bySeq = new Map(rows.map(r => [r.seq, r])), byAction = new Map(rows.map(r => [normText(r.action), r]));
  const touched = new Set(), updMap = new Map(), unchangedIds = new Set();

  for (let i = hm.headerRow + 1; i < aoa.length; i++) {
    const line = aoa[i], xl = i + 1;
    if (!line || line.every(x => String(x ?? "").trim() === "")) continue;
    const raw = {};
    Object.entries(hm.map).forEach(([ci, key]) => { raw[key] = line[ci]; });
    const p = {};   // provided (non-blank) values only
    const bad = m => errors.push(`Row ${xl}: ${m}`);
    for (const key of Object.keys(raw)) {
      const v = raw[key];
      if (key === "id") continue;
      if (String(v ?? "").trim() === "") continue;   // blank keeps the existing value
      if (key === "phase") { const ph = parsePhase(v); ph ? p.phase = ph : bad(`unknown phase “${v}”`); }
      else if (key === "status") { const s = parseStatus(v); s ? p.status = s : bad(`unknown status “${v}”`); }
      else if (key === "percent") { const n = parsePercent(v); n === null ? bad(`invalid % complete “${v}”`) : p.percent = n; }
      else if (key === "actualStart" || key === "actualEnd") { const d = parseDateCell(v); d === null ? bad(`invalid date “${v}” in ${key === "actualStart" ? "Actual Start" : "Actual End"}`) : p[key] = d; }
      else if (key === "startWeek" || key === "dueWeek") { const w = normWeek(v); w === null ? bad(`invalid week “${v}” (use a number, TBD or Ongoing)`) : p[key] = w; }
      else p[key] = String(v).trim();
    }
    // match an existing action: by ID first, then by exact action text
    let target = null;
    const idm = /^a?0*(\d+)$/i.exec(String(raw.id ?? "").trim());
    if (idm && bySeq.has(+idm[1])) target = bySeq.get(+idm[1]);
    if (!target && p.action) target = byAction.get(normText(p.action)) || null;
    if (target) {
      if (touched.has(target.id)) { bad(`duplicate of ${displayId(target)}`); continue; }
      touched.add(target.id);
      const merged = normalizeImported({ ...target, ...p });
      const patch = {};
      Object.keys(merged).forEach(k => { if (["id", "updatedAtMs", "updatedBy", "seq"].includes(k)) return; if (merged[k] !== target[k]) patch[k] = merged[k]; });
      if (Object.keys(patch).length) { const op = { type: "update", id: target.id, label: displayId(target), patch }; ops.push(op); updMap.set(target.id, op); }
      else unchangedIds.add(target.id);
    } else {
      if (!p.action) { bad("no Action text"); continue; }
      if (!p.phase) { bad(`new action “${p.action.slice(0, 40)}” needs a valid Phase`); continue; }
      const base = normalizeImported({ responsible: "", subDepartment: "", subs: [], startWeek: "TBD", dueWeek: "TBD", expected: "", milestone: "", status: "Not Started", percent: 0, actualStart: "", actualEnd: "", note: "", ...p });
      ops.push({ type: "add", label: "new", data: base });
    }
  }

  // ---- optional "Sub-actions" sheet: Action ID | Sub-action | Owner | Due | Status | Note ----
  const subStats = { added: 0, updated: 0 };
  if (subAoa) {
    const SC = { id: ["action id", "id", "a id"], actionText: ["action", "action name"], title: ["sub-action", "sub action", "subaction", "title", "sub-action title", "task"], owner: ["owner", "responsible"], due: ["due", "due date"], status: ["status"], note: ["note", "notes", "update", "comment", "comments", "latest update"] };
    let sm = null, sh = 0;
    for (let i = 0; i < Math.min(6, subAoa.length) && !sm; i++) {
      const m = {}; subAoa[i].forEach((h, ci) => { const n = normText(h); const k = Object.keys(SC).find(k => !Object.values(m).includes(k) && SC[k].includes(n)); if (k) m[ci] = k; });
      if (Object.values(m).includes("title") && (Object.values(m).includes("id") || Object.values(m).includes("actionText"))) { sm = m; sh = i; }
    }
    if (!sm && subAoa.length > 1) errors.push("Sub-actions sheet: could not find the 'Action ID' and 'Sub-action' columns.");
    const work = new Map();
    for (let i = sh + 1; sm && i < subAoa.length; i++) {
      const line = subAoa[i], xl = i + 1;
      if (!line || line.every(x => String(x ?? "").trim() === "")) continue;
      const raw = {}; Object.entries(sm).forEach(([ci, k]) => { raw[k] = line[ci]; });
      const bad = m => errors.push(`Sub-actions row ${xl}: ${m}`);
      const idm = /^a?0*(\d+)$/i.exec(String(raw.id ?? "").trim());
      const target = (idm && bySeq.get(+idm[1])) || (raw.actionText ? byAction.get(normText(raw.actionText)) : null);
      if (!target) { bad(`unknown action “${raw.id || raw.actionText || ""}”`); continue; }
      const title = String(raw.title ?? "").trim(); if (!title) { bad("no Sub-action text"); continue; }
      const p = {};
      if (String(raw.owner ?? "").trim()) p.owner = String(raw.owner).trim();
      if (String(raw.note ?? "").trim()) p.note = String(raw.note).trim();
      if (String(raw.status ?? "").trim()) { const st = parseStatus(raw.status); st ? p.status = st : bad(`unknown status “${raw.status}”`); }
      if (String(raw.due ?? "").trim()) { const dd = parseDateCell(raw.due); dd === null ? bad(`invalid due date “${raw.due}”`) : p.due = dd; }
      if (!work.has(target.id)) work.set(target.id, target.subs.map(x => ({ ...x })));
      const arr = work.get(target.id), ex = arr.find(x => normText(x.title) === normText(title));
      if (ex) { if (Object.keys(p).some(k => ex[k] !== p[k])) { Object.assign(ex, p); subStats.updated++; } }
      else { arr.push({ id: newSubId(), title, owner: p.owner || "", due: p.due || "", status: p.status || "Not Started", note: p.note || "" }); subStats.added++; }
    }
    work.forEach((arr, id) => {
      const target = rows.find(r => r.id === id);
      let op = updMap.get(id);
      if (!op) { op = { type: "update", id, label: displayId(target), patch: {} }; ops.push(op); updMap.set(id, op); }
      op.patch.subs = arr;
      Object.assign(op.patch, rollup({ ...target, ...op.patch }, arr) || {});
    });
  }
  const unchanged = [...unchangedIds].filter(id => !updMap.has(id)).length;
  showImportDialog({ ops, errors, unchanged, touched, file: file.name, subStats });
}

function showImportDialog({ ops, errors, unchanged, touched, file, subStats }) {
  const upd = ops.filter(o => o.type === "update"), add = ops.filter(o => o.type === "add");
  const missing = rows.filter(r => !touched.has(r.id));
  const list = (arr, f) => arr.slice(0, 6).map(f).join("") + (arr.length > 6 ? `<li>…and ${arr.length - 6} more</li>` : "");
  const ov = openModal(`
    <h3>Import “${esc(file)}”</h3>
    ${errors.length ? `<div class="pp-imp-err"><b>${errors.length} problem(s) found — nothing has been changed.</b> Fix the file and import again.<ul>${list(errors, e => `<li>${esc(e)}</li>`)}</ul></div>` : `
    <div class="pp-imp-grid">
      <div><b>${upd.length}</b><span>actions updated</span></div>
      <div><b>${add.length}</b><span>new actions</span></div>
      <div><b>${unchanged}</b><span>unchanged</span></div>
    </div>
    ${subStats && (subStats.added || subStats.updated) ? `<p class="pp-imp-note">Sub-actions: <b>${subStats.added}</b> new, <b>${subStats.updated}</b> updated (actions close automatically when all their sub-actions are completed).</p>` : ""}
    <p class="pp-imp-note">Rows are matched by <b>ID</b> (or by Action text). A blank cell keeps the existing value, so you can import a file that only contains the columns you want to update.</p>
    ${upd.length ? `<details><summary>See the updates</summary><ul>${list(upd, o => `<li><b>${o.label}</b> — ${Object.keys(o.patch).map(k => k === "subs" ? "Sub-actions" : XCOLS.find(x => x.key === k)?.label || k).join(", ")}</li>`)}</ul></details>` : ""}
    ${missing.length ? `<label class="pp-imp-rm"><input type="checkbox" id="impRemove"> Also delete the ${missing.length} action(s) that are not in this file</label>` : ""}`}
    <div class="pp-modal-btns">
      <button class="btn ghost" id="impCancel">${errors.length ? "Close" : "Cancel"}</button>
      ${errors.length ? "" : `<button class="btn primary" id="impGo" ${ops.length ? "" : "disabled"}>Import</button>`}
    </div>`, 620);
  $("#impCancel", ov).onclick = closeModal;
  const go = $("#impGo", ov);
  if (go) go.onclick = async () => {
    const remove = $("#impRemove", ov)?.checked;
    if (remove && !confirm(`Delete ${missing.length} action(s) not found in the file?`)) return;
    go.disabled = true; go.textContent = "Importing…";
    try {
      const st = stamp();
      let seq = Math.max(0, ...rows.map(r => r.seq));
      const writes = [];
      ops.forEach(o => {
        if (o.type === "update") writes.push(b => b.set(doc(db, COL, o.id), { ...o.patch, ...st }, { merge: true }));
        else { seq++; writes.push(b => b.set(doc(collection(db, COL)), { seq, ...o.data, createdAt: serverTimestamp(), ...st })); }
      });
      if (remove) missing.forEach(r => writes.push(b => b.delete(doc(db, COL, r.id))));
      for (let i = 0; i < writes.length; i += 400) { const b = writeBatch(db); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
      closeModal();
      toast(`Import complete: ${upd.length} updated, ${add.length} added${remove ? `, ${missing.length} removed` : ""}.`);
    } catch (e) { console.error(e); go.disabled = false; go.textContent = "Import"; toast("Import failed: " + e.message); }
  };
}

/* ---------- Wiring (entry page) ---------- */
function wireEntry() {
  const root = document.getElementById("planProgress");
  if (!root || root.dataset.ppWired) return;
  root.dataset.ppWired = "1";
  populateFilters("pp");
  const tbody = $("#ppTbody");

  tbody.addEventListener("change", e => {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const tr = el.closest("tr"), r = rows.find(x => x.id === tr.dataset.id); if (!r) return;
    const f = el.dataset.f;
    if (f === "note") { if (el.value.trim() !== r.note) saveRow(r.id, { note: el.value.trim() }); return; }
    if (f === "subDepartment") { if (el.value.trim() !== r.subDepartment) saveRow(r.id, { subDepartment: el.value.trim() }).then(() => populateFilters("pp")); return; }
    const next = { status: r.status, percent: r.percent, actualStart: r.actualStart, actualEnd: r.actualEnd };
    next[f] = f === "percent" ? clampPct(el.value) : el.value;
    const res = applyRules(next, f);
    saveRow(r.id, res);
    syncRow(tr, r);
    renderEntrySummary(filtered("pp"), ctx());
  });
  tbody.addEventListener("click", e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const tr = b.closest("tr"), r = rows.find(x => x.id === tr.dataset.id); if (!r) return;
    if (b.dataset.a === "detail") return openDetail(r.id);
    const t = todayISO();
    const res = b.dataset.a === "start"
      ? applyRules({ ...pick(r), status: "In Progress" }, "status")
      : applyRules({ ...pick(r), status: "Completed" }, "status");
    saveRow(r.id, res); syncRow(tr, r); renderEntrySummary(filtered("pp"), ctx());
    toast(b.dataset.a === "start" ? `Started on ${fmtDate(t)}` : `Completed on ${fmtDate(t)}`);
  });

  $("#ppImportFile")?.addEventListener("change", e => { const f = e.target.files?.[0]; if (f) readImportFile(f).finally(() => { e.target.value = ""; }); });
  $("#ppExport")?.addEventListener("click", exportExcel);
  $("#ppAdd")?.addEventListener("click", () => openActionModal(null));
  $("#ppSeed")?.addEventListener("click", seedRoadmap);
  $("#ppSearch")?.addEventListener("input", renderEntry);
  root.querySelectorAll("[data-pp-filter]").forEach(sel => sel.addEventListener("change", renderEntry));
  $("#ppReset")?.addEventListener("click", () => { resetFilters("pp"); renderEntry(); });
  $("#ppStartDate")?.addEventListener("change", async e => {
    if (!canEdit()) return toast("Please sign in to edit.");
    const v = e.target.value;
    if (v && isoToDays(v) === null) return toast("Invalid date.");
    try { await setDoc(doc(db, COL_SET, SET_DOC), { projectStart: v, ...stamp() }, { merge: true }); toast(v ? "Project start date saved." : "Project start date cleared."); }
    catch (err) { toast("Could not save: " + err.message); }
  });
}
const pick = r => ({ status: r.status, percent: r.percent, actualStart: r.actualStart, actualEnd: r.actualEnd });

/* =====================================================================
   PROGRESS DASHBOARD (public)
   ===================================================================== */
const COLORS = { done: "#16a34a", prog: "#2563eb", hold: "#7c3aed", todo: "#cbd5e1", late: "#dc2626", risk: "#d97706", ink: "#1f3a8a" };

function aggHealth(items) {   // items: [{r,d}]
  if (!items.length) return "Not started";
  if (items.every(x => x.r.status === "Completed")) return "Completed";
  if (items.some(x => x.d.health === "Escalated")) return "Escalated";
  if (items.some(x => x.d.health === "Delayed")) return "Delayed";
  if (items.some(x => x.d.health === "No reply")) return "No reply";
  if (items.some(x => x.d.health === "At risk")) return "At risk";
  if (items.some(x => x.r.status === "In Progress" || x.r.status === "Completed")) return "On track";
  if (items.some(x => x.r.status === "On hold")) return "On hold";
  return "Not started";
}
const badge = h => { const s = HEALTH_STYLE[h]; return `<span class="pd-badge" style="background:${s.bg};color:${s.fg}">${s.icon} ${h}</span>`; };
const weekRange = items => {
  const nums = items.flatMap(x => [x.d.sw, x.d.dw]).filter(w => w.k === "w").map(w => w.n);
  return nums.length ? `Wk ${Math.min(...nums)}–${Math.max(...nums)}` : "Not scheduled";
};
const section = (title, sub, body, cls = "") => `<div class="pd-card ${cls}"><h3>${title}</h3>${sub ? `<div class="pd-sub">${sub}</div>` : ""}${body}</div>`;

function kpi(icon, bg, label, val, sub, color) {
  return `<div class="pd-kpi"><div class="pd-ico" style="background:${bg}">${icon}</div><div><div class="pd-kl">${label}</div><div class="pd-kv" style="color:${color}">${val}</div><div class="pd-ks">${sub}</div></div></div>`;
}

function destroyCharts() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) {} delete charts[k]; }); }

function renderDashboard() {
  const host = $("#pdContent"); if (!host) return;
  populateFilters("pd");
  destroyCharts();
  const c = ctx(), S = isoToDays(c.start), T = isoToDays(c.today);
  const list = filtered("pd");
  const cnt = $("#pdCount");
  if (cnt) cnt.textContent = rows.length ? `(${list.length}${list.length !== rows.length ? " of " + rows.length : ""} action${rows.length === 1 ? "" : "s"})` : "";

  if (loadError) { host.innerHTML = `<div class="pd-empty">⚠ ${esc(loadMessage())}</div>`; return; }
  if (!rows.length) { host.innerHTML = `<div class="pd-empty">No roadmap data yet. A signed-in user can load it from the <b>Plan Progress</b> tab.</div>`; return; }
  if (!list.length) { host.innerHTML = `<div class="pd-empty">No actions match the current filters.</div>`; return; }

  const D = list.map(r => ({ r, d: derive(r, c) }));
  const n = D.length;
  const count = f => D.filter(f).length;
  const nDone = count(x => x.r.status === "Completed"), nProg = count(x => x.r.status === "In Progress");
  const nHold = count(x => x.r.status === "On Hold"), nTodo = count(x => x.r.status === "Not Started");
  const nEsc = count(x => x.r.status === "Escalated"), nNoRep = count(x => x.r.status === "No Reply");
  const nLate = count(x => x.d.health === "Delayed"), nRisk = count(x => x.d.health === "At risk");
  const overall = Math.round(avg(D.map(x => x.d.pct)));

  // plan vs actual (needs project start)
  const sched = D.filter(x => x.d.expected !== null);
  let variance = null, planned = 0, actualS = 0;
  if (sched.length) { planned = Math.round(avg(sched.map(x => x.d.expected * 100))); actualS = Math.round(avg(sched.map(x => x.d.pct))); variance = actualS - planned; }
  const sched_ = variance === null ? null : variance >= 5 ? ["Ahead of plan", COLORS.done] : variance >= -5 ? ["On schedule", COLORS.done] : variance >= -15 ? ["Slightly behind", COLORS.risk] : ["Behind schedule", COLORS.late];
  const ringColor = sched_ ? sched_[1] : COLORS.prog;
  const weekNow = S !== null && T >= S ? Math.floor((T - S) / 7) + 1 : null;
  const curPhase = PHASES.find(p => { const it = D.filter(x => x.r.phase === p); return it.length && !it.every(x => x.r.status === "Completed"); });

  const R = 54, C = 2 * Math.PI * R;
  const ring = `<svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Overall progress ${overall}%">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="#e5e7eb" stroke-width="14"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="${ringColor}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(overall / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 70 70)"/>
      <text x="70" y="68" text-anchor="middle" font-size="30" font-weight="800" fill="#111827">${overall}%</text>
      <text x="70" y="88" text-anchor="middle" font-size="11" fill="#6b7280">complete</text></svg>`;

  const planLine = variance === null
    ? `<div class="pd-hint">Plan-vs-actual appears once the Week 1 start date is set on the <b>Plan Progress</b> tab.</div>`
    : `<div class="pd-pva"><div><span>Planned by today</span><b>${planned}%</b></div><div><span>Actual</span><b>${actualS}%</b></div><div><span>Gap</span><b style="color:${sched_[1]}">${variance > 0 ? "+" : ""}${variance} pts</b></div></div>
       <div style="margin-top:6px"><span class="pd-badge" style="background:${tint(sched_[1], .13)};color:${sched_[1]}">${sched_[0]}</span></div>`;

  const hero = `<div class="pd-card pd-hero">
      <div class="pd-ring">${ring}</div>
      <div class="pd-hero-t">
        <div class="pd-kl">OVERALL ROADMAP PROGRESS</div>
        <div class="pd-headline">${nDone} of ${n} actions completed${curPhase ? ` · now in <b>${curPhase}</b> phase` : n === nDone ? " · 🎉 all done" : ""}</div>
        <div class="pd-asof">As of ${fmtDate(c.today)}${weekNow ? ` · <b>Week ${weekNow}</b>` : S !== null && T < S ? ` · starts ${fmtDate(c.start)}` : ""}</div>
        ${planLine}
      </div></div>`;

  const kpis = `<div class="pd-kpis">
      ${kpi("✅", "#dcfce7", "COMPLETED", nDone, `${Math.round(nDone / n * 100)}% of actions`, COLORS.done)}
      ${kpi("🔄", "#dbeafe", "IN PROGRESS", nProg, nHold ? `${nHold} on hold` : "Under way", COLORS.prog)}
      ${kpi("⏰", "#fee2e2", "DELAYED", nLate, nRisk ? `${nRisk} more at risk` : (S === null ? "Needs start date" : "Past due"), nLate ? COLORS.late : "#111827")}
      ${kpi("↑", "#ffe4e6", "ESCALATED", nEsc, "Raised to management", nEsc ? "#9f1239" : "#111827")}
      ${kpi("✉", "#ffedd5", "NO REPLY", nNoRep, "Waiting for a response", nNoRep ? "#9a3412" : "#111827")}
      ${kpi("📋", "#f1f5f9", "NOT STARTED", nTodo, `${count(x => x.d.health === "Unscheduled")} not scheduled`, "#475569")}
    </div>`;

  /* ---- phases ---- */
  const phaseCards = PHASES.map(p => {
    const it = D.filter(x => x.r.phase === p); if (!it.length) return "";
    const pc = Math.round(avg(it.map(x => x.d.pct))), col = PHASE_COLOR[p], h = aggHealth(it);
    return `<div class="pd-phase" style="border-top-color:${col}">
        <div class="pd-ph-n" style="color:${col}">${p.toUpperCase()}</div>
        <div class="pd-ph-v">${pc}%</div>
        <div class="pd-track"><i style="width:${pc}%;background:${col}"></i></div>
        <div class="pd-ph-s">${it.filter(x => x.r.status === "Completed").length}/${it.length} actions · ${weekRange(it)}</div>
        ${badge(h)}</div>`;
  }).join("");

  /* ---- milestones ---- */
  const msNames = [...new Set(D.map(x => x.r.milestone).filter(Boolean))];
  const msCards = msNames.map(name => {
    const it = D.filter(x => x.r.milestone === name), pc = Math.round(avg(it.map(x => x.d.pct)));
    const dues = it.map(x => x.d.dw).filter(w => w.k === "w").map(w => w.n);
    const dueWk = dues.length ? Math.max(...dues) : null;
    const dueDate = dueWk && S !== null ? fmtDate(daysToISO(S + dueWk * 7 - 1)) : "";
    return { name, pc, dueWk, html: `<div class="pd-ms">
        <div class="pd-ms-h"><span>★ ${esc(name)}</span>${badge(aggHealth(it))}</div>
        <div class="pd-ms-r">${it.map(x => esc(x.r.expected || x.r.action)).join(" · ")}</div>
        <div class="pd-track pd-track-lg"><i style="width:${pc}%;background:${COLORS.ink}"></i></div>
        <div class="pd-ms-f"><b>${pc}%</b><span>${dueWk ? `Target: Week ${dueWk}${dueDate ? " (" + dueDate + ")" : ""}` : "Target: TBD"}</span></div></div>` };
  }).sort((a, b) => (a.dueWk ?? 9999) - (b.dueWk ?? 9999));

  /* ---- timeline (Gantt) ---- */
  const maxWk = Math.max(40, ...D.flatMap(x => [x.d.sw, x.d.dw]).filter(w => w.k === "w").map(w => w.n));
  const W = maxWk, pctOf = wk => (wk / W * 100).toFixed(3);
  const todayFrac = S !== null ? (T - S) / 7 : null;
  const todayLine = todayFrac !== null && todayFrac >= 0 && todayFrac <= W ? `<i class="pd-today" style="left:${pctOf(todayFrac)}%"></i>` : "";
  const ticks = Array.from({ length: W }, (_, i) => (i % 4 === 0 ? `<span style="left:${pctOf(i)}%">${i + 1}</span>` : "")).join("");
  const grid = `background-size:calc(100% / ${W}) 100%`;
  let gantt = `<div class="pd-g-head"><div class="pd-g-l">Action</div><div class="pd-g-lane pd-g-ticks">${ticks}${todayFrac !== null && todayFrac >= 0 && todayFrac <= W ? `<em style="left:${pctOf(todayFrac)}%">Today · Wk ${weekNow}</em>` : ""}</div><div class="pd-g-tbd">TBD</div></div>`;
  PHASES.forEach(p => {
    const it = D.filter(x => x.r.phase === p); if (!it.length) return;
    const col = PHASE_COLOR[p];
    gantt += `<div class="pd-g-ph" style="border-left-color:${col};background:${tint(col, .08)}"><b style="color:${col}">${p}</b><span>${it.length} action${it.length > 1 ? "s" : ""} · ${Math.round(avg(it.map(x => x.d.pct)))}% complete</span></div>`;
    it.forEach(({ r, d }) => {
      const hs = HEALTH_STYLE[d.health];
      const tip = `${displayId(r)} — ${r.action}\nResponsible: ${r.responsible || "—"}\nPlan: ${weekLabel(r.startWeek)} → ${weekLabel(r.dueWeek)}\nStatus: ${r.status} · ${d.pct}% · ${d.health}${d.daysLate ? ` (${d.daysLate} days)` : ""}${r.subDepartment ? "\nSub-department: " + r.subDepartment : ""}${r.subs.length ? `\nSub-actions: ${r.subs.filter(x => x.status === "Completed").length}/${r.subs.length} closed` : ""}${r.note ? "\nUpdate: " + r.note : ""}`;
      let lane = todayLine, tbd = "";
      const barCls = d.health === "Delayed" ? " late" : d.health === "At risk" ? " risk" : "";
      if (d.sw.k === "w" && d.dw.k === "w") {
        const s0 = d.sw.n - 1, len = Math.max(1, d.dw.n - d.sw.n + 1), end = s0 + len;
        const lbl = end / W > .9 ? `right:${(100 - s0 / W * 100 + .6).toFixed(2)}%` : `left:${(end / W * 100 + .6).toFixed(2)}%`;
        lane += `<div class="pd-bar${barCls}" style="left:${pctOf(s0)}%;width:${pctOf(len)}%;border-color:${col};background:${tint(col, .2)}"><i style="width:${d.pct}%;background:${col}"></i></div><span class="pd-bl" style="${lbl}">${d.pct}%</span>`;
      } else if (d.sw.k === "w") {
        const s0 = d.sw.n - 1, len = Math.min(3, W - s0);
        lane += `<div class="pd-bar open${barCls}" style="left:${pctOf(s0)}%;width:${pctOf(len)}%;border-color:${col};background:${tint(col, .2)}"><i style="width:${d.pct}%;background:${col}"></i></div><span class="pd-bl" style="left:${((s0 + len) / W * 100 + .6).toFixed(2)}%">due TBD${d.pct ? " · " + d.pct + "%" : ""}</span>`;
      } else if (d.sw.k === "ongoing" || d.dw.k === "ongoing") {
        lane += `<div class="pd-bar ongoing" style="left:0;width:100%;border-color:${col};background:repeating-linear-gradient(45deg,${tint(col, .18)} 0 6px,${tint(col, .06)} 6px 12px)"><b>Ongoing · ${r.status}${d.pct ? " · " + d.pct + "%" : ""}</b></div>`;
      } else {
        tbd = `<span class="pd-tbd" style="border-color:${col};color:${col}">${r.status === "Not Started" ? "TBD" : d.pct + "%"}</span>`;
      }
      gantt += `<div class="pd-g-row" title="${esc(tip)}">
          <div class="pd-g-l"><span class="pd-dot" style="background:${hs.bg};color:${hs.fg}" title="${d.health}">${hs.icon}</span><span class="pd-g-t"><small>${displayId(r)}</small> ${esc(r.action)}${r.subs.length ? ` <small>▸ ${r.subs.filter(x => x.status === "Completed").length}/${r.subs.length}</small>` : ""}</span></div>
          <div class="pd-g-lane" style="${grid}">${lane}</div><div class="pd-g-tbd">${tbd}</div></div>`;
    });
  });
  const legend = `<div class="pd-legend">${HEALTHS.filter(h => h !== "Unscheduled").map(h => badge(h)).join("")}<span class="pd-lg-note">Bar = planned window · solid fill = % complete${S !== null ? " · red line = today" : ""}</span></div>`;

  /* ---- lists ---- */
  const ORDER = { Escalated: 0, Delayed: 1, "No reply": 2, "At risk": 3, "On hold": 4 };
  const attn = D.filter(x => x.d.health in ORDER).sort((a, b) => ORDER[a.d.health] - ORDER[b.d.health] || b.d.daysLate - a.d.daysLate);
  const item = (x, line) => { const hs = HEALTH_STYLE[x.d.health]; return `<li><span class="pd-dot" style="background:${hs.bg};color:${hs.fg}">${hs.icon}</span><div><div class="pd-li-t">${esc(x.r.action)}</div><div class="pd-li-s">${line}</div>${x.r.note ? `<div class="pd-li-n">“${esc(x.r.note)}”</div>` : ""}</div></li>`; };
  const who = x => esc([x.r.responsible, x.r.subDepartment].filter(Boolean).join(" · "));
  const attnHtml = attn.length ? `<ul class="pd-list">${attn.slice(0, 8).map(x => item(x,
      x.d.health === "Escalated" ? `<b style="color:#9f1239">Escalated</b> · ${who(x)}`
        : x.d.health === "Delayed" ? `<b style="color:${COLORS.late}">${x.d.daysLate} days overdue</b> · ${who(x)}`
          : x.d.health === "No reply" ? `<b style="color:#9a3412">No reply</b> · ${who(x)}`
            : x.d.health === "At risk" ? `<b style="color:${COLORS.risk}">At risk</b> · ${x.d.pct}% vs ${Math.round((x.d.expected ?? 0) * 100)}% expected · ${who(x)}`
              : `<b style="color:#5b21b6">On hold</b> · ${who(x)}`)).join("")}</ul>${attn.length > 8 ? `<div class="pd-more">+${attn.length - 8} more</div>` : ""}`
    : `<div class="pd-ok">✅ Nothing is escalated, delayed, waiting for a reply, at risk or on hold.</div>`;

  const latest = D.filter(x => x.r.updatedAtMs && (x.r.status !== "Not Started" || x.r.note)).sort((a, b) => b.r.updatedAtMs - a.r.updatedAtMs).slice(0, 6);
  const latestHtml = latest.length ? `<ul class="pd-list">${latest.map(x => item(x, `${x.r.status} · ${x.d.pct}% · <span style="color:#6b7280">${timeAgo(x.r.updatedAtMs)}</span>`)).join("")}</ul>` : `<div class="pd-ok">No updates yet.</div>`;

  host.innerHTML = `
    <div class="pd-top">${hero}${kpis}</div>
    ${section("PHASE PROGRESS", "Define → Measure → Analysis → Improvement → Control", `<div class="pd-phases">${phaseCards}</div>`)}
    ${msCards.length ? section("MILESTONES", "Main milestones and the final deliverable", `<div class="pd-mss">${msCards.map(m => m.html).join("")}</div>`) : ""}
    ${section("ROADMAP TIMELINE", `Weeks ${S !== null ? "from " + fmtDate(c.start) : "from project start"} · hover a row for details`, `<div class="pd-gantt-scroll"><div class="pd-gantt">${gantt}</div></div>${legend}`)}
    <div class="pd-two">
      ${section("⚠ NEEDS ATTENTION", "Escalated, delayed, no reply, at risk or on hold", attnHtml)}
      ${section("🕒 LATEST UPDATES", "Most recently updated actions", latestHtml)}
    </div>`;
}

function wireDashboard() {
  const root = document.getElementById("planDashboard");
  if (!root || root.dataset.pdWired) return;
  root.dataset.pdWired = "1";
  populateFilters("pd");
  $("#pdSearch")?.addEventListener("input", renderDashboard);
  root.querySelectorAll("[data-pd-filter]").forEach(sel => sel.addEventListener("change", renderDashboard));
  $("#pdReset")?.addEventListener("click", () => { resetFilters("pd"); renderDashboard(); });
  $("#pdRefresh")?.addEventListener("click", renderDashboard);
}

/* =====================================================================
   Boot
   ===================================================================== */
const isShown = id => document.getElementById(id)?.classList.contains("active");
function renderAll() {
  if (isShown("planProgress")) renderEntry();
  const dm = document.getElementById("ppDetailBody");
  if (dm && !dm.contains(document.activeElement)) renderDetail();
  if (isShown("planDashboard")) renderDashboard();
}
function subscribe() {
  // Public read (see firestore.rules): no login needed for the dashboard.
  onSnapshot(collection(db, COL), snap => {
    rows = snap.docs.map(d => normRow(d.id, d.data()));
    loadError = ""; renderAll();
  }, err => { console.error("[plan-progress] snapshot", err); loadError = err.code || err.message || "error"; renderAll(); });
  // Attachment metadata is private: only read while signed in.
  onAuthStateChanged(auth, user => {
    if (unsubAtt) { unsubAtt(); unsubAtt = null; }
    if (!user) { atts = []; renderAll(); return; }
    unsubAtt = onSnapshot(collection(db, COL_ATT), snap => { atts = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); },
      err => console.warn("[plan-progress] attachments", err));
  });
  onSnapshot(doc(db, COL_SET, SET_DOC), snap => {
    const d = snap.exists() ? snap.data() : {};
    settings = { projectStart: isoToDays(d.projectStart) !== null ? d.projectStart : "" };
    renderAll();
  }, err => console.warn("[plan-progress] settings", err));
}
function boot() {
  wireEntry(); wireDashboard();
  document.querySelectorAll('.subtab[data-gasub="planProgress"],.subtab[data-gasub="planDashboard"]').forEach(btn =>
    btn.addEventListener("click", () => setTimeout(() => { if (btn.dataset.gasub === "planProgress") renderEntry(); else renderDashboard(); }, 30)));
  subscribe();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

} catch (err) { console.error("[plan-progress] failed to start", err); }
