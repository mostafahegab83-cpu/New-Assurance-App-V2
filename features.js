// features.js — merged feature modules (Document Control, Process Inventory, NC/Risk/CAPA, Gap Assessment, Process Validation + dashboards).
// Each former file runs in its own block scope, exactly as it ran in its own module.
import { db, auth, collection, onSnapshot, onAuthStateChanged, query, orderBy, storage, doc, setDoc, getDoc, deleteDoc, serverTimestamp, ref, uploadBytes, getDownloadURL, deleteObject, ADMIN_EMAILS, addDoc, writeBatch } from "./firebase.js";

/* ===== nc-risk-capa.js (merged) ===== */
{ try {
/* NC / Risk & CAPA combined view — derives data from compliance_records (Audit form).
   No add/edit/delete here — read-only views with filters, kanban, cards, detail card,
   and Excel + PDF export. */

const NA = "N/A";
let RECORDS = [];

/* ---------- Home tile launcher → tab navigation ---------- */
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".home-tile[data-go]");
  if (tile) {
    const target = document.querySelector(`.tab[data-tab="${tile.dataset.go}"]`);
    if (target) target.click();
  }
});

/* ---------- Sub-tabs inside NC/Risk & CAPA ---------- */
document.querySelectorAll("#ncrc .subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#ncrc .subtab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("#ncrc .sub-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.sub).classList.add("active");
    renderAll();
  });
});

/* ---------- Helpers ---------- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const v = (x) => (x === undefined || x === null || x === "" ? NA : x);

function passText(rec, fields, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return fields.some((f) => String(rec[f] ?? "").toLowerCase().includes(s));
}

function ncRows() {
  // Audit rows that represent a non-conformance entry
  return RECORDS.filter(
    (r) =>
      (r.compliance && r.compliance !== NA && r.compliance !== "Compliant") ||
      (r.ncId && r.ncId !== NA) ||
      (r.ncType && r.ncType !== NA)
  );
}
function capaRows() {
  return RECORDS.filter(
    (r) =>
      (r.capaNeeded === "Yes") ||
      (r.capaIdField && r.capaIdField !== NA) ||
      (r.capaStatus && r.capaStatus !== NA)
  );
}
function riskRows() {
  return RECORDS.filter(
    (r) =>
      r.riskExist === "Yes" ||
      (r.riskId && r.riskId !== NA) ||
      (r.riskLevel && r.riskLevel !== NA && r.riskLevel !== "N/A")
  );
}

/* ---------- NC breakdown per Action Owner ---------- */
function renderNcOwnerBreakdown(rows) {
  const tb = document.querySelector("#ncOwnerTable tbody");
  const msg = document.getElementById("ncOwnerMsg");
  if (!tb) return;
  const TYPES = ["Major", "Minor", "Enhancement"];
  const SEVS = ["Critical", "High", "Medium", "Low"];
  const by = {};
  rows.forEach((r) => {
    const o = String(r.ncResponsibleDept || "").trim() || "Unassigned";
    const g = by[o] || (by[o] = { total: 0, t: {}, s: {} });
    g.total++;
    if (TYPES.includes(r.ncType)) g.t[r.ncType] = (g.t[r.ncType] || 0) + 1;
    if (SEVS.includes(r.severityLevel)) g.s[r.severityLevel] = (g.s[r.severityLevel] || 0) + 1;
  });
  const owners = Object.keys(by).sort((a, b) => by[b].total - by[a].total || a.localeCompare(b));
  const total = rows.length;
  if (!owners.length) {
    tb.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:16px;">No NC records in this scope.</td></tr>`;
    if (msg) msg.textContent = "";
    return;
  }
  const cell = (n, cls) => `<td style="text-align:center;${n && cls ? cls : ""}">${n || "–"}</td>`;
  const sevCls = { Critical: "background:#fee2e2;color:#991b1b;font-weight:700;", High: "background:#ffedd5;color:#c2410c;font-weight:700;" };
  tb.innerHTML = owners.map((o) => {
    const g = by[o], pct = Math.round(g.total / total * 100);
    return `<tr class="clickable" data-owner="${esc(o)}">
      <td><b>${esc(o)}</b></td>
      <td style="text-align:center;font-weight:700;">${g.total}</td>
      <td style="min-width:110px;"><div style="display:flex;align-items:center;gap:6px;">
        <div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px;"><div style="width:${pct}%;background:#d12027;height:8px;border-radius:4px;"></div></div><span style="font-size:12px;">${pct}%</span></div></td>
      ${TYPES.map((t) => cell(g.t[t])).join("")}
      ${SEVS.map((x) => cell(g.s[x], sevCls[x])).join("")}</tr>`;
  }).join("") + `<tr style="font-weight:700;background:#f8fafc;"><td>Total</td><td style="text-align:center;">${total}</td><td></td>`
    + TYPES.map((t) => cell(rows.filter((r) => r.ncType === t).length)).join("")
    + SEVS.map((x) => cell(rows.filter((r) => r.severityLevel === x).length)).join("") + `</tr>`;
  if (msg) {
    const top = owners[0], share = Math.round(by[top].total / total * 100);
    const crit = owners.filter((o) => (by[o].s.Critical || 0) + (by[o].s.High || 0) > 0)
      .sort((a, b) => ((by[b].s.Critical || 0) + (by[b].s.High || 0)) - ((by[a].s.Critical || 0) + (by[a].s.High || 0)))[0];
    msg.textContent = `${top} holds the most NCs: ${by[top].total} of ${total} (${share}%).`
      + (crit ? ` Most Critical/High items: ${crit} (${(by[crit].s.Critical || 0) + (by[crit].s.High || 0)}).` : "");
  }
  tb.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", () => {
    const o = tr.dataset.owner;
    const inp = document.getElementById("ncrcNcSearch");
    if (inp) { inp.value = o === "Unassigned" ? "" : o; renderNc(); }
  }));
}

