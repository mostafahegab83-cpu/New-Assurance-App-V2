/* Gap Analysis module — self-injecting.
   Adds:
     • A "Gap Analysis" tab in the top nav
     • A "Gap Analysis" tile on the home page (🧭)
     • A section with two sub-pages:
         1) Gap Assessment
         2) Process Validation Interviews
   Requires: firebase.js (Firestore), SheetJS (already loaded in index.html).
   Safe to load AFTER app.js — we bind our own click handler on the injected tab.
*/
import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, writeBatch, serverTimestamp
} from "./firebase.js";

/* ---------- Config ---------- */
const GAP_COL = "gap_assessments";
const VAL_COL = "process_validations";

const GAP_FIELDS = [
  { key: "processId",   label: "Process ID" },
  { key: "processName", label: "Process Name" },
  { key: "processDesc", label: "Process Description" },
  { key: "bestPractice",label: "Best Practice Requirement" },
  { key: "existsInIDH", label: "Existing in IDH (Y/N)" },
  { key: "relatedSOP",  label: "Related Policy/SOP" },
  { key: "gap",         label: "Gap Identified" },
  { key: "comments",    label: "Comments" },
];

const VAL_FIELDS = [
  { key: "docTitle",       label: "Document Title" },
  { key: "docType",        label: "Document Type" },
  { key: "docCode",        label: "Document Code" },
  { key: "processOwner",   label: "Process Owner" },
  { key: "companyName",    label: "Company Name" },
  { key: "processExists",  label: "Process Exists? (Y/N)" },
  { key: "ifNoStatus",     label: "If No → Status" },
  { key: "evidenceExists", label: "Evidence Exists? (Y/N)" },
  { key: "processStatus",  label: "Process Status" },
  { key: "automated",      label: "Automated? (Y/N)" },
  { key: "evidenceReview", label: "Evidence Reviewed" },
  { key: "comments",       label: "Comments" },
];

