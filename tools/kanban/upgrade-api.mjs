import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createGitHubReleaseProvider,
  createReleaseSessionStore,
  GITHUB_RELEASE_REPOSITORY,
  GitHubReleaseError,
} from '../../scripts/lib/github-release.mjs';
import { parseSemVer, readInstallManifest } from '../../scripts/lib/manifest.mjs';
import { getPlanSnapshot, planProjectUpgrade } from '../../scripts/lib/plan.mjs';
import { applyProjectUpgrade } from '../../scripts/lib/transaction.mjs';
import { verifyProject } from '../../scripts/lib/verify.mjs';

export const UPGRADE_REQUEST_BODY_LIMIT = 8 * 1024;

const CHECK_KEYS = new Set();
const APPLY_KEYS = new Set([
  'expectedInstalledVersion',
  'expectedSourceVersion',
  'planToken',
  'confirm',
]);
const PLAN_ACTIONS = ['add', 'update', 'remove', 'preserve', 'conflict'];

export class UpgradeApiError extends Error {
  constructor(code, message, {
    status = 500,
    retryable = false,
    details = {},
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'UpgradeApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value)) {
    throw new UpgradeApiError(
      'UPGRADE_REQUEST_INVALID',
      `${label} 必須是 JSON object。`,
      { status: 400 },
    );
  }
  const actual = Object.keys(value);
  const unsupported = actual.find((key) => !expected.has(key));
  const missing = [...expected].find((key) => !Object.hasOwn(value, key));
  if (unsupported || missing || actual.length !== expected.size) {
    throw new UpgradeApiError(
      'UPGRADE_REQUEST_INVALID',
      `${label} 欄位不符合 API 契約。`,
      { status: 400 },
    );
  }
}

function strictSemVer(value, label) {
  try {
    return parseSemVer(value, label).version;
  } catch {
    throw new UpgradeApiError(
      'UPGRADE_REQUEST_INVALID',
      `${label} 必須是嚴格的 SemVer。`,
      { status: 400 },
    );
  }
}

export function validateUpgradeBody(kind, value) {
  if (kind === 'check') {
    assertExactKeys(value, CHECK_KEYS, 'check body');
    return Object.freeze({});
  }
  if (kind !== 'apply') {
    throw new UpgradeApiError('UPGRADE_REQUEST_INVALID', '未知的版本更新操作。', { status: 400 });
  }
  assertExactKeys(value, APPLY_KEYS, 'apply body');
  if (value.confirm !== true) {
    throw new UpgradeApiError(
      'UPGRADE_CONFIRMATION_REQUIRED',
      '套用更新前必須明確確認。',
      { status: 400 },
    );
  }
  if (typeof value.planToken !== 'string' || value.planToken.length < 16 || value.planToken.length > 256) {
    throw new UpgradeApiError('UPGRADE_REQUEST_INVALID', 'planToken 格式無效。', { status: 400 });
  }
  return Object.freeze({
    expectedInstalledVersion: strictSemVer(value.expectedInstalledVersion, 'expectedInstalledVersion'),
    expectedSourceVersion: strictSemVer(value.expectedSourceVersion, 'expectedSourceVersion'),
    planToken: value.planToken,
    confirm: true,
  });
}

function singleHeader(headers, name) {
  const value = headers?.[name];
  return typeof value === 'string' ? value : null;
}

export function validateUpgradePostHeaders(headers, localPort) {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    throw new UpgradeApiError('UPGRADE_ORIGIN_FORBIDDEN', '無法確認看板的本機來源。', { status: 403 });
  }
  const host = singleHeader(headers, 'host');
  const allowedHosts = new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`]);
  if (!host || !allowedHosts.has(host)) {
    throw new UpgradeApiError('UPGRADE_ORIGIN_FORBIDDEN', '請求來源不是目前的本機看板。', { status: 403 });
  }

  const origin = singleHeader(headers, 'origin');
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new UpgradeApiError('UPGRADE_ORIGIN_FORBIDDEN', '請求缺少有效的同源 Origin。', { status: 403 });
  }
  if (
    parsedOrigin.protocol !== 'http:'
    || parsedOrigin.username !== ''
    || parsedOrigin.password !== ''
    || parsedOrigin.host !== host
    || parsedOrigin.pathname !== '/'
    || parsedOrigin.search !== ''
    || parsedOrigin.hash !== ''
  ) {
    throw new UpgradeApiError('UPGRADE_ORIGIN_FORBIDDEN', '請求 Origin 與目前看板不相符。', { status: 403 });
  }
  if (singleHeader(headers, 'sec-fetch-site')?.toLowerCase() === 'cross-site') {
    throw new UpgradeApiError('UPGRADE_ORIGIN_FORBIDDEN', '跨網站請求不可執行版本更新。', { status: 403 });
  }

  const contentType = singleHeader(headers, 'content-type');
  if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) {
    throw new UpgradeApiError(
      'UPGRADE_CONTENT_TYPE_REQUIRED',
      '版本更新請求只接受 application/json。',
      { status: 415 },
    );
  }
}

export async function readUpgradeJsonBody(req, { limit = UPGRADE_REQUEST_BODY_LIMIT } = {}) {
  const declaredLength = singleHeader(req.headers, 'content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) {
    throw new UpgradeApiError('UPGRADE_BODY_TOO_LARGE', '版本更新請求內容過大。', { status: 413 });
  }
  const chunks = [];
  let total = 0;
  for await (const value of req) {
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) {
      throw new UpgradeApiError('UPGRADE_BODY_TOO_LARGE', '版本更新請求內容過大。', { status: 413 });
    }
    chunks.push(chunk);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new UpgradeApiError('UPGRADE_REQUEST_INVALID', '版本更新請求不是有效的 UTF-8。', { status: 400 });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UpgradeApiError('UPGRADE_REQUEST_INVALID', '版本更新請求不是合法 JSON。', { status: 400 });
  }
}

function canonicalIntegritySnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return null;
  const sourceInventory = Array.isArray(snapshot.sourceInventory)
    ? snapshot.sourceInventory.map(({ path: relativePath, ownership, sha256 }) => ({
      path: relativePath,
      ownership,
      sha256,
    })).sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const targetFiles = isPlainObject(snapshot.targetFiles)
    ? Object.keys(snapshot.targetFiles).sort().map((relativePath) => ({
      path: relativePath,
      exists: snapshot.targetFiles[relativePath]?.exists === true,
      type: snapshot.targetFiles[relativePath]?.type ?? 'missing',
      sha256: snapshot.targetFiles[relativePath]?.sha256 ?? null,
    }))
    : [];
  return {
    sourceInventory,
    targetFiles,
    installManifest: snapshot.installManifest?.exists === true
      ? { exists: true, sha256: snapshot.installManifest.sha256 ?? null }
      : { exists: false },
  };
}

function canonicalPlanPayload(plan, release, integritySnapshot) {
  return {
    repository: release.repository,
    releaseId: release.releaseId,
    releaseTag: release.releaseTag,
    assetDigest: release.assetDigest,
    installedVersion: plan.installedVersion,
    sourceVersion: plan.sourceVersion,
    manifestStatus: plan.manifestStatus,
    applicable: plan.applicable,
    entries: plan.files
      .map(({ path: relativePath, action, reason }) => ({ path: relativePath, action, reason }))
      .sort((left, right) => left.path.localeCompare(right.path)
        || left.action.localeCompare(right.action)
        || left.reason.localeCompare(right.reason)),
    integrity: canonicalIntegritySnapshot(integritySnapshot),
  };
}

export function createUpgradePlanDigest(plan, release, integritySnapshot = null) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalPlanPayload(plan, release, integritySnapshot)))
    .digest('hex');
}

function countsFromPlan(plan) {
  return Object.fromEntries(PLAN_ACTIONS.map((action) => [action, Number(plan.summary?.[action] ?? 0)]));
}

function entriesFromPlan(plan) {
  return plan.files.map(({ path: relativePath, action, reason }) => ({
    path: relativePath,
    action,
    reason,
  }));
}

function mutationCount(plan) {
  return ['add', 'update', 'remove'].reduce((sum, action) => sum + Number(plan.summary?.[action] ?? 0), 0);
}

function projectRelativePath(targetRoot, absolutePath) {
  if (!absolutePath) return null;
  const relative = path.relative(targetRoot, absolutePath).split(path.sep).join('/');
  if (relative === '' || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function verificationSummary(result) {
  return {
    ok: result?.ok === true,
    checks: Array.isArray(result?.checks) ? result.checks.map(({ id, label, status }) => ({
      id: String(id ?? ''),
      label: String(label ?? ''),
      status: String(status ?? ''),
    })) : [],
  };
}

function applyFailure(error, targetRoot) {
  const backupPath = projectRelativePath(targetRoot, error?.backupRoot);
  const details = backupPath ? { backupPath } : {};
  if (error?.code === 'UPGRADE_RECOVERY_FAILED') {
    return new UpgradeApiError(
      'UPGRADE_ROLLBACK_FAILED',
      '更新失敗，且自動復原未完整完成；請依備份紀錄人工處理。',
      { status: 500, details, cause: error },
    );
  }
  if (error?.code === 'UPGRADE_LOCKED') {
    return new UpgradeApiError(
      'UPGRADE_BUSY',
      '另一個版本更新正在執行，請稍後再試。',
      { status: 409, retryable: true, cause: error },
    );
  }
  if (['UPGRADE_PLAN_STALE', 'UPGRADE_SOURCE_STALE', 'UPGRADE_TARGET_STALE'].includes(error?.code)) {
    return new UpgradeApiError(
      'UPGRADE_PLAN_STALE',
      '版本計畫已改變，請重新檢查。',
      { status: 409, retryable: true, details, cause: error },
    );
  }
  if (error?.code === 'UPGRADE_CONFLICT') {
    return new UpgradeApiError(
      'UPGRADE_CONFLICT',
      '目前版本包含衝突，未套用任何變更。',
      { status: 409, details, cause: error },
    );
  }
  return new UpgradeApiError(
    'UPGRADE_TRANSACTION_FAILED',
    '更新交易失敗，已嘗試回復原狀。',
    { status: 500, details, cause: error },
  );
}

export function normalizeUpgradeError(error) {
  if (error instanceof UpgradeApiError) return error;
  if (error instanceof GitHubReleaseError || String(error?.code ?? '').startsWith('GITHUB_RELEASE_')) {
    return new UpgradeApiError(
      error.code,
      '無法取得或驗證版本更新來源。',
      { status: error.retryable ? 503 : 502, retryable: error.retryable === true, cause: error },
    );
  }
  return new UpgradeApiError(
    'UPGRADE_INTERNAL_ERROR',
    '版本更新服務發生未預期的錯誤。',
    { status: 500, cause: error },
  );
}

async function defaultLocalStatus(targetRoot) {
  let installedVersion = null;
  let manifestStatus = 'unknown';
  const manifestPath = path.join(targetRoot, '.monstrare', 'manifest.json');
  let hasManifest = false;
  try {
    await fs.access(manifestPath);
    hasManifest = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') return {
      installedVersion: null,
      manifestStatus: 'invalid',
      writable: await writableStatus(targetRoot),
    };
  }
  if (hasManifest) {
    try {
      const manifest = await readInstallManifest(manifestPath);
      installedVersion = manifest.installedVersion;
      manifestStatus = 'present';
    } catch {
      return { installedVersion: null, manifestStatus: 'invalid', writable: await writableStatus(targetRoot) };
    }
  } else {
    try {
      const version = (await fs.readFile(path.join(targetRoot, 'VERSION'), 'utf8')).trim();
      installedVersion = parseSemVer(version, 'installed version').version;
      manifestStatus = 'legacy';
    } catch {
      installedVersion = null;
      manifestStatus = 'unknown';
    }
  }
  return { installedVersion, manifestStatus, writable: await writableStatus(targetRoot) };
}

async function writableStatus(targetRoot) {
  try {
    await fs.access(targetRoot, fs.constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function resolveKanbanProjectRoot({
  moduleRoot,
  environment = process.env,
} = {}) {
  if (typeof moduleRoot !== 'string' || moduleRoot.length === 0) {
    throw new UpgradeApiError('UPGRADE_CONFIG_INVALID', '看板 module root 設定無效。');
  }
  if (environment.KANBAN_PROJECT_ROOT && environment.KANBAN_TEST_MODE !== '1') {
    throw new UpgradeApiError(
      'UPGRADE_CONFIG_INVALID',
      'KANBAN_PROJECT_ROOT 只能用於明確的測試模式。',
    );
  }
  return path.resolve(environment.KANBAN_PROJECT_ROOT || path.join(moduleRoot, '..', '..'));
}

export function createUpgradeService({
  targetRoot,
  provider = createGitHubReleaseProvider(),
  sessionStore = createReleaseSessionStore(),
  planUpgrade = planProjectUpgrade,
  getPlanIntegrity = getPlanSnapshot,
  applyUpgrade = applyProjectUpgrade,
  verify = verifyProject,
  readLocalStatus = defaultLocalStatus,
  now = () => new Date(),
} = {}) {
  if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
    throw new UpgradeApiError('UPGRADE_CONFIG_INVALID', '版本更新 target root 設定無效。');
  }
  if (
    typeof provider?.prepareLatestRelease !== 'function'
    || typeof sessionStore?.create !== 'function'
    || typeof sessionStore?.get !== 'function'
    || typeof sessionStore?.cleanup !== 'function'
    || typeof planUpgrade !== 'function'
    || typeof getPlanIntegrity !== 'function'
    || typeof applyUpgrade !== 'function'
    || typeof verify !== 'function'
    || typeof readLocalStatus !== 'function'
    || typeof now !== 'function'
  ) {
    throw new UpgradeApiError('UPGRADE_CONFIG_INVALID', '版本更新服務依賴設定無效。');
  }

  const resolvedTarget = path.resolve(targetRoot);
  let lastCheck = null;
  let checking = false;
  let applying = false;
  let closing = false;
  let activeOperation = Promise.resolve();

  function beginOperation() {
    let finish;
    activeOperation = new Promise((resolve) => { finish = resolve; });
    return finish;
  }

  async function status() {
    const local = await readLocalStatus(resolvedTarget);
    return {
      installedVersion: local.installedVersion ?? null,
      manifestStatus: local.manifestStatus ?? 'unknown',
      provider: { repository: GITHUB_RELEASE_REPOSITORY, configured: true },
      lastCheck,
      writable: { ok: local.writable?.ok === true },
    };
  }

  async function check() {
    if (closing) {
      throw new UpgradeApiError(
        'UPGRADE_SHUTTING_DOWN',
        '版本更新服務正在關閉。',
        { status: 503, retryable: true },
      );
    }
    if (checking || applying) {
      throw new UpgradeApiError(
        'UPGRADE_BUSY',
        '另一個版本更新操作正在執行，請稍後再檢查。',
        { status: 409, retryable: true },
      );
    }
    checking = true;
    const finishOperation = beginOperation();
    let prepared;
    try {
      prepared = await provider.prepareLatestRelease();
      const plan = await planUpgrade({ sourceRoot: prepared.sourceRoot, targetRoot: resolvedTarget });
      const planDigest = createUpgradePlanDigest(plan, prepared, getPlanIntegrity(plan));
      const session = await sessionStore.create({
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
      prepared = null;
      const counts = countsFromPlan(plan);
      const current = plan.installedVersion === plan.sourceVersion && mutationCount(plan) === 0;
      const message = !plan.applicable
        ? '偵測到衝突，無法安全套用更新。'
        : current
          ? '目前已是最新版本。'
          : '版本更新已準備完成，請確認變更後再套用。';
      lastCheck = Object.freeze({
        checkedAt: now().toISOString(),
        releaseTag: session.releaseTag,
        sourceVersion: plan.sourceVersion,
        applicable: plan.applicable,
      });
      return {
        repository: session.repository,
        releaseTag: session.releaseTag,
        installedVersion: plan.installedVersion,
        sourceVersion: plan.sourceVersion,
        manifestStatus: plan.manifestStatus,
        applicable: plan.applicable,
        counts,
        entries: entriesFromPlan(plan),
        planToken: session.token,
        expiresAt: session.expiresAt,
        message,
      };
    } catch (error) {
      if (prepared?.cleanup) await prepared.cleanup().catch(() => {});
      if (error instanceof UpgradeApiError || error instanceof GitHubReleaseError) throw error;
      throw new UpgradeApiError(
        'UPGRADE_PLAN_FAILED',
        '無法建立安全的版本更新計畫。',
        { status: 409, cause: error },
      );
    } finally {
      checking = false;
      finishOperation();
    }
  }

  async function apply(input) {
    if (closing) {
      throw new UpgradeApiError(
        'UPGRADE_SHUTTING_DOWN',
        '版本更新服務正在關閉。',
        { status: 503, retryable: true },
      );
    }
    if (checking || applying) {
      throw new UpgradeApiError(
        'UPGRADE_BUSY',
        '另一個版本更新正在執行，請稍後再試。',
        { status: 409, retryable: true },
      );
    }
    applying = true;
    const finishOperation = beginOperation();
    let tokenToCleanup = input.planToken;
    try {
      const session = await sessionStore.get(input.planToken);
      if (!session) {
        tokenToCleanup = null;
        throw new UpgradeApiError(
          'UPGRADE_PLAN_EXPIRED',
          '版本更新計畫不存在或已過期，請重新檢查。',
          { status: 409, retryable: true },
        );
      }
      let plan;
      let digest;
      try {
        plan = await planUpgrade({ sourceRoot: session.sourceRoot, targetRoot: resolvedTarget });
        digest = createUpgradePlanDigest(plan, session, getPlanIntegrity(plan));
      } catch (error) {
        throw new UpgradeApiError(
          'UPGRADE_PLAN_STALE',
          '版本計畫已改變，請重新檢查。',
          { status: 409, retryable: true, cause: error },
        );
      }
      if (
        session.planDigest !== digest
        || session.version !== plan.sourceVersion
        || input.expectedInstalledVersion !== plan.installedVersion
        || input.expectedSourceVersion !== plan.sourceVersion
      ) {
        throw new UpgradeApiError(
          'UPGRADE_PLAN_STALE',
          '版本計畫已改變，請重新檢查。',
          { status: 409, retryable: true },
        );
      }
      if (!plan.applicable) {
        throw new UpgradeApiError(
          'UPGRADE_CONFLICT',
          '目前版本包含衝突，未套用任何變更。',
          { status: 409 },
        );
      }

      let result;
      try {
        result = await applyUpgrade({
          sourceRoot: session.sourceRoot,
          targetRoot: resolvedTarget,
          plan,
        });
      } catch (error) {
        throw applyFailure(error, resolvedTarget);
      }
      const backupPath = projectRelativePath(resolvedTarget, result.backupRoot);
      let verification;
      try {
        verification = verificationSummary(await verify({ targetRoot: resolvedTarget }));
      } catch {
        verification = { ok: false, checks: [] };
      }
      const applied = {
        changed: result.changed === true,
        fromVersion: plan.installedVersion,
        toVersion: plan.sourceVersion,
        changedCount: Array.isArray(result.changedPaths) ? result.changedPaths.length : 0,
        backupPath,
        verification,
        restartRequired: true,
      };
      if (!verification.ok) {
        throw new UpgradeApiError(
          'UPDATE_APPLIED_VERIFICATION_FAILED',
          '更新已套用，但驗證失敗；請先檢查結果再重啟看板。',
          { status: 500, details: { applied } },
        );
      }
      return applied;
    } finally {
      applying = false;
      if (tokenToCleanup) await sessionStore.cleanup(tokenToCleanup).catch(() => {});
      finishOperation();
    }
  }

  async function cleanup() {
    closing = true;
    await activeOperation;
    await sessionStore.cleanup().catch(() => {});
  }

  return Object.freeze({ status, check, apply, cleanup });
}

function errorPayload(error) {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable === true,
    },
    ...error.details,
  };
}

export function createUpgradeRequestHandler({ service, sendJson, logError = () => {} } = {}) {
  if (!service || typeof sendJson !== 'function') {
    throw new UpgradeApiError('UPGRADE_CONFIG_INVALID', '版本更新 HTTP handler 設定無效。');
  }
  return async function handleUpgradeRequest(req, res, pathname) {
    const routes = {
      '/api/upgrade/status': ['GET', 'status'],
      '/api/upgrade/check': ['POST', 'check'],
      '/api/upgrade/apply': ['POST', 'apply'],
    };
    const route = routes[pathname];
    if (!route) return false;
    const [method, operation] = route;
    if (req.method !== method) {
      sendJson(res, 405, errorPayload(new UpgradeApiError(
        'UPGRADE_METHOD_NOT_ALLOWED',
        '此版本更新 endpoint 不接受目前的 HTTP method。',
        { status: 405 },
      )));
      return true;
    }
    try {
      if (method === 'POST') {
        validateUpgradePostHeaders(req.headers, req.socket?.localPort);
        const body = validateUpgradeBody(operation, await readUpgradeJsonBody(req));
        sendJson(res, 200, await service[operation](body));
      } else {
        sendJson(res, 200, await service[operation]());
      }
    } catch (caught) {
      const error = normalizeUpgradeError(caught);
      if (error.status >= 500) logError(error.cause ?? caught);
      sendJson(res, error.status, errorPayload(error));
    }
    return true;
  };
}
