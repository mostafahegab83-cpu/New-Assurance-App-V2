// gap-assessment-dashboard.js — Gap Assessment Dashboard
// Reads Firestore "gapAssessment" (primary) and "processValidation" (executive KPIs)
// and renders KPI cards, charts, and summary tables.

import { db, collection, onSnapshot } from "./firebase.js";

const COL_GA = "gapAssessment";
const COL_PV = "processValidation";

let gaRows = [];
let pvRows = [];
let unsubGa = null;
let unsubPv = null;
const charts = {};

const yn = v => String(v || "").trim().toLowerCase();
const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

/* ---------- Derivations ---------- */
// Severity/priority from gap text
function severity(r) {
  const exists = yn(r.existsInIDH);
  const gap = String(r.gapIdentified || "").toLowerCase().trim();
  if (exists !== "yes") return "Critical";                 // missing process
  if (!gap) return "None";                                 // no gap
  if (/(missing process|major|critical|absent|no policy|no sop)/.test(gap)) return "High";
  if (/(control|partial|incomplete|weak|update|review)/.test(gap)) return "Medium";
  return "Low";
}

function gapStatus(r) {
  const exists = yn(r.existsInIDH);
  const gap = String(r.gapIdentified || "").trim();
  if (exists !== "yes") return "Missing";
  if (!gap) return "Fully Implemented";
  const sev = severity(r);
  if (sev === "High") return "Major Gap";
  return "Partial Gap";
}

function functionOf(r) {
  // Use relatedPolicy as function; fallback to first token of processName
  const p = String(r.relatedPolicy || "").trim();
  if (p) return p;
  const n = String(r.processName || "").trim();
  return n.split(/[\s\-\/]+/)[0] || "Unassigned";
}

function riskScore(r) {
  return { Critical:5, High:4, Medium:3, Low:2, None:0 }[severity(r)] || 0;
}

/* ---------- KPIs ---------- */
function computeKpis() {
  const total = gaRows.length;
  const existing = gaRows.filter(r => yn(r.existsInIDH) === "yes").length;
  const missing = gaRows.filter(r => yn(r.existsInIDH) !== "yes").length;
  const withGaps = gaRows.filter(r => yn(r.existsInIDH) === "yes" && String(r.gapIdentified||"").trim()).length;
  const fullyImpl = existing - withGaps;
  const compliance = total ? Math.round((fullyImpl / total) * 100) : 0;
  const critical = gaRows.filter(r => severity(r) === "Critical" || severity(r) === "High").length;
  const totalGaps = gaRows.filter(r => severity(r) !== "None").length;

  // From PV
  const pvTotal = pvRows.length;
  const pvEvidence = pvRows.filter(r => yn(r.evidenceExists) === "yes").length;
  const pvAutomated = pvRows.filter(r => yn(r.automated) === "yes").length;
  const pvExisting = pvRows.filter(r => yn(r.processExists) === "yes").length;
  const evidencePct = pvTotal ? Math.round((pvEvidence / pvTotal) * 100) : 0;
  const automationPct = pvExisting ? Math.round((pvAutomated / pvExisting) * 100) : 0;

  return { total, existing, missing, withGaps, fullyImpl, compliance, critical, totalGaps, evidencePct, automationPct };
}

function renderKpis(k) {
  const cards = [
    { label: "Total Processes",  value: k.total,          color: "#1f3a8a" },
    { label: "Compliance %",     value: k.compliance + "%", color: k.compliance >= 85 ? "#16a34a" : k.compliance >= 70 ? "#eab308" : "#dc2626" },
    { label: "Automation %",     value: k.automationPct + "%", color: "#0ea5e9" },
    { label: "Evidence %",       value: k.evidencePct + "%", color: "#8b5cf6" },
    { label: "Total Gaps",       value: k.totalGaps,      color: "#dc2626" },
  ];
  document.getElementById("gadKpis").innerHTML = cards.map(c => `
    <div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">${c.label}</div>
      <div style="font-size:28px;font-weight:700;color:${c.color};margin-top:4px;">${c.value}</div>
    </div>`).join("");
}

