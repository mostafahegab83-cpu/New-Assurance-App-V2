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
import {
  db, auth, ADMIN_EMAILS,
  collection, doc, setDoc, deleteDoc, addDoc,
  onSnapshot, writeBatch, serverTimestamp,
  onAuthStateChanged
} from "./firebase.js";

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
    fillSelect("piFilterCompany", "All Companies",  [...companies].sort());
    fillSelect("piFilterDept",    "All Departments",[...depts].sort());
    fillSelect("piFilterType",    "All Types",      [...types].sort());
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

  function renderTable() {
    const tbody = $("piTableBody"); if (!tbody) return;
    refreshFilterOptions();

    if (piSyncState === "error") {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#b91c1c;padding:24px;white-space:normal;">${esc(piSyncMessage)}</td></tr>`;
      const pager = $("piPager");
      if (pager) pager.innerHTML = "";
      return;
    }

    if (piSyncState === "loading") {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#6b7280;padding:24px;">${esc(piSyncMessage)}</td></tr>`;
      const pager = $("piPager");
      if (pager) pager.innerHTML = "";
      return;
    }

    const rows = sortRows(getFiltered());
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PI_PAGE_SIZE));
    if (piPage > pages) piPage = pages;
    const start = (piPage - 1) * PI_PAGE_SIZE;
    const pageRows = rows.slice(start, start + PI_PAGE_SIZE);

    if (!pageRows.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#6b7280;padding:24px">No processes found.</td></tr>`;
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
        return `<tr>
          <td>${esc(r.documentTitle)}</td>
          <td>${esc(r.documentType)}</td>
          <td>${esc(r.documentCode)}</td>
          <td>${esc(r.issueNo)}</td>
          <td>${esc(r.issueDate)}</td>
          ${coCells}
          <td>${esc(r.department)} ${moreBtn}</td>
          <td style="white-space:nowrap;">
            <button class="btn sm" data-pi-edit="${r.id}">Edit</button>
            ${isAdminNow() ? `<button class="btn sm danger" data-pi-del="${r.id}">Del</button>` : ""}
          </td>
        </tr>`;
      }).join("");
    }

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
          department:    String(row["Department"]     || row["department"]    || "").trim(),
          company:       String(row["Company Name"]   || row["companyName"] || row["Company"] || "").trim()
        };
        if (!rec.documentTitle || !rec.documentCode || !rec.department) { summary.errors++; continue; }
        const key = matchKey(rec);
        const existing = localMap.get(key);
        if (existing) {
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
            issueDate: rec.issueDate, department: rec.department,
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
            issueDate: rec.issueDate, department: rec.department,
            companies: rec.companies,
            createdBy: email, createdAt: serverTimestamp(),
            updatedBy: email, updatedAt: serverTimestamp()
          });
          summary.created++;
        } else if (rec._dirty && rec.id) {
          await setDoc(doc(db, PI_COLLECTION, rec.id), {
            companies: rec.companies,
            updatedBy: email, updatedAt: serverTimestamp()
          }, { merge: true });
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
          "Document Title": r.documentTitle || "",
          "Document Type":  r.documentType  || "",
          "Document Code":  r.documentCode  || "",
          "Issue No":       r.issueNo       || "",
          "Issue Date":     r.issueDate     || "",
          "Company Name":   c || "",
          "Department":     r.department    || ""
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Document Title","Document Type","Document Code","Issue No","Issue Date","Company Name","Department"]
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

    $("piCompaniesClose")?.addEventListener("click", () => {
      $("piCompaniesModal").style.display = "none";
    });

    // Table row actions (event delegation)
    $("piTableBody")?.addEventListener("click", e => {
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
