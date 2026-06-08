/* Document Control module — self-contained, localStorage-persisted.
   Features: KPI cards, search/filter/sort, Add/Edit/Delete/History, version bump on edit. */

const LS_KEY = "dc_documents_v1";
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const todayISO = () => new Date().toISOString().slice(0,10);
const uid = () => "d_" + Math.random().toString(36).slice(2,10);

let DOCS = load();
let editingId = null;

function load(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(DOCS)); }

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
  sel.innerHTML = `<option value="">All Departments</option>` +
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
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#6b7280;padding:24px">No documents match the filters.</td></tr>`;
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
      : `<span class="link-open disabled">Open</span>`;
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
function openModal(doc){
  editingId = doc ? doc.id : null;
  const form = document.getElementById("dcForm");
  form.reset();
  document.getElementById("dcModalTitle").textContent = doc ? "Edit Document" : "Add Document";
  document.getElementById("dcSaveBtn").textContent = doc ? "Save Changes" : "Create Document";
  if (doc){
    Object.entries(doc).forEach(([k,v])=>{
      const el = form.elements[k];
      if (el && v!=null) el.value = v;
    });
  } else {
    form.elements["version"].value = "1.0";
    form.elements["status"].value = "Draft";
  }
  document.getElementById("dcModal").classList.add("open");
}
function closeModal(){
  document.getElementById("dcModal").classList.remove("open");
  editingId = null;
}

function bumpVersion(v){
  const m = String(v||"1.0").match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return "1.1";
  const major = parseInt(m[1]||"1",10);
  const minor = parseInt(m[2]||"0",10) + 1;
  return `${major}.${minor}`;
}

function handleSubmit(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  const now = new Date().toISOString();
  if (editingId){
    const idx = DOCS.findIndex(x=>x.id===editingId);
    if (idx<0) return;
    const prev = DOCS[idx];
    const history = prev.history || [];
    // Snapshot previous state
    history.push({
      version: prev.version,
      status: prev.status,
      updatedAt: prev.updatedAt,
      changeDescription: prev.changeDescription || "",
      remarks: prev.remarks || "",
      preparedBy: prev.preparedBy || "",
      reviewedBy: prev.reviewedBy || "",
      approvedBy: prev.approvedBy || "",
    });
    const versionChanged = data.version && data.version !== prev.version;
    DOCS[idx] = {
      ...prev,
      ...data,
      version: versionChanged ? data.version : bumpVersion(prev.version),
      updatedAt: now,
      history,
    };
  } else {
    DOCS.push({
      id: uid(),
      ...data,
      createdAt: now,
      updatedAt: now,
      history: [],
    });
  }
  save();
  renderAll();
  closeModal();
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
  document.getElementById("dcHistoryModal").classList.add("open");
}

/* ---------- Wire up ---------- */
function init(){
  if (!document.getElementById("documentControl")) return;
  document.getElementById("dcBtnAdd")?.addEventListener("click", ()=>openModal(null));
  document.getElementById("dcCancel")?.addEventListener("click", closeModal);
  document.getElementById("dcForm")?.addEventListener("submit", handleSubmit);
  document.getElementById("dcHistoryClose")?.addEventListener("click", ()=>{
    document.getElementById("dcHistoryModal").classList.remove("open");
  });
  ["dcSearch","dcFilterDept","dcFilterType","dcFilterStatus","dcSort"].forEach(id=>{
    const el = document.getElementById(id);
    el?.addEventListener("input", renderTable);
    el?.addEventListener("change", renderTable);
  });
  document.querySelector("#dcTable")?.addEventListener("click", (e)=>{
    const t = e.target.closest("button");
    if (!t) return;
    const editId = t.getAttribute("data-dc-edit");
    const delId  = t.getAttribute("data-dc-del");
    const hisId  = t.getAttribute("data-dc-history");
    if (editId){ const d=DOCS.find(x=>x.id===editId); if(d) openModal(d); }
    else if (delId){
      if (confirm("Delete this document?")){
        DOCS = DOCS.filter(x=>x.id!==delId);
        save(); renderAll();
      }
    }
    else if (hisId){ openHistory(hisId); }
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
