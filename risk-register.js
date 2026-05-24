/* Risk Register — Master Log
   Firestore collection: "risk_register"
   - "+ Add Row" opens a modal form (same style as the CAPA "New CAPA" modal)
   - Filter toolbar at the top (search + selects, like the CAPA filters)
   - Excel import/export (SheetJS) + PDF export (jsPDF)
*/
import {
  db, auth, ADMIN_EMAILS,
  collection, doc, setDoc, deleteDoc, addDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "./firebase.js";

(function () {
  "use strict";

  const COLLECTION = "risk_register";

  // Column / field definitions — order matters (table + form + excel + pdf use this list)
  const COLUMNS = [
    { id: "riskId",              label: "Risk ID",            placeholder: "e.g. R-001" },
    { id: "riskDescription",     label: "Risk Description",   placeholder: "Describe the risk", full: true, textarea: true, rows: 3 },
    { id: "ncId",                label: "NC ID",              placeholder: "N/A" },
    { id: "affectedDepartment",  label: "Affected Department",placeholder: "e.g. Operations" },
    { id: "affectedProcess",     label: "Affected Process",   placeholder: "e.g. Sample handling" },
    { id: "impactArea",          label: "Impact Area",        placeholder: "Patient / Financial / Compliance…" },
    { id: "riskLevel",           label: "Risk Level",         placeholder: "Low / Medium / High / Critical" },
    { id: "existingControls",    label: "Existing Controls",  placeholder: "Current mitigations in place", full: true, textarea: true, rows: 2 },
    { id: "riskOwner",           label: "Risk Owner",         placeholder: "Owner name / role" },
    { id: "mitigationStatus",    label: "Mitigation Status",  placeholder: "Not Started / In Progress / Implemented" },
    { id: "linkedCapaId",        label: "Linked CAPA ID",     placeholder: "e.g. CA-001" },
    { id: "currentRiskStatus",   label: "Current Risk Status",placeholder: "Open / Monitoring / Closed" }
  ];

  // Filter toolbar definitions (mirrors the CAPA register filter bar layout)
  const FILTERS = [
    { id: "search",            kind: "search", placeholder: "Search risks…" },
    { id: "riskLevel",         kind: "select", placeholder: "All Risk Levels",
      options: ["Low", "Medium", "High", "Critical"] },
    { id: "mitigationStatus",  kind: "select", placeholder: "All Mitigation Statuses",
      options: ["Not Started", "In Progress", "Implemented"] },
    { id: "currentRiskStatus", kind: "select", placeholder: "All Current Statuses",
      options: ["Open", "Monitoring", "Closed"] },
    { id: "riskOwner",         kind: "text",   placeholder: "Owner…" }
  ];

  let rows = [];
  const filterValues = Object.fromEntries(FILTERS.map(f => [f.id, ""]));

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

  /* ---------- DOM build (tab + section + modal) ---------- */
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

      // Top filter toolbar (like CAPA screenshot)
      const filterControls = FILTERS.map(f => {
        if (f.kind === "search") {
          return `<input type="search" data-rfilter="${f.id}" placeholder="${escHtml(f.placeholder)}" />`;
        }
        if (f.kind === "select") {
          const opts = `<option value="">${escHtml(f.placeholder)}</option>` +
            f.options.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("");
          return `<select data-rfilter="${f.id}">${opts}</select>`;
        }
        return `<input type="text" data-rfilter="${f.id}" placeholder="${escHtml(f.placeholder)}" />`;
      }).join("");

      section.innerHTML = `
        <div class="filters" id="riskFilters">
          ${filterControls}
          <button id="btnRiskClearFilters" class="btn ghost">Clear</button>
          <span class="spacer"></span>
          <button id="btnRiskExportExcel" class="btn">Export to Excel</button>
          <button id="btnRiskExportPdf" class="btn primary">Export to PDF</button>
        </div>

        <div class="toolbar">
          <button id="btnRiskNew" class="btn primary">+ Add Row</button>
          <label class="btn" title="Import .xlsx / .xls / .csv">
            Import Excel
            <input type="file" id="riskFileImport" accept=".xlsx,.xls,.csv" hidden />
          </label>
          ${isAdmin() ? `<button id="btnRiskClearAll" class="btn danger">Clear All</button>` : ""}
          <span class="spacer"></span>
          <span class="muted" id="riskCount"></span>
        </div>

        <div class="table-wrap" id="riskTableWrap">
          <table id="riskTable">
            <thead>
              <tr id="riskHeaderRow"></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <!-- Risk edit modal (same structure as CAPA modal) -->
        <div id="riskModal" class="capa-modal" style="display:none;">
          <div class="capa-modal-card">
            <div class="capa-modal-head">
              <h3 id="riskModalTitle">New Risk</h3>
              <button type="button" class="btn ghost" id="riskModalClose">✕</button>
            </div>
            <form id="riskForm" class="record-form" autocomplete="off" style="box-shadow:none;padding:0;">
              <input type="hidden" id="risk_doc_id" />
              <div class="grid">
                ${COLUMNS.map(c => {
                  const cls = c.full ? "full" : "";
                  const ctrl = c.textarea
                    ? `<textarea id="risk_${c.id}" rows="${c.rows || 2}" placeholder="${escHtml(c.placeholder || "")}"></textarea>`
                    : `<input type="text" id="risk_${c.id}" placeholder="${escHtml(c.placeholder || "")}" />`;
                  return `<label class="${cls}">${escHtml(c.label)}${ctrl}</label>`;
                }).join("")}
              </div>
              <div class="form-actions">
                <button type="submit" class="btn primary">Save Risk</button>
                <button type="button" class="btn ghost" id="riskFormReset">Reset</button>
              </div>
            </form>
          </div>
        </div>
      `;
      main.appendChild(section);
    }

    // Build header row (no inline-edit, no per-column filter row anymore)
    const headRow = document.getElementById("riskHeaderRow");
    if (!headRow.children.length) {
      headRow.innerHTML =
        COLUMNS.map(c => `<th>${escHtml(c.label)}</th>`).join("") +
        `<th style="width:140px;">Actions</th>`;
    }

    // Wire toolbar buttons
    document.getElementById("btnRiskNew").onclick = () => openModal();
    document.getElementById("btnRiskExportExcel").onclick = exportExcel;
    document.getElementById("btnRiskExportPdf").onclick = exportPdf;
    document.getElementById("btnRiskClearFilters").onclick = clearFilters;
    const clearAllBtn = document.getElementById("btnRiskClearAll");
    if (clearAllBtn) clearAllBtn.onclick = clearAll;
    document.getElementById("riskFileImport").onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (f) importExcel(f);
      e.target.value = "";
    };

    // Wire filter inputs
    document.querySelectorAll("#riskFilters [data-rfilter]").forEach(el => {
      el.addEventListener("input", () => {
        filterValues[el.dataset.rfilter] = el.value.trim().toLowerCase();
        renderBody();
      });
      el.addEventListener("change", () => {
        filterValues[el.dataset.rfilter] = el.value.trim().toLowerCase();
        renderBody();
      });
    });

    // Modal wiring
    document.getElementById("riskModalClose").onclick = closeModal;
    document.getElementById("riskModal").addEventListener("click", e => {
      if (e.target.id === "riskModal") closeModal();
    });
    document.getElementById("riskFormReset").onclick = () => {
      document.getElementById("riskForm").reset();
      document.getElementById("risk_doc_id").value = "";
    };
    document.getElementById("riskForm").addEventListener("submit", onSubmitForm);
  }

  function clearFilters() {
    FILTERS.forEach(f => { filterValues[f.id] = ""; });
    document.querySelectorAll("#riskFilters [data-rfilter]").forEach(el => (el.value = ""));
    renderBody();
  }

  /* ---------- rendering ---------- */
  function getFilteredRows() {
    return rows.filter(r => {
      // generic search across all columns
      const q = filterValues.search;
      if (q && !COLUMNS.some(c => String(r[c.id] || "").toLowerCase().includes(q))) return false;
      // exact-ish per-field filters
      for (const f of FILTERS) {
        if (f.id === "search") continue;
        const v = filterValues[f.id];
        if (!v) continue;
        const cell = String(r[f.id] || "").toLowerCase();
        if (f.kind === "select") { if (cell !== v) return false; }
        else { if (!cell.includes(v)) return false; }
      }
      return true;
    });
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
      `${filtered.length} of ${rows.length} risk(s)`;
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
        `<td class="${c.id === "riskDescription" || c.id === "existingControls" ? "wrap" : ""}">${escHtml(r[c.id])}</td>`
      ).join("");
      const del = isAdmin()
        ? `<button class="btn sm danger" data-del="${r.id}">Del</button>`
        : "";
      return `<tr>${cells}<td>
        <button class="btn sm" data-edit="${r.id}">Edit</button>
        ${del}
      </td></tr>`;
    }).join("");

    tbody.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => openModal(b.dataset.edit)));
    tbody.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => removeRow(b.dataset.del)));
  }

  /* ---------- modal open/close + submit ---------- */
  function openModal(id) {
    const modal = document.getElementById("riskModal");
    const title = document.getElementById("riskModalTitle");
    const form = document.getElementById("riskForm");
    form.reset();
    document.getElementById("risk_doc_id").value = "";
    if (id) {
      const r = rows.find(x => x.id === id);
      if (r) {
        title.textContent = "Edit Risk";
        document.getElementById("risk_doc_id").value = r.id;
        COLUMNS.forEach(c => {
          const el = document.getElementById("risk_" + c.id);
          if (el) el.value = r[c.id] || "";
        });
      }
    } else {
      title.textContent = "New Risk";
    }
    modal.style.display = "flex";
  }
  function closeModal() {
    document.getElementById("riskModal").style.display = "none";
  }

  async function onSubmitForm(e) {
    e.preventDefault();
    const id = document.getElementById("risk_doc_id").value;
    const payload = {};
    COLUMNS.forEach(c => {
      const el = document.getElementById("risk_" + c.id);
      payload[c.id] = el ? String(el.value || "").trim() : "";
    });
    const now = new Date().toISOString();
    try {
      if (id) {
        const existing = rows.find(x => x.id === id) || {};
        const full = {
          ...existing, ...payload,
          updatedBy: currentEmail(), updatedAt: now,
          createdBy: existing.createdBy || currentEmail(),
          createdAt: existing.createdAt || now
        };
        delete full.id;
        await setDoc(doc(db, COLLECTION, id), full);
        writeAudit("update", id, { riskId: payload.riskId });
        toast("Risk updated");
      } else {
        const docRef = await addDoc(colRef, {
          ...payload,
          createdBy: currentEmail(), createdAt: now,
          updatedBy: currentEmail(), updatedAt: now
        });
        writeAudit("create", docRef.id, { riskId: payload.riskId });
        toast("Risk added");
      }
      closeModal();
    } catch (err) {
      console.error(err);
      toast("Save failed: " + (err.message || err.code));
    }
  }

  /* ---------- delete ---------- */
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

  async function clearAll() {
    if (!isAdmin()) { toast("Only admins can clear all rows"); return; }
    if (!rows.length) return;
    if (!confirm("Delete ALL risk rows? This cannot be undone.")) return;
    try {
      for (const r of rows.slice()) {
        await deleteDoc(doc(db, COLLECTION, r.id));
      }
      writeAudit("clear_all", null, { scope: "risk_register" });
      toast("All risks cleared");
    } catch (err) {
      console.error(err); toast("Clear failed");
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

    pdf.setFontSize(16); pdf.setTextColor(209, 32, 39);
    pdf.text("IDH — Risk Register / Master Log", margin, margin + 6);
    pdf.setFontSize(10); pdf.setTextColor(107, 114, 128);
    pdf.text(
      `Generated ${new Date().toLocaleString()}  ·  ${data.length} of ${rows.length} row(s)` +
        (currentEmail() ? `  ·  ${currentEmail()}` : ""),
      margin, margin + 22
    );

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
        rows.sort((a, b) => {
          const av = String(a.riskId || ""), bv = String(b.riskId || "");
          if (!av && bv) return 1;
          if (av && !bv) return -1;
          return av.localeCompare(bv, undefined, { numeric: true });
        });
        if (document.getElementById("risk")?.classList.contains("active")) renderBody();
        else {
          const c = document.getElementById("riskCount");
          if (c) c.textContent = `${rows.length} risk(s)`;
        }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
