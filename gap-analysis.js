// gap-analysis.js — Gap Assessment module
// Reads/writes rows to Firestore collection "gapAssessment".
// Excel import expects ONLY the first 3 columns (matched by header text):
//   Department | Process Name | Process Description
// The remaining fields (Best Practice Requirement, Existing in IDH (Y/N),
// Related Policy/SOP, Gap Identified, Comments) are filled manually in the app.


import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp,
  writeBatch, auth, onAuthStateChanged
} from "./firebase.js";

const COL = "gapAssessment";

const FIELDS = [
  { key: "department",     label: "Department",              aliases: ["department","dept","document code","doc code","code"] },
  { key: "processName",    label: "Process Name",            aliases: ["process name","process"] },
  { key: "processDesc",    label: "Process Description",     aliases: ["process description","description"] },
  { key: "bestPractice",   label: "Best Practice Requirement", aliases: ["best practice requirement","best practice","requirement"] },
  { key: "existsInIDH",    label: "Existing in IDH (Y/N)",   aliases: ["existing in idh (y/n)","existing in idh","exists in idh","idh"] },
  { key: "relatedPolicy",  label: "Related Policy/SOP",      aliases: ["related policy/sop","related policy","policy/sop","policy","sop"] },
  { key: "gapIdentified",  label: "Gap Identified",          aliases: ["gap identified","gap"] },
  { key: "comments",       label: "Comments",                aliases: ["comments","comment","notes"] },
];

let rows = [];       // { id, documentCode, processName, ... }
let currentUser = null;
let unsubscribe = null;

const $ = sel => document.querySelector(sel);
const escHtml = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- Rendering ---------- */
function render() {
  const tbody = $("#gaTbody");
  const empty = $("#gaEmpty");
  if (!tbody) return;
  const q = ($("#gaSearch")?.value || "").trim().toLowerCase();
  const shown = q
    ? rows.filter(r => FIELDS.some(f => String(r[f.key] ?? "").toLowerCase().includes(q)))
    : rows;

  tbody.innerHTML = shown.map(r => `
    <tr data-id="${escHtml(r.id)}" style="border-top:1px solid #e5e7eb;">
      ${FIELDS.map(f => `
        <td style="padding:6px;vertical-align:top;">
          <div contenteditable="true" data-field="${f.key}"
               style="min-height:22px;padding:4px;border-radius:4px;outline:none;"
               onfocus="this.style.background='#f1f5f9'"
               onblur="this.style.background='transparent'">${escHtml(r[f.key] ?? "")}</div>
        </td>`).join("")}
      <td style="padding:6px;text-align:center;">
        <button class="ga-del" title="Delete row"
                style="background:transparent;border:none;color:#b91c1c;cursor:pointer;font-size:16px;">✕</button>
      </td>
    </tr>`).join("");

  empty.style.display = shown.length ? "none" : "";
}

/* ---------- Firestore sync ---------- */
function subscribe() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!currentUser) { rows = []; render(); return; }
  unsubscribe = onSnapshot(collection(db, COL), snap => {
    rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    // Stable sort by createdAt if present
    rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    render();
  }, err => console.error("[gap-analysis] snapshot error:", err));
}

async function saveRow(id, patch) {
  try {
    await setDoc(doc(db, COL, id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error(e); toast("Save failed: " + e.message);
  }
}

async function addRow(data = {}) {
  const payload = {};
  FIELDS.forEach(f => payload[f.key] = data[f.key] ?? "");
  payload.createdAt = serverTimestamp();
  payload.updatedAt = serverTimestamp();
  try {
    await addDoc(collection(db, COL), payload);
  } catch (e) {
    console.error(e); toast("Add failed: " + e.message);
  }
}

async function deleteRow(id) {
  if (!confirm("Delete this row?")) return;
  try { await deleteDoc(doc(db, COL, id)); }
  catch (e) { toast("Delete failed: " + e.message); }
}

async function clearAll() {
  if (!rows.length) return;
  if (!confirm(`Delete all ${rows.length} row(s)? This cannot be undone.`)) return;
  try {
    // Batch deletes (max 500 per batch)
    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db);
      rows.slice(i, i + 400).forEach(r => batch.delete(doc(db, COL, r.id)));
      await batch.commit();
    }
    toast("Cleared.");
  } catch (e) { toast("Clear failed: " + e.message); }
}

