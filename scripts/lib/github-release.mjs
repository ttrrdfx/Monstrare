import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseSemVer, sha256 } from './manifest.mjs';
import { materializeReleaseBundle, parseReleaseBundle, RELEASE_BUNDLE_LIMITS } from './release-bundle.mjs';

export const GITHUB_RELEASE_REPOSITORY = 'ttrrdfx/Monstrare';
export const GITHUB_RELEASE_API_URL =
  'https://api.github.com/repos/ttrrdfx/Monstrare/releases/latest';
export const GITHUB_RELEASE_SESSION_TTL_MS = 15 * 60 * 1000;

const MAX_REDIRECTS = 3;
const MAX_METADATA_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 30_000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const API_HOSTS = new Set(['api.github.com']);
const ASSET_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const PROVIDER_KEYS = new Set([
  'transport',
  'tempFactory',
  'requestTimeoutMs',
  'responseTimeoutMs',
  'maxRedirects',
  'limits',
]);
const LIMIT_KEYS = new Set(['metadataBytes', 'downloadBytes']);
const SESSION_STORE_KEYS = new Set(['clock', 'randomToken', 'ttlMs']);
const SESSION_INPUT_KEYS = new Set([
  'sourceRoot',
  'repository',
  'releaseId',
  'releaseTag',
  'version',
  'assetId',
  'assetName',
  'assetDigest',
  'planDigest',
  'dispose',
]);

