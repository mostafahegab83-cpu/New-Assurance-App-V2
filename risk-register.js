/* Risk Register — Master Log
   Firestore collection: "risk_register"
   All fields are free text. Header has per-column filters.
   Excel import/export (SheetJS) + PDF export (jsPDF).
*/
import {
  db, auth, ADMIN_EMAILS,
  collection, doc, setDoc, deleteDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "./firebase.js";

(function () {
  "use strict";

  const COLLECTION = "risk_register";

  // Column definitions — order matters (table + excel + pdf use this list)
  const COLUMNS = [
    { id: "riskId",              label: "Risk ID" },
    { id: "riskDescription",     label: "Risk Description" },
    { id: "ncId",                label: "NC ID" },
    { id: "affectedDepartment",  label: "Affected Department" },
    { id: "affectedProcess",     label: "Affected Process" },
    { id: "impactArea",          label: "Impact Area" },
    { id: "riskLevel",           label: "Risk Level" },
    { id: "existingControls",    label: "Existing Controls" },
    { id: "riskOwner",           label: "Risk Owner" },
    { id: "mitigationStatus",    label: "Mitigation Status" },
    { id: "linkedCapaId",        label: "Linked CAPA ID" },
    { id: "currentRiskStatus",   label: "Current Risk Status" }
  ];

  let rows = [];
  const filters = Object.fromEntries(COLUMNS.map(c => [c.id, ""]));

  const colRef = collection(db, COLLECTION);

  /* ---------- helpers ---------- */
  const escHtml = s => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const currentEmail = () => (window.__session && window.__session.email) || "";
  const isAdmin = () =>
    !!(window.__session && window.__session.isAdmin) ||
    ADMIN_EMAILS.includes(currentEmail());
  const writeAudit = (action, recordId, extra) => {
    if (typeof window.__writeAudit === "function") {
      try { window.__writeAudit(action, recordId, { collection: COLLECTION, ...(extra || {}) }); } catch (e) {}
    }
  };
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) { console.log(msg); return; }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------- DOM build (tab + section) ---------- */
  function ensureTabAndPanel() {
    // Tab button
    if (!document.querySelector('.tab[data-tab="risk"]')) {
      const tabsNav = document.querySelector(".tabs");
      const adminBtn = tabsNav.querySelector('[data-tab="admin"]');
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.role = "tab";
      btn.dataset.tab = "risk";
      btn.textContent = "Risk Register";
      tabsNav.insertBefore(btn, adminBtn || tabsNav.querySelector("#logoutBtn"));
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("risk").classList.add("active");
        render();
      });
    }

    // Panel
    if (!document.getElementById("risk")) {
      const main = document.querySelector("main.container");
      const section = document.createElement("section");
      section.id = "risk";
      section.className = "tab-panel";
      section.innerHTML = `
        <div class="toolbar">
          <button id="btnRiskNew" class="btn primary">+ Add Row</button>
          <label class="btn" title="Import .xlsx / .xls / .csv">
            Import Excel
            <input type="file" id="riskFileImport"
              accept=".xlsx,.xls,.csv" hidden />
          </label>
          <button id="btnRiskExportExcel" class="btn">Export Excel</button>
          <button id="btnRiskExportPdf" class="btn primary">Export PDF</button>
          <button id="btnRiskClearFilters" class="btn ghost">Clear Filters</button>
          ${"" /* admin-only delete-all handled in row buttons */}
          <span class="spacer"></span>
          <span class="muted" id="riskCount"></span>
        </div>

        <div class="table-wrap" id="riskTableWrap">
          <table id="riskTable">
            <thead>
              <tr id="riskHeaderRow"></tr>
              <tr id="riskFilterRow" class="filter-row"></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      `;
      main.appendChild(section);
    }

    // Build header + filter row
    const headRow = document.getElementById("riskHeaderRow");
    const filterRow = document.getElementById("riskFilterRow");
    if (!headRow.children.length) {
      headRow.innerHTML = COLUMNS.map(c => `<th>${escHtml(c.label)}</th>`).join("") +
        `<th style="width:120px;">Actions</th>`;
      filterRow.innerHTML = COLUMNS.map(c =>
        `<th><input type="text" data-filter="${c.id}" placeholder="Filter…" class="risk-filter-input" /></th>`
      ).join("") + `<th></th>`;
      filterRow.querySelectorAll("input[data-filter]").forEach(inp => {
        inp.addEventListener("input", () => {
          filters[inp.dataset.filter] = inp.value.trim().toLowerCase();
          renderBody();
        });
      });
    }

    // Wire toolbar buttons
    document.getElementById("btnRiskNew").onclick = addRow;
    document.getElementById("btnRiskExportExcel").onclick = exportExcel;
    document.getElementById("btnRiskExportPdf").onclick = exportPdf;
    document.getElementById("btnRiskClearFilters").onclick = clearFilters;
    document.getElementById("riskFileImport").onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (f) importExcel(f);
      e.target.value = "";
    };
  }

  function clearFilters() {
    COLUMNS.forEach(c => { filters[c.id] = ""; });
    document.querySelectorAll(".risk-filter-input").forEach(i => (i.value = ""));
    renderBody();
  }

  /* ---------- rendering ---------- */
  function getFilteredRows() {
    return rows.filter(r =>
      COLUMNS.every(c => {
        const f = filters[c.id];
        if (!f) return true;
        return String(r[c.id] || "").toLowerCase().includes(f);
      })
    );
  }

  function render() {
    ensureTabAndPanel();
    renderBody();
  }

  function renderBody() {
    const tbody = document.querySelector("#riskTable tbody");
    if (!tbody) return;
    const filtered = getFilteredRows();
    document.getElementById("riskCount").textContent =
      `${filtered.length} of ${rows.length} row(s)`;
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length + 1}"
        style="text-align:center;color:var(--muted);padding:24px">
        ${rows.length ? "No rows match current filters." :
          "No risks logged yet. Click \"+ Add Row\" to start."}
      </td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map(r => {
      const cells = COLUMNS.map(c =>
        `<td contenteditable="true" data-id="${r.id}" data-field="${c.id}"
            class="risk-cell ${c.id === "riskDescription" || c.id === "existingControls" ? "wrap" : ""}"
         >${escHtml(r[c.id])}</td>`
      ).join("");
      const del = isAdmin()
        ? `<button class="btn sm danger" data-del="${r.id}">Delete</button>`
        : `<span class="muted">—</span>`;
      return `<tr>${cells}<td>${del}</td></tr>`;
    }).join("");

    // Inline edit — save on blur if changed
    tbody.querySelectorAll(".risk-cell").forEach(td => {
      td.addEventListener("focus", () => { td.dataset.original = td.innerText; });
      td.addEventListener("blur", () => saveCell(td));
      td.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); td.blur(); }
        if (e.key === "Escape") {
          td.innerText = td.dataset.original || "";
          td.blur();
        }
      });
    });
    tbody.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => removeRow(b.dataset.del)));
  }

  /* ---------- CRUD ---------- */
  async function addRow() {
    const blank = { createdBy: currentEmail(), createdAt: new Date().toISOString() };
    COLUMNS.forEach(c => (blank[c.id] = ""));
    try {
      const docRef = await addDoc(colRef, blank);
      writeAudit("create", docRef.id);
      toast("Row added — fill cells inline");
    } catch (err) {
      console.error(err); toast("Add failed: " + (err.message || err.code));
    }
  }

  async function saveCell(td) {
    const id = td.dataset.id, field = td.dataset.field;
    const newVal = td.innerText.replace(/\s+\n/g, "\n").trim();
    const original = (td.dataset.original || "").trim();
    if (newVal === original) return;
    const r = rows.find(x => x.id === id);
    if (!r) return;
    try {
      const payload = {
        ...r, [field]: newVal,
        updatedBy: currentEmail(), updatedAt: new Date().toISOString()
      };
      delete payload.id;
      await setDoc(doc(db, COLLECTION, id), payload);
      writeAudit("update", id, { field });
    } catch (err) {
      console.error(err);
      toast("Save failed: " + (err.message || err.code));
      td.innerText = original;
    }
  }

  async function removeRow(id) {
    if (!isAdmin()) { toast("Only admins can delete rows"); return; }
    if (!confirm("Delete this risk row?")) return;
    try {
      await deleteDoc(doc(db, COLLECTION, id));
      writeAudit("delete", id);
      toast("Row deleted");
    } catch (err) {
      console.error(err); toast("Delete failed");
    }
  }

  /* ---------- Excel export ---------- */
  function exportExcel() {
    const data = getFilteredRows().map(r => {
      const o = {};
      COLUMNS.forEach(c => (o[c.label] = r[c.id] || ""));
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS.map(c => c.label) });
    // Auto column widths
    ws["!cols"] = COLUMNS.map(c => ({
      wch: Math.max(c.label.length + 2,
        Math.min(60, Math.max(12, ...data.map(d => String(d[c.label] || "").length))))
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risk Register");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    XLSX.writeFile(wb, `Risk_Register_${ts}.xlsx`);
  }

  /* ---------- Excel/CSV import ---------- */
  async function importExcel(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!json.length) { toast("No rows found in file"); return; }

      // Map headers (case/space-insensitive) → field id
      const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const labelMap = {};
      COLUMNS.forEach(c => {
        labelMap[norm(c.label)] = c.id;
        labelMap[norm(c.id)] = c.id;
      });

      if (!confirm(`Import ${json.length} row(s) from "${file.name}"? Existing rows are kept.`)) return;

      let ok = 0;
      for (const r of json) {
        const rec = { createdBy: currentEmail(), createdAt: new Date().toISOString() };
        COLUMNS.forEach(c => (rec[c.id] = ""));
        for (const key of Object.keys(r)) {
          const target = labelMap[norm(key)];
          if (target) rec[target] = String(r[key] ?? "").trim();
        }
        // Skip fully empty rows
        if (!COLUMNS.some(c => rec[c.id])) continue;
        try {
          const docRef = await addDoc(colRef, rec);
          writeAudit("import", docRef.id);
          ok++;
        } catch (e) { console.warn("row import failed", e); }
      }
      toast(`Imported ${ok} row(s)`);
    } catch (err) {
      console.error(err); toast("Import failed: " + (err.message || err.code));
    }
  }

  /* ---------- PDF export ---------- */
  async function exportPdf() {
    const { jsPDF } = window.jspdf;
    const data = getFilteredRows();
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;

    // Title block
    pdf.setFontSize(16); pdf.setTextColor(209, 32, 39);
    pdf.text("IDH — Risk Register / Master Log", margin, margin + 6);
    pdf.setFontSize(10); pdf.setTextColor(107, 114, 128);
    pdf.text(
      `Generated ${new Date().toLocaleString()}  ·  ${data.length} of ${rows.length} row(s)` +
        (currentEmail() ? `  ·  ${currentEmail()}` : ""),
      margin, margin + 22
    );

    // Column widths proportional to label length and contents (capped)
    const usableW = pageW - margin * 2;
    const weights = COLUMNS.map(c => {
      if (c.id === "riskDescription" || c.id === "existingControls") return 2.6;
      if (c.id === "affectedProcess" || c.id === "impactArea") return 1.6;
      return 1;
    });
    const wSum = weights.reduce((a, b) => a + b, 0);
    const colW = weights.map(w => (w / wSum) * usableW);

    const rowH = 16;
    let y = margin + 40;

    function drawHeader() {
      pdf.setFillColor(245, 247, 250);
      pdf.setDrawColor(227, 232, 239);
      pdf.setTextColor(31, 41, 55);
      pdf.setFontSize(9);
      let x = margin;
      COLUMNS.forEach((c, i) => {
        pdf.rect(x, y, colW[i], rowH, "FD");
        pdf.text(c.label, x + 4, y + 11, { maxWidth: colW[i] - 6 });
        x += colW[i];
      });
      y += rowH;
    }

    drawHeader();
    pdf.setFontSize(8);
    pdf.setTextColor(31, 41, 55);

    for (const r of data) {
      // measure row height per cell wrap
      const cellLines = COLUMNS.map((c, i) =>
        pdf.splitTextToSize(String(r[c.id] || ""), colW[i] - 6));
      const lines = Math.max(1, ...cellLines.map(l => l.length));
      const h = Math.max(rowH, lines * 10 + 4);
      if (y + h > pageH - margin) {
        pdf.addPage();
        y = margin;
        drawHeader();
        pdf.setFontSize(8);
      }
      let x = margin;
      COLUMNS.forEach((c, i) => {
        pdf.setDrawColor(227, 232, 239);
        pdf.rect(x, y, colW[i], h);
        pdf.text(cellLines[i], x + 3, y + 10);
        x += colW[i];
      });
      y += h;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    pdf.save(`Risk_Register_${ts}.pdf`);
  }

  /* ---------- realtime subscription ---------- */
  function subscribe() {
    try {
      const q = query(colRef, orderBy("riskId"));
      onSnapshot(q, snap => {
        rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Stable sort: empty riskId at the end
        rows.sort((a, b) => {
          const av = String(a.riskId || ""), bv = String(b.riskId || "");
          if (!av && bv) return 1;
          if (av && !bv) return -1;
          return av.localeCompare(bv, undefined, { numeric: true });
        });
        if (document.getElementById("risk")?.classList.contains("active")) renderBody();
        else document.getElementById("riskCount") && (document.getElementById("riskCount").textContent =
          `${rows.length} row(s)`);
      }, err => {
        console.error("risk_register snapshot error", err);
        toast("Sync error: " + (err.message || err.code));
      });
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    ensureTabAndPanel();
    subscribe();
  }

  // Wait until DOM ready + an auth session exists (the main app gates UI on login).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
