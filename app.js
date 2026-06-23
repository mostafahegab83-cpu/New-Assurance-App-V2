/* Compliance & Risk Tracker — Firestore + Firebase Storage backend
   Records: Firestore collection "compliance_records"
   Attachments: Firebase Storage at attachments/{recordId}/{attachmentId}_{filename}
                Metadata (name, size, url, path) stored on the record.
*/
import * as firebase from "./firebase.js";

const firebaseApi = (() => {
  const mod = firebase && typeof firebase === "object" ? firebase : {};
  const def = mod.default && typeof mod.default === "object" ? mod.default : {};
  const globalFb = typeof window !== "undefined" && window.firebase && typeof window.firebase === "object"
    ? window.firebase
    : {};
  return { ...globalFb, ...def, ...mod };
})();

const {
  db,
  storage,
  auth,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  limit,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} = firebaseApi;

const ADMIN_EMAILS = Array.isArray(firebaseApi.ADMIN_EMAILS) ? firebaseApi.ADMIN_EMAILS : [];
const safeCall = (fn) => {
  try { return fn(); } catch (_) { return null; }
};
const authInstance = auth
  || safeCall(() => typeof firebaseApi.getAuth === "function" ? firebaseApi.getAuth() : null)
  || safeCall(() => typeof firebaseApi.auth === "function" ? firebaseApi.auth() : null)
  || (firebaseApi.auth && typeof firebaseApi.auth === "object" ? firebaseApi.auth : null)
  || safeCall(() => typeof window !== "undefined" && window.auth && typeof window.auth === "object" ? window.auth : null);

function observeAuthState(handler) {
  if (typeof onAuthStateChanged === "function" && authInstance) {
    return onAuthStateChanged(authInstance, handler);
  }
  if (authInstance && typeof authInstance.onAuthStateChanged === "function") {
    return authInstance.onAuthStateChanged(handler);
  }
  console.error("Firebase auth listener unavailable");
  return () => {};
}
function signInUser(email, password) {
  const cleanEmail = String(email || "").trim();
  if (typeof signInWithEmailAndPassword === "function" && authInstance) {
    return signInWithEmailAndPassword(authInstance, cleanEmail, password);
  }
  if (authInstance && typeof authInstance.signInWithEmailAndPassword === "function") {
    return authInstance.signInWithEmailAndPassword(cleanEmail, password);
  }
  throw new Error("Login is not configured correctly. Firebase email sign-in helper is missing.");
}
function signOutUser() {
  if (typeof signOut === "function" && authInstance) {
    return signOut(authInstance);
  }
  if (authInstance && typeof authInstance.signOut === "function") {
    return authInstance.signOut();
  }
  return Promise.resolve();
}
function sendResetEmail(email) {
  const cleanEmail = String(email || "").trim();
  if (typeof sendPasswordResetEmail === "function" && authInstance) {
    return sendPasswordResetEmail(authInstance, cleanEmail);
  }
  if (authInstance && typeof authInstance.sendPasswordResetEmail === "function") {
    return authInstance.sendPasswordResetEmail(cleanEmail);
  }
  throw new Error("Password reset is not configured correctly. Firebase reset helper is missing.");
}
async function getApprovedUserDoc(email) {
  if (typeof getDoc === "function" && typeof doc === "function" && db) {
    return getDoc(doc(db, "approved_users", email));
  }
  const compatDocRef = safeCall(() => db && typeof db.collection === "function"
    ? db.collection("approved_users").doc(email)
    : null);
  if (compatDocRef && typeof compatDocRef.get === "function") {
    return compatDocRef.get();
  }
  return null;
}

// Current session info — populated by auth gate at bottom of file
window.__session = { user: null, email: null, isAdmin: false };
function currentUser() { return window.__session.user; }
function currentEmail() { return window.__session.email; }
function isAdmin() { return window.__session.isAdmin; }
function lockUserNameField(emailOverride) {
  const email = emailOverride || currentEmail() || "";
  const unEl = document.getElementById("userName");
  if (!unEl) return;

  if (email) unEl.value = email;
  unEl.dataset.lockedEmail = email;
  unEl.setAttribute("readonly", "readonly");
  unEl.readOnly = true;
  unEl.setAttribute("disabled", "disabled");
  unEl.disabled = true;
  unEl.setAttribute("aria-readonly", "true");
  unEl.setAttribute("tabindex", "-1");
  unEl.removeAttribute("list");
  unEl.style.background = "#f3f4f6";
  unEl.style.color = "#6b7280";
  unEl.style.cursor = "not-allowed";
  unEl.style.pointerEvents = "none";
  unEl.title = "Auto-filled from your login email — cannot be changed";

  if (!unEl.dataset.locked) {
    unEl.dataset.locked = "1";
    const enforce = (ev) => {
      const lockedEmail = currentEmail() || unEl.dataset.lockedEmail || "";
      if (lockedEmail) unEl.value = lockedEmail;
      if (ev?.cancelable) ev.preventDefault();
      return false;
    };
    ["beforeinput", "input", "change", "keydown", "paste", "drop", "cut"]
      .forEach(type => unEl.addEventListener(type, enforce, true));
    unEl.addEventListener("focus", () => unEl.blur(), true);
  }
}
async function writeAudit(action, recordId, extra) {
  try {
    await addDoc(collection(db, "audit_log"), {
      action,                                  // "create" | "update" | "delete" | "clear_all" | "user_approve" | "user_revoke"
      recordId: recordId || null,
      userEmail: currentEmail() || "(unknown)",
      userUid: currentUser()?.uid || null,
      at: serverTimestamp(),
      ...(extra || {})
    });
  } catch (e) { console.warn("audit failed", e); }
}
window.__writeAudit = writeAudit;