/* ---------- NC table ---------- */
function renderNc() {
  const q = document.getElementById("ncrcNcSearch")?.value || "";
  const type = document.getElementById("ncrcNcType")?.value || "";
  const sev = document.getElementById("ncrcNcSeverity")?.value || "";
  const comp = document.getElementById("ncrcNcCompliance")?.value || "";
  const rows = ncRows().filter(
    (r) =>
      (!type || r.ncType === type) &&
      (!sev || r.severityLevel === sev) &&
      (!comp || r.compliance === comp) &&
      passText(r, ["ncId", "auditId", "processName", "rootCause", "ncDesc", "ncResponsibleDept"], q)
  );
  renderNcOwnerBreakdown(rows);
  const tbody = document.querySelector("#ncrcNcTable tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `<tr class="clickable" data-id="${r.id}">
      <td>${esc(v(r.ncId))}</td><td>${esc(v(r.auditId))}</td><td>${esc(v(r.auditDate))}</td>
      <td>${esc(v(r.processName))}</td><td>${esc(v(r.processPhase))}</td>
      <td>${esc(v(r.compliance))}</td><td>${esc(v(r.ncType))}</td><td>${esc(v(r.severityLevel))}</td>
      <td>${esc(v(r.ncCategory))}</td><td>${esc(v(r.ncResponsibleDept))}</td>
      <td>${esc(v(r.rootCause))}</td><td>${esc(v(r.verifiedBy))}</td></tr>`
    )
    .join("") || `<tr><td colspan="12" style="text-align:center;color:#6b7280;padding:24px;">No NC records yet — add via the Audit form.</td></tr>`;
  document.getElementById("ncrcNcCount").textContent = `${rows.length} record(s)`;
  tbody.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => openDetail(tr.dataset.id, "NC Detail"))
  );
}

/* ---------- CAPA kanban + table ---------- */
const CAPA_STATUSES = ["Pending", "In Progress", "Overdue", "Closed", "Cancelled"];
function renderCapa() {
  const q = document.getElementById("ncrcCapaSearch")?.value || "";
  const type = document.getElementById("ncrcCapaType")?.value || "";
  const status = document.getElementById("ncrcCapaStatus")?.value || "";
  const rows = capaRows().filter(
    (r) =>
      (!type || r.capaType === type) &&
      (!status || r.capaStatus === status) &&
      passText(r, ["capaIdField", "ncId", "auditId", "processName", "actionOwner", "accountable"], q)
  );

  const kanban = document.getElementById("ncrcCapaKanban");
  kanban.innerHTML = CAPA_STATUSES.map((st) => {
    const items = rows.filter((r) => (r.capaStatus || "Pending") === st);
    return `<div class="kanban-col"><h4>${st}<span>${items.length}</span></h4>${items
      .map(
        (r) => `<div class="kanban-card" data-id="${r.id}">
        <div class="k-id">${esc(v(r.capaIdField))}</div>
        <div>${esc(v(r.processName))}</div>
        <div class="muted" style="font-size:11px;">${esc(v(r.actionOwner))}</div></div>`
      )
      .join("")}</div>`;
  }).join("");
  kanban.querySelectorAll(".kanban-card").forEach((c) =>
    c.addEventListener("click", () => openDetail(c.dataset.id, "CAPA Detail"))
  );

  const tbody = document.querySelector("#ncrcCapaTable tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `<tr class="clickable" data-id="${r.id}">
      <td>${esc(v(r.capaIdField))}</td><td>${esc(v(r.auditId))}</td><td>${esc(v(r.ncId))}</td>
      <td>${esc(v(r.processName))}</td><td>${esc(v(r.processPhase))}</td>
      <td>${esc(v(r.capaType))}</td><td>${esc(v(r.rcCategory))}</td><td>${esc(v(r.capaStatus))}</td>
      <td>${esc(v(r.actionOwner))}</td><td>${esc(v(r.accountable))}</td>
      <td>${esc(v(r.startDate))}</td><td>${esc(v(r.endDate))}</td><td>${esc(v(r.effectiveness))}</td></tr>`
    )
    .join("") || `<tr><td colspan="13" style="text-align:center;color:#6b7280;padding:24px;">No CAPA records yet — add via the Audit form.</td></tr>`;
  document.getElementById("ncrcCapaCount").textContent = `${rows.length} record(s)`;
  tbody.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => openDetail(tr.dataset.id, "CAPA Detail"))
  );
}

/* ---------- Risk cards ---------- */
function renderRisk() {
  const q = document.getElementById("ncrcRiskSearch")?.value || "";
  const lvl = document.getElementById("ncrcRiskLevel")?.value || "";
  const mit = document.getElementById("ncrcRiskMitigation")?.value || "";
  const fAuditId = (document.getElementById("ncrcRiskAuditId")?.value || "").toLowerCase();
  const fAuditDate = document.getElementById("ncrcRiskAuditDate")?.value || "";
  const fProcName = (document.getElementById("ncrcRiskProcessName")?.value || "").toLowerCase();
  const fProcPhase = (document.getElementById("ncrcRiskProcessPhase")?.value || "").toLowerCase();
  const fRiskId = (document.getElementById("ncrcRiskRiskId")?.value || "").toLowerCase();
  const fLinkedCapa = (document.getElementById("ncrcRiskLinkedCapaId")?.value || "").toLowerCase();
  const rows = riskRows().filter(
    (r) =>
      (!lvl || r.riskLevel === lvl) &&
      (!mit || r.mitigation === mit) &&
      (!fAuditId || String(r.auditId ?? "").toLowerCase().includes(fAuditId)) &&
      (!fAuditDate || String(r.auditDate ?? "") === fAuditDate) &&
      (!fProcName || String(r.processName ?? "").toLowerCase().includes(fProcName)) &&
      (!fProcPhase || String(r.processPhase ?? "").toLowerCase().includes(fProcPhase)) &&
      (!fRiskId || String(r.riskId ?? "").toLowerCase().includes(fRiskId)) &&
      (!fLinkedCapa || String(r.linkedCapaId ?? "").toLowerCase().includes(fLinkedCapa)) &&
      passText(r, ["riskId", "riskType", "affectedDepartment", "riskOwner", "control", "findings"], q)
  );
  const wrap = document.getElementById("ncrcRiskCards");
  const field = (label, val) => `<div class="rc-field"><span class="rc-label">${esc(label)}</span><span class="rc-value">${esc(v(val))}</span></div>`;
  wrap.innerHTML = rows
    .map(
      (r) => `<div class="risk-card" data-id="${r.id}">
      <div class="rc-head"><span class="rc-id">${esc(v(r.riskId))}</span>
        <span class="rc-level lvl-${esc(r.riskLevel || "")}">${esc(v(r.riskLevel))}</span></div>
      <div><strong>${esc(v(r.riskType))}</strong> — ${esc(v(r.affectedDepartment))}</div>
      <div class="rc-grid">
        ${field("Review ID", r.auditId)}
        ${field("Review Date", r.auditDate)}
        ${field("Process Name", r.processName)}
        ${field("Process Phase", r.processPhase)}
        ${field("Risk ID", r.riskId)}
        ${field("Risk Exist", r.riskExist)}
        ${field("Risk Type", r.riskType)}
        ${field("Risk Level", r.riskLevel)}
        ${field("Affected Department", r.affectedDepartment)}
        ${field("Risk Owner", r.riskOwner)}
        ${field("Mitigation", r.mitigation)}
        ${field("Linked CAPA ID", r.linkedCapaId)}
        ${field("Control", r.control)}
      </div>
      <div class="rc-findings"><strong>Findings:</strong> ${esc(v(r.findings))}</div>
      <div class="muted" style="font-size:11px;margin-top:6px;text-align:right;">Click for full detail</div></div>`
    )
    .join("") || `<p class="muted" style="grid-column:1/-1;text-align:center;padding:24px;">No Risk records yet — add via the Audit form.</p>`;

  const tbody = document.querySelector("#ncrcRiskTable tbody");
  if (tbody) {
    tbody.innerHTML = rows
      .map(
        (r) => `<tr class="clickable" data-id="${r.id}">
        <td>${esc(v(r.riskId))}</td><td>${esc(v(r.auditId))}</td><td>${esc(v(r.auditDate))}</td>
        <td>${esc(v(r.processName))}</td><td>${esc(v(r.processPhase))}</td>
        <td>${esc(v(r.riskExist))}</td><td>${esc(v(r.riskType))}</td><td>${esc(v(r.riskLevel))}</td>
        <td>${esc(v(r.affectedDepartment))}</td><td>${esc(v(r.riskOwner))}</td>
        <td>${esc(v(r.mitigation))}</td><td>${esc(v(r.linkedCapaId))}</td>
        <td>${esc(v(r.control))}</td><td>${esc(v(r.findings))}</td></tr>`
      )
      .join("") || `<tr><td colspan="14" style="text-align:center;color:#6b7280;padding:24px;">No Risk records yet — add via the Audit form.</td></tr>`;
    tbody.querySelectorAll("tr.clickable").forEach((tr) =>
      tr.addEventListener("click", () => openDetail(tr.dataset.id, "Risk Detail"))
    );
  }

  document.getElementById("ncrcRiskCount").textContent = `${rows.length} record(s)`;
  wrap.querySelectorAll(".risk-card").forEach((c) =>
    c.addEventListener("click", () => openDetail(c.dataset.id, "Risk Detail"))
  );
}

/* ---------- Detail card modal ---------- */
const DETAIL_FIELDS = [
  ["Review ID", "auditId"], ["Review Date", "auditDate"],
  ["Process", "processName"], ["Phase", "processPhase"],
  ["Department", "department"], ["Owner", "owner"],
  ["Compliance", "compliance"], ["NC Reason", "complianceReason"],
  ["NC ID", "ncId"], ["NC Type", "ncType"], ["NC Category", "ncCategory"],
  ["Severity", "severityLevel"], ["Responsible Dept", "ncResponsibleDept"],
  ["NC Description", "ncDesc"], ["Root Cause", "rootCause"],
  ["Target SLA", "targetSla"], ["Actual SLA", "actualSla"], ["Verified By", "verifiedBy"],
  ["Risk ID", "riskId"], ["Risk Exist", "riskExist"], ["Risk Type", "riskType"],
  ["Risk Level", "riskLevel"], ["Affected Dept", "affectedDepartment"],
  ["Risk Owner", "riskOwner"], ["Mitigation", "mitigation"],
  ["Linked CAPA ID", "linkedCapaId"], ["Control", "control"], ["Findings/Gaps", "findings"],
  ["CAPA ID", "capaIdField"], ["CAPA Needed", "capaNeeded"], ["CAPA Type", "capaType"],
  ["RC Category", "rcCategory"], ["CAPA Status", "capaStatus"],
  ["Action Owner", "actionOwner"], ["Accountable", "accountable"],
  ["Start Date", "startDate"], ["End Date", "endDate"], ["Closure Date", "closureDate"],
  ["Overdue Dates", "overdueDates"], ["Effectiveness Criteria", "effectivenessCriteria"],
  ["Effectiveness", "effectiveness"], ["Comment", "ncDescription"], ["Comments", "comments"],
];
function openDetail(id, title) {
  const r = RECORDS.find((x) => x.id === id);
  if (!r) return;
  const html = `<div class="detail-overlay" id="detailOverlay">
    <div class="detail-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3>${esc(title)}</h3>
        <button class="btn ghost" id="detailClose">✕</button>
      </div>
      <div class="detail-grid">
        ${DETAIL_FIELDS.map(
          ([lbl, k]) => `<div class="row"><span class="lbl">${esc(lbl)}</span><span class="val">${esc(v(r[k]))}</span></div>`
        ).join("")}
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  const ov = document.getElementById("detailOverlay");
  ov.addEventListener("click", (e) => {
    if (e.target.id === "detailOverlay" || e.target.id === "detailClose") ov.remove();
  });
}

/* ---------- Export Excel / PDF ---------- */
function activeSub() {
  return document.querySelector(".sub-panel.active")?.id || "sub-nc";
}
function exportExcel(kind) {
  const map = { nc: ncRows(), capa: capaRows(), risk: riskRows() };
  const rows = map[kind] || [];
  const cols = DETAIL_FIELDS.map(([lbl]) => lbl);
  const data = [cols, ...rows.map((r) => DETAIL_FIELDS.map(([, k]) => v(r[k])))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind.toUpperCase());
  XLSX.writeFile(wb, `${kind}-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
function exportPdf(kind) {
  const map = { nc: ncRows(), capa: capaRows(), risk: riskRows() };
  const rows = map[kind] || [];
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
  pdf.setFontSize(14);
  pdf.text(`${kind.toUpperCase()} Register — ${new Date().toLocaleString()}`, 30, 30);
  pdf.setFontSize(8);
  const headers = ["NC ID", "CAPA ID", "Risk ID", "Review ID", "Process", "Compliance", "Status", "Owner"];
  const body = rows.map((r) => [v(r.ncId), v(r.capaIdField), v(r.riskId), v(r.auditId),
    v(r.processName), v(r.compliance), v(r.capaStatus || r.mitigation), v(r.actionOwner || r.riskOwner || r.owner)]);
  let y = 60;
  pdf.text(headers.join(" | "), 30, y); y += 14;
  body.forEach((row) => {
    pdf.text(row.map((c) => String(c).slice(0, 28)).join(" | "), 30, y);
    y += 12;
    if (y > 800) { pdf.addPage(); y = 30; }
  });
  pdf.save(`${kind}-register-${new Date().toISOString().slice(0, 10)}.pdf`);
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-export]");
  if (!btn) return;
  const [kind, fmt] = btn.dataset.export.split("-");
  if (fmt === "excel") exportExcel(kind);
  else exportPdf(kind);
});

/* ---------- Filter wiring ---------- */
["ncrcNcSearch", "ncrcNcType", "ncrcNcSeverity", "ncrcNcCompliance"].forEach((id) =>
  document.getElementById(id)?.addEventListener("input", renderNc)
);
["ncrcCapaSearch", "ncrcCapaType", "ncrcCapaStatus"].forEach((id) =>
  document.getElementById(id)?.addEventListener("input", renderCapa)
);
["ncrcRiskSearch", "ncrcRiskLevel", "ncrcRiskMitigation",
 "ncrcRiskAuditId", "ncrcRiskAuditDate", "ncrcRiskProcessName",
 "ncrcRiskProcessPhase", "ncrcRiskRiskId", "ncrcRiskLinkedCapaId"].forEach((id) =>
  document.getElementById(id)?.addEventListener("input", renderRisk)
);

function renderAll() { renderNc(); renderCapa(); renderRisk(); }

/* ---------- Firestore subscription ----------
   Query without orderBy so records missing createdAt still appear.
   Sort client-side by createdAt (newest first), falling back to importSeq / id. */
let unsubNcrc = null;

function startNcrcSync() {
  if (unsubNcrc) return;
  unsubNcrc = onSnapshot(
    collection(db, "compliance_records"),
    (snap) => {
      RECORDS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      RECORDS.sort((a, b) => {
        const ad = a.createdAt || a.importedAt || "";
        const bd = b.createdAt || b.importedAt || "";
        if (ad && bd && ad !== bd) return ad < bd ? 1 : -1;
        const ai = a.importSeq ?? 0, bi = b.importSeq ?? 0;
        if (ai !== bi) return ai - bi;
        return String(a.id).localeCompare(String(b.id));
      });
      renderAll();
    },
    (err) => {
      console.error("ncrc snapshot", err);
      // A permission error permanently kills the listener, so drop the handle
      // and let the next sign-in create a fresh one.
      stopNcrcSync();
    }
  );
}

function stopNcrcSync() {
  if (unsubNcrc) { try { unsubNcrc(); } catch (e) {} unsubNcrc = null; }
  RECORDS = [];
  renderAll();
}

/* Only listen while a user is signed in. Subscribing before sign-in used to
   fail with "Missing or insufficient permissions" and left this tab empty for
   the rest of the session, even after a successful login. */
onAuthStateChanged(auth, (user) => {
  if (user) startNcrcSync();
  else stopNcrcSync();
});
} catch (err) { console.error('[nc-risk-capa] failed to start', err); } }

/* ===== document-control.js (merged) ===== */
{ try {
/* Document Control module — Firestore + Firebase Storage backed.
   Documents live in Firestore collection "dc_documents".
   File attachments live in Firebase Storage under "dc_documents/{docId}/{timestamp}_{name}".
   No more localStorage / no base64 — quota errors are gone and data syncs across devices. */


const COL = "dc_documents";
const STORAGE_ROOT = "dc_documents";
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const todayISO = () => new Date().toISOString().slice(0,10);
const uid = () => "d_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);

// Per-document max attachment size (Firebase Storage handles big files fine; keep a sane cap).
const MAX_FILE_MB = 50;

let DOCS = [];
let editingId = null;
let currentUser = null;
let unsubscribe = null;

// Attachments staged in the modal. Items can be:
//   { kind:"existing", name, type, size, path, url, addedAt }
//   { kind:"new", name, type, size, file (File object), addedAt }
let pendingFiles = [];
// Storage paths to delete on save (when user removes an existing attachment).
let toDeletePaths = [];

const FILE_ICON = (name="", type="") => {
  const n = name.toLowerCase();
  if (type.includes("pdf")  || n.endsWith(".pdf"))  return "📕";
  if (type.includes("word") || /\.(docx?|rtf)$/.test(n)) return "📘";
  if (type.includes("sheet")|| type.includes("excel") || /\.(xlsx?|csv)$/.test(n)) return "📗";
  if (/\.(msg|eml)$/.test(n) || type.includes("rfc822")) return "📧";
  if (type.startsWith("image/")) return "🖼️";
  return "📎";
};

/* ---------- Auth gate ---------- */
onAuthStateChanged(auth, (user)=>{
  currentUser = user || null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!user) { DOCS = []; renderAll(); return; }
  subscribe();
});

function subscribe(){
  try {
    const q = query(collection(db, COL), orderBy("updatedAt","desc"));
    unsubscribe = onSnapshot(q, (snap)=>{
      DOCS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err)=>{
      console.error("dc_documents subscribe error", err);
    });
  } catch (e) {
    console.error("subscribe failed", e);
  }
}

/* ---------- File staging ---------- */
async function handleFileInputChange(e){
  const files = Array.from(e.target.files||[]);
  for (const f of files){
    if (f.size > MAX_FILE_MB*1024*1024){
      alert(`"${f.name}" is larger than ${MAX_FILE_MB} MB and was skipped.`);
      continue;
    }
    pendingFiles.push({
      kind:"new",
      name: f.name,
      type: f.type || "",
      size: f.size,
      file: f,
      addedAt: new Date().toISOString(),
    });
  }
  e.target.value = "";
  renderPendingFiles();
}

function renderPendingFiles(){
  const box = document.getElementById("dcFileList");
  if (!box) return;
  if (!pendingFiles.length){
    box.innerHTML = `<span style="color:#6b7280;font-size:12px;">No files attached yet.</span>`;
    return;
  }
  box.innerHTML = pendingFiles.map((f,i)=>`
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;background:#f8fafc;border:1px solid #e3e8ef;border-radius:6px;padding:4px 8px;">
      <span>${FILE_ICON(f.name,f.type)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
      <span style="color:#6b7280;">${(f.size/1024).toFixed(1)} KB</span>
      <span style="color:${f.kind==="new"?"#059669":"#6b7280"};font-size:11px;">${f.kind==="new"?"new":"saved"}</span>
      <button type="button" class="btn sm danger" data-dc-rmfile="${i}">×</button>
    </div>`).join("");
}

/* ---------- KPIs ---------- */
function renderKpis(){
  const total = DOCS.length;
  const approved = DOCS.filter(d=>d.status==="Approved").length;
  const review   = DOCS.filter(d=>d.status==="Under Review").length;
  const obsolete = DOCS.filter(d=>d.status==="Obsolete").length;
  const today = new Date(); today.setHours(0,0,0,0);
  const in30 = new Date(today); in30.setDate(in30.getDate()+30);
  let due=0, overdue=0;
  DOCS.forEach(d=>{
    if (!d.reviewDate || d.status==="Obsolete") return;
    const rd = new Date(d.reviewDate);
    if (isNaN(rd)) return;
    if (rd < today) overdue++;
    else if (rd <= in30) due++;
  });
  set("dcKpiTotal", total); set("dcKpiApproved", approved);
  set("dcKpiReview", review); set("dcKpiObsolete", obsolete);
  set("dcKpiDue", due); set("dcKpiOverdue", overdue);
}
function set(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }

/* ---------- Filters ---------- */
function getFilters(){
  return {
    q: (document.getElementById("dcSearch")?.value||"").trim().toLowerCase(),
    dept: document.getElementById("dcFilterDept")?.value||"",
    type: document.getElementById("dcFilterType")?.value||"",
    status: document.getElementById("dcFilterStatus")?.value||"",
    sort: document.getElementById("dcSort")?.value||"review",
  };
}
function refreshDeptOptions(){
  const sel = document.getElementById("dcFilterDept");
  if (!sel) return;
  const cur = sel.value;
  const depts = [...new Set(DOCS.map(d=>d.department).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Department Name</option>` +
    depts.map(d=>`<option ${d===cur?"selected":""}>${esc(d)}</option>`).join("");
}

/* ---------- Table ---------- */
function renderTable(){
  refreshDeptOptions();
  const f = getFilters();
  let rows = DOCS.filter(d=>{
    if (f.q && !(`${d.docId} ${d.name}`.toLowerCase().includes(f.q))) return false;
    if (f.dept && d.department!==f.dept) return false;
    if (f.type && d.type!==f.type) return false;
    if (f.status && d.status!==f.status) return false;
    return true;
  });
  rows.sort((a,b)=>{
    switch(f.sort){
      case "name": return (a.name||"").localeCompare(b.name||"");
      case "id":   return (a.docId||"").localeCompare(b.docId||"");
      case "updated": return (b.updatedAt||"").localeCompare(a.updatedAt||"");
      case "review":
      default:
        return (a.reviewDate||"9999").localeCompare(b.reviewDate||"9999");
    }
  });
  const tbody = document.querySelector("#dcTable tbody");
  if (!tbody) return;
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:#6b7280;padding:24px">${currentUser?"No documents match the filters.":"Sign in to view documents."}</td></tr>`;
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const in30 = new Date(today); in30.setDate(in30.getDate()+30);
  tbody.innerHTML = rows.map(d=>{
    let cls="";
    if (d.reviewDate && d.status!=="Obsolete"){
      const rd = new Date(d.reviewDate);
      if (!isNaN(rd)){
        if (rd<today) cls="row-overdue";
        else if (rd<=in30) cls="row-due";
      }
    }
    const statusClass = ({"Draft":"draft","Approved":"approved","Under Review":"review","Obsolete":"obsolete"})[d.status]||"draft";
    const openBtn = d.link
      ? `<a class="link-open" href="${esc(d.link)}" target="_blank" rel="noopener">Open</a>`
      : `<span class="link-open disabled">—</span>`;
    const atts = d.attachments||[];
    const filesCell = atts.length
      ? `<button class="btn sm" data-dc-files="${d.id}" title="View ${atts.length} file(s)">${FILE_ICON(atts[0].name,atts[0].type)} ${atts.length}</button>`
      : `<span style="color:#9ca3af;">—</span>`;
    return `<tr class="${cls}">
      <td>${esc(d.docId)}</td>
      <td>${esc(d.name)}</td>
      <td>${esc(d.department||"")}</td>
      <td>${esc(d.type||"")}</td>
      <td>${esc(d.version||"")}</td>
      <td>${esc(d.owner||"")}</td>
      <td><span class="pill ${statusClass}">${esc(d.status||"Draft")}</span></td>
      <td>${esc(d.effectiveDate||"")}</td>
      <td>${esc(d.reviewDate||"")}</td>
      <td>${esc((d.updatedAt||"").slice(0,10))}</td>
      <td>${openBtn}</td>
      <td>${filesCell}</td>
      <td>
        <button class="btn sm" data-dc-edit="${d.id}">Edit</button>
        <button class="btn sm" data-dc-history="${d.id}">History</button>
        <button class="btn sm danger" data-dc-del="${d.id}">Del</button>
      </td>
    </tr>`;
  }).join("");
}

function renderAll(){ renderKpis(); renderTable(); }

/* ---------- Modal: Add / Edit ---------- */
function openModal(docData){
  if (!currentUser){ alert("Please sign in first."); return; }
  editingId = docData ? docData.id : null;
  const form = document.getElementById("dcForm");
  form.reset();
  document.getElementById("dcModalTitle").textContent = docData ? "Edit Document" : "Add Document";
  document.getElementById("dcSaveBtn").textContent = docData ? "Save Changes" : "Create Document";
  toDeletePaths = [];
  pendingFiles = (docData && Array.isArray(docData.attachments))
    ? docData.attachments.map(f => ({ kind:"existing", ...f }))
    : [];
  if (docData){
    Object.entries(docData).forEach(([k,v])=>{
      const el = form.elements[k];
      if (el && v!=null && typeof v !== "object") el.value = v;
    });
  } else {
    form.elements["version"].value = "1.0";
    form.elements["status"].value = "Draft";
  }
  renderPendingFiles();
  document.getElementById("dcModal").classList.add("open");
}
function closeModal(){
  document.getElementById("dcModal").classList.remove("open");
  editingId = null;
  pendingFiles = [];
  toDeletePaths = [];
}

function bumpVersion(v){
  const m = String(v||"1.0").match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return "1.1";
  const major = parseInt(m[1]||"1",10);
  const minor = parseInt(m[2]||"0",10) + 1;
  return `${major}.${minor}`;
}

async function uploadNewFiles(docId){
  const out = [];
  for (const f of pendingFiles){
    if (f.kind === "existing"){
      const { kind, ...rest } = f;
      out.push(rest);
      continue;
    }
    const stamp = Date.now() + "_" + Math.random().toString(36).slice(2,6);
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `${STORAGE_ROOT}/${docId}/${stamp}_${safe}`;
    const r = ref(storage, path);
    const snap = await uploadBytes(r, f.file, { contentType: f.type || "application/octet-stream" });
    const url = await getDownloadURL(snap.ref);
    out.push({
      name: f.name, type: f.type, size: f.size,
      path, url, addedAt: new Date().toISOString(),
    });
  }
  return out;
}

async function deleteRemovedFiles(){
  for (const p of toDeletePaths){
    if (!p) continue;
    try { await deleteObject(ref(storage, p)); } catch(e){ console.warn("delete file failed", p, e); }
  }
  toDeletePaths = [];
}

async function handleSubmit(e){
  e.preventDefault();
  if (!currentUser){ alert("Please sign in first."); return; }
  const btn = document.getElementById("dcSaveBtn");
  const oldLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const now = new Date().toISOString();
    const docId = editingId || uid();

    // Upload any new files first (under final docId)
    const attachments = await uploadNewFiles(docId);
    await deleteRemovedFiles();

    if (editingId){
      const ref0 = doc(db, COL, editingId);
      const cur = await getDoc(ref0);
      const prev = cur.exists() ? cur.data() : {};
      const history = Array.isArray(prev.history) ? prev.history.slice() : [];
      history.push({
        version: prev.version || "",
        status: prev.status || "",
        updatedAt: prev.updatedAt || "",
        changeDescription: prev.changeDescription || "",
        remarks: prev.remarks || "",
        preparedBy: prev.preparedBy || "",
        reviewedBy: prev.reviewedBy || "",
        approvedBy: prev.approvedBy || "",
        attachmentCount: (prev.attachments||[]).length,
      });
      const versionChanged = data.version && data.version !== prev.version;
      const payload = {
        ...prev,
        ...data,
        version: versionChanged ? data.version : bumpVersion(prev.version),
        attachments,
        history,
        updatedAt: now,
        updatedBy: currentUser.email || currentUser.uid,
      };
      await setDoc(ref0, payload);
    } else {
      const payload = {
        ...data,
        attachments,
        history: [],
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.email || currentUser.uid,
        updatedBy: currentUser.email || currentUser.uid,
      };
      await setDoc(doc(db, COL, docId), payload);
    }
    closeModal();
  } catch (err) {
    console.error(err);
    alert("Could not save document.\n\n" + (err?.message || err));
  } finally {
    btn.disabled = false; btn.textContent = oldLabel;
  }
}

/* ---------- Files modal ---------- */
function openFiles(id){
  const d = DOCS.find(x=>x.id===id);
  if (!d) return;
  const atts = d.attachments||[];
  const body = document.getElementById("dcHistoryBody");
  body.innerHTML = `
    <p style="margin:0 0 10px;color:#374151;"><b>${esc(d.docId)}</b> — ${esc(d.name)} <span style="color:#6b7280;">(${atts.length} file${atts.length===1?"":"s"})</span></p>
    ${atts.length ? atts.map((f,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e3e8ef;border-radius:6px;margin-bottom:6px;">
        <span style="font-size:18px;">${FILE_ICON(f.name,f.type)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</div>
          <div style="font-size:11px;color:#6b7280;">${(f.size/1024).toFixed(1)} KB${f.addedAt?` · added ${esc(f.addedAt.slice(0,10))}`:""}</div>
        </div>
        <button type="button" class="btn sm" data-dc-viewfile="${i}" data-dc-viewdoc="${esc(id)}">View</button>
        <a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener" download="${esc(f.name)}">Download</a>
      </div>`).join("") : `<p style="color:#6b7280;">No attachments.</p>`}
  `;
  document.getElementById("dcHistoryTitle").textContent = "Attached Files";
  document.getElementById("dcHistoryModal").classList.add("open");
}

/* ---------- File viewer ---------- */
function canViewInline(name="", type=""){
  const n = name.toLowerCase();
  if (type.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.includes("text/")) return "text";
  if (n.endsWith(".csv") || n.endsWith(".txt")) return "text";
  if (n.endsWith(".eml") || n.endsWith(".msg")) return "text";
  return "no";
}

async function viewFile(docId, fileIndex){
  const d = DOCS.find(x=>x.id===docId);
  if (!d) return;
  const f = (d.attachments||[])[fileIndex];
  if (!f) return;
  const kind = canViewInline(f.name, f.type);
  const title = document.getElementById("dcViewerTitle");
  const body = document.getElementById("dcViewerBody");
  const dl = document.getElementById("dcViewerDownload");
  title.textContent = f.name;
  dl.href = f.url;
  dl.target = "_blank";
  dl.download = f.name;
  body.innerHTML = `<p style="color:#6b7280;">Loading preview…</p>`;
  document.getElementById("dcViewerModal").classList.add("open");

  if (kind === "pdf"){
    body.innerHTML = `<iframe src="${esc(f.url)}" style="width:100%;height:70vh;border:1px solid #e3e8ef;border-radius:6px;background:#fff;" title="${esc(f.name)}"></iframe>`;
  } else if (kind === "image"){
    body.innerHTML = `<img src="${esc(f.url)}" style="max-width:100%;max-height:70vh;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);" alt="${esc(f.name)}" />`;
  } else if (kind === "text"){
    try {
      const txt = await (await fetch(f.url)).text();
      body.innerHTML = `<pre style="background:#fff;border:1px solid #e3e8ef;border-radius:6px;padding:16px;overflow:auto;max-height:70vh;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${esc(txt)}</pre>`;
    } catch(e){
      body.innerHTML = `<p style="color:#b91c1c;">Failed to load preview. Use Download instead.</p>`;
    }
  } else {
    body.innerHTML = `
      <div style="text-align:center; color:#6b7280;">
        <div style="font-size:48px; margin-bottom:12px;">${FILE_ICON(f.name,f.type)}</div>
        <p style="margin:0 0 8px; font-weight:600;">${esc(f.name)}</p>
        <p style="margin:0; font-size:13px;">Preview is not available for this file type.</p>
        <p style="margin:8px 0 0; font-size:12px;">Please download the file to view it.</p>
      </div>`;
  }
}

