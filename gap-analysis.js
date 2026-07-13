// gap-analysis.js — Gap Assessment module
// Reads/writes rows to Firestore collection "gapAssessment".
// Excel format (8 columns, order matters):
//   A: Gap ID
//   B: Process Name
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

const FILTER_KEYS = ["gapId", "processName2", "processDesc", "processOwner", "exists", "severity"];

let rows = [];
let currentUser = null;
let unsubscribe = null;
const editing = new Set(); // ids currently in edit mode

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
function cellDisplay(r, f) {
  return `<div style="padding:4px;min-height:22px;">${escHtml(r[f.key] ?? "")}</div>`;
}
function cellEdit(r, f) {
  const v = escHtml(r[f.key] ?? "");
  if (f.key === "exists") {
    const cur = String(r[f.key] ?? "").toLowerCase();
    return `<select data-field="${f.key}" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:4px;">
      <option value=""${cur===""?" selected":""}></option>
      <option value="Yes"${cur==="yes"?" selected":""}>Yes</option>
      <option value="No"${cur==="no"?" selected":""}>No</option>
    </select>`;
  }
  if (f.key === "severity") {
    const cur = String(r[f.key] ?? "").toLowerCase();
    const opts = ["","Critical","High","Medium","Low"];
    return `<select data-field="${f.key}" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:4px;">
      ${opts.map(o => `<option value="${o}"${cur===o.toLowerCase()?" selected":""}>${o}</option>`).join("")}
    </select>`;
  }
  const tag = (f.key === "processDesc" || f.key === "recommendedAction" || f.key === "comment") ? "textarea" : "input";
  if (tag === "textarea") {
    return `<textarea data-field="${f.key}" rows="2" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;">${v}</textarea>`;
  }
  return `<input data-field="${f.key}" type="text" value="${v}" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;" />`;
}

function actionsHtml(id, isEdit) {
  if (isEdit) {
    return `
      <button class="ga-save" title="Save" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin-right:4px;cursor:pointer;">Save</button>
      <button class="ga-cancel" title="Cancel" style="background:#64748b;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin-right:4px;cursor:pointer;">Cancel</button>
      <button class="ga-del" title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">Delete</button>`;
  }
  return `
    <button class="ga-edit" title="Edit" style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin-right:4px;cursor:pointer;">Edit</button>
    <button class="ga-del" title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">Delete</button>`;
}

function updateFilterOptions() {
  FILTER_KEYS.forEach(key => {
    const sel = document.querySelector(`[data-ga-filter="${key}"]`);
    if (!sel) return;
    const current = sel.value;
    const label = FIELDS.find(f => f.key === key)?.label || key;
    const values = [...new Set(rows.map(r => String(r[key] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">All ${escHtml(label)}</option>` +
      values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join("");
    if (values.includes(current)) sel.value = current;
  });
}

function passesColumnFilters(r) {
  return FILTER_KEYS.every(key => {
    const sel = document.querySelector(`[data-ga-filter="${key}"]`);
    const wanted = sel?.value || "";
    return !wanted || String(r[key] ?? "").trim() === wanted;
  });
}

function render() {
  const tbody = $("#gaTbody");
  const empty = $("#gaEmpty");
  if (!tbody) return;
  updateFilterOptions();
  const q = ($("#gaSearch")?.value || "").trim().toLowerCase();
  const shown = rows.filter(r => {
    const matchesSearch = !q || FIELDS.some(f => String(r[f.key] ?? "").toLowerCase().includes(q));
    return matchesSearch && passesColumnFilters(r);
  });

  tbody.innerHTML = shown.map(r => {
    const isEdit = editing.has(r.id);
    return `
    <tr data-id="${escHtml(r.id)}" style="border-top:1px solid #e5e7eb;">
      ${FIELDS.map(f => `<td style="padding:6px;vertical-align:top;">${isEdit ? cellEdit(r, f) : cellDisplay(r, f)}</td>`).join("")}
      <td style="padding:6px;text-align:center;white-space:nowrap;">${actionsHtml(r.id, isEdit)}</td>
    </tr>`;
  }).join("");

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
    const ref = await addDoc(collection(db, COL), payload);
    editing.add(ref.id); // open new row in edit mode
  } catch (e) {
    console.error(e); toast("Add failed: " + e.message);
  }
}

async function deleteRow(id) {
  if (!confirm("Delete this row?")) return;
  try { await deleteDoc(doc(db, COL, id)); editing.delete(id); }
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
  const used = new Set();
  FIELDS.forEach((f, idx) => {
    if (idx < headerRow.length) {
      const n = normHeader(headerRow[idx]);
      if (n && (n === f.label.toLowerCase() || f.aliases.includes(n))) {
        map[idx] = f.key;
        used.add(f.key);
      }
    }
  });
  headerRow.forEach((h, i) => {
    if (map[i]) return;
    const n = normHeader(h);
    if (!n) return;
    const match = FIELDS.find(f => !used.has(f.key) && (f.label.toLowerCase() === n || f.aliases.includes(n)));
    if (match) { map[i] = match.key; used.add(match.key); }
  });
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
function collectRowValues(tr) {
  const out = {};
  tr.querySelectorAll("[data-field]").forEach(el => {
    out[el.dataset.field] = (el.value ?? "").toString().trim();
  });
  return out;
}

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
  panel.querySelectorAll("[data-ga-filter]").forEach(sel => sel.addEventListener("change", render));
  $("#gaResetFilters")?.addEventListener("click", () => {
    $("#gaSearch").value = "";
    panel.querySelectorAll("[data-ga-filter]").forEach(sel => { sel.value = ""; });
    render();
  });

  panel.querySelectorAll(".subtab[data-gasub]").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".subtab[data-gasub]").forEach(b => b.classList.remove("active"));
      panel.querySelectorAll(".ga-sub-panel").forEach(p => p.style.display = "none");
      btn.classList.add("active");
      const t = document.getElementById(btn.dataset.gasub);
      if (t) t.style.display = "";
    });
  });

  $("#gaTbody")?.addEventListener("click", async e => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;

    if (e.target.closest(".ga-edit")) {
      editing.add(id); render(); return;
    }
    if (e.target.closest(".ga-cancel")) {
      editing.delete(id); render(); return;
    }
    if (e.target.closest(".ga-del")) {
      await deleteRow(id); return;
    }
    if (e.target.closest(".ga-save")) {
      const patch = collectRowValues(tr);
      await saveRow(id, patch);
      editing.delete(id);
      // let snapshot re-render; do a local render for snappier UX
      const row = rows.find(r => r.id === id);
      if (row) Object.assign(row, patch);
      render();
      toast("Saved.");
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
