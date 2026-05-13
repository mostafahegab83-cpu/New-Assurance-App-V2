/* Compliance & Risk Tracker
   Vanilla JS · LocalStorage · Chart.js · CSV import/export · PDF export · Attachments */
(function () {
  "use strict";

  const STORAGE_KEY = "compliance_tracker_v2";
  const NA = "N/A";
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_EXT = ["msg","eml","xlsx","xls","docx","doc","pdf"];
  const ALLOWED_MIME = [
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-outlook",
    "message/rfc822"
  ];

  const FIELDS = [
    { id: "userName",       label: "User Name",            kind: "text" },
    { id: "processName",    label: "Process Name",         kind: "text" },
    { id: "processPhase",   label: "Process Phase",        kind: "text" },
    { id: "dayWeek",        label: "Day/Week",             kind: "raw"  },
    { id: "controlItem",    label: "Control / Checklist",  kind: "raw"  },
    { id: "department",     label: "Department",           kind: "text" },
    { id: "subDepartment",  label: "Sub-Department",       kind: "text" },
    { id: "owner",          label: "Owner",                kind: "text" },
    { id: "evidence",       label: "Required Evidence",    kind: "raw"  },
    { id: "targetSla",      label: "Target SLA",           kind: "raw"  },
    { id: "actualSla",      label: "Actual SLA",           kind: "raw"  },
    { id: "compliance",     label: "Compliance Status",    kind: "raw"  },
    { id: "ncDescription",  label: "NC Description",       kind: "raw"  },
    { id: "riskExist",      label: "Risk Exist",           kind: "raw"  },
    { id: "riskType",       label: "Risk Type",            kind: "raw"  },
    { id: "riskLevel",      label: "Risk Level",           kind: "raw"  },
    { id: "mitigation",     label: "Mitigation Status",    kind: "raw"  },
    { id: "findings",       label: "Findings / Gaps",      kind: "raw"  },
    { id: "capaNeeded",     label: "CAPA Needed",          kind: "raw"  },
    { id: "capaType",       label: "CAPA Type",            kind: "raw"  },
    { id: "capaDue",        label: "CAPA Due Date",        kind: "raw"  },
    { id: "effectiveness",  label: "Effectiveness",        kind: "raw"  },
    { id: "comments",       label: "Comments",             kind: "raw"  },
  ];

  let records = load();
  let pendingAttachments = []; // attachments staged for the form being edited
  const charts = {};

  /* ---------- Storage ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
    catch (e) { toast("Storage full — attachments may be too large"); }
  }

  /* ---------- Helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const titleCase = s => s.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, c => c.toUpperCase());

  function normalize(value, kind) {
    if (value == null) return NA;
    const v = String(value).trim();
    if (!v) return NA;
    if (kind === "text") return titleCase(v);
    return v.replace(/\s+/g, " ");
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function fileExt(name) {
    const m = /\.([^.]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function iconClass(ext) {
    if (ext === "pdf") return "pdf";
    if (ext === "doc" || ext === "docx") return "doc";
    if (ext === "xls" || ext === "xlsx") return "xls";
    if (ext === "msg" || ext === "eml") return "eml";
    return "";
  }
  function iconLabel(ext) { return (ext || "?").toUpperCase().slice(0,4); }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function badgeClass(field, value) {
    const v = String(value);
    if (field === "compliance") {
      if (v === "Compliant") return "green";
      if (v === "Non-Compliant") return "red";
      if (v === "Partially Compliant") return "amber";
    }
    if (field === "riskLevel") {
      if (v === "Low") return "green";
      if (v === "Medium") return "amber";
      if (v === "High") return "red";
    }
    if (field === "riskExist" || field === "capaNeeded") {
      if (v === "Yes") return "red";
      if (v === "No")  return "green";
    }
    if (field === "mitigation") {
      if (v === "Closed" || v === "Mitigated") return "green";
      if (v === "Open") return "red";
      if (v === "Accepted") return "amber";
    }
    if (field === "effectiveness") {
      if (v === "Effective") return "green";
      if (v === "Partially Effective") return "amber";
      if (v === "Ineffective") return "red";
    }
    return "gray";
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "dashboard") renderDashboard();
      if (tab.dataset.tab === "records") renderRecords();
    });
  });

  /* ---------- Datalists ---------- */
  function fillDataList(id, values) {
    const dl = document.getElementById(id);
    dl.innerHTML = [...new Set(values.filter(v => v && v !== NA))]
      .sort().map(v => `<option value="${v.replace(/"/g,'&quot;')}">`).join("");
  }
  function updateDataLists() {
    fillDataList("dlUser",          records.map(r => r.userName));
    fillDataList("dlProcess",       records.map(r => r.processName));
    fillDataList("dlPhase",         records.map(r => r.processPhase));
    fillDataList("dlDepartment",    records.map(r => r.department));
    fillDataList("dlSubDepartment", records.map(r => r.subDepartment));
    fillDataList("dlOwner",         records.map(r => r.owner));

    const sel = document.getElementById("filterDepartment");
    const cur = sel.value;
    const deps = [...new Set(records.map(r => r.department).filter(v => v && v !== NA))].sort();
    sel.innerHTML = `<option value="">All Departments</option>` +
      deps.map(v => `<option>${v}</option>`).join("");
    sel.value = cur;
  }

  /* ---------- Attachments ---------- */
  function isAllowed(file) {
    const ext = fileExt(file.name);
    if (!ALLOWED_EXT.includes(ext)) return false;
    // Some browsers report empty mime for .msg — accept based on extension.
    return true;
  }

  function readFileAsDataURL(file, onProgress) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function handleFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    const prog = document.getElementById("uploadProgress");
    const fill = document.getElementById("uploadFill");
    const text = document.getElementById("uploadText");
    prog.hidden = false;

    let done = 0;
    for (const file of list) {
      if (!isAllowed(file)) {
        toast(`Unsupported file type: ${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name} exceeds 10 MB limit`);
        continue;
      }
      try {
        text.textContent = `Uploading ${file.name}…`;
        const data = await readFileAsDataURL(file, p => {
          fill.style.width = (((done + p) / list.length) * 100).toFixed(0) + "%";
        });
        pendingAttachments.push({
          id: uid(),
          name: file.name,
          type: file.type || "",
          size: file.size,
          uploadedAt: new Date().toISOString(),
          data
        });
        done++;
        fill.style.width = ((done / list.length) * 100).toFixed(0) + "%";
        renderAttachmentList();
      } catch (err) {
        toast(`Failed to read ${file.name}`);
      }
    }
    text.textContent = `${done} of ${list.length} uploaded`;
    setTimeout(() => { prog.hidden = true; fill.style.width = "0%"; }, 1200);
  }

  function renderAttachmentList() {
    const ul = document.getElementById("attachmentList");
    if (!pendingAttachments.length) { ul.innerHTML = ""; return; }
    ul.innerHTML = pendingAttachments.map(a => {
      const ext = fileExt(a.name);
      const date = a.uploadedAt ? new Date(a.uploadedAt).toLocaleString() : "";
      return `<li class="attach-item">
        <div class="attach-icon ${iconClass(ext)}">${iconLabel(ext)}</div>
        <div class="attach-meta">
          <div class="attach-name">${escHtml(a.name)}</div>
          <div class="attach-sub">${formatBytes(a.size)} · ${date}</div>
        </div>
        <div class="attach-actions">
          <button type="button" class="btn sm" data-view="${a.id}">View</button>
          <button type="button" class="btn sm" data-dl="${a.id}">Download</button>
          <button type="button" class="btn sm danger" data-rm="${a.id}">Remove</button>
        </div>
      </li>`;
    }).join("");
    ul.querySelectorAll("[data-view]").forEach(b =>
      b.addEventListener("click", () => openAttachment(findPending(b.dataset.view))));
    ul.querySelectorAll("[data-dl]").forEach(b =>
      b.addEventListener("click", () => downloadAttachment(findPending(b.dataset.dl))));
    ul.querySelectorAll("[data-rm]").forEach(b =>
      b.addEventListener("click", () => {
        pendingAttachments = pendingAttachments.filter(a => a.id !== b.dataset.rm);
        renderAttachmentList();
      }));
  }
  const findPending = id => pendingAttachments.find(a => a.id === id);

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:([^;]+)/) || [,"application/octet-stream"])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function openAttachment(a) {
    if (!a) return;
    const url = URL.createObjectURL(dataUrlToBlob(a.data));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function downloadAttachment(a) {
    if (!a) return;
    const url = URL.createObjectURL(dataUrlToBlob(a.data));
    const link = document.createElement("a");
    link.href = url; link.download = a.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Drag & drop
  const dz = document.getElementById("dropzone");
  ["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add("drag");
  }));
  ["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove("drag");
  }));
  dz.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
  document.getElementById("fileAttach").addEventListener("change", e => {
    handleFiles(e.target.files); e.target.value = "";
  });

  /* ---------- Form ---------- */
  const form = document.getElementById("recordForm");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const id = document.getElementById("recordId").value || uid();
    const rec = { id };
    FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      rec[f.id] = normalize(el ? el.value : "", f.kind);
    });
    rec.attachments = pendingAttachments.slice();
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) records[idx] = rec; else records.push(rec);
    save();
    updateDataLists();
    form.reset();
    document.getElementById("recordId").value = "";
    pendingAttachments = [];
    renderAttachmentList();
    toast(idx >= 0 ? "Record updated" : "Record saved");
    document.querySelector('[data-tab="records"]').click();
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    form.reset();
    document.getElementById("recordId").value = "";
    pendingAttachments = [];
    renderAttachmentList();
  });

  function editRecord(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    document.getElementById("recordId").value = r.id;
    FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      el.value = r[f.id] === NA ? "" : (r[f.id] ?? "");
    });
    pendingAttachments = (r.attachments || []).map(a => ({ ...a }));
    renderAttachmentList();
    document.querySelector('[data-tab="form"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteRecord(id) {
    if (!confirm("Delete this record?")) return;
    records = records.filter(r => r.id !== id);
    save();
    renderRecords();
    updateDataLists();
    toast("Record deleted");
  }

  /* ---------- Records table ---------- */
  const escHtml = s => String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  function renderRecords() {
    const tbody = document.querySelector("#recordsTable tbody");
    document.getElementById("recordsCount").textContent = `${records.length} record(s)`;
    if (!records.length) {
      tbody.innerHTML = `<tr><td colspan="25" style="text-align:center;color:var(--muted);padding:24px">No records yet. Use the “Add / Edit” tab to create one.</td></tr>`;
      return;
    }
    const badge = (f, v) => `<span class="badge ${badgeClass(f, v)}">${escHtml(v)}</span>`;
    const evidenceCell = v => (v && v !== NA && /^https?:\/\//i.test(v))
      ? `<a href="${escHtml(v)}" target="_blank" rel="noopener">link</a>` : escHtml(v);

    tbody.innerHTML = records.map(r => {
      const atts = r.attachments || [];
      const filesCell = atts.length
        ? `<div class="files-cell">${atts.map(a =>
            `<span class="files-chip" data-rec="${r.id}" data-att="${a.id}" title="${escHtml(a.name)}">${escHtml(a.name.length > 18 ? a.name.slice(0,15) + "…" : a.name)}</span>`
          ).join("")}</div>`
        : `<span class="muted">—</span>`;
      return `
      <tr>
        <td>${escHtml(r.userName)}</td>
        <td>${escHtml(r.processName)}</td>
        <td>${escHtml(r.processPhase)}</td>
        <td>${escHtml(r.dayWeek)}</td>
        <td class="wrap">${escHtml(r.controlItem)}</td>
        <td>${escHtml(r.department)}</td>
        <td>${escHtml(r.subDepartment)}</td>
        <td>${escHtml(r.owner)}</td>
        <td>${evidenceCell(r.evidence)}</td>
        <td>${escHtml(r.targetSla)}</td>
        <td>${escHtml(r.actualSla)}</td>
        <td>${badge("compliance", r.compliance)}</td>
        <td class="wrap">${escHtml(r.ncDescription)}</td>
        <td>${badge("riskExist", r.riskExist)}</td>
        <td>${escHtml(r.riskType)}</td>
        <td>${badge("riskLevel", r.riskLevel)}</td>
        <td>${badge("mitigation", r.mitigation)}</td>
        <td class="wrap">${escHtml(r.findings)}</td>
        <td>${badge("capaNeeded", r.capaNeeded)}</td>
        <td>${escHtml(r.capaType)}</td>
        <td>${escHtml(r.capaDue)}</td>
        <td>${badge("effectiveness", r.effectiveness)}</td>
        <td class="wrap">${escHtml(r.comments)}</td>
        <td>${filesCell}</td>
        <td>
          <button class="btn sm" data-edit="${r.id}">Edit</button>
          <button class="btn sm danger" data-del="${r.id}">Del</button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => editRecord(b.dataset.edit)));
    tbody.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => deleteRecord(b.dataset.del)));
    tbody.querySelectorAll(".files-chip").forEach(chip =>
      chip.addEventListener("click", () => {
        const r = records.find(x => x.id === chip.dataset.rec);
        const a = r && (r.attachments || []).find(x => x.id === chip.dataset.att);
        if (a) openAttachment(a);
      }));
  }

  /* ---------- Filters & Dashboard ---------- */
  function getFiltered() {
    const q   = document.getElementById("filterSearch").value.toLowerCase().trim();
    const dep = document.getElementById("filterDepartment").value;
    const com = document.getElementById("filterCompliance").value;
    const rl  = document.getElementById("filterRiskLevel").value;
    const mit = document.getElementById("filterMitigation").value;
    return records.filter(r => {
      if (dep && r.department !== dep) return false;
      if (com && r.compliance !== com) return false;
      if (rl  && r.riskLevel  !== rl)  return false;
      if (mit && r.mitigation !== mit) return false;
      if (!q) return true;
      return Object.values(r).some(v =>
        v && typeof v !== "object" && String(v).toLowerCase().includes(q));
    });
  }

  ["filterSearch","filterDepartment","filterCompliance","filterRiskLevel","filterMitigation"]
    .forEach(id => document.getElementById(id).addEventListener("input", renderDashboard));

  document.getElementById("clearFilters").addEventListener("click", () => {
    ["filterSearch","filterDepartment","filterCompliance","filterRiskLevel","filterMitigation"]
      .forEach(id => document.getElementById(id).value = "");
    renderDashboard();
  });

  function counts(arr, field, includeNA = true) {
    return arr.reduce((acc, r) => {
      const k = r[field] || NA;
      if (!includeNA && (k === NA || !k)) return acc;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  }

  function renderDashboard() {
    const data = getFiltered();
    document.getElementById("kpiTotal").textContent        = data.length;
    document.getElementById("kpiCapaNeeded").textContent   = data.filter(r => r.capaNeeded === "Yes").length;
    document.getElementById("kpiRiskExists").textContent   = data.filter(r => r.riskExist === "Yes").length;
    document.getElementById("kpiNonCompliant").textContent = data.filter(r => r.compliance === "Non-Compliant").length;

    drawBar("chartRiskType", counts(data, "riskType", false));
    drawDoughnut("chartMitigation", counts(data, "mitigation", false));
    drawCapaGauge("chartCapa", data);
    drawDoughnut("chartEffectiveness", counts(data, "effectiveness", false));
    drawRiskLevelPie("chartRiskLevel", counts(data, "riskLevel", false));

    // Snapshot table for PDF
    const tbody = document.querySelector("#pdfTable tbody");
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${escHtml(r.processName)}</td>
        <td>${escHtml(r.department)}</td>
        <td>${escHtml(r.owner)}</td>
        <td>${escHtml(r.compliance)}</td>
        <td>${escHtml(r.riskLevel)}</td>
        <td>${escHtml(r.mitigation)}</td>
        <td>${escHtml(r.capaNeeded)}</td>
        <td>${escHtml(r.effectiveness)}</td>
      </tr>`).join("");
  }

  const palette = ["#d12027","#2563eb","#f97316","#16a34a","#06b6d4","#7c3aed","#db2777","#d97706","#6b7280"];

  function drawBar(id, obj) {
    const ctx = document.getElementById(id);
    const labels = Object.keys(obj);
    const values = Object.values(obj);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function drawDoughnut(id, obj) {
    const ctx = document.getElementById(id);
    const labels = Object.keys(obj);
    const values = Object.values(obj);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } }
    });
  }

  function drawRiskLevelPie(id, obj) {
    const order = ["High", "Medium", "Low"];
    const colorMap = { High: "#dc2626", Medium: "#f59e0b", Low: "#16a34a" };
    const labels = order.filter(k => obj[k]);
    const values = labels.map(k => obj[k]);
    const colors = labels.map(k => colorMap[k]);
    const total = values.reduce((a, b) => a + b, 0);
    const ctx = document.getElementById(id);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed;
                const pct = total ? ((v / total) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${v} (${pct}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: "pieDataLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.fillStyle = "#fff";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          meta.data.forEach((arc, i) => {
            const v = values[i];
            if (!v) return;
            const pct = total ? ((v / total) * 100).toFixed(0) : 0;
            const { x, y } = arc.tooltipPosition();
            ctx.fillText(`${v} (${pct}%)`, x, y);
          });
          ctx.restore();
        }
      }]
    });
  }

  function drawCapaGauge(id, data) {
    const today = new Date(); today.setHours(0,0,0,0);
    const assessed = ["Effective", "Partially Effective", "Ineffective"];
    const needed = data.filter(r => r.capaNeeded === "Yes");
    const done = needed.filter(r => {
      if (!assessed.includes(r.effectiveness)) return false;
      const d = r.capaDue ? new Date(r.capaDue) : null;
      if (!d || isNaN(d)) return false;
      d.setHours(0,0,0,0);
      return d <= today;
    }).length;
    const pct = needed.length ? Math.round((done / needed.length) * 100) : 0;
    document.getElementById("capaPctLabel").textContent = `${pct}%`;
    const ctx = document.getElementById(id);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["Completed", "Remaining"],
        datasets: [{ data: [pct, 100 - pct],
          backgroundColor: ["#16a34a","#e5e7eb"], borderWidth: 0 }] },
      options: { circumference: 180, rotation: 270, cutout: "70%",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } }
    });
  }

  /* ---------- PDF Export ---------- */
  function activeFiltersText() {
    const parts = [];
    const map = {
      filterSearch: "Search", filterDepartment: "Dept",
      filterCompliance: "Compliance", filterRiskLevel: "Risk Level",
      filterMitigation: "Mitigation"
    };
    Object.keys(map).forEach(id => {
      const v = document.getElementById(id).value;
      if (v) parts.push(`${map[id]}: ${v}`);
    });
    return parts.length ? parts.join(" · ") : "None";
  }

  async function exportPdf() {
    const orientation = document.getElementById("pdfOrientation").value;
    const scope = document.getElementById("pdfScope").value;
    const capture = document.getElementById("dashboardCapture");

    document.getElementById("pdfMeta").textContent =
      `Exported: ${new Date().toLocaleString()} · Filters: ${activeFiltersText()}`;

    // Toggle visibility per scope
    capture.classList.add("exporting");
    capture.querySelectorAll("[data-section]").forEach(el => {
      el.style.display = (scope === "all" || scope === el.dataset.section) ? "" : "none";
    });

    try {
      toast("Generating PDF…");
      await new Promise(r => setTimeout(r, 150));
      const canvas = await html2canvas(capture, {
        scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false
      });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation, unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const imgW = pageW - margin * 2;
      const imgH = canvas.height * (imgW / canvas.width);
      const img = canvas.toDataURL("image/jpeg", 0.92);

      if (imgH <= pageH - margin * 2) {
        pdf.addImage(img, "JPEG", margin, margin, imgW, imgH);
      } else {
        // multi-page slicing
        const pageCanvas = document.createElement("canvas");
        const pageCtx = pageCanvas.getContext("2d");
        const sliceHpx = (pageH - margin * 2) * (canvas.width / imgW);
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHpx;
        let y = 0, first = true;
        while (y < canvas.height) {
          const h = Math.min(sliceHpx, canvas.height - y);
          pageCanvas.height = h;
          pageCtx.fillStyle = "#fff";
          pageCtx.fillRect(0, 0, pageCanvas.width, h);
          pageCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
          const slice = pageCanvas.toDataURL("image/jpeg", 0.92);
          if (!first) pdf.addPage();
          pdf.addImage(slice, "JPEG", margin, margin, imgW, h * (imgW / canvas.width));
          y += h; first = false;
        }
      }
      pdf.save(`compliance-dashboard-${new Date().toISOString().slice(0,10)}.pdf`);
      toast("PDF downloaded");
    } catch (e) {
      console.error(e);
      toast("PDF export failed");
    } finally {
      capture.classList.remove("exporting");
      capture.querySelectorAll("[data-section]").forEach(el => { el.style.display = ""; });
    }
  }
  document.getElementById("btnExportPdf").addEventListener("click", exportPdf);

  /* ---------- CSV ---------- */
  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCSV() {
    const data = getFiltered().length && (
      document.getElementById("filterSearch").value ||
      document.getElementById("filterDepartment").value ||
      document.getElementById("filterCompliance").value ||
      document.getElementById("filterRiskLevel").value ||
      document.getElementById("filterMitigation").value)
      ? getFiltered() : records;

    if (!data.length) return toast("No records to export");
    const header = ["id", ...FIELDS.map(f => f.label), "Attachments"];
    const lines = [header.join(",")];
    data.forEach(r => {
      const att = (r.attachments || []).map(a => a.name).join(" | ");
      lines.push([csvEscape(r.id), ...FIELDS.map(f => csvEscape(r[f.id])), csvEscape(att)].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-records-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${data.length} record(s)`);
  }
  function parseCSV(text) {
    const rows = []; let cur = [], val = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i+1] === '"') { val += '"'; i++; }
        else if (c === '"') inQ = false;
        else val += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { cur.push(val); val = ""; }
        else if (c === "\n" || c === "\r") {
          if (val !== "" || cur.length) { cur.push(val); rows.push(cur); cur = []; val = ""; }
          if (c === "\r" && text[i+1] === "\n") i++;
        } else val += c;
      }
    }
    if (val !== "" || cur.length) { cur.push(val); rows.push(cur); }
    return rows;
  }
  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) return toast("CSV is empty");
      const header = rows[0].map(h => h.trim());
      let added = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.length || row.every(v => !v)) continue;
        const obj = {};
        header.forEach((h, idx) => obj[h] = row[idx] ?? "");
        const rec = { id: obj.id || obj.ID || uid(), attachments: [] };
        FIELDS.forEach(f => {
          const matchKey = Object.keys(obj).find(k => k.toLowerCase() === f.label.toLowerCase()) || f.id;
          rec[f.id] = normalize(obj[matchKey], f.kind);
        });
        const idx = records.findIndex(r => r.id === rec.id);
        if (idx >= 0) {
          rec.attachments = records[idx].attachments || [];
          records[idx] = rec;
        } else records.push(rec);
        added++;
      }
      save();
      updateDataLists();
      renderRecords();
      renderDashboard();
      toast(`Imported ${added} record(s)`);
    };
    reader.readAsText(file);
  }

  document.getElementById("btnExport").addEventListener("click", exportCSV);
  document.getElementById("fileImport").addEventListener("change", e => {
    if (e.target.files[0]) importCSV(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btnClearAll").addEventListener("click", () => {
    if (!records.length) return;
    if (!confirm("Delete ALL records? This cannot be undone.")) return;
    records = [];
    save();
    updateDataLists();
    renderRecords();
    renderDashboard();
    toast("All records cleared");
  });

  /* ---------- Init ---------- */
  updateDataLists();
  renderDashboard();
  renderRecords();
})();
