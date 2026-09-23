import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

function validationScript() {
  const match = workflow.match(/name: Validate tag and source version[\s\S]*?node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/);
  assert.ok(match, 'tag validator must be present');
  return match[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
}

test('release action SHA pins, privilege boundary, and exact asset scope', () => {
  assert.match(workflow, /push:\n    tags:\n      - 'v\*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /release:\n    needs: build\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write/);
  assert.match(workflow, /release:[\s\S]*?actions\/download-artifact@/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf('\n  release:')), /actions\/checkout@|npm run|npm ci/);
  const actions = [...workflow.matchAll(/uses: ([^\s#]+)/g)].map((match) => match[1]);
  assert.equal(actions.length, 4);
  for (const action of actions) {
    assert.match(action, /^actions\/(checkout|setup-node|upload-artifact|download-artifact)@[a-f0-9]{40}$/);
  }
  for (const block of workflow.split(/\n        run: \|\n/).slice(1)) {
    assert.doesNotMatch(block.split(/\n      - |\n  [a-z]+:/)[0], /\$\{\{/);
  }
  assert.match(workflow, /path: dist\/\$\{\{ steps\.package\.outputs\.asset \}\}/);
  assert.doesNotMatch(workflow, /--clobber|dist\/\*|path:.*\*/);
  assert.match(workflow, /remote_digest.*sha256:\$RELEASE_DIGEST/);
  assert.match(workflow, /sha256sum --check --status/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /\.draft == false and \.prerelease == false/);
});

test('tag validator accepts matching strict SemVer and rejects mismatch before packaging', (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monstrare-release-workflow-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/lib/manifest.mjs'), path.join(temp, 'scripts/lib/manifest.mjs'));
  fs.copyFileSync(path.join(root, 'scripts/lib/paths.mjs'), path.join(temp, 'scripts/lib/paths.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(temp, 'VERSION'), '1.2.3\n');
  fs.writeFileSync(path.join(temp, 'monstrare-package.json'), '{"version":"1.2.3"}\n');
  const output = path.join(temp, 'output');

  function run(tag, ref = `refs/tags/${tag}`) {
    fs.writeFileSync(output, '');
    return spawnSync(process.execPath, ['--input-type=module'], {
      cwd: temp,
      input: validationScript(),
      encoding: 'utf8',
      env: { ...process.env, RELEASE_REF: ref, RELEASE_TAG: tag, GITHUB_OUTPUT: output },
    });
  }

  assert.equal(run('v1.2.3').status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), 'version=1.2.3\n');
  for (const tag of ['v1.2.4', 'v01.2.3', 'v1.2.3-rc.1', 'v1.2.3;echo unsafe']) {
    assert.notEqual(run(tag).status, 0, `${tag} must fail`);
    assert.equal(fs.readFileSync(output, 'utf8'), '');
  }
  assert.notEqual(run('v1.2.3', 'refs/heads/main').status, 0);
  fs.writeFileSync(path.join(temp, 'monstrare-package.json'), '{"version":"1.2.4"}\n');
  assert.notEqual(run('v1.2.3').status, 0);
});

test('release script is idempotent and fails closed on a different or missing digest', (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monstrare-publish-workflow-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin');
  const dist = path.join(temp, 'dist');
  fs.mkdirSync(bin);
  fs.mkdirSync(dist);
  const asset = 'monstrare-v1.2.3.bundle.json';
  const bytes = Buffer.from('test release bundle\n');
  fs.writeFileSync(path.join(dist, asset), bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const log = path.join(temp, 'calls');
  const ghMock = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'api') {
  if (args[1].includes('/git/ref/tags/')) {
    process.stdout.write(JSON.stringify({object: {type: 'tag', sha: 'a'.repeat(40)}})); process.exit(0);
  }
  if (args[1].includes('/git/tags/')) {
    process.stdout.write(JSON.stringify({object: {type: 'commit', sha: process.env.SCENARIO === 'moved' ? 'b'.repeat(40) : process.env.RELEASE_COMMIT}})); process.exit(0);
  }
  if (process.env.SCENARIO === 'new' && !fs.existsSync(process.env.CALLS)) {
    process.stderr.write('HTTP 404 Not Found\\n'); process.exit(1);
  }
  const existing = process.env.SCENARIO !== 'absent' || fs.existsSync(process.env.CALLS);
  const digest = process.env.SCENARIO === 'different' ? 'sha256:' + '0'.repeat(64)
    : process.env.SCENARIO === 'no-digest' ? null : 'sha256:' + process.env.RELEASE_DIGEST;
  process.stdout.write(JSON.stringify({ tag_name: process.env.RELEASE_TAG, draft: false,
    prerelease: false, assets: existing ? [{name: process.env.RELEASE_ASSET, digest}] : [] }));
} else {
  fs.appendFileSync(process.env.CALLS, args.slice(0, 2).join(' ') + '\\n');
}
`;
  fs.writeFileSync(path.join(bin, 'gh'), ghMock, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sha256sum'), `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const line = fs.readFileSync(0, 'utf8').trim();
const [expected, file] = line.split(/  /);
const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.exit(actual === expected ? 0 : 1);
`, { mode: 0o755 });
  const marker = workflow.indexOf('name: Publish or verify the current tag');
  assert.ok(marker > 0);
  const script = workflow.slice(marker).match(/run: \|\n([\s\S]*)$/)[1]
    .split('\n').map((line) => line.replace(/^          /, '')).join('\n');

  function run(scenario) {
    fs.rmSync(log, { force: true });
    return spawnSync('bash', ['-e'], {
      cwd: temp,
      input: script,
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log, SCENARIO: scenario,
        RUNNER_TEMP: temp, GITHUB_REPOSITORY: 'ttrrdfx/Monstrare',
        RELEASE_COMMIT: 'a'.repeat(40),
        RELEASE_TAG: 'v1.2.3', RELEASE_VERSION: '1.2.3', RELEASE_ASSET: asset,
        RELEASE_DIGEST: digest,
      },
    });
  }

  assert.equal(run('same').status, 0);
  assert.equal(fs.existsSync(log), false, 'same digest must not upload');
  assert.equal(run('moved').status, 1);
  assert.equal(fs.existsSync(log), false, 'moved remote tag must not publish');
  assert.equal(run('different').status, 1);
  assert.equal(fs.existsSync(log), false, 'different digest must not clobber');
  assert.equal(run('no-digest').status, 1);
  assert.equal(fs.existsSync(log), false, 'missing digest must not upload');
  assert.equal(run('absent').status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /^release upload\n/);
  assert.equal(run('new').status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /^release create\n/);
});
