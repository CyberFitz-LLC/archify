import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

// Dense bipartite links between adjacent columns: many crossings, so the passing checker's
// receipt carries thousands of warnings and is larger than Node's 1 MiB spawnSync default.
function denseGrid(cols, rows) {
  const id = (c, r) => `n${c}x${r}`;
  const components = [];
  const connections = [];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      components.push({ id: id(c, r), type: 'backend', label: `Node ${c}.${r}`, pos: [120 + c * 360, 120 + r * 200], size: [220, 90] });
    }
  }
  let k = 0;
  for (let c = 0; c + 1 < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      for (let t = 0; t < rows; t += 1) connections.push({ id: `e${k++}`, from: id(c, r), to: id(c + 1, t) });
    }
  }
  return { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Large checker receipt' }, components, connections };
}

test('deliver accepts a passing artifact whose checker receipt exceeds 1 MiB', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'archify-large-receipt-'));
  try {
    const input = path.join(dir, 'grid.json');
    const html = path.join(dir, 'grid.html');
    writeFileSync(input, JSON.stringify(denseGrid(5, 7)));

    const render = spawnSync(process.execPath, [cli, 'render', 'architecture', input, path.join(dir, 'probe.html')], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(render.status, 0, render.stderr);
    const receipt = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'check-render-output.mjs'), path.join(dir, 'probe.html')], {
      cwd: skillRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(receipt.status, 0, 'the fixture must pass the artifact checker');
    assert.ok(receipt.stdout.length > 1024 * 1024, `the fixture must exercise a receipt over 1 MiB (got ${receipt.stdout.length} bytes)`);

    const deliver = spawnSync(process.execPath, [cli, 'deliver', 'architecture', input, html, '--json'], {
      cwd: skillRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const result = JSON.parse(deliver.stdout);
    assert.equal(deliver.status, 0, JSON.stringify(result.diagnostics ?? result));
    assert.equal(result.ok, true);
    assert.ok(result.artifact.bytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
