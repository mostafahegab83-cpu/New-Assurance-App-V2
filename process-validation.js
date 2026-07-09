// process-validation.js — Process Validation Interviews module
// Reads/writes rows to Firestore collection "processValidation".
// Excel import expects ONLY these 5 columns (matched by header text):
//   Document Title | Document Type | Document Code | Process Owner | Company Name
// The remaining fields (Process Exists?, Evidence Exists?, Automated?, Status,
// Comments) are filled manually in the app. Status is auto-derived from the
// validation logic:
//   - Process Exists = No  → "Process Does Not Exist"
//   - Process Exists = Yes & Evidence Exists = No  → "Non-Existing / Not Implemented"
//   - Process Exists = Yes & Evidence Exists = Yes & Automated = Yes → "Existing – Automated"
//   - Process Exists = Yes & Evidence Exists = Yes & Automated = No  → "Existing – Manual"
//   - Process Exists = Yes & Evidence Exists = Yes & Automated = ""  → "Existing"

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
function ynSelect(field, value, disabled = false) {
  const opts = ["", "Yes", "No"].map(o =>
    `<option value="${o}" ${String(value||"") === o ? "selected" : ""}>${o || "—"}</option>`
  ).join("");
  return `<select data-field="${field}" ${disabled ? "disabled" : ""}
           style="width:100%;padding:4px;border:1px solid #d1d5db;border-radius:4px;background:${disabled ? '#f3f4f6' : '#fff'};">
           ${opts}
         </select>`;
}

function render() {
  const tbody = $("#pvTbody");
  const empty = $("#pvEmpty");
  if (!tbody) return;
  const q = ($("#pvSearch")?.value || "").trim().toLowerCase();
  const shown = q
    ? rows.filter(r => ALL_KEYS.some(k => String(r[k] ?? "").toLowerCase().includes(q)))
    : rows;

  tbody.innerHTML = shown.map(r => {
    const status = deriveStatus(r);
    const pe = String(r.processExists || "").toLowerCase();
    const ev = String(r.evidenceExists || "").toLowerCase();
    // Evidence disabled unless processExists = Yes
    const evDisabled = pe !== "yes";
    // Automated disabled unless processExists = Yes AND evidenceExists = Yes
    const auDisabled = !(pe === "yes" && ev === "yes");

    const editableCell = (key, val) => `
      <td style="padding:6px;vertical-align:top;">
        <div contenteditable="true" data-field="${key}"
             style="min-height:22px;padding:4px;border-radius:4px;outline:none;"
             onfocus="this.style.background='#f1f5f9'"
             onblur="this.style.background='transparent'">${escHtml(val ?? "")}</div>
      </td>`;

    return `
      <tr data-id="${escHtml(r.id)}" style="border-top:1px solid #e5e7eb;">
        ${IMPORT_FIELDS.map(f => editableCell(f.key, r[f.key])).join("")}
        <td style="padding:6px;">${ynSelect("processExists", r.processExists)}</td>
        <td style="padding:6px;">${ynSelect("evidenceExists", r.evidenceExists, evDisabled)}</td>
        <td style="padding:6px;">${ynSelect("automated", r.automated, auDisabled)}</td>
        <td style="padding:6px;vertical-align:top;">
          <div style="padding:4px;font-weight:600;color:${statusColor(status)};">${escHtml(status || "—")}</div>
        </td>
        ${editableCell("comments", r.comments)}
        <td style="padding:6px;text-align:center;">
          <button class="pv-del" title="Delete row"
                  style="background:transparent;border:none;color:#b91c1c;cursor:pointer;font-size:16px;">✕</button>
        </td>
      </tr>`;
  }).join("");

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
  }, err => console.error("[process-validation] snapshot error:", err));
}

async function saveRow(id, patch) {
  try {
    // If any logic field changes, recompute + persist derived status too.
    const row = rows.find(r => r.id === id) || {};
    const merged = { ...row, ...patch };
    if ("processExists" in patch || "evidenceExists" in patch || "automated" in patch) {
      // Cascade clear disabled downstream selects
      if ("processExists" in patch && patch.processExists !== "Yes") {
        merged.evidenceExists = "";
        merged.automated = "";
        patch.evidenceExists = "";
        patch.automated = "";
      }
      if ("evidenceExists" in patch && patch.evidenceExists !== "Yes") {
        merged.automated = "";
        patch.automated = "";
      }
      patch.status = deriveStatus(merged);
    }
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
  try { await addDoc(collection(db, COL), payload); }
  catch (e) { console.error(e); toast("Add failed: " + e.message); }
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

  // Inline text edits (contenteditable) via delegation
  $("#pvTbody")?.addEventListener("blur", e => {
    const cell = e.target.closest("div[contenteditable][data-field]");
    if (!cell) return;
    const tr = cell.closest("tr");
    const id = tr?.dataset.id;
    if (!id) return;
    const key = cell.dataset.field;
    const val = cell.innerText.trim();
    const row = rows.find(r => r.id === id);
    if (row && row[key] !== val) saveRow(id, { [key]: val });
  }, true);

  // Y/N select changes
  $("#pvTbody")?.addEventListener("change", e => {
    const sel = e.target.closest("select[data-field]");
    if (!sel) return;
    const id = sel.closest("tr")?.dataset.id;
    if (!id) return;
    saveRow(id, { [sel.dataset.field]: sel.value });
  });

  // Delete row
  $("#pvTbody")?.addEventListener("click", e => {
    const del = e.target.closest(".pv-del");
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
