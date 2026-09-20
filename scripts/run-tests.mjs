#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'archify');
const testRoot = path.join(skillRoot, 'test');
const testFiles = fs.readdirSync(testRoot)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .sort()
  .map((entry) => path.join('test', entry));

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsConcurrencyFlag = major > 18 || (major === 18 && minor >= 19);
const args = ['--test'];
if (supportsConcurrencyFlag) args.push('--test-concurrency=2');
args.push(...testFiles);

// CyberFitz fork: the inherited upstream suite asserts the page reader, so it
// runs with the page default. Fork canvas tests author meta.layout_mode
// explicitly, and the goldens (run before this script) use the fork default.
const result = spawnSync(process.execPath, args, {
  cwd: skillRoot,
  stdio: 'inherit',
  env: { ARCHIFY_DEFAULT_LAYOUT: 'page', ...process.env },
});

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`test runner terminated by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
