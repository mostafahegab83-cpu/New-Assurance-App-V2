// =====================================================================
// AI Analyst — in-browser LLM for the Dashboard (WebLLM + WebGPU)
// ---------------------------------------------------------------------
// • Runs entirely on the user's machine. Records never leave the browser;
//   only the model weights are downloaded (once, then cached by the browser).
// • All numbers are computed here in code (buildFacts). The model only
//   interprets those facts — it is told not to calculate or invent figures.
// • Reads the Dashboard's filtered dataset via window.__getDashboardData
//   (defined in app.js). Read-only: never writes records.
// =====================================================================

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.87";

const MODELS = {
  tiny:    { label: "Tiny — Qwen2.5 0.5B (~400 MB, quick test)", f16: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC" },
  fast:    { label: "Fast — Qwen2.5 1.5B (~1 GB)",     f16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC" },
  quality: { label: "Better — Qwen2.5 3B (~2 GB)",     f16: "Qwen2.5-3B-Instruct-q4f16_1-MLC",   f32: "Qwen2.5-3B-Instruct-q4f32_1-MLC" }
};
const LANGS = { en: "English", ar: "Arabic", fr: "French" };

const NA = v => { const t = String(v ?? "").trim(); return !t || t.toUpperCase() === "N/A"; };
const clean = (v, dflt = "Unassigned") => NA(v) ? dflt : String(v).trim();
const pct = (n, d) => d ? Math.round(n / d * 100) : null;
const norm = v => String(v || "").trim().toLowerCase();
const trunc = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function countBy(rows, fn) {
  const out = {};
  rows.forEach(r => { const k = fn(r); if (k != null) out[k] = (out[k] || 0) + 1; });
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
const toObj = entries => Object.fromEntries(entries);

// ---------- Facts: every number the AI may use ----------
function buildFacts(payload) {
  const rows = payload.rows || [];
  const isNc = r => r.compliance === "Non-Compliant" || r.compliance === "Observation";
  const assessed = rows.filter(r => ["Compliant", "Non-Compliant", "Observation"].includes(r.compliance));
  const ncs = rows.filter(isNc);
  const slaMeasured = rows.filter(r => norm(r.taskDone) === "done" && ["on time", "late sla"].includes(norm(r.taskTiming)));
  const slaLate = slaMeasured.filter(r => norm(r.taskTiming) === "late sla").length;
  const capa = rows.filter(r => r.capaNeeded === "Yes");
  const capaAssessed = capa.filter(r => ["Effective", "Partially Effective", "Ineffective"].includes(r.effectiveness));
  const risks = rows.filter(r => r.riskExist === "Yes");
  const processes = new Set(rows.map(r => norm(r.processName)).filter(Boolean));

  const groupStats = keyFn => {
    const g = {};
    rows.forEach(r => (g[keyFn(r)] ||= []).push(r));
    return Object.entries(g).map(([name, rs]) => {
      const a = rs.filter(r => ["Compliant", "Non-Compliant", "Observation"].includes(r.compliance));
      const s = rs.filter(r => norm(r.taskDone) === "done" && ["on time", "late sla"].includes(norm(r.taskTiming)));
      const c = rs.filter(r => r.capaNeeded === "Yes");
      return {
        name, records: rs.length,
        compliancePct: pct(a.filter(r => r.compliance === "Compliant").length, a.length),
        findings: rs.filter(isNc).length,
        slaPct: pct(s.filter(r => norm(r.taskTiming) === "on time").length, s.length),
        capaOverdue: c.filter(r => r.capaStatus === "Overdue").length,
        highRisks: rs.filter(r => r.riskExist === "Yes" && r.riskLevel === "High").length
      };
    });
  };
  const worst = list => list
    .filter(x => x.findings || x.capaOverdue || x.highRisks)
    .sort((a, b) => (b.findings + 2 * b.capaOverdue + 2 * b.highRisks) - (a.findings + 2 * a.capaOverdue + 2 * a.highRisks))
    .slice(0, 8);

  // Repeat findings: same process with findings in 2+ distinct review months
  const ncMonths = {};
  ncs.forEach(r => {
    const m = String(r.auditDate || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    (ncMonths[clean(r.processName)] ||= new Set()).add(m);
  });
  const repeat = Object.entries(ncMonths).filter(([, s]) => s.size >= 2)
    .map(([p, s]) => ({ process: p, monthsWithFindings: s.size })).sort((a, b) => b.monthsWithFindings - a.monthsWithFindings).slice(0, 8);

  // Data-quality signals
  const dq = {
    findingsWithoutCategory: ncs.filter(r => NA(r.ncCategory)).length,
    findingsWithoutReason: ncs.filter(r => NA(r.complianceReasonCategory)).length,
    findingsWithoutRootCause: ncs.filter(r => NA(r.rootCause)).length,
    capaWithoutStatus: capa.filter(r => NA(r.capaStatus)).length,
    capaClosedNotAssessedForEffectiveness: capa.filter(r => r.capaStatus === "Closed" && !["Effective", "Partially Effective", "Ineffective"].includes(r.effectiveness)).length,
    stepsExcludedAsUnrated: payload.excludedUnrated || 0
  };

  const ncSamples = ncs
    .map(r => ({ process: clean(r.processName), dept: clean(r.processOwner), category: clean(r.ncCategory, "—"), severity: clean(r.severityLevel, "—"), text: trunc(!NA(r.ncDesc) ? r.ncDesc : r.findings, 140) }))
    .filter(x => x.text && !NA(x.text))
    .slice(0, 12);

  return {
    scope: {
      reviewMonth: payload.filters?.month || "All months",
      activeFilters: Object.fromEntries(Object.entries(payload.filters || {}).filter(([k, v]) => k !== "month" && (Array.isArray(v) ? v.length : v)))
    },
    kpis: {
      ratedSteps: rows.length,
      reviewedProcesses: processes.size,
      totalFindings: ncs.length,
      compliancePct: pct(assessed.filter(r => r.compliance === "Compliant").length, assessed.length),
      slaAdherencePct: pct(slaMeasured.length - slaLate, slaMeasured.length),
      lateSlaTasks: slaLate,
      capaNeeded: capa.length,
      capaOverdue: capa.filter(r => r.capaStatus === "Overdue").length,
      effectiveCapaPct: pct(capaAssessed.filter(r => r.effectiveness === "Effective").length, capaAssessed.length),
      risks: risks.length,
      openHighRisks: risks.filter(r => r.riskLevel === "High" && r.mitigation === "Open").length
    },
    findings: {
      byStatus: toObj(countBy(ncs, r => r.compliance)),
      byCategory: toObj(countBy(ncs, r => clean(r.ncCategory, "Not set"))),
      byReason: toObj(countBy(ncs, r => clean(r.complianceReasonCategory, "Not set"))),
      bySeverity: toObj(countBy(ncs, r => clean(r.severityLevel, "Not set")))
    },
    capaStatus: toObj(countBy(capa, r => clean(r.capaStatus, "Not set"))),
    capaRootCauseCategory: toObj(countBy(capa, r => NA(r.rcCategory) ? null : r.rcCategory)),
    risks: {
      byLevel: toObj(countBy(risks, r => clean(r.riskLevel, "Not set"))),
      byMitigation: toObj(countBy(risks, r => clean(r.mitigation, "Not set")))
    },
    hotspotProcesses: worst(groupStats(r => clean(r.processName))),
    hotspotDepartments: worst(groupStats(r => clean(r.processOwner))),
    hotspotActionOwners: worst(groupStats(r => clean(r.department))),
    repeatFindings: repeat,
    dataQuality: dq,
    sampleFindingTexts: ncSamples
  };
}

// ---------- Prompt ----------
function systemPrompt(lang) {
  return [
    "You are an internal Process Assurance analyst for a medical diagnostics group (labs and radiology).",
    "You receive a JSON of pre-computed facts from the assurance tracker dashboard.",
    "STRICT RULES:",
    "- Use ONLY numbers that appear in the JSON. Never calculate, estimate or invent figures, names or dates.",
    "- If something is not in the data, say it is not available.",
    "- compliancePct, slaAdherencePct, effectiveCapaPct are percentages; null means not measurable.",
    "- Thresholds: ≥85% good, 70–84% needs attention, <70% poor.",
    "- Be concise and specific. Name the process/department behind each point.",
    `- Write the whole answer in ${LANGS[lang] || "English"}.`
  ].join("\n");
}

function analysisPrompt(facts) {
  return [
    "Analyse these dashboard facts and answer with exactly these sections using markdown headings (##):",
    "## Overall picture — 2–3 sentences on compliance, SLA and CAPA health.",
    "## Hotspots — up to 5 bullets: the processes / departments / action owners that need attention and why (cite their numbers).",
    "## Repeat & systemic issues — repeat findings and dominant NC categories/reasons.",
    "## Recommended actions — up to 5 prioritised bullets (highest risk first), each starting with an owner.",
    "## Data quality — gaps that weaken the analysis (only if any count > 0).",
    "",
    "FACTS:",
    JSON.stringify(facts)
  ].join("\n");
}

// ---------- Tiny markdown renderer (headings, bullets, bold) ----------
function renderMd(md) {
  const lines = esc(md).split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const h = line.match(/^#{1,4}\s+(.*)/);
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (h) html += `<h4>${h[1]}</h4>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- Engine ----------
let webllm = null, engine = null, loadedModel = null, busy = false;

async function pickModelId(choice) {
  if (!("gpu" in navigator)) throw new Error("NO_WEBGPU");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("NO_WEBGPU");
  const m = MODELS[choice] || MODELS.fast;
  return adapter.features.has("shader-f16") ? m.f16 : m.f32;
}

async function ensureEngine(choice, onProgress) {
  const modelId = await pickModelId(choice);
  if (engine && loadedModel === modelId) return engine;
  webllm ||= await import(WEBLLM_URL);
  if (engine) { await engine.unload(); engine = null; loadedModel = null; }
  engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
  loadedModel = modelId;
  return engine;
}

// ---------- UI ----------
function mount() {
  const host = document.getElementById("aiAnalyst");
  if (!host) return;
  host.innerHTML = `
    <details class="ai-card">
      <summary>
        <span class="ai-title">🤖 AI Analyst <span class="ai-badge">Runs in your browser · data stays on this PC</span></span>
        <span class="ai-sub">Explains the current dashboard view: hotspots, repeat issues, recommended actions.</span>
      </summary>
      <div class="ai-body">
        <div class="ai-controls">
          <label>Model <select id="aiModel">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}"${k === "fast" ? " selected" : ""}>${m.label}</option>`).join("")}</select></label>
          <label>Language <select id="aiLang">${Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
          <button id="aiAnalyze" class="btn primary">Analyze current view</button>
          <button id="aiStop" class="btn ghost" hidden>Stop</button>
          <span class="spacer"></span>
          <label class="ai-pdf-toggle" title="Adds the latest AI result as a section in Export to PDF / Publish PDF link"><input type="checkbox" id="aiIncludePdf" checked /> Include in PDF export</label>
          <button id="aiCopy" class="btn ghost" hidden>Copy</button>
        </div>
        <div class="ai-ask">
          <input id="aiQuestion" type="text" placeholder="Ask about this view… e.g. Which department should I audit first and why?" dir="auto" />
          <button id="aiAsk" class="btn">Ask</button>
        </div>
        <div id="aiProgress" class="ai-progress" hidden><div class="ai-bar"><span id="aiBar"></span></div><span id="aiProgressText"></span></div>
        <div id="aiOutput" class="ai-output" dir="auto"><p class="muted">First run downloads the model once (about 1–2 GB) and caches it. Needs a recent Chrome or Edge with WebGPU. Numbers come from the dashboard filters; the AI only interprets them — verify before acting.</p></div>
        <details class="ai-facts"><summary>Facts sent to the AI</summary><pre id="aiFacts"></pre></details>
      </div>
    </details>`;

  const $ = id => document.getElementById(id);
  let lastText = "";

  const setBusy = on => {
    busy = on;
    $("aiAnalyze").disabled = on; $("aiAsk").disabled = on;
    $("aiStop").hidden = !on;
  };
  const progress = (p, text) => {
    $("aiProgress").hidden = p == null;
    if (p != null) { $("aiBar").style.width = Math.round(p * 100) + "%"; $("aiProgressText").textContent = text || ""; }
  };
  const fail = e => {
    const msg = e?.message === "NO_WEBGPU"
      ? "This browser can't run the AI: WebGPU is not available. Use the latest Chrome or Edge on a PC with a GPU (and enable hardware acceleration)."
      : "AI error: " + (e?.message || e);
    $("aiOutput").innerHTML = `<p class="ai-error">${esc(msg)}</p>`;
  };

  // Fill the hidden PDF section (#aiAnalysisSection inside #dashboardCapture) with the latest result.
  const filtersText = f => {
    const names = { search: "Search", departments: "Department", actionOwners: "Action Owner", processes: "Process",
      processOwners: "Process Owner", compliance: "Compliance", riskLevels: "Risk Level", mitigation: "Mitigation" };
    const parts = [`Month: ${f.month || "All"}`];
    Object.entries(names).forEach(([k, label]) => { const v = f[k]; if (Array.isArray(v) ? v.length : v) parts.push(`${label}: ${Array.isArray(v) ? v.join(", ") : v}`); });
    return parts.join(" · ");
  };
  let pdfMeta = null; // { title, filters, model, at }
  const syncPdfSection = () => {
    const sec = document.getElementById("aiAnalysisSection");
    if (!sec) return;
    const on = $("aiIncludePdf").checked && !!lastText && !!pdfMeta;
    sec.classList.toggle("ai-include", on);
    if (!on) { sec.innerHTML = ""; return; }
    sec.innerHTML = `<h3 class="dash-section-title">${esc(pdfMeta.title)}</h3>`
      + `<p class="ai-pdf-meta">AI-generated in the browser (${esc(pdfMeta.model)}) on ${esc(pdfMeta.at)} · Filters at analysis: ${esc(pdfMeta.filters)}. Draft for review — figures come from the dashboard; verify before acting.</p>`
      + `<div class="ai-pdf-body" dir="auto">${renderMd(lastText)}</div>`;
  };
  // Warn in the PDF if filters changed after the analysis was generated.
  const sameFilters = () => {
    try { return pdfMeta && filtersText(window.__getDashboardData().filters) === pdfMeta.filters; } catch { return true; }
  };
  ["btnExportPdf", "btnPublishPdf"].forEach(id => document.getElementById(id)?.addEventListener("click", () => {
    syncPdfSection();
    const sec = document.getElementById("aiAnalysisSection");
    if (sec?.classList.contains("ai-include") && !sameFilters()) {
      sec.querySelector(".ai-pdf-meta")?.insertAdjacentHTML("afterend",
        `<p class="ai-pdf-warn">⚠ Dashboard filters were changed after this analysis was generated — re-run the analysis to match this export.</p>`);
    }
  }, true)); // capture phase: runs before app.js builds the PDF

  async function run(userPrompt, title) {
    if (busy) return;
    if (typeof window.__getDashboardData !== "function") return fail(new Error("Dashboard data not ready yet."));
    const payload = window.__getDashboardData();
    if (!payload.rows.length) { $("aiOutput").innerHTML = `<p class="muted">No rated records in the current filters — nothing to analyse.</p>`; return; }
    const facts = buildFacts(payload);
    $("aiFacts").textContent = JSON.stringify(facts, null, 2);
    setBusy(true); $("aiCopy").hidden = true; lastText = ""; pdfMeta = null; syncPdfSection();
    $("aiOutput").innerHTML = `<p class="muted">Loading model…</p>`;
    // Visible download status: %, elapsed time, stall warning.
    const t0 = Date.now(); let lastP = -1, lastChange = Date.now(), lastText2 = "";
    const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    const paint = () => {
      const fromCache = /cache/i.test(lastText2) && /Loading model from cache/i.test(lastText2);
      const pctTxt = lastP < 0 ? "starting" : Math.round(lastP * 100) + "%";
      const stalled = Date.now() - lastChange > 300000; // progress updates only per ~32 MB chunk
      $("aiOutput").innerHTML =
        `<p><strong>${fromCache ? "Loading model from cache" : "Downloading model (first time only)"}: ${pctTxt}</strong> · elapsed ${fmt(Date.now() - t0)}</p>`
        + `<p class="muted">${esc(lastText2 || "Preparing…")}</p>`
        + (fromCache ? "" : `<p class="muted">Progress updates after each ~32 MB chunk, so it can pause for a while on slow connections. Keep this tab open; next time it loads from cache in seconds.</p>`)
        + (stalled ? `<p class="ai-error">No new chunk for 5 minutes. The connection may be very slow or blocking huggingface.co (company firewall / VPN). Try another network, or press Stop and pick the Tiny model. Chunks already downloaded are kept.</p>` : "");
    };
    const timer = setInterval(paint, 1000);
    try {
      const eng = await ensureEngine($("aiModel").value, r => {
        if (r.progress !== lastP || r.text !== lastText2) lastChange = Date.now();
        lastP = r.progress; lastText2 = r.text; progress(r.progress, r.text); paint();
      });
      clearInterval(timer);
      progress(null);
      $("aiOutput").innerHTML = `<p class="muted">Analysing ${facts.kpis.ratedSteps} records…</p>`;
      const stream = await eng.chat.completions.create({
        stream: true, temperature: 0.2, max_tokens: 900,
        messages: [
          { role: "system", content: systemPrompt($("aiLang").value) },
          { role: "user", content: userPrompt(facts) }
        ]
      });
      for await (const chunk of stream) {
        lastText += chunk.choices[0]?.delta?.content || "";
        $("aiOutput").innerHTML = renderMd(lastText);
      }
      $("aiCopy").hidden = !lastText;
      pdfMeta = { title, filters: filtersText(payload.filters), model: loadedModel.replace(/-MLC$/, ""), at: new Date().toLocaleString() };
      syncPdfSection();
    } catch (e) {
      clearInterval(timer);
      progress(null);
      if (!/abort|interrupt/i.test(String(e?.message))) fail(e);
    } finally { setBusy(false); }
  }

  $("aiAnalyze").addEventListener("click", () => run(analysisPrompt, "AI Analysis"));
  $("aiIncludePdf").addEventListener("change", syncPdfSection);
  const ask = () => {
    const q = $("aiQuestion").value.trim();
    if (!q) return $("aiQuestion").focus();
    run(facts => `Answer this question using only the FACTS. Question: ${q}\n\nFACTS:\n${JSON.stringify(facts)}`, `AI Answer — ${q}`);
  };
  $("aiAsk").addEventListener("click", ask);
  $("aiQuestion").addEventListener("keydown", e => { if (e.key === "Enter") ask(); });
  $("aiStop").addEventListener("click", () => {
    try { engine?.interruptGenerate(); } catch {}
    if (busy && !loadedModel) location.reload(); // abort a download in progress (already-fetched chunks stay cached)
  });
  $("aiCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lastText); $("aiCopy").textContent = "Copied ✓"; setTimeout(() => $("aiCopy").textContent = "Copy", 1500); } catch {}
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();

export { buildFacts, renderMd }; // exported for tests
