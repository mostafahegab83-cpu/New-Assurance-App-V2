/* Risk Register — Master Log
   Mirrors the CAPA Register logic:
   - Static HTML markup lives in index.html (#risk tab/panel/modal)
   - Firestore collection: "risk_register"
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

  const RISK_COLLECTION = "risk_register";
  let riskRecords = [];
  let unsubRisk = null;

  // Column / field definitions — order matters (table + form + excel + pdf use this list)
  const RISK_FIELDS = [
    { id: "riskId",              label: "Risk ID" },
    { id: "riskDescription",     label: "Risk Description",   wrap: true },
    { id: "ncId",                label: "NC ID" },
    { id: "affectedDepartment",  label: "Affected Department" },
    { id: "affectedProcess",     label: "Affected Process" },
    { id: "impactArea",          label: "Impact Area" },
    { id: "riskLevel",           label: "Risk Level" },
    { id: "existingControls",    label: "Existing Controls",  wrap: true },
    { id: "riskOwner",           label: "Risk Owner" },
    { id: "mitigationStatus",    label: "Mitigation Status" },
    { id: "linkedCapaId",        label: "Linked CAPA ID" },
    { id: "currentRiskStatus",   label: "Current Risk Status" }
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
  function getFilteredRisk() {
    const q     = ($("riskFilterSearch")?.value || "").toLowerCase().trim();
    const level = ($("riskFilterLevel")?.value || "").toLowerCase();
    const mit   = ($("riskFilterMitigation")?.value || "").toLowerCase();
    const stat  = ($("riskFilterStatus")?.value || "").toLowerCase();
    const owner = ($("riskFilterOwner")?.value || "").toLowerCase().trim();
    return riskRecords.filter(r => {
      if (level && (r.riskLevel || "").toLowerCase() !== level) return false;
      if (mit   && (r.mitigationStatus || "").toLowerCase() !== mit) return false;
      if (stat  && (r.currentRiskStatus || "").toLowerCase() !== stat) return false;
      if (owner && !(r.riskOwner || "").toLowerCase().includes(owner)) return false;
      if (!q) return true;
      return RISK_FIELDS.some(f => String(r[f.id] || "").toLowerCase().includes(q));
    });
  }

  /* ---------- Render table ---------- */
  function renderRisk() {
    const tbody = document.querySelector("#riskTable tbody");
    if (!tbody) return;
    const data = getFilteredRisk();
    const countEl = $("riskCount");
    if (countEl) countEl.textContent = `${data.length} of ${riskRecords.length} risk(s)`;
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="${RISK_FIELDS.length + 1}" style="text-align:center;color:var(--muted);padding:24px">${
        riskRecords.length ? "No rows match current filters." : "No risks logged yet. Click \u201C+ New Risk\u201D to add one."
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(r => {
      const cells = RISK_FIELDS.map(f =>
        `<td${f.wrap ? ' class="wrap"' : ""}>${escH(r[f.id])}</td>`
      ).join("");
      return `<tr>${cells}<td>
        <button class="btn sm" data-risk-edit="${r.id}">Edit</button>
        ${isAdminNow() ? `<button class="btn sm danger" data-risk-del="${r.id}">Del</button>` : ""}
      </td></tr>`;
    }).join("");

    tbody.querySelectorAll("[data-risk-edit]").forEach(b =>
      b.addEventListener("click", () => openRiskModal(b.dataset.riskEdit)));
    tbody.querySelectorAll("[data-risk-del]").forEach(b =>
      b.addEventListener("click", () => deleteRisk(b.dataset.riskDel)));
  }

  /* ---------- Modal / form ---------- */
  function openRiskModal(id) {
    const modal = $("riskModal");
    const title = $("riskModalTitle");
    $("riskForm").reset();
    $("riskId_hidden").value = "";
    if (id) {
      const r = riskRecords.find(x => x.id === id);
      if (r) {
        title.textContent = "Edit Risk";
        $("riskId_hidden").value = r.id;
        RISK_FIELDS.forEach(f => {
          const el = $("risk_" + f.id);
          if (el) el.value = r[f.id] || "";
        });
      }
    } else {
      title.textContent = "New Risk";
    }
    modal.style.display = "flex";
  }
  function closeRiskModal() { $("riskModal").style.display = "none"; }

  $("btnRiskNew")?.addEventListener("click", () => openRiskModal());
  $("riskModalClose")?.addEventListener("click", closeRiskModal);
  $("riskModal")?.addEventListener("click", (e) => { if (e.target.id === "riskModal") closeRiskModal(); });
  $("riskFormReset")?.addEventListener("click", () => {
    $("riskForm").reset();
    $("riskId_hidden").value = "";
  });

  $("riskForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("riskId_hidden").value || uid();
    const rec = { id };
    RISK_FIELDS.forEach(f => {
      const el = $("risk_" + f.id);
      rec[f.id] = el ? String(el.value || "").trim() : "";
    });
    const existing = riskRecords.find(x => x.id === id);
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
      await setDoc(doc(db, RISK_COLLECTION, id), rec);
      await window.__writeAudit?.(isNew ? "create" : "update", id,
        { collection: RISK_COLLECTION, riskId: rec.riskId });
      closeRiskModal();
      toastMsg("Risk saved");
    } catch (err) {
      console.error(err); toastMsg("Save failed: " + (err.message || err.code));
    }
  });

  async function deleteRisk(id) {
    if (!isAdminNow()) { toastMsg("Only admins can delete risk records"); return; }
    if (!confirm("Delete this risk record?")) return;
    const r = riskRecords.find(x => x.id === id);
    try {
      await deleteDoc(doc(db, RISK_COLLECTION, id));
      await window.__writeAudit?.("delete", id, { collection: RISK_COLLECTION, riskId: r?.riskId });
      toastMsg("Risk deleted");
    } catch (err) { console.error(err); toastMsg("Delete failed"); }
  }

  $("btnRiskClearAll")?.addEventListener("click", async () => {
    if (!isAdminNow()) { toastMsg("Only admins can clear all risk records"); return; }
    if (!riskRecords.length) return;
    if (!confirm("Delete ALL risk records? This cannot be undone.")) return;
    try {
      const batch = writeBatch(db);
      const toDelete = riskRecords.slice();
      toDelete.forEach(r => batch.delete(doc(db, RISK_COLLECTION, r.id)));
      await batch.commit();
      await window.__writeAudit?.("clear_all", null,
        { count: toDelete.length, scope: "risk_register" });
      toastMsg("All risk records cleared");
    } catch (err) { console.error(err); toastMsg("Clear failed"); }
  });

  /* ---------- Filters wiring ---------- */
  ["riskFilterSearch","riskFilterLevel","riskFilterMitigation","riskFilterStatus","riskFilterOwner"]
    .forEach(id => $(id)?.addEventListener("input", renderRisk));
  ["riskFilterLevel","riskFilterMitigation","riskFilterStatus"]
    .forEach(id => $(id)?.addEventListener("change", renderRisk));
  $("riskClearFilters")?.addEventListener("click", () => {
    ["riskFilterSearch","riskFilterLevel","riskFilterMitigation","riskFilterStatus","riskFilterOwner"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderRisk();
  });

  /* ---------- Excel import ---------- */
  $("riskFileImport")?.addEventListener("change", async (e) => {
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
      RISK_FIELDS.forEach(f => {
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
        RISK_FIELDS.forEach(f => (rec[f.id] = ""));
        for (const key of Object.keys(r)) {
          const target = labelMap[norm(key)];
          if (target) rec[target] = String(r[key] ?? "").trim();
        }
        if (!RISK_FIELDS.some(f => rec[f.id])) continue;
        batch.set(doc(db, RISK_COLLECTION, id), rec);
        ok++;
      }
      if (!ok) return toastMsg("No usable rows in file");
      await batch.commit();
      await window.__writeAudit?.("import", null, { collection: RISK_COLLECTION, count: ok });
      toastMsg(`Imported ${ok} row(s)`);
    } catch (err) {
      console.error(err); toastMsg("Import failed: " + (err.message || err.code));
    }
  });

  /* ---------- Export to Excel ---------- */
  $("btnRiskExportExcel")?.addEventListener("click", () => {
    const data = getFilteredRisk();
    if (!data.length) return toastMsg("No risk records to export");
    if (typeof XLSX === "undefined") return toastMsg("Excel library not loaded");
    const headers = RISK_FIELDS.map(f => f.label);
    const rows = data.map(r => RISK_FIELDS.map(f => r[f.id] || ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map(h => ({ wch: Math.max(14, Math.min(40, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risk Register");
    XLSX.writeFile(wb, `risk-register-${new Date().toISOString().slice(0,10)}.xlsx`);
    toastMsg(`Exported ${data.length} risk record(s)`);
  });

  /* ---------- Export to PDF (html2canvas + jsPDF) ---------- */
  $("btnRiskExportPdf")?.addEventListener("click", async () => {
    const data = getFilteredRisk();
    if (!data.length) return toastMsg("No risk records to export");
    try {
      toastMsg("Generating PDF…");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;

      pdf.setFontSize(14); pdf.setTextColor(33,33,33);
      pdf.text("IDH — Risk Register / Master Log", margin, margin + 4);
      pdf.setFontSize(9); pdf.setTextColor(107,114,128);
      pdf.text(`Exported ${new Date().toLocaleString()} · ${data.length} record(s)`, margin, margin + 20);

      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;padding:12px;font-family:Arial,sans-serif;";
      const tbl = document.createElement("table");
      tbl.style.cssText = "border-collapse:collapse;font-size:10px;";
      const thead = `<tr>${RISK_FIELDS.map(f => `<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:4px 6px;text-align:left;color:#334155;font-weight:600;">${escH(f.label)}</th>`).join("")}</tr>`;
      const tbody = data.map(r => `<tr>${RISK_FIELDS.map(f => `<td style="border:1px solid #e2e8f0;padding:4px 6px;color:#1f2937;vertical-align:top;max-width:180px;word-wrap:break-word;">${escH(r[f.id] || "")}</td>`).join("")}</tr>`).join("");
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
      pdf.save(`risk-register-${new Date().toISOString().slice(0,10)}.pdf`);
      toastMsg("PDF downloaded");
    } catch (err) {
      console.error(err); toastMsg("PDF export failed");
    }
  });

  /* ---------- Realtime sync (start/stop with auth) ---------- */
  function startRiskSync() {
    if (unsubRisk) return;
    const q = query(collection(db, RISK_COLLECTION), orderBy("riskId"));
    unsubRisk = onSnapshot(q, snap => {
      riskRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const av = String(a.riskId || ""), bv = String(b.riskId || "");
          if (!av && bv) return 1;
          if (av && !bv) return -1;
          return av.localeCompare(bv, undefined, { numeric: true });
        });
      renderRisk();
    }, err => {
      console.error("risk sync", err);
      toastMsg("Risk sync error: " + (err.message || err.code));
    });
  }
  function stopRiskSync() {
    if (unsubRisk) { unsubRisk(); unsubRisk = null; }
    riskRecords = []; renderRisk();
  }

  onAuthStateChanged(auth, (user) => {
    if (user) startRiskSync(); else stopRiskSync();
  });

  // Render once on load (empty)
  renderRisk();
})();