/* ---------- Charts ---------- */
function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function chart1() { // Donut - Gap Status
  const buckets = { "Fully Implemented":0, "Partial Gap":0, "Major Gap":0, "Missing":0 };
  gaRows.forEach(r => { buckets[gapStatus(r)]++; });
  destroy("gadChart1");
  charts.gadChart1 = new Chart(document.getElementById("gadChart1"), {
    type: "doughnut",
    data: { labels: Object.keys(buckets), datasets: [{
      data: Object.values(buckets),
      backgroundColor: ["#16a34a","#eab308","#f97316","#dc2626"], borderWidth:1
    }]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:"bottom" } } },
  });
}

function chart2() { // Horizontal bar - Gap Count by Function
  const funcs = {};
  gaRows.forEach(r => {
    if (severity(r) === "None") return;
    const f = functionOf(r);
    funcs[f] = (funcs[f] || 0) + 1;
  });
  const labels = Object.keys(funcs).sort((a,b) => funcs[b]-funcs[a]).slice(0, 12);
  destroy("gadChart2");
  charts.gadChart2 = new Chart(document.getElementById("gadChart2"), {
    type: "bar",
    data: { labels, datasets: [{ label:"Gaps", data: labels.map(l => funcs[l]), backgroundColor: "#1f3a8a" }] },
    options: {
      responsive:true, maintainAspectRatio:false, indexAxis:"y",
      plugins:{ legend:{ display:false } },
      scales: { x: { beginAtZero:true, ticks:{ precision:0 } } },
    },
  });
}

function chart3() { // Bar - Top High-Risk Gaps
  const scored = gaRows
    .filter(r => severity(r) !== "None")
    .map(r => ({ name: r.processName || "(unnamed)", score: riskScore(r), sev: severity(r) }))
    .sort((a,b) => b.score - a.score)
    .slice(0, 10);
  const color = s => ({ Critical:"#7f1d1d", High:"#dc2626", Medium:"#eab308", Low:"#16a34a" }[s] || "#64748b");
  destroy("gadChart3");
  charts.gadChart3 = new Chart(document.getElementById("gadChart3"), {
    type: "bar",
    data: {
      labels: scored.map(s => s.name),
      datasets: [{ label:"Risk Score", data: scored.map(s => s.score), backgroundColor: scored.map(s => color(s.sev)) }],
    },
    options: {
      responsive:true, maintainAspectRatio:false, indexAxis:"y",
      plugins:{ legend:{ display:false } },
      scales:{ x:{ beginAtZero:true, max:5, ticks:{ stepSize:1 } } },
    },
  });
}

function chart5() { // Stacked column - Gap Severity Distribution by Function
  const funcs = {};
  gaRows.forEach(r => {
    const sev = severity(r);
    if (sev === "None") return;
    const f = functionOf(r);
    if (!funcs[f]) funcs[f] = { Critical:0, High:0, Medium:0, Low:0 };
    funcs[f][sev]++;
  });
  const labels = Object.keys(funcs).sort((a,b) => {
    const sa = Object.values(funcs[a]).reduce((x,y)=>x+y,0);
    const sb = Object.values(funcs[b]).reduce((x,y)=>x+y,0);
    return sb - sa;
  }).slice(0, 10);
  destroy("gadChart5");
  charts.gadChart5 = new Chart(document.getElementById("gadChart5"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label:"Critical", data: labels.map(l => funcs[l].Critical), backgroundColor:"#7f1d1d" },
        { label:"High",     data: labels.map(l => funcs[l].High),     backgroundColor:"#dc2626" },
        { label:"Medium",   data: labels.map(l => funcs[l].Medium),   backgroundColor:"#eab308" },
        { label:"Low",      data: labels.map(l => funcs[l].Low),      backgroundColor:"#16a34a" },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:"bottom" } },
      scales:{ x:{ stacked:true, ticks:{ autoSkip:false, maxRotation:45, minRotation:30 } }, y:{ stacked:true, beginAtZero:true, ticks:{ precision:0 } } },
    },
  });
}

