// gap-assessment-dashboard.js — Gap Assessment Analytics & Executive Dashboard

import { db, collection, onSnapshot } from "./firebase.js";

const COL_GA = "gapAssessment";

let gaRows = [];
let unsubGa = null;
const charts = {};

const norm = v => String(v ?? "").trim();
const lc   = v => norm(v).toLowerCase();

function isYes(v) {
  const s = lc(v);
  return s === "yes" || s === "y" || s === "true" || s === "1";
}
function isNo(v) {
  const s = lc(v);
  return s === "no" || s === "n" || s === "false" || s === "0";
}
function severityOf(r) {
  const s = lc(r.severity);
  if (!s) return "";
  if (s.startsWith("crit")) return "Critical";
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med"))  return "Medium";
  if (s.startsWith("low"))  return "Low";
  return norm(r.severity);
}
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
function pctInt(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

/* ---------- KPIs ---------- */
function renderKpis() {
  const total = gaRows.length;
  const exists = gaRows.filter(r => isYes(r.exists)).length;
  const missing = gaRows.filter(r => isNo(r.exists)).length;
  const critical = gaRows.filter(r => severityOf(r) === "Critical").length;
  const automated = gaRows.filter(r => isYes(r.automated) || lc(r.status).includes("auto")).length;
  const evidence = gaRows.filter(r => isYes(r.evidenceExists) || isYes(r.hasEvidence) || isYes(r.evidence)).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("gadKpiTotal", total.toLocaleString());
  set("gadKpiMissing", missing.toLocaleString());
  set("gadKpiMissingSub", `${pct(missing, total)}% of total`);
  set("gadKpiCritical", critical.toLocaleString());
  set("gadKpiCompliance", `${pct(exists, total)}%`);
  set("gadKpiAutomation", `${pct(automated, total)}%`);
  set("gadKpiEvidence", `${pct(evidence, total)}%`);
}

/* ---------- Heatmap Table ---------- */
function heatColor(val, max) {
  if (!val) return "#dcfce7"; // green for 0
  const ratio = max > 0 ? val / max : 0;
  if (ratio >= 0.75) return "#b91c1c";  // deep red
  if (ratio >= 0.5)  return "#ef4444";
  if (ratio >= 0.25) return "#f97316";
  return "#fbbf24";
}
function heatText(val, max) {
  if (!val) return "#166534";
  const ratio = max > 0 ? val / max : 0;
  return ratio >= 0.5 ? "#fff" : "#111827";
}

function renderHeatmap() {
  const body = document.getElementById("gadHeatBody");
  if (!body) return;
  const owners = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    const sev = severityOf(r) || "Low";
    if (!owners[owner]) owners[owner] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    if (owners[owner][sev] !== undefined) owners[owner][sev]++;
  });
  const rows = Object.keys(owners).map(o => ({
    owner: o, ...owners[o],
    total: owners[o].Critical + owners[o].High + owners[o].Medium + owners[o].Low
  })).sort((a, b) => b.total - a.total);

  const totals = { Critical: 0, High: 0, Medium: 0, Low: 0, total: 0 };
  rows.forEach(r => {
    totals.Critical += r.Critical; totals.High += r.High;
    totals.Medium += r.Medium; totals.Low += r.Low; totals.total += r.total;
  });

  const maxes = {
    Critical: Math.max(1, ...rows.map(r => r.Critical)),
    High:     Math.max(1, ...rows.map(r => r.High)),
    Medium:   Math.max(1, ...rows.map(r => r.Medium)),
    Low:      Math.max(1, ...rows.map(r => r.Low)),
  };

  const cell = (v, max) => `<td style="padding:4px;text-align:center;border:1px solid #e5e7eb;background:${heatColor(v,max)};color:${heatText(v,max)};font-weight:700;">${v}</td>`;

  body.innerHTML = rows.map(r => `
    <tr>
      <td style="padding:4px 6px;border:1px solid #e5e7eb;font-weight:600;color:#111827;">${r.owner}</td>
      ${cell(r.Critical, maxes.Critical)}
      ${cell(r.High, maxes.High)}
      ${cell(r.Medium, maxes.Medium)}
      ${cell(r.Low, maxes.Low)}
      <td style="padding:4px;text-align:center;border:1px solid #e5e7eb;font-weight:800;background:#f8fafc;">${r.total}</td>
    </tr>
  `).join("") + `
    <tr style="background:#f1f5f9;font-weight:800;">
      <td style="padding:4px 6px;border:1px solid #e5e7eb;">TOTAL</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Critical}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.High}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Medium}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Low}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.total}</td>
    </tr>
  `;
}