export class GitHubReleaseError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'GitHubReleaseError';
    this.code = code;
    this.retryable = retryable;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubReleaseError('GITHUB_RELEASE_CONFIG_INVALID', `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowed, label) {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      `${label} contains unsupported field: ${unsupported}`,
    );
  }
}

function assertPositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      `${label} must be a positive integer no greater than ${maximum}`,
    );
  }
  return value;
}

function resolveLimits(limits = {}) {
  assertPlainObject(limits, 'GitHub release limits');
  assertOnlyKeys(limits, LIMIT_KEYS, 'GitHub release limits');
  return Object.freeze({
    metadataBytes: limits.metadataBytes === undefined
      ? MAX_METADATA_BYTES
      : assertPositiveInteger(limits.metadataBytes, 'metadataBytes', MAX_METADATA_BYTES),
    downloadBytes: limits.downloadBytes === undefined
      ? RELEASE_BUNDLE_LIMITS.maxBundleBytes
      : assertPositiveInteger(
        limits.downloadBytes,
        'downloadBytes',
        RELEASE_BUNDLE_LIMITS.maxBundleBytes,
      ),
  });
}

function allowedHostsFor(kind) {
  return kind === 'api' ? API_HOSTS : ASSET_HOSTS;
}

function parseAllowedUrl(value, kind) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_REDIRECT_BLOCKED',
      'GitHub release response contained an invalid URL',
    );
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.port !== '' && url.port !== '443')
    || !allowedHostsFor(kind).has(url.hostname)
  ) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_REDIRECT_BLOCKED',
      'GitHub release request was blocked by the network allowlist',
    );
  }
  return url;
}

function headerValue(response, name) {
  if (response?.headers && typeof response.headers.get === 'function') {
    return response.headers.get(name);
  }
  if (response?.headers && typeof response.headers === 'object') {
    const key = Object.keys(response.headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    return key ? String(response.headers[key]) : null;
  }
  return null;
}

function cancelBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') {
      Promise.resolve(response.body.cancel()).catch(() => {});
    }
  } catch {
    // Best effort. Errors from rejected responses must not shadow the stable provider error.
  }
}

function timeoutError() {
  return new GitHubReleaseError(
    'GITHUB_RELEASE_TIMEOUT',
    'GitHub release request timed out',
    { retryable: true },
  );
}

async function withTimeout(operation, timeoutMs, controller) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function bodyIterator(response) {
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    return response.body[Symbol.asyncIterator]();
  }
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    return {
      next: () => reader.read(),
      return: () => reader.cancel(),
    };
  }
  throw new GitHubReleaseError(
    'GITHUB_RELEASE_RESPONSE_INVALID',
    'GitHub release response did not provide a readable body',
  );
}

async function readLimitedBody(response, { maxBytes, timeoutMs, controller }) {
  const contentLength = headerValue(response, 'content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    cancelBody(response);
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_RESPONSE_TOO_LARGE',
      'GitHub release response exceeded the byte limit',
    );
  }

  let iterator;
  try {
    iterator = bodyIterator(response);
  } catch (error) {
    cancelBody(response);
    throw error;
  }

  const read = (async () => {
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await iterator.next();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new GitHubReleaseError(
            'GITHUB_RELEASE_RESPONSE_TOO_LARGE',
            'GitHub release response exceeded the byte limit',
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error instanceof GitHubReleaseError) throw error;
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_DOWNLOAD_INTERRUPTED',
        'GitHub release response ended unexpectedly',
        { retryable: true },
      );
    }
  })();

  try {
    return await withTimeout(read, timeoutMs, controller);
  } catch (error) {
    controller.abort();
    try {
      Promise.resolve(iterator.return?.()).catch(() => {});
    } catch {
      // Best effort stream cancellation.
    }
    throw error;
  }
}

function statusError(response) {
  if (response.status === 404) {
    return new GitHubReleaseError(
      'GITHUB_RELEASE_NOT_FOUND',
      'GitHub release or asset was not found',
    );
  }
  if (response.status === 403) {
    const limited = headerValue(response, 'x-ratelimit-remaining') === '0'
      || headerValue(response, 'retry-after') !== null;
    return new GitHubReleaseError(
      limited ? 'GITHUB_RELEASE_RATE_LIMITED' : 'GITHUB_RELEASE_FORBIDDEN',
      limited ? 'GitHub release request was rate limited' : 'GitHub release request was forbidden',
      { retryable: limited },
    );
  }
  return new GitHubReleaseError(
    'GITHUB_RELEASE_HTTP_ERROR',
    `GitHub release request failed with HTTP ${response.status}`,
    { retryable: response.status >= 500 },
  );
}

async function requestBytes({
  url,
  kind,
  transport,
  headers,
  maxBytes,
  maxRedirects,
  requestTimeoutMs,
  responseTimeoutMs,
}) {
  let current = parseAllowedUrl(url, kind);
  let redirectCount = 0;

  while (true) {
    const controller = new AbortController();
    let response;
    try {
      response = await withTimeout(
        Promise.resolve().then(() => transport(current.href, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers,
        })),
        requestTimeoutMs,
        controller,
      );
    } catch (error) {
      if (error instanceof GitHubReleaseError) throw error;
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_NETWORK_ERROR',
        'GitHub release request failed before a response was received',
        { retryable: true },
      );
    }
    if (!response || !Number.isInteger(response.status)) {
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_RESPONSE_INVALID',
        'GitHub release transport returned an invalid response',
      );
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = headerValue(response, 'location');
      cancelBody(response);
      if (!location) {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_REDIRECT_BLOCKED',
          'GitHub release redirect did not include a location',
        );
      }
      if (redirectCount >= maxRedirects) {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_REDIRECT_LIMIT',
          'GitHub release request exceeded the redirect limit',
        );
      }
      let next;
      try {
        next = new URL(location, current);
      } catch {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_REDIRECT_BLOCKED',
          'GitHub release redirect contained an invalid location',
        );
      }
      current = parseAllowedUrl(next, kind);
      redirectCount += 1;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      cancelBody(response);
      throw statusError(response);
    }
    return {
      bytes: await readLimitedBody(response, {
        maxBytes,
        timeoutMs: responseTimeoutMs,
        controller,
      }),
      finalUrl: current.href,
    };
  }
}

function parseJson(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_RESPONSE_INVALID',
      'GitHub release metadata was not valid JSON',
    );
  }
}

function requirePositiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_RESPONSE_INVALID',
      `GitHub release metadata contained an invalid ${label}`,
    );
  }
  return value;
}

function parseReleaseMetadata(bytes) {
  const release = parseJson(bytes);
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_RESPONSE_INVALID',
      'GitHub release metadata must be an object',
    );
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_INELIGIBLE',
      'GitHub latest release was not a formal release',
    );
  }
  if (typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_TAG_INVALID',
      'GitHub release tag must be v followed by a strict SemVer version',
    );
  }
  const version = release.tag_name.slice(1);
  try {
    parseSemVer(version, 'GitHub release version');
  } catch {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_TAG_INVALID',
      'GitHub release tag must be v followed by a strict SemVer version',
    );
  }
  if (!Array.isArray(release.assets)) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_RESPONSE_INVALID',
      'GitHub release metadata must include assets',
    );
  }

  const assetName = `monstrare-${release.tag_name}.bundle.json`;
  const matches = release.assets.filter((asset) => asset?.name === assetName);
  if (matches.length === 0) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_ASSET_MISSING',
      'GitHub release did not include the expected bundle asset',
    );
  }
  if (matches.length !== 1) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_ASSET_DUPLICATE',
      'GitHub release included duplicate bundle assets',
    );
  }
  const asset = matches[0];
  if (typeof asset.digest !== 'string') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_ASSET_DIGEST_MISSING',
      'GitHub release asset did not include a SHA-256 digest',
    );
  }
  const digestMatch = /^sha256:([a-f0-9]{64})$/.exec(asset.digest);
  if (!digestMatch) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_ASSET_DIGEST_INVALID',
      'GitHub release asset digest was not a canonical SHA-256 digest',
    );
  }
  const assetUrl = parseAllowedUrl(asset.browser_download_url, 'asset');
  const expectedPath = `/${GITHUB_RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${assetName}`;
  if (
    assetUrl.hostname !== 'github.com'
    || assetUrl.pathname !== expectedPath
    || assetUrl.search !== ''
    || assetUrl.hash !== ''
  ) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_ASSET_URL_INVALID',
      'GitHub release asset URL did not match the fixed repository and tag',
    );
  }

  return Object.freeze({
    repository: GITHUB_RELEASE_REPOSITORY,
    releaseId: requirePositiveId(release.id, 'release id'),
    releaseTag: release.tag_name,
    version,
    assetId: requirePositiveId(asset.id, 'asset id'),
    assetName,
    assetDigest: digestMatch[1],
    assetUrl: assetUrl.href,
  });
}

async function defaultTransport(url, options) {
  return fetch(url, options);
}

async function defaultTempFactory() {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'monstrare-release-'));
  let disposed = false;
  return {
    sourceRoot,
    async cleanup() {
      if (disposed) return;
      disposed = true;
      await fs.rm(sourceRoot, { recursive: true, force: true });
    },
  };
}

function validateTempHandle(handle) {
  if (
    !handle
    || typeof handle !== 'object'
    || typeof handle.sourceRoot !== 'string'
    || handle.sourceRoot.trim() === ''
    || typeof handle.cleanup !== 'function'
  ) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_TEMP_INVALID',
      'GitHub release temp factory returned an invalid handle',
    );
  }
  return handle;
}

async function cleanupQuietly(cleanup) {
  try {
    await cleanup();
  } catch {
    // Session and failed-download cleanup are intentionally idempotent and best effort.
  }
}

export function createGitHubReleaseProvider(options = {}) {
  assertPlainObject(options, 'GitHub release provider options');
  assertOnlyKeys(options, PROVIDER_KEYS, 'GitHub release provider options');
  const transport = options.transport ?? defaultTransport;
  const tempFactory = options.tempFactory ?? defaultTempFactory;
  if (typeof transport !== 'function' || typeof tempFactory !== 'function') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      'transport and tempFactory must be functions',
    );
  }
  const requestTimeoutMs = options.requestTimeoutMs === undefined
    ? REQUEST_TIMEOUT_MS
    : assertPositiveInteger(options.requestTimeoutMs, 'requestTimeoutMs');
  const responseTimeoutMs = options.responseTimeoutMs === undefined
    ? RESPONSE_TIMEOUT_MS
    : assertPositiveInteger(options.responseTimeoutMs, 'responseTimeoutMs');
  const maxRedirects = options.maxRedirects === undefined
    ? MAX_REDIRECTS
    : assertPositiveInteger(options.maxRedirects, 'maxRedirects', MAX_REDIRECTS);
  const limits = resolveLimits(options.limits);
  const request = (input) => requestBytes({
    transport,
    maxRedirects,
    requestTimeoutMs,
    responseTimeoutMs,
    ...input,
  });

  async function getLatestRelease() {
    const { bytes } = await request({
      url: GITHUB_RELEASE_API_URL,
      kind: 'api',
      headers: Object.freeze({
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Monstrare-Release-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      }),
      maxBytes: limits.metadataBytes,
    });
    return parseReleaseMetadata(bytes);
  }

  async function prepareLatestRelease() {
    const metadata = await getLatestRelease();
    let tempHandle;
    try {
      tempHandle = validateTempHandle(await tempFactory());
    } catch (error) {
      if (error instanceof GitHubReleaseError) throw error;
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_TEMP_FAILED',
        'Unable to create the GitHub release temp directory',
      );
    }

    try {
      const { bytes } = await request({
        url: metadata.assetUrl,
        kind: 'asset',
        headers: Object.freeze({
          Accept: 'application/octet-stream',
          'User-Agent': 'Monstrare-Release-Updater',
        }),
        maxBytes: limits.downloadBytes,
      });
      if (sha256(bytes) !== metadata.assetDigest) {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_DIGEST_MISMATCH',
          'GitHub release asset failed SHA-256 verification',
        );
      }

      let bundle;
      try {
        bundle = parseReleaseBundle(bytes, {
          expectedVersion: metadata.version,
          limits: { maxBundleBytes: limits.downloadBytes },
        });
        await materializeReleaseBundle({
          bundle,
          targetRoot: tempHandle.sourceRoot,
          expectedVersion: metadata.version,
          limits: { maxBundleBytes: limits.downloadBytes },
        });
      } catch {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_BUNDLE_INVALID',
          'GitHub release bundle failed contract verification',
        );
      }

      let disposed = false;
      return Object.freeze({
        ...metadata,
        sourceRoot: tempHandle.sourceRoot,
        async cleanup() {
          if (disposed) return;
          disposed = true;
          await cleanupQuietly(tempHandle.cleanup);
        },
      });
    } catch (error) {
      await cleanupQuietly(tempHandle.cleanup);
      if (error instanceof GitHubReleaseError) throw error;
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_DOWNLOAD_FAILED',
        'GitHub release asset could not be prepared',
        { retryable: true },
      );
    }
  }

  return Object.freeze({ getLatestRelease, prepareLatestRelease });
}

function validateSessionInput(input) {
  assertPlainObject(input, 'release session');
  assertOnlyKeys(input, SESSION_INPUT_KEYS, 'release session');
  for (const key of ['sourceRoot', 'repository', 'releaseTag', 'version', 'assetName', 'assetDigest']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) {
      throw new GitHubReleaseError(
        'GITHUB_RELEASE_SESSION_INVALID',
        `release session ${key} must be a non-empty string`,
      );
    }
  }
  if (input.repository !== GITHUB_RELEASE_REPOSITORY || !SHA256_RE.test(input.assetDigest)) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_SESSION_INVALID',
      'release session metadata did not match the fixed provider contract',
    );
  }
  requirePositiveId(input.releaseId, 'release id');
  requirePositiveId(input.assetId, 'asset id');
  try {
    parseSemVer(input.version, 'release session version');
  } catch {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_SESSION_INVALID',
      'release session version must be strict SemVer',
    );
  }
  if (input.releaseTag !== `v${input.version}`) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_SESSION_INVALID',
      'release session tag did not match its version',
    );
  }
  if (input.planDigest !== undefined && input.planDigest !== null && !SHA256_RE.test(input.planDigest)) {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_SESSION_INVALID',
      'release session plan digest must be a canonical SHA-256 digest',
    );
  }
  if (typeof input.dispose !== 'function') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_SESSION_INVALID',
      'release session must provide a disposal callback',
    );
  }
  return { ...input, planDigest: input.planDigest ?? null };
}

export function createReleaseSessionStore(options = {}) {
  assertPlainObject(options, 'release session store options');
  assertOnlyKeys(options, SESSION_STORE_KEYS, 'release session store options');
  const clock = options.clock ?? Date.now;
  const randomToken = options.randomToken ?? crypto.randomUUID;
  const ttlMs = options.ttlMs === undefined
    ? GITHUB_RELEASE_SESSION_TTL_MS
    : assertPositiveInteger(options.ttlMs, 'ttlMs', GITHUB_RELEASE_SESSION_TTL_MS);
  if (typeof clock !== 'function' || typeof randomToken !== 'function') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      'clock and randomToken must be functions',
    );
  }

  let active = null;
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const run = pending.then(operation, operation);
    pending = run.catch(() => {});
    return run;
  };

  async function disposeRecord(record) {
    if (!record || record.disposed) return;
    record.disposed = true;
    await cleanupQuietly(record.dispose);
  }

  async function create(input) {
    const normalized = validateSessionInput(input);
    return enqueue(async () => {
      const now = clock();
      const expiresAtMs = now + ttlMs;
      if (
        !Number.isFinite(now)
        || !Number.isFinite(expiresAtMs)
        || Number.isNaN(new Date(now).getTime())
        || Number.isNaN(new Date(expiresAtMs).getTime())
      ) {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_SESSION_INVALID',
          'release session clock returned an invalid value',
        );
      }
      const token = randomToken();
      if (typeof token !== 'string' || token.length < 16) {
        throw new GitHubReleaseError(
          'GITHUB_RELEASE_SESSION_INVALID',
          'release session token generator returned an invalid token',
        );
      }
      const previous = active;
      active = null;
      await disposeRecord(previous);
      const publicSession = Object.freeze({
        token,
        sourceRoot: normalized.sourceRoot,
        repository: normalized.repository,
        releaseId: normalized.releaseId,
        releaseTag: normalized.releaseTag,
        version: normalized.version,
        assetId: normalized.assetId,
        assetName: normalized.assetName,
        assetDigest: normalized.assetDigest,
        planDigest: normalized.planDigest,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
      active = {
        token,
        expiresAtMs,
        dispose: normalized.dispose,
        disposed: false,
        publicSession,
      };
      return publicSession;
    });
  }

  async function get(token) {
    return enqueue(async () => {
      if (!active || token !== active.token) return null;
      if (clock() >= active.expiresAtMs) {
        const expired = active;
        active = null;
        await disposeRecord(expired);
        return null;
      }
      return active.publicSession;
    });
  }

  async function cleanupExpired() {
    return enqueue(async () => {
      if (!active || clock() < active.expiresAtMs) return false;
      const expired = active;
      active = null;
      await disposeRecord(expired);
      return true;
    });
  }

  async function cleanup(token) {
    return enqueue(async () => {
      if (!active || (token !== undefined && token !== active.token)) return false;
      const removed = active;
      active = null;
      await disposeRecord(removed);
      return true;
    });
  }

  return Object.freeze({ create, get, cleanupExpired, cleanup });
}

export async function createLatestReleaseSession({
  provider,
  sessionStore,
  planDigest = null,
} = {}) {
  if (!provider || typeof provider.prepareLatestRelease !== 'function') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      'provider must implement prepareLatestRelease',
    );
  }
  if (!sessionStore || typeof sessionStore.create !== 'function') {
    throw new GitHubReleaseError(
      'GITHUB_RELEASE_CONFIG_INVALID',
      'sessionStore must implement create',
    );
  }
  const prepared = await provider.prepareLatestRelease();
  try {
    return await sessionStore.create({
      sourceRoot: prepared.sourceRoot,
      repository: prepared.repository,
      releaseId: prepared.releaseId,
      releaseTag: prepared.releaseTag,
      version: prepared.version,
      assetId: prepared.assetId,
      assetName: prepared.assetName,
      assetDigest: prepared.assetDigest,
      planDigest,
      dispose: prepared.cleanup,
    });
  } catch (error) {
    await cleanupQuietly(prepared.cleanup);
    throw error;
  }
}
