// gap-assessment-dashboard.js — Gap Assessment Dashboard
// Renders 3 pie charts from Firestore collection "gapAssessment":
//   1. Existing processes Yes / No
//   2. Severity distribution
//   3. Missing processes by Process Owner

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

/* ---------- Charts ---------- */
function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function chart1() { // Pie — Existing Processes Yes/No
  let yes = 0, no = 0, blank = 0;
  gaRows.forEach(r => {
    if (isYes(r.exists)) yes++;
    else if (isNo(r.exists)) no++;
    else blank++;
  });
  const labels = ["Yes", "No"];
  const data = [yes, no];
  const colors = ["#16a34a", "#dc2626"];
  if (blank) { labels.push("Not Specified"); data.push(blank); colors.push("#94a3b8"); }
  destroy("gadChart1");
  charts.gadChart1 = new Chart(document.getElementById("gadChart1"), {
    type: "pie",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
}

function chart2() { // Pie — Severity Distribution
  const buckets = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  let other = 0;
  gaRows.forEach(r => {
    const s = severityOf(r);
    if (buckets.hasOwnProperty(s)) buckets[s]++;
    else if (s) other++;
  });
  const labels = Object.keys(buckets);
  const data = Object.values(buckets);
  const colors = ["#7f1d1d", "#dc2626", "#eab308", "#16a34a"];
  if (other) { labels.push("Other"); data.push(other); colors.push("#94a3b8"); }
  destroy("gadChart2");
  charts.gadChart2 = new Chart(document.getElementById("gadChart2"), {
    type: "pie",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
}

function chart3() { // Pie — Missing processes by Process Owner
  const byOwner = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return; // only missing processes
    const owner = norm(r.processOwner) || "Unassigned";
    byOwner[owner] = (byOwner[owner] || 0) + 1;
  });
  const owners = Object.keys(byOwner).sort((a, b) => byOwner[b] - byOwner[a]);
  const data = owners.map(o => byOwner[o]);
  const palette = ["#1f3a8a","#dc2626","#eab308","#16a34a","#8b5cf6","#0ea5e9","#f97316","#14b8a6","#e11d48","#6366f1","#84cc16","#a855f7"];
  const colors = owners.map((_, i) => palette[i % palette.length]);
  destroy("gadChart3");
  charts.gadChart3 = new Chart(document.getElementById("gadChart3"), {
    type: "pie",
    data: { labels: owners, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });
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
  requestAnimationFrame(() => { chart1(); chart2(); chart3(); });
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
