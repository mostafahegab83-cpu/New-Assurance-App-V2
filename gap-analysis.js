/* Gap Analysis — two sub-pages fed by Excel imports.
   Firestore collections:
     - gap_assessments        (Module 1: Gap Assessment)
     - process_validations    (Module 2: Process Validation Interviews)
   SheetJS (window.XLSX) is already loaded from index.html.
*/
import {
  db, ADMIN_EMAILS,
  collection, doc, setDoc, deleteDoc, addDoc,
  onSnapshot, writeBatch, serverTimestamp
} from "./firebase.js";

(function () {
  "use strict";

  const GA_COL = "gap_assessments";
  const PV_COL = "process_validations";

  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const currentEmail = () => (window.__session && window.__session.email) || "(unknown)";
  const isAdminNow  = () =>
    !!(window.__session && window.__session.isAdmin) || ADMIN_EMAILS.includes(currentEmail());

  function toast(msg) {
    const el = $("toast");
    if (!el) { console.log(msg); return; }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  /* ---------- Home tile launcher ---------- */
  document.addEventListener("click", (e) => {
    const tile = e.target.closest('.home-tile[data-go="gapAnalysis"]');
    if (tile) {
      const btn = document.querySelector('.tab[data-tab="gapAnalysis"]');
      if (btn) btn.click();
    }
  });

  /* ---------- Sub-tabs ---------- */
  document.addEventListener("click", (e) => {
    const st = e.target.closest("#gapAnalysis .ga-subtab");
    if (!st) return;
    document.querySelectorAll("#gapAnalysis .ga-subtab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("#gapAnalysis .ga-sub-panel").forEach((p) => p.classList.remove("active"));
    st.classList.add("active");
    const panel = document.getElementById(st.dataset.sub);
    if (panel) panel.classList.add("active");
  });

  /* ---------- Field mapping (Excel headers → internal keys) ---------- */
  const GA_FIELDS = [
    { key: "processId",          label: "Process ID",              aliases: ["process id","id","pid"] },
    { key: "processName",        label: "Process Name",            aliases: ["process name","name"] },
    { key: "processDescription", label: "Process Description",     aliases: ["process description","description","desc"] },
    { key: "bestPractice",       label: "Best Practice Requirement", aliases: ["best practice requirement","best practice","requirement"] },
    { key: "existingInIDH",      label: "Existing in IDH (Y/N)",   aliases: ["existing in idh","existing","existing in idh (y/n)","exists"] },
    { key: "relatedPolicySOP",   label: "Related Policy/SOP",      aliases: ["related policy/sop","related policy","policy/sop","policy","sop"] },
    { key: "gapIdentified",      label: "Gap Identified",          aliases: ["gap identified","gap"] },
    { key: "comments",           label: "Comments",                aliases: ["comments","comment","notes"] },
  ];

  const PV_FIELDS = [
    { key: "documentTitle",   label: "Document Title",        aliases: ["document title","title"] },
    { key: "documentType",    label: "Document Type",         aliases: ["document type","type"] },
    { key: "documentCode",    label: "Document Code",         aliases: ["document code","code"] },
    { key: "processOwner",    label: "Process Owner",         aliases: ["process owner","owner"] },
    { key: "companyName",     label: "Company Name",          aliases: ["company name","company"] },
    { key: "processExists",   label: "Process Exists? (Y/N)", aliases: ["process exists? (y/n)","process exists","exists"] },
    { key: "ifNoStatus",      label: "If No → Status",        aliases: ["if no → status","if no status","if no"] },
    { key: "evidenceExists",  label: "Evidence Exists? (Y/N)",aliases: ["evidence exists? (y/n)","evidence exists","evidence"] },
    { key: "processStatus",   label: "Process Status",        aliases: ["process status","status"] },
    { key: "automated",       label: "Automated? (Y/N)",      aliases: ["automated? (y/n)","automated"] },
    { key: "evidenceReviewed",label: "Evidence Reviewed",     aliases: ["evidence reviewed","reviewed"] },
    { key: "comments",        label: "Comments",              aliases: ["comments","comment","notes"] },
  ];

  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  function mapRow(rawRow, schema) {
    // Build lookup from lowercased header → value
    const lookup = {};
    Object.keys(rawRow).forEach((h) => { lookup[norm(h)] = rawRow[h]; });
    const out = {};
    schema.forEach((f) => {
      const cands = [f.label, ...(f.aliases || [])].map(norm);
      let val = "";
      for (const c of cands) {
        if (lookup[c] != null && String(lookup[c]).trim() !== "") { val = lookup[c]; break; }
      }
      out[f.key] = typeof val === "string" ? val.trim() : val;
    });
    return out;
  }

  async function importExcel(file, schema, colName) {
    const XLSX = window.XLSX;
    if (!XLSX) { toast("Excel library not loaded."); return; }
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    if (!ws) { toast("No worksheet found."); return; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!rows.length) { toast("Spreadsheet is empty."); return; }

    const mapped = rows.map((r) => mapRow(r, schema)).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
    if (!mapped.length) { toast("No usable rows in the spreadsheet."); return; }

    const email = currentEmail();
    const batch = writeBatch(db);
    mapped.forEach((r) => {
      const ref = doc(collection(db, colName));
      batch.set(ref, { ...r, createdBy: email, createdAt: serverTimestamp(), updatedBy: email, updatedAt: serverTimestamp() });
    });
    try {
      await batch.commit();
      toast(`Imported ${mapped.length} row${mapped.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err);
      toast("Import failed: " + (err?.message || err));
    }
  }

  function exportExcel(records, schema, filename) {
    const XLSX = window.XLSX;
    if (!XLSX) { toast("Excel library not loaded."); return; }
    const rows = records.map((r) => {
      const o = {};
      schema.forEach((f) => { o[f.label] = r[f.key] ?? ""; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
  }

  /* ---------- Generic renderer for both sub-pages ---------- */
  function makeModule(cfg) {
    // cfg: { colName, schema, tbodyId, searchId, importBtnId, fileInputId,
    //        exportBtnId, clearBtnId, countId, filename }
    let records = [];
    let unsub = null;
    let search = "";

    function commentSchemaKey() { return "comments"; }

    function tableColumns() {
      // Every schema field is a column; comments is editable textarea.
      return cfg.schema;
    }

    function render() {
      const tbody = $(cfg.tbodyId);
      if (!tbody) return;
      const cols = tableColumns();
      const admin = isAdminNow();
      const q = search.trim().toLowerCase();
      const filtered = q
        ? records.filter((r) => cols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)))
        : records.slice();

      const countEl = $(cfg.countId);
      if (countEl) countEl.textContent = `${filtered.length} of ${records.length}`;

      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:#6b7280;padding:24px;">No records yet. Use Import Excel to load data.</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map((r) => {
        const cells = cols.map((c) => {
          if (c.key === commentSchemaKey()) {
            return `<td><textarea data-ga-comment="${r.id}" rows="2" style="width:100%;min-width:220px;padding:6px;border:1px solid #e3e8ef;border-radius:4px;font-size:12px;font-family:inherit;resize:vertical;">${esc(r[c.key] ?? "")}</textarea></td>`;
          }
          return `<td>${esc(r[c.key] ?? "")}</td>`;
        }).join("");
        const delBtn = admin ? `<button class="btn sm danger" data-ga-del="${r.id}">Del</button>` : "";
        return `<tr>${cells}<td style="white-space:nowrap;">${delBtn}</td></tr>`;
      }).join("");
    }

    function startSync() {
      if (unsub) return;
      const tbody = $(cfg.tbodyId);
      if (tbody) tbody.innerHTML = `<tr><td colspan="${cfg.schema.length + 1}" style="text-align:center;color:#6b7280;padding:24px;">Loading…</td></tr>`;
      unsub = onSnapshot(collection(db, cfg.colName), (snap) => {
        records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // stable-ish sort by createdAt desc
        records.sort((a, b) => {
          const at = a.createdAt?.seconds || 0;
          const bt = b.createdAt?.seconds || 0;
          return bt - at;
        });
        render();
      }, (err) => {
        console.error(`[gap-analysis:${cfg.colName}] sync error`, err);
        toast("Could not load data: " + (err?.message || err));
      });
    }
    function stopSync() { if (unsub) { unsub(); unsub = null; } records = []; render(); }

    /* ---- Event wiring ---- */
    function wire() {
      const fileInput = $(cfg.fileInputId);
      const importBtn = $(cfg.importBtnId);
      importBtn?.addEventListener("click", () => fileInput?.click());
      fileInput?.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        await importExcel(f, cfg.schema, cfg.colName);
      });

      $(cfg.exportBtnId)?.addEventListener("click", () => {
        exportExcel(records, cfg.schema, cfg.filename);
      });

      $(cfg.clearBtnId)?.addEventListener("click", async () => {
        if (!isAdminNow()) { toast("Admin only."); return; }
        if (!records.length) { toast("Nothing to clear."); return; }
        if (!confirm(`Delete ALL ${records.length} records? This cannot be undone.`)) return;
        const batch = writeBatch(db);
        records.forEach((r) => batch.delete(doc(db, cfg.colName, r.id)));
        try { await batch.commit(); toast("All records deleted."); }
        catch (err) { toast("Delete failed: " + (err?.message || err)); }
      });

      const searchEl = $(cfg.searchId);
      searchEl?.addEventListener("input", (e) => { search = e.target.value || ""; render(); });

      const tbody = $(cfg.tbodyId);
      // Save comment on blur
      tbody?.addEventListener("blur", async (e) => {
        const t = e.target;
        if (!(t instanceof HTMLTextAreaElement)) return;
        const id = t.getAttribute("data-ga-comment");
        if (!id) return;
        const rec = records.find((r) => r.id === id);
        if (!rec) return;
        const val = t.value;
        if ((rec.comments ?? "") === val) return;
        try {
          await setDoc(doc(db, cfg.colName, id), {
            comments: val,
            updatedBy: currentEmail(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          toast("Comment saved.");
        } catch (err) {
          toast("Save failed: " + (err?.message || err));
        }
      }, true);

      // Delete row
      tbody?.addEventListener("click", async (e) => {
        const del = e.target.closest("[data-ga-del]");
        if (!del) return;
        if (!isAdminNow()) { toast("Admin only."); return; }
        const id = del.getAttribute("data-ga-del");
        if (!confirm("Delete this row?")) return;
        try { await deleteDoc(doc(db, cfg.colName, id)); toast("Deleted."); }
        catch (err) { toast("Delete failed: " + (err?.message || err)); }
      });
    }

    return { startSync, stopSync, wire };
  }

  const gaModule = makeModule({
    colName: GA_COL, schema: GA_FIELDS,
    tbodyId: "gaAssessTbody", searchId: "gaAssessSearch",
    importBtnId: "gaAssessImportBtn", fileInputId: "gaAssessFile",
    exportBtnId: "gaAssessExportBtn", clearBtnId: "gaAssessClearBtn",
    countId: "gaAssessCount",
    filename: "gap-assessment.xlsx",
  });

  const pvModule = makeModule({
    colName: PV_COL, schema: PV_FIELDS,
    tbodyId: "gaValTbody", searchId: "gaValSearch",
    importBtnId: "gaValImportBtn", fileInputId: "gaValFile",
    exportBtnId: "gaValExportBtn", clearBtnId: "gaValClearBtn",
    countId: "gaValCount",
    filename: "process-validation-interviews.xlsx",
  });

  function boot() {
    gaModule.wire();
    pvModule.wire();
    // Start syncing whenever the section becomes active.
    document.addEventListener("click", (e) => {
      const tab = e.target.closest('.tab[data-tab="gapAnalysis"], .home-tile[data-go="gapAnalysis"]');
      if (!tab) return;
      gaModule.startSync();
      pvModule.startSync();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
