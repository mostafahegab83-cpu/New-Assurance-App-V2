/* gap-analysis.js — Gap Analysis module (Gap Assessment + Process Validation Interviews)
   Self-injecting: adds a nav tab, a home tile, and a section without touching index.html markup.
   Requires SheetJS (already loaded from index.html) and firebase.js exports.                    */

import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp
} from "./firebase.js";

/* =========================================================================
   1. Config: the two sub-modules
   ========================================================================= */
const MODULES = {
  gapAssessment: {
    key: "gapAssessment",
    label: "Gap Assessment",
    collection: "gap_assessments",
    columns: [
      { key: "processId",        header: "Process ID" },
      { key: "processName",      header: "Process Name" },
      { key: "processDesc",      header: "Process Description" },
      { key: "bestPractice",     header: "Best Practice Requirement" },
      { key: "existsInIDH",      header: "Existing in IDH (Y/N)" },
      { key: "relatedPolicy",    header: "Related Policy/SOP" },
      { key: "gapIdentified",    header: "Gap Identified" },
      { key: "comments",         header: "Comments", editable: true },
    ],
  },
  processValidation: {
    key: "processValidation",
    label: "Process Validation Interviews",
    collection: "process_validations",
    columns: [
      { key: "docTitle",         header: "Document Title" },
      { key: "docType",          header: "Document Type" },
      { key: "docCode",          header: "Document Code" },
      { key: "processOwner",     header: "Process Owner" },
      { key: "companyName",      header: "Company Name" },
      { key: "processExists",    header: "Process Exists? (Y/N)" },
      { key: "ifNoStatus",       header: "If No → Status" },
      { key: "evidenceExists",   header: "Evidence Exists? (Y/N)" },
      { key: "processStatus",    header: "Process Status" },
      { key: "automated",        header: "Automated? (Y/N)" },
      { key: "evidenceReviewed", header: "Evidence Reviewed" },
      { key: "comments",         header: "Comments", editable: true },
    ],
  },
};

/* =========================================================================
   2. Utilities
   ========================================================================= */
