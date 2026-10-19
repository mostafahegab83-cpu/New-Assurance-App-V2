/* Document Control module — Firestore + Firebase Storage backed.
   Documents live in Firestore collection "dc_documents".
   File attachments live in Firebase Storage under "dc_documents/{docId}/{timestamp}_{name}".
   No more localStorage / no base64 — quota errors are gone and data syncs across devices. */

import {
  db, storage, auth,
  collection, doc, setDoc, getDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy,
  ref, uploadBytes, getDownloadURL, deleteObject,
  onAuthStateChanged
} from "./firebase.js";

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
