// process-validation-dashboard.js — Process Validation Dashboard
// Reads the same Firestore "processValidation" collection populated by
// process-validation.js and renders 4 analytical charts.

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

function rowSignature(r) {
  const parts = ["docTitle", "docType", "docCode", "processOwner", "companyName"].map(k => String(r[k] ?? "").trim().toLowerCase());
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
    rows = dedupeRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