/* ---------- Tables ---------- */
function table1(k) {
  const rows = [
    ["Total Processes Reviewed", k.total],
    ["Existing Processes", k.existing],
    ["Processes with Gaps", k.withGaps],
    ["Missing Processes", k.missing],
    ["Compliance %", k.compliance + "%"],
  ];
  document.getElementById("gadTable1").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${rows.map(([m,v]) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${m}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1f3a8a;">${v}</td>
      </tr>`).join("")}
    </table>`;
}

function table2() {
  const list = gaRows
    .filter(r => severity(r) !== "None")
    .map(r => ({
      name: r.processName || "(unnamed)",
      exists: yn(r.existsInIDH) === "yes" ? "Yes" : "No",
      gap: r.gapIdentified || (yn(r.existsInIDH) !== "yes" ? "Missing Process" : ""),
      sev: severity(r),
    }))
    .sort((a,b) => ({Critical:0,High:1,Medium:2,Low:3}[a.sev] - {Critical:0,High:1,Medium:2,Low:3}[b.sev]));
  const badge = s => {
    const bg = { Critical:"#7f1d1d", High:"#dc2626", Medium:"#eab308", Low:"#16a34a" }[s] || "#64748b";
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:#fff;font-size:11px;font-weight:600;">${s}</span>`;
  };
  document.getElementById("gadTable2").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px;">
      <thead style="background:#1f3a8a;color:#fff;">
        <tr>
          <th style="padding:8px 10px;text-align:left;">Process Name</th>
          <th style="padding:8px 10px;text-align:center;width:120px;">Existing in IDH</th>
          <th style="padding:8px 10px;text-align:left;">Gap Identified</th>
          <th style="padding:8px 10px;text-align:center;width:100px;">Priority</th>
        </tr>
      </thead>
      <tbody>
        ${list.length ? list.map(r => `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(r.name)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.exists}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(r.gap)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${badge(r.sev)}</td>
        </tr>`).join("") : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No gaps recorded.</td></tr>`}
      </tbody>
    </table>`;
}

function table3() {
  // Group by function: Total, Implemented (existsInIDH=yes & no gap), Gap
  const agg = {};
  gaRows.forEach(r => {
    const f = functionOf(r);
    if (!agg[f]) agg[f] = { total:0, impl:0, gap:0 };
    agg[f].total++;
    if (yn(r.existsInIDH) === "yes" && !String(r.gapIdentified||"").trim()) agg[f].impl++;
    else agg[f].gap++;
  });
  const names = Object.keys(agg).sort();
  document.getElementById("gadTable3").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead style="background:#f1f5f9;">
        <tr>
          <th style="padding:8px 10px;text-align:left;">Area</th>
          <th style="padding:8px 10px;text-align:center;">Total</th>
          <th style="padding:8px 10px;text-align:center;">Implemented</th>
          <th style="padding:8px 10px;text-align:center;">Gap</th>
        </tr>
      </thead>
      <tbody>
        ${names.length ? names.map(n => `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(n)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${agg[n].total}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${agg[n].impl}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${agg[n].gap}</td>
        </tr>`).join("") : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No data.</td></tr>`}
      </tbody>
    </table>`;
}

function table4() {
  const agg = {};
  gaRows.forEach(r => {
    const p = String(r.relatedPolicy || "").trim() || "(Unassigned)";
    if (!agg[p]) agg[p] = { linked:0, gaps:0 };
    agg[p].linked++;
    if (severity(r) !== "None") agg[p].gaps++;
  });
  const names = Object.keys(agg).sort();
  document.getElementById("gadTable4").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead style="background:#f1f5f9;">
        <tr>
          <th style="padding:8px 10px;text-align:left;">Policy / SOP</th>
          <th style="padding:8px 10px;text-align:center;width:160px;">Processes Linked</th>
          <th style="padding:8px 10px;text-align:center;width:140px;">Gaps Found</th>
        </tr>
      </thead>
      <tbody>
        ${names.length ? names.map(n => `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(n)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${agg[n].linked}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:${agg[n].gaps ? "#dc2626" : "#16a34a"};font-weight:600;">${agg[n].gaps}</td>
        </tr>`).join("") : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#6b7280;">No data.</td></tr>`}
      </tbody>
    </table>`;
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

  const k = computeKpis();
  renderKpis(k);
  table1(k); table2(); table3(); table4();
  requestAnimationFrame(() => { chart1(); chart2(); chart3(); chart5(); });
}

/* ---------- Wire ---------- */
function subscribe() {
  if (!unsubGa) {
    unsubGa = onSnapshot(collection(db, COL_GA), snap => {
      gaRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const panel = document.getElementById("gapAssessmentDashboard");
      if (panel && panel.style.display !== "none") renderAll();
    });
  }
  if (!unsubPv) {
    unsubPv = onSnapshot(collection(db, COL_PV), snap => {
      pvRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const panel = document.getElementById("gapAssessmentDashboard");
      if (panel && panel.style.display !== "none") renderAll();
    });
  }
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
