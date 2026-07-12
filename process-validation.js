// process-validation.js — Process Validation Interviews module
// Firestore collection: "processValidation".
// Excel import expects ONLY these 5 columns (matched by header text):
//   Document Title | Document Type | Document Code | Process Owner | Company Name
// Remaining fields (Process Exists?, Evidence Exists?, Automated?, Status,
// Comments) are filled manually per row via the row's Edit / Save controls.

import {
  db, collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp,
  writeBatch, auth, onAuthStateChanged
} from "./firebase.js";

const COL = "processValidation";

const IMPORT_FIELDS = [
  { key: "docTitle",     label: "Document Title",  aliases: ["document title","title"] },
  { key: "docType",      label: "Document Type",   aliases: ["document type","type"] },
  { key: "docCode",      label: "Document Code",   aliases: ["document code","code","doc code"] },
  { key: "processOwner", label: "Process Owner",   aliases: ["process owner","owner"] },
  { key: "companyName",  label: "Company Name",    aliases: ["company name","company"] },
];

const MANUAL_FIELDS = [
  { key: "processExists",  label: "Process Exists?",  type: "yn" },
  { key: "evidenceExists", label: "Evidence Exists?", type: "yn" },
  { key: "automated",      label: "Automated?",       type: "yn" },
  { key: "status",         label: "Status",           type: "auto" },
  { key: "comments",       label: "Comments",         type: "text" },
];

const ALL_KEYS = [...IMPORT_FIELDS.map(f => f.key), ...MANUAL_FIELDS.map(f => f.key)];
const FILTER_KEYS = ["docTitle", "docType", "docCode", "processOwner", "companyName"];

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

/* ---------- Validation Logic ---------- */
function deriveStatus(r) {
  const pe = String(r.processExists || "").toLowerCase();
  const ev = String(r.evidenceExists || "").toLowerCase();
  const au = String(r.automated || "").toLowerCase();
  if (pe === "no") return "Process Does Not Exist";
  if (pe === "yes") {
    if (ev === "no") return "Non-Existing / Not Implemented";
    if (ev === "yes") {
      if (au === "yes") return "Existing – Automated";
      if (au === "no")  return "Existing – Manual";
      return "Existing";
    }
  }
  return "";
}

function statusColor(s) {
  if (s.startsWith("Existing – Automated")) return "#065f46";
  if (s.startsWith("Existing – Manual"))    return "#92400e";
  if (s === "Existing")                     return "#1d4ed8";
  if (s === "Non-Existing / Not Implemented") return "#b91c1c";
  if (s === "Process Does Not Exist")       return "#6b7280";
  return "#111827";
}

/* ---------- Rendering ---------- */
const CELL = "padding:8px 10px;vertical-align:top;border-right:1px solid #e5e7eb;";
const CELL_LAST = "padding:8px 10px;vertical-align:top;text-align:center;";

function ynSelect(field, value, disabled = false) {
  const opts = ["", "Yes", "No"].map(o =>
    `<option value="${o}" ${String(value||"") === o ? "selected" : ""}>${o || "—"}</option>`
  ).join("");
  return `<select data-field="${field}" ${disabled ? "disabled" : ""}
           style="width:100%;padding:4px;border:1px solid #d1d5db;border-radius:4px;background:${disabled ? '#f3f4f6' : '#fff'};">
           ${opts}
         </select>`;
}

