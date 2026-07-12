// gap-analysis.js — Gap Assessment module
// Reads/writes rows to Firestore collection "gapAssessment".
// Excel format (8 columns, order matters):
//   A: Process Name
//   B: Process Name (second level / sub-process — kept per template)
//   C: Process Description
//   D: Process Owner
//   E: Exists?               (Yes/No)
//   F: Severity              (Critical/High/MED/Low)
//   G: Recommended Action
//   H: Comment

import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp,
  writeBatch, auth, onAuthStateChanged
} from "./firebase.js";

const COL = "gapAssessment";

const FIELDS = [
  { key: "gapId",             label: "Gap ID",               aliases: ["gap id","gapid","id","gap #","gap no","gap number"] },
  { key: "processName2",      label: "Process Name",         aliases: ["process name","process","process name 2","sub-process name","sub process name","subprocess","level 2 process"] },
  { key: "processDesc",       label: "Process Description",  aliases: ["process description","description"] },
  { key: "processOwner",      label: "Process Owner",        aliases: ["process owner","owner","department"] },
  { key: "exists",            label: "Exists?",              aliases: ["exists","exists?","exist","existing","existing in idh","existing in idh (y/n)","y/n","yes/no"] },
  { key: "severity",          label: "Severity",             aliases: ["severity","priority","risk"] },
  { key: "recommendedAction", label: "Recommended Action",   aliases: ["recommended action","recommendation","action"] },
  { key: "comment",           label: "Comment",              aliases: ["comment","comments","notes","note"] },
];

let rows = [];
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

// Position-first mapping (handles the two duplicate "Process Name" headers).
// Falls back to label/alias matching for any header that isn't in the expected slot.
function buildHeaderMap(headerRow) {
  const map = {}; // colIndex -> field key
  const used = new Set();
  // 1) exact positional assignment for the first 8 columns
  FIELDS.forEach((f, idx) => {
    if (idx < headerRow.length) {
      const n = normHeader(headerRow[idx]);
      if (n && (n === f.label.toLowerCase() || f.aliases.includes(n))) {
        map[idx] = f.key;
        used.add(f.key);
      }
    }
  });
  // 2) fill any remaining columns by alias
  headerRow.forEach((h, i) => {
    if (map[i]) return;
    const n = normHeader(h);
    if (!n) return;
    const match = FIELDS.find(f => !used.has(f.key) && (f.label.toLowerCase() === n || f.aliases.includes(n)));
    if (match) { map[i] = match.key; used.add(match.key); }
  });
  // 3) if the sheet is clearly the 8-col template but headers were odd (e.g. duplicate "Process Name" both matched key 1),
  //    force positional mapping for the first 8 columns.
  if (Object.keys(map).length < 4 && headerRow.length >= 8) {
    FIELDS.forEach((f, idx) => { map[idx] = f.key; });
  }
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

  panel.querySelectorAll(".subtab[data-gasub]").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".subtab[data-gasub]").forEach(b => b.classList.remove("active"));
      panel.querySelectorAll(".ga-sub-panel").forEach(p => p.style.display = "none");
      btn.classList.add("active");
      const t = document.getElementById(btn.dataset.gasub);
      if (t) t.style.display = "";
    });
  });

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
