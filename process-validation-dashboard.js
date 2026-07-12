// process-validation-dashboard.js — Process Validation Dashboard
// Renders KPI cards, 100% stacked bar-chart table by Process Owner,
// and an Assurance Heat Map (Yes/No) view — matching the executive layout.

import { db, collection, onSnapshot } from "./firebase.js";

const COL = "processValidation";
let rows = [];
let unsub = null;

const yn = v => String(v || "").trim().toLowerCase();
const isYes = v => yn(v) === "yes";

/* ---------- Dedupe (same signature as process-validation.js) ---------- */
function rowSignature(r) {
  const parts = ["docTitle", "docType", "docCode", "processOwner", "companyName"]
    .map(k => String(r[k] ?? "").trim().toLowerCase());
  const key = parts.join("|");
  return parts.some(Boolean) ? key : `id:${r.id}`;
}
function rowTime(r) {
  const t = r.updatedAt || r.createdAt;
  if (typeof t?.seconds === "number") return t.seconds;
  if (typeof t?.toMillis === "function") return t.toMillis();
  return 0;
}
function dedupeRows(list) {
  const byKey = new Map();
  list.forEach(r => {
    const key = rowSignature(r);
    const prev = byKey.get(key);
    if (!prev || rowTime(r) >= rowTime(prev)) byKey.set(key, r);
  });
  return [...byKey.values()];
}

/* ---------- Helpers ---------- */
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

/* ---------- KPI cards ---------- */
function renderKpis() {
  const total = rows.length;
  const peY = rows.filter(r => isYes(r.processExists)).length;
  const evY = rows.filter(r => isYes(r.evidenceExists)).length;
  const auY = rows.filter(r => isYes(r.automated)).length;

  const pePct = pct(peY, total);
  const evPct = pct(evY, total);
  const auPct = pct(auY, total);

  setText("gdPePct", pePct + "%");
  setText("gdPeYes", pePct + "%");
  setText("gdPeNo", (100 - pePct) + "%");

  setText("gdEvPct", evPct + "%");
  setText("gdEvYes", evPct + "%");
  setText("gdEvNo", (100 - evPct) + "%");

  setText("gdAuPct", auPct + "%");
  setText("gdAuYes", auPct + "%");
  setText("gdAuNo", (100 - auPct) + "%");
}

/* ---------- Owner aggregation ---------- */
function ownerStats() {
  const map = {};
  rows.forEach(r => {
    const o = (r.processOwner || "Unassigned").trim() || "Unassigned";
    if (!map[o]) map[o] = { total: 0, pe: 0, ev: 0, au: 0 };
    const s = map[o];
    s.total++;
    if (isYes(r.processExists)) s.pe++;
    if (isYes(r.evidenceExists)) s.ev++;
    if (isYes(r.automated)) s.au++;
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, s]) => ({
      owner,
      total: s.total,
      pePct: pct(s.pe, s.total),
      evPct: pct(s.ev, s.total),
      auPct: pct(s.au, s.total),
    }));
}

/* ---------- 100% stacked bar rendering (HTML/CSS bars) ---------- */
function stackedBar(pctYes) {
  const yes = Math.max(0, Math.min(100, pctYes));
  const no = 100 - yes;
  const cell = (w, color, label) => w > 0
    ? `<div style="width:${w}%;background:${color};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:4px 2px;">${label}%</div>`
    : "";
  return `<div style="display:flex;width:100%;border-radius:4px;overflow:hidden;height:24px;">
    ${cell(yes, "#16a34a", yes)}
    ${cell(no, "#dc2626", no)}
  </div>`;
}

function renderStackTable() {
  const body = document.getElementById("gdStackBody");
  if (!body) return;
  const stats = ownerStats();
  if (!stats.length) { body.innerHTML = `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No data</td></tr>`; return; }
  body.innerHTML = stats.map(s => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:8px 10px;font-weight:600;color:#0f172a;">${s.owner}</td>
      <td style="padding:8px 10px;">${stackedBar(s.pePct)}</td>
      <td style="padding:8px 10px;">${stackedBar(s.evPct)}</td>
      <td style="padding:8px 10px;">${stackedBar(s.auPct)}</td>
    </tr>`).join("");
}

/* ---------- Heat map (Yes/No — majority per owner) ---------- */
function heatCell(pctYes) {
  const yes = pctYes >= 50;
  const bg = yes ? "#dcfce7" : "#fee2e2";
  const icon = yes
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;font-size:12px;font-weight:700;">✓</span>`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;font-size:12px;font-weight:700;">✕</span>`;
  const label = yes ? "Yes" : "No";
  return `<td style="padding:10px;background:${bg};">${icon} <span style="font-weight:600;color:#0f172a;">${label}</span></td>`;
}

function renderHeatTable() {
  const body = document.getElementById("gdHeatBody");
  if (!body) return;
  const stats = ownerStats();
  if (!stats.length) { body.innerHTML = `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No data</td></tr>`; return; }
  body.innerHTML = stats.map(s => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px;text-align:left;font-weight:600;color:#0f172a;">${s.owner}</td>
      ${heatCell(s.pePct)}
      ${heatCell(s.evPct)}
      ${heatCell(s.auPct)}
    </tr>`).join("");
}

/* ---------- Master render ---------- */
function renderAll() {
  const empty = document.getElementById("gdEmpty");
  const grid = document.getElementById("gdCharts");
  const count = document.getElementById("gdCount");
  if (count) count.textContent = `(${rows.length} record${rows.length === 1 ? "" : "s"})`;
  if (!rows.length) {
    if (empty) empty.style.display = "block";
    if (grid) grid.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";
  if (grid) grid.style.display = "block";
  renderKpis();
  renderStackTable();
  renderHeatTable();
}

/* ---------- Wire ---------- */
function subscribe() {
  if (unsub) return;
  unsub = onSnapshot(collection(db, COL), snap => {
    rows = dedupeRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    const panel = document.getElementById("gapDashboard");
    if (panel && panel.style.display !== "none") renderAll();
  });
}

function init() {
  const panel = document.getElementById("gapDashboard");
  if (!panel) return;
  subscribe();
  document.querySelectorAll('.subtab[data-gasub="gapDashboard"]').forEach(btn => {
    btn.addEventListener("click", () => setTimeout(renderAll, 30));
  });
  const btn = document.getElementById("gdRefresh");
  if (btn) btn.addEventListener("click", renderAll);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
