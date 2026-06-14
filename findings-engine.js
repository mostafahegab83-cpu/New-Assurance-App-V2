/* =============================================================================
 * Automated Findings Engine — Process Assurance Tracker
 * -----------------------------------------------------------------------------
 * Produces a fixed Findings × Action table with one recommended action per
 * finding. Findings:
 *   1) Non-Compliance — NC number, percentage and leading reason
 *   2) SLA Adherence — adherence % and End Variance (days) if applicable
 *   3) CAPA — number, status mix and effectiveness
 *   4) Risk — number, type, level and mitigation status
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
  const MAX_WORDS_PER_LINE = 15;
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
    return escapeHtml(lines.join("<br> ")).replace(/&lt;br&gt;/g, "<br>");
  };

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
  function analyze(records) {
    const rows = Array.isArray(records) ? records : [];
    const findings = [
      { category: "Non-Compliance", ...ncFinding(rows) },
      { category: "SLA Adherence",  ...slaFinding(rows) },
      { category: "CAPA",           ...capaFinding(rows) },
      { category: "Risk",           ...riskFinding(rows) }
    ];
    return {
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      findings,
      summary: findings.map(f => `${f.category}: ${f.finding} Action: ${f.action}`)
    };
  }

  function render(targetEl, result) {
    if (!targetEl) return;
    const rows = result.findings.map(f => `
      <tr>
        <td class="fs-cat-cell"><strong>${escapeHtml(f.category)}</strong><div class="fs-msg">${wrapWords(f.finding)}</div></td>
        <td class="fs-action-cell">${wrapWords(f.action)}</td>
      </tr>`).join("");

    targetEl.innerHTML = `
      <div class="fs-head">
        <div>
          <h3 class="dash-section-title" style="margin:0;">Findings Summary</h3>
          <p class="fs-meta">Auto-generated from ${result.recordCount} record(s) · ${new Date(result.generatedAt).toLocaleString()}</p>
        </div>
      </div>
      <table class="fs-table">
        <thead>
          <tr>
            <th style="width:55%;">Finding</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  global.FindingsEngine = { analyze, render };
})(window);