/* ---------- Excel import ---------- */
function normHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}
// Only these 3 fields are imported from Excel; the rest stay blank for manual entry.
const IMPORT_KEYS = ["department", "processName", "processDesc"];
function buildHeaderMap(headerRow) {
  const map = {}; // colIndex -> field key
  const importable = FIELDS.filter(f => IMPORT_KEYS.includes(f.key));
  headerRow.forEach((h, i) => {
    const n = normHeader(h);
    const match = importable.find(f => f.label.toLowerCase() === n || f.aliases.includes(n));
    if (match) map[i] = match.key;
  });
  return map;
}


async function importExcel(file) {
  if (typeof XLSX === "undefined") { toast("XLSX library not loaded."); return; }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) { toast("Empty workbook."); return; }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!aoa.length) { toast("No rows found."); return; }

  const headerMap = buildHeaderMap(aoa[0]);
  const mapped = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every(c => String(c ?? "").trim() === "")) continue;
    const obj = {};
    FIELDS.forEach(f => obj[f.key] = "");
    Object.entries(headerMap).forEach(([idx, key]) => {
      obj[key] = String(row[idx] ?? "").trim();
    });
    mapped.push(obj);
  }
  if (!mapped.length) { toast("No data rows detected."); return; }
  if (!confirm(`Import ${mapped.length} row(s) into Gap Assessment?`)) return;

  try {
    // Add in batches
    for (let i = 0; i < mapped.length; i += 400) {
      const batch = writeBatch(db);
      mapped.slice(i, i + 400).forEach(m => {
        const ref = doc(collection(db, COL));
        batch.set(ref, { ...m, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(`Imported ${mapped.length} row(s).`);
  } catch (e) {
    console.error(e); toast("Import failed: " + e.message);
  }
}

function exportExcel() {
  if (typeof XLSX === "undefined") { toast("XLSX library not loaded."); return; }
  const data = [FIELDS.map(f => f.label)];
  rows.forEach(r => data.push(FIELDS.map(f => r[f.key] ?? "")));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gap Assessment");
  XLSX.writeFile(wb, `gap-assessment-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ---------- Wiring ---------- */
function wire() {
  const panel = document.getElementById("gapAnalysis");
  if (!panel) return;

  $("#gaImportFile")?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) importExcel(f).finally(() => (e.target.value = ""));
  });
  $("#gaAddRow")?.addEventListener("click", () => addRow());
  $("#gaExport")?.addEventListener("click", exportExcel);
  $("#gaClear")?.addEventListener("click", clearAll);
  $("#gaSearch")?.addEventListener("input", render);

  // Sub-tabs (single sub-panel today, keeps future ones easy)
  panel.querySelectorAll(".subtab[data-gasub]").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".subtab[data-gasub]").forEach(b => b.classList.remove("active"));
      panel.querySelectorAll(".ga-sub-panel").forEach(p => p.style.display = "none");
      btn.classList.add("active");
      const t = document.getElementById(btn.dataset.gasub);
      if (t) t.style.display = "";
    });
  });

  // Inline edit + delete via delegation
  $("#gaTbody")?.addEventListener("blur", e => {
    const cell = e.target.closest("[data-field]");
    if (!cell) return;
    const tr = cell.closest("tr");
    const id = tr?.dataset.id;
    if (!id) return;
    const key = cell.dataset.field;
    const val = cell.innerText.trim();
    const row = rows.find(r => r.id === id);
    if (row && row[key] !== val) saveRow(id, { [key]: val });
  }, true);

  $("#gaTbody")?.addEventListener("click", e => {
    const del = e.target.closest(".ga-del");
    if (!del) return;
    const id = del.closest("tr")?.dataset.id;
    if (id) deleteRow(id);
  });
}

/* ---------- Auth gate ---------- */
onAuthStateChanged(auth, user => {
  currentUser = user || null;
  subscribe();
});

document.addEventListener("DOMContentLoaded", wire);
if (document.readyState !== "loading") wire();
