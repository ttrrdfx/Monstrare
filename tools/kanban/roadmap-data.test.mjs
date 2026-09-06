import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const source = html.match(/\/\* roadmap-data:start \*\/([\s\S]*?)\/\* roadmap-data:end \*\//)[1];
const {
  buildEpicProgress,
  buildFocusedTreeLayout,
  buildSelectedEpicTree,
  clampZoom,
  createKanbanUiState,
  fitViewport,
  resolveSelectedEpicName,
  wheelZoomFactor
} = await import("data:text/javascript," + encodeURIComponent(source));

test("clamps zoom to the supported range", () => {
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(1.2), 1.2);
  assert.equal(clampZoom(2), 1.6);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("normalizes wheel zoom by movement instead of event count", () => {
  const oneEvent = wheelZoomFactor(-100, 0, 600);
  const tenEvents = wheelZoomFactor(-10, 0, 600) ** 10;

  assert.ok(Math.abs(oneEvent - tenEvents) < 1e-12);
  assert.ok(Math.abs(wheelZoomFactor(-80, 0, 600) * wheelZoomFactor(80, 0, 600) - 1) < 1e-12);
  assert.equal(wheelZoomFactor(0, 0, 600), 1);
});

test("normalizes wheel delta modes and caps a single event", () => {
  assert.equal(wheelZoomFactor(-3, 1, 600), wheelZoomFactor(-48, 0, 600));
  assert.equal(wheelZoomFactor(-1, 2, 600), wheelZoomFactor(-120, 0, 600));
  assert.ok(wheelZoomFactor(-1, 0, 600) < 1.002);
});

test("fits and centers content inside the available viewport", () => {
  assert.deepEqual(fitViewport(1000, 500, 600, 400, 50), { scale: 0.5, x: 50, y: 75 });
  assert.deepEqual(fitViewport(100, 100, 500, 500, 50), { scale: 1.6, x: 170, y: 170 });
  assert.deepEqual(fitViewport(1104, 620, 390, 600, 32), { scale: 0.29528985507246375, x: 32, y: 208 });
});

const epics = [
  {
    name: "Alpha",
    definition: "Alpha definition",
    stories: [{ name: "Story A", definition: "Story definition" }]
  },
  { name: "Beta", stories: [] }
];

const tickets = [
  { id: "TASK-002", epic: "Alpha", userStory: "Story A", stage: "done", order: 2 },
  { id: "TASK-001", epic: "Alpha", userStory: "Story A", stage: "ready", order: 1 },
  { id: "TASK-003", epic: "Alpha", userStory: "Unknown", stage: "done", order: 3 }
];

test("creates the explicit UI state contract", () => {
  const state = createKanbanUiState();
  assert.deepEqual(state.viewport, { scale: 1, x: 0, y: 0 });
  assert.equal(state.selectedEpicName, null);
  assert.equal(state.syncState, "connecting");
  assert.ok(state.collapsedBranches instanceof Set);
});

test("calculates Epic progress with the same rounded percentage rule", () => {
  assert.deepEqual(buildEpicProgress(epics, tickets), [
    { name: "Alpha", definition: "Alpha definition", progress: { done: 2, total: 3, percent: 67 } },
    { name: "Beta", definition: "", progress: { done: 0, total: 0, percent: 0 } }
  ]);
});

test("puts every selected Epic task exactly once in a stable Story tree", () => {
  const tree = buildSelectedEpicTree(epics, tickets, "Alpha");
  assert.deepEqual(tree.stories.map((story) => story.name), ["Story A", "（未分類任務）"]);
  assert.deepEqual(tree.stories[0].tasks.map((task) => task.id), ["TASK-001", "TASK-002"]);
  assert.deepEqual(tree.stories[1].tasks.map((task) => task.id), ["TASK-003"]);
  assert.deepEqual(tree.progress, { done: 2, total: 3, percent: 67 });
  assert.equal(new Set(tree.stories.flatMap((story) => story.tasks.map((task) => task.id))).size, 3);
});

test("falls back to the first Epic and handles empty data", () => {
  assert.equal(resolveSelectedEpicName(epics, "Missing"), "Alpha");
  assert.equal(buildSelectedEpicTree(epics, tickets, "Missing").name, "Alpha");
  assert.equal(resolveSelectedEpicName([], "Missing"), null);
  assert.equal(buildSelectedEpicTree([], [], "Missing"), null);
  assert.deepEqual(buildEpicProgress(null, null), []);
});

test("assigns every current card exactly once across the current Epic trees", () => {
  const root = new URL("./", import.meta.url);
  const currentEpics = JSON.parse(fs.readFileSync(new URL("epics.json", root), "utf8")).epics;
  const cardsDir = new URL("cards/", root);
  const currentTickets = fs.readdirSync(cardsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(new URL(name, cardsDir), "utf8")));
  const taskIds = currentEpics.flatMap((epic) =>
    buildSelectedEpicTree(currentEpics, currentTickets, epic.name).stories.flatMap((story) =>
      story.tasks.map((task) => task.id)
    )
  );

  assert.equal(taskIds.length, currentTickets.length);
  assert.equal(new Set(taskIds).size, currentTickets.length);
});

test("lays out nodes and connectors without orphaned visible tasks", () => {
  const tree = buildSelectedEpicTree(epics, tickets, "Alpha");
  const layout = buildFocusedTreeLayout(tree, new Set());
  const ids = new Set(layout.nodes.map((node) => node.id));

  assert.equal(layout.nodes.filter((node) => node.type === "root").length, 1);
  assert.equal(layout.nodes.filter((node) => node.type === "story").length, 2);
  assert.equal(layout.nodes.filter((node) => node.type === "task").length, 3);
  assert.equal(layout.edges.length, 5);
  layout.edges.forEach((edge) => {
    assert.ok(ids.has(edge.from));
    assert.ok(ids.has(edge.to));
  });
});

test("collapsing a Story removes only its task nodes and connectors", () => {
  const tree = buildSelectedEpicTree(epics, tickets, "Alpha");
  const layout = buildFocusedTreeLayout(tree, new Set(["Alpha::Story A"]));

  assert.deepEqual(layout.nodes.filter((node) => node.type === "task").map((node) => node.task.id), ["TASK-003"]);
  assert.equal(layout.edges.filter((edge) => edge.from === "story-0").length, 0);
  assert.equal(layout.edges.filter((edge) => edge.from === "root").length, 2);
});

test("collapsing the Epic hides all descendants while retaining root progress", () => {
  const tree = buildSelectedEpicTree(epics, tickets, "Alpha");
  const layout = buildFocusedTreeLayout(tree, new Set(["Alpha::*"]));

  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.nodes[0].type, "root");
  assert.equal(layout.nodes[0].collapsed, true);
  assert.equal(layout.width, 360);
  assert.deepEqual(layout.nodes[0].tree.progress, { done: 2, total: 3, percent: 67 });
  assert.equal(layout.edges.length, 0);
});
