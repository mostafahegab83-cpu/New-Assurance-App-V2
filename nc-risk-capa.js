/* NC / Risk & CAPA combined view — derives data from compliance_records (Audit form).
   No add/edit/delete here — read-only views with filters, kanban, cards, detail card,
   and Excel + PDF export. */
import { db, collection, onSnapshot, query, orderBy } from "./firebase.js";

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
        ${field("Audit ID", r.auditId)}
        ${field("Audit Date", r.auditDate)}
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
  ["Audit ID", "auditId"], ["Audit Date", "auditDate"],
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
  const headers = ["NC ID", "CAPA ID", "Risk ID", "Audit ID", "Process", "Compliance", "Status", "Owner"];
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

/* ---------- Firestore subscription ---------- */
try {
  const q = query(collection(db, "compliance_records"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    RECORDS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("ncrc snapshot", err));
} catch (e) {
  // Fallback without orderBy if createdAt missing
  onSnapshot(collection(db, "compliance_records"), (snap) => {
    RECORDS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
