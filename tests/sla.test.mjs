import { test } from "node:test";
import assert from "node:assert/strict";
import { slaStats } from "../sla.js";
const t = (taskDone, taskTiming, extra = {}) => ({ taskDone, taskTiming, ...extra });
test("SLA % = On Time Done tasks / Done tasks with timing", () => {
  assert.deepEqual(slaStats([t("Done","On Time"), t("Done","On Time"), t("Done","Late SLA"), t("Done","Late SLA")]), { measured: 4, onTime: 2, late: 2, pct: 50 });
});
test("Not Done tasks and Done tasks without timing are excluded", () => {
  assert.equal(slaStats([t("Not Done","Late SLA"), t("Done",""), t("Done","On Time")]).measured, 1);
});
test("Target/Actual SLA numbers no longer drive adherence", () => {
  assert.equal(slaStats([t("Done","Late SLA",{ targetSla: 5, actualSla: 1 })]).pct, 0);
});
