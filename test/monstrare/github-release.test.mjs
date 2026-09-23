import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GITHUB_RELEASE_API_URL,
  GITHUB_RELEASE_REPOSITORY,
  GitHubReleaseError,
  createGitHubReleaseProvider,
  createLatestReleaseSession,
  createReleaseSessionStore,
} from '../../scripts/lib/github-release.mjs';
import { classifyInventoryPath, readSourceManifest, sha256 } from '../../scripts/lib/manifest.mjs';
import { serializeReleaseBundle } from '../../scripts/lib/release-bundle.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const version = '1.2.3';
const tag = `v${version}`;
const assetName = `monstrare-${tag}.bundle.json`;
const assetUrl = `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases/download/${tag}/${assetName}`;

async function temporaryDirectory(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function fileRecord(filePath, content, ownership = 'managed', mode = 0o644) {
  const bytes = Buffer.from(content);
  return {
    path: filePath,
    ownership,
    mode,
    sha256: sha256(bytes),
    contentBase64: bytes.toString('base64'),
  };
}

function fixtureBundleObject({ bundleVersion = version, manifestVersion = bundleVersion } = {}) {
  const manifest = {
    schemaVersion: 1,
    version: manifestVersion,
    minimumNode: '20.0.0',
    managed: ['VERSION', 'monstrare-package.json', 'managed/**'],
    seedOnly: [],
    projectData: [],
    sourceOnly: [],
  };
  return {
    schemaVersion: 1,
    version: bundleVersion,
    createdFrom: 'a'.repeat(40),
    files: [
      fileRecord('VERSION', `${bundleVersion}\n`),
      fileRecord('managed/example.txt', 'verified release content\n'),
      fileRecord('monstrare-package.json', `${JSON.stringify(manifest, null, 2)}\n`),
    ],
  };
}

function fixtureBundle(options) {
  return serializeReleaseBundle(fixtureBundleObject(options));
}

function releaseMetadata(bundle, overrides = {}) {
  const asset = {
    id: 22,
    name: assetName,
    digest: `sha256:${sha256(bundle)}`,
    browser_download_url: assetUrl,
    ...overrides.asset,
  };
  return {
    id: 11,
    draft: false,
    prerelease: false,
    tag_name: tag,
    assets: [asset],
    ...overrides,
    assets: overrides.assets ?? [asset],
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function sequenceTransport(responses, requests = []) {
  const queue = [...responses];
  return async (url, options) => {
    requests.push({ url, options });
    if (queue.length === 0) throw new Error('unexpected request');
    const next = queue.shift();
    return typeof next === 'function' ? next(url, options) : next;
  };
}

async function createTrackedTempFactory(t) {
  const roots = [];
  const cleanupCalls = [];
  return {
    roots,
    cleanupCalls,
    async factory() {
      const root = await temporaryDirectory(t, 'monstrare-github-release-');
      roots.push(root);
      return {
        sourceRoot: root,
        async cleanup() {
          cleanupCalls.push(root);
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function assertCode(code) {
  return (error) => error instanceof GitHubReleaseError && error.code === code;
}

test('fixed provider downloads, verifies, and materializes a release through a local transport fixture', async (t) => {
  const bundle = fixtureBundle();
  const baseUrl = await listen(t, (request, response) => {
    if (request.url === '/latest') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(releaseMetadata(bundle)));
      return;
    }
    if (request.url === '/asset') {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(bundle);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const requests = [];
  const provider = createGitHubReleaseProvider({
    transport: (url, options) => {
      requests.push({ url, options });
      const mapped = url === GITHUB_RELEASE_API_URL ? `${baseUrl}/latest` : `${baseUrl}/asset`;
      return fetch(mapped, options);
    },
  });

  const prepared = await provider.prepareLatestRelease();
  assert.equal(prepared.repository, GITHUB_RELEASE_REPOSITORY);
  assert.equal(prepared.releaseTag, tag);
  assert.equal(prepared.version, version);
  assert.equal(await fs.readFile(path.join(prepared.sourceRoot, 'VERSION'), 'utf8'), `${version}\n`);
  assert.deepEqual(requests.map(({ url }) => url), [GITHUB_RELEASE_API_URL, assetUrl]);
  for (const { options } of requests) {
    assert.equal(Object.keys(options.headers).some((name) => name.toLowerCase() === 'authorization'), false);
    assert.equal(options.redirect, 'manual');
  }
  const root = prepared.sourceRoot;
  await prepared.cleanup();
  await prepared.cleanup();
  await assert.rejects(() => fs.access(root));
});

test('repository, API URL, and host allowlists cannot be overridden by caller options', async () => {
  assert.throws(
    () => createGitHubReleaseProvider({ repository: 'attacker/repository' }),
    assertCode('GITHUB_RELEASE_CONFIG_INVALID'),
  );
  assert.throws(
    () => createGitHubReleaseProvider({ apiUrl: 'https://example.test/latest' }),
    assertCode('GITHUB_RELEASE_CONFIG_INVALID'),
  );
  const requests = [];
  const provider = createGitHubReleaseProvider({
    transport: sequenceTransport([jsonResponse(releaseMetadata(fixtureBundle()))], requests),
  });
  await provider.getLatestRelease();
  assert.equal(requests[0].url, GITHUB_RELEASE_API_URL);
});

test('release filtering rejects drafts, prereleases, and non-vSemVer tags', async () => {
  const bundle = fixtureBundle();
  for (const [metadata, code] of [
    [releaseMetadata(bundle, { draft: true }), 'GITHUB_RELEASE_INELIGIBLE'],
    [releaseMetadata(bundle, { prerelease: true }), 'GITHUB_RELEASE_INELIGIBLE'],
    [releaseMetadata(bundle, { tag_name: '1.2.3' }), 'GITHUB_RELEASE_TAG_INVALID'],
    [releaseMetadata(bundle, { tag_name: 'v1.2' }), 'GITHUB_RELEASE_TAG_INVALID'],
  ]) {
    const provider = createGitHubReleaseProvider({
      transport: sequenceTransport([jsonResponse(metadata)]),
    });
    await assert.rejects(() => provider.getLatestRelease(), assertCode(code));
  }
});

test('asset selection rejects missing, duplicate, missing digest, and invalid digest assets', async () => {
  const bundle = fixtureBundle();
  const valid = releaseMetadata(bundle).assets[0];
  for (const [assets, code] of [
    [[], 'GITHUB_RELEASE_ASSET_MISSING'],
    [[valid, { ...valid, id: 23 }], 'GITHUB_RELEASE_ASSET_DUPLICATE'],
    [[{ ...valid, digest: undefined }], 'GITHUB_RELEASE_ASSET_DIGEST_MISSING'],
    [[{ ...valid, digest: `sha256:${'A'.repeat(64)}` }], 'GITHUB_RELEASE_ASSET_DIGEST_INVALID'],
  ]) {
    const provider = createGitHubReleaseProvider({
      transport: sequenceTransport([jsonResponse(releaseMetadata(bundle, { assets }))]),
    });
    await assert.rejects(() => provider.getLatestRelease(), assertCode(code));
  }
});

test('asset URL, outer digest, bundle version, and embedded manifest mismatches fail closed', async (t) => {
  const validBundle = fixtureBundle();
  const invalidManifestObject = fixtureBundleObject({ manifestVersion: '9.9.9' });
  const invalidManifestBundle = `${JSON.stringify(invalidManifestObject)}\n`;
  const cases = [
    {
      metadata: releaseMetadata(validBundle, {
        asset: { browser_download_url: assetUrl.replace('/v1.2.3/', '/v9.9.9/') },
      }),
      responses: [],
      code: 'GITHUB_RELEASE_ASSET_URL_INVALID',
    },
    {
      metadata: releaseMetadata(validBundle, { asset: { digest: `sha256:${'0'.repeat(64)}` } }),
      responses: [new Response(validBundle)],
      code: 'GITHUB_RELEASE_DIGEST_MISMATCH',
    },
    {
      metadata: releaseMetadata(fixtureBundle({ bundleVersion: '1.2.4' })),
      responses: [new Response(fixtureBundle({ bundleVersion: '1.2.4' }))],
      code: 'GITHUB_RELEASE_BUNDLE_INVALID',
    },
    {
      metadata: releaseMetadata(invalidManifestBundle),
      responses: [new Response(invalidManifestBundle)],
      code: 'GITHUB_RELEASE_BUNDLE_INVALID',
    },
  ];

  for (const entry of cases) {
    const tracked = await createTrackedTempFactory(t);
    const provider = createGitHubReleaseProvider({
      transport: sequenceTransport([jsonResponse(entry.metadata), ...entry.responses]),
      tempFactory: tracked.factory,
    });
    await assert.rejects(() => provider.prepareLatestRelease(), assertCode(entry.code));
    if (tracked.roots.length > 0) {
      assert.equal(tracked.cleanupCalls.length, 1);
      await assert.rejects(() => fs.access(tracked.roots[0]));
    }
  }
});

test('each asset redirect is revalidated and an allowed chain succeeds', async (t) => {
  const bundle = fixtureBundle();
  const requests = [];
  const provider = createGitHubReleaseProvider({
    transport: sequenceTransport([
      jsonResponse(releaseMetadata(bundle)),
      new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/first' },
      }),
      new Response(null, {
        status: 307,
        headers: { location: 'https://objects.githubusercontent.com/final' },
      }),
      new Response(bundle),
    ], requests),
  });
  const prepared = await provider.prepareLatestRelease();
  t.after(() => prepared.cleanup());
  assert.deepEqual(requests.map(({ url }) => url), [
    GITHUB_RELEASE_API_URL,
    assetUrl,
    'https://release-assets.githubusercontent.com/first',
    'https://objects.githubusercontent.com/final',
  ]);
});

test('redirect host, protocol, and count violations are rejected and temp roots are cleaned', async (t) => {
  const bundle = fixtureBundle();
  for (const [responses, options, code] of [
    [[new Response(null, { status: 302, headers: { location: 'https://github.com.evil.test/file' } })], {}, 'GITHUB_RELEASE_REDIRECT_BLOCKED'],
    [[new Response(null, { status: 302, headers: { location: 'http://github.com/file' } })], {}, 'GITHUB_RELEASE_REDIRECT_BLOCKED'],
    [[
      new Response(null, { status: 302, headers: { location: 'https://github.com/one' } }),
      new Response(null, { status: 302, headers: { location: 'https://github.com/two' } }),
    ], { maxRedirects: 1 }, 'GITHUB_RELEASE_REDIRECT_LIMIT'],
  ]) {
    const tracked = await createTrackedTempFactory(t);
    const provider = createGitHubReleaseProvider({
      transport: sequenceTransport([jsonResponse(releaseMetadata(bundle)), ...responses]),
      tempFactory: tracked.factory,
      ...options,
    });
    await assert.rejects(() => provider.prepareLatestRelease(), assertCode(code));
    assert.equal(tracked.cleanupCalls.length, 1);
  }
});

test('404, forbidden, and rate limit responses map to stable error codes without reading bodies', async () => {
  const secret = 'do-not-echo-response-body';
  for (const [response, code] of [
    [new Response(secret, { status: 404 }), 'GITHUB_RELEASE_NOT_FOUND'],
    [new Response(secret, { status: 403 }), 'GITHUB_RELEASE_FORBIDDEN'],
    [new Response(secret, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
    }), 'GITHUB_RELEASE_RATE_LIMITED'],
  ]) {
    const provider = createGitHubReleaseProvider({ transport: sequenceTransport([response]) });
    await assert.rejects(
      () => provider.getLatestRelease(),
      (error) => assertCode(code)(error) && !error.message.includes(secret),
    );
  }
});

test('request timeout, body timeout, size exhaustion, and interrupted downloads clean temp roots', async (t) => {
  const bundle = fixtureBundle();
  const requestTimeoutProvider = createGitHubReleaseProvider({
    transport: () => new Promise(() => {}),
    requestTimeoutMs: 5,
  });
  await assert.rejects(
    () => requestTimeoutProvider.getLatestRelease(),
    assertCode('GITHUB_RELEASE_TIMEOUT'),
  );

  const neverBody = {
    status: 200,
    headers: new Headers(),
    body: {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}), return: async () => ({ done: true }) };
      },
    },
  };
  const interrupted = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('partial'));
      controller.error(new Error('secret transport detail'));
    },
  });
  for (const [assetResponse, options, code] of [
    [neverBody, { responseTimeoutMs: 5 }, 'GITHUB_RELEASE_TIMEOUT'],
    [new Response('x', { headers: { 'content-length': '101' } }), {
      limits: { downloadBytes: 100 },
    }, 'GITHUB_RELEASE_RESPONSE_TOO_LARGE'],
    [new Response(interrupted), {}, 'GITHUB_RELEASE_DOWNLOAD_INTERRUPTED'],
  ]) {
    const tracked = await createTrackedTempFactory(t);
    const provider = createGitHubReleaseProvider({
      transport: sequenceTransport([jsonResponse(releaseMetadata(bundle)), assetResponse]),
      tempFactory: tracked.factory,
      ...options,
    });
    await assert.rejects(() => provider.prepareLatestRelease(), assertCode(code));
    assert.equal(tracked.cleanupCalls.length, 1);
  }
});

