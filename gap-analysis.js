// gap-analysis.js — Gap Assessment module
// Firestore collection: "gapAssessment"
// Per-row Edit / Save / Cancel / Delete controls.

import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp,
  writeBatch, auth, onAuthStateChanged
} from "./firebase.js";

const COL = "gapAssessment";

const FIELDS = [
  { key: "documentCode",   label: "Document Code",             aliases: ["document code","doc code","code"] },
  { key: "processName",    label: "Process Name",              aliases: ["process name","process"] },
  { key: "processDesc",    label: "Process Description",       aliases: ["process description","description"] },
  { key: "bestPractice",   label: "Best Practice Requirement", aliases: ["best practice requirement","best practice","requirement"] },
  { key: "existsInIDH",    label: "Existing in IDH (Y/N)",     aliases: ["existing in idh (y/n)","existing in idh","exists in idh","idh"], type: "yn" },
  { key: "relatedPolicy",  label: "Related Policy/SOP",        aliases: ["related policy/sop","related policy","policy/sop","policy","sop"] },
  { key: "gapIdentified",  label: "Gap Identified",            aliases: ["gap identified","gap"] },
  { key: "comments",       label: "Comments",                  aliases: ["comments","comment","notes"] },
];

let rows = [];
let currentUser = null;
let unsubscribe = null;
const editing = new Set();

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
const CELL = "padding:8px 10px;vertical-align:top;border-right:1px solid #e5e7eb;";
const CELL_LAST = "padding:8px 10px;vertical-align:top;text-align:center;";

function ynSelect(field, value) {
  const opts = ["", "Yes", "No"].map(o =>
    `<option value="${o}" ${String(value||"") === o ? "selected" : ""}>${o || "—"}</option>`
  ).join("");
  return `<select data-field="${field}"
           style="width:100%;padding:4px;border:1px solid #d1d5db;border-radius:4px;background:#fff;">
           ${opts}
         </select>`;
}

function renderRow(r) {
  const isEdit = editing.has(r.id);

  const textCell = (key) => isEdit
    ? `<td style="${CELL}">
         <div contenteditable="true" data-field="${key}"
              style="min-height:22px;padding:4px;border:1px dashed #cbd5e1;border-radius:4px;outline:none;background:#f8fafc;white-space:normal;"
              onfocus="this.style.background='#eef2ff'"
              onblur="this.style.background='#f8fafc'">${escHtml(r[key] ?? "")}</div>
       </td>`
    : `<td style="${CELL}">${escHtml(r[key] ?? "") || '<span style="color:#9ca3af;">—</span>'}</td>`;

  const ynCell = (key) => isEdit
    ? `<td style="${CELL}">${ynSelect(key, r[key])}</td>`
    : `<td style="${CELL}text-align:center;">${escHtml(r[key] || "—")}</td>`;

  const actions = isEdit
    ? `<button class="ga-save"   title="Save"   style="background:#065f46;color:#fff;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Save</button>
       <button class="ga-cancel" title="Cancel" style="background:#e5e7eb;color:#111827;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Cancel</button>
       <button class="ga-del"    title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Delete</button>`
    : `<button class="ga-edit"   title="Edit"   style="background:#1f3a8a;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin:0 2px;cursor:pointer;">Edit</button>
       <button class="ga-del"    title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin:0 2px;cursor:pointer;">Delete</button>`;

  return `
    <tr data-id="${escHtml(r.id)}" style="border-top:1px solid #e5e7eb;${isEdit ? 'background:#fffbeb;' : ''}">
      ${FIELDS.map(f => f.type === "yn" ? ynCell(f.key) : textCell(f.key)).join("")}
      <td style="${CELL_LAST}white-space:nowrap;">${actions}</td>
    </tr>`;
}

function render() {
  const tbody = $("#gaTbody");
  const empty = $("#gaEmpty");
  if (!tbody) return;
  const q = ($("#gaSearch")?.value || "").trim().toLowerCase();
  const shown = q
    ? rows.filter(r => FIELDS.some(f => String(r[f.key] ?? "").toLowerCase().includes(q)))
    : rows;
  tbody.innerHTML = shown.map(renderRow).join("");
  if (empty) empty.style.display = shown.length ? "none" : "";
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
  } catch (e) { console.error(e); toast("Save failed: " + e.message); }
}

async function addRow(data = {}) {
  const payload = {};
  FIELDS.forEach(f => payload[f.key] = data[f.key] ?? "");
  payload.createdAt = serverTimestamp();
  payload.updatedAt = serverTimestamp();
  try {
    const ref = await addDoc(collection(db, COL), payload);
    editing.add(ref.id);
  } catch (e) { console.error(e); toast("Add failed: " + e.message); }
}

async function deleteRow(id) {
  if (!confirm("Delete this row?")) return;
  try { editing.delete(id); await deleteDoc(doc(db, COL, id)); }
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
    editing.clear();
    toast("Cleared.");
  } catch (e) { toast("Clear failed: " + e.message); }
}

/* ---------- Excel import ---------- */
function normHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const n = normHeader(h);
    const match = FIELDS.find(f => f.label.toLowerCase() === n || f.aliases.includes(n));
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
    for (let i = 0; i < mapped.length; i += 400) {
      const batch = writeBatch(db);
      mapped.slice(i, i + 400).forEach(m => {
        const ref = doc(collection(db, COL));
        batch.set(ref, { ...m, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(`Imported ${mapped.length} row(s).`);
  } catch (e) { console.error(e); toast("Import failed: " + e.message); }
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

/* ---------- Row action helpers ---------- */
function collectRowPatch(tr) {
  const patch = {};
  tr.querySelectorAll('div[contenteditable][data-field]').forEach(el => {
    patch[el.dataset.field] = el.innerText.trim();
  });
  tr.querySelectorAll('select[data-field]').forEach(sel => {
    patch[sel.dataset.field] = sel.value;
  });
  return patch;
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

  // Sub-tabs
  panel.querySelectorAll(".subtab[data-gasub]").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".subtab[data-gasub]").forEach(b => b.classList.remove("active"));
      panel.querySelectorAll(".ga-sub-panel").forEach(p => p.style.display = "none");
      btn.classList.add("active");
      const t = document.getElementById(btn.dataset.gasub);
      if (t) t.style.display = "";
    });
  });

  // Row actions (Edit / Save / Cancel / Delete)
  $("#gaTbody")?.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;

    if (e.target.closest(".ga-edit"))   { editing.add(id);    render(); return; }
    if (e.target.closest(".ga-cancel")) { editing.delete(id); render(); return; }
    if (e.target.closest(".ga-del"))    { await deleteRow(id); return; }
    if (e.target.closest(".ga-save"))   {
      const patch = collectRowPatch(tr);
      await saveRow(id, patch);
      editing.delete(id);
      render();
      toast("Saved.");
      return;
    }
  });
}

/* ---------- Auth gate ---------- */
onAuthStateChanged(auth, user => {
  currentUser = user || null;
  subscribe();
});

document.addEventListener("DOMContentLoaded", wire);
if (document.readyState !== "loading") wire();
