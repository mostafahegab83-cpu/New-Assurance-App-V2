// Chart theme aligned with the Strategic Planning & PMO hub. Runs right after Chart.js loads.
(function () {
  if (typeof Chart === "undefined") return;
  try {
    const D = Chart.defaults;
    D.font.family = "Manrope, system-ui, 'Segoe UI', Arial, sans-serif";
    D.font.size = 12;
    D.color = "#2a2f3a";
    D.borderColor = "#eee9df";
    if (D.plugins?.legend?.labels) { Object.assign(D.plugins.legend.labels, { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 9, boxHeight: 9, padding: 14 }); }
    if (D.plugins?.tooltip) Object.assign(D.plugins.tooltip, { backgroundColor: "#10131a", titleColor: "#fff", bodyColor: "#e5e7eb", padding: 10, cornerRadius: 8, boxPadding: 4 });
    if (D.elements?.arc) Object.assign(D.elements.arc, { borderWidth: 2, borderColor: "#ffffff", hoverOffset: 6 });
    if (D.elements?.bar) D.elements.bar.borderRadius = 5;
    if (D.elements?.line) D.elements.line.borderWidth = 2.5;
    if (D.elements?.point) D.elements.point.radius = 3;
    if (D.scale?.grid) D.scale.grid.color = "#eee9df";
  } catch (e) { /* cosmetic only */ }
})();
