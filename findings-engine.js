/* =============================================================================
 * Automated Findings Engine — Process Assurance Tracker
 * -----------------------------------------------------------------------------
 * Consumes the dashboard's filtered record set and produces:
 *   1) A structured findings[] array (category, severity, tag, score, message)
 *   2) A human-readable summary (array of bullet strings)
 *
 * Rules are modular and DYNAMIC — no hard-coded reason / category lists.
 *
 * DUPLICATION GUARD (added):
 *   Every rule that counts NCs, CAPAs, risks, processes, or SLA steps now
 *   operates on a DEDUPED view of the records. Two records are considered the
 *   same finding when their (auditDate | processName | controlItem | reason)
 *   tuple matches. Cross-rules additionally require a real join key
 *   (processName and/or auditDate) before correlating two signals — if the
 *   join cannot be verified, the rule stays silent rather than report a
 *   possibly-duplicated correlation.
 *
 * Exposed globally as window.FindingsEngine.
 * ============================================================================= */
(function (global) {
  "use strict";

  /* ---------- thresholds (single source of truth, easy to tune) ---------- */
  const TH = {
    compliancePct: 80,
    slaAdherencePct: 75,
    capaEffectivenessPct: 90,
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
  const norm = v => (v == null ? "" : String(v).trim().toLowerCase());
  const toDate = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
  const dateKey = v => { const d = toDate(v); return d ? d.toISOString().slice(0,10) : ""; };

  const isNc = r => {
    const c = norm(r.compliance);
    return c.includes("non-compliant") || c.includes("partially");
  };

  /* Dedupe key — identifies a unique observation. If a row is missing all
     identifying fields it gets a synthetic key so it's still counted once. */
  const obsKey = r => {
    const k = [
      dateKey(r.auditDate),
      norm(r.processName),
      norm(r.processPhase),
      norm(r.controlItem),
      norm(r.complianceReason || r.ncCategory || r.ncType),
      norm(r.compliance)
    ].join("|");
    return k.replace(/^\|+|\|+$/g, "") || `__row_${r.__idx ?? Math.random()}`;
  };
  const dedupe = rows => {
    const seen = new Set();
    const out = [];
    rows.forEach(r => { const k = obsKey(r); if (!seen.has(k)) { seen.add(k); out.push(r); } });
    return out;
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
    return { category, severity, tag, score: SEV_SCORE[severity] || 1, message, ...extra };
  }

  /* ===========================================================================
   * RULES
   * =========================================================================== */
  const RULES = [];

  /* ---------- A. KPI rules (operate on deduped base) ---------- */
  RULES.push(function kpiCompliance(ctx) {
    const { kpi } = ctx;
    if (kpi.complianceBase === 0) return [];
    if (kpi.compliancePct < TH.compliancePct) {
      const sev = kpi.compliancePct < 60 ? "High" : "Medium";
      return [finding("Compliance", sev, "Compliance",
        `Compliance is below the acceptable level at ${kpi.compliancePct}% ` +
        `(threshold ${TH.compliancePct}%), indicating control weaknesses across ` +
        `${kpi.complianceBase} unique reviewed items.`)];
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
        `unique measured steps, falling short of the ${TH.slaAdherencePct}% target.`)];
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
    const avg = Math.round(delayed.reduce((s, p) => s + p.endVariance, 0) / delayed.length);
    const out = [finding("Process", delayed.length >= 3 ? "High" : "Medium", "Performance",
      `${delayed.length} unique process(es) exceed the ${TH.processEndVarianceDays}-day delay ` +
      `threshold (avg ${avg}d, max ${max.endVariance}d on "${max.name}").`)];

    // "Started on time" = on-time, early, or within 1 day late tolerance.
    // Do not use Math.abs(), because early starts such as -2 are still on time.
    const bottlenecks = delayed.filter(p => p.startVariance != null && p.startVariance <= 1);
    if (bottlenecks.length) {
      out.push(finding("Process", "Medium", "Root Cause",
        `${bottlenecks.length} process(es) started on time but finished late ` +
        `(e.g. "${bottlenecks[0].name}") — pattern indicates an execution bottleneck rather than a planning issue.`));
    }
    return out;
  });

  /* ---------- C. SLA per-step analysis (deduped by process+phase+date) ---------- */
  RULES.push(function slaBreaches(ctx) {
    const breaches = ctx.slaSteps.filter(s => s.actual > s.target);
    if (!breaches.length) return [];
    const worst = breaches.reduce((m, s) => (s.actual - s.target) > (m.actual - m.target) ? s : m, breaches[0]);
    const breachPct = pct(breaches.length, ctx.slaSteps.length);
    return [finding("SLA", breachPct >= 50 ? "High" : "Medium", "Performance",
      `${breaches.length} of ${ctx.slaSteps.length} unique measured steps (${breachPct}%) breach their target SLA. ` +
      `Worst case: "${worst.label}" took ${worst.actual} vs target ${worst.target}.`)];
  });

  /* ---------- D. Non-compliance analysis (deduped NCs) ---------- */
  RULES.push(function ncReasonConcentration(ctx) {
    const reasons = groupBy(ctx.ncRows, "complianceReason");
    const t = topEntry(reasons);
    if (!t.key || !t.total) return [];
    if (t.share >= TH.ncReasonConcentrationPct) {
      return [finding("Non-Compliance", "High", "Compliance",
        `Non-compliance is concentrated: "${t.key}" alone accounts for ${t.count} of ${t.total} unique NCs ` +
        `(${t.share.toFixed(1)}%). Targeted action on this reason will yield the largest improvement.`)];
    }
    return [finding("Non-Compliance", "Medium", "Compliance",
      `Leading NC reason is "${t.key}" at ${t.count}/${t.total} unique NCs (${t.share.toFixed(1)}%).`)];
  });

  RULES.push(function ncCategoryDistribution(ctx) {
    const cats = groupBy(ctx.ncRows, "ncCategory");
    const t = topEntry(cats);
    if (!t.key || !t.total) return [];
    return [finding("Non-Compliance", t.share >= 60 ? "High" : "Low", "Root Cause",
      `NCs are distributed across categories with "${t.key}" leading at ${t.share.toFixed(1)}% of ${t.total} unique NCs — ` +
      `focus improvement efforts on this dimension first.`)];
  });

  RULES.push(function ncTypeMix(ctx) {
    const types = groupBy(ctx.ncRows, "ncType");
    const major = types["Major"] || 0;
    const total = Object.values(types).reduce((a, b) => a + b, 0);
    if (!total || !major) return [];
    const share = pct(major, total);
    if (share >= 30) {
      return [finding("Non-Compliance", share >= 50 ? "High" : "Medium", "Compliance",
        `Major NCs represent ${major}/${total} (${share}%) of unique non-compliances — elevated severity profile.`)];
    }
    return [];
  });

  /* ---------- E. Root cause analysis ---------- */
  RULES.push(function rootCauseConcentration(ctx) {
    const rc = groupBy(ctx.records.filter(r => r.rcCategory), "rcCategory");
    const t = topEntry(rc);
    if (!t.key || !t.total) return [];
    if (t.share >= TH.rootCauseConcentrationPct) {
      return [finding("Root Cause", "High", "Root Cause",
        `Root causes are heavily concentrated in "${t.key}" (${t.count}/${t.total} unique items, ${t.share.toFixed(1)}%) — ` +
        `systemic issue requiring structural intervention rather than per-incident fixes.`)];
    }
    return [finding("Root Cause", "Low", "Root Cause",
      `Top root-cause category is "${t.key}" at ${t.share.toFixed(1)}% of analysed unique items.`)];
  });

  /* ---------- F. CAPA backlog / effectiveness (deduped CAPAs) ---------- */
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
        `CAPA backlog is high: ${open}/${capa.length} unique actions (${openShare}%) are still open ` +
        `(${closedShare}% closed). Delayed resolution increases recurrence risk.`));
    }
    if (overdue > 0) {
      out.push(finding("CAPA", "High", "Risk",
        `${overdue} unique CAPA action(s) are overdue — escalation recommended to action owners.`));
    }
    const ineff = ctx.records.filter(r => r.effectiveness === "Ineffective").length +
                  ctx.records.filter(r => r.effectiveness === "Partially Effective").length * 0.5;
    const ineffShare = pct(ineff, capa.length);
    if (ineffShare >= TH.capaIneffectivePct) {
      out.push(finding("CAPA", "Medium", "Root Cause",
        `${ineffShare}% of unique CAPA actions are ineffective or only partially effective — ` +
        `corrective actions are not addressing root causes adequately.`));
    }
    return out;
  });

  /* ---------- G. Risk analysis (deduped risks) ---------- */
  RULES.push(function riskExposure(ctx) {
    const risks = ctx.records.filter(r => r.riskExist === "Yes");
    if (!risks.length) return [];
    const levels = groupBy(risks, "riskLevel");
    const high = levels["High"] || 0;
    const highShare = pct(high, risks.length);
    const out = [];
    if (highShare >= TH.highRiskSharePct) {
      out.push(finding("Risk", "High", "Risk",
        `Critical exposure: ${high}/${risks.length} unique risks (${highShare}%) are rated High.`));
    }
    const open = risks.filter(r => r.mitigation === "Open").length;
    const closed = risks.filter(r => r.mitigation === "Closed" || r.mitigation === "Mitigated").length;
    if (open > 0) {
      out.push(finding("Risk", open >= 5 ? "High" : "Medium", "Risk",
        `${open} unique risk(s) remain Open without mitigation across ${risks.length} total — ongoing exposure.`));
    }
    // Cross signal: only emit if both sides share at least one common processName
    if (closed >= risks.length * 0.8 && ctx.ncRows.length > risks.length * 0.5) {
      const riskProcs = new Set(risks.map(r => norm(r.processName)).filter(Boolean));
      const ncProcs = new Set(ctx.ncRows.map(r => norm(r.processName)).filter(Boolean));
      const shared = [...riskProcs].filter(p => ncProcs.has(p));
      if (shared.length > 0) {
        out.push(finding("Risk", "Medium", "Root Cause",
          `Most risks are marked closed/mitigated yet ${ctx.ncRows.length} unique NC(s) persist in the same process(es) ` +
          `(${shared.length} shared) — verify whether mitigations are truly effective.`));
      }
      // else: cannot confirm the two populations describe the same processes → stay silent
    }
    return out;
  });

  /* ---------- H. Cross-analysis (every correlation requires a real join key) ---------- */
  RULES.push(function crossAnalysis(ctx) {
    const out = [];
    const ncReasons = groupBy(ctx.ncRows, "complianceReason");

    /* H1. SLA Breach NCs ↔ SLA adherence
       Join: NC.processName must overlap with at least one SLA-measured step.
       Without that overlap we cannot claim SLA performance is "driving" NCs. */
    const slaBreachNcs = (ctx.ncRows || []).filter(r => norm(r.complianceReason) === "sla breach");
    if (slaBreachNcs.length > 0 && ctx.kpi.slaAdherencePct < TH.slaAdherencePct) {
      const slaProcs = new Set(ctx.slaSteps.map(s => norm(s.processName)).filter(Boolean));
      const overlapping = slaBreachNcs.filter(r => slaProcs.has(norm(r.processName)));
      if (overlapping.length > 0) {
        out.push(finding("Cross-Analysis", "High", "Compliance",
          `${overlapping.length} unique NC(s) attributed to "SLA Breach" occur in processes that also show ` +
          `SLA misses (overall SLA adherence ${ctx.kpi.slaAdherencePct}%) — SLA performance is directly driving non-compliance.`));
      }
      // else: cannot prove the NCs and the SLA breaches refer to the same processes → stay silent
    }

    /* H2. Missing Evidence concentration — pure share within deduped NCs, safe to report */
    const missingEv = ncReasons["Missing Evidence"] || 0;
    if (missingEv > 0 && pct(missingEv, ctx.ncRows.length) >= 30) {
      out.push(finding("Cross-Analysis", "High", "Compliance",
        `"Missing Evidence" appears in ${missingEv} of ${ctx.ncRows.length} unique NC(s) (${pct(missingEv, ctx.ncRows.length)}%) — ` +
        `audit-readiness risk; tighten evidence-capture controls.`));
    }

    /* H3. Human-related root cause + compliance dip — aggregate share, deduped base */
    const rc = groupBy(ctx.records.filter(r => r.rcCategory), "rcCategory");
    const human = (rc["Human error"] || 0) + (rc["Lack of training"] || 0);
    const rcTotal = Object.values(rc).reduce((a, b) => a + b, 0);
    if (rcTotal && pct(human, rcTotal) >= 40 && ctx.kpi.compliancePct < TH.compliancePct) {
      out.push(finding("Cross-Analysis", "Medium", "Root Cause",
        `Human-related root causes account for ${pct(human, rcTotal)}% of ${rcTotal} unique analysed items while ` +
        `compliance sits at ${ctx.kpi.compliancePct}% — training & awareness investment likely to lift compliance.`));
    }

    /* H4. Ineffective CAPA + RECURRENT NCs (date-aware + join on processName/area).
       Only NCs raised AFTER the ineffective CAPA's reference date AND in the same
       process as that CAPA are counted as recurrence evidence. */
    const ineffRows = ctx.records.filter(r => r.effectiveness === "Ineffective");
    let recurrence = 0, earliestRef = null;
    ineffRows.forEach(ir => {
      const ref = toDate(ir.capaCloseDate) || toDate(ir.auditDate);
      if (!ref) return;
      if (!earliestRef || ref < earliestRef) earliestRef = ref;
      const proc = norm(ir.processName);
      if (!proc) return; // can't safely join without process key
      ctx.ncRows.forEach(nc => {
        const d = toDate(nc.auditDate);
        if (d && d > ref && norm(nc.processName) === proc) recurrence++;
      });
    });
    if (earliestRef && recurrence >= 3) {
      out.push(finding("Cross-Analysis", "Medium", "Root Cause",
        `${ineffRows.length} CAPA(s) marked ineffective, followed by ${recurrence} new NC(s) in the SAME process(es) ` +
        `in later audits (after ${earliestRef.toISOString().slice(0,10)}) — corrective actions are not preventing recurrence.`));
    }
    // else: insufficient evidence (either no later audit, or no shared process) → stay silent.

    /* H5. Delayed processes ↔ SLA breaches.
       Simplified rule (per user request):
         - A process is considered "delayed" if it has at least ONE SLA breach
           in ANY of its phases (any step where actual > target).
         - Count of delayed processes = number of unique processNames with ≥1 breach.
         - Total SLA-breached steps = ALL breaches across all processes/phases. */
    const allBreaches = ctx.slaSteps.filter(s => s.actual > s.target);
    const delayedProcs = new Set(
      allBreaches.map(s => norm(s.processName)).filter(Boolean)
    );
    if (delayedProcs.size >= 1 && allBreaches.length >= 1) {
      out.push(finding("Cross-Analysis", delayedProcs.size >= 3 ? "High" : "Medium", "Performance",
        `${delayedProcs.size} delayed process(es) contain ${allBreaches.length} SLA-breached step(s) — ` +
        `each of these processes shows at least one phase exceeding its target SLA.`));
    }
    return out;
  });

  /* ===========================================================================
   * Context builder — derives the inputs each rule needs from raw records.
   * EVERY downstream collection is deduped here so rules don't double-count.
   * =========================================================================== */
  function buildContext(rawRecords) {
    const records = dedupe((Array.isArray(rawRecords) ? rawRecords : []).map((r, i) => ({ ...r, __idx: i })));

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

    // Per-process timeline summary
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

    // Per-step SLA list — now carries processName so cross-rules can join
    const slaSteps = slaRows.map(r => ({
      label: (r.processPhase || r.processName || r.controlItem || "Step").trim() || "Step",
      processName: (r.processName || "").trim(),
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
        console.warn("Findings rule failed:", rule.name, e);
      }
    });

    findings.sort((a, b) => (b.score - a.score) || a.category.localeCompare(b.category));

    if (!findings.length) {
      findings.push(finding("Overall", "Low", "Performance",
        "No material issues detected against current thresholds (after de-duplication). Continue monitoring."));
    }

    const summary = findings.map(f => f.message);

    return {
      generatedAt: new Date().toISOString(),
      recordCount: rows.length,
      uniqueRecordCount: ctx.records.length,
      kpi: ctx.kpi,
      findings,
      summary
    };
  }

  /* ---------- Renderer: builds HTML for the dashboard + PDF section ---------- */
  function render(targetEl, result) {
    if (!targetEl) return;
    const sevClass = { High: "fs-sev-high", Medium: "fs-sev-med", Low: "fs-sev-low" };
    const dedupNote = (result.uniqueRecordCount != null && result.uniqueRecordCount !== result.recordCount)
      ? ` · ${result.uniqueRecordCount} unique after de-dup`
      : "";
    const head = `
      <div class="fs-head">
        <div>
          <h3 class="dash-section-title" style="margin:0;">Findings Summary</h3>
          <p class="fs-meta">Auto-generated from ${result.recordCount} record(s)${dedupNote} · ${new Date(result.generatedAt).toLocaleString()}</p>
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
