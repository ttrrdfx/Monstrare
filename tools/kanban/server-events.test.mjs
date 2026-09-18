import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const SERVER_FILE = new URL('./server.mjs', import.meta.url);

async function startServer(t, { port = '0' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-events-'));
  await fs.mkdir(path.join(root, 'cards'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>test</title>');
  await fs.writeFile(path.join(root, 'epics.json'), '{"epics":[]}\n');

  const child = spawn(process.execPath, [SERVER_FILE.pathname], {
    env: {
      ...process.env,
      KANBAN_ROOT: root,
      KANBAN_PORT: String(port),
      KANBAN_EVENT_DEBOUNCE_MS: '25',
      KANBAN_HEARTBEAT_MS: '40'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  let stdout = '';
  const baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout: ' + stderr)), 3000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early (${code}): ${stderr}`));
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, child, baseUrl, getStderr: () => stderr, getStdout: () => stdout };
}

function connectEvents(baseUrl) {
  const messages = [];
  const waiters = [];
  let buffer = '';
  let response;

  function deliver(message) {
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  }

  const ready = new Promise((resolve, reject) => {
    const req = http.get(baseUrl + '/api/events', (res) => {
      response = res;
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /^text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (block.startsWith(':')) {
            deliver({ comment: block.slice(1).trim() });
            continue;
          }
          const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message';
          const dataText = block.match(/^data: (.*)$/m)?.[1] ?? 'null';
          const message = { event, data: JSON.parse(dataText) };
          deliver(message);
          if (event === 'ready') resolve();
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });

  function next(predicate, timeoutMs = 2000) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiters.push(waiter);
      const timeout = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error('SSE event timeout'));
      }, timeoutMs);
      waiter.resolve = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
    });
  }

  return {
    ready,
    next,
    nextChange: (...resources) => next((message) =>
      message.event === 'change' && resources.every((resource) => message.data.resources.includes(resource))
    ),
    close: () => response?.destroy()
  };
}

function card(id, overrides = {}) {
  return {
    id,
    title: id,
    content: '',
    stage: 'backlog',
    risk: 'low',
    owner: '',
    agent: '',
    approvalRequired: false,
    createdAt: '2026-09-06',
    epic: '',
    userStory: '',
    track: 'n/a',
    dependsOn: [],
    order: 1,
    readiness: {
      problem_clear: false,
      non_goals_clear: false,
      acceptance_testable: false,
      files_known: false,
      scope_defined: false,
      verification_contract: false,
      human_approval_recorded: false
    },
    gates: { product: false, ui: false, architecture: false, security: false, test: false, code_review: false },
    links: { featureSpec: '', screenSpec: '', mockupDecision: '', taskCard: '', verificationReport: '', pr: '' },
    refs: [],
    evidence: { commands: [], findings: [], residual: '' },
    comments: [],
    ...overrides
  };
}

async function api(baseUrl, pathname, method, body) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) assert.fail(`${method} ${pathname} failed: ${await response.text()}`);
  return response.json();
}

test('SSE announces API writes, direct edits, replacements, merged resources, and heartbeat', async (t) => {
  const { root, baseUrl } = await startServer(t);
  const events = connectEvents(baseUrl);
  await events.ready;
  assert.deepEqual(await events.next((message) => message.event === 'ready'), { event: 'ready', data: {} });

  const created = await api(baseUrl, '/api/cards', 'POST', { title: 'created' });
  assert.deepEqual((await events.nextChange('cards')).data.resources, ['cards']);

  await api(baseUrl, '/api/cards/' + created.id, 'PUT', { ...created, title: 'updated' });
  await events.nextChange('cards');

  await api(baseUrl, '/api/cards', 'PUT', [{ ...created, title: 'bulk updated' }]);
  await events.nextChange('cards');

  await api(baseUrl, '/api/cards/' + created.id, 'DELETE');
  await events.nextChange('cards');

  const directFile = path.join(root, 'cards', 'TASK-900.json');
  await fs.writeFile(directFile, JSON.stringify(card('TASK-900')) + '\n');
  await events.nextChange('cards');

  const replacement = path.join(root, 'cards', '.TASK-900.json.tmp');
  await fs.writeFile(replacement, JSON.stringify(card('TASK-900', { title: 'replacement' })) + '\n');
  await fs.rename(replacement, directFile);
  await events.nextChange('cards');

  await Promise.all([
    fs.writeFile(directFile, JSON.stringify(card('TASK-900', { title: 'merged' })) + '\n'),
    fs.writeFile(path.join(root, 'epics.json'), '{"epics":[{"name":"Merged","stories":[]}]}\n')
  ]);
  assert.deepEqual((await events.nextChange('cards', 'epics')).data.resources, ['cards', 'epics']);
  assert.equal((await events.next((message) => message.comment === 'heartbeat')).comment, 'heartbeat');

  events.close();
});

test('closing the server ends SSE clients and releases the process', async (t) => {
  const { child, baseUrl, getStderr } = await startServer(t);
  const events = connectEvents(baseUrl);
  await events.ready;
  events.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const created = await api(baseUrl, '/api/cards', 'POST', { title: 'after disconnect' });
  assert.equal(created.title, 'after disconnect');

  const activeEvents = connectEvents(baseUrl);
  await activeEvents.ready;
  child.kill('SIGTERM');
  const [code, signal] = await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('graceful close timeout: ' + getStderr())), 2000))
  ]);
  assert.equal(code, 0);
  assert.equal(signal, null);
});

test('tries the next port when the configured port is occupied', async (t) => {
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => blocker.close());

  const address = blocker.address();
  assert.equal(typeof address, 'object');
  const occupiedPort = address.port;
  const { baseUrl, getStderr } = await startServer(t, { port: occupiedPort });
  const listeningPort = Number(new URL(baseUrl).port);

  assert.ok(listeningPort > occupiedPort);
  assert.match(getStderr(), new RegExp(`port ${occupiedPort} 已被占用，改用 ${occupiedPort + 1}`));
  assert.deepEqual(await api(baseUrl, '/api/cards', 'GET'), []);
});
