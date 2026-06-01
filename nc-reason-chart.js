/* NC Reason pie chart — Dashboard
   Reads compliance_records and aggregates by `complianceReason`
   (only Non-Compliant / Partially Compliant rows are counted).
   Renders a Chart.js pie into #chartNcReason.
*/
import {
  db, auth,
  collection, onSnapshot,
  onAuthStateChanged
} from "./firebase.js";

(function () {
  "use strict";

  const COLLECTION = "compliance_records";
  let chart = null;
  let unsub = null;

  const PALETTE = [
    "#8B1E1E", "#C0392B", "#E67E22", "#F1C40F",
    "#27AE60", "#2980B9", "#8E44AD", "#16A085",
    "#7F8C8D", "#34495E"
  ];

  function aggregate(rows) {
    const counts = {};
    rows.forEach(r => {
      const comp = (r.compliance || "").toLowerCase();
      // Only count rows that represent an actual NC
      if (!comp.includes("non-compliant") && !comp.includes("partially")) return;
      const reason = (r.complianceReason && String(r.complianceReason).trim()) || "N/A";
      if (reason === "N/A") return;
      counts[reason] = (counts[reason] || 0) + 1;
    });
    return counts;
  }

  function render(rows) {
    const canvas = document.getElementById("chartNcReason");
    if (!canvas || typeof Chart === "undefined") return;

    const counts = aggregate(rows);
    const labels = Object.keys(counts);
    const data   = labels.map(k => counts[k]);

    if (chart) { chart.destroy(); chart = null; }

    if (!labels.length) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#888";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No NC reasons recorded yet", canvas.width / 2, canvas.height / 2);
      return;
    }

    chart = new Chart(canvas, {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor: "#fff",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  function start() {
    if (unsub) return;
    unsub = onSnapshot(collection(db, COLLECTION),
      (snap) => {
        const rows = [];
        snap.forEach(d => rows.push(d.data()));
        render(rows);
      },
      (err) => console.error("NC Reason chart sync failed:", err)
    );
  }

  function stop() {
    if (unsub) { unsub(); unsub = null; }
    if (chart) { chart.destroy(); chart = null; }
  }

  onAuthStateChanged(auth, (user) => {
    if (user) start(); else stop();
  });
})();