const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) { console.log(msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* Map any incoming row (header→value) to our canonical keys via normalized header match. */
function mapRow(rawRow, columns) {
  const idx = {};
  Object.keys(rawRow).forEach(k => { idx[norm(k)] = rawRow[k]; });
  const out = {};
  columns.forEach(c => {
    const v = idx[norm(c.header)];
    out[c.key] = v === undefined || v === null ? "" : String(v).trim();
  });
  return out;
}

/* =========================================================================
   3. Inject styles
   ========================================================================= */
const style = document.createElement("style");
style.textContent = `
  #gapAnalysis .ga-subtabs{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap;}
  #gapAnalysis .ga-subtab{padding:8px 16px;border:1px solid #1f3a8a;background:#fff;color:#1f3a8a;
    border-radius:6px;font-weight:600;cursor:pointer;font-size:14px;}
  #gapAnalysis .ga-subtab.active{background:#1f3a8a;color:#fff;}
  #gapAnalysis .ga-panel{display:none;}
  #gapAnalysis .ga-panel.active{display:block;}
  #gapAnalysis .ga-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;
    background:#fff;padding:12px;border:1px solid #e3e8ef;border-radius:8px;}
  #gapAnalysis .ga-toolbar input[type=text]{flex:1;min-width:200px;padding:8px 10px;border:1px solid #e3e8ef;
    border-radius:6px;font-size:14px;}
  #gapAnalysis .ga-btn{padding:8px 14px;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;}
  #gapAnalysis .ga-btn.primary{background:#1f3a8a;color:#fff;}
  #gapAnalysis .ga-btn.secondary{background:#fff;color:#1f3a8a;border:1px solid #1f3a8a;}
  #gapAnalysis .ga-btn.danger{background:#dc2626;color:#fff;}
  #gapAnalysis .ga-table-wrap{background:#fff;border:1px solid #e3e8ef;border-radius:8px;overflow:auto;max-height:70vh;}
  #gapAnalysis table.ga-table{width:100%;border-collapse:collapse;font-size:13px;}
  #gapAnalysis table.ga-table th,#gapAnalysis table.ga-table td{border-bottom:1px solid #e3e8ef;padding:8px 10px;
    text-align:left;vertical-align:top;}
  #gapAnalysis table.ga-table th{background:#f5f7fa;color:#1f3a8a;position:sticky;top:0;font-weight:700;font-size:12px;
    text-transform:uppercase;letter-spacing:.3px;}
  #gapAnalysis table.ga-table tr:hover td{background:#fafbfc;}
  #gapAnalysis table.ga-table td[contenteditable=true]{background:#fffbe6;cursor:text;min-width:180px;}
  #gapAnalysis table.ga-table td[contenteditable=true]:focus{outline:2px solid #1f3a8a;background:#fff;}
  #gapAnalysis .ga-empty{padding:24px;text-align:center;color:#6b7280;}
  #gapAnalysis .ga-count{font-size:12px;color:#6b7280;margin-left:auto;}
  #gapAnalysis .ga-row-del{color:#dc2626;background:none;border:none;cursor:pointer;font-size:16px;}
`;
document.head.appendChild(style);

/* =========================================================================
   4. Inject nav tab + home tile + section
   ========================================================================= */
function injectUI() {
  const tabsBar = document.querySelector("nav.tabs");
  if (tabsBar && !tabsBar.querySelector('[data-tab="gapAnalysis"]')) {
    const adminBtn = tabsBar.querySelector('[data-tab="admin"]');
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.setAttribute("role", "tab");
    btn.dataset.tab = "gapAnalysis";
    btn.textContent = "Gap Analysis";
    // add our own click handler (app.js already bound existing tabs before we injected)
    btn.addEventListener("click", () => activateTab("gapAnalysis"));
    if (adminBtn) tabsBar.insertBefore(btn, adminBtn);
    else tabsBar.appendChild(btn);
  }

  const tiles = document.querySelector("#home .home-tiles");
  if (tiles && !tiles.querySelector('[data-go="gapAnalysis"]')) {
    const tile = document.createElement("div");
    tile.className = "home-tile";
    tile.dataset.go = "gapAnalysis";
    tile.innerHTML = `<div class="home-icon">🧭</div><h2>Gap Analysis</h2>`;
    tiles.appendChild(tile);
    // In case the delegated handler in nc-risk-capa.js is not present, fall back.
    tile.addEventListener("click", () => activateTab("gapAnalysis"));
  }

  if (!document.getElementById("gapAnalysis")) {
    const main = document.querySelector("main") || document.body;
    const section = document.createElement("section");
    section.id = "gapAnalysis";
    section.className = "tab-panel";
    section.innerHTML = `
      <div class="ga-subtabs">
        <button class="ga-subtab active" data-ga-sub="gapAssessment">Gap Assessment</button>
        <button class="ga-subtab" data-ga-sub="processValidation">Process Validation Interviews</button>
      </div>
      <div class="ga-panel active" data-ga-panel="gapAssessment"></div>
      <div class="ga-panel" data-ga-panel="processValidation"></div>
    `;
    main.appendChild(section);

    section.querySelectorAll(".ga-subtab").forEach(b => {
      b.addEventListener("click", () => {
        section.querySelectorAll(".ga-subtab").forEach(x => x.classList.remove("active"));
        section.querySelectorAll(".ga-panel").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        section.querySelector(`.ga-panel[data-ga-panel="${b.dataset.gaSub}"]`).classList.add("active");
      });
    });

    renderModule(section.querySelector('[data-ga-panel="gapAssessment"]'), MODULES.gapAssessment);
    renderModule(section.querySelector('[data-ga-panel="processValidation"]'), MODULES.processValidation);
  }
}

/* Duplicate of app.js tab-switch, safe for our injected button. */
function activateTab(id) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  const panel = document.getElementById(id);
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");
}

/* =========================================================================
   5. Render one module (toolbar + table + Firestore sync + Excel)
   ========================================================================= */
function renderModule(root, mod) {
  root.innerHTML = `
    <div class="ga-toolbar">
      <input type="text" data-ga-search placeholder="Search…" />
      <button class="ga-btn secondary" data-ga-template>⬇ Template</button>
      <button class="ga-btn primary"   data-ga-import>⬆ Import Excel</button>
      <input type="file" data-ga-file accept=".xlsx,.xls,.csv" style="display:none" />
      <button class="ga-btn secondary" data-ga-export>Export Excel</button>
      <button class="ga-btn danger"    data-ga-clear>Clear All</button>
      <span class="ga-count" data-ga-count>0 rows</span>
    </div>
    <div class="ga-table-wrap">
      <table class="ga-table">
        <thead><tr>
          ${mod.columns.map(c => `<th>${esc(c.header)}</th>`).join("")}
          <th style="width:40px"></th>
        </tr></thead>
        <tbody data-ga-body>
          <tr><td colspan="${mod.columns.length + 1}" class="ga-empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  `;

  let rows = [];        // [{id, ...fields}]
  let filter = "";

  const body   = root.querySelector("[data-ga-body]");
  const search = root.querySelector("[data-ga-search]");
  const count  = root.querySelector("[data-ga-count]");
  const file   = root.querySelector("[data-ga-file]");

  const draw = () => {
    const q = filter.toLowerCase().trim();
    const visible = q
      ? rows.filter(r => mod.columns.some(c => String(r[c.key] ?? "").toLowerCase().includes(q)))
      : rows;
    count.textContent = `${visible.length} of ${rows.length} rows`;
    if (!visible.length) {
      body.innerHTML = `<tr><td colspan="${mod.columns.length + 1}" class="ga-empty">
        ${rows.length ? "No rows match your search." : "No data yet — import an Excel file to get started."}
      </td></tr>`;
      return;
    }
    body.innerHTML = visible.map(r => `
      <tr data-id="${esc(r.id)}">
        ${mod.columns.map(c => `
          <td ${c.editable ? 'contenteditable="true" data-field="'+c.key+'"' : ''}>${esc(r[c.key])}</td>
        `).join("")}
        <td><button class="ga-row-del" title="Delete row">✕</button></td>
      </tr>
    `).join("");
  };

  /* Firestore realtime */
  onSnapshot(collection(db, mod.collection), snap => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // sort by first column value for stability
    const k = mod.columns[0].key;
    rows.sort((a,b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")));
    draw();
  }, err => {
    console.error("[gap-analysis] snapshot error", err);
    body.innerHTML = `<tr><td colspan="${mod.columns.length + 1}" class="ga-empty">
      Cannot load data: ${esc(err.message || err.code)}. Make sure Firestore rules allow
      "${mod.collection}".
    </td></tr>`;
  });

  /* Search */
  search.addEventListener("input", e => { filter = e.target.value; draw(); });

  /* Inline edit (Comments) */
  body.addEventListener("blur", async (e) => {
    const td = e.target.closest("td[contenteditable=true]");
    if (!td) return;
    const tr = td.closest("tr");
    const id = tr?.dataset.id;
    const field = td.dataset.field;
    if (!id || !field) return;
    try {
      await setDoc(doc(db, mod.collection, id), {
        [field]: td.textContent.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast("Saved");
    } catch (err) {
      toast("Save failed: " + (err.message || err.code));
    }
  }, true);

  /* Delete row */
  body.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ga-row-del");
    if (!btn) return;
    const id = btn.closest("tr")?.dataset.id;
    if (!id) return;
    if (!confirm("Delete this row?")) return;
    try { await deleteDoc(doc(db, mod.collection, id)); toast("Deleted"); }
    catch (err) { toast("Delete failed: " + (err.message || err.code)); }
  });

  /* Template download */
  root.querySelector("[data-ga-template]").addEventListener("click", () => {
    const ws = XLSX.utils.aoa_to_sheet([mod.columns.map(c => c.header)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mod.label.substring(0, 28));
    XLSX.writeFile(wb, `${mod.key}-template.xlsx`);
  });

  /* Export */
  root.querySelector("[data-ga-export]").addEventListener("click", () => {
    const aoa = [mod.columns.map(c => c.header)];
    rows.forEach(r => aoa.push(mod.columns.map(c => r[c.key] ?? "")));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mod.label.substring(0, 28));
    XLSX.writeFile(wb, `${mod.key}-${new Date().toISOString().slice(0,10)}.xlsx`);
  });

  /* Import */
  root.querySelector("[data-ga-import]").addEventListener("click", () => file.click());
  file.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!raw.length) { toast("File is empty"); return; }
      const mapped = raw.map(r => mapRow(r, mod.columns));
      if (!confirm(`Import ${mapped.length} rows into ${mod.label}?`)) { file.value = ""; return; }
      const batch = writeBatch(db);
      mapped.forEach(row => {
        const ref = doc(collection(db, mod.collection));
        batch.set(ref, { ...row, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
      toast(`Imported ${mapped.length} rows`);
    } catch (err) {
      console.error(err);
      toast("Import failed: " + (err.message || err.code));
    } finally {
      file.value = "";
    }
  });

  /* Clear all */
  root.querySelector("[data-ga-clear]").addEventListener("click", async () => {
    if (!rows.length) return;
    if (!confirm(`Delete ALL ${rows.length} rows from ${mod.label}? This cannot be undone.`)) return;
    try {
      // batch limit is 500
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        rows.slice(i, i + 400).forEach(r => batch.delete(doc(db, mod.collection, r.id)));
        await batch.commit();
      }
      toast("Cleared");
    } catch (err) {
      toast("Clear failed: " + (err.message || err.code));
    }
  });
}

/* =========================================================================
   6. Boot — inject after DOM is ready and after other scripts have bound.
   ========================================================================= */
function boot() {
  // Run after current tick so app.js (module) finishes wiring the initial tabs.
  setTimeout(injectUI, 0);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