function renderRow(r) {
  const isEdit = editing.has(r.id);
  const status = deriveStatus(r);
  const pe = String(r.processExists || "").toLowerCase();
  const ev = String(r.evidenceExists || "").toLowerCase();
  const evDisabled = pe !== "yes";
  const auDisabled = !(pe === "yes" && ev === "yes");

  const textCell = (key) => isEdit
    ? `<td style="${CELL}">
         <div contenteditable="true" data-field="${key}"
              style="min-height:22px;padding:4px;border:1px dashed #cbd5e1;border-radius:4px;outline:none;background:#f8fafc;"
              onfocus="this.style.background='#eef2ff'"
              onblur="this.style.background='#f8fafc'">${escHtml(r[key] ?? "")}</div>
       </td>`
    : `<td style="${CELL}">${escHtml(r[key] ?? "") || '<span style="color:#9ca3af;">—</span>'}</td>`;

  const ynCell = (key, disabled) => isEdit
    ? `<td style="${CELL}">${ynSelect(key, r[key], disabled)}</td>`
    : `<td style="${CELL}text-align:center;">${escHtml(r[key] || "—")}</td>`;

  const actions = isEdit
    ? `<button class="pv-save"   title="Save"   style="background:#065f46;color:#fff;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Save</button>
       <button class="pv-cancel" title="Cancel" style="background:#e5e7eb;color:#111827;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Cancel</button>
       <button class="pv-del"    title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 8px;margin:0 2px;cursor:pointer;">Delete</button>`
    : `<button class="pv-edit"   title="Edit"   style="background:#1f3a8a;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin:0 2px;cursor:pointer;">Edit</button>
       <button class="pv-del"    title="Delete" style="background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:4px 10px;margin:0 2px;cursor:pointer;">Delete</button>`;

  return `
    <tr data-id="${escHtml(r.id)}" style="border-top:1px solid #e5e7eb;${isEdit ? 'background:#fffbeb;' : ''}">
      ${IMPORT_FIELDS.map(f => textCell(f.key)).join("")}
      ${ynCell("processExists", false)}
      ${ynCell("evidenceExists", evDisabled)}
      ${ynCell("automated", auDisabled)}
      <td style="${CELL}">
        <div style="padding:4px;font-weight:600;color:${statusColor(status)};">${escHtml(status || "—")}</div>
      </td>
      ${textCell("comments")}
      <td style="${CELL_LAST}white-space:nowrap;">${actions}</td>
    </tr>`;
}

