/* Gap Analysis module — self-injecting.
   Adds:
     • Nav tab   : "Gap Analysis"
     • Home tile : 🧭 Gap Analysis
     • Section   : two sub-pages (Gap Assessment | Process Validation Interviews)
   Data: Firestore collections `gap_assessments` and `process_validations`.
   Excel: SheetJS (loaded on demand from CDN).
*/
import {
  db, collection, doc, setDoc, addDoc, deleteDoc, onSnapshot,
  writeBatch, serverTimestamp, query, orderBy
} from "./firebase.js";

/* ---------- Utilities ---------- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const parseYN = (v) => {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return "Y";
  if (["n", "no", "false", "0"].includes(s)) return "N";
  if (["n/a", "na", "-"].includes(s)) return "N/A";
  return String(v);
};
const isAdmin = () => !!(window.__session && window.__session.isAdmin);

const toast = (msg) => {
  const el = document.getElementById("toast");
  if (!el) { console.log(msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
};

/* ---------- SheetJS loader (on demand) ---------- */
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("Failed to load SheetJS"));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

/* ---------- Header mapping ---------- */
function buildMapper(map) {
  const lookup = {};
  for (const key in map) for (const v of map[key]) lookup[norm(v)] = key;
  return (row) => {
    const out = {};
    for (const k in row) {
      const c = lookup[norm(k)];
      if (c) out[c] = row[k];
    }
    return out;
  };
}

const gapMap = buildMapper({
  process_id:                ["Process ID", "PID"],
  process_name:              ["Process Name"],
  process_description:       ["Process Description", "Description"],
  best_practice_requirement: ["Best Practice Requirement", "Best Practice"],
  existing_in_idh:           ["Existing in IDH", "Existing in IDH (Y/N)", "Existing"],
  related_policy_sop:        ["Related Policy/SOP", "Related Policy / SOP", "Policy/SOP", "Policy SOP"],
  gap_identified:            ["Gap Identified", "Gap"],
  comments:                  ["Comments", "Comment", "Notes"],
});

const valMap = buildMapper({
  document_title:    ["Document Title", "Title"],
  document_type:     ["Document Type", "Type"],
  document_code:     ["Document Code", "Code"],
  process_owner:     ["Process Owner", "Owner"],
  company_name:      ["Company Name", "Company"],
  process_exists:    ["Process Exists?", "Process Exists", "Process Exists (Y/N)", "Process Exists? (Y/N)"],
  if_no_status:      ["If No Status", "If No → Status", "If No -> Status", "If No"],
  evidence_exists:   ["Evidence Exists?", "Evidence Exists", "Evidence Exists (Y/N)"],
  process_status:    ["Process Status", "Status"],
  automated:         ["Automated?", "Automated", "Automated (Y/N)"],
  evidence_reviewed: ["Evidence Reviewed", "Reviewed"],
  comments:          ["Comments", "Comment", "Notes"],
});

/* ---------- Inject styles ---------- */
const style = document.createElement("style");
style.textContent = `
  #gapAnalysis .ga-sub-tabs{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap;}
  #gapAnalysis .ga-sub{padding:8px 14px;border:1px solid #1f3a8a;background:#fff;color:#1f3a8a;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;}
  #gapAnalysis .ga-sub.active{background:#1f3a8a;color:#fff;}
  #gapAnalysis .ga-panel{display:none;}
  #gapAnalysis .ga-panel.active{display:block;}
  #gapAnalysis .ga-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;}
  #gapAnalysis .ga-toolbar input[type="search"]{flex:1;min-width:220px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;}
  #gapAnalysis .ga-btn{padding:7px 12px;border:1px solid #1f3a8a;background:#1f3a8a;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;}
  #gapAnalysis .ga-btn.secondary{background:#fff;color:#1f3a8a;}
  #gapAnalysis .ga-btn.danger{background:#d12027;border-color:#d12027;}
  #gapAnalysis .ga-btn:disabled{opacity:.5;cursor:not-allowed;}
  #gapAnalysis .ga-table-wrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;background:#fff;}
  #gapAnalysis table{border-collapse:collapse;width:100%;font-size:13px;}
  #gapAnalysis th,#gapAnalysis td{border-bottom:1px solid #e5e7eb;padding:8px 10px;vertical-align:top;text-align:left;}
  #gapAnalysis th{background:#f1f5f9;color:#1f3a8a;font-weight:700;position:sticky;top:0;}
  #gapAnalysis td textarea{width:100%;min-height:38px;border:1px solid transparent;border-radius:4px;padding:4px 6px;font:inherit;resize:vertical;background:transparent;}
  #gapAnalysis td textarea:hover,#gapAnalysis td textarea:focus{background:#fff;border-color:#cbd5e1;outline:none;}
  #gapAnalysis .yn-y{color:#166534;font-weight:700;}
  #gapAnalysis .yn-n{color:#b91c1c;font-weight:700;}
  #gapAnalysis .empty{padding:30px;text-align:center;color:#6b7280;}
  #gapAnalysis .ga-meta{color:#6b7280;font-size:12px;margin-left:auto;}
`;
document.head.appendChild(style);

