/**
 * 治理看板 — 零依賴本地 server
 *
 * 啟動：node tools/kanban/server.mjs（或 npm run kanban）
 * 資料：tools/kanban/cards/*.json（一檔一卡，git tracked）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  createUpgradeRequestHandler,
  createUpgradeService,
  resolveKanbanProjectRoot,
} from './upgrade-api.mjs';

const HOST = '127.0.0.1';
const configuredPort = Number(process.env.KANBAN_PORT ?? 4420);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65535
  ? configuredPort
  : 4420;
let pendingPort = PORT;

const MODULE_ROOT = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.KANBAN_ROOT ? path.resolve(process.env.KANBAN_ROOT) : MODULE_ROOT;
const PROJECT_ROOT = resolveKanbanProjectRoot({ moduleRoot: MODULE_ROOT });
const CARDS_DIR = path.join(ROOT, 'cards');
const INDEX_HTML = path.join(ROOT, 'index.html');
const EPICS_JSON = path.join(ROOT, 'epics.json');

fs.mkdirSync(CARDS_DIR, { recursive: true });

// Customize this per project (e.g. team or product initials). Card IDs are
// generated as `${ID_PREFIX}-001`, `${ID_PREFIX}-002`, ...
const ID_PREFIX = 'TASK';

// 新卡片 owner 與看板留言作者的預設值：取本機 git 身分（這個看板本來就以
// git 為同步機制），沒有 git 或沒設 user.name 時留空字串（未指派）。
const DEFAULT_OWNER = (() => {
  try {
    return execSync('git config user.name', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
})();
const ID_RE = new RegExp('^' + ID_PREFIX + '-\\d{3,}$');
const STAGES = ['backlog', 'blocked', 'ready', 'implementing', 'verify', 'done'];
const ADVANCED_STAGES = ['ready', 'implementing', 'verify', 'done'];
const RISKS = ['low', 'medium', 'high'];
const TRACKS = ['frontend', 'backend', 'integration', 'n/a'];
const READINESS_KEYS = [
  'problem_clear', 'non_goals_clear', 'acceptance_testable', 'files_known',
  'scope_defined', 'verification_contract', 'human_approval_recorded'
];
const GATE_KEYS = ['product', 'ui', 'architecture', 'security', 'test', 'code_review'];
const LINK_KEYS = ['featureSpec', 'screenSpec', 'mockupDecision', 'taskCard', 'verificationReport', 'pr'];
const configuredDebounceMs = Number(process.env.KANBAN_EVENT_DEBOUNCE_MS ?? 80);
const configuredHeartbeatMs = Number(process.env.KANBAN_HEARTBEAT_MS ?? 15000);
const EVENT_DEBOUNCE_MS = Number.isFinite(configuredDebounceMs) && configuredDebounceMs >= 0
  ? configuredDebounceMs
  : 80;
const HEARTBEAT_MS = Number.isFinite(configuredHeartbeatMs) && configuredHeartbeatMs > 0
  ? configuredHeartbeatMs
  : 15000;

const eventClients = new Set();
const pendingResources = new Set();
const watchers = [];
let changeTimer = null;
let heartbeatTimer = null;
let realtimeStarted = false;

/* ── helpers ── */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const upgradeService = createUpgradeService({ targetRoot: PROJECT_ROOT });
const handleUpgradeRequest = createUpgradeRequestHandler({
  service: upgradeService,
  sendJson,
  logError(error) {
    const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
    console.error(`[kanban] 版本更新失敗：${code}`);
  },
});

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function removeEventClient(res) {
  eventClients.delete(res);
}

function broadcastChange() {
  changeTimer = null;
  if (pendingResources.size === 0) return;
  const resources = ['cards', 'epics'].filter((resource) => pendingResources.has(resource));
  pendingResources.clear();
  for (const res of eventClients) {
    if (res.destroyed || res.writableEnded) {
      removeEventClient(res);
      continue;
    }
    try {
      writeEvent(res, 'change', { resources });
    } catch {
      removeEventClient(res);
    }
  }
}