function closeViewer(){
  document.getElementById("dcViewerModal").classList.remove("open");
  document.getElementById("dcViewerBody").innerHTML = `<p style="color:#6b7280;">Loading preview…</p>`;
}

/* ---------- History modal ---------- */
function openHistory(id){
  const d = DOCS.find(x=>x.id===id);
  if (!d) return;
  const body = document.getElementById("dcHistoryBody");
  const rows = (d.history||[]).slice().reverse();
  const current = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f8fafc;">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e3e8ef;">Version</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e3e8ef;">Status</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e3e8ef;">Updated</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e3e8ef;">Change Description</th>
      </tr></thead>
      <tbody>
        <tr style="background:#fffbeb;">
          <td style="padding:8px;"><b>${esc(d.version)}</b> (current)</td>
          <td style="padding:8px;">${esc(d.status||"")}</td>
          <td style="padding:8px;">${esc((d.updatedAt||"").slice(0,10))}</td>
          <td style="padding:8px;">${esc(d.changeDescription||"")}</td>
        </tr>
        ${rows.map(h=>`
          <tr>
            <td style="padding:8px;border-top:1px solid #eef1f5;">${esc(h.version||"")}</td>
            <td style="padding:8px;border-top:1px solid #eef1f5;">${esc(h.status||"")}</td>
            <td style="padding:8px;border-top:1px solid #eef1f5;">${esc((h.updatedAt||"").slice(0,10))}</td>
            <td style="padding:8px;border-top:1px solid #eef1f5;">${esc(h.changeDescription||"")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  body.innerHTML = `<p style="margin:0 0 10px;color:#374151;"><b>${esc(d.docId)}</b> — ${esc(d.name)}</p>` + current;
  document.getElementById("dcHistoryTitle").textContent = "Version History";
  document.getElementById("dcHistoryModal").classList.add("open");
}

/* ---------- Delete document ---------- */
async function deleteDocument(id){
  const d = DOCS.find(x=>x.id===id);
  if (!d) return;
  if (!confirm(`Delete document "${d.docId} — ${d.name}" and all its attachments?`)) return;
  try {
    for (const f of (d.attachments||[])){
      if (f.path){
        try { await deleteObject(ref(storage, f.path)); }
        catch(e){ console.warn("file delete failed", f.path, e); }
      }
    }
    await deleteDoc(doc(db, COL, id));
  } catch(err){
    console.error(err);
    alert("Could not delete document.\n\n"+(err?.message||err));
  }
}

/* ---------- Wire up ---------- */
function init(){
  if (!document.getElementById("documentControl")) return;
  document.getElementById("dcBtnAdd")?.addEventListener("click", ()=>openModal(null));
  document.getElementById("dcCancel")?.addEventListener("click", closeModal);
  document.getElementById("dcForm")?.addEventListener("submit", handleSubmit);
  document.getElementById("dcFileInput")?.addEventListener("change", handleFileInputChange);
  document.getElementById("dcFileList")?.addEventListener("click", (e)=>{
    const b = e.target.closest("button[data-dc-rmfile]");
    if (!b) return;
    const idx = parseInt(b.getAttribute("data-dc-rmfile"),10);
    const removed = pendingFiles.splice(idx, 1)[0];
    if (removed && removed.kind === "existing" && removed.path){
      toDeletePaths.push(removed.path);
    }
    renderPendingFiles();
  });
  document.getElementById("dcHistoryClose")?.addEventListener("click", ()=>{
    document.getElementById("dcHistoryModal").classList.remove("open");
  });
  document.getElementById("dcViewerClose")?.addEventListener("click", closeViewer);
  document.getElementById("dcViewerModal")?.addEventListener("click", (e)=>{
    if (e.target === document.getElementById("dcViewerModal")) closeViewer();
  });
  ["dcSearch","dcFilterDept","dcFilterType","dcFilterStatus","dcSort"].forEach(id=>{
    const el = document.getElementById(id);
    el?.addEventListener("input", renderTable);
    el?.addEventListener("change", renderTable);
  });
  document.querySelector("#dcTable")?.addEventListener("click", (e)=>{
    const t = e.target.closest("button, a");
    if (!t || t.tagName==="A") return;
    const editId = t.getAttribute("data-dc-edit");
    const delId  = t.getAttribute("data-dc-del");
    const hisId  = t.getAttribute("data-dc-history");
    const filesId= t.getAttribute("data-dc-files");
    if (editId){ const d=DOCS.find(x=>x.id===editId); if(d) openModal(d); }
    else if (delId){ deleteDocument(delId); }
    else if (hisId){ openHistory(hisId); }
    else if (filesId){ openFiles(filesId); }
  });
  // Files modal: View buttons (delegated on the history modal body)
  document.getElementById("dcHistoryBody")?.addEventListener("click", (e)=>{
    const b = e.target.closest("button[data-dc-viewfile]");
    if (!b) return;
    const viewDoc = b.getAttribute("data-dc-viewdoc");
    const viewIdx = b.getAttribute("data-dc-viewfile");
    if (viewDoc && viewIdx !== null) viewFile(viewDoc, parseInt(viewIdx,10));
  });
  // Close modals when clicking backdrop
  document.querySelectorAll(".dc-modal").forEach(m=>{
    m.addEventListener("click", (e)=>{ if (e.target===m) m.classList.remove("open"); });
  });
  // Re-render whenever the tab becomes active
  document.querySelectorAll('.tab[data-tab="documentControl"]').forEach(btn=>{
    btn.addEventListener("click", ()=>setTimeout(renderAll, 0));
  });
  renderAll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

} catch (err) { console.error('[document-control] failed to start', err); } }

/* ===== process-inventory.js (merged) ===== */
{ try {
/* Process Inventory — Master inventory of company processes / procedures.
   Firestore collection: "process_inventory"
   Document shape:
     {
       documentTitle, documentType, documentCode,
       issueNo, issueDate (YYYY-MM-DD), department,
       companies: [ "Company A", "Company B", ... ],
       createdBy, createdAt, updatedBy, updatedAt
     }
   Uniqueness (grouping) key: title | type | code | issueNo | issueDate | department
*/

(function () {
  "use strict";

  const PI_COLLECTION = "process_inventory";
  let piRecords = [];
  let unsubPi = null;
  let piPage = 1;
  const PI_PAGE_SIZE = 25;
  let piSort = { key: "documentTitle", dir: 1 };
  let piEditingId = null;
  let piEditingCompanies = [];
  let piSyncState = "loading";
  let piSyncMessage = "Loading processes…";
  let piSyncTimer = null;
  const piSelected = new Set();

  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const currentEmail = () => (window.__session && window.__session.email) || "(unknown)";
  const isAdminNow  = () =>
    !!(window.__session && window.__session.isAdmin) || ADMIN_EMAILS.includes(currentEmail());

  function toastMsg(msg) {
    const el = $("toast");
    if (!el) { console.log(msg); return; }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function friendlyError(err) {
    const code = err?.code || "";
    const msg = err?.message || String(err || "Unknown error");
    if (code === "permission-denied" || /permission|insufficient/i.test(msg)) {
      return "Missing or insufficient permissions. Publish the updated Firestore rules, then refresh this page.";
    }
    if (code === "unavailable" || /network|offline|unavailable/i.test(msg)) {
      return "Cannot connect right now. Check your internet connection and refresh.";
    }
    return msg;
  }

  function matchKey(r) {
    return [
      norm(r.documentTitle),
      norm(r.documentType),
      norm(r.documentCode),
      norm(r.issueNo),
      norm(r.issueDate),
      norm(r.department)
    ].join("|");
  }
  function findByKey(k) { return piRecords.find(r => matchKey(r) === k); }

  /* ---------- Date helpers (accept Excel dates or strings) ---------- */
  function toISODate(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === "number") {
      // Excel serial date
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isNaN(d) ? "" : d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    // Try YYYY-MM-DD directly
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Try DD/MM/YYYY or MM/DD/YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [_, a, b, y] = m;
      if (y.length === 2) y = "20" + y;
      // Assume DD/MM/YYYY (common outside US)
      const d = new Date(`${y}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    return isNaN(d) ? s : d.toISOString().slice(0, 10);
  }

  /* ---------- Filters + Search ---------- */
  function getFiltered() {
    const q      = norm($("piSearch")?.value);
    const fCo    = norm($("piFilterCompany")?.value);
    const fDept  = norm($("piFilterDept")?.value);
    const fType  = norm($("piFilterType")?.value);
    const fIssue = norm($("piFilterIssue")?.value);
    const fFrom  = $("piFilterFrom")?.value || "";
    const fTo    = $("piFilterTo")?.value || "";

    return piRecords.filter(r => {
      if (fCo    && !(r.companies || []).some(c => norm(c) === fCo)) return false;
      if (fDept  && norm(r.department)   !== fDept) return false;
      if (fType  && norm(r.documentType) !== fType) return false;
      if (fIssue && !norm(r.issueNo).includes(fIssue)) return false;
      if (fFrom  && (r.issueDate || "") < fFrom) return false;
      if (fTo    && (r.issueDate || "") > fTo)   return false;
      if (!q) return true;
      const hay = [
        r.documentTitle, r.documentType, r.documentCode,
        r.issueNo, r.issueDate, r.department,
        ...(r.companies || [])
      ].map(norm).join(" | ");
      return hay.includes(q);
    });
  }

  function sortRows(rows) {
    const { key, dir } = piSort;
    return [...rows].sort((a, b) => {
      const va = String(a[key] || "").toLowerCase();
      const vb = String(b[key] || "").toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
  }

  /* ---------- Render ---------- */
  function refreshFilterOptions() {
    const companies = new Set(), depts = new Set(), types = new Set();
    piRecords.forEach(r => {
      (r.companies || []).forEach(c => c && companies.add(c));
      if (r.department)   depts.add(r.department);
      if (r.documentType) types.add(r.documentType);
    });
    fillSelect("piFilterCompany", "Company Name",  [...companies].sort());
    fillSelect("piFilterDept",    "Department Name",[...depts].sort());
    fillSelect("piFilterType",    "Document Type",      [...types].sort());
    fillDatalist("piDeptList",    [...depts].sort());
    fillDatalist("piTypeList",    [...types].sort());
    fillDatalist("piCompanyDatalist", [...companies].sort());
  }
  function fillSelect(id, placeholder, values) {
    const el = $(id); if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (values.includes(cur)) el.value = cur;
  }
  function fillDatalist(id, values) {
    const el = $(id); if (!el) return;
    el.innerHTML = values.map(v => `<option value="${esc(v)}"></option>`).join("");
  }

  function updateBulkUI(totalFiltered) {
    const admin = isAdminNow();
    const count = piSelected.size;
    const bulkBtn = $("piBulkDelBtn");
    if (bulkBtn) {
      bulkBtn.style.display = admin && count > 0 ? "" : "none";
      const c = $("piBulkDelCount"); if (c) c.textContent = String(count);
    }
    const selAllFiltered = $("piSelectAllFiltered");
    if (selAllFiltered) {
      const showLink = admin && count > 0 && count < totalFiltered;
      selAllFiltered.style.display = showLink ? "" : "none";
      const cnt = $("piSelectAllFilteredCount");
      if (cnt) cnt.textContent = String(totalFiltered);
    }
    const master = $("piSelectAll");
    if (master) {
      const pageIds = Array.from(document.querySelectorAll('#piTableBody input[data-pi-check]'))
        .map(i => i.getAttribute("data-pi-check"));
      const selectedOnPage = pageIds.filter(id => piSelected.has(id)).length;
      master.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
      master.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
      master.disabled = !admin || pageIds.length === 0;
    }
  }

  function renderTable() {
    const tbody = $("piTableBody"); if (!tbody) return;
    refreshFilterOptions();

    if (piSyncState === "error") {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#b91c1c;padding:24px;white-space:normal;">${esc(piSyncMessage)}</td></tr>`;
      const pager = $("piPager");
      if (pager) pager.innerHTML = "";
      updateBulkUI(0);
      return;
    }

    if (piSyncState === "loading") {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#6b7280;padding:24px;">${esc(piSyncMessage)}</td></tr>`;
      const pager = $("piPager");
      if (pager) pager.innerHTML = "";
      updateBulkUI(0);
      return;
    }

    const rows = sortRows(getFiltered());
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PI_PAGE_SIZE));
    if (piPage > pages) piPage = pages;
    const start = (piPage - 1) * PI_PAGE_SIZE;
    const pageRows = rows.slice(start, start + PI_PAGE_SIZE);

    // Prune selections that are no longer present
    const existingIds = new Set(piRecords.map(r => r.id));
    Array.from(piSelected).forEach(id => { if (!existingIds.has(id)) piSelected.delete(id); });

    const admin = isAdminNow();

    if (!pageRows.length) {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#6b7280;padding:24px">No processes found.</td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(r => {
        const companies = r.companies || [];
        const shown = companies.slice(0, 4);
        const more  = companies.length - shown.length;
        const coCells = [0,1,2,3].map(i =>
          `<td>${shown[i] ? esc(shown[i]) : ""}</td>`).join("");
        const moreBtn = more > 0
          ? `<button class="btn sm" data-pi-more="${r.id}" style="margin-left:6px;">+${more} More</button>`
          : "";
        const checked = piSelected.has(r.id) ? "checked" : "";
        const chkCell = admin
          ? `<td><input type="checkbox" data-pi-check="${r.id}" ${checked} /></td>`
          : `<td></td>`;
        return `<tr${piSelected.has(r.id) ? ' style="background:#fef3c7;"' : ''}>
          ${chkCell}
          <td>${esc(r.documentTitle)}</td>
          <td>${esc(r.documentType)}</td>
          <td>${esc(r.documentCode)}</td>
          <td>${esc(r.issueNo)}</td>
          <td>${esc(r.issueDate)}</td>
          <td>${esc(r.expiryDate)}</td>
          ${coCells}
          <td>${esc(r.department)} ${moreBtn}</td>
          <td>${esc(r.subDepartment)}</td>
          <td style="white-space:nowrap;">
            <button class="btn sm" data-pi-edit="${r.id}">Edit</button>
            ${admin ? `<button class="btn sm danger" data-pi-del="${r.id}">Del</button>` : ""}
          </td>
        </tr>`;
      }).join("");
    }
    updateBulkUI(total);

    const pager = $("piPager");
    if (pager) {
      pager.innerHTML = `
        <span style="color:#6b7280;font-size:12px;">Showing ${total ? start + 1 : 0}–${Math.min(start + PI_PAGE_SIZE, total)} of ${total}</span>
        <button class="btn sm" id="piPrev" ${piPage <= 1 ? "disabled" : ""}>Prev</button>
        <span style="font-size:12px;">Page ${piPage} / ${pages}</span>
        <button class="btn sm" id="piNext" ${piPage >= pages ? "disabled" : ""}>Next</button>`;
      $("piPrev")?.addEventListener("click", () => { piPage--; renderTable(); });
      $("piNext")?.addEventListener("click", () => { piPage++; renderTable(); });
    }
  }

  /* ---------- Firestore sync ---------- */
  function startSync() {
    if (unsubPi) return;
    piSyncState = "loading";
    piSyncMessage = "Loading processes…";
    renderTable();
    clearTimeout(piSyncTimer);
    piSyncTimer = setTimeout(() => {
      if (piSyncState === "loading") {
        piSyncMessage = "Still loading processes. If this does not change, refresh the page or check the Firestore rules.";
        renderTable();
      }
    }, 8000);
    const colRef = collection(db, PI_COLLECTION);
    unsubPi = onSnapshot(colRef, snap => {
      clearTimeout(piSyncTimer);
      piSyncState = "ready";
      piSyncMessage = "";
      piRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      window.__piRecords = piRecords;
      window.dispatchEvent(new CustomEvent("pi:records", { detail: piRecords }));
      renderTable();
    }, err => {
      console.error("[process-inventory] sync error", err);
      clearTimeout(piSyncTimer);
      piSyncState = "error";
      piSyncMessage = "Process Inventory could not load: " + friendlyError(err);
      renderTable();
      toastMsg(piSyncMessage);
    });
  }
  function stopSync() {
    clearTimeout(piSyncTimer);
    if (unsubPi) { unsubPi(); unsubPi = null; }
    piSyncState = "loading";
    piSyncMessage = "Sign in to load processes.";
  }

  /* ---------- Add / Edit modal ---------- */
  function openModal(record) {
    piEditingId = record ? record.id : null;
    piEditingCompanies = record ? [...(record.companies || [])] : [];
    $("piModalTitle").textContent = record ? "Edit Process" : "Add Process";
    const f = $("piForm");
    f.documentTitle.value = record?.documentTitle || "";
    f.documentType.value  = record?.documentType  || "";
    f.documentCode.value  = record?.documentCode  || "";
    f.issueNo.value       = record?.issueNo       || "";
    f.issueDate.value     = record?.issueDate     || "";
    f.department.value    = record?.department    || "";
    $("piNewCompany").value = "";
    renderCompanyEditor();
    $("piModal").style.display = "flex";
  }
  function closeModal() {
    $("piModal").style.display = "none";
    piEditingId = null; piEditingCompanies = [];
  }
  function renderCompanyEditor() {
    const el = $("piCompanyList"); if (!el) return;
    if (!piEditingCompanies.length) {
      el.innerHTML = `<div style="color:#9ca3af;font-size:12px;padding:6px 0;">No companies yet.</div>`;
      return;
    }
    el.innerHTML = piEditingCompanies.map((c, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
        <input data-pi-co-idx="${i}" value="${esc(c)}" style="flex:1;padding:4px 6px;border:1px solid #cfd6df;border-radius:4px;font-size:13px;" />
        <button type="button" class="btn sm danger" data-pi-co-rm="${i}">✕</button>
      </div>`).join("");
    el.querySelectorAll("input[data-pi-co-idx]").forEach(inp => {
      inp.addEventListener("input", e => {
        piEditingCompanies[+e.target.dataset.piCoIdx] = e.target.value;
      });
    });
    el.querySelectorAll("button[data-pi-co-rm]").forEach(btn => {
      btn.addEventListener("click", () => {
        piEditingCompanies.splice(+btn.dataset.piCoRm, 1);
        renderCompanyEditor();
      });
    });
  }

  async function saveModal(e) {
    e.preventDefault();
    const f = $("piForm");
    const rec = {
      documentTitle: f.documentTitle.value.trim(),
      documentType:  f.documentType.value.trim(),
      documentCode:  f.documentCode.value.trim(),
      issueNo:       f.issueNo.value.trim(),
      issueDate:     f.issueDate.value,
      department:    f.department.value.trim(),
      companies:     piEditingCompanies.map(c => c.trim()).filter(Boolean)
    };
    if (!rec.documentTitle || !rec.documentType || !rec.documentCode ||
        !rec.issueNo || !rec.issueDate || !rec.department) {
      toastMsg("All fields are required"); return;
    }
    // Dedupe companies (case-insensitive)
    const seen = new Set();
    rec.companies = rec.companies.filter(c => {
      const k = norm(c); if (seen.has(k)) return false; seen.add(k); return true;
    });

    try {
      if (piEditingId) {
        await setDoc(doc(db, PI_COLLECTION, piEditingId), {
          ...rec,
          updatedBy: currentEmail(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        toastMsg("Process updated");
      } else {
        // Check if an existing process matches key
        const key = matchKey(rec);
        const existing = findByKey(key);
        if (existing) {
          const merged = new Set((existing.companies || []).map(norm));
          const addable = rec.companies.filter(c => !merged.has(norm(c)));
          if (!addable.length) {
            toastMsg("This company is already assigned to this process.");
            return;
          }
          await setDoc(doc(db, PI_COLLECTION, existing.id), {
            companies: [...(existing.companies || []), ...addable],
            updatedBy: currentEmail(),
            updatedAt: serverTimestamp()
          }, { merge: true });
          toastMsg(`Added ${addable.length} company(ies) to existing process`);
        } else {
          await addDoc(collection(db, PI_COLLECTION), {
            ...rec,
            createdBy: currentEmail(),
            createdAt: serverTimestamp(),
            updatedBy: currentEmail(),
            updatedAt: serverTimestamp()
          });
          toastMsg("Process created");
        }
      }
      closeModal();
    } catch (err) {
      console.error(err);
      toastMsg("Save failed: " + friendlyError(err));
    }
  }

  async function deleteRecord(id) {
    if (!isAdminNow()) { toastMsg("Only admins can delete processes"); return; }
    if (!confirm("Delete this process? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, PI_COLLECTION, id));
      toastMsg("Process deleted");
    } catch (err) {
      console.error(err); toastMsg("Delete failed: " + friendlyError(err));
    }
  }

  async function bulkDeleteSelected() {
    if (!isAdminNow()) { toastMsg("Only admins can delete processes"); return; }
    const ids = Array.from(piSelected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected process(es)? This cannot be undone.`)) return;
    const btn = $("piBulkDelBtn");
    if (btn) { btn.disabled = true; }
    try {
      // Firestore batch limit is 500
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db);
        ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, PI_COLLECTION, id)));
        await batch.commit();
      }
      piSelected.clear();
      toastMsg(`Deleted ${ids.length} process(es)`);
    } catch (err) {
      console.error(err); toastMsg("Bulk delete failed: " + friendlyError(err));
    } finally {
      if (btn) btn.disabled = false;
      renderTable();
    }
  }

  /* ---------- Companies popup ---------- */
  function openCompaniesPopup(id) {
    const r = piRecords.find(x => x.id === id); if (!r) return;
    $("piCompaniesFullTitle").textContent = r.documentTitle || "Companies";
    $("piCompaniesFullList").innerHTML =
      (r.companies || []).map(c => `<li>${esc(c)}</li>`).join("") ||
      `<li style="color:#9ca3af;">No companies.</li>`;
    $("piCompaniesModal").style.display = "flex";
  }

  /* ---------- Excel Import ---------- */
  async function importExcel(file) {
    if (typeof XLSX === "undefined") { toastMsg("Excel library not loaded"); return; }
    const btn = $("piImportBtn"); if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array", cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const summary = { total: rows.length, created: 0, updated: 0, dupCompanies: 0, errors: 0 };
      // Map by key across the batch (local + remote) so a fresh Excel with repeats groups correctly.
      const localMap = new Map(piRecords.map(r => [matchKey(r), { ...r, companies: [...(r.companies || [])] }]));

      for (const row of rows) {
        const rec = {
          documentTitle: String(row["Document Title"] || row["documentTitle"] || "").trim(),
          documentType:  String(row["Document Type"]  || row["documentType"]  || "").trim(),
          documentCode:  String(row["Document Code"]  || row["documentCode"]  || "").trim(),
          issueNo:       String(row["Issue No"]       || row["issueNo"]       || "").trim(),
          issueDate:     toISODate(row["Issue Date"]  ?? row["issueDate"]),
          expiryDate:    toISODate(row["Expiry Date"] ?? row["expiryDate"]),
          department:    String(row["Department"]     || row["department"]    || "").trim(),
          subDepartment: String(row["Sub-Department"] || row["Sub Department"] || row["subDepartment"] || "").trim(),
          company:       String(row["Company Name"]   || row["companyName"] || row["Company"] || "").trim()
        };
        if (!rec.documentTitle || !rec.documentCode || !rec.department) { summary.errors++; continue; }
        const key = matchKey(rec);
        const existing = localMap.get(key);
        if (existing) {
          // Fill in expiry/sub-department on existing record if it's missing them
          if (rec.expiryDate    && !existing.expiryDate)    { existing.expiryDate    = rec.expiryDate;    existing._dirty = true; }
          if (rec.subDepartment && !existing.subDepartment) { existing.subDepartment = rec.subDepartment; existing._dirty = true; }
          if (rec.company && !existing.companies.some(c => norm(c) === norm(rec.company))) {
            existing.companies.push(rec.company);
            existing._dirty = true;
          } else if (rec.company) {
            summary.dupCompanies++;
          }
        } else {
          localMap.set(key, {
            _new: true,
            documentTitle: rec.documentTitle, documentType: rec.documentType,
            documentCode: rec.documentCode, issueNo: rec.issueNo,
            issueDate: rec.issueDate, expiryDate: rec.expiryDate,
            department: rec.department, subDepartment: rec.subDepartment,
            companies: rec.company ? [rec.company] : []
          });
        }
      }


      // Write changes
      const email = currentEmail();
      for (const rec of localMap.values()) {
        if (rec._new) {
          await addDoc(collection(db, PI_COLLECTION), {
            documentTitle: rec.documentTitle, documentType: rec.documentType,
            documentCode: rec.documentCode, issueNo: rec.issueNo,
            issueDate: rec.issueDate, expiryDate: rec.expiryDate || "",
            department: rec.department, subDepartment: rec.subDepartment || "",
            companies: rec.companies,
            createdBy: email, createdAt: serverTimestamp(),
            updatedBy: email, updatedAt: serverTimestamp()
          });
          summary.created++;
        } else if (rec._dirty && rec.id) {
          const patch = { companies: rec.companies, updatedBy: email, updatedAt: serverTimestamp() };
          if (rec.expiryDate)    patch.expiryDate    = rec.expiryDate;
          if (rec.subDepartment) patch.subDepartment = rec.subDepartment;
          await setDoc(doc(db, PI_COLLECTION, rec.id), patch, { merge: true });
          summary.updated++;
        }

      }
      alert(
        `Import complete\n\n` +
        `Total rows:                 ${summary.total}\n` +
        `New processes created:      ${summary.created}\n` +
        `Existing processes updated: ${summary.updated}\n` +
        `Duplicate companies skipped:${summary.dupCompanies}\n` +
        `Errors (missing fields):    ${summary.errors}`
      );
    } catch (err) {
      console.error(err);
      alert("Import failed: " + friendlyError(err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Import Excel"; }
      const inp = $("piImportFile"); if (inp) inp.value = "";
    }
  }

  /* ---------- Excel Export (one row per company) ---------- */
  function exportExcel() {
    if (typeof XLSX === "undefined") { toastMsg("Excel library not loaded"); return; }
    const rows = [];
    getFiltered().forEach(r => {
      const cos = (r.companies && r.companies.length) ? r.companies : [""];
      cos.forEach(c => {
        rows.push({
          "Document Title":  r.documentTitle || "",
          "Document Type":   r.documentType  || "",
          "Document Code":   r.documentCode  || "",
          "Issue No":        r.issueNo       || "",
          "Issue Date":      r.issueDate     || "",
          "Expiry Date":     r.expiryDate    || "",
          "Company Name":    c || "",
          "Department":      r.department    || "",
          "Sub-Department":  r.subDepartment || ""
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Document Title","Document Type","Document Code","Issue No","Issue Date","Expiry Date","Company Name","Department","Sub-Department"]
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Process Inventory");
    XLSX.writeFile(wb, `process_inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  /* ---------- Wire-up ---------- */
  function wire() {
    if (wire._done) return; wire._done = true;

    // Tab / home tile handled by base app.js via [data-tab] / [data-go].
    // We just need our own buttons.
    ["piSearch","piFilterCompany","piFilterDept","piFilterType","piFilterIssue","piFilterFrom","piFilterTo"]
      .forEach(id => {
        const el = $(id); if (!el) return;
        el.addEventListener("input",  () => { piPage = 1; renderTable(); });
        el.addEventListener("change", () => { piPage = 1; renderTable(); });
      });

    $("piClearFilters")?.addEventListener("click", () => {
      ["piSearch","piFilterCompany","piFilterDept","piFilterType","piFilterIssue","piFilterFrom","piFilterTo"]
        .forEach(id => { const el = $(id); if (el) el.value = ""; });
      piPage = 1; renderTable();
    });

    $("piAddBtn")?.addEventListener("click", () => openModal(null));
    $("piCancelBtn")?.addEventListener("click", closeModal);
    $("piForm")?.addEventListener("submit", saveModal);

    $("piAddCompanyBtn")?.addEventListener("click", () => {
      const v = $("piNewCompany").value.trim();
      if (!v) return;
      if (piEditingCompanies.some(c => norm(c) === norm(v))) {
        toastMsg("This company is already assigned to this process.");
        return;
      }
      piEditingCompanies.push(v);
      $("piNewCompany").value = "";
      renderCompanyEditor();
    });
    $("piNewCompany")?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); $("piAddCompanyBtn").click(); }
    });

    $("piImportBtn")?.addEventListener("click", () => $("piImportFile").click());
    $("piImportFile")?.addEventListener("change", e => {
      const f = e.target.files?.[0]; if (f) importExcel(f);
    });
    $("piExportBtn")?.addEventListener("click", exportExcel);
    $("piBulkDelBtn")?.addEventListener("click", bulkDeleteSelected);

    $("piSelectAll")?.addEventListener("change", e => {
      const checked = e.target.checked;
      document.querySelectorAll('#piTableBody input[data-pi-check]').forEach(inp => {
        const id = inp.getAttribute("data-pi-check");
        if (checked) piSelected.add(id); else piSelected.delete(id);
      });
      renderTable();
    });

    $("piSelectAllFiltered")?.addEventListener("click", () => {
      sortRows(getFiltered()).forEach(r => piSelected.add(r.id));
      renderTable();
    });

    $("piCompaniesClose")?.addEventListener("click", () => {
      $("piCompaniesModal").style.display = "none";
    });

    // Table row actions (event delegation)
    $("piTableBody")?.addEventListener("click", e => {
      const chk = e.target.closest("input[data-pi-check]");
      if (chk) {
        const id = chk.getAttribute("data-pi-check");
        if (chk.checked) piSelected.add(id); else piSelected.delete(id);
        updateBulkUI(sortRows(getFiltered()).length);
        return;
      }
      const t = e.target.closest("button"); if (!t) return;
      const eid = t.dataset.piEdit, did = t.dataset.piDel, mid = t.dataset.piMore;
      if (eid) openModal(piRecords.find(r => r.id === eid));
      else if (did) deleteRecord(did);
      else if (mid) openCompaniesPopup(mid);
    });

    // Column sort
    document.querySelectorAll("#piTable thead th[data-pi-sort]").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const k = th.dataset.piSort;
        if (piSort.key === k) piSort.dir = -piSort.dir;
        else piSort = { key: k, dir: 1 };
        renderTable();
      });
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    wire();
    onAuthStateChanged(auth, user => {
      if (user) startSync(); else { stopSync(); piRecords = []; renderTable(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

} catch (err) { console.error('[process-inventory] failed to start', err); } }

/* ===== gap-analysis.js (merged) ===== */
{ try {
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

  let replace = false;
  if (rows.length > 0) {
    const choice = prompt(
      `There are already ${rows.length} row(s) in Gap Assessment.\n\n` +
      `Type "REPLACE" to delete existing rows and import ${mapped.length} new row(s).\n` +
      `Type "APPEND" to add ${mapped.length} row(s) to the existing data.\n` +
      `Leave blank or press Cancel to abort.`,
      "REPLACE"
    );
    if (!choice) return;
    const c = choice.trim().toUpperCase();
    if (c === "REPLACE") replace = true;
    else if (c === "APPEND") replace = false;
    else { toast("Import cancelled."); return; }
  } else {
    if (!confirm(`Import ${mapped.length} row(s) into Gap Assessment?`)) return;
  }

  try {
    if (replace && rows.length) {
      const existing = rows.slice();
      for (let i = 0; i < existing.length; i += 400) {
        const batch = writeBatch(db);
        existing.slice(i, i + 400).forEach(r => batch.delete(doc(db, COL, r.id)));
        await batch.commit();
      }
      editing.clear();
    }
    for (let i = 0; i < mapped.length; i += 400) {
      const batch = writeBatch(db);
      mapped.slice(i, i + 400).forEach(m => {
        const ref = doc(collection(db, COL));
        batch.set(ref, { ...m, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(replace
      ? `Replaced with ${mapped.length} row(s).`
      : `Imported ${mapped.length} row(s).`);
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

} catch (err) { console.error('[gap-analysis] failed to start', err); } }

/* ===== process-validation.js (merged) ===== */
{ try {
// process-validation.js — Process Validation Interviews module
// Firestore collection: "processValidation".
// Excel import expects ONLY these 5 columns (matched by header text):
//   Document Title | Document Type | Document Code | Process Owner | Company Name
// Remaining fields (Process Exists?, Evidence Exists?, Automated?, Status,
// Comments) are filled manually per row via the row's Edit / Save controls.


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
let rawRows = [];
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

function rowSignature(r) {
  const parts = IMPORT_FIELDS.map(f => String(r[f.key] ?? "").trim().toLowerCase());
  const key = parts.join("|");
  return parts.some(Boolean) ? key : `id:${r.id}`;
}

function rowTime(r) {
  const t = r.updatedAt || r.createdAt;
  if (typeof t?.seconds === "number") return t.seconds;
  if (typeof t?.toMillis === "function") return t.toMillis();
  return 0;
}

function dedupeRows(list) {
  const byKey = new Map();
  list.forEach(r => {
    const key = rowSignature(r);
    const prev = byKey.get(key);
    if (!prev || rowTime(r) >= rowTime(prev)) byKey.set(key, r);
  });
  return [...byKey.values()].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
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
  if (!currentUser) { rawRows = []; rows = []; render(); return; }
  unsubscribe = onSnapshot(collection(db, COL), snap => {
    rawRows = [];
    snap.forEach(d => rawRows.push({ id: d.id, ...d.data() }));
    rows = dedupeRows(rawRows);
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
  if (!rawRows.length) return;
  if (!confirm(`Delete all ${rawRows.length} stored row(s)? This cannot be undone.`)) return;
  try {
    for (let i = 0; i < rawRows.length; i += 400) {
      const batch = writeBatch(db);
      rawRows.slice(i, i + 400).forEach(r => batch.delete(doc(db, COL, r.id)));
      await batch.commit();
    }
    editing.clear();
    toast("Cleared.");
  } catch (e) { toast("Clear failed: " + e.message); }
}

async function removeDuplicates() {
  const keep = new Set(dedupeRows(rawRows).map(r => r.id));
  const duplicates = rawRows.filter(r => !keep.has(r.id));
  if (!duplicates.length) { toast("No duplicate rows found."); return; }
  if (!confirm(`Remove ${duplicates.length} duplicate stored row(s) and keep ${keep.size} unique row(s)?`)) return;
  try {
    for (let i = 0; i < duplicates.length; i += 400) {
      const batch = writeBatch(db);
      duplicates.slice(i, i + 400).forEach(r => batch.delete(doc(db, COL, r.id)));
      await batch.commit();
    }
    toast(`Removed ${duplicates.length} duplicate row(s).`);
  } catch (e) { toast("Duplicate cleanup failed: " + e.message); }
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
  if (!confirm(`Replace the current ${rawRows.length} stored row(s) with ${mapped.length} imported row(s)?`)) return;

  try {
    for (let i = 0; i < rawRows.length; i += 400) {
      const batch = writeBatch(db);
      rawRows.slice(i, i + 400).forEach(r => batch.delete(doc(db, COL, r.id)));
      await batch.commit();
    }
    for (let i = 0; i < mapped.length; i += 400) {
      const batch = writeBatch(db);
      mapped.slice(i, i + 400).forEach(m => {
        const ref = doc(collection(db, COL));
        batch.set(ref, { ...m, status: deriveStatus(m), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(`Replaced with ${mapped.length} row(s).`);
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
  $("#pvRemoveDuplicates")?.addEventListener("click", removeDuplicates);
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

} catch (err) { console.error('[process-validation] failed to start', err); } }

/* ===== process-validation-dashboard.js (merged) ===== */
{ try {
// process-validation-dashboard.js — Process Validation Dashboard
// Renders KPI cards, 100% stacked bar-chart table by Process Owner,
// and an Assurance Heat Map (Yes/No) view — matching the executive layout.


const COL = "processValidation";
let rows = [];
let unsub = null;

const yn = v => String(v || "").trim().toLowerCase();
const isYes = v => yn(v) === "yes";

/* ---------- Dedupe (same signature as process-validation.js) ---------- */
function rowSignature(r) {
  const parts = ["docTitle", "docType", "docCode", "processOwner", "companyName"]
    .map(k => String(r[k] ?? "").trim().toLowerCase());
  const key = parts.join("|");
  return parts.some(Boolean) ? key : `id:${r.id}`;
}
function rowTime(r) {
  const t = r.updatedAt || r.createdAt;
  if (typeof t?.seconds === "number") return t.seconds;
  if (typeof t?.toMillis === "function") return t.toMillis();
  return 0;
}
function dedupeRows(list) {
  const byKey = new Map();
  list.forEach(r => {
    const key = rowSignature(r);
    const prev = byKey.get(key);
    if (!prev || rowTime(r) >= rowTime(prev)) byKey.set(key, r);
  });
  return [...byKey.values()];
}

/* ---------- Helpers ---------- */
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

/* ---------- KPI cards ---------- */
function renderKpis() {
  const total = rows.length;
  const peY = rows.filter(r => isYes(r.processExists)).length;
  const evY = rows.filter(r => isYes(r.evidenceExists)).length;
  const auY = rows.filter(r => isYes(r.automated)).length;

  const pePct = pct(peY, total);
  const evPct = pct(evY, total);
  const auPct = pct(auY, total);

  const fmt = (n, p) => `${n.toLocaleString()} (${p}%)`;

  setText("gdPePct", pePct + "%");
  setText("gdPeYes", fmt(peY, pePct));
  setText("gdPeNo", fmt(total - peY, 100 - pePct));

  setText("gdEvPct", evPct + "%");
  setText("gdEvYes", fmt(evY, evPct));
  setText("gdEvNo", fmt(total - evY, 100 - evPct));

  setText("gdAuPct", auPct + "%");
  setText("gdAuYes", fmt(auY, auPct));
  setText("gdAuNo", fmt(total - auY, 100 - auPct));
}

/* ---------- Owner aggregation ---------- */
function ownerStats() {
  const map = {};
  rows.forEach(r => {
    const o = (r.processOwner || "Unassigned").trim() || "Unassigned";
    if (!map[o]) map[o] = { total: 0, pe: 0, ev: 0, au: 0 };
    const s = map[o];
    s.total++;
    if (isYes(r.processExists)) s.pe++;
    if (isYes(r.evidenceExists)) s.ev++;
    if (isYes(r.automated)) s.au++;
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, s]) => ({
      owner,
      total: s.total,
      pePct: pct(s.pe, s.total),
      evPct: pct(s.ev, s.total),
      auPct: pct(s.au, s.total),
    }));
}

/* ---------- 100% stacked bar rendering (HTML/CSS bars) ---------- */
function stackedBar(pctYes) {
  const yes = Math.max(0, Math.min(100, pctYes));
  const no = 100 - yes;
  const cell = (w, color, label) => w > 0
    ? `<div style="width:${w}%;background:${color};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:4px 3px;white-space:nowrap;">${label}%</div>`
    : "";
  return `<div style="display:flex;width:100%;border-radius:6px;overflow:hidden;height:30px;">
    ${cell(yes, "#16a34a", yes)}
    ${cell(no, "#dc2626", no)}
  </div>`;
}

function renderStackTable() {
  const body = document.getElementById("gdStackBody");
  if (!body) return;
  const stats = ownerStats();
  if (!stats.length) { body.innerHTML = `<tr><td colspan="4" style="padding:10px 8px;text-align:center;color:#6b7280;">No data</td></tr>`; return; }
  body.innerHTML = stats.map(s => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px 8px;font-weight:600;color:#0f172a;font-size:13px;white-space:normal;word-break:break-word;line-height:1.2;width:100px;">${s.owner}</td>
      <td style="padding:10px 8px;">${stackedBar(s.pePct)}</td>
      <td style="padding:10px 8px;">${stackedBar(s.evPct)}</td>
      <td style="padding:10px 8px;">${stackedBar(s.auPct)}</td>
    </tr>`).join("");
}


/* ---------- Master render ---------- */
function renderAll() {
  const empty = document.getElementById("gdEmpty");
  const grid = document.getElementById("gdCharts");
  const count = document.getElementById("gdCount");
  if (count) count.textContent = `(${rows.length} record${rows.length === 1 ? "" : "s"})`;
  if (!rows.length) {
    if (empty) empty.style.display = "block";
    if (grid) grid.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";
  if (grid) grid.style.display = "block";
  renderKpis();
  renderStackTable();

}

/* ---------- Wire ---------- */
function subscribe() {
  if (unsub) return;
  unsub = onSnapshot(collection(db, COL), snap => {
    rows = dedupeRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    const panel = document.getElementById("gapDashboard");
    if (panel && panel.style.display !== "none") renderAll();
  }, err => {
    console.error("process-validation-dashboard snapshot", err);
    unsubscribe();
  });
}

function unsubscribe() {
  if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
}

function init() {
  const panel = document.getElementById("gapDashboard");
  if (!panel) return;
  // Subscribe only while signed in. Subscribing before sign-in failed with
  // "Missing or insufficient permissions" and killed the listener for good,
  // leaving this dashboard blank even after a successful login.
  onAuthStateChanged(auth, user => {
    if (user) { subscribe(); }
    else { unsubscribe(); rows = []; }
  });
  document.querySelectorAll('.subtab[data-gasub="gapDashboard"]').forEach(btn => {
    btn.addEventListener("click", () => setTimeout(renderAll, 30));
  });
  const btn = document.getElementById("gdRefresh");
  if (btn) btn.addEventListener("click", renderAll);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

} catch (err) { console.error('[process-validation-dashboard] failed to start', err); } }

/* ===== gap-assessment-dashboard.js (merged) ===== */
{ try {
// gap-assessment-dashboard.js — Gap Assessment Analytics & Executive Dashboard


const COL_GA = "gapAssessment";

let gaRows = [];
let unsubGa = null;
const charts = {};

const norm = v => String(v ?? "").trim();
const lc   = v => norm(v).toLowerCase();

function isYes(v) {
  const s = lc(v);
  return s === "yes" || s === "y" || s === "true" || s === "1";
}
function isNo(v) {
  const s = lc(v);
  return s === "no" || s === "n" || s === "false" || s === "0";
}
function severityOf(r) {
  const s = lc(r.severity);
  if (!s) return "";
  if (s.startsWith("crit")) return "Critical";
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med"))  return "Medium";
  if (s.startsWith("low"))  return "Low";
  return norm(r.severity);
}
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
function pctInt(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

/* ---------- KPIs ---------- */
function renderKpis() {
  const total = gaRows.length;
  const exists = gaRows.filter(r => isYes(r.exists)).length;
  const missing = gaRows.filter(r => isNo(r.exists)).length;
  const critical = gaRows.filter(r => severityOf(r) === "Critical").length;
  const automated = gaRows.filter(r => isYes(r.automated) || lc(r.status).includes("auto")).length;
  const evidence = gaRows.filter(r => isYes(r.evidenceExists) || isYes(r.hasEvidence) || isYes(r.evidence)).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("gadKpiTotal", total.toLocaleString());
  set("gadKpiMissing", missing.toLocaleString());
  set("gadKpiMissingSub", `${pct(missing, total)}% of total`);
  set("gadKpiCritical", critical.toLocaleString());
  set("gadKpiCompliance", `${pct(exists, total)}%`);
  set("gadKpiAutomation", `${pct(automated, total)}%`);
  set("gadKpiEvidence", `${pct(evidence, total)}%`);
}

/* ---------- Heatmap Table ---------- */
function heatColor(val, max) {
  if (!val) return "#dcfce7"; // green for 0
  const ratio = max > 0 ? val / max : 0;
  if (ratio >= 0.75) return "#b91c1c";  // deep red
  if (ratio >= 0.5)  return "#ef4444";
  if (ratio >= 0.25) return "#f97316";
  return "#fbbf24";
}
function heatText(val, max) {
  if (!val) return "#166534";
  const ratio = max > 0 ? val / max : 0;
  return ratio >= 0.5 ? "#fff" : "#111827";
}

function renderHeatmap() {
  const body = document.getElementById("gadHeatBody");
  if (!body) return;
  const owners = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    const sev = severityOf(r) || "Low";
    if (!owners[owner]) owners[owner] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    if (owners[owner][sev] !== undefined) owners[owner][sev]++;
  });
  const rows = Object.keys(owners).map(o => ({
    owner: o, ...owners[o],
    total: owners[o].Critical + owners[o].High + owners[o].Medium + owners[o].Low
  })).sort((a, b) => b.total - a.total);

  const totals = { Critical: 0, High: 0, Medium: 0, Low: 0, total: 0 };
  rows.forEach(r => {
    totals.Critical += r.Critical; totals.High += r.High;
    totals.Medium += r.Medium; totals.Low += r.Low; totals.total += r.total;
  });

  const maxes = {
    Critical: Math.max(1, ...rows.map(r => r.Critical)),
    High:     Math.max(1, ...rows.map(r => r.High)),
    Medium:   Math.max(1, ...rows.map(r => r.Medium)),
    Low:      Math.max(1, ...rows.map(r => r.Low)),
  };

  const cell = (v, max) => `<td style="padding:4px;text-align:center;border:1px solid #e5e7eb;background:${heatColor(v,max)};color:${heatText(v,max)};font-weight:700;">${v}</td>`;

  body.innerHTML = rows.map(r => `
    <tr>
      <td style="padding:4px 6px;border:1px solid #e5e7eb;font-weight:600;color:#111827;">${r.owner}</td>
      ${cell(r.Critical, maxes.Critical)}
      ${cell(r.High, maxes.High)}
      ${cell(r.Medium, maxes.Medium)}
      ${cell(r.Low, maxes.Low)}
      <td style="padding:4px;text-align:center;border:1px solid #e5e7eb;font-weight:800;background:#f8fafc;">${r.total}</td>
    </tr>
  `).join("") + `
    <tr style="background:#f1f5f9;font-weight:800;">
      <td style="padding:4px 6px;border:1px solid #e5e7eb;">TOTAL</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Critical}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.High}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Medium}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.Low}</td>
      <td style="padding:4px;border:1px solid #e5e7eb;text-align:center;">${totals.total}</td>
    </tr>
  `;
}

/* ---------- Bar Chart ---------- */
function chart3() {
  const byOwner = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    byOwner[owner] = (byOwner[owner] || 0) + 1;
  });
  const owners = Object.keys(byOwner).sort((a, b) => byOwner[b] - byOwner[a]);
  const data = owners.map(o => byOwner[o]);
  destroy("gadChart3");
  const el = document.getElementById("gadChart3");
  if (!el) return;
  charts.gadChart3 = new Chart(el, {
    type: "bar",
    data: { labels: owners, datasets: [{ label: "Missing Processes", data, backgroundColor: "#1f3a8a", borderWidth: 0 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        datalabels: false,
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "# Missing Processes" } },
        y: { ticks: { autoSkip: false } }
      }
    },
  });
}

/* ---------- Insights ---------- */
function renderInsights() {
  const el = document.getElementById("gadInsights");
  if (!el) return;
  const critical = gaRows.filter(r => severityOf(r) === "Critical").length;

  const missingByOwner = {};
  gaRows.forEach(r => {
    if (!isNo(r.exists)) return;
    const owner = norm(r.processOwner) || "Unassigned";
    missingByOwner[owner] = (missingByOwner[owner] || 0) + 1;
  });
  const ownerList = Object.keys(missingByOwner).sort((a, b) => missingByOwner[b] - missingByOwner[a]);
  const ownerBody = ownerList.length
    ? ownerList.map(o => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;"><span>${o}</span><strong style="color:#b91c1c;">${missingByOwner[o]}</strong></div>`).join("")
    : "No missing processes.";

  const card = (bg, border, iconBg, icon, title, titleColor, body) => `
    <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px;display:flex;gap:10px;align-items:flex-start;">
      <div style="width:34px;height:34px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;color:${titleColor};font-size:13px;margin-bottom:4px;">${title}</div>
        <div style="color:#374151;font-size:12px;line-height:1.4;">${body}</div>
      </div>
    </div>`;

  el.innerHTML = [
    card("#fef2f2", "#fecaca", "#fee2e2", "⚠️", `${critical} Critical Gaps`, "#b91c1c",
      "Immediate attention required for processes with critical severity."),
    card("#fff7ed", "#fed7aa", "#ffedd5", "🚫", "Non-Existing Processes by Owner", "#c2410c", ownerBody),
  ].join("");
}

/* ---------- Render orchestration ---------- */
function renderAll() {
  const empty = document.getElementById("gadEmpty");
  const content = document.getElementById("gadContent");
  const count = document.getElementById("gadCount");
  if (count) count.textContent = `(${gaRows.length} gap record${gaRows.length === 1 ? "" : "s"})`;

  if (!gaRows.length) {
    if (empty) empty.style.display = "block";
    if (content) content.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";
  if (content) content.style.display = "block";

  renderKpis();
  renderHeatmap();
  renderInsights();
  requestAnimationFrame(() => { chart3(); });
}

/* ---------- Wire ---------- */
function subscribe() {
  if (unsubGa) return;
  unsubGa = onSnapshot(collection(db, COL_GA), snap => {
    gaRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const panel = document.getElementById("gapAssessmentDashboard");
    if (panel && panel.style.display !== "none") renderAll();
  }, err => {
    console.error("gap-assessment-dashboard snapshot", err);
    unsubscribe();
  });
}

function unsubscribe() {
  if (unsubGa) { try { unsubGa(); } catch (e) {} unsubGa = null; }
}

function init() {
  const panel = document.getElementById("gapAssessmentDashboard");
  if (!panel) return;
  // Subscribe only while signed in (see note in process-validation-dashboard.js).
  onAuthStateChanged(auth, user => {
    if (user) { subscribe(); }
    else { unsubscribe(); gaRows = []; }
  });
  document.querySelectorAll('.subtab[data-gasub="gapAssessmentDashboard"]').forEach(btn => {
    btn.addEventListener("click", () => setTimeout(renderAll, 30));
  });
  const btn = document.getElementById("gadRefresh");
  if (btn) btn.addEventListener("click", renderAll);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

} catch (err) { console.error('[gap-assessment-dashboard] failed to start', err); } }