/* ---------- Inject nav tab ---------- */
const nav = document.querySelector("nav.tabs");
if (nav) {
  const btn = document.createElement("button");
  btn.className = "tab";
  btn.dataset.tab = "gapAnalysis";
  btn.setAttribute("role", "tab");
  btn.textContent = "Gap Analysis";
  const pi = nav.querySelector('[data-tab="processInventory"]');
  if (pi && pi.nextSibling) nav.insertBefore(btn, pi.nextSibling);
  else nav.appendChild(btn);
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("gapAnalysis").classList.add("active");
  });
}

/* ---------- Inject home tile ---------- */
const tiles = document.querySelector(".home-tiles");
if (tiles) {
  const tile = document.createElement("div");
  tile.className = "home-tile";
  tile.dataset.go = "gapAnalysis";
  tile.innerHTML = `<div class="home-icon">🧭</div><h2>Gap Analysis</h2>`;
  tiles.appendChild(tile);
}

/* ---------- Inject section ---------- */
const main = document.querySelector("main") || document.body;
const section = document.createElement("section");
section.id = "gapAnalysis";
section.className = "tab-panel";
section.innerHTML = `
  <h2 style="color:#1f3a8a;margin:8px 0;">Gap Analysis</h2>
  <div class="ga-sub-tabs" role="tablist">
    <button class="ga-sub active" data-ga-sub="gaAssessment">Gap Assessment</button>
    <button class="ga-sub" data-ga-sub="gaValidation">Process Validation Interviews</button>
  </div>

  <div id="gaAssessment" class="ga-panel active">
    <div class="ga-toolbar">
      <input type="file" id="gaImport" accept=".xlsx,.xls" style="display:none;">
      <button class="ga-btn" id="gaImportBtn">Import Excel</button>
      <button class="ga-btn secondary" id="gaExportBtn">Export Excel</button>
      <button class="ga-btn secondary" id="gaTemplateBtn">Download Template</button>
      <button class="ga-btn secondary" id="gaAddBtn">+ Add Row</button>
      <button class="ga-btn danger" id="gaClearBtn" title="Admin only">Clear All</button>
      <input type="search" id="gaSearch" placeholder="Search Process ID, Name, SOP, Gap…">
      <span class="ga-meta" id="gaMeta"></span>
    </div>
    <div class="ga-table-wrap">
      <table id="gaTable">
        <thead><tr>
          <th>Process ID</th><th>Process Name</th><th>Process Description</th>
          <th>Best Practice Requirement</th><th>Existing in IDH</th>
          <th>Related Policy/SOP</th><th>Gap Identified</th>
          <th>Comments</th><th></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <div id="gaValidation" class="ga-panel">
    <div class="ga-toolbar">
      <input type="file" id="pvImport" accept=".xlsx,.xls" style="display:none;">
      <button class="ga-btn" id="pvImportBtn">Import Excel</button>
      <button class="ga-btn secondary" id="pvExportBtn">Export Excel</button>
      <button class="ga-btn secondary" id="pvTemplateBtn">Download Template</button>
      <button class="ga-btn secondary" id="pvAddBtn">+ Add Row</button>
      <button class="ga-btn danger" id="pvClearBtn" title="Admin only">Clear All</button>
      <input type="search" id="pvSearch" placeholder="Search title, code, owner, company…">
      <span class="ga-meta" id="pvMeta"></span>
    </div>
    <div class="ga-table-wrap">
      <table id="pvTable">
        <thead><tr>
          <th>Document Title</th><th>Type</th><th>Code</th>
          <th>Process Owner</th><th>Company</th>
          <th>Process Exists?</th><th>If No → Status</th>
          <th>Evidence Exists?</th><th>Process Status</th>
          <th>Automated?</th><th>Evidence Reviewed</th>
          <th>Comments</th><th></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
`;
main.appendChild(section);

