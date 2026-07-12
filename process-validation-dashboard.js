// process-validation-dashboard.js — Process Validation Dashboard
// Reads the same Firestore "processValidation" collection populated by
// process-validation.js and renders 5 analytical charts.

import { db, collection, onSnapshot } from "./firebase.js";

const COL = "processValidation";
let rows = [];
let unsub = null;
const charts = {}; // holds Chart.js instances by id

const yn = v => String(v || "").trim().toLowerCase();

/* ---------- Derivations ---------- */
function statusBucket(r) {
  const pe = yn(r.processExists), ev = yn(r.evidenceExists), au = yn(r.automated);
  if (pe !== "yes") return "Non-Existing";
  if (ev !== "yes") return "Non-Existing";
  return au === "yes" ? "Existing - Automated" : "Existing - Manual";
}

function heatColor(pe, ev, au) {
  pe = yn(pe); ev = yn(ev); au = yn(au);
  if (pe === "yes" && ev === "yes" && au === "yes") return "#16a34a"; // green
  if (pe === "yes" && ev === "yes" && au === "no")  return "#eab308"; // yellow
  return "#dc2626"; // red
}

/* ---------- Chart builders ---------- */
function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function chart1() {
  const c = { "Existing - Automated": 0, "Existing - Manual": 0, "Non-Existing": 0 };
  rows.forEach(r => { c[statusBucket(r)]++; });
  destroy("gdChart1");
  charts.gdChart1 = new Chart(document.getElementById("gdChart1"), {
    type: "doughnut",
    data: {
      labels: Object.keys(c),
      datasets: [{
        data: Object.values(c),
        backgroundColor: ["#16a34a", "#eab308", "#dc2626"],
        borderWidth: 1,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
}

function chart2() {
  const owners = {};
  rows.forEach(r => {
    const o = (r.processOwner || "Unassigned").trim() || "Unassigned";
    if (!owners[o]) owners[o] = { Automated: 0, Manual: 0, "Non-Implemented": 0 };
    const b = statusBucket(r);
    if (b === "Existing - Automated") owners[o].Automated++;
    else if (b === "Existing - Manual") owners[o].Manual++;
    else owners[o]["Non-Implemented"]++;
  });
  const labels = Object.keys(owners);
  destroy("gdChart2");
  charts.gdChart2 = new Chart(document.getElementById("gdChart2"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Automated",       data: labels.map(l => owners[l].Automated),         backgroundColor: "#16a34a" },
        { label: "Manual",          data: labels.map(l => owners[l].Manual),            backgroundColor: "#eab308" },
        { label: "Non-Implemented", data: labels.map(l => owners[l]["Non-Implemented"]), backgroundColor: "#dc2626" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true, ticks: { autoSkip: false, maxRotation: 45, minRotation: 30 } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function chart3() {
  let yes = 0, no = 0;
  rows.forEach(r => { if (yn(r.evidenceExists) === "yes") yes++; else no++; });
  destroy("gdChart3");
  charts.gdChart3 = new Chart(document.getElementById("gdChart3"), {
    type: "pie",
    data: {
      labels: ["Evidence Exists", "No Evidence"],
      datasets: [{ data: [yes, no], backgroundColor: ["#16a34a", "#dc2626"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
}

function chart4() {
  const types = { Procedures: 0, Policies: 0, "Work Instructions": 0, Forms: 0, Other: 0 };
  rows.forEach(r => {
    const t = String(r.docType || "").toLowerCase();
    if (t.includes("procedure")) types.Procedures++;
    else if (t.includes("polic")) types.Policies++;
    else if (t.includes("work") || t.includes("instruction")) types["Work Instructions"]++;
    else if (t.includes("form")) types.Forms++;
    else if (t) types.Other++;
  });
  if (!types.Other) delete types.Other;
  destroy("gdChart4");
  charts.gdChart4 = new Chart(document.getElementById("gdChart4"), {
    type: "bar",
    data: {
      labels: Object.keys(types),
      datasets: [{
        label: "Documents",
        data: Object.values(types),
        backgroundColor: ["#1f3a8a", "#3b82f6", "#0ea5e9", "#8b5cf6", "#64748b"],
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function heatmap() {
  // Rows = process owners (proxy for "departments"); columns = Process Exists / Evidence Exists / Automated
  // Aggregation: a cell is green if all rows for that owner are "yes", yellow if some are, red if none.
  const owners = {};
  rows.forEach(r => {
    const o = (r.processOwner || "Unassigned").trim() || "Unassigned";
    if (!owners[o]) owners[o] = { total: 0, pe: 0, ev: 0, au: 0 };
    owners[o].total++;
    if (yn(r.processExists) === "yes") owners[o].pe++;
    if (yn(r.evidenceExists) === "yes") owners[o].ev++;
    if (yn(r.automated) === "yes") owners[o].au++;
  });

  const cellColor = (count, total) => {
    if (total === 0) return "#e5e7eb";
    if (count === total) return "#16a34a";
    if (count > 0) return "#eab308";
    return "#dc2626";
  };

  const cols = ["Process Exists", "Evidence Exists", "Automated"];
  let html = `<table style="border-collapse:collapse;width:100%;font-size:13px;min-width:520px;">
    <thead><tr>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1;">Process Owner</th>
      ${cols.map(c => `<th style="padding:8px;border-bottom:2px solid #cbd5e1;">${c}</th>`).join("")}
    </tr></thead><tbody>`;
  const names = Object.keys(owners).sort();
  if (!names.length) {
    html += `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No data</td></tr>`;
  } else {
    names.forEach(n => {
      const o = owners[n];
      const cells = [
        cellColor(o.pe, o.total),
        cellColor(o.ev, o.total),
        cellColor(o.au, o.total),
      ];
      const counts = [`${o.pe}/${o.total}`, `${o.ev}/${o.total}`, `${o.au}/${o.total}`];
      html += `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${n}</td>
        ${cells.map((bg, i) => `<td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">
          <div style="display:inline-block;min-width:56px;padding:6px 10px;background:${bg};color:#fff;border-radius:6px;font-weight:600;">${counts[i]}</div>
        </td>`).join("")}
      </tr>`;
    });
  }
  html += `</tbody></table>`;
  document.getElementById("gdHeatmap").innerHTML = html;
}

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
  if (grid) grid.style.display = "grid";
  // Charts need to be built when their canvases are visible (subtab shown).
  requestAnimationFrame(() => {
    chart1(); chart2(); chart3(); chart4();
  });
}

/* ---------- Wire ---------- */
function subscribe() {
  if (unsub) return;
  unsub = onSnapshot(collection(db, COL), snap => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Only render if the panel is visible; otherwise defer to when user opens it.
    const panel = document.getElementById("gapDashboard");
    if (panel && panel.style.display !== "none") renderAll();
  });
}

function init() {
  const panel = document.getElementById("gapDashboard");
  if (!panel) return;
  subscribe();

  // Re-render when user activates the Process Validation Dashboard subtab.
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