test('session store keeps one opaque session and disposes replaced, expired, and manual sessions once', async () => {
  let now = Date.parse('2026-09-21T00:00:00.000Z');
  let token = 0;
  const disposed = [];
  const store = createReleaseSessionStore({
    clock: () => now,
    ttlMs: 1000,
    randomToken: () => `opaque-session-token-${++token}`,
  });
  const input = (suffix) => ({
    sourceRoot: `/tmp/monstrare-${suffix}`,
    repository: GITHUB_RELEASE_REPOSITORY,
    releaseId: suffix,
    releaseTag: tag,
    version,
    assetId: suffix + 100,
    assetName,
    assetDigest: 'a'.repeat(64),
    planDigest: 'b'.repeat(64),
    dispose: async () => disposed.push(suffix),
  });

  const first = await store.create(input(1));
  assert.equal((await store.get(first.token)).planDigest, 'b'.repeat(64));
  const second = await store.create(input(2));
  assert.deepEqual(disposed, [1]);
  assert.equal(await store.get(first.token), null);
  assert.equal((await store.get(second.token)).releaseId, 2);

  now += 1000;
  assert.equal(await store.get(second.token), null);
  assert.deepEqual(disposed, [1, 2]);
  assert.equal(await store.cleanup(second.token), false);

  const third = await store.create(input(3));
  assert.equal(await store.cleanup(third.token), true);
  assert.equal(await store.cleanup(third.token), false);
  assert.deepEqual(disposed, [1, 2, 3]);
});