/* ---------- Sub-tab switching ---------- */
section.querySelectorAll(".ga-sub").forEach((b) => {
  b.addEventListener("click", () => {
    section.querySelectorAll(".ga-sub").forEach((x) => x.classList.remove("active"));
    section.querySelectorAll(".ga-panel").forEach((p) => p.classList.remove("active"));
    b.classList.add("active");
    document.getElementById(b.dataset.gaSub).classList.add("active");
  });
});

/* ---------- Generic collection controller ---------- */
function makeController(cfg) {
  let rows = [];
  let filter = "";
  const col = collection(db, cfg.collection);

  onSnapshot(query(col, orderBy("createdAt", "asc")), (snap) => {
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error(cfg.collection, err);
    toast(`Load failed: ${err.message}`);
  });

  const tbody = section.querySelector(`#${cfg.tableId} tbody`);
  const meta  = section.querySelector(`#${cfg.metaId}`);

  function render() {
    const q = filter.trim().toLowerCase();
    const shown = q
      ? rows.filter((r) => cfg.searchFields.some((f) => String(r[f] ?? "").toLowerCase().includes(q)))
      : rows;
    meta.textContent = `${shown.length} of ${rows.length} record(s)`;
    if (!shown.length) {
      tbody.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}" class="empty">No records. Import an Excel file or add a row.</td></tr>`;
      return;
    }
    tbody.innerHTML = shown.map((r) => `<tr data-id="${r.id}">${cfg.columns.map((c) => renderCell(r, c)).join("")}
      <td>${isAdmin() ? `<button class="ga-btn danger" data-del="${r.id}" style="padding:4px 8px;font-size:12px;">Del</button>` : ""}</td>
    </tr>`).join("");
  }

  function renderCell(r, c) {
    const v = r[c.field] ?? "";
    if (c.type === "yn") {
      const val = parseYN(v);
      const cls = val === "Y" ? "yn-y" : val === "N" ? "yn-n" : "";
      return `<td><select data-field="${c.field}" style="border:1px solid #cbd5e1;border-radius:4px;padding:4px;">
        ${["", "Y", "N", "N/A"].map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${o || "—"}</option>`).join("")}
      </select></td>`;
    }
    if (c.type === "textarea") {
      return `<td><textarea data-field="${c.field}" rows="2">${esc(v)}</textarea></td>`;
    }
    return `<td><textarea data-field="${c.field}" rows="1">${esc(v)}</textarea></td>`;
  }

  // Delegated events
  tbody.addEventListener("change", async (e) => {
    const t = e.target;
    const tr = t.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;
    const field = t.dataset.field;
    if (!id || !field) return;
    try {
      await setDoc(doc(db, cfg.collection, id), { [field]: t.value, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) { toast(`Save failed: ${err.message}`); }
  });
  tbody.addEventListener("blur", async (e) => {
    if (e.target.tagName !== "TEXTAREA") return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset.id, field = e.target.dataset.field;
    if (!id || !field) return;
    try {
      await setDoc(doc(db, cfg.collection, id), { [field]: e.target.value, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) { toast(`Save failed: ${err.message}`); }
  }, true);
  tbody.addEventListener("click", async (e) => {
    const id = e.target.dataset?.del;
    if (!id) return;
    if (!isAdmin()) { toast("Only admins can delete"); return; }
    if (!confirm("Delete this row?")) return;
    try { await deleteDoc(doc(db, cfg.collection, id)); } catch (err) { toast(err.message); }
  });

  // Search
  section.querySelector(`#${cfg.searchId}`).addEventListener("input", (e) => {
    filter = e.target.value; render();
  });

  // Add row
  section.querySelector(`#${cfg.addId}`).addEventListener("click", async () => {
    const blank = Object.fromEntries(cfg.columns.map((c) => [c.field, ""]));
    try {
      await addDoc(col, { ...blank, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (err) { toast(err.message); }
  });

  // Clear all (admin)
  section.querySelector(`#${cfg.clearId}`).addEventListener("click", async () => {
    if (!isAdmin()) { toast("Only admins can clear all"); return; }
    if (!confirm(`Delete ALL ${rows.length} records in ${cfg.label}? This cannot be undone.`)) return;
    try {
      const batch = writeBatch(db);
      rows.forEach((r) => batch.delete(doc(db, cfg.collection, r.id)));
      await batch.commit();
      toast("All records deleted");
    } catch (err) { toast(err.message); }
  });

  // Import
  const fileInput = section.querySelector(`#${cfg.importInputId}`);
  section.querySelector(`#${cfg.importBtnId}`).addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const XLSX = await loadXLSX();
      const buf = await f.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const mapped = raw.map(cfg.mapper).filter((r) => Object.values(r).some((v) => v !== "" && v != null));
      if (!mapped.length) { toast("No rows found in file"); return; }
      const batch = writeBatch(db);
      const now = serverTimestamp();
      mapped.forEach((r) => {
        const clean = {};
        cfg.columns.forEach((c) => {
          let v = r[c.field] ?? "";
          if (c.type === "yn") v = parseYN(v);
          else v = String(v ?? "");
          clean[c.field] = v;
        });
        const ref = doc(col);
        batch.set(ref, { ...clean, createdAt: now, updatedAt: now });
      });
      await batch.commit();
      toast(`Imported ${mapped.length} row(s)`);
    } catch (err) { toast(`Import failed: ${err.message}`); }
    finally { fileInput.value = ""; }
  });

  // Export
  section.querySelector(`#${cfg.exportId}`).addEventListener("click", async () => {
    const XLSX = await loadXLSX();
    const data = rows.map((r) => {
      const o = {};
      cfg.columns.forEach((c) => { o[c.header] = r[c.field] ?? ""; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: cfg.columns.map((c) => c.header) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label);
    XLSX.writeFile(wb, `${cfg.filenameBase}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  // Template
  section.querySelector(`#${cfg.templateId}`).addEventListener("click", async () => {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet([cfg.columns.map((c) => c.header)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label);
    XLSX.writeFile(wb, `${cfg.filenameBase}-template.xlsx`);
  });
}

/* ---------- Gap Assessment controller ---------- */
makeController({
  label: "Gap Assessment",
  collection: "gap_assessments",
  filenameBase: "gap-assessment",
  tableId: "gaTable", metaId: "gaMeta", searchId: "gaSearch",
  addId: "gaAddBtn", clearId: "gaClearBtn",
  importBtnId: "gaImportBtn", importInputId: "gaImport",
  exportId: "gaExportBtn", templateId: "gaTemplateBtn",
  searchFields: ["process_id", "process_name", "related_policy_sop", "gap_identified", "comments"],
  mapper: gapMap,
  columns: [
    { field: "process_id",                header: "Process ID" },
    { field: "process_name",              header: "Process Name" },
    { field: "process_description",       header: "Process Description", type: "textarea" },
    { field: "best_practice_requirement", header: "Best Practice Requirement", type: "textarea" },
    { field: "existing_in_idh",           header: "Existing in IDH (Y/N)", type: "yn" },
    { field: "related_policy_sop",        header: "Related Policy/SOP" },
    { field: "gap_identified",            header: "Gap Identified", type: "textarea" },
    { field: "comments",                  header: "Comments", type: "textarea" },
  ],
});

/* ---------- Process Validation controller ---------- */
makeController({
  label: "Process Validation",
  collection: "process_validations",
  filenameBase: "process-validation",
  tableId: "pvTable", metaId: "pvMeta", searchId: "pvSearch",
  addId: "pvAddBtn", clearId: "pvClearBtn",
  importBtnId: "pvImportBtn", importInputId: "pvImport",
  exportId: "pvExportBtn", templateId: "pvTemplateBtn",
  searchFields: ["document_title", "document_code", "process_owner", "company_name"],
  mapper: valMap,
  columns: [
    { field: "document_title",    header: "Document Title" },
    { field: "document_type",     header: "Document Type" },
    { field: "document_code",     header: "Document Code" },
    { field: "process_owner",     header: "Process Owner" },
    { field: "company_name",      header: "Company Name" },
    { field: "process_exists",    header: "Process Exists? (Y/N)", type: "yn" },
    { field: "if_no_status",      header: "If No → Status" },
    { field: "evidence_exists",   header: "Evidence Exists? (Y/N)", type: "yn" },
    { field: "process_status",    header: "Process Status" },
    { field: "automated",         header: "Automated? (Y/N)", type: "yn" },
    { field: "evidence_reviewed", header: "Evidence Reviewed" },
    { field: "comments",          header: "Comments", type: "textarea" },
  ],
});