function queueChange(resource) {
  pendingResources.add(resource);
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(broadcastChange, EVENT_DEBOUNCE_MS);
  changeTimer.unref?.();
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();
  eventClients.add(res);
  writeEvent(res, 'ready', {});
  req.once('close', () => removeEventClient(res));
  res.once('close', () => removeEventClient(res));
  res.once('error', () => removeEventClient(res));
}

function shutdownRealtime() {
  realtimeStarted = false;
  if (changeTimer) clearTimeout(changeTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  changeTimer = null;
  heartbeatTimer = null;
  pendingResources.clear();
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const res of eventClients) {
    if (!res.writableEnded) res.end();
  }
  eventClients.clear();
}

function startRealtime() {
  if (realtimeStarted) return;
  realtimeStarted = true;
  try {
    const cardsWatcher = fs.watch(CARDS_DIR, (_eventType, filename) => {
      if (filename === null || String(filename).endsWith('.json')) queueChange('cards');
    });
    const epicsWatcher = fs.watch(ROOT, (_eventType, filename) => {
      if (filename === null || String(filename) === path.basename(EPICS_JSON)) queueChange('epics');
    });
    watchers.push(cardsWatcher, epicsWatcher);
    for (const watcher of watchers) {
      watcher.on('error', (err) => {
        console.error('[kanban] 檔案監看失敗：' + err.message);
        shutdownRealtime();
      });
    }
    heartbeatTimer = setInterval(() => {
      for (const res of eventClients) {
        if (res.destroyed || res.writableEnded) removeEventClient(res);
        else {
          try {
            res.write(': heartbeat\n\n');
          } catch {
            removeEventClient(res);
          }
        }
      }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  } catch (err) {
    shutdownRealtime();
    throw err;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateCard(c) {
  if (!isPlainObject(c)) return 'card 必須是 object';
  if (typeof c.id !== 'string' || !ID_RE.test(c.id)) return 'id 必須符合 ^' + ID_PREFIX + '-\\d{3,}$';
  if (typeof c.title !== 'string' || c.title.trim() === '') return 'title 必須是非空字串';
  if (typeof c.content !== 'string') return 'content 必須是字串';
  if (!STAGES.includes(c.stage)) return 'stage 只允許 ' + STAGES.join('/');
  if (!RISKS.includes(c.risk)) return 'risk 只允許 ' + RISKS.join('/');
  if (typeof c.owner !== 'string') return 'owner 必須是字串';
  if (typeof c.agent !== 'string') return 'agent 必須是字串';
  if (typeof c.approvalRequired !== 'boolean') return 'approvalRequired 必須是 boolean';
  if (typeof c.createdAt !== 'string') return 'createdAt 必須是字串';
  if (!Number.isInteger(c.order) || c.order < 1) return 'order 必須是 >= 1 的整數';
  if (typeof c.epic !== 'string') return 'epic 必須是字串';
  if (typeof c.userStory !== 'string') return 'userStory 必須是字串';
  if (!TRACKS.includes(c.track)) return 'track 只允許 ' + TRACKS.join('/');
  if (!Array.isArray(c.dependsOn) || c.dependsOn.some((x) => typeof x !== 'string' || !ID_RE.test(x))) {
    return 'dependsOn 必須是字串陣列，且每個元素需符合 id 格式 ^' + ID_PREFIX + '-\\d{3,}$';
  }
  if (c.dependsOn.includes(c.id)) return 'dependsOn 不可包含自己的 id';

  if (!isPlainObject(c.readiness)) return 'readiness 必須是 object';
  for (const k of READINESS_KEYS) {
    if (typeof c.readiness[k] !== 'boolean') return 'readiness.' + k + ' 必須是 boolean';
  }
  if (!isPlainObject(c.gates)) return 'gates 必須是 object';
  for (const k of GATE_KEYS) {
    if (typeof c.gates[k] !== 'boolean') return 'gates.' + k + ' 必須是 boolean';
  }
  if (!isPlainObject(c.links)) return 'links 必須是 object';
  for (const k of LINK_KEYS) {
    if (typeof c.links[k] !== 'string') return 'links.' + k + ' 必須是字串';
  }
  if (!Array.isArray(c.refs) || c.refs.some((r) => typeof r !== 'string')) {
    return 'refs 必須是字串陣列';
  }
  if (!isPlainObject(c.evidence)) return 'evidence 必須是 object';
  if (!Array.isArray(c.evidence.commands) || c.evidence.commands.some((x) => typeof x !== 'string')) {
    return 'evidence.commands 必須是字串陣列';
  }
  if (!Array.isArray(c.evidence.findings) || c.evidence.findings.some((x) => typeof x !== 'string')) {
    return 'evidence.findings 必須是字串陣列';
  }
  if (typeof c.evidence.residual !== 'string') return 'evidence.residual 必須是字串';
  if (!Array.isArray(c.comments)) return 'comments 必須是陣列';
  for (const item of c.comments) {
    if (!isPlainObject(item)) return 'comments 每項必須是 { name, time, text } object';
    if (typeof item.name !== 'string') return 'comments[].name 必須是字串';
    if (typeof item.time !== 'string') return 'comments[].time 必須是字串';
    if (typeof item.text !== 'string') return 'comments[].text 必須是字串';
  }
  return null;
}

function defaultObj(keys, value) {
  const o = {};
  for (const k of keys) o[k] = value;
  return o;
}

/** 舊資料 / 精簡 client 相容：缺少的欄位補預設值（in-place） */
function fillDefaults(c) {
  if (!isPlainObject(c)) return c;
  if (c.content === undefined) c.content = '';
  if (c.agent === undefined) c.agent = '';
  if (c.approvalRequired === undefined) c.approvalRequired = false;
  if (c.epic === undefined) c.epic = '';
  if (c.userStory === undefined) c.userStory = '';
  if (c.track === undefined) c.track = 'n/a';
  if (!Array.isArray(c.dependsOn)) c.dependsOn = [];
  if (!isPlainObject(c.readiness)) c.readiness = defaultObj(READINESS_KEYS, false);
  else for (const k of READINESS_KEYS) if (c.readiness[k] === undefined) c.readiness[k] = false;
  if (!isPlainObject(c.gates)) c.gates = defaultObj(GATE_KEYS, false);
  else for (const k of GATE_KEYS) if (c.gates[k] === undefined) c.gates[k] = false;
  if (!isPlainObject(c.links)) c.links = defaultObj(LINK_KEYS, '');
  else for (const k of LINK_KEYS) if (c.links[k] === undefined) c.links[k] = '';
  if (!Array.isArray(c.refs)) c.refs = [];
  if (!isPlainObject(c.evidence)) c.evidence = { commands: [], findings: [], residual: '' };
  if (!Array.isArray(c.comments)) c.comments = [];
  return c;
}

/** 固定 key 順序寫檔，2 空格縮排 + 結尾換行，減少 git diff 噪音 */
function writeCard(c) {
  const normalized = {
    id: c.id,
    title: c.title,
    content: c.content,
    stage: c.stage,
    risk: c.risk,
    owner: c.owner,
    agent: c.agent,
    approvalRequired: c.approvalRequired,
    createdAt: c.createdAt,
    epic: c.epic,
    userStory: c.userStory,
    track: c.track,
    dependsOn: c.dependsOn,
    order: c.order,
    readiness: c.readiness,
    gates: c.gates,
    links: c.links,
    refs: c.refs,
    evidence: c.evidence,
    comments: c.comments
  };
  const file = path.join(CARDS_DIR, c.id + '.json');
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}

function readAllCards() {
  const files = fs.readdirSync(CARDS_DIR).filter((f) => f.endsWith('.json'));
  const cards = files.map((f) =>
    fillDefaults(JSON.parse(fs.readFileSync(path.join(CARDS_DIR, f), 'utf8')))
  );
  cards.sort((a, b) =>
    STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
    a.order - b.order ||
    a.id.localeCompare(b.id)
  );
  return cards;
}

/**
 * 從 startId 沿 dependsOn 邊做 DFS，找出第一個可達的循環。
 * cardMap 必須包含這次請求裡「即將寫入」的最新版本（覆蓋掉舊檔內容）。
 * 回傳循環路徑（含重複的起點，方便顯示 "A -> B -> A"），沒有循環回傳 null。
 */
function detectCycle(startId, cardMap) {
  const path = [];
  const onPath = new Set();
  function visit(id) {
    if (onPath.has(id)) return path.slice(path.indexOf(id)).concat(id);
    const card = cardMap.get(id);
    if (!card || !Array.isArray(card.dependsOn)) return null;
    path.push(id);
    onPath.add(id);
    for (const dep of card.dependsOn) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(id);
    return null;
  }
  return visit(startId);
}

/**
 * 檢查一張卡的 dependsOn：參照是否存在、是否形成循環、
 * 若要推進到 ready/implementing/verify/done，前置任務是否皆已 done。
 * cardMap 必須包含這次請求裡「即將寫入」的最新版本。回傳錯誤字串，沒有問題回傳 null。
 */
function checkDependsOn(card, cardMap) {
  const missing = card.dependsOn.filter((depId) => !cardMap.has(depId));
  if (missing.length) return card.id + ': dependsOn 參照到不存在的卡片：' + missing.join(', ');

  const cycle = detectCycle(card.id, cardMap);
  if (cycle) return card.id + ': 偵測到循環依賴：' + cycle.join(' -> ');

  if (ADVANCED_STAGES.includes(card.stage)) {
    const unmet = card.dependsOn.map((depId) => cardMap.get(depId)).filter((dep) => dep.stage !== 'done');
    if (unmet.length) {
      return (
        card.id + ': 前置任務尚未完成（' +
        unmet.map((d) => d.id + ' ' + d.title).join('、') +
        '），無法推進到 ' + card.stage
      );
    }
  }
  return null;
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* ── route handlers ── */

function handleList(res) {
  sendJson(res, 200, readAllCards());
}

function handleEpics(res) {
  try {
    const epics = JSON.parse(fs.readFileSync(EPICS_JSON, 'utf8'));
    sendJson(res, 200, epics);
  } catch (err) {
    sendJson(res, 500, { error: '讀取 epics.json 失敗：' + err.message });
  }
}

function handlePutOne(res, id, body) {
  const c = fillDefaults(JSON.parse(body));
  if (!isPlainObject(c)) return sendJson(res, 400, { error: 'body 必須是完整 card object' });
  if (c.id !== id) return sendJson(res, 400, { error: 'body 的 id 與 URL 不一致' });
  const err = validateCard(c);
  if (err) return sendJson(res, 400, { error: err });
  const cardMap = new Map(readAllCards().map((x) => [x.id, x]));
  cardMap.set(c.id, c);
  const depErr = checkDependsOn(c, cardMap);
  if (depErr) return sendJson(res, 400, { error: depErr });
  writeCard(c);
  sendJson(res, 200, c);
  queueChange('cards');
}

function handlePutBulk(res, body) {
  const list = JSON.parse(body);
  if (!Array.isArray(list)) return sendJson(res, 400, { error: 'body 必須是 card 陣列' });
  for (const c of list) {
    const err = validateCard(fillDefaults(c));
    if (err) return sendJson(res, 400, { error: (c && c.id ? c.id + ': ' : '') + err });
  }
  const cardMap = new Map(readAllCards().map((x) => [x.id, x]));
  for (const c of list) cardMap.set(c.id, c);
  for (const c of list) {
    const depErr = checkDependsOn(c, cardMap);
    if (depErr) return sendJson(res, 400, { error: depErr });
  }
  for (const c of list) writeCard(c);
  sendJson(res, 200, { updated: list.length });
  queueChange('cards');
}

function handlePost(res, body) {
  const input = JSON.parse(body);
  if (!isPlainObject(input)) return sendJson(res, 400, { error: 'body 必須是 object' });
  const existing = readAllCards();
  const maxNum = existing.reduce((m, c) => Math.max(m, parseInt(c.id.slice(ID_PREFIX.length + 1), 10)), 0);
  const stage = STAGES.includes(input.stage) ? input.stage : 'backlog';
  const inColumn = existing.filter((c) => c.stage === stage);
  const card = fillDefaults({
    id: ID_PREFIX + '-' + String(maxNum + 1).padStart(3, '0'),
    title: typeof input.title === 'string' ? input.title.trim() : '',
    content: typeof input.content === 'string' ? input.content : '',
    stage,
    risk: RISKS.includes(input.risk) ? input.risk : 'low',
    owner: typeof input.owner === 'string' ? input.owner : DEFAULT_OWNER,
    agent: typeof input.agent === 'string' ? input.agent : '',
    approvalRequired: !!input.approvalRequired,
    createdAt: todayStr(),
    epic: typeof input.epic === 'string' ? input.epic : '',
    userStory: typeof input.userStory === 'string' ? input.userStory : '',
    track: TRACKS.includes(input.track) ? input.track : 'n/a',
    dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn : [],
    order: inColumn.length + 1,
    readiness: input.readiness,
    gates: input.gates,
    links: input.links,
    refs: Array.isArray(input.refs) ? input.refs : [],
    evidence: input.evidence,
    comments: []
  });
  const err = validateCard(card);
  if (err) return sendJson(res, 400, { error: err });
  const cardMap = new Map(existing.map((x) => [x.id, x]));
  cardMap.set(card.id, card);
  const depErr = checkDependsOn(card, cardMap);
  if (depErr) return sendJson(res, 400, { error: depErr });
  writeCard(card);
  sendJson(res, 201, card);
  queueChange('cards');
}

function handleDelete(res, id) {
  const file = path.join(CARDS_DIR, id + '.json');
  if (!fs.existsSync(file)) return sendJson(res, 404, { error: id + ' 不存在' });
  fs.unlinkSync(file);
  sendJson(res, 200, { deleted: id });
  queueChange('cards');
}

/* ── server ── */

const server = http.createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  try {
    if (await handleUpgradeRequest(req, res, pathname)) return;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(INDEX_HTML));
      return;
    }

    if (pathname === '/api/config') {
      if (req.method === 'GET') return sendJson(res, 200, { owner: DEFAULT_OWNER });
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/epics') {
      if (req.method === 'GET') return handleEpics(res);
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/events') {
      if (req.method === 'GET') return handleEvents(req, res);
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/cards') {
      if (req.method === 'GET') return handleList(res);
      if (req.method === 'PUT') return handlePutBulk(res, await readBody(req));
      if (req.method === 'POST') return handlePost(res, await readBody(req));
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    const match = pathname.match(/^\/api\/cards\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'id 必須符合 ^' + ID_PREFIX + '-\\d{3,}$' });
      if (req.method === 'PUT') return handlePutOne(res, id, await readBody(req));
      if (req.method === 'DELETE') return handleDelete(res, id);
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (err instanceof SyntaxError) {
      sendJson(res, 400, { error: 'body 不是合法 JSON：' + err.message });
    } else {
      sendJson(res, 500, { error: '寫入失敗：' + err.message });
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && pendingPort < 65535) {
    const occupiedPort = pendingPort;
    pendingPort += 1;
    console.warn(`[kanban] port ${occupiedPort} 已被占用，改用 ${pendingPort}。`);
    server.listen(pendingPort, HOST);
    return;
  }

  shutdownRealtime();
  console.error('[kanban] server 啟動失敗：' + err.message);
  process.exit(1);
});

server.listen(pendingPort, HOST, () => {
  startRealtime();
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : pendingPort;
  console.log(`[kanban] 治理看板 → http://${HOST}:${listeningPort}`);
  console.log(`[kanban] 資料目錄：${CARDS_DIR}`);
});

server.on('close', () => {
  shutdownRealtime();
  void upgradeService.cleanup();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    shutdownRealtime();
    await upgradeService.cleanup();
    server.close();
  });
}