/* ---------- Utilities ---------- */
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const toast = msg => {
  let t = document.getElementById("gaToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "gaToast";
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f3a8a;color:#fff;padding:10px 18px;border-radius:6px;font-size:13px;z-index:10000;opacity:0;transition:opacity .2s;pointer-events:none;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.style.opacity = "0"), 2400);
};

function buildHeaderMap(headerRow, fields) {
  const map = {};
  headerRow.forEach((h, i) => {
    const n = norm(h);
    fields.forEach(f => { if (norm(f.label) === n) map[f.key] = i; });
  });
  return map;
}

/* ---------- Inject styles ---------- */
function injectStyles() {
  if (document.getElementById("gaStyles")) return;
  const css = `
    #gapAnalysis .ga-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;}
    #gapAnalysis .ga-toolbar input[type=search]{padding:8px 10px;border:1px solid #e3e8ef;border-radius:6px;font-size:13px;min-width:220px;}
    #gapAnalysis .ga-btn{padding:8px 14px;border:1px solid #1f3a8a;background:#1f3a8a;color:#fff;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;}
    #gapAnalysis .ga-btn.secondary{background:#fff;color:#1f3a8a;}
    #gapAnalysis .ga-btn.danger{background:#fff;color:#dc2626;border-color:#dc2626;}
    #gapAnalysis .ga-btn:hover{opacity:.9;}
    #gapAnalysis .ga-table-wrap{overflow:auto;background:#fff;border:1px solid #e3e8ef;border-radius:8px;max-height:70vh;}
    #gapAnalysis table.ga-table{width:100%;border-collapse:collapse;font-size:13px;}
    #gapAnalysis table.ga-table th{position:sticky;top:0;background:#1f3a8a;color:#fff;font-weight:600;padding:8px 10px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.3px;border-bottom:2px solid #16297a;white-space:nowrap;z-index:1;}
    #gapAnalysis table.ga-table td{padding:6px 10px;border-bottom:1px solid #eef1f5;vertical-align:top;}
    #gapAnalysis table.ga-table tr:nth-child(even) td{background:#fafbfc;}
    #gapAnalysis table.ga-table td[contenteditable="true"]{background:#fffbe6 !important;outline:none;}
    #gapAnalysis table.ga-table td[contenteditable="true"]:focus{box-shadow:inset 0 0 0 2px #1f3a8a;}
    #gapAnalysis .ga-empty{padding:32px;text-align:center;color:#6b7280;font-size:14px;}
    #gapAnalysis .ga-count{color:#6b7280;font-size:12px;margin-left:auto;}
    #gapAnalysis .ga-row-del{color:#dc2626;background:none;border:none;cursor:pointer;font-size:16px;padding:2px 6px;}
  `;
  const s = document.createElement("style");
  s.id = "gaStyles";
  s.textContent = css;
  document.head.appendChild(s);
}

/* ---------- Inject nav tab ---------- */
function injectTab() {
  if (document.querySelector('.tab[data-tab="gapAnalysis"]')) return;
  const nav = document.querySelector("nav.tabs");
  if (!nav) return;
  const btn = document.createElement("button");
  btn.className = "tab";
  btn.dataset.tab = "gapAnalysis";
  btn.setAttribute("role", "tab");
  btn.textContent = "Gap Analysis";
  // Insert before Admin tab if present, else before logout wrapper
  const adminTab = nav.querySelector('.tab[data-tab="admin"]');
  if (adminTab) nav.insertBefore(btn, adminTab);
  else nav.appendChild(btn);

  // Bind click manually (app.js already ran)
  btn.addEventListener("click", () => activateGapTab());
}

function activateGapTab() {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const tab = document.querySelector('.tab[data-tab="gapAnalysis"]');
  const panel = document.getElementById("gapAnalysis");
  if (tab) tab.classList.add("active");
  if (panel) panel.classList.add("active");
}

/* ---------- Inject home tile ---------- */
function injectTile() {
  const grid = document.querySelector("#home .home-tiles");
  if (!grid || grid.querySelector('[data-go="gapAnalysis"]')) return;
  const tile = document.createElement("div");
  tile.className = "home-tile";
  tile.dataset.go = "gapAnalysis";
  tile.innerHTML = `<div class="home-icon">🧭</div><h2>Gap Analysis</h2>`;
  grid.appendChild(tile);
  // The delegated document listener in nc-risk-capa.js handles .home-tile[data-go]
  // by simulating a click on the matching tab button — since we have one, it works.
}

/* ---------- Inject section ---------- */
function injectSection() {
  if (document.getElementById("gapAnalysis")) return;
  const anchor = document.getElementById("processInventory") ||
                 document.getElementById("documentControl") ||
                 document.getElementById("home");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "gapAnalysis";
  section.className = "tab-panel";
  section.innerHTML = `
    <div class="subtabs">
      <button class="subtab active" data-gasub="gaAssess">Gap Assessment</button>
      <button class="subtab" data-gasub="gaValid">Process Validation Interviews</button>
    </div>

    <div id="gaAssess" class="ga-sub-panel">
      <div class="ga-toolbar">
        <input type="file" id="gaAssessFile" accept=".xlsx,.xls,.csv" style="display:none;">
        <button class="ga-btn" data-act="import-assess">📥 Import Excel</button>
        <button class="ga-btn secondary" data-act="template-assess">📄 Download Template</button>
        <button class="ga-btn secondary" data-act="export-assess">📤 Export Excel</button>
        <button class="ga-btn secondary" data-act="add-assess">＋ Add Row</button>
        <button class="ga-btn danger" data-act="clear-assess">Clear All</button>
        <input type="search" id="gaAssessSearch" placeholder="Search Gap Assessment…">
        <span class="ga-count" id="gaAssessCount">0 rows</span>
      </div>
      <div class="ga-table-wrap">
        <table class="ga-table" id="gaAssessTable">
          <thead><tr>
            ${GAP_FIELDS.map(f => `<th>${esc(f.label)}</th>`).join("")}
            <th style="width:40px;"></th>
          </tr></thead>
          <tbody><tr><td colspan="${GAP_FIELDS.length + 1}" class="ga-empty">No records yet. Import an Excel file to begin.</td></tr></tbody>
        </table>
      </div>
    </div>

    <div id="gaValid" class="ga-sub-panel" style="display:none;">
      <div class="ga-toolbar">
        <input type="file" id="gaValidFile" accept=".xlsx,.xls,.csv" style="display:none;">
        <button class="ga-btn" data-act="import-valid">📥 Import Excel</button>
        <button class="ga-btn secondary" data-act="template-valid">📄 Download Template</button>
        <button class="ga-btn secondary" data-act="export-valid">📤 Export Excel</button>
        <button class="ga-btn secondary" data-act="add-valid">＋ Add Row</button>
        <button class="ga-btn danger" data-act="clear-valid">Clear All</button>
        <input type="search" id="gaValidSearch" placeholder="Search Validation…">
        <span class="ga-count" id="gaValidCount">0 rows</span>
      </div>
      <div class="ga-table-wrap">
        <table class="ga-table" id="gaValidTable">
          <thead><tr>
            ${VAL_FIELDS.map(f => `<th>${esc(f.label)}</th>`).join("")}
            <th style="width:40px;"></th>
          </tr></thead>
          <tbody><tr><td colspan="${VAL_FIELDS.length + 1}" class="ga-empty">No records yet. Import an Excel file to begin.</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  anchor.parentNode.insertBefore(section, anchor.nextSibling);

  wireSection(section);
}

/* ---------- Sub-tabs and actions ---------- */
function wireSection(section) {
  section.querySelectorAll(".subtab[data-gasub]").forEach(btn => {
    btn.addEventListener("click", () => {
      section.querySelectorAll(".subtab[data-gasub]").forEach(b => b.classList.remove("active"));
      section.querySelectorAll(".ga-sub-panel").forEach(p => (p.style.display = "none"));
      btn.classList.add("active");
      const t = section.querySelector("#" + btn.dataset.gasub);
      if (t) t.style.display = "";
    });
  });

  section.addEventListener("click", e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "import-assess") section.querySelector("#gaAssessFile").click();
    if (act === "import-valid")  section.querySelector("#gaValidFile").click();
    if (act === "template-assess") downloadTemplate("Gap_Assessment_Template.xlsx", GAP_FIELDS);
    if (act === "template-valid")  downloadTemplate("Process_Validation_Template.xlsx", VAL_FIELDS);
    if (act === "export-assess") exportRows("Gap_Assessment.xlsx", GAP_FIELDS, gapRows);
    if (act === "export-valid")  exportRows("Process_Validation.xlsx", VAL_FIELDS, valRows);
    if (act === "add-assess") addBlank(GAP_COL, GAP_FIELDS);
    if (act === "add-valid")  addBlank(VAL_COL, VAL_FIELDS);
    if (act === "clear-assess") clearAll(GAP_COL, gapRows, "Gap Assessment");
    if (act === "clear-valid")  clearAll(VAL_COL, valRows, "Process Validation");
  });

  section.querySelector("#gaAssessFile").addEventListener("change", e => handleFile(e, GAP_COL, GAP_FIELDS));
  section.querySelector("#gaValidFile") .addEventListener("change", e => handleFile(e, VAL_COL, VAL_FIELDS));

  section.querySelector("#gaAssessSearch").addEventListener("input", () => renderTable("gaAssessTable", GAP_FIELDS, gapRows, GAP_COL, section.querySelector("#gaAssessSearch").value));
  section.querySelector("#gaValidSearch") .addEventListener("input", () => renderTable("gaValidTable",  VAL_FIELDS, valRows, VAL_COL, section.querySelector("#gaValidSearch").value));
}

/* ---------- Excel helpers ---------- */
function downloadTemplate(filename, fields) {
  const ws = XLSX.utils.aoa_to_sheet([fields.map(f => f.label)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, filename);
}
function exportRows(filename, fields, rows) {
  const data = [fields.map(f => f.label), ...rows.map(r => fields.map(f => r[f.key] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}

async function handleFile(e, colName, fields) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length < 2) { toast("File is empty."); return; }
    const map = buildHeaderMap(rows[0], fields);
    if (Object.keys(map).length === 0) { toast("No matching columns found in header."); return; }

    const batch = writeBatch(db);
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.some(v => String(v ?? "").trim())) continue;
      const rec = { createdAt: serverTimestamp() };
      fields.forEach(f => {
        const idx = map[f.key];
        rec[f.key] = idx == null ? "" : String(r[idx] ?? "").trim();
      });
      const ref = doc(collection(db, colName));
      batch.set(ref, rec);
      n++;
    }
    await batch.commit();
    toast(`Imported ${n} row${n === 1 ? "" : "s"}.`);
  } catch (err) {
    console.error(err);
    toast("Import failed: " + err.message);
  } finally {
    e.target.value = "";
  }
}

async function addBlank(colName, fields) {
  const rec = { createdAt: serverTimestamp() };
  fields.forEach(f => (rec[f.key] = ""));
  const ref = doc(collection(db, colName));
  try { await setDoc(ref, rec); } catch (err) { toast("Add failed: " + err.message); }
}

async function clearAll(colName, rows, label) {
  if (!rows.length) { toast("Nothing to clear."); return; }
  if (!confirm(`Delete all ${rows.length} ${label} rows? This cannot be undone.`)) return;
  try {
    const batch = writeBatch(db);
    rows.forEach(r => batch.delete(doc(db, colName, r.id)));
    await batch.commit();
    toast("Cleared.");
  } catch (err) {
    toast("Clear failed: " + err.message);
  }
}

/* ---------- Realtime data ---------- */
let gapRows = [];
let valRows = [];

function subscribe() {
  onSnapshot(query(collection(db, GAP_COL), orderBy("createdAt", "desc")), snap => {
    gapRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const s = document.getElementById("gaAssessSearch");
    renderTable("gaAssessTable", GAP_FIELDS, gapRows, GAP_COL, s ? s.value : "");
  }, err => console.error("gap_assessments listener:", err));

  onSnapshot(query(collection(db, VAL_COL), orderBy("createdAt", "desc")), snap => {
    valRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const s = document.getElementById("gaValidSearch");
    renderTable("gaValidTable", VAL_FIELDS, valRows, VAL_COL, s ? s.value : "");
  }, err => console.error("process_validations listener:", err));
}

/* ---------- Render ---------- */
function renderTable(tableId, fields, rows, colName, search) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const q = (search || "").trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => fields.some(f => String(r[f.key] ?? "").toLowerCase().includes(q)))
    : rows;

  const countEl = document.getElementById(tableId === "gaAssessTable" ? "gaAssessCount" : "gaValidCount");
  if (countEl) countEl.textContent = `${filtered.length} row${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${fields.length + 1}" class="ga-empty">${rows.length ? "No matching rows." : "No records yet. Import an Excel file to begin."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r =>
    `<tr data-id="${esc(r.id)}">` +
    fields.map(f => `<td contenteditable="true" data-key="${f.key}">${esc(r[f.key] ?? "")}</td>`).join("") +
    `<td><button class="ga-row-del" title="Delete row">🗑️</button></td>` +
    `</tr>`
  ).join("");

  tbody.querySelectorAll("td[contenteditable=true]").forEach(td => {
    td.addEventListener("blur", async () => {
      const tr = td.closest("tr");
      const id = tr.dataset.id;
      const key = td.dataset.key;
      const val = td.textContent.trim();
      try {
        await setDoc(doc(db, colName, id), { [key]: val, updatedAt: serverTimestamp() }, { merge: true });
      } catch (err) { toast("Save failed: " + err.message); }
    });
    td.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); td.blur(); }
    });
  });

  tbody.querySelectorAll(".ga-row-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      if (!confirm("Delete this row?")) return;
      try { await deleteDoc(doc(db, colName, id)); } catch (err) { toast("Delete failed: " + err.message); }
    });
  });
}

/* ---------- Init ---------- */
function init() {
  try {
    injectStyles();
    injectSection();
    injectTab();
    injectTile();
    subscribe();
  } catch (err) {
    console.error("Gap Analysis init failed:", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