test('session cleanup is idempotent even when a disposal callback fails', async () => {
  const store = createReleaseSessionStore({ randomToken: () => 'opaque-session-token-failure' });
  const session = await store.create({
    sourceRoot: '/tmp/monstrare-failure',
    repository: GITHUB_RELEASE_REPOSITORY,
    releaseId: 1,
    releaseTag: tag,
    version,
    assetId: 2,
    assetName,
    assetDigest: 'a'.repeat(64),
    planDigest: null,
    dispose: async () => { throw new Error('cleanup failed'); },
  });
  assert.equal(await store.cleanup(session.token), true);
  assert.equal(await store.cleanup(session.token), false);
});

test('prepared release can be atomically transferred to the session store', async (t) => {
  const bundle = fixtureBundle();
  const tracked = await createTrackedTempFactory(t);
  const provider = createGitHubReleaseProvider({
    transport: sequenceTransport([jsonResponse(releaseMetadata(bundle)), new Response(bundle)]),
    tempFactory: tracked.factory,
  });
  const store = createReleaseSessionStore({ randomToken: () => 'opaque-session-token-combined' });
  const session = await createLatestReleaseSession({
    provider,
    sessionStore: store,
    planDigest: 'c'.repeat(64),
  });
  assert.equal(session.repository, GITHUB_RELEASE_REPOSITORY);
  assert.equal(session.planDigest, 'c'.repeat(64));
  assert.equal(await fs.readFile(path.join(session.sourceRoot, 'VERSION'), 'utf8'), `${version}\n`);
  assert.equal(await store.cleanup(session.token), true);
  assert.equal(tracked.cleanupCalls.length, 1);
});

test('new provider module is managed without adding a production dependency', async () => {
  const manifest = await readSourceManifest(path.join(sourceRoot, 'monstrare-package.json'));
  assert.equal(classifyInventoryPath('scripts/lib/github-release.mjs', manifest), 'managed');
});
