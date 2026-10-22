/* SLA from Task Performance: only Done tasks with a recorded timing count.
   Adherent = timing "On Time"; breach = timing "Late SLA". */
const norm = v => String(v || "").trim().toLowerCase();
export const isDoneTask = r => norm(r.taskDone) === "done";
export const isLateSla = r => isDoneTask(r) && norm(r.taskTiming) === "late sla";
export const isOnTime = r => isDoneTask(r) && norm(r.taskTiming) === "on time";
export function slaStats(rows) {
  const measured = (rows || []).filter(r => isLateSla(r) || isOnTime(r));
  const late = measured.filter(isLateSla).length;
  const onTime = measured.length - late;
  return { measured: measured.length, onTime, late, pct: measured.length ? Math.round(onTime / measured.length * 100) : 0 };
}
