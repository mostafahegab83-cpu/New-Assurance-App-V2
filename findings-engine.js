/* =============================================================================
 * Automated Findings Engine — Process Assurance Tracker
 * -----------------------------------------------------------------------------
 * Consumes the dashboard's filtered record set and produces:
 *   1) A structured findings[] array (category, severity, tag, score, message)
 *   2) A human-readable summary (array of bullet strings)
 *
 * Rules are modular and DYNAMIC — no hard-coded reason / category lists.
 * To add a new rule: push another function into RULES below.
 * To extend categories/reasons: nothing to change; the engine groups by the
 * actual values present in the data.
 *
 * Exposed globally as window.FindingsEngine.
 * ============================================================================= */
(function (global) {
  "use strict";

  /* ---------- thresholds (single source of truth, easy to tune) ---------- */
  const TH = {
    compliancePct: 85,
    slaAdherencePct: 85,
    capaEffectivenessPct: 85,
    processEndVarianceDays: 3,
    ncReasonConcentrationPct: 50,
    rootCauseConcentrationPct: 70,
    highRiskSharePct: 60,
    capaBacklogPct: 40,   // open (in progress + pending + overdue) share
    capaIneffectivePct: 20
  };

  /* ---------- tiny helpers ---------- */
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const isNc = r => {
    const c = String(r.compliance || "").toLowerCase();
    return c.includes("non-compliant") || c.includes("partially");
  };
  const groupBy = (rows, key) => rows.reduce((acc, r) => {
    const k = (r[key] == null || r[key] === "") ? "N/A" : String(r[key]).trim();
    if (k === "N/A") return acc;
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

  /* ---------- severity / scoring ---------- */
  const SEV_SCORE = { High: 3, Medium: 2, Low: 1 };
  function finding(category, severity, tag, message, extra = {}) {
    return {
      category, severity, tag,
      score: SEV_SCORE[severity] || 1,
      message,
      ...extra
    };
  }

  /* ===========================================================================
   * RULES — each rule returns 0..N findings. Easy to add new rules: just push
   * another function. Each rule receives the same context object.
   * =========================================================================== */
  const RULES = [];

  /* ---------- A. KPI rules ---------- */
  RULES.push(function kpiCompliance(ctx) {
    const { kpi } = ctx;
    if (kpi.complianceBase === 0) return [];
    if (kpi.compliancePct < TH.compliancePct) {
      const sev = kpi.compliancePct < 60 ? "High" : "Medium";
      return [finding("Compliance", sev, "Compliance",
        `Compliance is below the acceptable level at ${kpi.compliancePct}% ` +
        `(threshold ${TH.compliancePct}%), indicating control weaknesses across ` +
        `${kpi.complianceBase} reviewed items.`)];
    }
    return [];
  });

  RULES.push(function kpiSla(ctx) {
    const { kpi } = ctx;
    if (kpi.slaSample === 0) return [];
    if (kpi.slaAdherencePct < TH.slaAdherencePct) {
      const sev = kpi.slaAdherencePct < 50 ? "High" : "Medium";
      return [finding("SLA", sev, "Performance",
        `SLA adherence is at ${kpi.slaAdherencePct}% across ${kpi.slaSample} ` +
        `measured steps, falling short of the ${TH.slaAdherencePct}% target.`)];
    }
    return [];
  });

  RULES.push(function kpiCapaEff(ctx) {
    const { kpi } = ctx;
    if (kpi.capaNeededCount === 0) return [];
    if (kpi.capaEffectivenessPct < TH.capaEffectivenessPct) {
      const sev = kpi.capaEffectivenessPct < 60 ? "High" : "Medium";
      return [finding("CAPA", sev, "Performance",
        `CAPA effectiveness stands at ${kpi.capaEffectivenessPct}% ` +
        `(${kpi.capaEffectiveCount}/${kpi.capaNeededCount}), below the ` +
        `${TH.capaEffectivenessPct}% expectation.`)];
    }
    return [];
  });

  /* ---------- B. Process delay analysis ---------- */
  RULES.push(function processDelays(ctx) {
    const { processSummary } = ctx;
    const delayed = processSummary.filter(p => p.endVariance != null && p.endVariance > TH.processEndVarianceDays);
    if (!delayed.length) return [];
    const max = delayed.reduce((m, p) => p.endVariance > m.endVariance ? p : m, delayed[0]);
    const out = [finding("Process", delayed.length >= 3 ? "High" : "Medium", "Performance",
      `${delayed.length} process(es) exceed the ${TH.processEndVarianceDays}-day delay ` +
      `threshold (on "${max.name}").`)];

    // Execution-bottleneck pattern: started on time but finished late
    const bottlenecks = delayed.filter(p => p.startVariance != null && Math.abs(p.startVariance) <= 1);
    if (bottlenecks.length) {
      out.push(finding("Process", "Medium", "Root Cause",
        `${bottlenecks.length} process(es) started on time but finished late ` +
        `(e.g. "${bottlenecks[0].name}") — pattern indicates an execution bottleneck rather than a planning issue.`));
    }
    return out;
  });

  /* ---------- C. SLA per-step analysis ---------- */
  RULES.push(function slaBreaches(ctx) {
    const breaches = ctx.slaSteps.filter(s => s.actual > s.target);
    if (!breaches.length) return [];
    const worst = breaches.reduce((m, s) => (s.actual - s.target) > (m.actual - m.target) ? s : m, breaches[0]);
    const breachPct = pct(breaches.length, ctx.slaSteps.length);
    return [finding("SLA", breachPct >= 50 ? "High" : "Medium", "Performance",
      `${breaches.length} of ${ctx.slaSteps.length} measured steps (${breachPct}%) breach their target SLA. ` +
      `Worst case: "${worst.label}" took ${worst.actual} vs target ${worst.target}.`)];
  });

  /* ---------- D. Non-compliance analysis (fully dynamic) ---------- */
  RULES.push(function ncReasonConcentration(ctx) {
    const reasons = groupBy(ctx.ncRows, "complianceReason");
    const t = topEntry(reasons);
    if (!t.key || !t.total) return [];
    const out = [];
    if (t.share >= TH.ncReasonConcentrationPct) {
      out.push(finding("Non-Compliance", "High", "Compliance",
        `Non-compliance is concentrated: "${t.key}" alone accounts for ${t.count} of ${t.total} NCs ` +
        `(${t.share.toFixed(1)}%). Targeted action on this reason will yield the largest improvement.`));
    } else {
      out.push(finding("Non-Compliance", "Medium", "Compliance",
        `Leading NC reason is "${t.key}" at ${t.count}/${t.total} (${t.share.toFixed(1)}%).`));
    }
    return out;
  });

  RULES.push(function ncCategoryDistribution(ctx) {
    const cats = groupBy(ctx.ncRows, "ncCategory");
    const t = topEntry(cats);
    if (!t.key || !t.total) return [];
    return [finding("Non-Compliance", t.share >= 60 ? "High" : "Low", "Root Cause",
      `NCs are distributed across categories with "${t.key}" leading at ${t.share.toFixed(1)}% — ` +
      `focus improvement efforts on this dimension first.`)];
  });

  RULES.push(function ncTypeMix(ctx) {
    const types = groupBy(ctx.ncRows, "ncType");
    const major = types["Major"] || 0;
    const total = Object.values(types).reduce((a, b) => a + b, 0);
    if (!total || !major) return [];
    const share = pct(major, total);
    if (share >= 30) {
      const scope = total === 1 ? "non-compliances" : "all non-compliances";
      return [finding("Non-Compliance", share >= 50 ? "High" : "Medium", "Compliance",
        `Major NCs represent ${major}/${total} (${share}%) of ${scope} — elevated severity profile.`)];
    }
    return [];
  });

  /* ---------- E. Root cause analysis ---------- */
  RULES.push(function rootCauseConcentration(ctx) {
    const rc = groupBy(ctx.records.filter(r => r.rcCategory), "rcCategory");
    const t = topEntry(rc);
    if (!t.key || !t.total) return [];
    if (t.share >= TH.rootCauseConcentrationPct) {
      if (t.total === 1) {
        const isHuman = /human/i.test(t.key);
        const tail = isHuman
          ? "recommend quick training/coaching to prevent recurrence."
          : "address this single root cause with a targeted corrective action.";
        return [finding("Root Cause", "High", "Root Cause",
          `Root cause is in "${t.key}" (1/1, 100.0%) — ${tail}`)];
      }
      return [finding("Root Cause", "High", "Root Cause",
        `Root causes are heavily concentrated in "${t.key}" (${t.count}/${t.total}, ${t.share.toFixed(1)}%) — ` +
        `systemic issue requiring structural intervention rather than per-incident fixes.`)];
    }
    return [finding("Root Cause", "Low", "Root Cause",
      `Top root-cause category is "${t.key}" at ${t.share.toFixed(1)}% of analysed items.`)];
  });

  /* ---------- F. CAPA backlog / effectiveness ---------- */
  RULES.push(function capaBacklog(ctx) {
    const capa = ctx.records.filter(r => r.capaNeeded === "Yes" && r.capaStatus);
    if (!capa.length) return [];
    const status = groupBy(capa, "capaStatus");
    const open = (status["In Progress"] || 0) + (status["Pending"] || 0) + (status["Overdue"] || 0);
    const overdue = status["Overdue"] || 0;
    const closed = status["Closed"] || 0;
    const openShare = pct(open, capa.length);
    const closedShare = pct(closed, capa.length);
    const out = [];

    if (openShare >= TH.capaBacklogPct) {
      out.push(finding("CAPA", "High", "Performance",
        `CAPA backlog is high: ${open}/${capa.length} (${openShare}%) actions are still open ` +
        `(${closedShare}% closed). Delayed resolution increases recurrence risk.`));
    }
    if (overdue > 0) {
      out.push(finding("CAPA", "High", "Risk",
        `${overdue} CAPA action(s) are overdue — escalation recommended to action owners.`));
    }
    const ineff = ctx.records.filter(r => r.effectiveness === "Ineffective").length +
                  ctx.records.filter(r => r.effectiveness === "Partially Effective").length * 0.5;
    const ineffShare = pct(ineff, capa.length);
    if (ineffShare >= TH.capaIneffectivePct) {
      out.push(finding("CAPA", "Medium", "Root Cause",
        `${ineffShare}% of CAPA actions are ineffective or only partially effective — ` +
        `corrective actions are not addressing root causes adequately.`));
    }
    return out;
  });

  /* ---------- G. Risk analysis ---------- */
  RULES.push(function riskExposure(ctx) {
    const risks = ctx.records.filter(r => r.riskExist === "Yes");
    if (!risks.length) return [];
    const levels = groupBy(risks, "riskLevel");
    const high = levels["High"] || 0;
    const highShare = pct(high, risks.length);
    const out = [];
    if (highShare >= TH.highRiskSharePct) {
      out.push(finding("Risk", "High", "Risk",
        `Critical exposure: ${high}/${risks.length} (${highShare}%) of recorded risks are rated High.`));
    }
    const open = risks.filter(r => r.mitigation === "Open").length;
    const closed = risks.filter(r => r.mitigation === "Closed" || r.mitigation === "Mitigated").length;
    if (open > 0) {
      out.push(finding("Risk", open >= 5 ? "High" : "Medium", "Risk",
        `${open} risk(s) remain Open without mitigation across ${risks.length} total — ongoing exposure.`));
    }
    if (closed >= risks.length * 0.8 && ctx.ncRows.length > risks.length * 0.5) {
      out.push(finding("Risk", "Medium", "Root Cause",
        `Most risks are marked closed/mitigated yet non-compliance volume remains material — ` +
        `verify whether mitigations are truly effective.`));
    }
    return out;
  });

  /* ---------- H. Cross-analysis ---------- */
  RULES.push(function crossAnalysis(ctx) {
    const out = [];
    const ncReasons = groupBy(ctx.ncRows, "complianceReason");

    // SLA Breach NCs ↔ SLA adherence
    const slaBreachNcs = ncReasons["SLA Breach"] || 0;
    if (slaBreachNcs > 0 && ctx.kpi.slaAdherencePct < TH.slaAdherencePct) {
      out.push(finding("Cross-Analysis", "High", "Compliance",
        `${slaBreachNcs} NC(s) are attributed to "SLA Breach" while overall SLA adherence is only ` +
        `${ctx.kpi.slaAdherencePct}% — SLA performance is directly driving non-compliance.`));
    }

    // Missing Evidence concentration
    const missingEv = ncReasons["Missing Evidence"] || 0;
    if (missingEv > 0 && pct(missingEv, ctx.ncRows.length) >= 30) {
      out.push(finding("Cross-Analysis", "High", "Compliance",
        `"Missing Evidence" appears in ${missingEv} NC(s) (${pct(missingEv, ctx.ncRows.length)}%) — ` +
        `audit-readiness risk; tighten evidence-capture controls.`));
    }

    // Human-related root cause + compliance dip
    const rc = groupBy(ctx.records.filter(r => r.rcCategory), "rcCategory");
    const human = (rc["Human error"] || 0) + (rc["Lack of training"] || 0);
    const rcTotal = Object.values(rc).reduce((a, b) => a + b, 0);
    if (rcTotal && pct(human, rcTotal) >= 40 && ctx.kpi.compliancePct < TH.compliancePct) {
      out.push(finding("Cross-Analysis", "Medium", "Root Cause",
        `Human-related root causes account for ${pct(human, rcTotal)}% of analysed items while ` +
        `compliance sits at ${ctx.kpi.compliancePct}% — training & awareness investment likely to lift compliance.`));
    }

    // Ineffective CAPA + repeated NCs
    const ineff = ctx.records.filter(r => r.effectiveness === "Ineffective").length;
    if (ineff > 0 && ctx.ncRows.length >= 5) {
      out.push(finding("Cross-Analysis", "Medium", "Root Cause",
        `${ineff} CAPA(s) marked ineffective alongside ${ctx.ncRows.length} active NCs — ` +
        `weak corrective actions are leaving issues unresolved.`));
    }

    // Process delays ↔ SLA breaches
    const delayedCount = ctx.processSummary.filter(p => p.endVariance != null && p.endVariance > TH.processEndVarianceDays).length;
    const slaBreachCount = ctx.slaSteps.filter(s => s.actual > s.target).length;
    if (delayedCount >= 2 && slaBreachCount >= 2) {
      out.push(finding("Cross-Analysis", "Medium", "Performance",
        `${delayedCount} delayed processes co-occur with ${slaBreachCount} SLA-breached steps — ` +
        `process execution issues are cascading into SLA misses.`));
    }
    return out;
  });

  /* ===========================================================================
   * Context builder — derives the inputs each rule needs from raw records
   * =========================================================================== */
  function buildContext(records) {
    const compBase = records.filter(r => ["Compliant", "Non-Compliant", "Partially Compliant"].includes(r.compliance));
    const compliant = compBase.filter(r => r.compliance === "Compliant").length;
    const ncRows = records.filter(isNc);

    const slaRows = records.filter(r => num(r.targetSla) != null && num(r.actualSla) != null);
    const slaAdherent = slaRows.filter(r => num(r.actualSla) <= num(r.targetSla)).length;

    const capaNeededRows = records.filter(r => r.capaNeeded === "Yes");
    const capaEffectiveRows = capaNeededRows.filter(r => r.effectiveness === "Effective");

    const totalRisks = records.filter(r => r.riskExist === "Yes").length;
    const openRisks = records.filter(r => r.riskExist === "Yes" && r.mitigation !== "Closed" && r.mitigation !== "Mitigated").length;

    const kpi = {
      complianceBase: compBase.length,
      compliancePct: compBase.length ? Math.round((compliant / compBase.length) * 100) : 0,
      slaSample: slaRows.length,
      slaAdherencePct: slaRows.length ? Math.round((slaAdherent / slaRows.length) * 100) : 0,
      ncCount: ncRows.length,
      totalRisks, openRisks,
      capaNeededCount: capaNeededRows.length,
      capaEffectiveCount: capaEffectiveRows.length,
      capaEffectivenessPct: capaNeededRows.length ? Math.round((capaEffectiveRows.length / capaNeededRows.length) * 100) : 0
    };

    // Per-process timeline summary (use earliest planned start / latest planned end)
    const groups = {};
    records.forEach(r => {
      const k = (r.processName || "").trim();
      if (!k) return;
      (groups[k] = groups[k] || []).push(r);
    });
    const processSummary = Object.entries(groups).map(([name, rows]) => {
      let first = null, firstD = null, last = null, lastD = null;
      rows.forEach(r => {
        const ps = r.plannedStartDate ? new Date(r.plannedStartDate) : null;
        const pe = r.plannedEndDate ? new Date(r.plannedEndDate) : null;
        if (ps && !isNaN(ps) && (!firstD || ps < firstD)) { firstD = ps; first = r; }
        if (pe && !isNaN(pe) && (!lastD || pe > lastD)) { lastD = pe; last = r; }
      });
      return {
        name,
        startVariance: first ? diffDays(first.plannedStartDate, first.actualStartDate) : null,
        endVariance: last ? diffDays(last.plannedEndDate, last.actualEndDate) : null
      };
    });

    // Per-step SLA list
    const slaSteps = slaRows.map(r => ({
      label: (r.processPhase || r.processName || r.controlItem || "Step").trim() || "Step",
      target: num(r.targetSla),
      actual: num(r.actualSla)
    }));

    return { records, ncRows, kpi, processSummary, slaSteps };
  }

  /* ===========================================================================
   * Public API
   * =========================================================================== */
  function analyze(records) {
    const rows = Array.isArray(records) ? records : [];
    const ctx = buildContext(rows);

    let findings = [];
    RULES.forEach(rule => {
      try {
        const r = rule(ctx);
        if (Array.isArray(r)) findings = findings.concat(r);
      } catch (e) {
        // a single rule failure must never crash the report
        console.warn("Findings rule failed:", rule.name, e);
      }
    });

    // sort by score desc, then category
    findings.sort((a, b) => (b.score - a.score) || a.category.localeCompare(b.category));

    if (!findings.length) {
      findings.push(finding("Overall", "Low", "Performance",
        "No material issues detected against current thresholds. Continue monitoring."));
    }

    const summary = findings.map(f => f.message);

    return {
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      kpi: ctx.kpi,
      findings,
      summary
    };
  }

  /* ---------- Renderer: builds HTML for the dashboard + PDF section ---------- */
  function render(targetEl, result) {
    if (!targetEl) return;
    const sevClass = { High: "fs-sev-high", Medium: "fs-sev-med", Low: "fs-sev-low" };
    const head = `
      <div class="fs-head">
        <div>
          <h3 class="dash-section-title" style="margin:0;">Findings Summary</h3>
          <p class="fs-meta">Auto-generated from ${result.recordCount} record(s) · ${new Date(result.generatedAt).toLocaleString()}</p>
        </div>
        <div class="fs-kpis">
          <span><b>${result.findings.length}</b> findings</span>
          <span class="fs-sev-high">${result.findings.filter(f=>f.severity==='High').length} High</span>
          <span class="fs-sev-med">${result.findings.filter(f=>f.severity==='Medium').length} Medium</span>
          <span class="fs-sev-low">${result.findings.filter(f=>f.severity==='Low').length} Low</span>
        </div>
      </div>`;
    const items = result.findings.map(f => `
      <li class="fs-item ${sevClass[f.severity] || ''}">
        <div class="fs-row">
          <span class="fs-badge ${sevClass[f.severity] || ''}">${f.severity}</span>
          <span class="fs-cat">${f.category}</span>
          <span class="fs-tag">${f.tag}</span>
        </div>
        <p class="fs-msg">${f.message}</p>
      </li>`).join("");

    targetEl.innerHTML = `
      ${head}
      <ul class="fs-list">${items}</ul>
    `;
  }

  global.FindingsEngine = { analyze, render, RULES, TH };
})(window);
