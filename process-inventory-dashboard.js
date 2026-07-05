/* Process Inventory Dashboard — executive view.
   Reads data from window.__piRecords (set by process-inventory.js) and
   listens to "pi:records" custom events for live updates. Uses Chart.js
   (already loaded in index.html). Filters are independent from the
   Inventory Searching page.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const charts = {};
  const PALETTE = ["#1f3a8a","#2563eb","#3b82f6","#60a5fa","#93c5fd",
                   "#0e7490","#0891b2","#06b6d4","#5b21b6","#7c3aed",
                   "#166534","#16a34a","#ca8a04","#ea580c","#dc2626"];

  /* ---------- Sub-tabs ---------- */
  function initSubTabs() {
    document.querySelectorAll("#processInventory .pi-subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        const which = btn.dataset.piSub;
        document.querySelectorAll("#processInventory .pi-subtab").forEach(b => b.classList.toggle("active", b === btn));
        $("piPanelSearch").classList.toggle("active", which === "search");
        $("piPanelDash").classList.toggle("active", which === "dash");
        if (which === "dash") setTimeout(render, 30);
      });
    });
  }

  /* ---------- Filters ---------- */
  function refreshFilterOptions(records) {
    const companies = new Set(), depts = new Set(), types = new Set(), issues = new Set();
    records.forEach(r => {
      (r.companies || []).forEach(c => c && companies.add(c));
      if (r.department) depts.add(r.department);
      if (r.documentType) types.add(r.documentType);
      if (r.issueNo != null && r.issueNo !== "") issues.add(String(r.issueNo));
    });
    fillSel("pidCompany", "All Companies", [...companies].sort());
    fillSel("pidDept",    "All Departments", [...depts].sort());
    fillSel("pidType",    "All Types", [...types].sort());
    fillSel("pidIssue",   "All Issues", [...issues].sort((a,b)=>Number(a)-Number(b)||a.localeCompare(b)));
  }
  function fillSel(id, ph, vals) {
    const el = $(id); if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${ph}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (vals.includes(cur)) el.value = cur;
  }
  function getFiltered() {
    const all = window.__piRecords || [];
    const q     = norm($("pidSearch")?.value);
    const fCo   = norm($("pidCompany")?.value);
    const fDept = norm($("pidDept")?.value);
    const fType = norm($("pidType")?.value);
    const fIss  = norm($("pidIssue")?.value);
    const fFrom = $("pidFrom")?.value || "";
    const fTo   = $("pidTo")?.value || "";
    return all.filter(r => {
      if (fCo   && !(r.companies || []).some(c => norm(c) === fCo)) return false;
      if (fDept && norm(r.department) !== fDept) return false;
      if (fType && norm(r.documentType) !== fType) return false;
      if (fIss  && norm(r.issueNo) !== fIss) return false;
      if (fFrom && (r.issueDate || "") < fFrom) return false;
      if (fTo   && (r.issueDate || "") > fTo) return false;
      if (!q) return true;
      const hay = [r.documentTitle, r.documentType, r.documentCode, r.issueNo,
                   r.issueDate, r.department, ...(r.companies || [])].map(norm).join(" | ");
      return hay.includes(q);
    });
  }

  /* ---------- Chart helpers ---------- */
  function destroy(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }
  function bar(id, labels, data, opts = {}) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: opts.color || PALETTE[1], borderRadius: 4 }] },
      options: { indexAxis: opts.horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { grid: { display: !opts.horizontal } }, y: { grid: { display: opts.horizontal } } } }
    });
  }
  function donut(id, labels, data) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: labels.map((_,i)=>PALETTE[i%PALETTE.length]) }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } } } }
    });
  }
  function line(id, labels, data) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: PALETTE[1], backgroundColor: "rgba(37,99,235,.12)",
              fill: true, tension: .35, pointBackgroundColor: PALETTE[0] }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } } }
    });
  }

  /* ---------- Aggregations ---------- */
  function ts(r) {
    const v = r.updatedAt || r.createdAt;
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v.seconds) return new Date(v.seconds * 1000);
    const d = new Date(v); return isNaN(d) ? null : d;
  }

  function render() {
    const all = window.__piRecords || [];
    refreshFilterOptions(all);
    const records = getFiltered();
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();

    /* KPIs */
    $("pidKpiTotal").textContent = records.length.toLocaleString();
    const compSet = new Set(); records.forEach(r => (r.companies || []).forEach(c => c && compSet.add(c)));
    $("pidKpiCompanies").textContent = compSet.size;
    const deptSet = new Set(records.map(r => r.department).filter(Boolean));
    $("pidKpiDepts").textContent = deptSet.size;
    const typeSet = new Set(records.map(r => r.documentType).filter(Boolean));
    $("pidKpiTypes").textContent = typeSet.size;
    $("pidKpiTypesSub").textContent = [...typeSet].slice(0,3).join(", ") || "—";

    let updYear = 0, newMonth = 0;
    records.forEach(r => {
      const d = ts(r);
      if (d && d.getFullYear() === y) updYear++;
      const c = (r.createdAt && (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt.seconds ? r.createdAt.seconds*1000 : r.createdAt)));
      if (c && !isNaN(c) && c.getFullYear() === y && c.getMonth() === m) newMonth++;
    });
    $("pidKpiYear").textContent = updYear;
    $("pidKpiYearSub").textContent = records.length ? `${((updYear/records.length)*100).toFixed(1)}% of total` : "0%";
    $("pidKpiMonth").textContent = newMonth;
    $("pidKpiMonthSub").textContent = `Added in ${now.toLocaleString("en", { month: "long", year: "numeric" })}`;

    /* Processes by Company */
    const byCo = {}; records.forEach(r => (r.companies || []).forEach(c => { if (c) byCo[c] = (byCo[c]||0)+1; }));
    const coEntries = Object.entries(byCo).sort((a,b)=>b[1]-a[1]).slice(0,10);
    bar("pidChartCompany", coEntries.map(x=>x[0]), coEntries.map(x=>x[1]), { horizontal: true });

    /* Document Type Distribution */
    const byType = {}; records.forEach(r => { const t = r.documentType || "—"; byType[t]=(byType[t]||0)+1; });
    const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
    donut("pidChartType", typeEntries.map(x=>x[0]), typeEntries.map(x=>x[1]));

    /* Processes by Department */
    const byDept = {}; records.forEach(r => { const d = r.department || "—"; byDept[d]=(byDept[d]||0)+1; });
    const deptEntries = Object.entries(byDept).sort((a,b)=>b[1]-a[1]);
    donut("pidChartDept", deptEntries.map(x=>x[0]), deptEntries.map(x=>x[1]));

    /* Document Revision Status by Issue No */
    const buckets = { "Issue 1":0, "Issue 2":0, "Issue 3":0, "Issue 4":0, "Issue 5+":0 };
    records.forEach(r => {
      const n = parseInt(r.issueNo, 10);
      if (!isNaN(n)) {
        if (n <= 1) buckets["Issue 1"]++;
        else if (n === 2) buckets["Issue 2"]++;
        else if (n === 3) buckets["Issue 3"]++;
        else if (n === 4) buckets["Issue 4"]++;
        else buckets["Issue 5+"]++;
      }
    });
    donut("pidChartIssue", Object.keys(buckets), Object.values(buckets));

    /* Trend */
    renderTrend(records);

    /* Documents by Year */
    const byYear = {};
    records.forEach(r => {
      const yr = (r.issueDate || "").slice(0,4);
      if (/^\d{4}$/.test(yr)) byYear[yr] = (byYear[yr]||0)+1;
    });
    const yEntries = Object.entries(byYear).sort((a,b)=>a[0].localeCompare(b[0]));
    bar("pidChartYear", yEntries.map(x=>x[0]), yEntries.map(x=>x[1]));


    /* Recently updated */
    const withTs = records.map(r => ({ r, d: ts(r) })).filter(x=>x.d)
      .sort((a,b)=>b.d - a.d).slice(0,8);
    $("pidRecent").innerHTML = withTs.map(({r,d}) => `
      <tr><td>${esc(r.documentTitle)}</td><td>${d.toISOString().slice(0,10)}</td>
      <td style="text-align:right;">${(r.companies||[]).length}</td></tr>`).join("")
      || `<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:12px;">No data</td></tr>`;




    /* Insights */
    const shared2plus = records.filter(r => (r.companies||[]).length >= 2).length;
    const pct2plus = records.length ? Math.round((shared2plus/records.length)*100) : 0;
    const topCo = coEntries[0], topDept = deptEntries[0];
    const insights = [
      `${shared2plus} process${shared2plus===1?"":"es"} (${pct2plus}%) are shared by 2 or more companies.`,
      `${newMonth} new process${newMonth===1?"":"es"} added this month.`,
      `${updYear} process${updYear===1?"":"es"} updated this year.`,
      topCo ? `Top company: <strong>${esc(topCo[0])}</strong> with ${topCo[1]} processes.` : "",
      topDept ? `Largest inventory department: <strong>${esc(topDept[0])}</strong> (${topDept[1]}).` : "",
      `${compSet.size} compan${compSet.size===1?"y":"ies"} and ${deptSet.size} department${deptSet.size===1?"":"s"} covered.`
    ].filter(Boolean);
    $("pidInsights").innerHTML = insights.map(t => `<li>${t}</li>`).join("");
  }

  function renderTrend(records) {
    const range = $("pidTrendRange")?.value || "year";
    const now = new Date();
    let labels = [], counts = [];
    const getDate = r => (r.createdAt && (r.createdAt.toDate ? r.createdAt.toDate() :
      new Date(r.createdAt.seconds ? r.createdAt.seconds*1000 : r.createdAt))) || null;
    if (range === "month") {
      const days = now.getDate();
      labels = Array.from({length:days},(_,i)=>String(i+1));
      counts = Array(days).fill(0);
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        if (d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth()) counts[d.getDate()-1]++;
      });
    } else if (range === "year") {
      labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      counts = Array(12).fill(0);
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        if (d.getFullYear()===now.getFullYear()) counts[d.getMonth()]++;
      });
    } else {
      const map = {};
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        const k = String(d.getFullYear()); map[k]=(map[k]||0)+1;
      });
      const keys = Object.keys(map).sort();
      labels = keys; counts = keys.map(k=>map[k]);
    }
    line("pidChartTrend", labels, counts);
  }

  function clearFilters() {
    ["pidSearch","pidCompany","pidDept","pidType","pidIssue","pidFrom","pidTo"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    render();
  }

  function boot() {
    if (typeof Chart === "undefined") { setTimeout(boot, 200); return; }
    initSubTabs();
    ["pidSearch","pidCompany","pidDept","pidType","pidIssue","pidFrom","pidTo"].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });
    $("pidClear")?.addEventListener("click", clearFilters);
    $("pidTrendRange")?.addEventListener("change", () => renderTrend(getFiltered()));
    $("pidFullReport")?.addEventListener("click", () => window.print());
    window.addEventListener("pi:records", () => {
      if ($("piPanelDash")?.classList.contains("active")) render();
      else refreshFilterOptions(window.__piRecords || []);
    });
    // initial
    refreshFilterOptions(window.__piRecords || []);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
