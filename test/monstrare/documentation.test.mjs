import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const readmes = ['README.md', 'README en_us.md'];

async function exists(relativePath) {
  try {
    await fs.lstat(path.join(sourceRoot, relativePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('README local links resolve and both languages document the executable upgrade flow', async () => {
  const requiredCommands = [
    'status "$target_project"',
    'upgrade "$target_project" --dry-run',
    'upgrade "$target_project"',
    'verify "$target_project"',
  ];

  for (const readme of readmes) {
    const text = await fs.readFile(path.join(sourceRoot, readme), 'utf8');
    for (const command of requiredCommands) assert.match(text, new RegExp(command.replaceAll('$', '\\$')));
    assert.match(text, /\.monstrare\/backups/);
    assert.match(text, /git tag -a v1\.0\.0/);

    const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((target) => !/^(?:https?:|#)/.test(target))
      .map((target) => decodeURIComponent(target.split('#')[0]));
    for (const target of links) {
      assert.equal(await exists(target), true, `${readme}: ${target}`);
    }
  }
});
