import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const source = html.match(/\/\* realtime-sync:start \*\/([\s\S]*?)\/\* realtime-sync:end \*\//)[1];
const {
  createLatestRequestGate,
  mergeChangeResources,
  parseChangeResources
} = await import("data:text/javascript," + encodeURIComponent(source));

test("parses only known SSE resources and fails closed", () => {
  assert.deepEqual(parseChangeResources('{"resources":["cards","epics","cards"]}'), ["cards", "epics"]);
  assert.deepEqual(parseChangeResources('{"resources":["secrets"]}'), []);
  assert.deepEqual(parseChangeResources("not json"), []);
  assert.deepEqual(parseChangeResources('{"resources":"cards"}'), []);
});

test("coalesces rapid invalidations without losing a resource", () => {
  assert.deepEqual(mergeChangeResources(["cards"], ["epics", "cards"]), ["cards", "epics"]);
  assert.deepEqual(mergeChangeResources([], ["unknown", "cards"]), ["cards"]);
});

test("accepts only the latest resource request", () => {
  const gate = createLatestRequestGate();
  const firstCards = gate.begin("cards");
  const epics = gate.begin("epics");
  const secondCards = gate.begin("cards");

  assert.equal(gate.isLatest("cards", firstCards), false);
  assert.equal(gate.isLatest("cards", secondCards), true);
  assert.equal(gate.isLatest("epics", epics), true);
});
