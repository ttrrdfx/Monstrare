import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const source = html.match(/\/\* upgrade-ui:start \*\/([\s\S]*?)\/\* upgrade-ui:end \*\//)[1];
const runtime = html.match(/\/\* upgrade-runtime:start \*\/([\s\S]*?)\/\* upgrade-runtime:end \*\//)[1];
const {
  classifyUpgradePlan,
  createUpgradeFixtureAdapter,
  createUpgradeState,
  escapeUpgradeHtml,
  groupUpgradeEntries,
  mapUpgradeError,
  selectUpgradeView,
  upgradeReducer,
} = await import("data:text/javascript," + encodeURIComponent(source));

const future = "2099-01-01T00:00:00.000Z";
const plan = {
  repository: "ttrrdfx/Monstrare",
  installedVersion: "1.0.0",
  sourceVersion: "1.1.0",
  applicable: true,
  writable: { ok: true },
  counts: { add: 1, update: 2, remove: 1, preserve: 4, conflict: 0 },
  entries: [
    { path: "z-last.md", action: "update" },
    { path: "a-first.md", action: "update" },
    { path: "new.md", action: "add" },
  ],
  planToken: "test-token",
  expiresAt: future,
};

function checkedState(nextPlan = plan) {
  return upgradeReducer(
    upgradeReducer(createUpgradeState(), { type: "OPEN" }),
    { type: "CHECK_SUCCESS", plan: nextPlan },
  );
}

test("state machine follows the legal check, confirm, apply, and success path", () => {
  const checking = upgradeReducer(createUpgradeState(), { type: "OPEN" });
  assert.equal(checking.phase, "checking");

  const available = upgradeReducer(checking, { type: "CHECK_SUCCESS", plan });
  assert.equal(available.phase, "available");

  const confirming = upgradeReducer(available, { type: "REQUEST_APPLY", now: Date.parse("2026-01-01") });
  assert.equal(confirming.phase, "confirming");

  const applying = upgradeReducer(confirming, { type: "APPLY_REQUEST", now: Date.parse("2026-01-01") });
  assert.equal(applying.phase, "applying");
  assert.strictEqual(upgradeReducer(applying, { type: "REQUEST_APPLY" }), applying);
  assert.strictEqual(upgradeReducer(applying, { type: "CLOSE" }), applying);

  const success = upgradeReducer(applying, {
    type: "APPLY_SUCCESS",
    result: { toVersion: "1.1.0", verification: { ok: true } },
  });
  assert.equal(success.phase, "success");
  assert.equal(upgradeReducer(success, { type: "CLOSE" }).phase, "idle");
});

test("verification failure is distinct from transaction failure and cannot be reached illegally", () => {
  const available = checkedState();
  assert.strictEqual(
    upgradeReducer(available, { type: "APPLY_SUCCESS", result: { verification: { ok: false } } }),
    available,
  );
  const applying = upgradeReducer(
    upgradeReducer(available, { type: "REQUEST_APPLY", now: Date.parse("2026-01-01") }),
    { type: "APPLY_REQUEST", now: Date.parse("2026-01-01") },
  );
  assert.equal(
    upgradeReducer(applying, { type: "APPLY_SUCCESS", result: { verification: { ok: false } } }).phase,
    "verification-failed",
  );
  const failed = upgradeReducer(applying, { type: "APPLY_FAILURE", error: { code: "UPGRADE_TRANSACTION_FAILED" } });
  assert.equal(failed.phase, "error");
  assert.equal(failed.error.code, "UPGRADE_TRANSACTION_FAILED");
});

test("selector disables apply for conflicts, no writes, expiry, permissions, and active apply", () => {
  assert.equal(selectUpgradeView(checkedState(), Date.parse("2026-01-01")).canApply, true);

  const cases = [
    { ...plan, applicable: false },
    { ...plan, counts: { ...plan.counts, conflict: 1 } },
    { ...plan, counts: { add: 0, update: 0, remove: 0, preserve: 8, conflict: 0 } },
    { ...plan, expiresAt: "2025-01-01T00:00:00.000Z" },
    { ...plan, writable: { ok: false } },
  ];
  for (const candidate of cases) {
    const state = checkedState(candidate);
    assert.equal(selectUpgradeView(state, Date.parse("2026-01-01")).canApply, false);
    assert.notEqual(upgradeReducer(state, { type: "REQUEST_APPLY", now: Date.parse("2026-01-01") }).phase, "confirming");
  }

  const applying = { ...checkedState(), phase: "applying" };
  assert.equal(selectUpgradeView(applying).canApply, false);
  assert.equal(selectUpgradeView(applying).canClose, false);
});

test("plan classification covers current, available, conflict, and read-only previews", () => {
  assert.equal(classifyUpgradePlan(plan), "available");
  assert.equal(classifyUpgradePlan({ ...plan, sourceVersion: "1.0.0" }), "current");
  assert.equal(classifyUpgradePlan({ ...plan, counts: { add: 0, update: 0, remove: 0, preserve: 1, conflict: 0 } }), "current");
  assert.equal(classifyUpgradePlan({ ...plan, applicable: false }), "blocked");
  assert.equal(classifyUpgradePlan({ ...plan, writable: { ok: false } }), "blocked");
});

test("entry grouping is stable, fixed to known actions, and does not render input", () => {
  assert.deepEqual(groupUpgradeEntries([
    { path: "<img src=x onerror=alert(1)>", action: "conflict" },
    { path: "z.md", action: "update" },
    { path: "a.md", action: "update" },
    { path: "secret", action: "unknown" },
  ]), {
    add: [],
    update: ["a.md", "z.md"],
    remove: [],
    preserve: [],
    conflict: ["<img src=x onerror=alert(1)>"],
  });
  assert.equal(escapeUpgradeHtml('<script>"x" & y</script>'), "&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;");
});

test("error mapping exposes stable public messages instead of raw exception text", () => {
  assert.deepEqual(mapUpgradeError({ code: "UPGRADE_PLAN_STALE", message: "/Users/private/project" }), {
    code: "UPGRADE_PLAN_STALE",
    title: "更新計畫已改變",
    message: "專案或來源已變更，請重新檢查後再決定。",
    retryable: true,
  });
  assert.equal(mapUpgradeError({ code: "UNKNOWN", message: '<img onerror="x">' }).message.includes("img"), false);
});

test("fixture adapter independently drives every check outcome and apply result", async () => {
  assert.equal(classifyUpgradePlan(await createUpgradeFixtureAdapter("available").check()), "available");
  assert.equal(classifyUpgradePlan(await createUpgradeFixtureAdapter("current").check()), "current");
  assert.equal(classifyUpgradePlan(await createUpgradeFixtureAdapter("blocked").check()), "blocked");
  assert.equal(classifyUpgradePlan(await createUpgradeFixtureAdapter("permission").check()), "blocked");
  const expired = await createUpgradeFixtureAdapter("expired").check();
  assert.equal(selectUpgradeView(checkedState(expired)).expired, true);
  assert.equal(selectUpgradeView(checkedState(expired)).canApply, false);
  await assert.rejects(() => createUpgradeFixtureAdapter("error").check(), { code: "GITHUB_RELEASE_TIMEOUT" });
  assert.equal((await createUpgradeFixtureAdapter("success").apply()).verification.ok, true);
  assert.equal((await createUpgradeFixtureAdapter("verification-failed").apply()).verification.ok, false);
});

test("upgrade runtime stays independent from card modal state and uses accessible dialog boundaries", () => {
  assert.doesNotMatch(runtime, /modalDirtyFields|openId\s*=/);
  assert.match(html, /id="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"/);
  assert.match(html, /id="upgrade-confirm" role="alertdialog" aria-modal="true" aria-labelledby="upgrade-confirm-title"/);
  assert.match(runtime, /element\.inert = true/);
  assert.match(runtime, /document\.getElementById\("upgrade-trigger"\)\.focus\(\)/);
});