(function () {
  "use strict";

  const COLLECTION = "compliance_records";
  const NA = "N/A";
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXT = ["msg","eml","xlsx","xls","docx","doc","pdf"];

  const FIELDS = [
    { id: "auditDate",      label: "Review Date",           kind: "raw"  },
    { id: "auditId",        label: "Review ID",             kind: "raw"  },
    { id: "userName",       label: "User Name",            kind: "text" },
    { id: "processName",    label: "Process Name",         kind: "text" },
    { id: "processOwner",   label: "Department",           kind: "text" },
    { id: "processPreparedBy", label: "Process Owner",     kind: "raw" },
    { id: "processPhase",   label: "Process Phase",        kind: "text" },
    { id: "dayWeek",        label: "Day/Week",             kind: "raw"  },
    { id: "plannedStartDate", label: "Planned Start Date", kind: "raw"  },
    { id: "actualStartDate",  label: "Actual Start Date",  kind: "raw"  },
    { id: "plannedEndDate",   label: "Planned End Date",   kind: "raw"  },
    { id: "actualEndDate",    label: "Actual End Date",    kind: "raw"  },
    { id: "controlItem",    label: "Control / Checklist",  kind: "raw"  },
    { id: "department",     label: "Action Owner",         kind: "text" },
    { id: "subDepartment",  label: "Sub-Department",       kind: "text" },
    { id: "owner",          label: "Owner",                kind: "text" },
    { id: "evidence",       label: "Required Evidence",    kind: "raw"  },
    { id: "targetSla",      label: "Target SLA",           kind: "raw"  },
    { id: "actualSla",      label: "Actual SLA",           kind: "raw"  },
    { id: "taskDone",        label: "Task Status",          kind: "raw"  },
    { id: "taskCorrectness", label: "Task Outcome",         kind: "raw"  },
    { id: "taskTiming",      label: "Task Timing",          kind: "raw"  },
    { id: "taskPerformance", label: "Task Performance",     kind: "raw"  },
    { id: "compliance",     label: "Compliance Status",    kind: "raw"  },
    { id: "complianceReasonCategory", label: "NC Reason Category", kind: "raw" },
    { id: "complianceReason", label: "NC Reason",          kind: "raw"  },
    { id: "ncCategory",     label: "NC Category",          kind: "raw"  },
    { id: "ncType",         label: "NC Type",              kind: "raw"  },
    { id: "ncId",           label: "NC ID",                kind: "raw"  },
    { id: "severityLevel",  label: "Severity Level",       kind: "raw"  },
    { id: "ncResponsibleDept", label: "Action Owner",      kind: "raw" },
    { id: "verifiedBy",     label: "Verified By",          kind: "raw"  },
    { id: "ncDesc",         label: "NC Description",       kind: "raw"  },
    { id: "rootCause",      label: "Root Cause",           kind: "raw"  },
    { id: "ncDescription",  label: "Comment",              kind: "raw"  },
    { id: "riskId",         label: "Risk ID",              kind: "raw"  },
    { id: "riskExist",      label: "Risk Exist",           kind: "raw"  },
    { id: "riskType",       label: "Risk Type",            kind: "raw"  },
    { id: "riskLevel",      label: "Risk Level",           kind: "raw"  },
    { id: "affectedDepartment", label: "Affected Department", kind: "raw" },
    { id: "riskOwner",      label: "Risk Owner",           kind: "raw"  },
    { id: "mitigation",     label: "Mitigation Status",    kind: "raw"  },
    { id: "linkedCapaId",   label: "Linked CAPA ID",       kind: "raw"  },
    { id: "control",        label: "Control",              kind: "raw"  },
    { id: "findings",       label: "Findings / Gaps",      kind: "raw"  },
    { id: "capaNeeded",     label: "CAPA Needed",          kind: "raw"  },
    { id: "capaIdField",    label: "CAPA ID",              kind: "raw"  },
    { id: "capaType",       label: "CAPA Type",            kind: "raw"  },
    { id: "rcCategory",     label: "RC Category",          kind: "raw"  },
    { id: "rcSubCategory",  label: "RC Sub-Category",      kind: "raw"  },
    { id: "capaStatus",     label: "CAPA Status",          kind: "raw"  },
    { id: "actionOwner",    label: "Action Owner",         kind: "raw"  },
    { id: "accountable",    label: "Accountable",          kind: "raw"  },
    { id: "startDate",      label: "Start Date",           kind: "raw"  },
    { id: "endDate",        label: "End Date",             kind: "raw"  },
    { id: "closureDate",    label: "Closure Date",         kind: "raw"  },
    { id: "overdueDates",   label: "Overdue Dates",        kind: "raw"  },
    { id: "effectivenessCriteria", label: "Effectiveness Criteria", kind: "raw" },
    { id: "effectiveness",  label: "Effectiveness",        kind: "raw"  },
    { id: "comments",       label: "Comments",             kind: "raw"  },
  ];

  let records = [];
  let pendingAttachments = []; // {id,name,type,size,uploadedAt, file?, path?, url?}
  let removedAttachments = []; // storage paths to delete on save
  const charts = {};
  const colRef = collection(db, COLLECTION);

  /* ---------- Helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const titleCase = s => s.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, c => c.toUpperCase());
  function normalize(value, kind) {
    if (value == null) return NA;
    const v = String(value).trim();
    if (!v) return NA;
    if (kind === "text") return titleCase(v);
    return v.replace(/\s+/g, " ");
  }
  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }
  function fileExt(name) {
    const m = /\.([^.]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function mimeForExt(ext) {
    const map = {
      pdf:  "application/pdf",
      doc:  "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls:  "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      msg:  "application/vnd.ms-outlook",
      eml:  "message/rfc822"
    };
    return map[ext] || "application/octet-stream";
  }
  function iconClass(ext) {
    if (ext === "pdf") return "pdf";
    if (ext === "doc" || ext === "docx") return "doc";
    if (ext === "xls" || ext === "xlsx") return "xls";
    if (ext === "msg" || ext === "eml") return "eml";
    return "";
  }
  function iconLabel(ext) { return (ext || "?").toUpperCase().slice(0,4); }
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function badgeClass(field, value) {
    const v = String(value);
    if (field === "compliance") {
      if (v === "Compliant") return "green";
      if (v === "Non-Compliant") return "red";
      if (v === "Observation") return "amber";
    }
    if (field === "riskLevel") {
      if (v === "Low") return "green";
      if (v === "Medium") return "amber";
      if (v === "High") return "red";
    }
    if (field === "riskExist" || field === "capaNeeded") {
      if (v === "Yes") return "red";
      if (v === "No")  return "green";
    }
    if (field === "mitigation") {
      if (v === "Closed" || v === "Mitigated") return "green";
      if (v === "Open") return "red";
      if (v === "Accepted") return "amber";
    }
    if (field === "effectiveness") {
      if (v === "Effective") return "green";
      if (v === "Partially Effective") return "amber";
      if (v === "Ineffective") return "red";
    }
    if (field === "severityLevel") {
      if (v === "Low") return "green";
      if (v === "Medium") return "amber";
      if (v === "High") return "red";
      if (v === "Critical") return "red";
    }
    if (field === "capaStatus") {
      if (v === "Closed") return "green";
      if (v === "In Progress") return "blue";
      if (v === "Pending") return "amber";
      if (v === "Cancelled") return "gray";
      if (v === "Overdue") return "red";
    }
    return "gray";
  }
  const escHtml = s => String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  /* ---------- Tabs ---------- */
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "dashboard") renderDashboard();
      if (tab.dataset.tab === "audit") { renderRecords(); setTimeout(() => lockUserNameField(), 0); }
    });
  });

  /* ---------- Audit sub-tabs (Form / Records) ---------- */
  document.querySelectorAll('#audit .subtab').forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('#audit .subtab').forEach(b => b.classList.remove("active"));
      document.querySelectorAll('#audit .sub-panel').forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.sub).classList.add("active");
      if (btn.dataset.sub === "records") renderRecords();
      if (btn.dataset.sub === "form") setTimeout(() => lockUserNameField(), 0);
    });
  });

  /* ---------- Dashboard sub-tabs (Findings / Risk) ---------- */
  document.querySelectorAll('#dashboard .subtab[data-dashsub]').forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('#dashboard .subtab[data-dashsub]').forEach(b => b.classList.remove("active"));
      document.querySelectorAll('#dashboard .dash-sub-panel').forEach(p => { p.style.display = "none"; });
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.dashsub);
      if (target) target.style.display = "";
    });
  });

  /* ---------- Datalists ---------- */
  function fillDataList(id, values) {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = [...new Set(values.filter(v => v && v !== NA))]
      .sort().map(v => `<option value="${v.replace(/"/g,'&quot;')}">`).join("");
  }
  function updateDataLists() {
    fillDataList("dlUser",          records.map(r => r.userName));
    fillDataList("dlProcess",       records.map(r => r.processName));
    fillDataList("dlProcessOwner",  records.map(r => r.processOwner));
    fillDataList("dlPhase",         records.map(r => r.processPhase));
    fillDataList("dlDepartment",    records.map(r => r.department));
    fillDataList("dlSubDepartment", records.map(r => r.subDepartment));
    fillDataList("dlOwner",         records.map(r => r.owner));
    const dsel = document.getElementById("filterDept");
    if (dsel) {
      const dcur = Array.from(dsel.selectedOptions).map(o => o.value);
      const depts2 = [...new Set(records.map(r => r.processOwner).filter(v => v && v !== NA))].sort();
      dsel.innerHTML = depts2.map(v => `<option ${dcur.includes(v)?'selected':''}>${v.replace(/"/g,'&quot;')}</option>`).join("");
      if (dsel._msRefresh) dsel._msRefresh();
    }
    const sel = document.getElementById("filterDepartment");
    const cur = Array.from(sel.selectedOptions).map(o => o.value);
    const deps = [...new Set(records.map(r => r.department).filter(v => v && v !== NA))].sort();
    sel.innerHTML = deps.map(v => `<option ${cur.includes(v)?'selected':''}>${v}</option>`).join("");
    if (sel._msRefresh) sel._msRefresh();
    const psel = document.getElementById("filterProcess");
    if (psel) {
      const pcur = Array.from(psel.selectedOptions).map(o => o.value);
      const procs = [...new Set(records.map(r => r.processName).filter(v => v && v !== NA))].sort();
      psel.innerHTML = procs.map(v => `<option ${pcur.includes(v)?'selected':''}>${v.replace(/"/g,'&quot;')}</option>`).join("");
      if (psel._msRefresh) psel._msRefresh();
    }
    const posel = document.getElementById("filterProcessOwner");
    if (posel) {
      const pocur = Array.from(posel.selectedOptions).map(o => o.value);
      const owners = [...new Set(records.map(r => r.processPreparedBy).filter(v => v && v !== NA))].sort();
      posel.innerHTML = owners.map(v => `<option ${pocur.includes(v)?'selected':''}>${v.replace(/"/g,'&quot;')}</option>`).join("");
      if (posel._msRefresh) posel._msRefresh();
    }
    const rpsel = document.getElementById("recFilterProcess");
    if (rpsel) {
      const rpcur = Array.from(rpsel.selectedOptions).map(o => o.value);
      const rprocs = [...new Set(records.map(r => r.processName).filter(v => v && v !== NA))].sort();
      rpsel.innerHTML = rprocs.map(v => `<option ${rpcur.includes(v)?'selected':''}>${v.replace(/"/g,'&quot;')}</option>`).join("");
      initMultiSelect(rpsel);
      if (rpsel._msRefresh) rpsel._msRefresh();
    }
  }

  /* ---------- Attachments (staged in form, uploaded on save) ---------- */
  function isAllowed(file) {
    return ALLOWED_EXT.includes(fileExt(file.name));
  }
  function handleFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    for (const file of list) {
      if (!isAllowed(file)) { toast(`Unsupported file type: ${file.name}`); continue; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} exceeds 10 MB limit`); continue; }
      pendingAttachments.push({
        id: uid(),
        name: file.name,
        type: file.type || "",
        size: file.size,
        uploadedAt: new Date().toISOString(),
        file,         // pending upload
        url: null,
        path: null
      });
    }
    renderAttachmentList();
  }
  function renderAttachmentList() {
    const ul = document.getElementById("attachmentList");
    if (!pendingAttachments.length) { ul.innerHTML = ""; return; }
    ul.innerHTML = pendingAttachments.map(a => {
      const ext = fileExt(a.name);
      const date = a.uploadedAt ? new Date(a.uploadedAt).toLocaleString() : "";
      const status = a.file ? " · pending upload" : "";
      const viewBtn = a.url
        ? `<a class="btn sm" href="${escHtml(a.url)}" target="_blank" rel="noopener">View</a>`
        : `<button type="button" class="btn sm" disabled>View</button>`;
      return `<li class="attach-item">
        <div class="attach-icon ${iconClass(ext)}">${iconLabel(ext)}</div>
        <div class="attach-meta">
          <div class="attach-name">${escHtml(a.name)}</div>
          <div class="attach-sub">${formatBytes(a.size)} · ${date}${status}</div>
        </div>
        <div class="attach-actions">
          ${viewBtn}
          <button type="button" class="btn sm danger" data-rm="${a.id}">Remove</button>
        </div>
      </li>`;
    }).join("");
    ul.querySelectorAll("[data-rm]").forEach(b =>
      b.addEventListener("click", () => {
        const a = pendingAttachments.find(x => x.id === b.dataset.rm);
        if (a && a.path) removedAttachments.push(a.path);
        pendingAttachments = pendingAttachments.filter(x => x.id !== b.dataset.rm);
        renderAttachmentList();
      }));
  }

  // Drag & drop
  const dz = document.getElementById("dropzone");
  ["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add("drag");
  }));
  ["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove("drag");
  }));
  dz.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
  document.getElementById("fileAttach").addEventListener("change", e => {
    handleFiles(e.target.files); e.target.value = "";
  });

  async function uploadPending(recordId) {
    const out = [];
    const prog = document.getElementById("uploadProgress");
    const fill = document.getElementById("uploadFill");
    const text = document.getElementById("uploadText");
    const toUpload = pendingAttachments.filter(a => a.file);
    if (toUpload.length) prog.hidden = false;
    let i = 0;
    for (const a of pendingAttachments) {
      if (!a.file) { out.push({ id:a.id, name:a.name, type:a.type, size:a.size, uploadedAt:a.uploadedAt, url:a.url, path:a.path }); continue; }
      // Strip any path separators from filename for safety
      const safeName = a.name.replace(/[\\/]/g, "_");
      const path = `attachments/${recordId}/${a.id}_${safeName}`;
      text.textContent = `Uploading ${a.name}…`;
      const ext = fileExt(a.name);
      const contentType = a.type && a.type !== "application/octet-stream" ? a.type : mimeForExt(ext);
      // Quote-safe filename for Content-Disposition (RFC 5987 fallback for unicode)
      const asciiName = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
      const encodedName = encodeURIComponent(safeName);
      const contentDisposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, a.file, { contentType, contentDisposition });
      // Also persist the resolved contentType on the record so re-saves keep it
      a.type = contentType;
      const url = await getDownloadURL(storageRef);
      i++;
      fill.style.width = ((i / toUpload.length) * 100).toFixed(0) + "%";
      out.push({ id:a.id, name:a.name, type:a.type, size:a.size, uploadedAt:a.uploadedAt, url, path });
    }
    if (toUpload.length) {
      text.textContent = `${toUpload.length} uploaded`;
      setTimeout(() => { prog.hidden = true; fill.style.width = "0%"; }, 1200);
    }
    // delete removed files from storage
    for (const p of removedAttachments) {
      try { await deleteObject(ref(storage, p)); } catch (e) { /* ignore */ }
    }
    removedAttachments = [];
    return out;
  }

  /* ---------- Form ---------- */
  const form = document.getElementById("recordForm");

  // Dependent dropdown: NC Reason Category -> NC Reason (sub-category)
  const NC_REASON_MAP = {
    "Evidence & Documentation": [
      "Missing Evidence",
      "Missing Ticket Resolution",
      "Incomplete Forms",
      "Missing Signatures or Approvals",
      "Unapproved Documents Used"
    ],
    "Process Compliance": [
      "Outdated SOPs",
      "Version Control Problems"
    ],
    "SLA Adherence": [
      "SLA Breach"
    ]
  };
  function populateNcReasonOptions(category, selected) {
    const sel = document.getElementById("complianceReason");
    if (!sel) return;
    const subs = NC_REASON_MAP[category] || [];
    sel.innerHTML = '<option>N/A</option>' +
      subs.map(s => `<option${s === selected ? " selected" : ""}>${s}</option>`).join("");
    if (selected && subs.includes(selected)) sel.value = selected;
  }
  const ncCatEl = document.getElementById("complianceReasonCategory");
  if (ncCatEl) {
    ncCatEl.addEventListener("change", () => populateNcReasonOptions(ncCatEl.value, ""));
  }

  // Dependent dropdown: RC Category -> RC Sub-Category
  const RC_SUBCATEGORY_MAP = {
    "Improper Root Cause Analysis": [
      "Incorrect root cause identified",
      "Superficial analysis (symptom only)",
      "No structured method (5 Why, Fishbone not used)",
      "Missing contributing/systemic causes",
      "Investigation based on assumptions"
    ],
    "CAPA Design Failure": [
      "Actions not linked to root cause",
      "Weak Actions",
      "No preventive actions included",
      "Over-reliance on human controls",
      "No error-proofing"
    ],
    "CAPA Implementation Failure": [
      "Actions not fully implemented",
      "Delayed execution",
      "Responsibilities unclear",
      "Insufficient resources",
      "Poor follow-up/tracking"
    ],
    "Effectiveness Verification Failure": [
      "No defined effectiveness criteria",
      "Early CAPA closure",
      "No data/evidence to confirm effectiveness",
      "Monitoring period too short",
      "No check for recurrence/trending"
    ]
  };
  function populateRcSubOptions(category, selected) {
    const sel = document.getElementById("rcSubCategory");
    if (!sel) return;
    const subs = RC_SUBCATEGORY_MAP[category] || [];
    sel.innerHTML = '<option>N/A</option>' +
      subs.map(s => `<option${s === selected ? " selected" : ""}>${s}</option>`).join("");
    if (selected && subs.includes(selected)) sel.value = selected;
  }
  const rcCatEl = document.getElementById("rcCategory");
  if (rcCatEl) {
    rcCatEl.addEventListener("change", () => populateRcSubOptions(rcCatEl.value, ""));
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("recordId").value || uid();
    const rec = { id };
    FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      rec[f.id] = normalize(el ? el.value : "", f.kind);
    });
    // Auto-fill User Name with the logged-in user's email
    rec.userName = currentEmail() || rec.userName;
    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      rec.attachments = await uploadPending(id);
      const existing = records.find(x => x.id === id);
      const isNew = !existing;
      rec.updatedBy = currentEmail();
      rec.updatedAt = new Date().toISOString();
      if (isNew) {
        rec.createdBy = currentEmail();
        rec.createdAt = rec.updatedAt;
      } else {
        rec.createdBy = existing.createdBy || currentEmail();
        rec.createdAt = existing.createdAt || rec.updatedAt;
      }
      await setDoc(doc(db, COLLECTION, id), rec);
      await writeAudit(isNew ? "create" : "update", id, { userName: rec.userName, processName: rec.processName });
      submitBtn.disabled = false;
      form.reset();
      document.getElementById("recordId").value = "";
      lockUserNameField();
      pendingAttachments = [];
      renderAttachmentList();
      toast("Record saved");
      document.querySelector('[data-tab="audit"]').click();
      document.querySelector('#audit .subtab[data-sub="records"]').click();
    } catch (err) {
      console.error(err);
      toast("Save failed: " + (err.message || err.code || "unknown"));
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    form.reset();
    document.getElementById("recordId").value = "";
    lockUserNameField();
    pendingAttachments = [];
    removedAttachments = [];
    renderAttachmentList();
  });

  function editRecord(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    document.getElementById("recordId").value = r.id;
    FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      if (f.id === "complianceReason") {
        populateNcReasonOptions(r.complianceReasonCategory || "", r.complianceReason || "");
        return;
      }
      if (f.id === "rcSubCategory") {
        populateRcSubOptions(r.rcCategory || "", r.rcSubCategory || "");
        return;
      }
      el.value = r[f.id] === NA ? "" : (r[f.id] ?? "");
    });
    lockUserNameField();
    pendingAttachments = (r.attachments || []).map(a => ({ ...a, file: null }));
    removedAttachments = [];
    renderAttachmentList();
    document.querySelector('[data-tab="audit"]').click();
    document.querySelector('#audit .subtab[data-sub="form"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRecord(id) {
    if (!isAdmin()) { toast("Only admins can delete records"); return; }
    if (!confirm("Delete this record?")) return;
    const r = records.find(x => x.id === id);
    try {
      for (const a of (r?.attachments || [])) {
        if (a.path) { try { await deleteObject(ref(storage, a.path)); } catch (e) {} }
      }
      await deleteDoc(doc(db, COLLECTION, id));
      await writeAudit("delete", id, { userName: r?.userName, processName: r?.processName });
      toast("Record deleted");
    } catch (err) {
      console.error(err);
      toast("Delete failed");
    }
  }

  async function deleteSelectedRecords() {
    if (!isAdmin()) { toast("Only admins can delete records"); return; }
    const ids = Array.from(document.querySelectorAll('#recordsTable tbody .row-select:checked')).map(c => c.value);
    if (!ids.length) { toast("No records selected"); return; }
    if (!confirm(`Delete ${ids.length} selected record(s)? This cannot be undone.`)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const r = records.find(x => x.id === id);
      try {
        for (const a of (r?.attachments || [])) {
          if (a.path) { try { await deleteObject(ref(storage, a.path)); } catch (e) {} }
        }
        await deleteDoc(doc(db, COLLECTION, id));
        await writeAudit("delete", id, { userName: r?.userName, processName: r?.processName, bulk: true });
        ok++;
      } catch (err) { console.error(err); fail++; }
    }
    toast(`Deleted ${ok}${fail ? `, ${fail} failed` : ""}`);
  }

  function updateSelectedCount() {
    const checked = document.querySelectorAll('#recordsTable tbody .row-select:checked').length;
    const total = document.querySelectorAll('#recordsTable tbody .row-select').length;
    const cnt = document.getElementById("selectedCount");
    const btn = document.getElementById("btnDeleteSelected");
    if (cnt) cnt.textContent = checked;
    if (btn) btn.disabled = checked === 0 || !isAdmin();
    const head = document.getElementById("selectAllRows");
    if (head) {
      head.checked = total > 0 && checked === total;
      head.indeterminate = checked > 0 && checked < total;
    }
  }


  /* ---------- Records table ---------- */
  function renderRecords() {
    const head = document.getElementById("recordsHead");
    const tbody = document.querySelector("#recordsTable tbody");

    // Wire filter inputs once
    if (!renderRecords._filtersWired) {
      const ids = ["recFilterAuditId","recFilterUser","recFilterPhase"];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", () => renderRecords());
      });
      const rp = document.getElementById("recFilterProcess");
      if (rp) {
        rp.addEventListener("change", () => renderRecords());
        rp.addEventListener("input", () => renderRecords());
      }
      const clr = document.getElementById("recClearFilters");
      if (clr) clr.addEventListener("click", () => {
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        if (rp) {
          Array.from(rp.options).forEach(o => o.selected = false);
          if (rp._msRefresh) rp._msRefresh();
        }
        renderRecords();
      });
      const delBtn = document.getElementById("btnDeleteSelected");
      if (delBtn) delBtn.addEventListener("click", deleteSelectedRecords);
      renderRecords._filtersWired = true;
    }


    const fv = id => (document.getElementById(id)?.value || "").trim().toLowerCase();
    const fAuditId = fv("recFilterAuditId");
    const fUser    = fv("recFilterUser");
    const fProcSel = msValues("recFilterProcess");
    const fPhase   = fv("recFilterPhase");
    const match = (val, q) => !q || String(val || "").toLowerCase().includes(q);

    const filtered = records.filter(r =>
      match(r.auditId, fAuditId) &&
      match(r.userName, fUser) &&
      (!fProcSel.length || fProcSel.includes(r.processName)) &&
      match(r.processPhase, fPhase)
    );

    document.getElementById("recordsCount").textContent =
      (fAuditId || fUser || fProcSel.length || fPhase)
        ? `${filtered.length} of ${records.length} record(s)`
        : `${records.length} record(s)`;

    // Build header dynamically: select-all + FIELDS + Files + Actions
    const selectAllTh = isAdmin()
      ? `<th style="width:32px"><input type="checkbox" id="selectAllRows" title="Select all" /></th>`
      : `<th style="width:0;padding:0"></th>`;
    if (head) {
      head.innerHTML = selectAllTh + FIELDS.map(f => `<th>${escHtml(f.label)}</th>`).join("")
        + `<th>Files</th><th>Actions</th>`;
    }
    const colCount = FIELDS.length + 3;

    if (!filtered.length) {
      const msg = records.length
        ? "No records match the current filters."
        : "No records yet. Use the “Audit form” tab to create one.";
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted);padding:24px">${msg}</td></tr>`;
      updateSelectedCount();
      return;
    }

    const BADGE_FIELDS = new Set(["compliance","severityLevel","riskExist","riskLevel","mitigation","capaNeeded","capaStatus","effectiveness","ncType"]);
    const WRAP_FIELDS  = new Set(["controlItem","ncDescription","ncDesc","findings","comments","rootCause","effectivenessCriteria","control"]);

    const renderCell = (f, r) => {
      const v = r[f.id];
      if (f.id === "evidence" && v && v !== NA && /^https?:\/\//i.test(v)) {
        return `<a href="${escHtml(v)}" target="_blank" rel="noopener">link</a>`;
      }
      if (BADGE_FIELDS.has(f.id) && v) {
        return `<span class="badge ${badgeClass(f.id, v)}">${escHtml(v)}</span>`;
      }
      return escHtml(v);
    };

    tbody.innerHTML = filtered.map(r => {
      const atts = r.attachments || [];
      const filesCell = atts.length
        ? `<div class="files-cell">${atts.map(a =>
            `<a class="files-chip" href="${escHtml(a.url || "#")}" target="_blank" rel="noopener" title="${escHtml(a.name)}">${escHtml(a.name.length > 18 ? a.name.slice(0,15) + "…" : a.name)}</a>`
          ).join("")}</div>`
        : `<span class="muted">—</span>`;
      const cells = FIELDS.map(f =>
        `<td${WRAP_FIELDS.has(f.id) ? ' class="wrap"' : ""}>${renderCell(f, r)}</td>`
      ).join("");
      const selCell = isAdmin()
        ? `<td><input type="checkbox" class="row-select" value="${r.id}" /></td>`
        : `<td style="padding:0"></td>`;
      return `
      <tr>
        ${selCell}
        ${cells}
        <td>${filesCell}</td>
        <td>
          <button class="btn sm" data-edit="${r.id}">Edit</button>
          ${isAdmin() ? `<button class="btn sm danger" data-del="${r.id}">Del</button>` : ""}
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => editRecord(b.dataset.edit)));
    tbody.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => deleteRecord(b.dataset.del)));
    tbody.querySelectorAll(".row-select").forEach(cb =>
      cb.addEventListener("change", updateSelectedCount));
    const selAll = document.getElementById("selectAllRows");
    if (selAll) selAll.addEventListener("change", () => {
      tbody.querySelectorAll(".row-select").forEach(cb => { cb.checked = selAll.checked; });
      updateSelectedCount();
    });
    updateSelectedCount();
  }


  /* ---------- Multi-select dropdowns ---------- */
  function msValues(id){
    const el = document.getElementById(id);
    if (!el) return [];
    return Array.from(el.selectedOptions).map(o => o.value).filter(v => v !== "");
  }
  function initMultiSelect(sel){
    if (!sel || sel.dataset.msInit) return;
    sel.dataset.msInit = "1";
    const placeholder = sel.dataset.placeholder || "Select…";
    sel.style.display = "none";
    const wrap = document.createElement("span");
    wrap.className = "ms-wrap";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ms-btn";
    btn.innerHTML = `<span class="ms-label"></span>`;
    const panel = document.createElement("div");
    panel.className = "ms-panel";
    wrap.appendChild(btn); wrap.appendChild(panel);
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    function renderPanel(){
      const opts = Array.from(sel.options).filter(o => o.value !== "");
      const actions = `<div class="ms-actions"><button type="button" data-act="all">Select all</button><button type="button" data-act="none">Clear</button></div>`;
      panel.innerHTML = actions + (opts.length
        ? opts.map(o => `<label class="ms-opt"><input type="checkbox" value="${o.value.replace(/"/g,'&quot;')}" ${o.selected?'checked':''}><span>${o.textContent}</span></label>`).join("")
        : `<div class="ms-empty">No options</div>`);
      panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          const opt = Array.from(sel.options).find(o => o.value === cb.value);
          if (opt) opt.selected = cb.checked;
          updateLabel();
          sel.dispatchEvent(new Event('input', {bubbles:true}));
          sel.dispatchEvent(new Event('change', {bubbles:true}));
        });
      });
      panel.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const on = b.dataset.act === 'all';
          Array.from(sel.options).forEach(o => { if (o.value!=="") o.selected = on; });
          renderPanel(); updateLabel();
          sel.dispatchEvent(new Event('input', {bubbles:true}));
          sel.dispatchEvent(new Event('change', {bubbles:true}));
        });
      });
    }
    function updateLabel(){
      const vals = msValues(sel.id);
      const lbl = wrap.querySelector('.ms-label');
      if (!vals.length) { lbl.textContent = placeholder; lbl.style.color = "#6b7280"; }
      else if (vals.length === 1) { lbl.textContent = vals[0]; lbl.style.color = "#1f2937"; }
      else { lbl.textContent = `${vals.length} selected`; lbl.style.color = "#1f2937"; }
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.ms-wrap.open').forEach(w => { if (w!==wrap) w.classList.remove('open'); });
      wrap.classList.toggle('open');
      if (wrap.classList.contains('open')) renderPanel();
    });
    sel._msRefresh = () => { renderPanel(); updateLabel(); };
    updateLabel();
  }
  document.addEventListener('click', () => {
    document.querySelectorAll('.ms-wrap.open').forEach(w => w.classList.remove('open'));
  });

  /* ---------- Filters & Dashboard ---------- */
  const FILTER_IDS = ["filterProcessOwner","filterDept","filterDepartment","filterProcess","filterCompliance","filterRiskLevel","filterMitigation"];
  function getFiltered() {
    const q   = document.getElementById("filterSearch").value.toLowerCase().trim();
    const dept = msValues("filterDept");
    const dep = msValues("filterDepartment");
    const proc = msValues("filterProcess");
    const po  = msValues("filterProcessOwner");
    const com = msValues("filterCompliance");
    const rl  = msValues("filterRiskLevel");
    const mit = msValues("filterMitigation");
    return records.filter(r => {
      if (dept.length && !dept.includes(r.processOwner)) return false;
      if (dep.length && !dep.includes(r.department)) return false;
      if (proc.length && !proc.includes(r.processName)) return false;
      if (po.length && !po.includes(r.processPreparedBy)) return false;
      if (com.length && !com.includes(r.compliance)) return false;
      if (rl.length  && !rl.includes(r.riskLevel)) return false;
      if (mit.length && !mit.includes(r.mitigation)) return false;
      if (!q) return true;
      return Object.values(r).some(v =>
        v && typeof v !== "object" && String(v).toLowerCase().includes(q));
    });
  }

  // Init multi-selects + wire change events
  FILTER_IDS.forEach(id => { const el = document.getElementById(id); if (el) { initMultiSelect(el); el.addEventListener("change", renderDashboard); } });
  const _fs = document.getElementById("filterSearch");
  if (_fs) _fs.addEventListener("input", renderDashboard);

  document.getElementById("clearFilters").addEventListener("click", () => {
    document.getElementById("filterSearch").value = "";
    FILTER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      Array.from(el.options).forEach(o => o.selected = false);
      if (el._msRefresh) el._msRefresh();
    });
    renderDashboard();
  });


  function counts(arr, field, includeNA = true) {
    return arr.reduce((acc, r) => {
      const k = r[field] || NA;
      if (!includeNA && (k === NA || !k)) return acc;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  }

  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  function colorCodeKpi(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest('.kpi');
    if (!card) return;
    card.classList.remove('kpi-red', 'kpi-orange', 'kpi-green');
    if (pct >= 0 && pct <= 69) {
      card.classList.add('kpi-red');
    } else if (pct >= 70 && pct <= 84) {
      card.classList.add('kpi-orange');
    } else if (pct >= 85 && pct <= 100) {
      card.classList.add('kpi-green');
    }
  }

  function renderDashboard() {
    const data = getFiltered();

    // ---------- KPIs ----------
    const compliantBase = data.filter(r => ["Compliant","Non-Compliant","Observation"].includes(r.compliance)).length;
    const compliantCount = data.filter(r => r.compliance === "Compliant").length;
    const ncRows = data.filter(r => r.compliance === "Non-Compliant" || r.compliance === "Observation");
    const compliancePct = compliantBase ? Math.round(compliantCount / compliantBase * 100) : 0;

    const slaRows = data.filter(r => !isNaN(parseFloat(r.targetSla)) && !isNaN(parseFloat(r.actualSla)));
    const adherent = slaRows.filter(r => parseFloat(r.actualSla) <= parseFloat(r.targetSla)).length;
    const slaAdherence = slaRows.length ? Math.round(adherent / slaRows.length * 100) : 0;
    const openRisks = data.filter(r => r.riskExist === "Yes" && r.mitigation !== "Closed" && r.mitigation !== "Mitigated").length;
    const capaNeededRows = data.filter(r => r.capaNeeded === "Yes");
    const ASSESSED_EFF = ["Effective", "Partially Effective", "Ineffective"];
    const assessedEffRows = capaNeededRows.filter(r => ASSESSED_EFF.includes(r.effectiveness));
    const effectiveCapa = assessedEffRows.filter(r => r.effectiveness === "Effective").length;
    const effPct = assessedEffRows.length ? Math.round(effectiveCapa / assessedEffRows.length * 100) : null;

    setText("kpiCompliancePct", compliancePct + "%");
    setText("kpiSlaAdherence", slaAdherence + "%");
    setText("kpiTotalNcs", ncRows.length);
    setText("kpiTotalRisks", data.filter(r => r.riskExist === "Yes").length);
    setText("kpiOpenRisks", openRisks);
    setText("kpiEffectiveCapa", effPct === null ? "N/A" : effPct + "%");

    colorCodeKpi("kpiCompliancePct", compliancePct);
    colorCodeKpi("kpiSlaAdherence", slaAdherence);
    colorCodeKpi("kpiEffectiveCapa", effPct === null ? 100 : effPct);

    // ---------- Charts ----------
    // Fixed category specs so legend always shows every category with its color.
    const CAT_COMPLIANCE  = { labels:["Compliant","Non-Compliant","Observation"],
                              colors:["#16a34a","#dc2626","#f59e0b"] };
    const CAT_NC_CATEGORY = { labels:["People","Process","Technology"],
                              colors:["#2563eb","#16a34a","#f97316"] };
    const CAT_RISK_LEVEL  = { labels:["Low","Medium","High"],
                              colors:["#16a34a","#f59e0b","#dc2626"] };
    const CAT_MITIGATION  = { labels:["Open","Accepted","Mitigated","Closed"],
                              colors:["#dc2626","#f59e0b","#16a34a","#2563eb"] };
    const CAT_CAPA_STATUS = { labels:["Pending","In Progress","Closed","Overdue","Cancelled"],
                              colors:["#f59e0b","#2563eb","#16a34a","#dc2626","#6b7280"] };
    const CAT_CAPA_TYPE   = { labels:["Corrective","Preventive"],
                              colors:["#dc2626","#2563eb"] };
    const CAT_NC_REASON   = { labels:["Evidence & Documentation","Process Compliance","SLA Adherence"],
                              colors:["#dc2626","#2563eb","#f59e0b"] };
    const CAT_RC_CATEGORY = { labels:["Improper Root Cause Analysis","CAPA Design Failure","CAPA Implementation Failure","Effectiveness Verification Failure"],
                              colors:["#dc2626","#f59e0b","#2563eb","#16a34a"] };
    const CAT_RISK_TYPE   = { labels:["Operational","Compliance","Financial","Reputational"],
                              colors:["#2563eb","#16a34a","#f59e0b","#dc2626"] };

    // Section 1: Compliance & NC
    drawPieCountPct("chartCompliance", counts(data, "compliance", false), CAT_COMPLIANCE);
    drawPieCountPct("chartNcCategory", counts(ncRows, "ncCategory", false), CAT_NC_CATEGORY);

    // Section 2: CAPA
    const capaNeededRows2 = capaNeededRows;
    const ncReasonRows = data.filter(r => {
      const c = String(r.compliance || "").toLowerCase();
      const cat = String(r.complianceReasonCategory || "").trim();
      if (!cat || cat.toUpperCase() === "N/A") return false;
      return c.includes("non-compliant") || c.includes("observation") || c.includes("partially");
    });
    drawPieCountPct("chartNcReason", counts(ncReasonRows, "complianceReasonCategory", false), CAT_NC_REASON,
      { rows: ncReasonRows, parentField: "complianceReasonCategory", subField: "complianceReason", title: "NC Reason breakdown" });
    const capaTypeRows = data.filter(r => {
      const t = String(r.capaType || "").trim();
      return t === "Corrective" || t === "Preventive";
    });
    drawPieCountPct("chartCapaType", counts(capaTypeRows, "capaType", false), CAT_CAPA_TYPE);
    drawPieCountPct("chartRcCategory", counts(capaNeededRows2, "rcCategory", false), CAT_RC_CATEGORY,
      { rows: capaNeededRows2, parentField: "rcCategory", subField: "rcSubCategory", title: "Root Cause breakdown" });
    drawPieCountPct("chartCapaStatus", counts(capaNeededRows2, "capaStatus", false), CAT_CAPA_STATUS);

    // Section 3: Risk
    const riskData = data.filter(r => r.riskExist === "Yes");
    drawPieCountPct("chartRiskType", counts(riskData, "riskType", false), CAT_RISK_TYPE);
    drawPieCountPct("chartRiskLevel", counts(riskData, "riskLevel", false), CAT_RISK_LEVEL);
    drawPieCountPct("chartRiskMitigation", counts(riskData, "mitigation", false), CAT_MITIGATION);

    // Task Performance donut
    drawTaskPerformanceDonut("chartTaskPerformance", data);

    renderScheduleVariance(data);

    // Recompute the Findings Summary so the latest data is always ready for PDF export.
    refreshFindings(data);
  }

  /* ------------------------------------------------------------------
   * Findings Summary integration
   * ------------------------------------------------------------------ */
  let _lastFindings = null;
  function refreshFindings(data) {
    if (!window.FindingsEngine) return;
    try {
      _lastFindings = window.FindingsEngine.analyze(data || getFiltered());
      const procFilter = (typeof msValues === "function") ? msValues("filterProcess") : [];
      const target = document.getElementById("findingsSection");
      if (target) window.FindingsEngine.render(target, _lastFindings, { categoryExclude: "Risk", processFilter: procFilter });
      const riskTarget = document.getElementById("findingsSectionRisk");
      if (riskTarget) window.FindingsEngine.render(riskTarget, _lastFindings, { categoryFilter: "Risk", processFilter: procFilter });
    } catch (e) { console.warn("Findings refresh failed", e); }
  }

  // "Findings Summary" button: regenerate + reveal + scroll into view
  document.getElementById("btnFindingsSummary")?.addEventListener("click", () => {
    refreshFindings(getFiltered());
    const sec = document.getElementById("findingsSection");
    if (sec) {
      sec.style.display = "block";
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`Generated ${_lastFindings ? _lastFindings.findings.length : 0} finding(s)`);
    }
  });

  // "View" toggle: show/hide the Findings Summary on the dashboard
  document.getElementById("btnViewFindings")?.addEventListener("click", () => {
    const sec = document.getElementById("findingsSection");
    if (!sec) return;
    if (!_lastFindings) refreshFindings(getFiltered());
    const visible = sec.style.display !== "none";
    sec.style.display = visible ? "none" : "block";
    if (!visible) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function diffDays(a, b) {
    if (!a || !b) return null;
    const da = new Date(a), db = new Date(b);
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  }

  function renderScheduleVariance(data) {
    const tbl = document.getElementById("scheduleVarianceTable");
    if (!tbl) return;
    const tbody = tbl.querySelector("tbody");
    const groups = {};
    data.forEach(r => {
      const name = (r.processName || "").trim() || "—";
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    });
    const names = Object.keys(groups).sort();
    if (!names.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted" style="text-align:center;">No data</td></tr>`;
      return;
    }
    const toDate = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
    const cell = v => {
      if (v === null) return `<td class="var-cell"><span class="var-dash">—</span></td>`;
      const cls = v === 0 ? "ok" : v > 0 ? "bad" : "early";
      return `<td class="var-cell"><span class="var-pill ${cls}"><span class="var-dot"></span>${v}</span></td>`;
    };
    tbody.innerHTML = names.map(n => {
      const rows = groups[n];
      let first = null, firstD = null;
      rows.forEach(r => { const d = toDate(r.plannedStartDate); if (d && (!firstD || d < firstD)) { firstD = d; first = r; } });
      let last = null, lastD = null;
      rows.forEach(r => { const d = toDate(r.plannedEndDate); if (d && (!lastD || d > lastD)) { lastD = d; last = r; } });
      const sv = first ? diffDays(first.plannedStartDate, first.actualStartDate) : null;
      const ev = last  ? diffDays(last.plannedEndDate,  last.actualEndDate)   : null;
      return `<tr>
        <td class="var-name">${escHtml(n)}</td>
        ${cell(sv)}
        ${cell(ev)}
      </tr>`;
    }).join("");
  }

  function normalizeChartLabel(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*&\s*/g, " & ")
      .toLowerCase();
  }

  function getChartDrilldownRows(drill, parentLabel) {
    if (!drill || !Array.isArray(drill.rows)) return [];
    const parentKey = normalizeChartLabel(parentLabel);
    return drill.rows.filter(r => normalizeChartLabel(r[drill.parentField]) === parentKey);
  }

  function buildChartBreakdown(rows, subField) {
    const counts = {};
    rows.forEach(r => {
      const k = String(r[subField] || "").trim() || "N/A";
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.keys(counts)
      .map(k => ({ label: k, count: counts[k] }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function renderBreakdownRows(breakdown, color) {
    const total = breakdown.reduce((a, b) => a + b.count, 0);
    const swatch = color || "#2563eb";
    if (!breakdown.length) {
      return '<div style="color:#777;font-size:13px;padding:8px 0;">No sub-category data recorded for this slice.</div>';
    }
    return breakdown.map(b => {
      const pct = total ? ((b.count / total) * 100).toFixed(1) : "0.0";
      const w = total ? (b.count / total) * 100 : 0;
      return `<div style="margin:8px 0;">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#111;">
          <span style="flex:1;white-space:normal;word-break:break-word;">${escHtml(b.label)}</span>
          <span style="font-weight:700;white-space:nowrap;">${b.count} (${pct}%)</span>
        </div>
        <div style="background:#eef2f7;height:8px;border-radius:4px;overflow:hidden;margin-top:3px;">
          <div style="background:${swatch};height:100%;width:${w}%;"></div>
        </div>
      </div>`;
    }).join("");
  }

  function renderChartDrilldownPanel(chartId, drill, activeLabel, color) {
    const canvas = document.getElementById(chartId);
    if (!canvas || !drill) return;
    let panel = document.getElementById(chartId + "Breakdown");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = chartId + "Breakdown";
      panel.style.cssText = "margin-top:10px;border-top:1px solid #e5e7eb;padding-top:10px;max-height:190px;overflow:auto;";
      canvas.insertAdjacentElement("afterend", panel);
    }

    const swatch = color || "#2563eb";
    if (activeLabel) {
      const subRows = getChartDrilldownRows(drill, activeLabel);
      const breakdown = buildChartBreakdown(subRows, drill.subField);
      const total = subRows.length;
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
          <span style="width:10px;height:10px;border-radius:2px;background:${swatch};display:inline-block;"></span>
          <strong style="font-size:12px;color:#1f3a8a;">${escHtml(activeLabel)} breakdown</strong>
          <span style="margin-left:auto;font-size:12px;color:#6b7280;">Total: ${total}</span>
        </div>
        ${renderBreakdownRows(breakdown, swatch)}`;
      return;
    }

    const parentLabels = Array.from(new Set((drill.rows || [])
      .map(r => String(r[drill.parentField] || "").trim())
      .filter(v => v && v.toUpperCase() !== "N/A")));
    const groups = parentLabels.map(parent => {
      const subRows = getChartDrilldownRows(drill, parent);
      const breakdown = buildChartBreakdown(subRows, drill.subField);
      const total = subRows.length;
      const topRows = breakdown.slice(0, 4).map(b => {
        const pct = total ? ((b.count / total) * 100).toFixed(1) : "0.0";
        return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#374151;margin-top:4px;">
          <span style="white-space:normal;word-break:break-word;">${escHtml(b.label)}</span>
          <strong style="white-space:nowrap;">${b.count} (${pct}%)</strong>
        </div>`;
      }).join("");
      return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:12px;font-weight:700;color:#1f3a8a;display:flex;justify-content:space-between;gap:8px;">
          <span>${escHtml(parent)}</span><span>Total: ${total}</span>
        </div>
        ${topRows || '<div style="font-size:12px;color:#777;margin-top:4px;">No sub-category data recorded.</div>'}
      </div>`;
    }).join("");
    panel.innerHTML = groups || '<div style="color:#777;font-size:12px;">No breakdown data recorded.</div>';
  }

  function showChartDrilldown(title, parentLabel, breakdown, color, totalOverride) {
    const total = Number.isFinite(totalOverride) ? totalOverride : breakdown.reduce((a, b) => a + b.count, 0);
    let modal = document.getElementById("chartDrilldownModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "chartDrilldownModal";
      modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:18px;";
      modal.innerHTML = '<div id="chartDrilldownBox" role="dialog" aria-modal="true" style="background:#fff;border-radius:10px;max-width:620px;width:94%;max-height:84vh;overflow:auto;box-shadow:0 18px 45px rgba(0,0,0,.35);"></div>';
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") document.getElementById("chartDrilldownModal")?.remove();
      });
      document.body.appendChild(modal);
    }
    const box = modal.querySelector("#chartDrilldownBox");
    const swatch = color || "#2563eb";
    const rows = renderBreakdownRows(breakdown, swatch);
    box.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${swatch};"></span>
        <div style="flex:1;">
          <div style="font-weight:700;color:#111;">${escHtml(title)}</div>
          <div style="font-size:12px;color:#666;">${escHtml(parentLabel)} — Total: ${total}</div>
        </div>
        <button type="button" id="chartDrilldownClose" style="border:0;background:#f3f4f6;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:600;">Close</button>
      </div>
      <div style="padding:14px 18px;">${rows}</div>`;
    box.querySelector("#chartDrilldownClose").onclick = () => modal.remove();
  }

  function drawPieCountPct(id, obj, spec, drill) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    let labels, values, colors;
    if (spec && Array.isArray(spec.labels)) {
      // Fixed categories — always render every category so the legend
      // shows the full set with its color coding, even with zero counts.
      labels = spec.labels.slice();
      values = labels.map(k => Number(obj[k] || 0));
      colors = spec.colors ? spec.colors.slice(0, labels.length) : palette.slice(0, labels.length);
      // Also include any unexpected extra keys (e.g. legacy "Partially Compliant").
      Object.keys(obj).forEach(k => {
        if (!labels.includes(k)) {
          labels.push(k);
          values.push(Number(obj[k] || 0));
          colors.push(palette[(labels.length - 1) % palette.length]);
        }
      });
    } else {
      labels = Object.keys(obj);
      values = Object.values(obj);
      colors = palette;
    }
    const total = values.reduce((a, b) => a + b, 0);
    if (charts[id]) charts[id].destroy();
    if (!labels.length || total === 0) {
      const c = ctx.getContext("2d");
      c.clearRect(0,0,ctx.width,ctx.height);
      c.fillStyle = "#9ca3af"; c.font = "13px system-ui"; c.textAlign = "center";
      c.fillText("No data", ctx.width/2, ctx.height/2);
      if (drill) renderChartDrilldownPanel(id, drill);
      if (!labels.length) return;
    }
    if (drill) renderChartDrilldownPanel(id, drill);
    charts[id] = new Chart(ctx, {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        onClick: (evt, elements, chart) => {
          if (!drill || !drill.rows || !elements || !elements.length) return;
          const idx = elements[0].index;
          const label = String(chart.data.labels[idx] || "").trim();
          const labelKey = label.toLowerCase();
          const color = (chart.data.datasets[0].backgroundColor || [])[idx];
          const subRows = getChartDrilldownRows(drill, label);
          const breakdown = buildChartBreakdown(subRows, drill.subField);
          renderChartDrilldownPanel(id, drill, label, color);
          showChartDrilldown(drill.title || "Breakdown", label, breakdown, color, subRows.length);
        },
        onHover: (evt, elements) => {
          if (!drill) return;
          evt.native && (evt.native.target.style.cursor = elements.length ? "pointer" : "default");
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => {
            const v = c.parsed; const pct = total ? ((v/total)*100).toFixed(1) : 0;
            const hint = drill ? " — click for details" : "";
            return `${c.label}: ${v} (${pct}%)${hint}`;
          } } }
        }
      },
      plugins: [{
        id: id + "Labels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save(); ctx.fillStyle = "#fff";
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          meta.data.forEach((arc, i) => {
            const v = values[i]; if (!v) return;
            const pct = total ? ((v/total)*100).toFixed(0) : 0;
            const { x, y } = arc.tooltipPosition();
            ctx.fillText(`${v} (${pct}%)`, x, y);
          });
          ctx.restore();
        }
      }]
    });
  }

  function drawTaskPerformanceDonut(id, rows) {
    let ctx = document.getElementById(id);
    if (!ctx) {
      // Auto-create the canvas if the HTML doesn't already include it so the
      // Task Performance donut never "disappears" from the dashboard.
      const host = document.querySelector('[data-section="taskPerformance"]')
                || document.getElementById("taskPerformanceSection")
                || document.getElementById("taskPerformance");
      if (host) {
        let wrap = host.querySelector('[data-auto-chart="taskPerformance"]');
        if (!wrap) {
          wrap = document.createElement("div");
          wrap.className = "card";
          wrap.dataset.autoChart = "taskPerformance";
          wrap.style.cssText = "background:#fff;padding:16px;border-radius:10px;margin-bottom:12px;min-height:360px;display:flex;flex-direction:column;";
          const title = document.createElement("div");
          title.textContent = "Task Performance Distribution";
          title.style.cssText = "text-align:center;font-weight:700;color:#1e3a8a;margin-bottom:8px;";
          const canvas = document.createElement("canvas");
          canvas.id = id;
          canvas.width = 900;
          canvas.height = 420;
          canvas.style.cssText = "height:320px;width:100%;display:block;";
          wrap.appendChild(title);
          wrap.appendChild(canvas);
          host.appendChild(wrap);
          ctx = canvas;
        } else {
          ctx = wrap.querySelector("canvas") || ctx;
          if (ctx && !ctx.id) ctx.id = id;
        }
      }
    }
    if (!ctx) return;
    const labels = ["Right & On Time", "Right but Late", "Wrong Execution", "Not Done"];
    const colors = ["#16a34a", "#f59e0b", "#dc2626", "#7f1d1d"];
    const counts = [0, 0, 0, 0];
    (rows || []).forEach(r => {
      const done = String(r.taskDone || "").trim().toLowerCase();
      const corr = String(r.taskCorrectness || "").trim().toLowerCase();
      const tim  = String(r.taskTiming || "").trim().toLowerCase();
      if (done === "not done") { counts[3]++; return; }
      if (done !== "done") return; // skip unset records
      if (corr === "wrong") { counts[2]++; return; }
      if (corr !== "right") return;
      if (tim.includes("late")) counts[1]++;
      else if (tim.includes("on time") || tim === "on-time" || tim === "ontime") counts[0]++;
    });
    const total = counts.reduce((a,b)=>a+b,0);
    if (charts[id]) charts[id].destroy();
    if (!total) {
      const c = ctx.getContext("2d");
      c.clearRect(0,0,ctx.width,ctx.height);
      c.fillStyle = "#9ca3af"; c.font = "13px system-ui"; c.textAlign = "center";
      c.fillText("No data", ctx.width/2, ctx.height/2);
      return;
    }
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "55%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => {
            const v = c.parsed; const pct = total ? ((v/total)*100).toFixed(1) : 0;
            return `${c.label}: ${v} (${pct}%)`;
          } } }
        }
      },
      plugins: [{
        id: id + "Labels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save(); ctx.fillStyle = "#fff";
          ctx.font = "700 12px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          meta.data.forEach((arc, i) => {
            const v = counts[i]; if (!v) return;
            const pct = total ? ((v/total)*100).toFixed(0) : 0;
            const { x, y } = arc.tooltipPosition();
            ctx.fillText(`${pct}%`, x, y);
          });
          ctx.restore();
        }
      }]
    });
  }


  const palette = ["#d12027","#16a34a","#f97316","#16a34a","#06b6d4","#7c3aed","#db2777","#d97706","#6b7280"];

  function drawBar(id, obj) {
    const ctx = document.getElementById(id);
    const labels = Object.keys(obj);
    const values = Object.values(obj);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }
  function drawDoughnut(id, obj) {
    const ctx = document.getElementById(id);
    const labels = Object.keys(obj);
    const values = Object.values(obj);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } }
    });
  }
  function drawRiskLevelPie(id, obj) {
    const order = ["High", "Medium", "Low"];
    const colorMap = { High: "#dc2626", Medium: "#f59e0b", Low: "#16a34a" };
    const labels = order.filter(k => obj[k]);
    const values = labels.map(k => obj[k]);
    const colors = labels.map(k => colorMap[k]);
    const total = values.reduce((a, b) => a + b, 0);
    const ctx = document.getElementById(id);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => {
            const v = ctx.parsed; const pct = total ? ((v/total)*100).toFixed(1) : 0;
            return `${ctx.label}: ${v} (${pct}%)`;
          } } }
        }
      },
      plugins: [{
        id: "pieDataLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save(); ctx.fillStyle = "#fff";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          meta.data.forEach((arc, i) => {
            const v = values[i]; if (!v) return;
            const pct = total ? ((v/total)*100).toFixed(0) : 0;
            const { x, y } = arc.tooltipPosition();
            ctx.fillText(`${v} (${pct}%)`, x, y);
          });
          ctx.restore();
        }
      }]
    });
  }
  function drawReasonPie(id, obj) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const labels = Object.keys(obj);
    const values = Object.values(obj);
    const total = values.reduce((a, b) => a + b, 0);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => {
            const v = c.parsed; const pct = total ? ((v/total)*100).toFixed(1) : 0;
            return `${c.label}: ${v} (${pct}%)`;
          } } }
        }
      },
      plugins: [{
        id: "reasonPieDataLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save(); ctx.fillStyle = "#fff";
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          meta.data.forEach((arc, i) => {
            const v = values[i]; if (!v) return;
            const pct = total ? ((v/total)*100).toFixed(0) : 0;
            const { x, y } = arc.tooltipPosition();
            ctx.fillText(`${v} (${pct}%)`, x, y);
          });
          ctx.restore();
        }
      }]
    });
  }
  function drawCapaGauge(id, data) {
    const today = new Date(); today.setHours(0,0,0,0);
    const assessed = ["Effective", "Partially Effective", "Ineffective"];
    const needed = data.filter(r => r.capaNeeded === "Yes");
    const done = needed.filter(r => {
      if (!assessed.includes(r.effectiveness)) return false;
      const d = r.capaDue ? new Date(r.capaDue) : null;
      if (!d || isNaN(d)) return false;
      d.setHours(0,0,0,0);
      return d <= today;
    }).length;
    const pct = needed.length ? Math.round((done / needed.length) * 100) : 0;
    document.getElementById("capaPctLabel").textContent = `${pct}%`;
    const ctx = document.getElementById(id);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["Completed", "Remaining"],
        datasets: [{ data: [pct, 100 - pct],
          backgroundColor: ["#16a34a","#e5e7eb"], borderWidth: 0 }] },
      options: { circumference: 180, rotation: 270, cutout: "70%",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } }
    });
  }

  /* ---------- New Dashboard Helpers ---------- */
  function drawSlaByPhase(id, data) {
    const phases = {};
    data.forEach(r => {
      const t = parseFloat(r.targetSla), a = parseFloat(r.actualSla);
      if (isNaN(t) || isNaN(a)) return;
      const p = r.processPhase || NA;
      if (!phases[p]) phases[p] = { tSum:0, aSum:0, n:0 };
      phases[p].tSum += t; phases[p].aSum += a; phases[p].n++;
    });
    const labels = Object.keys(phases);
    const target = labels.map(l => +(phases[l].tSum/phases[l].n).toFixed(1));
    const actual = labels.map(l => +(phases[l].aSum/phases[l].n).toFixed(1));
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"bar",
      data:{ labels, datasets:[
        { label:"Target SLA", data:target, backgroundColor:"#16a34a" },
        { label:"Actual SLA", data:actual, backgroundColor:"#d12027" }
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:"bottom" } },
        scales:{ y:{ beginAtZero:true } } }
    });
  }

  function drawStackedByDept(id, ncData) {
    const depts = [...new Set(ncData.map(r => r.department || NA))];
    const severities = ["Low","Medium","High","Critical"];
    const colorMap = { Low:"#16a34a", Medium:"#f59e0b", High:"#dc2626", Critical:"#7f1d1d" };
    const datasets = severities.map(s => ({
      label:s, backgroundColor: colorMap[s],
      data: depts.map(d => ncData.filter(r => (r.department||NA)===d && r.severityLevel===s).length)
    }));
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"bar",
      data:{ labels: depts, datasets },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:"bottom" } },
        scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true, ticks:{precision:0} } } }
    });
  }

  function drawPareto(id, obj) {
    const sorted = Object.entries(obj).sort((a,b)=>b[1]-a[1]);
    const labels = sorted.map(s=>s[0]);
    const values = sorted.map(s=>s[1]);
    const total = values.reduce((a,b)=>a+b,0);
    let cum = 0;
    const cumPct = values.map(v => { cum += v; return total ? +(cum/total*100).toFixed(1) : 0; });
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      data:{ labels, datasets:[
        { type:"bar", label:"Count", data:values, backgroundColor:"#16a34a", yAxisID:"y", order:2 },
        { type:"line", label:"Cumulative %", data:cumPct, borderColor:"#d12027", backgroundColor:"#d12027", yAxisID:"y1", tension:0.2, order:1 }
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:"bottom" } },
        scales:{
          y:{ beginAtZero:true, position:"left", ticks:{precision:0} },
          y1:{ beginAtZero:true, max:100, position:"right", grid:{drawOnChartArea:false}, ticks:{callback:v=>v+"%"} }
        } }
    });
  }

  function drawHeatmap(id, data) {
    const el = document.getElementById(id);
    if (!el) return;
    const levels = ["High","Medium","Low"];
    const depts = [...new Set(data.map(r => r.affectedDepartment || r.department || ""))].filter(Boolean);
    if (!depts.length) { el.innerHTML = '<p class="muted" style="padding:12px">No risk data</p>'; return; }
    let max = 0;
    levels.forEach(l => depts.forEach(d => {
      const c = data.filter(r => r.riskLevel===l && (r.affectedDepartment||r.department)===d).length;
      if (c>max) max = c;
    }));
    const cell = (l,d) => {
      const c = data.filter(r => r.riskLevel===l && (r.affectedDepartment||r.department)===d).length;
      const intensity = max ? c/max : 0;
      const bg = c ? `rgba(209,32,39,${0.15 + intensity*0.7})` : "#f3f4f6";
      const color = intensity > 0.5 ? "#fff" : "#111";
      return `<td style="background:${bg};text-align:center;padding:6px;font-weight:600;color:${color};border:1px solid #e5e7eb">${c||""}</td>`;
    };
    el.innerHTML = `<div style="overflow:auto;max-height:300px"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left;padding:4px;background:#f9fafb">Risk Level \\ Dept</th>${depts.map(d=>`<th style="padding:4px;font-size:11px;background:#f9fafb">${escHtml(d)}</th>`).join("")}</tr></thead>
      <tbody>${levels.map(l=>`<tr><td style="padding:4px;font-weight:600;background:#f9fafb">${l}</td>${depts.map(d=>cell(l,d)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function drawCapaAging(id, capaData) {
    const today = new Date(); today.setHours(0,0,0,0);
    const buckets = { "On Track":0, "1-7d overdue":0, "8-30d overdue":0, ">30d overdue":0, "Closed":0 };
    capaData.forEach(r => {
      if (r.capaStatus === "Closed") { buckets["Closed"]++; return; }
      const end = r.endDate ? new Date(r.endDate) : null;
      if (!end || isNaN(end)) { buckets["On Track"]++; return; }
      end.setHours(0,0,0,0);
      const diff = Math.floor((today-end)/86400000);
      if (diff <= 0) buckets["On Track"]++;
      else if (diff <= 7) buckets["1-7d overdue"]++;
      else if (diff <= 30) buckets["8-30d overdue"]++;
      else buckets[">30d overdue"]++;
    });
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"bar",
      data:{ labels:Object.keys(buckets), datasets:[{ data:Object.values(buckets),
        backgroundColor:["#16a34a","#f59e0b","#ea580c","#dc2626","#6b7280"] }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{ y:{ beginAtZero:true, ticks:{precision:0} } } }
    });
  }

  function drawPhaseStacked(id, data) {
    const phases = [...new Set(data.map(r => r.processPhase || NA))];
    const ds = [
      { label:"Compliant", backgroundColor:"#16a34a",
        data: phases.map(p => data.filter(r=>(r.processPhase||NA)===p && r.compliance==="Compliant").length) },
      { label:"Observation", backgroundColor:"#f59e0b",
        data: phases.map(p => data.filter(r=>(r.processPhase||NA)===p && r.compliance==="Observation").length) },
      { label:"Non-Compliant", backgroundColor:"#dc2626",
        data: phases.map(p => data.filter(r=>(r.processPhase||NA)===p && r.compliance==="Non-Compliant").length) },
    ];
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"bar", data:{ labels:phases, datasets:ds },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{position:"bottom"} },
        scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true, ticks:{precision:0}} } }
    });
  }

  function drawDeptScorecard(id, data) {
    const depts = [...new Set(data.map(r => r.department || ""))].filter(Boolean);
    const stats = depts.map(d => {
      const rows = data.filter(r => (r.department||"")===d);
      const base = rows.filter(r => ["Compliant","Non-Compliant","Observation"].includes(r.compliance)).length;
      const comp = rows.filter(r => r.compliance==="Compliant").length;
      const pct = base ? Math.round(comp/base*100) : 0;
      const ncs = rows.filter(r => r.compliance==="Non-Compliant" || r.compliance==="Observation").length;
      const slaRows = rows.filter(r => !isNaN(parseFloat(r.targetSla)) && !isNaN(parseFloat(r.actualSla)));
      const breaches = slaRows.filter(r => parseFloat(r.actualSla) > parseFloat(r.targetSla)).length;
      return { d, pct, ncs, breaches };
    }).sort((a,b)=>b.pct-a.pct);
    const labels = stats.map(s=>s.d);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"bar",
      data:{ labels, datasets:[
        { label:"Compliance %", data: stats.map(s=>s.pct), backgroundColor:"#16a34a" },
        { label:"NCs", data: stats.map(s=>s.ncs), backgroundColor:"#dc2626" },
        { label:"SLA Breaches", data: stats.map(s=>s.breaches), backgroundColor:"#f59e0b" },
      ]},
      options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{position:"bottom"} },
        scales:{ x:{ beginAtZero:true } } }
    });
  }

  function drawTrends(id, data) {
    const months = {};
    data.forEach(r => {
      if (!r.auditDate) return;
      const d = new Date(r.auditDate); if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!months[k]) months[k] = { comp:0, base:0, nc:0, slaTotal:0, slaOk:0 };
      if (["Compliant","Non-Compliant","Observation"].includes(r.compliance)) months[k].base++;
      if (r.compliance === "Compliant") months[k].comp++;
      if (r.compliance === "Non-Compliant" || r.compliance === "Observation") months[k].nc++;
      const t = parseFloat(r.targetSla), a = parseFloat(r.actualSla);
      if (!isNaN(t) && !isNaN(a)) { months[k].slaTotal++; if (a<=t) months[k].slaOk++; }
    });
    const labels = Object.keys(months).sort();
    const compPct = labels.map(k => months[k].base ? Math.round(months[k].comp/months[k].base*100) : 0);
    const ncCount = labels.map(k => months[k].nc);
    const slaPct = labels.map(k => months[k].slaTotal ? Math.round(months[k].slaOk/months[k].slaTotal*100) : 0);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type:"line",
      data:{ labels, datasets:[
        { label:"Compliance %", data:compPct, borderColor:"#16a34a", backgroundColor:"#16a34a", yAxisID:"y", tension:0.2 },
        { label:"SLA Adherence %", data:slaPct, borderColor:"#16a34a", backgroundColor:"#16a34a", yAxisID:"y", tension:0.2 },
        { label:"NC Count", data:ncCount, borderColor:"#dc2626", backgroundColor:"#dc2626", yAxisID:"y1", tension:0.2 },
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{position:"bottom"} },
        scales:{
          y:{ position:"left", beginAtZero:true, max:100, ticks:{callback:v=>v+"%"} },
          y1:{ position:"right", beginAtZero:true, grid:{drawOnChartArea:false}, ticks:{precision:0} }
        } }
    });
  }

  /* ---------- PDF Export ---------- */
  function activeFiltersText() {
    const parts = [];
    const map = { filterSearch: "Search", filterDept: "Department", filterDepartment: "Action Owner",
      filterProcess: "Process", filterProcessOwner: "Process Owner",
      filterCompliance: "Compliance", filterRiskLevel: "Risk Level",
      filterMitigation: "Mitigation" };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = el.multiple ? msValues(id).join(", ") : el.value;
      if (v) parts.push(`${map[id]}: ${v}`);
    });
    return parts.length ? parts.join(" · ") : "None";
  }
  async function exportPdf() {
    const orientation = document.getElementById("pdfOrientation").value;
    const scope = document.getElementById("pdfScope").value;
    const riskPanel = document.getElementById("dashRisk");
    const riskActive = !!riskPanel && getComputedStyle(riskPanel).display !== "none";
    const capture = document.getElementById(riskActive ? "riskDashboardCapture" : "dashboardCapture");
    const meta = document.getElementById("pdfMeta");
    const riskMeta = document.getElementById("riskPdfMeta");
    const exportMetaText = `Exported: ${new Date().toLocaleString()} · Filters: ${activeFiltersText()}`;
    if (meta) {
      meta.textContent = exportMetaText;
    }
    if (riskMeta) riskMeta.textContent = exportMetaText;

    // Refresh dynamic sections so what gets captured matches the screen.
    refreshFindings(getFiltered());
    try {
      drawTaskPerformanceDonut("chartTaskPerformance", getFiltered());
      charts.chartTaskPerformance?.update?.("none");
    } catch (_) {}

    // Scope toggling (kept for non-"all" scopes) — only applies to the Findings dashboard
    const sectionDisplay = [];
    capture.classList.add("exporting");
    // Risk mode reuses the Findings dashboard header (#pdfHeader lives inside #dashboardCapture)
    const findingsCapture = document.getElementById("dashboardCapture");
    if (riskActive && findingsCapture) findingsCapture.classList.add("exporting");
    if (!riskActive) {
      capture.querySelectorAll("[data-section]").forEach(el => {
        sectionDisplay.push([el, el.style.display]);
        const section = el.dataset.section;
        const show = scope === "all"
          || scope === section
          || (scope === "charts" && (section === "charts" || section === "taskPerformance"))
          || (scope === "table"  && section === "scheduleVariance")
          || (scope === "findings" && section === "findings");
        el.style.display = show ? "" : "none";
      });
    }

    try {
      toast("Generating PDF…");
      // Wait for layout/charts to settle before capturing.
      await new Promise(r => setTimeout(r, 400));
      await new Promise(requestAnimationFrame);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation, unit: "pt", format: "a4", compress: true });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      const isVisible = el => !!el && getComputedStyle(el).display !== "none" && el.offsetWidth > 0 && el.offsetHeight > 0;
      const chartIds = [
        "chartTaskPerformance",
        "chartCompliance","chartNcCategory","chartNcReason",
        "chartCapaType","chartRcCategory","chartCapaStatus",
        "chartRiskType","chartRiskLevel","chartRiskMitigation"
      ];
      const getChartCard = (id) => {
        const node = document.getElementById(id);
        if (!node) return null;
        return node.closest('[data-auto-chart="taskPerformance"], .chart-card, .card, .dash-card, .panel') || node;
      };
      const getSharedChartRow = (ids) => {
        const cards = ids.map(getChartCard).filter(Boolean);
        if (cards.length !== ids.length) return null;
        let ancestor = cards[0];
        while (ancestor && ancestor !== capture) {
          if (cards.every(card => ancestor.contains(card))) {
            const chartCount = chartIds.filter((cid) => {
              const n = document.getElementById(cid);
              return n && ancestor.contains(n);
            }).length;
            if (chartCount === ids.length) return ancestor;
          }
          ancestor = ancestor.parentElement;
        }
        return null;
      };

      // ---- Ordered blocks (exact dashboard order, each appears ONCE) ----
      const header = document.getElementById("pdfHeader");
      const riskHeader = document.getElementById("riskPdfHeader");
      let orderedBlocks;
      if (riskActive) {
        const riskKpis = capture.querySelector(".kpis");
        const riskRow = getSharedChartRow(["chartRiskType","chartRiskLevel","chartRiskMitigation"]);
        const riskFindings = document.getElementById("findingsSectionRisk");
        orderedBlocks = [riskHeader, riskKpis, riskRow, riskFindings];
      } else {
        const kpis = capture.querySelector('[data-section="kpis"]');
        const scheduleVar = capture.querySelector('[data-section="scheduleVariance"]');
        const taskCard = getChartCard("chartTaskPerformance");
        const complianceRow = getSharedChartRow(["chartCompliance","chartNcCategory","chartNcReason"]);
        const capaRow = getSharedChartRow(["chartCapaType","chartRcCategory","chartCapaStatus"]);
        const findings = document.getElementById("findingsSection");
        if (scope === "all") {
          orderedBlocks = [header, kpis, scheduleVar, complianceRow, capaRow, findings];
        } else {
          orderedBlocks = [header];
          if (scope === "kpis") orderedBlocks.push(kpis);
          if (scope === "table") orderedBlocks.push(scheduleVar);
          if (scope === "taskPerformance") orderedBlocks.push(taskCard);
          if (scope === "charts") orderedBlocks.push(complianceRow, capaRow);
          if (scope === "findings") orderedBlocks.push(findings);
        }
      }
      const seen = new Set();
      const blocks = orderedBlocks.filter(el => {
        if (!el || seen.has(el) || !isVisible(el)) return false;
        seen.add(el);
        return true;
      });
      if (!blocks.length) throw new Error("Nothing visible to export");

      // ---- Render every block once ----
      const cache = new Map();
      for (const el of blocks) {
        const canvas = await html2canvas(el, {
          scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
          imageTimeout: 0, scrollX: 0, scrollY: -window.scrollY,
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight
        });
        cache.set(el, { dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height });
      }

      // ---- Uniform scale (mirror dashboard proportions) ----
      // Base width = widest captured block. Every block uses the SAME scale,
      // so relative widths/heights match the on-screen layout exactly.
      const baseW = Math.max(...blocks.map(el => cache.get(el).w));
      const widthScale = contentW / baseW;
      const blockHeightsAtWidth = blocks.map(el => cache.get(el).h * widthScale);
      const maxBlockH = Math.max(...blockHeightsAtWidth);
      // If the tallest single card exceeds a page, shrink everything uniformly
      // so no card ever splits across pages.
      const fitScale = maxBlockH > contentH ? contentH / maxBlockH : 1;
      const finalScale = widthScale * fitScale;

      const gap = 10;

      // ---- Pack blocks across pages, never splitting a card ----
      let y = margin;
      let pageStarted = true;
      blocks.forEach((el) => {
        const c = cache.get(el);
        const drawW = c.w * finalScale;
        const drawH = c.h * finalScale;
        const xOff = margin + (contentW - drawW) / 2;

        if (!pageStarted && y + drawH > margin + contentH + 0.5) {
          pdf.addPage();
          y = margin;
          pageStarted = true;
        }
        pdf.addImage(c.dataUrl, "PNG", xOff, y, drawW, drawH, undefined, "FAST");
        y += drawH + gap;
        pageStarted = false;
      });

      pdf.save(`Assurance Tracker -${new Date().toISOString().slice(0,10)}.pdf`);
      toast("PDF downloaded");
    } catch (e) {
      console.error(e);
      toast("PDF export failed");
    } finally {
      capture.classList.remove("exporting");
      if (riskActive && findingsCapture) findingsCapture.classList.remove("exporting");
      sectionDisplay.forEach(([el, display]) => { el.style.display = display; });
    }
  }
  document.getElementById("btnExportPdf").addEventListener("click", exportPdf);

  /* ---------- CSV ---------- */
  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  // Export column order grouped by section: General → Task Performance → NC Register → CAPA → Risk
  const EXPORT_SECTIONS = [
    { name: "General", ids: ["auditDate","auditId","userName","processName","processOwner","processPreparedBy","processPhase","dayWeek","plannedStartDate","actualStartDate","plannedEndDate","actualEndDate","controlItem","department","subDepartment","owner","evidence","targetSla","actualSla"] },
    { name: "Task Performance", ids: ["taskDone","taskCorrectness","taskTiming","taskPerformance"] },
    { name: "NC Register", ids: ["compliance","complianceReasonCategory","complianceReason","ncCategory","ncType","ncId","severityLevel","ncResponsibleDept","verifiedBy","ncDesc","rootCause","ncDescription"] },
    { name: "CAPA", ids: ["capaNeeded","capaIdField","capaType","rcCategory","rcSubCategory","capaStatus","actionOwner","accountable","startDate","endDate","closureDate","overdueDates","effectivenessCriteria","effectiveness","comments"] },
    { name: "Risk", ids: ["riskId","riskExist","riskType","riskLevel","affectedDepartment","riskOwner","mitigation","linkedCapaId","control","findings"] },
  ];
  function getExportFields() {
    const byId = Object.fromEntries(FIELDS.map(f => [f.id, f]));
    const ordered = [];
    const seen = new Set();
    EXPORT_SECTIONS.forEach(s => s.ids.forEach(id => {
      if (byId[id] && !seen.has(id)) { ordered.push(byId[id]); seen.add(id); }
    }));
    // Append any FIELDS not covered above to avoid data loss
    FIELDS.forEach(f => { if (!seen.has(f.id)) { ordered.push(f); seen.add(f.id); } });
    return ordered;
  }
  function exportCSV() {
    const recProc = msValues("recFilterProcess");
    const anyFilter = !!document.getElementById("filterSearch").value
      || FILTER_IDS.some(id => msValues(id).length)
      || recProc.length > 0;
    let data = anyFilter ? getFiltered() : records;
    if (recProc.length) data = data.filter(r => recProc.includes(r.processName));
    if (!data.length) return toast("No records to export");
    const fields = getExportFields();
    const header = ["id", ...fields.map(f => f.label), "Attachments"];
    const lines = [header.join(",")];
    data.forEach(r => {
      const att = (r.attachments || []).map(a => a.name).join(" | ");
      lines.push([csvEscape(r.id), ...fields.map(f => csvEscape(r[f.id])), csvEscape(att)].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `compliance-records-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(`Exported ${data.length} record(s)`);
  }
  function parseCSV(text) {
    const rows = []; let cur = [], val = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i+1] === '"') { val += '"'; i++; }
        else if (c === '"') inQ = false;
        else val += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { cur.push(val); val = ""; }
        else if (c === "\n" || c === "\r") {
          if (val !== "" || cur.length) { cur.push(val); rows.push(cur); cur = []; val = ""; }
          if (c === "\r" && text[i+1] === "\n") i++;
        } else val += c;
      }
    }
    if (val !== "" || cur.length) { cur.push(val); rows.push(cur); }
    return rows;
  }
  async function importCSV(file) {
    const reader = new FileReader();
    reader.onload = async e => {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) return toast("CSV is empty");
      const header = rows[0].map(h => h.trim());
      const batch = writeBatch(db);
      let added = 0;
      // Use a single import timestamp + zero-padded row index so generated
      // document IDs sort in the exact CSV file sequence (Firestore default
      // ordering is by document ID).
      const importTs = Date.now().toString(36);
      const pad = String(rows.length).length;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.length || row.every(v => !v)) continue;
        const obj = {};
        header.forEach((h, idx) => obj[h] = row[idx] ?? "");
        const seqId = `${importTs}-${String(i).padStart(pad, "0")}`;
        const id = obj.id || obj.ID || seqId;
        const nowIso = new Date().toISOString();
        const rec = { id, attachments: [], importSeq: i, importedAt: importTs, createdAt: nowIso, updatedAt: nowIso };
        FIELDS.forEach(f => {
          const matchKey = Object.keys(obj).find(k => k.toLowerCase() === f.label.toLowerCase()) || f.id;
          rec[f.id] = normalize(obj[matchKey], f.kind);
        });
        // Ensure timestamps exist even if FIELDS loop overwrote them with empties
        if (!rec.createdAt) rec.createdAt = nowIso;
        if (!rec.updatedAt) rec.updatedAt = nowIso;
        // preserve existing attachments + original createdAt if record already exists
        const existing = records.find(r => r.id === id);
        if (existing) {
          rec.attachments = existing.attachments || [];
          if (existing.createdAt) rec.createdAt = existing.createdAt;
        }
        batch.set(doc(db, COLLECTION, id), rec);
        added++;
      }
      try {
        await batch.commit();
        toast(`Imported ${added} record(s)`);
      } catch (err) {
        console.error(err); toast("Import failed");
      }
    };
    reader.readAsText(file);
  }

  document.getElementById("btnExport").addEventListener("click", exportCSV);
  document.getElementById("fileImport").addEventListener("change", e => {
    if (e.target.files[0]) importCSV(e.target.files[0]);
    e.target.value = "";
  });
  const BACKUP_COLLECTION = "records_backup";
  const BACKUP_DOC_ID = "last";

  async function refreshBackupInfo() {
    const el = document.getElementById("backupInfo");
    const btn = document.getElementById("btnRestoreBackup");
    if (!el && !btn) return;
    try {
      const snap = await getDoc(doc(db, BACKUP_COLLECTION, BACKUP_DOC_ID));
      if (snap.exists()) {
        const d = snap.data();
        const when = d.backedUpAt ? new Date(d.backedUpAt).toLocaleString() : "";
        const count = (d.records || []).length;
        if (el) el.textContent = count ? `Last backup: ${count} record(s) — ${when}` : "";
        if (btn) btn.disabled = !count;
      } else {
        if (el) el.textContent = "No backup available";
        if (btn) btn.disabled = true;
      }
    } catch (e) { /* ignore */ }
  }

  document.getElementById("btnClearAll").addEventListener("click", async () => {
    if (!isAdmin()) { toast("Only admins can clear all records"); return; }
    if (!records.length) { toast("No records to clear"); return; }
    const typed = prompt(
      `This will delete ALL ${records.length} record(s).\n\n` +
      `A backup will be saved so you can restore it later via "Restore Last Backup".\n\n` +
      `Type YES (in capitals) to confirm:`
    );
    if (typed === null) return;
    if (String(typed).trim().toUpperCase() !== "YES") { toast("Clear cancelled"); return; }
    if (!confirm(`Final confirmation: delete ALL ${records.length} record(s) now?`)) return;
    try {
      // 1) Save backup snapshot of all current records (metadata only — attachments are NOT deleted)
      const toDelete = records.slice();
      const backupPayload = {
        backedUpAt: new Date().toISOString(),
        backedUpBy: (window.__session && window.__session.email) || "(unknown)",
        count: toDelete.length,
        records: toDelete.map(r => ({ ...r }))
      };
      await setDoc(doc(db, BACKUP_COLLECTION, BACKUP_DOC_ID), backupPayload);

      // 2) Delete records from the live collection (keep storage attachments intact for restore)
      const batch = writeBatch(db);
      toDelete.forEach(r => batch.delete(doc(db, COLLECTION, r.id)));
      await batch.commit();

      await writeAudit("clear_all", null, { count: toDelete.length, backup: true });
      toast(`All records cleared — ${toDelete.length} backed up`);
      refreshBackupInfo();
    } catch (err) {
      console.error(err); toast("Clear failed: " + (err.message || err.code));
    }
  });

  document.getElementById("btnRestoreBackup")?.addEventListener("click", async () => {
    if (!isAdmin()) { toast("Only admins can restore backups"); return; }
    try {
      const snap = await getDoc(doc(db, BACKUP_COLLECTION, BACKUP_DOC_ID));
      if (!snap.exists()) { toast("No backup found"); return; }
      const d = snap.data();
      const list = Array.isArray(d.records) ? d.records : [];
      if (!list.length) { toast("Backup is empty"); return; }
      const when = d.backedUpAt ? new Date(d.backedUpAt).toLocaleString() : "(unknown time)";
      if (!confirm(`Restore ${list.length} record(s) from backup taken ${when}?\n\nExisting records with the same ID will be overwritten.`)) return;
      // Firestore writeBatch limit ~500; chunk if needed
      const CHUNK = 400;
      for (let i = 0; i < list.length; i += CHUNK) {
        const batch = writeBatch(db);
        list.slice(i, i + CHUNK).forEach(r => {
          if (r && r.id) batch.set(doc(db, COLLECTION, r.id), r);
        });
        await batch.commit();
      }
      await writeAudit("restore_backup", null, { count: list.length });
      toast(`Restored ${list.length} record(s) from backup`);
    } catch (err) {
      console.error(err); toast("Restore failed: " + (err.message || err.code));
    }
  });

  // Show backup info once auth/data is ready
  setTimeout(refreshBackupInfo, 1500);

  /* ---------- Realtime sync ---------- */
  const status = document.getElementById("syncStatus");
  let unsubscribeRecords = null;

  function startRealtimeSync() {
    if (unsubscribeRecords) return;
    status.textContent = "Connecting…";
    status.style.color = "#6b7280";

    unsubscribeRecords = onSnapshot(colRef, snap => {
      records = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
        // Preserve CSV import sequence: order by importedAt then importSeq,
        // fall back to document id for records without import metadata.
        const ax = a.importedAt || "", bx = b.importedAt || "";
        if (ax !== bx) return ax < bx ? -1 : 1;
        const ai = a.importSeq ?? null, bi = b.importSeq ?? null;
        if (ai !== null && bi !== null && ai !== bi) return ai - bi;
        return String(a.id).localeCompare(String(b.id));
      });
      status.textContent = "Connected — syncs across devices";
      status.style.color = "#16a34a";
      updateDataLists();
      renderDashboard();
      renderRecords();
    }, err => {
      console.error(err);
      unsubscribeRecords = null;
      status.textContent = "Connection error — check Firestore rules";
      status.style.color = "#dc2626";
      toast("Firestore error: " + (err.message || err.code));
    });
  }

  function stopRealtimeSync() {
    if (unsubscribeRecords) {
      unsubscribeRecords();
      unsubscribeRecords = null;
    }
    records = [];
    status.textContent = "Sign in to sync";
    status.style.color = "#6b7280";
    updateDataLists();
    renderDashboard();
    renderRecords();
  }

  window.__startComplianceSync = startRealtimeSync;
  window.__stopComplianceSync = stopRealtimeSync;
})();

/* ==================== AUTH GATE ==================== */
(function () {
  const overlay = document.getElementById("loginOverlay");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!overlay || !loginForm) return;

  observeAuthState(async (user) => {
    if (user) {
      const email = (user.email || "").toLowerCase();
      const admin = ADMIN_EMAILS.map(e => String(e).toLowerCase()).includes(email);

      // Approval check: admins are always approved; for other users, fall back to allow access
      // when the approval collection is unavailable or not configured yet.
      let approved = admin;
      if (!admin) {
        try {
          const snap = await getApprovedUserDoc(email);
          if (!snap) {
            approved = true;
          } else {
            const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
            const data = typeof snap.data === "function" ? snap.data() : (snap.data || {});
            approved = !exists || data.approved === true;
          }
        } catch (e) {
          console.warn("approved_users lookup failed; allowing signed-in user", e);
          approved = true;
        }
      }

      if (!approved) {
        loginError.textContent = "Your account is not approved yet. Contact the administrator.";
        await signOutUser();
        return;
      }

      window.__session = { user, email, isAdmin: admin };
      // Auto-fill the User Name field with the logged-in email and HARD lock it
      lockUserNameField(email);
      // Toggle admin-only UI
      document.querySelectorAll("[data-admin-only]").forEach(el => {
        el.style.display = admin ? "" : "none";
      });
      overlay.style.display = "none";
      window.__initAdminPanel?.();
      window.__startComplianceSync?.();
    } else {
      window.__session = { user: null, email: null, isAdmin: false };
      window.__stopComplianceSync?.();
      overlay.style.display = "flex";
      if (passwordInput) passwordInput.value = "";
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      await signInUser(emailInput.value, passwordInput.value);
    } catch (err) {
      loginError.textContent = (err.message || String(err)).replace("Firebase: ", "");
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await signOutUser(); } catch (err) { console.error(err); }
    });
  }

  // Forgot password
  const forgotLink = document.getElementById("forgotPasswordLink");
  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      loginError.style.color = "#dc2626";
      const defaultEmail = (emailInput.value || "").trim();
      const email = (window.prompt("Enter your email address to receive a password reset link:", defaultEmail) || "").trim();
      if (!email) return;
      try {
        await sendResetEmail(email);
        loginError.style.color = "#059669";
        loginError.textContent = "Reset link sent. Check your email inbox (and spam folder).";
      } catch (err) {
        loginError.style.color = "#dc2626";
        loginError.textContent = (err.message || String(err)).replace("Firebase: ", "");
      }
    });
  }
})();

/* ==================== ADMIN PANEL ==================== */
(function () {
  let unsubUsers = null, unsubAudit = null;
  let initialized = false;

  async function approveUser(email) {
    email = email.trim().toLowerCase();
    if (!email) return;
    try {
      await setDoc(doc(db, "approved_users", email), {
        email, approved: true,
        approvedBy: window.__session.email,
        approvedAt: new Date().toISOString()
      });
      await window.__writeAudit?.("user_approve", null, { targetEmail: email });
      const inp = document.getElementById("newUserEmail");
      if (inp) inp.value = "";
    } catch (e) { console.error(e); alert("Failed: " + e.message); }
  }
  async function revokeUser(email) {
    if (!confirm(`Revoke access for ${email}?`)) return;
    try {
      await setDoc(doc(db, "approved_users", email), {
        email, approved: false,
        revokedBy: window.__session.email,
        revokedAt: new Date().toISOString()
      });
      await window.__writeAudit?.("user_revoke", null, { targetEmail: email });
    } catch (e) { console.error(e); alert("Failed: " + e.message); }
  }

  function renderUsers(list) {
    const tbody = document.querySelector("#usersTable tbody");
    if (!tbody) return;
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:16px">No users yet</td></tr>`; return; }
    tbody.innerHTML = list.map(u => `
      <tr>
        <td>${u.email}</td>
        <td><span class="badge ${u.approved ? "green" : "red"}">${u.approved ? "Approved" : "Revoked"}</span></td>
        <td>
          ${u.approved
            ? `<button class="btn sm danger" data-revoke="${u.email}">Revoke</button>`
            : `<button class="btn sm" data-reapprove="${u.email}">Re-approve</button>`}
        </td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-revoke]").forEach(b =>
      b.addEventListener("click", () => revokeUser(b.dataset.revoke)));
    tbody.querySelectorAll("[data-reapprove]").forEach(b =>
      b.addEventListener("click", () => approveUser(b.dataset.reapprove)));
  }

  function renderAudit(list) {
    const tbody = document.querySelector("#auditTable tbody");
    if (!tbody) return;
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:16px">No audit entries yet</td></tr>`; return; }
    tbody.innerHTML = list.map(a => {
      const ts = a.at?.toDate ? a.at.toDate().toLocaleString() : "(pending)";
      const detail = [a.userName, a.processName, a.targetEmail, a.count != null ? `${a.count} records` : null]
        .filter(Boolean).join(" · ");
      return `<tr>
        <td>${ts}</td>
        <td>${a.userEmail || ""}</td>
        <td><span class="badge ${a.action === "delete" || a.action === "user_revoke" || a.action === "clear_all" ? "red" : a.action === "create" || a.action === "user_approve" ? "green" : "amber"}">${a.action}</span></td>
        <td>${detail || (a.recordId || "")}</td>
      </tr>`;
    }).join("");
  }

  window.__initAdminPanel = function () {
    if (!window.__session.isAdmin) return;
    if (initialized) return;
    initialized = true;

    // wire add-user form
    const addBtn = document.getElementById("btnAddUser");
    if (addBtn) addBtn.addEventListener("click", () => {
      const v = document.getElementById("newUserEmail").value;
      approveUser(v);
    });

    // realtime users
    unsubUsers = onSnapshot(collection(db, "approved_users"), snap => {
      const list = snap.docs.map(d => d.data()).sort((a,b) => (a.email||"").localeCompare(b.email||""));
      renderUsers(list);
    }, err => console.error("users sync", err));

    // realtime audit (latest 200)
    const q = query(collection(db, "audit_log"), orderBy("at", "desc"), limit(200));
    unsubAudit = onSnapshot(q, snap => {
      renderAudit(snap.docs.map(d => d.data()));
    }, err => console.error("audit sync", err));
  };
})();
/* ==================== CAPA REGISTER ==================== */
(function () {
  "use strict";

  const CAPA_COLLECTION = "capa_records";
  let capaRecords = [];
  let unsubCapa = null;

  const CAPA_FIELDS = [
    { id: "capaId",          label: "CAPA ID" },
    { id: "relatedNcId",     label: "Related NC ID" },
    { id: "auditRef",        label: "Assessment/Audit Reference" },
    { id: "type",            label: "CAPA Type" },
    { id: "rcCategory",      label: "RC Category" },
    { id: "rcSummary",       label: "RC Summary" },
    { id: "description",     label: "CAPA Description" },
    { id: "owner",           label: "Owner" },
    { id: "accountable",     label: "Accountable" },
    { id: "startDate",       label: "Start Date" },
    { id: "completionDate",  label: "Completion Date" },
    { id: "status",          label: "Status" },
    { id: "daysOverdue",     label: "Days Overdue" },
    { id: "evidence",        label: "Required Evidence" },
    { id: "effCriteria",     label: "Effectiveness Criteria" },
    { id: "effStatus",       label: "Effectiveness Status" },
    { id: "closureDate",     label: "Closure Date" },
  ];

  const $ = (id) => document.getElementById(id);
  const escH = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  function toastMsg(msg) {
    const el = $("toast"); if (!el) return;
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function isAdminNow() { return !!(window.__session && window.__session.isAdmin); }
  function currentEmailNow() { return (window.__session && window.__session.email) || "(unknown)"; }

  /* ---------- Filters ---------- */
  function getFilteredCapa() {
    const q = ($("capaFilterSearch")?.value || "").toLowerCase().trim();
    const type = $("capaFilterType")?.value || "";
    const status = ($("capaFilterStatus")?.value || "").toLowerCase();
    const eff = ($("capaFilterEffectiveness")?.value || "").toLowerCase();
    const owner = ($("capaFilterOwner")?.value || "").toLowerCase().trim();
    return capaRecords.filter(r => {
      if (type && (r.type || "").toLowerCase() !== type.toLowerCase()) return false;
      if (status && !(r.status || "").toLowerCase().includes(status)) return false;
      if (eff && !(r.effStatus || "").toLowerCase().includes(eff)) return false;
      if (owner && !(r.owner || "").toLowerCase().includes(owner)) return false;
      if (!q) return true;
      return CAPA_FIELDS.some(f => String(r[f.id] || "").toLowerCase().includes(q));
    });
  }

  /* ---------- Render table ---------- */
  function renderCapa() {
    const tbody = document.querySelector("#capaTable tbody");
    if (!tbody) return;
    const data = getFilteredCapa();
    $("capaCount").textContent = `${data.length} CAPA record(s)`;
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="18" style="text-align:center;color:var(--muted);padding:24px">No CAPA records. Click “+ New CAPA” to add one.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${escH(r.capaId)}</td>
        <td>${escH(r.relatedNcId)}</td>
        <td class="wrap">${escH(r.auditRef)}</td>
        <td>${escH(r.type)}</td>
        <td>${escH(r.rcCategory)}</td>
        <td class="wrap">${escH(r.rcSummary)}</td>
        <td class="wrap">${escH(r.description)}</td>
        <td>${escH(r.owner)}</td>
        <td>${escH(r.accountable)}</td>
        <td>${escH(r.startDate)}</td>
        <td>${escH(r.completionDate)}</td>
        <td>${escH(r.status)}</td>
        <td>${escH(r.daysOverdue)}</td>
        <td class="wrap">${escH(r.evidence)}</td>
        <td class="wrap">${escH(r.effCriteria)}</td>
        <td>${escH(r.effStatus)}</td>
        <td>${escH(r.closureDate)}</td>
        <td>
          <button class="btn sm" data-capa-edit="${r.id}">Edit</button>
          ${isAdminNow() ? `<button class="btn sm danger" data-capa-del="${r.id}">Del</button>` : ""}
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-capa-edit]").forEach(b =>
      b.addEventListener("click", () => openCapaModal(b.dataset.capaEdit)));
    tbody.querySelectorAll("[data-capa-del]").forEach(b =>
      b.addEventListener("click", () => deleteCapa(b.dataset.capaDel)));
  }

  /* ---------- Modal / form ---------- */
  function openCapaModal(id) {
    const modal = $("capaModal");
    const title = $("capaModalTitle");
    $("capaForm").reset();
    $("capaId_hidden").value = "";
    if (id) {
      const r = capaRecords.find(x => x.id === id);
      if (r) {
        title.textContent = "Edit CAPA";
        $("capaId_hidden").value = r.id;
        CAPA_FIELDS.forEach(f => {
          const el = $("capa_" + f.id);
          if (el) el.value = r[f.id] || "";
        });
      }
    } else {
      title.textContent = "New CAPA";
    }
    modal.style.display = "flex";
  }
  function closeCapaModal() { $("capaModal").style.display = "none"; }

  $("btnCapaNew")?.addEventListener("click", () => openCapaModal());
  $("capaModalClose")?.addEventListener("click", closeCapaModal);
  $("capaModal")?.addEventListener("click", (e) => { if (e.target.id === "capaModal") closeCapaModal(); });
  $("capaFormReset")?.addEventListener("click", () => {
    $("capaForm").reset();
    $("capaId_hidden").value = "";
  });

  $("capaForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("capaId_hidden").value || uid();
    const rec = { id };
    CAPA_FIELDS.forEach(f => {
      const el = $("capa_" + f.id);
      rec[f.id] = el ? String(el.value || "").trim() : "";
    });
    const existing = capaRecords.find(x => x.id === id);
    const isNew = !existing;
    rec.updatedBy = currentEmailNow();
    rec.updatedAt = new Date().toISOString();
    if (isNew) {
      rec.createdBy = currentEmailNow();
      rec.createdAt = rec.updatedAt;
    } else {
      rec.createdBy = existing.createdBy || currentEmailNow();
      rec.createdAt = existing.createdAt || rec.updatedAt;
    }
    try {
      await setDoc(doc(db, CAPA_COLLECTION, id), rec);
      await window.__writeAudit?.(isNew ? "create" : "update", id, { capaId: rec.capaId, type: rec.type });
      closeCapaModal();
      toastMsg("CAPA saved");
    } catch (err) {
      console.error(err); toastMsg("Save failed: " + (err.message || err.code));
    }
  });

  async function deleteCapa(id) {
    if (!isAdminNow()) { toastMsg("Only admins can delete CAPA records"); return; }
    if (!confirm("Delete this CAPA record?")) return;
    const r = capaRecords.find(x => x.id === id);
    try {
      await deleteDoc(doc(db, CAPA_COLLECTION, id));
      await window.__writeAudit?.("delete", id, { capaId: r?.capaId });
      toastMsg("CAPA deleted");
    } catch (err) { console.error(err); toastMsg("Delete failed"); }
  }

  $("btnCapaClearAll")?.addEventListener("click", async () => {
    if (!isAdminNow()) { toastMsg("Only admins can clear all CAPA records"); return; }
    if (!capaRecords.length) return;
    if (!confirm("Delete ALL CAPA records? This cannot be undone.")) return;
    try {
      const batch = writeBatch(db);
      const toDelete = capaRecords.slice();
      toDelete.forEach(r => batch.delete(doc(db, CAPA_COLLECTION, r.id)));
      await batch.commit();
      await window.__writeAudit?.("clear_all", null, { count: toDelete.length, scope: "capa" });
      toastMsg("All CAPA records cleared");
    } catch (err) { console.error(err); toastMsg("Clear failed"); }
  });

  /* ---------- Filters wiring ---------- */
  ["capaFilterSearch","capaFilterType","capaFilterStatus","capaFilterEffectiveness","capaFilterOwner"]
    .forEach(id => $(id)?.addEventListener("input", renderCapa));
  $("capaClearFilters")?.addEventListener("click", () => {
    ["capaFilterSearch","capaFilterType","capaFilterStatus","capaFilterEffectiveness","capaFilterOwner"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderCapa();
  });

  /* ---------- Export to Excel ---------- */
  $("btnCapaExportExcel")?.addEventListener("click", () => {
    const data = getFilteredCapa();
    if (!data.length) return toastMsg("No CAPA records to export");
    if (typeof XLSX === "undefined") return toastMsg("Excel library not loaded");
    const headers = CAPA_FIELDS.map(f => f.label);
    const rows = data.map(r => CAPA_FIELDS.map(f => r[f.id] || ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map(h => ({ wch: Math.max(14, Math.min(40, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CAPA Register");
    XLSX.writeFile(wb, `capa-register-${new Date().toISOString().slice(0,10)}.xlsx`);
    toastMsg(`Exported ${data.length} CAPA record(s)`);
  });

  /* ---------- Export to PDF ---------- */
  $("btnCapaExportPdf")?.addEventListener("click", async () => {
    const data = getFilteredCapa();
    if (!data.length) return toastMsg("No CAPA records to export");
    try {
      toastMsg("Generating PDF…");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;

      // Header
      pdf.setFontSize(14); pdf.setTextColor(33,33,33);
      pdf.text("IDH — CAPA Register / Master Log", margin, margin + 4);
      pdf.setFontSize(9); pdf.setTextColor(107,114,128);
      pdf.text(`Exported ${new Date().toLocaleString()} · ${data.length} record(s)`, margin, margin + 20);

      // Build offscreen table for capture (so we keep all columns)
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;padding:12px;font-family:Arial,sans-serif;";
      const tbl = document.createElement("table");
      tbl.style.cssText = "border-collapse:collapse;font-size:10px;";
      const thead = `<tr>${CAPA_FIELDS.map(f => `<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:4px 6px;text-align:left;color:#334155;font-weight:600;">${escH(f.label)}</th>`).join("")}</tr>`;
      const tbody = data.map(r => `<tr>${CAPA_FIELDS.map(f => `<td style="border:1px solid #e2e8f0;padding:4px 6px;color:#1f2937;vertical-align:top;max-width:180px;word-wrap:break-word;">${escH(r[f.id] || "")}</td>`).join("")}</tr>`).join("");
      tbl.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
      wrap.appendChild(tbl);
      document.body.appendChild(wrap);

      const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: "#ffffff", logging: false });
      document.body.removeChild(wrap);

      const imgW = pageW - margin * 2;
      const usableH = pageH - margin - 50;
      const imgH = canvas.height * (imgW / canvas.width);
      const img = canvas.toDataURL("image/jpeg", 0.92);

      if (imgH <= usableH) {
        pdf.addImage(img, "JPEG", margin, margin + 36, imgW, imgH);
      } else {
        const pageCanvas = document.createElement("canvas");
        const pageCtx = pageCanvas.getContext("2d");
        const sliceHpx = usableH * (canvas.width / imgW);
        pageCanvas.width = canvas.width;
        let y = 0, first = true;
        while (y < canvas.height) {
          const h = Math.min(sliceHpx, canvas.height - y);
          pageCanvas.height = h;
          pageCtx.fillStyle = "#fff";
          pageCtx.fillRect(0, 0, pageCanvas.width, h);
          pageCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
          const slice = pageCanvas.toDataURL("image/jpeg", 0.92);
          if (!first) { pdf.addPage(); }
          pdf.addImage(slice, "JPEG", margin, margin + (first ? 36 : 12), imgW, h * (imgW / canvas.width));
          y += h; first = false;
        }
      }
      pdf.save(`capa-register-${new Date().toISOString().slice(0,10)}.pdf`);
      toastMsg("PDF downloaded");
    } catch (err) {
      console.error(err); toastMsg("PDF export failed");
    }
  });

  /* ---------- Realtime sync (start/stop with auth) ---------- */
  function startCapaSync() {
    if (unsubCapa) return;
    unsubCapa = onSnapshot(collection(db, CAPA_COLLECTION), snap => {
      capaRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => String(a.capaId || "").localeCompare(String(b.capaId || "")));
      renderCapa();
    }, err => {
      console.error("capa sync", err);
      toastMsg("CAPA sync error: " + (err.message || err.code));
    });
  }
  function stopCapaSync() {
    if (unsubCapa) { unsubCapa(); unsubCapa = null; }
    capaRecords = []; renderCapa();
  }

  // Hook into auth state changes (auth already initialized at top of file)
  observeAuthState((user) => {
    if (user) startCapaSync(); else stopCapaSync();
  });

  // Render once on load (empty)
  renderCapa();
})();
