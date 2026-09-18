import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  compareSemVer,
  createInstallManifest,
  expandSourceInventory,
  readSourceManifest,
  sha256File,
  writeInstallManifestAtomic,
} from './manifest.mjs';
import { resolvePathWithinRoot, resolveSafeRoot } from './paths.mjs';

const INSTALL_MANIFEST_PATH = '.monstrare/manifest.json';

export class InstallError extends Error {
  constructor(message, code = 'INSTALL_FAILED') {
    super(message);
    this.name = 'InstallError';
    this.code = code;
    this.exitCode = 1;
  }
}

export function selectInstallEntries(inventory, existingPaths = new Set()) {
  return inventory.flatMap((entry) => {
    if (entry.ownership === 'managed') return [{ ...entry, action: 'copy' }];
    if (entry.ownership === 'seed-only') {
      return [{ ...entry, action: existingPaths.has(entry.path) ? 'preserve' : 'copy' }];
    }
    return [];
  });
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function copyFileAtomic(sourcePath, destinationPath) {
  const directory = path.dirname(destinationPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(destinationPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.copyFile(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    const sourceStat = await fs.stat(sourcePath);
    await fs.chmod(temporary, sourceStat.mode & 0o777);
    await fs.rename(temporary, destinationPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureProjectData(targetRoot) {
  const cardsDirectory = await resolvePathWithinRoot(targetRoot, 'tools/kanban/cards');
  await fs.mkdir(cardsDirectory, { recursive: true });

  const epicsPath = await resolvePathWithinRoot(targetRoot, 'tools/kanban/epics.json');
  if (!await pathExists(epicsPath)) {
    await fs.writeFile(epicsPath, '{\n  "epics": []\n}\n', { encoding: 'utf8', flag: 'wx' });
  }
}

function assertNodeVersionSupported(minimumNode, nodeVersion) {
  if (compareSemVer(nodeVersion, minimumNode) < 0) {
    throw new InstallError(
      `Node.js ${minimumNode} or newer is required; current version is ${nodeVersion}`,
      'NODE_VERSION_UNSUPPORTED',
    );
  }
}

export async function installProject({
  sourceRoot,
  targetRoot,
  installedAt,
  nodeVersion = process.versions.node,
  copyFile = copyFileAtomic,
} = {}) {
  const resolvedSource = await fs.realpath(sourceRoot);
  const resolvedTarget = await resolveSafeRoot(targetRoot, { sourceRoot: resolvedSource });
  const sourceManifest = await readSourceManifest(path.join(resolvedSource, 'monstrare-package.json'));
  assertNodeVersionSupported(sourceManifest.minimumNode, nodeVersion);

  const installManifestPath = await resolvePathWithinRoot(resolvedTarget, INSTALL_MANIFEST_PATH);
  if (await pathExists(installManifestPath)) {
    throw new InstallError(
      `Monstrare is already installed in ${resolvedTarget}; use status or upgrade instead`,
      'ALREADY_INSTALLED',
    );
  }

  const inventory = await expandSourceInventory(resolvedSource, sourceManifest);
  const installable = inventory.filter(({ ownership }) => ownership === 'managed' || ownership === 'seed-only');
  const existingPaths = new Set();
  for (const entry of installable) {
    const destination = await resolvePathWithinRoot(resolvedTarget, entry.path);
    if (await pathExists(destination)) existingPaths.add(entry.path);
  }
  const plan = selectInstallEntries(inventory, existingPaths);
  const installedFiles = [];

  for (const entry of plan) {
    const destination = await resolvePathWithinRoot(resolvedTarget, entry.path);
    if (entry.action === 'copy') {
      const source = await resolvePathWithinRoot(resolvedSource, entry.path, { mustExist: true });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const checkedDestination = await resolvePathWithinRoot(resolvedTarget, entry.path);
      await copyFile(source, checkedDestination, entry);
      if (await sha256File(checkedDestination) !== entry.sha256) {
        throw new InstallError(`copied file failed checksum verification: ${entry.path}`);
      }
    }
    installedFiles.push({
      path: entry.path,
      ownership: entry.ownership,
      sha256: await sha256File(await resolvePathWithinRoot(resolvedTarget, entry.path, { mustExist: true })),
    });
  }

  await ensureProjectData(resolvedTarget);
  const manifest = createInstallManifest({
    installedVersion: sourceManifest.version,
    installedAt,
    files: installedFiles,
  });
  await writeInstallManifestAtomic(installManifestPath, manifest);

  return {
    sourceVersion: sourceManifest.version,
    targetRoot: resolvedTarget,
    copied: plan.filter(({ action }) => action === 'copy').map(({ path: file }) => file),
    preserved: plan.filter(({ action }) => action === 'preserve').map(({ path: file }) => file),
    manifest,
  };
}
