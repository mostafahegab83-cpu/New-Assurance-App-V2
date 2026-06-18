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
    const slaRows = records.filter(r => num(r.targetSla) != null && num(r.actualSla) != null);
    if (!slaRows.length) {
      return {
        finding: "No SLA measurements were available in the reviewed scope.",
        action: "Capture target and actual SLA values for each process step to enable adherence monitoring."
      };
    }
    const adherent = slaRows.filter(r => num(r.actualSla) <= num(r.targetSla)).length;
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

    // Append custom user-added findings
    loadCustom().forEach(c => {
      findings.push({
        kind: "custom",
        id: c.id,
        category: c.category || "Custom",
        finding: c.finding || "",
        action:  c.action  || ""
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
    let visibleFindings = categoryFilter
      ? result.findings.filter(f => String(f.category).toLowerCase() === categoryFilter.toLowerCase())
      : result.findings;
    if (excludeSet) {
      visibleFindings = visibleFindings.filter(f => !excludeSet.has(String(f.category).toLowerCase()));
    }

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
          <h3 class="dash-section-title" style="margin:0;">Findings Summary</h3>
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
  function openEditor({ title, category, finding, action, lockCategory, onSave }) {
    closeEditor();
    const wrap = document.createElement("div");
    wrap.id = "fsEditorBackdrop";
    wrap.innerHTML = `
      <div class="fs-modal" role="dialog" aria-modal="true" aria-labelledby="fsEditorTitle">
        <h4 id="fsEditorTitle">${escapeHtml(title)}</h4>
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
      openEditor({
        title: "Add Finding",
        category: presetCat,
        finding: "",
        action: "",
        lockCategory: !!presetCat,
        onSave: ({ category, finding, action }) => {
          const list = loadCustom();
          list.push({ id: uid(), category: category || presetCat, finding, action });
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