/* ---------- Bar Chart ---------- */
function chart3() {
  const byOwner = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    byOwner[owner] = (byOwner[owner] || 0) + 1;
  });
  const owners = Object.keys(byOwner).sort((a, b) => byOwner[b] - byOwner[a]);
  const data = owners.map(o => byOwner[o]);
  destroy("gadChart3");
  const el = document.getElementById("gadChart3");
  if (!el) return;
  charts.gadChart3 = new Chart(el, {
    type: "bar",
    data: { labels: owners, datasets: [{ label: "Missing Processes", data, backgroundColor: "#1f3a8a", borderWidth: 0 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        datalabels: false,
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "# Missing Processes" } },
        y: { ticks: { autoSkip: false } }
      }
    },
  });
}

/* ---------- Insights ---------- */
function renderInsights() {
  const el = document.getElementById("gadInsights");
  if (!el) return;
  const critical = gaRows.filter(r => severityOf(r) === "Critical").length;

  const missingByOwner = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    missingByOwner[owner] = (missingByOwner[owner] || 0) + 1;
  });
  const ownerList = Object.keys(missingByOwner).sort((a, b) => missingByOwner[b] - missingByOwner[a]);
  const ownerBody = ownerList.length
    ? ownerList.map(o => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;"><span>${o}</span><strong style="color:#b91c1c;">${missingByOwner[o]}</strong></div>`).join("")
    : "No missing processes.";

  const card = (bg, border, iconBg, icon, title, titleColor, body) => `
    <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px;display:flex;gap:10px;align-items:flex-start;">
      <div style="width:34px;height:34px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;color:${titleColor};font-size:13px;margin-bottom:4px;">${title}</div>
        <div style="color:#374151;font-size:12px;line-height:1.4;">${body}</div>
      </div>
    </div>`;

  el.innerHTML = [
    card("#fef2f2", "#fecaca", "#fee2e2", "⚠️", `${critical} Critical Gaps`, "#b91c1c",
      "Immediate attention required for processes with critical severity."),
    card("#fff7ed", "#fed7aa", "#ffedd5", "🚫", "Non-Existing Processes by Owner", "#c2410c", ownerBody),
  ].join("");
}

/* ---------- Render orchestration ---------- */
function renderAll() {
  const empty = document.getElementById("gadEmpty");
  const content = document.getElementById("gadContent");
  const count = document.getElementById("gadCount");
  if (count) count.textContent = `(${gaRows.length} gap record${gaRows.length === 1 ? "" : "s"})`;

  if (!gaRows.length) {
    if (empty) empty.style.display = "block";
    if (content) content.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";
  if (content) content.style.display = "block";

  renderKpis();
  renderHeatmap();
  renderInsights();
  requestAnimationFrame(() => { chart3(); });
}

/* ---------- Wire ---------- */
function subscribe() {
  if (unsubGa) return;
  unsubGa = onSnapshot(collection(db, COL_GA), snap => {
    gaRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const panel = document.getElementById("gapAssessmentDashboard");
    if (panel && panel.style.display !== "none") renderAll();
  });
}

function init() {
  const panel = document.getElementById("gapAssessmentDashboard");
  if (!panel) return;
  subscribe();
  document.querySelectorAll('.subtab[data-gasub="gapAssessmentDashboard"]').forEach(btn => {
    btn.addEventListener("click", () => setTimeout(renderAll, 30));
  });
  const btn = document.getElementById("gadRefresh");
  if (btn) btn.addEventListener("click", renderAll);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
