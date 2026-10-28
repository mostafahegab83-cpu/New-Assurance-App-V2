/* ===== findings-engine.js (merged) ===== */
/* =============================================================================
 * Automated Findings Engine — Process Assurance Tracker
 * -----------------------------------------------------------------------------
 * Produces a Findings × Recommended Action table.
 *
 * Auto-generated findings (4 categories):
 *   1) Non-Compliance — NC number, percentage and leading reason
 *   2) SLA Adherence — adherence % and End Variance (days) if applicable
 *   3) CAPA — number, status mix and effectiveness
 *   4) Risk — number, type, level and mitigation status
 *
 * User editing:
 *   - Each auto-generated row can be edited (text override saved to
 *     localStorage and re-applied on every refresh).
 *   - A "Reset" action restores the auto-generated text for that row.
 *   - "Add Finding" creates an a custom row (category + finding + action) that
 *     also persists to localStorage.
 *   - Custom rows can be edited or deleted.
 *
 * Singular vs plural ("is" vs "are") is handled based on the item count.
 * Exposed globally as window.FindingsEngine.
 * ============================================================================= */
(function (global) {
  "use strict";

  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const isNc = r => {
    const c = String(r.compliance || "").toLowerCase();
    return c.includes("non-compliant") || c.includes("partially") || c.includes("observation");
  };
  const groupBy = (rows, key) => rows.reduce((acc, r) => {
    const k = (r[key] == null || r[key] === "") ? "" : String(r[key]).trim();
    if (!k || k === "N/A") return acc;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const topEntry = obj => {
    let bestK = null, bestV = 0, total = 0;
    Object.entries(obj).forEach(([k, v]) => { total += v; if (v > bestV) { bestV = v; bestK = k; } });
    return { key: bestK, count: bestV, total, share: total ? (bestV / total) * 100 : 0 };
  };
  const diffDays = (a, b) => {
    if (!a || !b) return null;
    const da = new Date(a), db = new Date(b);
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  };
  // Grammar helpers — singular vs plural
  const isAre = n => Number(n) === 1 ? "is" : "are";
  const sPl = (n, s) => Number(n) === 1 ? s : (s + "s");
  const hasHave = n => Number(n) === 1 ? "has" : "have";
  const MAX_WORDS_PER_LINE = 12;
  const escapeHtml = text => String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const wrapWords = (text, maxWords = MAX_WORDS_PER_LINE) => {
    const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const lines = [];
    for (let i = 0; i < words.length; i += maxWords) {
      lines.push(words.slice(i, i + maxWords).join(" "));
    }
    return lines.map(line => escapeHtml(line)).join("<br>");
  };
  const CELL_TEXT_STYLE = [
    "display:block",
    "width:100%",
    "max-width:100%",
    "white-space:normal",
    "overflow:visible",
    "text-overflow:clip",
    "overflow-wrap:anywhere",
    "word-wrap:break-word",
    "word-break:break-word",
    "line-break:anywhere",
    "hyphens:auto",
    "line-height:1.5"
  ].join(";");

  /* ---------- Persistence (localStorage) ---------- */
  const LS_OVERRIDES = "pa_findings_overrides_v1"; // { [category]: { finding, action } }
  const LS_CUSTOM    = "pa_findings_custom_v1";    // [ { id, category, finding, action } ]

  const safeParse = (raw, fallback) => {
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  };
  const loadOverrides = () => safeParse(localStorage.getItem(LS_OVERRIDES), {}) || {};
  const saveOverrides = obj => { try { localStorage.setItem(LS_OVERRIDES, JSON.stringify(obj || {})); } catch (_) {} };
  const loadCustom = () => {
    const v = safeParse(localStorage.getItem(LS_CUSTOM), []);
    return Array.isArray(v) ? v : [];
  };
  const saveCustom = arr => { try { localStorage.setItem(LS_CUSTOM, JSON.stringify(arr || [])); } catch (_) {} };
  const uid = () => "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Builders for the 4 findings ---------- */

  function ncFinding(records) {
    const ncRows = records.filter(isNc);
    const total = records.length;
    const n = ncRows.length;
    if (!n) {
      return {
        finding: "No non-compliance items were recorded in the reviewed scope.",
        action: "Continue routine monitoring and maintain current control activities."
      };
    }
    const sharePct = pct(n, total);
    const reasons = groupBy(ncRows, "complianceReason");
    const t = topEntry(reasons);
    const reasonTxt = t.key
      ? ` The leading reason ${isAre(t.count)} "${t.key}" (${t.count} of ${t.total}, ${t.share.toFixed(1)}%).`
      : "";
    const ncWord = sPl(n, "non-compliance item");
    const finding =
      `${n} ${ncWord} ${isAre(n)} recorded, representing ${sharePct}% of the ${total} reviewed ${sPl(total, "record")}.${reasonTxt}`;
    const action = t.key
      ? `Target the "${t.key}" reason with a focused corrective action and reinforce the related control to reduce recurrence.`
      : `Investigate the recorded non-compliance and implement a corrective action to address the underlying cause.`;
    return { finding, action };
  }

  function slaFinding(records) {
    // SLA is measured on Done tasks with recorded timing; "Late SLA" is a breach.
    const lc = v => String(v || "").trim().toLowerCase();
    const slaRows = records.filter(r => lc(r.taskDone) === "done" && ["on time", "late sla"].includes(lc(r.taskTiming)));
    if (!slaRows.length) {
      return {
        finding: "No SLA measurements were available in the reviewed scope.",
        action: "Record task timing (On Time / Late SLA) for Done tasks to enable adherence monitoring."
      };
    }
    const adherent = slaRows.filter(r => lc(r.taskTiming) === "on time").length;
    const adherencePct = Math.round((adherent / slaRows.length) * 100);

    // End Variance (days) — derive from planned vs actual end dates if present
    const varRows = records
      .map(r => ({ phase: (r.processPhase || "").trim(), v: diffDays(r.plannedEndDate, r.actualEndDate) }))
      .filter(x => x.v != null);
    const variances = varRows.map(x => x.v);
    let varianceTxt = "";
    let actionVar = "";
    let worstPhase = null;
    if (variances.length) {
      const late = varRows.filter(x => x.v > 0);
      if (late.length) {
        const worst = late.reduce((a, b) => (b.v > a.v ? b : a));
        const maxV = worst.v;
        worstPhase = worst.phase || null;
        const stepWord = sPl(late.length, "step");
        const phaseTxt = worstPhase
          ? `, with "${worstPhase}" as the main delayed phase`
          : "";
        varianceTxt = ` End Variance shows ${late.length} ${stepWord} finishing late by up to ${maxV} ${sPl(maxV, "day")}${phaseTxt}.`;
        actionVar = worstPhase
          ? ` Address the delay in the "${worstPhase}" phase (worst case ${maxV} ${sPl(maxV, "day")}) by reviewing execution capacity and removing bottlenecks in that phase.`
          : ` Address the ${late.length === 1 ? "delayed step" : "delayed steps"} (worst case ${maxV} ${sPl(maxV, "day")}) by reviewing execution capacity and removing bottlenecks.`;
      } else {
        varianceTxt = ` End Variance shows all measured ${sPl(variances.length, "step")} finished on or before the planned end date.`;
      }
    }
    const sample = slaRows.length;
    const finding =
      `SLA adherence ${isAre(1)} at ${adherencePct}% across ${sample} measured ${sPl(sample, "step")}.${varianceTxt}`;
    const action = adherencePct < 85
      ? `Improve SLA performance by reviewing the breached ${sPl(sample - adherent, "step")} and reinforcing turnaround controls.${actionVar}`
      : `Maintain current SLA performance and continue tracking turnaround on each step.${actionVar}`;
    return { finding, action };
  }

  function capaFinding(records) {
    const capa = records.filter(r => r.capaNeeded === "Yes");
    const n = capa.length;
    if (!n) {
      return {
        finding: "No CAPA actions were required for the reviewed scope.",
        action: "Continue monitoring; raise a CAPA when a future non-compliance requires corrective action."
      };
    }
    const status = groupBy(capa, "capaStatus");
    const closed = status["Closed"] || 0;
    const open = (status["In Progress"] || 0) + (status["Pending"] || 0) + (status["Overdue"] || 0);
    const overdue = status["Overdue"] || 0;
    const effective = capa.filter(r => r.effectiveness === "Effective").length;
    const partially = capa.filter(r => r.effectiveness === "Partially Effective").length;
    const ineffective = capa.filter(r => r.effectiveness === "Ineffective").length;
    const effPct = Math.round((effective / n) * 100);

    const capaWord = sPl(n, "CAPA action");
    const statusBits = [];
    if (closed) statusBits.push(`${closed} closed`);
    if (open) statusBits.push(`${open} open`);
    if (overdue) statusBits.push(`${overdue} overdue`);
    const statusTxt = statusBits.length ? ` Status: ${statusBits.join(", ")}.` : "";
    const effBits = [];
    if (effective) effBits.push(`${effective} effective`);
    if (partially) effBits.push(`${partially} partially effective`);
    if (ineffective) effBits.push(`${ineffective} ineffective`);
    const effTxt = effBits.length ? ` Effectiveness: ${effBits.join(", ")} (${effPct}% effective).` : "";

    const finding = `${n} ${capaWord} ${isAre(n)} recorded.${statusTxt}${effTxt}`;
    let action;
    if (overdue > 0) {
      action = `Escalate the ${overdue === 1 ? "overdue CAPA" : `${overdue} overdue CAPAs`} to the action owner and set a firm closure date.`;
    } else if (open > 0) {
      action = `Drive the ${open === 1 ? "open CAPA" : `${open} open CAPAs`} to closure within the agreed timeline and verify effectiveness on closure.`;
    } else if (ineffective + partially > 0) {
      action = `Re-open the ${(ineffective + partially) === 1 ? "ineffective CAPA" : "ineffective CAPAs"} and redesign the corrective action to address the root cause.`;
    } else {
      action = `Sustain CAPA effectiveness by continuing post-closure verification on future actions.`;
    }
    return { finding, action };
  }

  function riskFinding(records) {
    const risks = records.filter(r => r.riskExist === "Yes");
    const n = risks.length;
    if (!n) {
      return {
        finding: "No risks were identified in the reviewed scope.",
        action: "Continue routine risk scanning during process reviews."
      };
    }
    const types = groupBy(risks, "riskType");
    const tType = topEntry(types);
    const levels = groupBy(risks, "riskLevel");
    const high = levels["High"] || 0;
    const medium = levels["Medium"] || 0;
    const low = levels["Low"] || 0;
    const mitOpen = risks.filter(r => r.mitigation === "Open").length;
    const mitClosed = risks.filter(r => r.mitigation === "Closed" || r.mitigation === "Mitigated").length;

    const riskWord = sPl(n, "risk");
    const typeTxt = tType.key
      ? ` The leading type ${isAre(tType.count)} "${tType.key}" (${tType.count} of ${tType.total}).`
      : "";
    const levelBits = [];
    if (high) levelBits.push(`${high} High`);
    if (medium) levelBits.push(`${medium} Medium`);
    if (low) levelBits.push(`${low} Low`);
    const levelTxt = levelBits.length ? ` Level: ${levelBits.join(", ")}.` : "";
    const mitBits = [];
    if (mitClosed) mitBits.push(`${mitClosed} closed/mitigated`);
    if (mitOpen) mitBits.push(`${mitOpen} open`);
    const mitTxt = mitBits.length ? ` Mitigation: ${mitBits.join(", ")}.` : "";

    const finding = `${n} ${riskWord} ${isAre(n)} recorded.${typeTxt}${levelTxt}${mitTxt}`;
    let action;
    if (high > 0 && mitOpen > 0) {
      action = `Prioritise mitigation of the ${high === 1 ? "High-level risk" : `${high} High-level risks`} with an open mitigation and assign a clear action owner.`;
    } else if (mitOpen > 0) {
      action = `Close the ${mitOpen === 1 ? "open risk mitigation" : `${mitOpen} open risk mitigations`} by executing the agreed control and validating residual exposure.`;
    } else if (high > 0) {
      action = `Re-verify the effectiveness of mitigations on the ${high === 1 ? "High-level risk" : `${high} High-level risks`} to confirm residual exposure is acceptable.`;
    } else {
      action = `Maintain current mitigations and continue periodic re-assessment of risk exposure.`;
    }
    return { finding, action };
  }

  /* ---------- Public API ---------- */
  let _lastRecords = [];
  function analyze(records) {
    const rows = Array.isArray(records) ? records : [];
    _lastRecords = rows;
    const auto = [
      { category: "Non-Compliance", ...ncFinding(rows) },
      { category: "SLA Adherence",  ...slaFinding(rows) },
      { category: "CAPA",           ...capaFinding(rows) },
      { category: "Risk",           ...riskFinding(rows) }
    ];

    // Apply per-category overrides while keeping the original auto text
    // available so the user can reset.
    const overrides = loadOverrides();
    const findings = auto.map(f => {
      const ov = overrides[f.category];
      return {
        kind: "auto",
        category: f.category,
        finding: ov && typeof ov.finding === "string" ? ov.finding : f.finding,
        action:  ov && typeof ov.action  === "string" ? ov.action  : f.action,
        autoFinding: f.finding,
        autoAction:  f.action,
        edited: !!ov
      };
    });

    // Append custom user-added findings (processScope preserved for per-filter visibility)
    loadCustom().forEach(c => {
      findings.push({
        kind: "custom",
        id: c.id,
        category: c.category || "Custom",
        finding: c.finding || "",
        action:  c.action  || "",
        processScope: Array.isArray(c.processScope) ? c.processScope.slice() : []
      });
    });

    return {
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      findings,
      summary: findings.map(f => `${f.category}: ${f.finding} Action: ${f.action}`)
    };
  }

  /* ---------- Render ---------- */
  // Track the most recent target so storage-mutating actions can re-render.
  let _lastTarget = null;
  // Map of target element -> options ({ categoryFilter }) so rerenders preserve filtering.
  const _targetOpts = new WeakMap();

  function rerender() {
    if (!_lastTarget) return;
    const opts = _targetOpts.get(_lastTarget) || {};
    render(_lastTarget, analyze(_lastRecords), opts);
  }

  function actionsCellHtml(f) {
    if (f.kind === "custom") {
      return `
        <button type="button" class="fs-btn fs-edit" data-act="edit-custom" data-id="${escapeHtml(f.id)}">Edit</button>
        <button type="button" class="fs-btn fs-del"  data-act="del-custom"  data-id="${escapeHtml(f.id)}">Delete</button>
      `;
    }
    return `
      <button type="button" class="fs-btn fs-edit" data-act="edit-auto" data-cat="${escapeHtml(f.category)}">Edit</button>
      ${f.edited ? `<button type="button" class="fs-btn fs-reset" data-act="reset-auto" data-cat="${escapeHtml(f.category)}">Reset</button>` : ""}
    `;
  }

  function render(targetEl, result, opts) {
    if (!targetEl) return;
    _lastTarget = targetEl;
    _targetOpts.set(targetEl, opts || {});
    const categoryFilter = opts && opts.categoryFilter ? String(opts.categoryFilter) : null;
    const excludeRaw = opts && opts.categoryExclude;
    const excludeSet = excludeRaw
      ? new Set((Array.isArray(excludeRaw) ? excludeRaw : [excludeRaw]).map(s => String(s).toLowerCase()))
      : null;
    const processFilter = opts && Array.isArray(opts.processFilter)
      ? opts.processFilter.map(s => String(s)).filter(Boolean)
      : [];
    let visibleFindings = categoryFilter
      ? result.findings.filter(f => String(f.category).toLowerCase() === categoryFilter.toLowerCase())
      : result.findings;
    if (excludeSet) {
      visibleFindings = visibleFindings.filter(f => !excludeSet.has(String(f.category).toLowerCase()));
    }
    // Custom findings are scoped: only show when current process filter matches
    // the scope captured at creation time. A custom finding with empty scope is
    // global (created with no process filter) and always shown.
    visibleFindings = visibleFindings.filter(f => {
      if (f.kind !== "custom") return true;
      const scope = Array.isArray(f.processScope) ? f.processScope : [];
      if (!scope.length) return true; // global custom finding
      if (!processFilter.length) return false; // scoped finding hidden when no filter applied
      return scope.some(p => processFilter.includes(p));
    });

    const rows = visibleFindings.map(f => `
      <tr data-row-kind="${f.kind}" ${f.kind === "custom" ? `data-row-id="${escapeHtml(f.id)}"` : `data-row-cat="${escapeHtml(f.category)}"`}>
        <td class="fs-cat-cell" style="width:48%; vertical-align:top; padding:12px 14px; border-bottom:1px solid #e5e7eb; white-space:normal; overflow:visible;">
          <strong style="display:block; margin-bottom:6px;">
            ${escapeHtml(f.category)}
            ${f.kind === "custom" ? `<span class="fs-tag" style="margin-left:6px;">Custom</span>` : ""}
            ${f.kind === "auto" && f.edited ? `<span class="fs-tag" style="margin-left:6px;">Edited</span>` : ""}
          </strong>
          <div class="fs-msg" style="${CELL_TEXT_STYLE}">${wrapWords(f.finding)}</div>
        </td>
        <td class="fs-action-cell" style="width:38%; vertical-align:top; padding:12px 14px; border-bottom:1px solid #e5e7eb; white-space:normal; overflow:visible;">
          <div style="${CELL_TEXT_STYLE}">${wrapWords(f.action)}</div>
        </td>
        <td class="fs-tools-cell no-print" style="width:14%; vertical-align:top; padding:12px 14px; border-bottom:1px solid #e5e7eb; text-align:right; white-space:nowrap;">
          ${actionsCellHtml(f)}
        </td>
      </tr>`).join("");

    targetEl.innerHTML = `
      <style>
        #findingsSection .fs-btn{display:inline-block;margin:2px 0 2px 4px;padding:4px 10px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#1f3a8a;cursor:pointer;}
        #findingsSection .fs-btn:hover{background:#f3f4f6;}
        #findingsSection .fs-btn.fs-del{color:#b91c1c;border-color:#fecaca;}
        #findingsSection .fs-btn.fs-reset{color:#6b7280;}
        #findingsSection .fs-btn.fs-add{background:#1f3a8a;color:#fff;border-color:#1f3a8a;padding:6px 12px;}
        #findingsSection .fs-btn.fs-add:hover{background:#172a63;}
        #dashboardCapture.exporting #findingsSection .no-print{display:none !important;}
        @media print{#findingsSection .no-print{display:none !important;}}
        #fsEditorBackdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;}
        #fsEditorBackdrop .fs-modal{background:#fff;border-radius:10px;width:min(560px,92vw);box-shadow:0 10px 30px rgba(0,0,0,.2);padding:18px 20px;}
        #fsEditorBackdrop h4{margin:0 0 12px;font-size:16px;color:#1f3a8a;}
        #fsEditorBackdrop label{display:block;font-size:12px;font-weight:600;color:#374151;margin:10px 0 4px;}
        #fsEditorBackdrop input,#fsEditorBackdrop textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:8px 10px;font:inherit;color:#1f2937;}
        #fsEditorBackdrop textarea{min-height:90px;resize:vertical;}
        #fsEditorBackdrop .fs-modal-actions{margin-top:14px;display:flex;gap:8px;justify-content:flex-end;}
      </style>
      <div class="fs-head" style="width:100%; max-width:100%; overflow:visible;">
        <div>
          <h3 class="dash-section-title" style="margin:0;">Summery</h3>
          <p class="fs-meta">Auto-generated from ${result.recordCount} record(s) · ${new Date(result.generatedAt).toLocaleString()}</p>
        </div>
        <div class="no-print">
          <button type="button" class="fs-btn fs-add" data-act="add-custom">+ Add Finding</button>
        </div>
      </div>
      <table class="fs-table" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse; overflow:visible;">
        <colgroup>
          <col style="width:48%;">
          <col style="width:38%;">
          <col style="width:14%;" class="no-print">
        </colgroup>
        <thead>
          <tr>
            <th style="text-align:left; vertical-align:top; white-space:normal; padding:10px 14px;">Finding</th>
            <th style="text-align:left; vertical-align:top; white-space:normal; padding:10px 14px;">Recommended Action</th>
            <th class="no-print" style="text-align:right; vertical-align:top; padding:10px 14px;">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    bindHandlers(targetEl);
  }

  /* ---------- Inline editor modal ---------- */
  function openEditor({ title, category, finding, action, lockCategory, scopeNote, onSave }) {
    closeEditor();
    const wrap = document.createElement("div");
    wrap.id = "fsEditorBackdrop";
    wrap.innerHTML = `
      <div class="fs-modal" role="dialog" aria-modal="true" aria-labelledby="fsEditorTitle">
        <h4 id="fsEditorTitle">${escapeHtml(title)}</h4>
        ${scopeNote ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:6px;padding:8px 10px;font-size:12px;margin-bottom:6px;">${escapeHtml(scopeNote)}</div>` : ""}
        <label for="fsEdCat">Category</label>
        <input id="fsEdCat" type="text" maxlength="80" value="${escapeHtml(category || "")}" ${lockCategory ? "readonly" : ""}>
        <label for="fsEdFind">Finding</label>
        <textarea id="fsEdFind" maxlength="2000">${escapeHtml(finding || "")}</textarea>
        <label for="fsEdAct">Recommended Action</label>
        <textarea id="fsEdAct" maxlength="2000">${escapeHtml(action || "")}</textarea>
        <div class="fs-modal-actions">
          <button type="button" class="fs-btn" data-act="cancel">Cancel</button>
          <button type="button" class="fs-btn fs-add" data-act="save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const close = () => closeEditor();
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
    wrap.querySelector('[data-act="save"]').addEventListener("click", () => {
      const cat  = wrap.querySelector("#fsEdCat").value.trim();
      const find = wrap.querySelector("#fsEdFind").value.trim();
      const act  = wrap.querySelector("#fsEdAct").value.trim();
      if (!cat)  { alert("Category is required."); return; }
      if (!find) { alert("Finding is required."); return; }
      if (!act)  { alert("Recommended Action is required."); return; }
      onSave({ category: cat, finding: find, action: act });
      close();
    });
    setTimeout(() => wrap.querySelector("#fsEdFind").focus(), 30);
  }
  function closeEditor() {
    const e = document.getElementById("fsEditorBackdrop");
    if (e) e.remove();
  }

  /* ---------- Event handlers ---------- */
  function bindHandlers(targetEl) {
    targetEl.removeEventListener("click", onClick);
    targetEl.addEventListener("click", onClick);
  }
  function onClick(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "add-custom") {
      const targetEl = btn.closest("[id]");
      const opts = targetEl ? (_targetOpts.get(targetEl) || {}) : {};
      const presetCat = opts.categoryFilter || "";
      const scope = Array.isArray(opts.processFilter) ? opts.processFilter.slice() : [];
      openEditor({
        title: "Add Finding",
        category: presetCat,
        finding: "",
        action: "",
        lockCategory: !!presetCat,
        scopeNote: scope.length
          ? `This finding will only appear when the Process filter includes: ${scope.join(", ")}.`
          : `No Process filter is active — this finding will appear for all processes. To scope it to a specific process, select the process in the filter first.`,
        onSave: ({ category, finding, action }) => {
          const list = loadCustom();
          list.push({ id: uid(), category: category || presetCat, finding, action, processScope: scope });
          saveCustom(list);
          rerender();
        }
      });
      return;
    }

    if (act === "edit-auto") {
      const cat = btn.dataset.cat;
      const row = btn.closest("tr");
      const finding = row.querySelector(".fs-cat-cell .fs-msg")?.innerText || "";
      const action  = row.querySelector(".fs-action-cell div")?.innerText || "";
      openEditor({
        title: `Edit Finding — ${cat}`,
        category: cat,
        finding,
        action,
        lockCategory: true,
        onSave: ({ finding, action }) => {
          const ov = loadOverrides();
          ov[cat] = { finding, action };
          saveOverrides(ov);
          rerender();
        }
      });
      return;
    }

    if (act === "reset-auto") {
      const cat = btn.dataset.cat;
      if (!confirm(`Reset "${cat}" to the auto-generated text?`)) return;
      const ov = loadOverrides();
      delete ov[cat];
      saveOverrides(ov);
      rerender();
      return;
    }

    if (act === "edit-custom") {
      const id = btn.dataset.id;
      const list = loadCustom();
      const item = list.find(x => x.id === id);
      if (!item) return;
      openEditor({
        title: "Edit Finding",
        category: item.category,
        finding: item.finding,
        action: item.action,
        lockCategory: false,
        onSave: ({ category, finding, action }) => {
          item.category = category;
          item.finding  = finding;
          item.action   = action;
          saveCustom(list);
          rerender();
        }
      });
      return;
    }

    if (act === "del-custom") {
      const id = btn.dataset.id;
      if (!confirm("Delete this finding?")) return;
      saveCustom(loadCustom().filter(x => x.id !== id));
      rerender();
      return;
    }
  }

  global.FindingsEngine = { analyze, render };
})(window);

;
/* ===== process-inventory-dashboard.js (merged) ===== */
/* Process Inventory Dashboard — executive view.
   Reads data from window.__piRecords (set by process-inventory.js) and
   listens to "pi:records" custom events for live updates. Uses Chart.js
   (already loaded in index.html). Filters are independent from the
   Inventory Searching page.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const charts = {};
  const PALETTE = ["#2563EB","#10B981","#F59E0B","#8B5CF6","#EF4444",
                   "#06B6D4","#4F46E5","#EC4899","#14B8A6","#F97316",
                   "#84CC16","#0EA5E9","#A855F7","#DC2626","#059669"];

  /* ---------- Sub-tabs ---------- */
  function initSubTabs() {
    document.querySelectorAll("#processInventory .pi-subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        const which = btn.dataset.piSub;
        document.querySelectorAll("#processInventory .pi-subtab").forEach(b => b.classList.toggle("active", b === btn));
        $("piPanelSearch").classList.toggle("active", which === "search");
        $("piPanelDash").classList.toggle("active", which === "dash");
        if (which === "dash") setTimeout(render, 30);
      });
    });
  }

  /* ---------- Filters ---------- */
  function refreshFilterOptions(records) {
    const companies = new Set(), depts = new Set(), types = new Set(), issues = new Set();
    records.forEach(r => {
      (r.companies || []).forEach(c => c && companies.add(c));
      if (r.department) depts.add(r.department);
      if (r.documentType) types.add(r.documentType);
      if (r.issueNo != null && r.issueNo !== "") issues.add(String(r.issueNo));
    });
    fillSel("pidCompany", "Company Name", [...companies].sort());
    fillSel("pidDept",    "Department Name", [...depts].sort());
    fillSel("pidType",    "Document Type", [...types].sort());
    fillSel("pidIssue",   "Issue Number", [...issues].sort((a,b)=>Number(a)-Number(b)||a.localeCompare(b)));
  }
  function fillSel(id, ph, vals) {
    const el = $(id); if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${ph}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (vals.includes(cur)) el.value = cur;
  }
  function getFiltered() {
    const all = window.__piRecords || [];
    const q     = norm($("pidSearch")?.value);
    const fCo   = norm($("pidCompany")?.value);
    const fDept = norm($("pidDept")?.value);
    const fType = norm($("pidType")?.value);
    const fIss  = norm($("pidIssue")?.value);
    const fFrom = $("pidFrom")?.value || "";
    const fTo   = $("pidTo")?.value || "";
    return all.filter(r => {
      if (fCo   && !(r.companies || []).some(c => norm(c) === fCo)) return false;
      if (fDept && norm(r.department) !== fDept) return false;
      if (fType && norm(r.documentType) !== fType) return false;
      if (fIss  && norm(r.issueNo) !== fIss) return false;
      if (fFrom && (r.issueDate || "") < fFrom) return false;
      if (fTo   && (r.issueDate || "") > fTo) return false;
      if (!q) return true;
      const hay = [r.documentTitle, r.documentType, r.documentCode, r.issueNo,
                   r.issueDate, r.department, ...(r.companies || [])].map(norm).join(" | ");
      return hay.includes(q);
    });
  }

  /* ---------- Chart helpers ---------- */
  function destroy(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }
  function bar(id, labels, data, opts = {}) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    const colors = opts.color ? labels.map(()=>opts.color) : labels.map((_,i)=>PALETTE[i%PALETTE.length]);
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
      options: { indexAxis: opts.horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { grid: { display: !opts.horizontal } }, y: { grid: { display: opts.horizontal } } } }
    });
  }
  function donut(id, labels, data) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: labels.map((_,i)=>PALETTE[i%PALETTE.length]) }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } } } }
    });
  }
  function line(id, labels, data) {
    destroy(id);
    const ctx = $(id)?.getContext("2d"); if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: PALETTE[1], backgroundColor: "rgba(37,99,235,.12)",
              fill: true, tension: .35, pointBackgroundColor: PALETTE[0] }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } } }
    });
  }

  /* ---------- Aggregations ---------- */
  function ts(r) {
    const v = r.updatedAt || r.createdAt;
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v.seconds) return new Date(v.seconds * 1000);
    const d = new Date(v); return isNaN(d) ? null : d;
  }

  function render() {
    const all = window.__piRecords || [];
    refreshFilterOptions(all);
    const records = getFiltered();
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();

    /* KPIs */
    $("pidKpiTotal").textContent = records.length.toLocaleString();
    const compSet = new Set(); records.forEach(r => (r.companies || []).forEach(c => c && compSet.add(c)));
    $("pidKpiCompanies").textContent = compSet.size;
    const deptSet = new Set(records.map(r => r.department).filter(Boolean));
    $("pidKpiDepts").textContent = deptSet.size;
    const typeSet = new Set(records.map(r => r.documentType).filter(Boolean));
    $("pidKpiTypes").textContent = typeSet.size;
    $("pidKpiTypesSub").textContent = [...typeSet].slice(0,3).join(", ") || "—";

    /* Shared processes KPI (2+ companies) */
    const sharedCount = records.filter(r => (r.companies || []).length >= 2).length;
    const sharedPct = records.length ? ((sharedCount / records.length) * 100).toFixed(1) : 0;
    if ($("pidKpiShared")) $("pidKpiShared").textContent = sharedCount.toLocaleString();
    if ($("pidKpiSharedSub")) $("pidKpiSharedSub").textContent = `${sharedPct}% shared by 2+ companies`;

    /* Processes by Company */
    const byCo = {}; records.forEach(r => (r.companies || []).forEach(c => { if (c) byCo[c] = (byCo[c]||0)+1; }));
    const coEntries = Object.entries(byCo).sort((a,b)=>b[1]-a[1]).slice(0,10);
    bar("pidChartCompany", coEntries.map(x=>x[0]), coEntries.map(x=>x[1]), { horizontal: true });

    /* Document Type Distribution */
    const byType = {}; records.forEach(r => { const t = r.documentType || "—"; byType[t]=(byType[t]||0)+1; });
    const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
    donut("pidChartType", typeEntries.map(x=>x[0]), typeEntries.map(x=>x[1]));

    /* Processes by Department */
    const byDept = {}; records.forEach(r => { const d = r.department || "—"; byDept[d]=(byDept[d]||0)+1; });
    const deptEntries = Object.entries(byDept).sort((a,b)=>b[1]-a[1]);
    donut("pidChartDept", deptEntries.map(x=>x[0]), deptEntries.map(x=>x[1]));

    /* Document Revision Status by Issue No */
    const buckets = { "Issue 1":0, "Issue 2":0, "Issue 3":0, "Issue 4":0, "Issue 5+":0 };
    records.forEach(r => {
      const n = parseInt(r.issueNo, 10);
      if (!isNaN(n)) {
        if (n <= 1) buckets["Issue 1"]++;
        else if (n === 2) buckets["Issue 2"]++;
        else if (n === 3) buckets["Issue 3"]++;
        else if (n === 4) buckets["Issue 4"]++;
        else buckets["Issue 5+"]++;
      }
    });
    donut("pidChartIssue", Object.keys(buckets), Object.values(buckets));

    /* Shared Processes Across Companies */
    const sharedBuckets = {"1":0,"2":0,"3":0,"4":0,"5+":0};
    records.forEach(r => {
      const n = (r.companies || []).length;
      if (n <= 1) sharedBuckets["1"]++;
      else if (n === 2) sharedBuckets["2"]++;
      else if (n === 3) sharedBuckets["3"]++;
      else if (n === 4) sharedBuckets["4"]++;
      else sharedBuckets["5+"]++;
    });
    bar("pidChartShared", ["1 Company","2 Companies","3 Companies","4 Companies","5+ Companies"],
        Object.values(sharedBuckets));

    /* Company Standardization % (shared / total per company) */
    const totalPerCo = {}, sharedPerCo = {};
    records.forEach(r => {
      const cos = r.companies || [];
      const isShared = cos.length >= 2;
      cos.forEach(c => {
        if (!c) return;
        totalPerCo[c] = (totalPerCo[c] || 0) + 1;
        if (isShared) sharedPerCo[c] = (sharedPerCo[c] || 0) + 1;
      });
    });
    const stdEntries = Object.keys(totalPerCo)
      .map(c => [c, totalPerCo[c] ? Math.round(((sharedPerCo[c]||0)/totalPerCo[c])*100) : 0])
      .sort((a,b)=>b[1]-a[1]).slice(0,10);
    bar("pidChartStd", stdEntries.map(x=>x[0]), stdEntries.map(x=>x[1]));

    /* Trend */
    renderTrend(records);

    /* Documents by Year */
    const byYear = {};
    records.forEach(r => {
      const yr = (r.issueDate || "").slice(0,4);
      if (/^\d{4}$/.test(yr)) byYear[yr] = (byYear[yr]||0)+1;
    });
    const yEntries = Object.entries(byYear).sort((a,b)=>a[0].localeCompare(b[0]));
    bar("pidChartYear", yEntries.map(x=>x[0]), yEntries.map(x=>x[1]));








    /* Insights */
    const shared2plus = records.filter(r => (r.companies||[]).length >= 2).length;
    const pct2plus = records.length ? Math.round((shared2plus/records.length)*100) : 0;
    const shared3plus = records.filter(r => (r.companies||[]).length >= 3).length;
    const pct3plus = records.length ? Math.round((shared3plus/records.length)*100) : 0;
    const topCo = coEntries[0], topDept = deptEntries[0];
    const insights = [
      `${shared2plus} process${shared2plus===1?"":"es"} (${pct2plus}%) are shared by 2 or more companies.`,
      `${pct3plus}% of processes are shared by 3 or more companies.`,
      topCo ? `Top company: <strong>${esc(topCo[0])}</strong> with ${topCo[1]} processes.` : "",
      topDept ? `Largest inventory department: <strong>${esc(topDept[0])}</strong> (${topDept[1]}).` : "",
      `${compSet.size} compan${compSet.size===1?"y":"ies"} and ${deptSet.size} department${deptSet.size===1?"":"s"} covered.`
    ].filter(Boolean);
    $("pidInsights").innerHTML = insights.map(t => `<li>${t}</li>`).join("");
  }

  function renderTrend(records) {
    const range = $("pidTrendRange")?.value || "year";
    const now = new Date();
    let labels = [], counts = [];
    const getDate = r => (r.createdAt && (r.createdAt.toDate ? r.createdAt.toDate() :
      new Date(r.createdAt.seconds ? r.createdAt.seconds*1000 : r.createdAt))) || null;
    if (range === "month") {
      const days = now.getDate();
      labels = Array.from({length:days},(_,i)=>String(i+1));
      counts = Array(days).fill(0);
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        if (d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth()) counts[d.getDate()-1]++;
      });
    } else if (range === "year") {
      labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      counts = Array(12).fill(0);
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        if (d.getFullYear()===now.getFullYear()) counts[d.getMonth()]++;
      });
    } else {
      const map = {};
      records.forEach(r => {
        const d = getDate(r); if (!d || isNaN(d)) return;
        const k = String(d.getFullYear()); map[k]=(map[k]||0)+1;
      });
      const keys = Object.keys(map).sort();
      labels = keys; counts = keys.map(k=>map[k]);
    }
    line("pidChartTrend", labels, counts);
  }

  function clearFilters() {
    ["pidSearch","pidCompany","pidDept","pidType","pidIssue","pidFrom","pidTo"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    render();
  }

  async function exportPdf() {
    const panel = document.getElementById("piPanelDash");
    if (!panel || typeof html2canvas === "undefined" || !window.jspdf) {
      alert("PDF export libraries not loaded."); return;
    }
    const btn = document.getElementById("pidExportPdf");
    const oldTxt = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Generating PDF…"; }
    try {
      const canvas = await html2canvas(panel, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 40;
      const imgH = canvas.height * imgW / canvas.width;
      const imgData = canvas.toDataURL("image/png");
      let heightLeft = imgH;
      let position = 20;
      pdf.addImage(imgData, "PNG", 20, position, imgW, imgH);
      heightLeft -= (pageH - 40);
      while (heightLeft > 0) {
        pdf.addPage();
        position = 20 - (imgH - heightLeft);
        pdf.addImage(imgData, "PNG", 20, position, imgW, imgH);
        heightLeft -= (pageH - 40);
      }
      const stamp = new Date().toISOString().slice(0,10);
      pdf.save(`Process-Inventory-Dashboard-${stamp}.pdf`);
    } catch (e) {
      console.error(e); alert("Failed to export PDF: " + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
    }
  }

  function getExportRows() {
    return getFiltered().map(r => {
      const d = ts(r);
      return {
        "Document Title": r.documentTitle || "",
        "Document Code": r.documentCode || "",
        "Document Type": r.documentType || "",
        "Department": r.department || "",
        "Issue No": r.issueNo ?? "",
        "Issue Date": r.issueDate || "",
        "Companies": (r.companies || []).join("; "),
        "# Companies": (r.companies || []).length,
        "Last Updated": d ? d.toISOString().slice(0,10) : ""
      };
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function boot() {
    if (typeof Chart === "undefined") { setTimeout(boot, 200); return; }
    initSubTabs();
    ["pidSearch","pidCompany","pidDept","pidType","pidIssue","pidFrom","pidTo"].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });
    $("pidClear")?.addEventListener("click", clearFilters);
    $("pidTrendRange")?.addEventListener("change", () => renderTrend(getFiltered()));
    $("pidExportPdf")?.addEventListener("click", exportPdf);
    window.addEventListener("pi:records", () => {
      if ($("piPanelDash")?.classList.contains("active")) render();
      else refreshFilterOptions(window.__piRecords || []);
    });
    // initial
    refreshFilterOptions(window.__piRecords || []);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

;
/* ===== process-map.js (merged) ===== */
/* Process Map Generator v4 — vertical swimlane engine
 *
 * Primary input (unified schema, single worksheet):
 *   Process ID, Process Name, Process No, Version, Step ID, Step Name,
 *   Step Type, Swimlane, Sequence, Parent Step, Next Step(s), Branch Label,
 *   Annotation, Shape, [Previous Step(s)]
 *
 * Features:
 *  - Top-to-bottom flow with horizontal swimlane columns (Visio / Bizagi style).
 *  - Layout mode selector: IDH Standard (vertical), Horizontal, Auto.
 *  - Auto-detects swimlanes; grows canvas DOWNWARD, keeps within browser width.
 *  - Sequence used INTERNALLY only for ordering — not rendered as a header.
 *  - Annotations float beside the step (dashed), no extra columns.
 *  - Multi-process file with selector, validation, drag/pan/zoom, PNG/SVG/PDF export.
 *  - Legacy 3-sheet workbooks + TSV paste still work as fallbacks.
 */
(function(){
  // ---------- Constants ----------
  const DEFAULT_LANE_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];
  const STATUS_COLORS = {
    blue:'#DEEAF6', green:'#DCEBD4', yellow:'#FFF2CC',
    red:'#F8CBAD',  orange:'#FCD5B4', gray:'#E7E6E6', grey:'#E7E6E6'
  };
  const VALID_TYPES = ['start','end','process','approval','decision','document','note','delay'];

  // ---------- State ----------
  const state = {
    processes: {},
    processOrder: [],
    currentPid: null,
    steps: [],
    departments: [],
    sequences: [],
    positions: {},
    collapsed: {},
    view: { scale:1, tx:0, ty:0 },
    title: '', pno: '', ver: '',
    validation: [],
    layoutMode: 'vertical' // 'vertical' | 'horizontal' | 'auto'
  };
  let lastExcelUploadToken = 0;

  function resetAll(){
    state.processes = {};
    state.processOrder = [];
    state.currentPid = null;
    state.steps = [];
    state.departments = [];
    state.sequences = [];
    state.positions = {};
    state.collapsed = {};
    state.validation = [];
  }

  // ---------- Utilities ----------
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function wrap(text, max){
    const words = String(text||'').split(/\s+/); const lines=[]; let cur='';
    words.forEach(w=>{ if ((cur+' '+w).trim().length>max){ if(cur) lines.push(cur); cur=w;} else cur=(cur+' '+w).trim();});
    if(cur) lines.push(cur); return lines;
  }
  function normHeader(h){ return String(h||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function resolveColor(v){
    if (!v) return '#DEEAF6';
    const s = String(v).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    return STATUS_COLORS[s.toLowerCase()] || s;
  }
  function normType(t, shape){
    const s = String(t||shape||'process').toLowerCase().trim();
    if (VALID_TYPES.includes(s)) return s;
    if (/diamond|decision/.test(s)) return 'decision';
    if (/document|doc/.test(s)) return 'document';
    if (/start/.test(s)) return 'start';
    if (/end|stop/.test(s)) return 'end';
    if (/approv/.test(s)) return 'approval';
    if (/note|annot/.test(s)) return 'note';
    return 'process';
  }
  function splitList(v){
    return String(v==null?'':v).split(/[,;\/|]+/).map(x=>x.trim()).filter(Boolean);
  }

  // ---------- Sheet → rows ----------
  function sheetToObjects(ws){
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
    if (!rows.length) return { headers:[], rows:[] };
    let hi = 0;
    for (let i=0; i<Math.min(rows.length,5); i++){
      const nonEmpty = rows[i].filter(c => String(c).trim() !== '');
      if (nonEmpty.length >= 2){ hi = i; break; }
    }
    const headers = rows[hi].map(normHeader);
    const out = [];
    for (let i=hi+1; i<rows.length; i++){
      const r = rows[i];
      if (!r.some(c => String(c).trim() !== '')) continue;
      const obj = {}; headers.forEach((h,idx) => { if (h) obj[h] = r[idx]; });
      out.push(obj);
    }
    return { headers, rows: out };
  }

  function findSheet(wb, ...names){
    const map = {};
    (wb.SheetNames||[]).forEach(n => { map[n.toLowerCase().replace(/\s+/g,'')] = n; });
    for (const n of names){
      const key = n.toLowerCase().replace(/\s+/g,'');
      if (map[key]) return wb.Sheets[map[key]];
    }
    return null;
  }

  // ---------- New unified schema ----------
  function isUnifiedHeader(headers){
    const set = new Set(headers);
    return set.has('processid') && set.has('stepid') && (set.has('swimlane') || set.has('department'));
  }

  function findUnifiedSheet(wb){
    const preferred = findSheet(wb, 'ProcessMap','Processes','ProcessSteps','Steps','Sheet1');
    const candidates = preferred ? [preferred] : [];
    (wb.SheetNames || []).forEach(n => { if (wb.Sheets[n] && !candidates.includes(wb.Sheets[n])) candidates.push(wb.Sheets[n]); });
    for (const ws of candidates){
      const { headers, rows } = sheetToObjects(ws);
      if (isUnifiedHeader(headers) && rows.length) return { ws, headers, rows };
    }
    return null;
  }

  function loadUnified(rows){
    const groups = {};
    const order = [];
    rows.forEach(r => {
      const pid = String(r.processid ?? '').trim() || '__default__';
      if (!groups[pid]){
        groups[pid] = {
          pid,
          title: String(r.processname ?? '').trim(),
          no:    String(r.processno   ?? '').trim(),
          ver:   String(r.version     ?? '').trim(),
          rows: []
        };
        order.push(pid);
      }
      groups[pid].rows.push(r);
    });

    state.processes = {};
    state.processOrder = order;
    order.forEach(pid => {
      const g = groups[pid];
      state.processes[pid] = buildProcess(g);
    });
    state.currentPid = order[0];
    activateProcess(state.currentPid);
    return order.length > 0;
  }

  function buildProcess(g){
    const steps = g.rows.map(r => {
      const stepId = String(r.stepid ?? '').trim();
      const shape  = String(r.shape ?? '').trim();
      return {
        id: stepId,
        name: String(r.stepname ?? '').trim(),
        type: normType(r.steptype, shape),
        department: String(r.swimlane ?? r.department ?? 'General').trim() || 'General',
        seq: parseSeq(r.sequence),
        parent: splitList(r.parentstep),
        prev: splitList(r.previousstep ?? r.previoussteps),
        nexts: splitList(r.nextsteps ?? r.nextstep),
        branchLabels: splitList(r.branchlabel),
        annotation: String(r.annotation ?? '').trim(),
        owner: '', sla:'', document:'', color:'#DEEAF6', notes:''
      };
    }).filter(s => s.id);

    const byId = {}; steps.forEach(s => byId[s.id] = s);
    steps.forEach(s => {
      s.nexts.forEach(n => {
        const t = byId[n]; if (t && !t.prev.includes(s.id)) t.prev.push(s.id);
      });
    });

    const seen = new Set(); const departments = [];
    steps.forEach(s => {
      const d = s.department;
      if (!seen.has(d.toLowerCase())){
        departments.push({ name:d, color: DEFAULT_LANE_COLORS[departments.length % DEFAULT_LANE_COLORS.length], order: departments.length });
        seen.add(d.toLowerCase());
      }
    });

    const seqSet = new Set();
    steps.forEach(s => { if (s.seq != null) seqSet.add(s.seq); });
    const seqSorted = [...seqSet].sort((a,b)=>a-b);
    steps.forEach(s => {
      if (s.seq == null){
        const p = s.parent[0] && byId[s.parent[0]];
        if (p && p.seq != null) s.seq = p.seq;
      }
    });
    const sequences = seqSorted.map(n => ({ key:n, label:'Step '+n }));

    return { pid:g.pid, title:g.title, no:g.no, ver:g.ver, steps, departments, sequences, byId };
  }

  function parseSeq(v){
    if (v == null || String(v).trim()==='') return null;
    const n = parseInt(String(v).match(/-?\d+/)?.[0]);
    return isNaN(n) ? null : n;
  }

  function activateProcess(pid){
    const p = state.processes[pid]; if (!p) return;
    state.currentPid = pid;
    state.steps = p.steps;
    state.departments = p.departments;
    state.sequences = p.sequences;
    state.positions = {};
    state.collapsed = {};
    state.title = p.title;
    state.pno   = p.no;
    state.ver   = p.ver;
    const t = document.getElementById('pmTitle'); if (t) t.value = p.title;
    const no = document.getElementById('pmNo'); if (no) no.value = p.no;
    const ve = document.getElementById('pmVer'); if (ve) ve.value = p.ver;
    validate();
  }

  // ---------- Validation ----------
  function validate(){
    const errs = [];
    const seen = {};
    state.steps.forEach(s => {
      seen[s.id] = (seen[s.id]||0) + 1;
      if (!VALID_TYPES.includes(s.type)) errs.push(`Step ${s.id}: invalid Step Type "${s.type}".`);
    });
    Object.keys(seen).forEach(id => { if (seen[id] > 1) errs.push(`Duplicate Step ID: ${id} (${seen[id]}×).`); });
    const byId = {}; state.steps.forEach(s => byId[s.id] = s);
    state.steps.forEach(s => {
      s.parent.forEach(p => { if (!byId[p]) errs.push(`Step ${s.id}: Parent Step "${p}" not found.`); });
      s.nexts.forEach(n => { if (!byId[n]) errs.push(`Step ${s.id}: Next Step "${n}" not found.`); });
    });
    const starts = state.steps.filter(s => s.type==='start').length;
    const ends   = state.steps.filter(s => s.type==='end').length;
    if (starts === 0) errs.push('No Start step found.');
    if (starts > 1)   errs.push(`Multiple Start steps found (${starts}).`);
    if (ends === 0)   errs.push('No End step found.');
    const laneSeq = {};
    state.steps.forEach(s => {
      if (s.type==='note' || s.seq==null) return;
      const k = s.department+'|'+s.seq;
      laneSeq[k] = (laneSeq[k]||0)+1;
    });
    Object.entries(laneSeq).forEach(([k,c]) => { if (c>1) errs.push(`Duplicate Sequence in lane: ${k.replace('|',' @ Step ')} (${c}×).`); });
    state.validation = errs;
  }

  // ---------- Legacy fallbacks ----------
  function loadFromWorkbookLegacy(wb){
    const psSheet = findSheet(wb,'ProcessSteps','Process Steps','Steps');
    if (!psSheet) return false;
    const { rows } = sheetToObjects(psSheet);
    if (!rows.length) return false;
    const steps = rows.map(r => {
      const idNum = parseInt(String(r.stepid ?? r.id ?? r.seq ?? '').match(/-?\d+/)?.[0]);
      if (isNaN(idNum)) return null;
      return {
        id: String(idNum),
        name: String(r.stepname ?? r.activity ?? r.name ?? '').trim(),
        type: normType(r.steptype ?? r.type),
        department: String(r.department ?? r.swimlane ?? 'General').trim() || 'General',
        seq: idNum,
        parent: r.previousstep!=null && String(r.previousstep).trim() ? [String(r.previousstep).trim()] : [],
        prev: [], nexts: [], branchLabels: [], annotation: String(r.notes ?? '').trim(),
        owner: String(r.owner ?? '').trim(),
        sla: String(r.sladays ?? r.sla ?? '').trim(),
        document: String(r.document ?? '').trim(),
        color: resolveColor(r.statuscolor ?? r.color),
        notes: String(r.notes ?? '').trim()
      };
    }).filter(Boolean);
    const byId = {}; steps.forEach(s=>byId[s.id]=s);
    steps.forEach(s => s.parent.forEach(p => { if (byId[p]) byId[p].nexts.push(s.id); }));

    const p = { pid:'legacy', title:'', no:'', ver:'', steps, departments: [], sequences: [], byId };
    const seen = new Set();
    steps.forEach(s => { if (!seen.has(s.department.toLowerCase())){ p.departments.push({name:s.department, color:DEFAULT_LANE_COLORS[p.departments.length%DEFAULT_LANE_COLORS.length], order:p.departments.length}); seen.add(s.department.toLowerCase()); }});
    const seqSet = new Set(); steps.forEach(s => seqSet.add(s.seq));
    p.sequences = [...seqSet].sort((a,b)=>a-b).map(n => ({ key:n, label:'Step '+n }));

    state.processes = { legacy:p };
    state.processOrder = ['legacy'];
    activateProcess('legacy');
    return true;
  }

  function parseLegacyText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return false;
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c=>c.trim()));
    if (isNaN(parseInt(rows[0][0]))) rows.shift();
    const steps = rows.map((r,i) => ({
      id: String(parseInt(r[0])||(i+1)),
      name: r[1]||'', type:'process',
      department: r[2]||'General',
      seq: parseInt(r[0])||(i+1),
      parent: i===0 ? [] : [String(parseInt(rows[i-1][0])||i)],
      prev: [], nexts: [], branchLabels: [], annotation:'',
      owner:r[3]||'', sla:r[4]||'', document:'', color:'#DEEAF6', notes:''
    })).filter(s=>s.name);
    if (!steps.length) return false;
    const byId={}; steps.forEach(s=>byId[s.id]=s);
    steps.forEach(s => s.parent.forEach(p => byId[p] && byId[p].nexts.push(s.id)));
    const p = { pid:'legacy', title:'', no:'', ver:'', steps, departments:[], sequences:[], byId };
    const seen = new Set();
    steps.forEach(s => { if (!seen.has(s.department.toLowerCase())){ p.departments.push({name:s.department,color:DEFAULT_LANE_COLORS[p.departments.length%DEFAULT_LANE_COLORS.length],order:p.departments.length}); seen.add(s.department.toLowerCase()); }});
    const seqSet=new Set(); steps.forEach(s=>seqSet.add(s.seq));
    p.sequences = [...seqSet].sort((a,b)=>a-b).map(n=>({key:n,label:'Step '+n}));
    state.processes = { legacy:p };
    state.processOrder = ['legacy'];
    activateProcess('legacy');
    return true;
  }

  // ---------- Layout ----------
  // Vertical mode = swimlanes are COLUMNS (headers on top). Flow goes DOWN.
  // Horizontal mode = swimlanes are ROWS (headers on left). Flow goes RIGHT.
  const LAYOUT_V = { headerH: 56, laneHeaderH: 42, rowH: 110, padL: 12, padR: 12, padB: 40, boxW: 190, boxH: 78, minLaneW: 200 };
  const LAYOUT_H = { laneHeaderW: 160, headerH: 60, laneH: 150, colW: 220, padL: 12, padR: 60, boxW: 180, boxH: 78 };

  function pickAutoMode(){
    const nLanes = state.departments.length || 1;
    const nSeq   = state.sequences.length || 1;
    // Prefer vertical unless there are many parallel branches per row
    let maxPerCell = 0;
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const k = s.department+'|'+s.seq;
      cellCount[k] = (cellCount[k]||0)+1;
      if (cellCount[k] > maxPerCell) maxPerCell = cellCount[k];
    });
    if (nLanes >= nSeq && maxPerCell <= 1) return 'horizontal';
    return 'vertical';
  }

  function effectiveMode(){
    if (state.layoutMode === 'auto') return pickAutoMode();
    return state.layoutMode || 'vertical';
  }

  function containerWidth(){
    const wrap = document.getElementById('pmMapWrap');
    const w = wrap ? wrap.clientWidth : 1000;
    return Math.max(600, w - 4);
  }

  function computeLayoutVertical(){
    const L = LAYOUT_V;
    const nLanes = Math.max(1, state.departments.length);
    // Fit width to browser, but respect min lane width
    const availW = containerWidth();
    let laneW = Math.max(L.minLaneW, Math.floor((availW - L.padL - L.padR) / nLanes));
    const totalW = L.padL + laneW * nLanes + L.padR;

    // Row per sequence
    const seqRow = {};
    state.sequences.forEach((sq, i) => { seqRow[sq.key] = i; });
    const nRows = Math.max(1, state.sequences.length);

    const laneX = {};
    state.departments.forEach((d, i) => { laneX[d.name] = L.padL + i * laneW; });

    const bodyTop = L.headerH + L.laneHeaderH;
    const totalH  = bodyTop + nRows * L.rowH + L.padB;

    // Cell placement (support multi steps in same lane+seq side-by-side)
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const k = s.department+'|'+s.seq;
      cellCount[k] = (cellCount[k]||0)+1;
    });
    const cellIdx = {};
    const stepPos = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const row = seqRow[s.seq] ?? 0;
      const k = s.department+'|'+s.seq;
      const idx = (cellIdx[k] = (cellIdx[k]||0) + 1) - 1;
      const total = cellCount[k];
      const lx = laneX[s.department] != null ? laneX[s.department] : L.padL;
      const slot = laneW / total;
      const cx = lx + slot*(idx + 0.5);
      const cy = bodyTop + row*L.rowH + L.rowH/2;
      const p = state.positions[s.id];
      stepPos[s.id] = { x: p?.x ?? (cx - L.boxW/2), y: p?.y ?? (cy - L.boxH/2), hidden:false };
    });

    return { mode:'vertical', totalW, totalH, laneW, laneX, bodyTop, stepPos, nRows };
  }

  function computeLayoutHorizontal(){
    const L = LAYOUT_H;
    const laneY = {}; let y = L.headerH;
    state.departments.forEach(d => {
      laneY[d.name] = { y, h: L.laneH };
      y += L.laneH;
    });
    const slotW = L.boxW + 22;
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const key = s.department + '|' + (s.seq ?? 'x');
      cellCount[key] = (cellCount[key]||0) + 1;
    });
    const seqW = {}; const seqX = {};
    state.sequences.forEach(sq => {
      let maxC = 1;
      state.departments.forEach(d => {
        const c = cellCount[d.name+'|'+sq.key] || 0;
        if (c > maxC) maxC = c;
      });
      seqW[sq.key] = Math.max(L.colW, maxC * slotW + 40);
    });
    let x = L.laneHeaderW + L.padL;
    state.sequences.forEach(sq => { seqX[sq.key] = x; x += seqW[sq.key]; });
    const totalW = x + L.padR;
    const totalH = y + 20;

    const cellIndex = {}; const stepPos = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const lane = laneY[s.department] || { y:L.headerH, h:L.laneH };
      const key = s.department+'|'+s.seq;
      const idx = (cellIndex[key] = (cellIndex[key]||0) + 1) - 1;
      const baseX = seqX[s.seq] != null ? seqX[s.seq] : L.laneHeaderW+L.padL;
      const cellX = baseX + 20 + idx * slotW;
      const cellY = lane.y + (lane.h - L.boxH)/2;
      const p = state.positions[s.id];
      stepPos[s.id] = { x: p?.x ?? cellX, y: p?.y ?? cellY, lane, hidden:false };
    });
    return { mode:'horizontal', totalW, totalH, laneY, seqX, seqW, stepPos };
  }

  // ---------- Shapes ----------
  function shapePath(type, x, y, w, h){
    const r = 14;
    switch(type){
      case 'start': case 'end':
        return { tag:'rect', attrs:{ x, y, width:w, height:h, rx:h/2, ry:h/2 } };
      case 'decision':
        return { tag:'polygon', attrs:{ points:`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}` } };
      case 'document':
        return { tag:'path', attrs:{ d:`M${x},${y} L${x+w},${y} L${x+w},${y+h-10} Q${x+w*0.75},${y+h+6} ${x+w/2},${y+h-6} Q${x+w*0.25},${y+h-14} ${x},${y+h-6} Z` } };
      case 'delay':
        return { tag:'polygon', attrs:{ points:`${x},${y} ${x+w},${y} ${x+w/2},${y+h/2} ${x+w},${y+h} ${x},${y+h} ${x+w/2},${y+h/2}` } };
      case 'approval':
      case 'process':
      default:
        return { tag:'rect', attrs:{ x, y, width:w, height:h, rx:r, ry:r } };
    }
  }
  function shapeAnchor(type, x, y, w, h, side){
    const cx=x+w/2, cy=y+h/2;
    if (side==='r') return { x:x+w, y:cy };
    if (side==='l') return { x, y:cy };
    if (side==='t') return { x:cx, y };
    if (side==='b') return { x:cx, y:y+h };
    return { x:cx, y:cy };
  }
  function sideForConnectorVertical(from, to){
    // Prefer top/bottom in vertical mode
    if (to.y > from.y + 5) return { a:'b', b:'t' };
    if (to.y < from.y - 5) return { a:'t', b:'b' };
    if (to.x > from.x)     return { a:'r', b:'l' };
    return { a:'l', b:'r' };
  }
  function sideForConnectorHorizontal(from, to){
    if (to.x > from.x + 5) return { a:'r', b:'l' };
    if (to.x < from.x - 5) return { a:'l', b:'r' };
    if (to.y > from.y)     return { a:'b', b:'t' };
    return { a:'t', b:'b' };
  }
  function connectorPath(ax, ay, bx, by, aSide){
    if (aSide==='r' || aSide==='l'){
      const midX = (ax+bx)/2;
      return `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${bx} ${by}`;
    } else {
      const midY = (ay+by)/2;
      return `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`;
    }
  }

  // ---------- Render ----------
  function render(){
    const svg = document.getElementById('pmMap'); if (!svg) return;
    renderValidation();
    if (!state.steps.length){ svg.innerHTML=''; svg.removeAttribute('viewBox'); return; }

    state.title = document.getElementById('pmTitle')?.value ?? state.title;
    state.pno   = document.getElementById('pmNo')?.value   ?? state.pno;
    state.ver   = document.getElementById('pmVer')?.value  ?? state.ver;

    const mode = effectiveMode();
    const layout = mode === 'horizontal' ? computeLayoutHorizontal() : computeLayoutVertical();
    const { totalW, totalH, stepPos } = layout;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `${state.view.tx} ${state.view.ty} ${totalW/state.view.scale} ${totalH/state.view.scale}`);
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');

    let s = '';
    s += `<defs>
      <marker id="pmArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1f4e79"/></marker>
      <marker id="pmArrYes" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2e7d32"/></marker>
      <marker id="pmArrNo"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c62828"/></marker>
      <filter id="pmShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-opacity="0.18"/></filter>
    </defs>`;

    // Header bar (title)
    const L = mode==='vertical' ? LAYOUT_V : LAYOUT_H;
    s += `<rect x="0" y="0" width="${totalW}" height="${L.headerH}" fill="#f4f7fb" stroke="#1f4e79"/>`;
    s += `<text x="14" y="22" font-size="14" font-weight="bold" fill="#1f3a8a">${esc(state.title||'Process Map')}</text>`;
    s += `<text x="14" y="42" font-size="11" fill="#374151">Process no. ${esc(state.pno)}   ·   Version ${esc(state.ver)}   ·   ${state.steps.length} activities</text>`;

    if (mode === 'vertical'){
      // Lane header row (dept names across the top) + vertical lane columns
      const { laneW, laneX, bodyTop } = layout;
      state.departments.forEach(d => {
        const x = laneX[d.name];
        // Lane header pill
        s += `<rect x="${x}" y="${L.headerH}" width="${laneW}" height="${L.laneHeaderH}" fill="${d.color}" stroke="#1f4e79"/>`;
        s += `<text x="${x+laneW/2}" y="${L.headerH+L.laneHeaderH/2+4}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f3a8a">${esc(d.name)}</text>`;
        // Column body
        s += `<rect x="${x}" y="${bodyTop}" width="${laneW}" height="${totalH-bodyTop-8}" fill="#ffffff" stroke="#1f4e79"/>`;
      });
    } else {
      // Horizontal: lane rows on the left, no sequence header (removed per spec)
      const { laneY } = layout;
      state.departments.forEach(d => {
        const lane = laneY[d.name];
        s += `<rect x="0" y="${lane.y}" width="${L.laneHeaderW}" height="${lane.h}" fill="${d.color}" stroke="#1f4e79"/>`;
        s += `<rect x="${L.laneHeaderW}" y="${lane.y}" width="${totalW-L.laneHeaderW}" height="${lane.h}" fill="#ffffff" stroke="#1f4e79"/>`;
        const cx = L.laneHeaderW/2, cy = lane.y+lane.h/2;
        s += `<text x="${cx}" y="${cy}" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})" style="pointer-events:none">${esc(d.name)}</text>`;
      });
    }

    // Connectors
    const byId = {}; state.steps.forEach(st => byId[st.id]=st);
    const sideFn = mode==='vertical' ? sideForConnectorVertical : sideForConnectorHorizontal;
    const boxW = mode==='vertical' ? LAYOUT_V.boxW : LAYOUT_H.boxW;
    const boxH = mode==='vertical' ? LAYOUT_V.boxH : LAYOUT_H.boxH;
    const drawConn = (fromId, toId, kind, label) => {
      const from = byId[fromId], to = byId[toId];
      if (!from || !to) return '';
      const pf = stepPos[fromId], pt = stepPos[toId];
      if (!pf || !pt) return '';
      const sides = sideFn({x:pf.x+boxW/2, y:pf.y+boxH/2},{x:pt.x+boxW/2, y:pt.y+boxH/2});
      const a = shapeAnchor(from.type, pf.x, pf.y, boxW, boxH, sides.a);
      const b = shapeAnchor(to.type,   pt.x, pt.y, boxW, boxH, sides.b);
      const path = connectorPath(a.x, a.y, b.x, b.y, sides.a);
      const marker = kind==='yes' ? 'pmArrYes' : kind==='no' ? 'pmArrNo' : 'pmArr';
      const color  = kind==='yes' ? '#2e7d32' : kind==='no' ? '#c62828' : '#1f4e79';
      let out = `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#${marker})"/>`;
      if (label){
        const mx = (a.x+b.x)/2, my = (a.y+b.y)/2 - 6;
        const w = Math.max(48, label.length*6+12);
        out += `<rect x="${mx-w/2}" y="${my-11}" width="${w}" height="15" rx="3" fill="#fff" stroke="${color}" stroke-width="0.6"/>`;
        out += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="${color}">${esc(label)}</text>`;
      }
      return out;
    };

    state.steps.forEach(st => {
      if (st.type==='note') return;
      st.nexts.forEach((n, i) => {
        let label = st.branchLabels[i] || '';
        let kind = 'plain';
        if (st.type==='decision'){
          const low = label.toLowerCase();
          if (/^(yes|approved|approve|accept|ok|true)$/.test(low)) kind='yes';
          else if (/^(no|rejected|reject|deny|false)$/.test(low)) kind='no';
        }
        s += drawConn(st.id, n, kind, label);
      });
    });

    // Annotations (floating dashed) — placed beside the step; doesn't affect layout width
    state.steps.forEach(st => {
      if (!st.annotation) return;
      const p = stepPos[st.id]; if (!p) return;
      const noteW = 150, noteH = 40;
      // Place to the right of the shape; if that overflows, place to the left
      let nx = p.x + boxW + 24;
      const ny = p.y + (boxH-noteH)/2;
      if (nx + noteW > totalW - 4) nx = p.x - noteW - 24;
      const ax = nx <= p.x ? p.x : p.x + boxW;
      const bx = nx <= p.x ? nx + noteW : nx;
      s += `<line x1="${ax}" y1="${p.y+boxH/2}" x2="${bx}" y2="${ny+noteH/2}" stroke="#b45309" stroke-width="1" stroke-dasharray="4 3"/>`;
      s += `<rect x="${nx}" y="${ny}" width="${noteW}" height="${noteH}" rx="4" fill="#fffbe6" stroke="#b45309"/>`;
      const lines = wrap(st.annotation, 22).slice(0,3);
      lines.forEach((ln,i) => {
        s += `<text x="${nx+6}" y="${ny+14+i*12}" font-size="10" fill="#78350f">${esc(ln)}</text>`;
      });
    });

    // Shapes
    state.steps.forEach(st => {
      if (st.type==='note') return;
      const p = stepPos[st.id]; if (!p) return;
      const sh = shapePath(st.type, p.x, p.y, boxW, boxH);
      const fill = st.color || defaultFillForType(st.type);
      const attrStr = Object.entries(sh.attrs).map(([k,v])=>`${k}="${v}"`).join(' ');
      s += `<g class="pm-node" data-id="${esc(st.id)}" style="cursor:move">`;
      s += `<${sh.tag} ${attrStr} fill="${fill}" stroke="#1f4e79" stroke-width="1.5" filter="url(#pmShadow)"/>`;
      const isDec = st.type==='decision';
      const label = st.name || st.id;
      const lines = wrap(label, isDec?16:26).slice(0,3);
      s += `<text x="${p.x+boxW/2}" y="${p.y+14}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a" style="pointer-events:none">${esc(st.id)}${isDec?' ?':''}</text>`;
      lines.forEach((ln,li) => {
        s += `<text x="${p.x+boxW/2}" y="${p.y+30+li*13}" text-anchor="middle" font-size="10.5" fill="#0f172a" style="pointer-events:none">${esc(ln)}</text>`;
      });
      s += `</g>`;
    });

    svg.innerHTML = s;
    attachInteractions(svg, layout);
  }

  function defaultFillForType(t){
    switch(t){
      case 'start': return '#DCEBD4';
      case 'end':   return '#F8CBAD';
      case 'decision': return '#FFF2CC';
      case 'document': return '#FCE4EC';
      case 'approval': return '#E1E7F5';
      default: return '#DEEAF6';
    }
  }

  function renderValidation(){
    let box = document.getElementById('pmValidation');
    if (!box){
      const wrap = document.getElementById('pmMapWrap');
      if (!wrap) return;
      box = document.createElement('div');
      box.id = 'pmValidation';
      box.style.cssText = 'margin:0 0 10px;padding:10px 12px;border-radius:6px;font-size:12px;';
      wrap.parentNode.insertBefore(box, wrap);
    }
    if (!state.validation.length){
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'block';
    box.style.background = '#fff4f4';
    box.style.border = '1px solid #c62828';
    box.style.color = '#7f1d1d';
    box.innerHTML = '<strong>Validation issues (' + state.validation.length + '):</strong><ul style="margin:6px 0 0 18px;padding:0;">'
      + state.validation.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>';
  }

  // ---------- Interactions ----------
  function attachInteractions(svg, layout){
    let drag = null;
    svg.querySelectorAll('.pm-node').forEach(g => {
      g.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        const id = g.getAttribute('data-id');
        const pt = svgPoint(svg, ev); const pos = layout.stepPos[id];
        drag = { id, dx: pt.x-pos.x, dy: pt.y-pos.y };
      });
    });
    let pan = null;
    svg.addEventListener('mousedown', ev => {
      if (drag) return;
      if (ev.target === svg || ev.target.tagName==='rect'){
        pan = { x:ev.clientX, y:ev.clientY, tx:state.view.tx, ty:state.view.ty };
      }
    });
    window.addEventListener('mousemove', ev => {
      if (drag){
        const pt = svgPoint(svg, ev);
        state.positions[drag.id] = { x: pt.x-drag.dx, y: pt.y-drag.dy };
        render();
      } else if (pan){
        const dx = (ev.clientX-pan.x)/state.view.scale;
        const dy = (ev.clientY-pan.y)/state.view.scale;
        state.view.tx = pan.tx - dx; state.view.ty = pan.ty - dy;
        applyView(svg);
      }
    });
    window.addEventListener('mouseup', () => { drag=null; pan=null; });
    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const f = ev.deltaY<0 ? 1.1 : 1/1.1;
      state.view.scale = Math.max(0.3, Math.min(3, state.view.scale*f));
      applyView(svg);
    }, { passive:false });
  }
  function applyView(svg){
    const w=+svg.getAttribute('width'), h=+svg.getAttribute('height');
    svg.setAttribute('viewBox', `${state.view.tx} ${state.view.ty} ${w/state.view.scale} ${h/state.view.scale}`);
  }
  function svgPoint(svg, ev){
    const pt = svg.createSVGPoint(); pt.x=ev.clientX; pt.y=ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ---------- Exports ----------
  function svgToPngDataUrl(scale){
    return new Promise((resolve,reject) => {
      const svg = document.getElementById('pmMap');
      const w=+svg.getAttribute('width'), h=+svg.getAttribute('height');
      const clone = svg.cloneNode(true);
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width=w*scale; c.height=h*scale;
        const ctx = c.getContext('2d'); ctx.scale(scale,scale);
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0);
        resolve({ url:c.toDataURL('image/png'), w, h });
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
    });
  }
  async function downloadPng(){
    const { url } = await svgToPngDataUrl(2);
    const a=document.createElement('a'); a.href=url; a.download='process-map.png'; a.click();
  }
  function downloadSvg(){
    const svg=document.getElementById('pmMap');
    const blob=new Blob([svg.outerHTML],{type:'image/svg+xml'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='process-map.svg'; a.click();
  }
  async function downloadPdf(){
    if (!window.jspdf){ alert('PDF library not loaded.'); return; }
    const svg=document.getElementById('pmMap');
    if (!svg.innerHTML.trim()){ alert('Generate a process map first.'); return; }
    const { url, w, h } = await svgToPngDataUrl(2);
    const { jsPDF } = window.jspdf;
    const orientation = w>=h?'landscape':'portrait';
    const pdf = new jsPDF({ orientation, unit:'pt', format:'a4' });
    const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
    const margin=24, headerH=28;
    pdf.setFontSize(13); pdf.setTextColor(31,58,138);
    pdf.text('Process Map — '+(state.title||''), margin, margin+4);
    pdf.setFontSize(9); pdf.setTextColor(107,114,128);
    pdf.text(new Date().toLocaleString(), pageW-margin, margin+4, { align:'right' });
    const availW = pageW - margin*2;
    const availH = pageH - margin*2 - headerH;
    // Scale to page width; if height exceeds page, paginate vertically.
    const scale = availW / w;
    const scaledH = h * scale;
    if (scaledH <= availH){
      pdf.addImage(url, 'PNG', margin, margin+headerH, availW, scaledH);
    } else {
      // Multi-page vertical split
      const pxPerPage = availH / scale; // source-image pixels per page
      const img = new Image();
      await new Promise(res => { img.onload = res; img.src = url; });
      const srcW = img.width, srcH = img.height;
      const srcPxPerPage = pxPerPage * (srcW / w);
      let y = 0, pageNo = 0;
      while (y < srcH){
        if (pageNo > 0){ pdf.addPage(); }
        const sliceH = Math.min(srcPxPerPage, srcH - y);
        const c = document.createElement('canvas');
        c.width = srcW; c.height = sliceH;
        const ctx = c.getContext('2d');
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,srcW,sliceH);
        ctx.drawImage(img, 0, y, srcW, sliceH, 0, 0, srcW, sliceH);
        const sliceUrl = c.toDataURL('image/png');
        pdf.setFontSize(13); pdf.setTextColor(31,58,138);
        pdf.text('Process Map — '+(state.title||'')+`  (p.${pageNo+1})`, margin, margin+4);
        pdf.addImage(sliceUrl, 'PNG', margin, margin+headerH, availW, sliceH * scale);
        y += sliceH; pageNo++;
      }
    }
    pdf.save('process-map.pdf');
  }
  function computeLayout(){ const m=effectiveMode(); return m==='horizontal'?computeLayoutHorizontal():computeLayoutVertical(); }
  // ---------- Visio 2003 VDX export (single-file XML, opens in Visio) ----------
  function vdxEsc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function vdxRect(id, cx, cy, w, h, fill, line, text, bold){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>${line}</LineColor><Rounding>0.05</Rounding></Line><Fill><FillForegnd>${fill}</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>${bold?0.14:0.10}</Size><Style>${bold?1:0}</Style></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><NoFill>0</NoFill><NoLine>0</NoLine><MoveTo IX="1"><X>0</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>0</Y></LineTo><LineTo IX="3"><X>${w}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h}</Y></LineTo><LineTo IX="5"><X>0</X><Y>0</Y></LineTo></Geom><Text>${vdxEsc(text)}</Text></Shape>`;
  }
  function vdxDiamond(id, cx, cy, w, h, text){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>#1F4E79</LineColor></Line><Fill><FillForegnd>#FFF2CC</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>0.10</Size></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><MoveTo IX="1"><X>${w/2}</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>${h/2}</Y></LineTo><LineTo IX="3"><X>${w/2}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h/2}</Y></LineTo><LineTo IX="5"><X>${w/2}</X><Y>0</Y></LineTo></Geom><Text>${vdxEsc(text)}</Text></Shape>`;
  }
  function vdxLine(id, x1, y1, x2, y2, label, color){
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const w = Math.abs(x2-x1) || 0.001, h = Math.abs(y2-y1) || 0.001;
    const lc = color || '#1F4E79';
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><XForm1D><BeginX>${x1}</BeginX><BeginY>${y1}</BeginY><EndX>${x2}</EndX><EndY>${y2}</EndY></XForm1D><Line><LineWeight>0.015</LineWeight><LineColor>${lc}</LineColor><EndArrow>4</EndArrow><EndArrowSize>2</EndArrowSize></Line><Fill><FillPattern>0</FillPattern></Fill><Char IX="0"><Font>2</Font><Size>0.09</Size><Color>${lc}</Color></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><NoFill>1</NoFill><MoveTo IX="1"><X>${x1<x2?0:w}</X><Y>${y1<y2?0:h}</Y></MoveTo><LineTo IX="2"><X>${x1<x2?w:0}</X><Y>${y1<y2?h:0}</Y></LineTo></Geom><Text>${vdxEsc(label||'')}</Text></Shape>`;
  }

  function downloadVsdx(){
    if (!state.steps || !state.steps.length){ alert('No data to export. Generate the process map first.'); return; }
    const lay = computeLayout();
    // Convert layout px -> Visio inches (1in = 96 px), flip Y (Visio origin = bottom-left)
    const PX = 1/96;
    const totalW = Math.max(800, lay.totalW || 1200);
    const totalH = Math.max(600, lay.totalH || 900);
    const pageW = totalW * PX;
    const pageH = totalH * PX;
    const boxWpx = 160, boxHpx = 70;
    const bw = boxWpx * PX, bh = boxHpx * PX;

    const fillFor = t => t==='decision' ? '#FFF2CC'
      : (t==='start'||t==='end') ? '#DCEBD4'
      : t==='approval' ? '#FCD5B4'
      : t==='document' ? '#DEEAF6'
      : '#DEEAF6';

    let id = 1, shapes = '';

    // Helper: draw a rect from top-left pixel coords (converts to Visio center + flipped Y)
    const drawRectPx = (xPx, yPx, wPx, hPx, fill, line, text, bold) => {
      const w = wPx * PX, h = hPx * PX;
      const cx = (xPx + wPx/2) * PX;
      const cy = pageH - (yPx + hPx/2) * PX;
      shapes += vdxRect(id++, cx, cy, w, h, fill, line, text || '', !!bold);
    };

    // Title + swimlane headers
    const mode = (typeof effectiveMode === 'function') ? effectiveMode() : 'vertical';
    const titleLine = state.title || 'Process Map';
    const subLine = `Process no. ${state.pno || '—'}  ·  Version ${state.ver || '—'}  ·  ${state.steps.length} activities`;
    const fullTitle = titleLine + '\n' + subLine;

    if (mode === 'vertical'){
      const L = LAYOUT_V;
      // Title banner across the top
      drawRectPx(0, 0, totalW, L.headerH, '#DEEBF7', '#1F4E79', fullTitle, true);
      // Swimlane header cells + lane body bands
      state.departments.forEach((d, i) => {
        const x = L.padL + i * lay.laneW;
        drawRectPx(x, L.headerH, lay.laneW, L.laneHeaderH, d.color || '#DDE6F2', '#1F4E79', d.name, true);
        // Faint lane body band under the header (whole column background)
        drawRectPx(x, L.headerH + L.laneHeaderH, lay.laneW, totalH - (L.headerH + L.laneHeaderH), '#FFFFFF', '#BFCFE3', '', false);
      });
    } else {
      const L = LAYOUT_H;
      // Title banner across the top
      drawRectPx(0, 0, totalW, L.headerH, '#DEEBF7', '#1F4E79', fullTitle, true);
      // Swimlane row headers on the left + body band per lane
      state.departments.forEach(d => {
        const lane = lay.laneY[d.name]; if (!lane) return;
        drawRectPx(0, lane.y, L.laneHeaderW, lane.h, d.color || '#DDE6F2', '#1F4E79', d.name, true);
        drawRectPx(L.laneHeaderW, lane.y, totalW - L.laneHeaderW, lane.h, '#FFFFFF', '#BFCFE3', '', false);
      });
    }

    // Shapes for steps
    const posById = {};
    state.steps.forEach(st => {
      if (st.type === 'note') return;
      const p = lay.stepPos[st.id]; if (!p) return;
      const cxPx = p.x + boxWpx/2, cyPx = p.y + boxHpx/2;
      const cx = cxPx * PX, cy = pageH - cyPx * PX;
      posById[st.id] = { cx, cy };
      const label = `${st.name || st.id}` + (st.department ? `\n(${st.department})` : '');
      if (st.type === 'decision'){
        shapes += vdxDiamond(id++, cx, cy, bw, bh, label);
      } else {
        shapes += vdxRect(id++, cx, cy, bw, bh, fillFor(st.type), '#1F4E79', label, st.type==='start'||st.type==='end');
      }
    });

    // Connectors
    state.steps.forEach(st => {
      if (st.type === 'note') return;
      const from = posById[st.id]; if (!from) return;
      (st.nexts || []).forEach((nid, i) => {
        const to = posById[nid]; if (!to) return;
        const lbl = (st.branchLabels && st.branchLabels[i]) || '';
        const isYes = /^(yes|approv)/i.test(lbl);
        const isNo  = /^(no|reject)/i.test(lbl);
        const color = isYes ? '#2E7D32' : isNo ? '#C62828' : '#37474F';
        // Attach to edge centers so arrows land cleanly
        const dx = to.cx - from.cx, dy = to.cy - from.cy;
        let x1 = from.cx, y1 = from.cy, x2 = to.cx, y2 = to.cy;
        if (Math.abs(dx) >= Math.abs(dy)){
          x1 += (dx > 0 ? bw/2 : -bw/2);
          x2 += (dx > 0 ? -bw/2 :  bw/2);
        } else {
          y1 += (dy > 0 ? bh/2 : -bh/2);
          y2 += (dy > 0 ? -bh/2 :  bh/2);
        }
        shapes += vdxLine(id++, x1, y1, x2, y2, lbl, color);
      });
    });

    // Annotations
    state.steps.forEach(st => {
      if (!st.annotation) return;
      const p = lay.stepPos[st.id]; if (!p) return;
      const cx = (p.x + boxWpx + 90) * PX;
      const cy = pageH - (p.y + boxHpx/2) * PX;
      shapes += vdxRect(id++, cx, cy, 1.6, 0.7, '#FFFDE7', '#9E9E9E', st.annotation, false);
    });

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core" start="190" metric="0" DocLangID="1033" buildnum="6360" version="11.0" xml:space="preserve">
<DocumentProperties><Title>${vdxEsc(state.title||'Process Map')}</Title><Creator>Process Assurance Tracker</Creator></DocumentProperties>
<DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings></DocumentSettings>
<FaceNames><FaceName ID="2" Name="Calibri" Panos="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>
<StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"/><StyleSheet ID="3" NameU="Normal" Name="Normal" LineStyle="0" FillStyle="0" TextStyle="0"><Char IX="0"><Font>2</Font><Color>0</Color><Size>0.1666</Size></Char></StyleSheet><StyleSheet ID="4" NameU="Guide" Name="Guide"/></StyleSheets>
<Pages><Page ID="0" NameU="Page-1" Name="Page-1"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><PageProps><PageWidth>${pageW.toFixed(3)}</PageWidth><PageHeight>${pageH.toFixed(3)}</PageHeight><PageScale>1</PageScale><DrawingScale>1</DrawingScale><DrawingSizeType>3</DrawingSizeType></PageProps><PrintProps><PrintPageOrientation>2</PrintPageOrientation><PaperKind>8</PaperKind></PrintProps></PageSheet>
<Shapes>${shapes}</Shapes></Page></Pages></VisioDocument>`;

    const blob = new Blob([xml], { type:'application/vnd.visio' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.title || 'process-map').replace(/[^\w\-]+/g, '_') + '.vdx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Excel template ----------
  function downloadTemplate(){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const wb = XLSX.utils.book_new();
    const rows = [
      ['Process ID','Process Name','Process No','Version','Step ID','Step Name','Step Type','Swimlane','Sequence','Parent Step','Next Step(s)','Branch Label','Annotation','Shape','Previous Step(s)'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S001','Process Start','Start','Sales Department',1,'','S002','','','Start',''],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S002','Need to create new client (cash)','Process','Sales Department',2,'S001','S003','','','Process','S001'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S003','Proposal for prices (Max 15%)','Process','Pricing Team',3,'S002','S004','','','Process','S002'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S004','Negotiations with customer','Process','Sales Department',4,'S003','S005','','Cash clients may receive 10-15%','Process','S003'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S005','After customer acceptance','Process','Sales Department',5,'S004','S006','','','Process','S004'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S006',"Approval client's price list",'Approval','Pricing Team',6,'S005','S007','','','Approval','S005'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S007','Request documents from customer','Document','Sales Department',7,'S006','S008','','','Document','S006'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S008','Reviewed and accepted','Approval','Sales Department',8,'S007','S009','','','Approval','S007'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S009','Send supporting documents to Legal','Process','Sales Department',9,'S008','S010','','','Process','S008'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S010','Reviewed and accepted legally','Approval','Legal',10,'S009','S011','','','Approval','S009'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S011','Send documents to Master Data','Process','Legal',11,'S010','S012','','Tax No., approved price','Process','S010'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S012','Review all documents/data','Process','Master Data Control',12,'S011','S013','','','Process','S011'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S013','Create client on LMS and assign','Process','Master Data Control',13,'S012','S014','','','Process','S012'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S014','Extract/Review client on LMS','Process','Master Data Control',14,'S013','S015','','','Process','S013'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S015','Confirmation','Approval','Pricing Team',15,'S014','S016','','','Approval','S014'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S016','Process End','End','Master Data Control',16,'S015','','','','End','S015']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'ProcessMap');
    XLSX.writeFile(wb, 'process-map-template.xlsx');
  }

  // ---------- Excel upload ----------
  async function handleExcel(file, token){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const ta = document.getElementById('pmData');
    resetAll();
    if (ta){ ta.value=''; ta.dataset.dirty=''; }
    const svg = document.getElementById('pmMap'); if (svg){ svg.innerHTML=''; svg.removeAttribute('viewBox'); }
    try {
      const buf = await file.arrayBuffer();
      if (token !== lastExcelUploadToken) return;
      const wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true });
      const uni = findUnifiedSheet(wb);
      let ok = false;
      if (uni){ ok = loadUnified(uni.rows); }
      if (!ok){ ok = loadFromWorkbookLegacy(wb); }
      if (!ok){
        for (const name of (wb.SheetNames||[])){
          const ws = wb.Sheets[name]; if (!ws) continue;
          const tsv = XLSX.utils.sheet_to_csv(ws, { FS:'\t' });
          if (parseLegacyText(tsv)){ ok=true; break; }
        }
      }
      if (!ok){ alert('No recognizable data. Expected columns include Process ID, Step ID, Step Name, Step Type, Swimlane, Sequence, Next Step(s).'); return; }
      renderProcessSelector();
      render();
    } catch (err){
      console.error(err);
      alert('Failed to read Excel: '+(err && err.message ? err.message : err));
    }
  }

  function renderProcessSelector(){
    let sel = document.getElementById('pmProcessSelector');
    const host = document.getElementById('pmSelectorHost') || document.getElementById('pmMapWrap')?.parentNode;
    if (!host) return;
    if (state.processOrder.length < 2){
      if (sel) sel.parentNode.style.display = 'none';
      return;
    }
    if (!sel){
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:8px 0 12px;display:flex;gap:10px;align-items:center;';
      wrap.innerHTML = `<label style="font-size:12px;font-weight:600;color:#374151;">Select Process:</label>`;
      sel = document.createElement('select');
      sel.id = 'pmProcessSelector';
      sel.style.cssText = 'padding:6px 8px;border:1px solid #cfd6df;border-radius:6px;font-size:13px;min-width:280px;';
      sel.addEventListener('change', () => { activateProcess(sel.value); render(); });
      wrap.appendChild(sel);
      const anchor = document.getElementById('pmMapWrap');
      anchor.parentNode.insertBefore(wrap, anchor);
    } else {
      sel.parentNode.style.display = 'flex';
    }
    sel.innerHTML = state.processOrder.map(pid => {
      const p = state.processes[pid];
      const label = `${p.pid}${p.title ? ' — '+p.title : ''}`;
      return `<option value="${esc(pid)}"${pid===state.currentPid?' selected':''}>${esc(label)}</option>`;
    }).join('');
  }

  function ensureLayoutModeSelector(){
    if (document.getElementById('pmLayoutMode')) return;
    const anchor = document.getElementById('pmMapWrap');
    if (!anchor || !anchor.parentNode) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:6px 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    wrap.innerHTML = `<label style="font-size:12px;font-weight:600;color:#374151;">Layout mode:</label>`;
    const sel = document.createElement('select');
    sel.id = 'pmLayoutMode';
    sel.style.cssText = 'padding:6px 8px;border:1px solid #cfd6df;border-radius:6px;font-size:13px;';
    sel.innerHTML = `
      <option value="vertical">IDH Standard — Top-to-bottom (recommended)</option>
      <option value="horizontal">Horizontal Flow — Left-to-right</option>
      <option value="auto">Auto — minimize crossings</option>`;
    sel.value = state.layoutMode;
    sel.addEventListener('change', () => {
      state.layoutMode = sel.value;
      state.positions = {};
      state.view = { scale:1, tx:0, ty:0 };
      render();
    });
    wrap.appendChild(sel);
    anchor.parentNode.insertBefore(wrap, anchor);
  }

  function generate(){
    const ta = document.getElementById('pmData');
    const hasText = !!(ta && ta.value.trim());
    const isDirty = !!(ta && ta.dataset.dirty==='1');
    if (isDirty){
      resetAll();
      if (hasText) parseLegacyText(ta.value);
      ta.dataset.dirty='';
    } else if (!state.steps.length && hasText){
      parseLegacyText(ta.value); ta.dataset.dirty='';
    }
    if (!state.steps.length){ alert('No data to render. Upload the Excel file or paste data first.'); return; }
    renderProcessSelector();
    ensureLayoutModeSelector();
    render();
  }

  // ---------- Init ----------
  function init(){
    const btn = document.getElementById('pmGenerate'); if (!btn) return;
    btn.addEventListener('click', generate);
    document.getElementById('pmDownloadPdf')?.addEventListener('click', downloadPdf);
    document.getElementById('pmDownloadPng')?.addEventListener('click', downloadPng);
    document.getElementById('pmDownloadSvg')?.addEventListener('click', downloadSvg);
    document.getElementById('pmDownloadVsdx')?.addEventListener('click', downloadVsdx);
    let tplBtn = document.getElementById('pmDownloadTemplate');
    if (!tplBtn){
      const vsdxBtn = document.getElementById('pmDownloadVsdx');
      if (vsdxBtn && vsdxBtn.parentNode){
        tplBtn = document.createElement('button');
        tplBtn.type='button'; tplBtn.className='pm-btn'; tplBtn.id='pmDownloadTemplate';
        tplBtn.textContent='Download Excel Template';
        vsdxBtn.parentNode.insertBefore(tplBtn, vsdxBtn.nextSibling);
        const rz = document.createElement('button');
        rz.type='button'; rz.className='pm-btn'; rz.id='pmResetView'; rz.textContent='Reset View';
        vsdxBtn.parentNode.insertBefore(rz, tplBtn.nextSibling);
        rz.addEventListener('click', () => {
          state.view = { scale:1, tx:0, ty:0 };
          state.positions = {}; state.collapsed = {};
          render();
        });
      }
    }
    document.getElementById('pmDownloadTemplate')?.addEventListener('click', downloadTemplate);

    const fi = document.getElementById('pmExcelFile');
    fi?.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      const token = ++lastExcelUploadToken;
      e.target.value='';
      if (f) handleExcel(f, token);
    });
    const ta = document.getElementById('pmData');
    if (ta){
      ta.value=''; ta.defaultValue=''; ta.dataset.dirty='';
      ta.setAttribute('autocomplete','off');
      ta.addEventListener('input', () => { ta.dataset.dirty='1'; });
    }
    const tab = document.querySelector('.tab[data-tab="processMap"]');
    if (tab){
      tab.addEventListener('click', () => {
        const svg = document.getElementById('pmMap');
        const ta2 = document.getElementById('pmData');
        if (svg && !svg.innerHTML.trim() && (state.steps.length || (ta2 && ta2.value.trim()))) generate();
      });
    }
    // Re-render on window resize so vertical layout keeps fitting browser width
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (state.steps.length) render(); }, 150);
    });
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