function updateFilterOptions() {
  FILTER_KEYS.forEach(key => {
    const sel = document.querySelector(`[data-pv-filter="${key}"]`);
    if (!sel) return;
    const current = sel.value;
    const label = IMPORT_FIELDS.find(f => f.key === key)?.label || key;
    const values = [...new Set(rows.map(r => String(r[key] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">All ${escHtml(label)}</option>` +
      values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join("");
    if (values.includes(current)) sel.value = current;
  });
}

function passesColumnFilters(r) {
  return FILTER_KEYS.every(key => {
    const sel = document.querySelector(`[data-pv-filter="${key}"]`);
    const wanted = sel?.value || "";
    return !wanted || String(r[key] ?? "").trim() === wanted;
  });
}

function render() {
  const tbody = $("#pvTbody");
  const empty = $("#pvEmpty");
  if (!tbody) return;
  updateFilterOptions();
  const q = ($("#pvSearch")?.value || "").trim().toLowerCase();
  const shown = rows.filter(r => {
    const matchesSearch = !q || ALL_KEYS.some(k => String(r[k] ?? "").toLowerCase().includes(q));
    return matchesSearch && passesColumnFilters(r);
  });
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
  }, err => console.error("[process-validation] snapshot error:", err));
}

async function saveRow(id, patch) {
  try {
    const row = rows.find(r => r.id === id) || {};
    const merged = { ...row, ...patch };
    if ("processExists" in patch || "evidenceExists" in patch || "automated" in patch) {
      if ("processExists" in patch && patch.processExists !== "Yes") {
        merged.evidenceExists = ""; merged.automated = "";
        patch.evidenceExists  = ""; patch.automated  = "";
      }
      if ("evidenceExists" in patch && patch.evidenceExists !== "Yes") {
        merged.automated = ""; patch.automated = "";
      }
    }
    patch.status = deriveStatus(merged);
    await setDoc(doc(db, COL, id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error(e); toast("Save failed: " + e.message);
  }
}

async function addRow(data = {}) {
  const payload = {};
  ALL_KEYS.forEach(k => payload[k] = data[k] ?? "");
  payload.status = deriveStatus(payload);
  payload.createdAt = serverTimestamp();
  payload.updatedAt = serverTimestamp();
  try {
    const ref = await addDoc(collection(db, COL), payload);
    editing.add(ref.id); // open new row in edit mode
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
    const match = IMPORT_FIELDS.find(f => f.label.toLowerCase() === n || f.aliases.includes(n));
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
  if (!Object.keys(headerMap).length) {
    toast("No matching headers. Expected: Document Title, Document Type, Document Code, Process Owner, Company Name.");
    return;
  }
  const mapped = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every(c => String(c ?? "").trim() === "")) continue;
    const obj = {};
    ALL_KEYS.forEach(k => obj[k] = "");
    Object.entries(headerMap).forEach(([idx, key]) => {
      obj[key] = String(row[idx] ?? "").trim();
    });
    mapped.push(obj);
  }
  if (!mapped.length) { toast("No data rows detected."); return; }
  if (!confirm(`Import ${mapped.length} row(s) into Process Validation Interviews?`)) return;

  try {
    for (let i = 0; i < mapped.length; i += 400) {
      const batch = writeBatch(db);
      mapped.slice(i, i + 400).forEach(m => {
        const ref = doc(collection(db, COL));
        batch.set(ref, { ...m, status: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
  const headers = [
    ...IMPORT_FIELDS.map(f => f.label),
    "Process Exists?", "Evidence Exists?", "Automated?", "Status", "Comments"
  ];
  const data = [headers];
  rows.forEach(r => data.push([
    ...IMPORT_FIELDS.map(f => r[f.key] ?? ""),
    r.processExists ?? "",
    r.evidenceExists ?? "",
    r.automated ?? "",
    deriveStatus(r),
    r.comments ?? ""
  ]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Process Validation");
  XLSX.writeFile(wb, `process-validation-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  const panel = document.getElementById("processValidation");
  if (!panel) return;

  $("#pvImportFile")?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) importExcel(f).finally(() => (e.target.value = ""));
  });
  $("#pvAddRow")?.addEventListener("click", () => addRow());
  $("#pvExport")?.addEventListener("click", exportExcel);
  $("#pvClear")?.addEventListener("click", clearAll);
  $("#pvSearch")?.addEventListener("input", render);
  panel.querySelectorAll("[data-pv-filter]").forEach(sel => sel.addEventListener("change", render));
  $("#pvResetFilters")?.addEventListener("click", () => {
    $("#pvSearch").value = "";
    panel.querySelectorAll("[data-pv-filter]").forEach(sel => { sel.value = ""; });
    render();
  });

  // Row action buttons (Edit / Save / Cancel / Delete)
  $("#pvTbody")?.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;

    if (e.target.closest(".pv-edit"))   { editing.add(id);    render(); return; }
    if (e.target.closest(".pv-cancel")) { editing.delete(id); render(); return; }
    if (e.target.closest(".pv-del"))    { await deleteRow(id); return; }
    if (e.target.closest(".pv-save"))   {
      const patch = collectRowPatch(tr);
      await saveRow(id, patch);
      editing.delete(id);
      render();
      toast("Saved.");
      return;
    }
  });

  // Cascade Y/N disabling live while editing (visual only; persisted on Save)
  $("#pvTbody")?.addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-field]");
    if (!sel) return;
    const tr = sel.closest("tr[data-id]");
    if (!tr) return;
    const pe = tr.querySelector('select[data-field="processExists"]');
    const ev = tr.querySelector('select[data-field="evidenceExists"]');
    const au = tr.querySelector('select[data-field="automated"]');
    if (pe && ev) {
      const evDis = pe.value !== "Yes";
      ev.disabled = evDis;
      if (evDis) ev.value = "";
      ev.style.background = evDis ? "#f3f4f6" : "#fff";
    }
    if (pe && ev && au) {
      const auDis = !(pe.value === "Yes" && ev.value === "Yes");
      au.disabled = auDis;
      if (auDis) au.value = "";
      au.style.background = auDis ? "#f3f4f6" : "#fff";
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
