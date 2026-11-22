/* embed.js — "dashboard-only" embed mode for the Assurance Tracker.
 *
 * Usage (from another site, e.g. the Strategic Planning & PMO hub):
 *   <iframe src=".../index.html?embed=findings"></iframe>
 *   embed = findings | risk | gapassessment | validation | progress
 *
 * Without ?embed=... this file does nothing, so the normal tracker is unchanged.
 * Reads the same public Firestore collections the tracker's no-login dashboards already use.
 */
(function () {
  var key = (new URLSearchParams(location.search).get("embed") || "").toLowerCase();
  var MAP = {
    findings:      ["dashboard",   "dashsub", "dashFindings"],
    risk:          ["dashboard",   "dashsub", "dashRisk"],
    gapassessment: ["gapAnalysis", "gasub",   "gapAssessmentDashboard"],
    validation:    ["gapAnalysis", "gasub",   "gapDashboard"],
    progress:      ["gapAnalysis", "gasub",   "planDashboard"]
  };
  var target = MAP[key];
  if (!target) return;

  document.documentElement.classList.add("embed-mode");
  var css = document.createElement("style");
  css.textContent =
    ".embed-mode .app-header,.embed-mode .subtabs,.embed-mode #btnPublishPdf{display:none!important}" +
    ".embed-mode body{background:transparent;min-height:0}" +
    ".embed-mode .container{padding-top:8px}";
  document.head.appendChild(css);

  function click(sel) { var el = document.querySelector(sel); if (el) el.click(); return !!el; }
  function go() {
    click('.tab[data-tab="' + target[0] + '"]');
    click('.subtab[data-' + target[1] + '="' + target[2] + '"]');
  }
  // app.js calls go() after its own sign-in / public-view navigation, so we always win.
  window.__embed = { key: key, go: go };

  // Fallback in case the hooks never fire (e.g. slow Firebase auth).
  window.addEventListener("load", function () { setTimeout(go, 1200); setTimeout(go, 3500); });

  // Tell the parent page how tall the content is, so the iframe can grow (no double scrollbars).
  var last = 0;
  function post() {
    var box = document.querySelector("main.container") || document.body;
    var h = Math.ceil(box.getBoundingClientRect().height) + 24;
    if (Math.abs(h - last) < 3) return;
    last = h;
    try { parent.postMessage({ type: "assurance-embed-height", key: key, height: h }, "*"); } catch (e) {}
  }
  window.addEventListener("load", function () {
    post();
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.querySelector("main.container") || document.body);
    setInterval(post, 1500);
  });
})();
