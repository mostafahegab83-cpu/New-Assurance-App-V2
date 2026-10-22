/* NC Register — Non-Conformity Master Log
   Mirrors the CAPA / Risk Register logic:
   - Static HTML markup lives in index.html (#nc tab/panel/modal)
   - Firestore collection: "nc_register"
   - setDoc with deterministic uid for new docs, writeBatch for Clear All
   - Realtime sync started/stopped via onAuthStateChanged
   - Excel import / Excel export / PDF export (html2canvas + jsPDF)
*/
import {
  db, auth, ADMIN_EMAILS,
  collection, doc, setDoc, deleteDoc,
  onSnapshot, writeBatch, query, orderBy,
  onAuthStateChanged
} from "./firebase.js";

(function () {
  "use strict";

  const NC_COLLECTION = "nc_register";
  let ncRecords = [];
  let unsubNc = null;

  // Column / field definitions — order matches PDF template
  const NC_FIELDS = [
    { id: "ncId",               label: "NC ID" },
    { id: "dateRaised",         label: "Date Raised" },
    { id: "raisedBy",           label: "Raised By" },
    { id: "department",         label: "Department" },
    { id: "processArea",        label: "Process Area" },
    { id: "ncDescription",      label: "Description of NC",  wrap: true },
    { id: "category",           label: "Category" },
    { id: "severity",           label: "Severity" },
    { id: "rootCause",          label: "Root Cause",         wrap: true },
    { id: "immediateAction",    label: "Immediate Action",   wrap: true },
    { id: "correctiveAction",   label: "Corrective Action",  wrap: true },
    { id: "preventiveAction",   label: "Preventive Action",  wrap: true },
    { id: "responsiblePerson",  label: "Responsible Person" },
    { id: "targetDate",         label: "Target Date" },
    { id: "status",             label: "Status" },
    { id: "closureDate",        label: "Closure Date" },
    { id: "verificationBy",     label: "Verification By" },
    { id: "comments",           label: "Comments",           wrap: true }
  ];

  const $ = (id) => document.getElementById(id);
  const escH = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function toastMsg(msg) {
    const el = $("toast"); if (!el) { console.log(msg); return; }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function isAdminNow() {
    return !!(window.__session && window.__session.isAdmin) ||
      ADMIN_EMAILS.includes(currentEmailNow());
  }
  function currentEmailNow() {
    return (window.__session && window.__session.email) || "(unknown)";
  }

  /* ---------- Filters ---------- */
  function getFilteredNc() {
    const q        = ($("ncFilterSearch")?.value || "").toLowerCase().trim();
    const cat      = ($("ncFilterCategory")?.value || "").toLowerCase();
    const sev      = ($("ncFilterSeverity")?.value || "").toLowerCase();
    const stat     = ($("ncFilterStatus")?.value || "").toLowerCase();
    const owner    = ($("ncFilterOwner")?.value || "").toLowerCase().trim();
    return ncRecords.filter(r => {
      if (cat   && (r.category || "").toLowerCase() !== cat) return false;
      if (sev   && (r.severity || "").toLowerCase() !== sev) return false;
      if (stat  && (r.status   || "").toLowerCase() !== stat) return false;
      if (owner && !(r.responsiblePerson || "").toLowerCase().includes(owner)) return false;
      if (!q) return true;
      return NC_FIELDS.some(f => String(r[f.id] || "").toLowerCase().includes(q));
    });
  }

  /* ---------- Render table ---------- */
  function renderNc() {
    const tbody = document.querySelector("#ncTable tbody");
    if (!tbody) return;
    const data = getFilteredNc();
    const countEl = $("ncCount");
    if (countEl) countEl.textContent = `${data.length} of ${ncRecords.length} NC(s)`;
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="${NC_FIELDS.length + 1}" style="text-align:center;color:var(--muted);padding:24px">${
        ncRecords.length ? "No rows match current filters." : "No NCs logged yet. Click \u201C+ New NC\u201D to add one."
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(r => {
      const cells = NC_FIELDS.map(f =>
        `<td${f.wrap ? ' class="wrap"' : ""}>${escH(r[f.id])}</td>`
      ).join("");
      return `<tr>${cells}<td>
        <button class="btn sm" data-nc-edit="${r.id}">Edit</button>
        ${isAdminNow() ? `<button class="btn sm danger" data-nc-del="${r.id}">Del</button>` : ""}
      </td></tr>`;
    }).join("");

    tbody.querySelectorAll("[data-nc-edit]").forEach(b =>
      b.addEventListener("click", () => openNcModal(b.dataset.ncEdit)));
    tbody.querySelectorAll("[data-nc-del]").forEach(b =>
      b.addEventListener("click", () => deleteNc(b.dataset.ncDel)));
  }

  /* ---------- Modal / form ---------- */
  function openNcModal(id) {
    const modal = $("ncModal");
    const title = $("ncModalTitle");
    $("ncForm").reset();
    $("ncId_hidden").value = "";
    if (id) {
      const r = ncRecords.find(x => x.id === id);
      if (r) {
        title.textContent = "Edit NC";
        $("ncId_hidden").value = r.id;
        NC_FIELDS.forEach(f => {
          const el = $("nc_" + f.id);
          if (el) el.value = r[f.id] || "";
        });
      }
    } else {
      title.textContent = "New NC";
    }
    modal.style.display = "flex";
  }
  function closeNcModal() { $("ncModal").style.display = "none"; }

  $("btnNcNew")?.addEventListener("click", () => openNcModal());
  $("ncModalClose")?.addEventListener("click", closeNcModal);
  $("ncModal")?.addEventListener("click", (e) => { if (e.target.id === "ncModal") closeNcModal(); });
  $("ncFormReset")?.addEventListener("click", () => {
    $("ncForm").reset();
    $("ncId_hidden").value = "";
  });

  $("ncForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("ncId_hidden").value || uid();
    const rec = { id };
    NC_FIELDS.forEach(f => {
      const el = $("nc_" + f.id);
      rec[f.id] = el ? String(el.value || "").trim() : "";
    });
    const existing = ncRecords.find(x => x.id === id);
    const isNew = !existing;
    rec.updatedBy = currentEmailNow();
    rec.updatedAt = new Date().toISOString();
    if (isNew) {
      rec.createdBy = currentEmailNow();
      rec.createdAt = rec.updatedAt;
    } else {
      rec.createdBy = existing.createdBy || currentEmailNow();
      rec.createdAt = existing.createdAt || rec.updatedAt;
    }
    try {
      await setDoc(doc(db, NC_COLLECTION, id), rec);
      await window.__writeAudit?.(isNew ? "create" : "update", id,
        { collection: NC_COLLECTION, ncId: rec.ncId });
      closeNcModal();
      toastMsg("NC saved");
    } catch (err) {
      console.error(err); toastMsg("Save failed: " + (err.message || err.code));
    }
  });

  async function deleteNc(id) {
    if (!isAdminNow()) { toastMsg("Only admins can delete NC records"); return; }
    if (!confirm("Delete this NC record?")) return;
    const r = ncRecords.find(x => x.id === id);
    try {
      await deleteDoc(doc(db, NC_COLLECTION, id));
      await window.__writeAudit?.("delete", id, { collection: NC_COLLECTION, ncId: r?.ncId });
      toastMsg("NC deleted");
    } catch (err) { console.error(err); toastMsg("Delete failed"); }
  }

  $("btnNcClearAll")?.addEventListener("click", async () => {
    if (!isAdminNow()) { toastMsg("Only admins can clear all NC records"); return; }
    if (!ncRecords.length) return;
    if (!confirm("Delete ALL NC records? This cannot be undone.")) return;
    try {
      const batch = writeBatch(db);
      const toDelete = ncRecords.slice();
      toDelete.forEach(r => batch.delete(doc(db, NC_COLLECTION, r.id)));
      await batch.commit();
      await window.__writeAudit?.("clear_all", null,
        { count: toDelete.length, scope: "nc_register" });
      toastMsg("All NC records cleared");
    } catch (err) { console.error(err); toastMsg("Clear failed"); }
  });

  /* ---------- Filters wiring ---------- */
  ["ncFilterSearch","ncFilterCategory","ncFilterSeverity","ncFilterStatus","ncFilterOwner"]
    .forEach(id => $(id)?.addEventListener("input", renderNc));
  ["ncFilterCategory","ncFilterSeverity","ncFilterStatus"]
    .forEach(id => $(id)?.addEventListener("change", renderNc));
  $("ncClearFilters")?.addEventListener("click", () => {
    ["ncFilterSearch","ncFilterCategory","ncFilterSeverity","ncFilterStatus","ncFilterOwner"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderNc();
  });

  /* ---------- Excel import ---------- */
  $("ncFileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (typeof XLSX === "undefined") return toastMsg("Excel library not loaded");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!json.length) return toastMsg("No rows found in file");

      const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const labelMap = {};
      NC_FIELDS.forEach(f => {
        labelMap[norm(f.label)] = f.id;
        labelMap[norm(f.id)]    = f.id;
      });

      if (!confirm(`Import ${json.length} row(s) from "${file.name}"? Existing rows are kept.`)) return;

      const batch = writeBatch(db);
      let ok = 0;
      const now = new Date().toISOString();
      for (const r of json) {
        const id = uid();
        const rec = { id, createdBy: currentEmailNow(), createdAt: now,
          updatedBy: currentEmailNow(), updatedAt: now };
        NC_FIELDS.forEach(f => (rec[f.id] = ""));
        for (const key of Object.keys(r)) {
          const target = labelMap[norm(key)];
          if (target) rec[target] = String(r[key] ?? "").trim();
        }
        if (!NC_FIELDS.some(f => rec[f.id])) continue;
        batch.set(doc(db, NC_COLLECTION, id), rec);
        ok++;
      }
      if (!ok) return toastMsg("No usable rows in file");
      await batch.commit();
      await window.__writeAudit?.("import", null, { collection: NC_COLLECTION, count: ok });
      toastMsg(`Imported ${ok} row(s)`);
    } catch (err) {
      console.error(err); toastMsg("Import failed: " + (err.message || err.code));
    }
  });

  /* ---------- Export to Excel ---------- */
  $("btnNcExportExcel")?.addEventListener("click", () => {
    const data = getFilteredNc();
    if (!data.length) return toastMsg("No NC records to export");
    if (typeof XLSX === "undefined") return toastMsg("Excel library not loaded");
    const headers = NC_FIELDS.map(f => f.label);
    const rows = data.map(r => NC_FIELDS.map(f => r[f.id] || ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map(h => ({ wch: Math.max(14, Math.min(40, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NC Register");
    XLSX.writeFile(wb, `nc-register-${new Date().toISOString().slice(0,10)}.xlsx`);
    toastMsg(`Exported ${data.length} NC record(s)`);
  });

  /* ---------- Export to PDF (html2canvas + jsPDF) ---------- */
  $("btnNcExportPdf")?.addEventListener("click", async () => {
    const data = getFilteredNc();
    if (!data.length) return toastMsg("No NC records to export");
    try {
      toastMsg("Generating PDF…");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;

      pdf.setFontSize(14); pdf.setTextColor(33,33,33);
      pdf.text("IDH — NC Register / Non-Conformity Master Log", margin, margin + 4);
      pdf.setFontSize(9); pdf.setTextColor(107,114,128);
      pdf.text(`Exported ${new Date().toLocaleString()} · ${data.length} record(s)`, margin, margin + 20);

      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;padding:12px;font-family:Arial,sans-serif;";
      const tbl = document.createElement("table");
      tbl.style.cssText = "border-collapse:collapse;font-size:10px;";
      const thead = `<tr>${NC_FIELDS.map(f => `<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:4px 6px;text-align:left;color:#334155;font-weight:600;">${escH(f.label)}</th>`).join("")}</tr>`;
      const tbody = data.map(r => `<tr>${NC_FIELDS.map(f => `<td style="border:1px solid #e2e8f0;padding:4px 6px;color:#1f2937;vertical-align:top;max-width:180px;word-wrap:break-word;">${escH(r[f.id] || "")}</td>`).join("")}</tr>`).join("");
      tbl.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
      wrap.appendChild(tbl);
      document.body.appendChild(wrap);

      const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: "#ffffff", logging: false });
      document.body.removeChild(wrap);

      const imgW = pageW - margin * 2;
      const usableH = pageH - margin - 50;
      const imgH = canvas.height * (imgW / canvas.width);
      const img = canvas.toDataURL("image/jpeg", 0.92);

      if (imgH <= usableH) {
        pdf.addImage(img, "JPEG", margin, margin + 36, imgW, imgH);
      } else {
        const pageCanvas = document.createElement("canvas");
        const pageCtx = pageCanvas.getContext("2d");
        const sliceHpx = usableH * (canvas.width / imgW);
        pageCanvas.width = canvas.width;
        let y = 0, first = true;
        while (y < canvas.height) {
          const h = Math.min(sliceHpx, canvas.height - y);
          pageCanvas.height = h;
          pageCtx.fillStyle = "#fff";
          pageCtx.fillRect(0, 0, pageCanvas.width, h);
          pageCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
          const slice = pageCanvas.toDataURL("image/jpeg", 0.92);
          if (!first) { pdf.addPage(); }
          pdf.addImage(slice, "JPEG", margin, margin + (first ? 36 : 12), imgW, h * (imgW / canvas.width));
          y += h; first = false;
        }
      }
      pdf.save(`nc-register-${new Date().toISOString().slice(0,10)}.pdf`);
      toastMsg("PDF downloaded");
    } catch (err) {
      console.error(err); toastMsg("PDF export failed");
    }
  });

  /* ---------- Realtime sync (start/stop with auth) ---------- */
  function startNcSync() {
    if (unsubNc) return;
    const q = query(collection(db, NC_COLLECTION), orderBy("ncId"));
    unsubNc = onSnapshot(q, snap => {
      ncRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const av = String(a.ncId || ""), bv = String(b.ncId || "");
          if (!av && bv) return 1;
          if (av && !bv) return -1;
          return av.localeCompare(bv, undefined, { numeric: true });
        });
      renderNc();
    }, err => {
      console.error("nc sync", err);
      toastMsg("NC sync error: " + (err.message || err.code));
    });
  }
  function stopNcSync() {
    if (unsubNc) { unsubNc(); unsubNc = null; }
    ncRecords = []; renderNc();
  }

  onAuthStateChanged(auth, (user) => {
    if (user) startNcSync(); else stopNcSync();
  });

  // Render once on load (empty)
  renderNc();
})();