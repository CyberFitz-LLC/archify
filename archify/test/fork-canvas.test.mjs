// CyberFitz fork contract. These tests pin what the fork changes about upstream
// Archify, so an upstream merge that quietly reverts any of it fails loudly:
//   1. the infinite canvas is the default reader, and page is an explicit opt-in;
//   2. diagram size is not a defect on the canvas;
//   3. typed layouts are not capped at upstream's small grids;
//   4. the skill's authoring guidance does not ask authors to shrink the subject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { FORK_DEFAULT_LAYOUT, layoutHtmlAttr, resolveLayoutMode } from '../renderers/shared/fork-layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fork-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// The inherited suite runs with ARCHIFY_DEFAULT_LAYOUT=page. Fork tests must
// observe the real default, so they always strip it.
const forkEnv = (() => {
  const env = { ...process.env };
  delete env.ARCHIFY_DEFAULT_LAYOUT;
  delete env.ARCHIFY_QUALITY_PROFILE;
  return env;
})();

function write(name, diagram) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(diagram, null, 2));
  return file;
}
function archify(args, env = forkEnv) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, env, encoding: 'utf8' });
}
function validate(type, file) {
  const result = archify(['validate', type, file, '--quality', 'showcase', '--json']);
  const receipt = JSON.parse(result.stdout || '{}');
  return { status: result.status, receipt };
}
function htmlTag(file) {
  return fs.readFileSync(file, 'utf8').match(/<html\b[^>]*>/)[0];
}
function example(name) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name), 'utf8'));
}

const COMPONENT_TYPES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];

function largeArchitecture() {
  const domains = ['identity', 'catalog', 'orders', 'payments', 'fulfilment', 'analytics'];
  const components = [];
  const connections = [];
  const boundaries = [];
  domains.forEach((domain, row) => {
    const ids = [];
    for (let col = 0; col < 7; col += 1) {
      const id = `${domain}_${col}`;
      ids.push(id);
      components.push({
        id,
        type: COMPONENT_TYPES[col],
        label: `${domain} svc ${col + 1}`,
        sublabel: `${domain}-${col + 1}.internal`,
        pos: [120 + col * 230, 140 + row * 240],
        size: [150, 64],
      });
      if (col) connections.push({ from: ids[col - 1], to: id, label: col % 2 ? 'gRPC' : 'event' });
    }
    boundaries.push({ kind: 'region', label: `${domain} domain`, wraps: ids, pad: 24 });
  });
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Forty-two services on one plane', quality_profile: 'showcase', viewBox: [1900, 1700] },
    components,
    boundaries,
    connections,
  };
}

test('layout resolution: authored value, then environment, then the canvas default', () => {
  assert.equal(FORK_DEFAULT_LAYOUT, 'canvas');
  assert.equal(resolveLayoutMode({}, {}), 'canvas');
  assert.equal(resolveLayoutMode(undefined, {}), 'canvas');
  assert.equal(resolveLayoutMode({ layout_mode: 'page' }, {}), 'page');
  assert.equal(resolveLayoutMode({}, { ARCHIFY_DEFAULT_LAYOUT: 'page' }), 'page');
  assert.equal(resolveLayoutMode({ layout_mode: 'canvas' }, { ARCHIFY_DEFAULT_LAYOUT: 'page' }), 'canvas');
  assert.equal(resolveLayoutMode({}, { ARCHIFY_DEFAULT_LAYOUT: 'nonsense' }), 'canvas');
  assert.equal(layoutHtmlAttr('canvas'), ' data-layout="canvas"');
  assert.equal(layoutHtmlAttr('page'), '', 'the page reader keeps the upstream <html> tag byte for byte');
});

test('an ordinary diagram renders on the infinite canvas unless page is authored', () => {
  const source = example('web-app.architecture.json');
  delete source.meta.output;
  const canvasOut = path.join(tmp, 'default.html');
  assert.equal(archify(['render', 'architecture', write('default.json', source), canvasOut]).status, 0);
  assert.match(htmlTag(canvasOut), / data-layout="canvas">$/);

  source.meta.layout_mode = 'page';
  const pageOut = path.join(tmp, 'page.html');
  assert.equal(archify(['render', 'architecture', write('page.json', source), pageOut]).status, 0);
  assert.doesNotMatch(htmlTag(pageOut), /data-layout/);

  source.meta.layout_mode = 'poster';
  const rejected = archify(['validate', 'architecture', write('bad-layout.json', source), '--json']);
  assert.notEqual(rejected.status, 0, 'layout_mode is a closed enum');
});

test('a 42-node architecture on a 1900px plane passes showcase on the canvas', () => {
  const file = write('large.architecture.json', largeArchitecture());
  const { status, receipt } = validate('architecture', file);
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics, null, 2));
  assert.equal(receipt.ok, true);
});

test('the same plane still trips the projected-text gate in the page reader', () => {
  const diagram = largeArchitecture();
  diagram.meta.layout_mode = 'page';
  const { status, receipt } = validate('architecture', write('large-page.architecture.json', diagram));
  assert.notEqual(status, 0);
  assert.ok(receipt.diagnostics.some((item) => item.code === 'composition/desktop-readability'),
    'page mode keeps the upstream gate, so opting into page is an honest trade');
});

test('a clean perpendicular crossing warns on the canvas and fails on the page', () => {
  // Real systems are rarely planar. Upstream's zero-crossing showcase rule can
  // then only be met by deleting a true relationship; the canvas counts the
  // crossing as a warning instead and keeps the relationship.
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Two flows that must cross', quality_profile: 'showcase', viewBox: [1000, 760] },
    components: [
      { id: 'west', type: 'frontend', label: 'West', pos: [80, 348], size: [150, 64] },
      { id: 'east', type: 'backend', label: 'East', pos: [770, 348], size: [150, 64] },
      { id: 'north', type: 'security', label: 'North', pos: [425, 60], size: [150, 64] },
      { id: 'south', type: 'database', label: 'South', pos: [425, 636], size: [150, 64] },
    ],
    connections: [
      { from: 'west', to: 'east', fromSide: 'right', toSide: 'left' },
      { from: 'north', to: 'south', fromSide: 'bottom', toSide: 'top' },
    ],
  };
  const canvas = validate('architecture', write('cross-canvas.json', diagram));
  assert.equal(canvas.status, 0, JSON.stringify(canvas.receipt.diagnostics, null, 2));
  assert.equal(canvas.receipt.composition.summary.errors, 0);
  assert.equal(canvas.receipt.composition.metrics.properCrossings, 1);
  assert.equal(canvas.receipt.composition.summary.warnings, 1, 'the crossing is still counted and reported');

  diagram.meta.layout_mode = 'page';
  const page = validate('architecture', write('cross-page.json', diagram));
  assert.notEqual(page.status, 0, 'the page reader keeps the upstream zero-crossing rule');
  assert.ok(page.receipt.diagnostics.some((item) => item.code === 'composition/proper-crossing'));
});

test('readable-v2 workflows run past six columns', () => {
  const lanes = ['intake', 'review', 'build', 'ops'].map((id) => ({ id, label: id }));
  const nodes = [];
  const edges = [];
  for (let col = 0; col < 14; col += 1) {
    nodes.push({ id: `s${col}`, lane: lanes[col % 4].id, col, type: COMPONENT_TYPES[col % 7], label: `Step ${col + 1}`, sublabel: `stage ${col + 1}` });
    if (col) edges.push({ from: `s${col - 1}`, to: `s${col}`, label: 'next' });
  }
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Fourteen-step process', quality_profile: 'showcase' },
    lanes,
    mainPath: nodes.map((node) => node.id),
    nodes,
    edges,
  };
  const { status, receipt } = validate('workflow', write('wide.workflow.json', workflow));
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics, null, 2));
});

test('dataflow accepts more than five stages and five rows on a larger plane', () => {
  const nodes = [];
  const flows = [];
  for (let stage = 0; stage < 8; stage += 1) {
    for (let row = 0; row < 7; row += 1) {
      if ((stage + row) % 2) continue;
      nodes.push({ id: `n${stage}_${row}`, type: COMPONENT_TYPES[(stage + row) % 7], label: `Node ${stage + 1}.${row + 1}`, sublabel: 'dataset', stage, row });
    }
  }
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const next = `n${node.stage + 1}_${node.row + 1}`;
    if (ids.has(next)) flows.push({ from: node.id, to: next, label: 'cdc' });
  }
  const dataflow = {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Eight-stage lineage', quality_profile: 'showcase', viewBox: [1760, 960] },
    stages: Array.from({ length: 8 }, (_, index) => ({ label: `Stage ${index + 1}` })),
    nodes,
    flows,
  };
  const { status, receipt } = validate('dataflow', write('large.dataflow.json', dataflow));
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics, null, 2));
});

test('lifecycle gains a phase column for every 154px of plane beyond upstream', () => {
  const lifecycle = example('agent-run.lifecycle.json');
  delete lifecycle.meta.views;
  delete lifecycle.meta.output;
  const main = lifecycle.states.filter((state) => state.lane === 'main');
  const last = main.reduce((a, b) => (a.col > b.col ? a : b));
  lifecycle.meta.viewBox = [lifecycle.meta.viewBox[0] + 154 * 4, lifecycle.meta.viewBox[1]];
  let previous = last.id;
  for (let index = 0; index < 4; index += 1) {
    const id = `extra${index}`;
    lifecycle.states.push({ id, type: 'active', label: `Phase ${last.col + 2 + index}`, sublabel: 'added phase', lane: 'main', col: last.col + 1 + index });
    lifecycle.transitions.push({ from: previous, to: id });
    previous = id;
  }
  const { status, receipt } = validate('lifecycle', write('long.lifecycle.json', lifecycle));
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics, null, 2));

  // At upstream width the fifth column is still the last one.
  const narrow = example('agent-run.lifecycle.json');
  narrow.states.push({ id: 'overflow', type: 'active', label: 'Overflow', lane: 'main', col: last.col + 1 });
  assert.notEqual(validate('lifecycle', write('narrow.lifecycle.json', narrow)).status, 0);
});

test('upstream-sized inputs render byte-identical SVG geometry in both readers', () => {
  // The cap lifts must be pure extensions: default-sized diagrams do not move.
  for (const [type, name] of [
    ['workflow', 'agent-tool-call.workflow.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ]) {
    const source = example(name);
    delete source.meta.output;
    const outputs = ['canvas', 'page'].map((mode) => {
      source.meta.layout_mode = mode;
      const out = path.join(tmp, `${type}-${mode}.html`);
      assert.equal(archify(['render', type, write(`${type}-${mode}.json`, source), out]).status, 0, `${type} ${mode}`);
      return fs.readFileSync(out, 'utf8').match(/<svg viewBox[\s\S]*?<\/svg>/)[0];
    });
    assert.equal(outputs[0], outputs[1], `${type}: the reader never changes authored geometry`);
  }
});

test('skill guidance sizes the diagram to the subject, not to a screen', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const authoring = fs.readFileSync(path.join(skillRoot, 'references/authoring-contract.md'), 'utf8');
  assert.match(skill, /infinite canvas/i);
  assert.match(skill, /`meta\.layout_mode`/);
  assert.match(skill, /references\/page-reader\.md/);
  for (const [name, source] of [['SKILL.md', skill], ['authoring-contract.md', authoring]]) {
    assert.doesNotMatch(source, /at most 12 primary nodes/i, name);
    assert.doesNotMatch(source, /Prefer 6[–-]12 primary components/i, name);
    assert.doesNotMatch(source, /sparse labels/i, name);
    assert.doesNotMatch(source, /Remove low-value edges/i, name);
    assert.doesNotMatch(source, /first-screen artifact by default/i, name);
  }
});

test('canvas camera: free pan, cursor-anchored zoom, real-pixel percent, no page scroll', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const out = path.join(tmp, 'camera.html');
  execFileSync(process.execPath, [cli, 'render', 'architecture', write('camera.json', largeArchitecture()), out], { cwd: skillRoot, env: forkEnv });
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(out).href }, session);
    await loaded;
    const run = async (expression) => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    // CDP resolves mouseWheel before the page has handled it, so count handled
    // wheel events in the page and wait for the count to move.
    await run('window.__forkWheels = 0; document.addEventListener("wheel", function () { window.__forkWheels += 1; }); true');
    const wheel = async (x, y, deltaX, deltaY, modifiers = 0) => {
      const seen = await run('window.__forkWheels');
      await browser.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers }, session);
      await run(`new Promise(function (resolve, reject) {
        var started = Date.now();
        (function poll() {
          if (window.__forkWheels > ${seen}) return requestAnimationFrame(function () { resolve(true); });
          if (Date.now() - started > 3000) return reject(new Error('wheel event was not delivered'));
          setTimeout(poll, 5);
        })();
      })`);
    };
    const state = () => run('(function(){var s=Archify.view.state();return {scale:s.scale,x:s.x,y:s.y,fit:Archify.view.fitScale(),pct:document.querySelector("[data-view-percent]").textContent,level:document.querySelector(".diagram-container").getAttribute("data-detail-level"),sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight};})()');

    const start = await state();
    assert.equal(start.scale, 1);
    assert.ok(start.fit < 0.6, 'a 1900px plane fits well below real size');
    assert.equal(start.level, 'map', 'overview drops to primary labels by real-pixel scale');
    assert.ok(start.sw <= start.iw && start.sh <= start.ih, 'the canvas never scrolls the page: ' + JSON.stringify(start));

    await wheel(700, 450, 150, 90);
    const panned = await state();
    assert.equal(panned.x, -150);
    assert.equal(panned.y, -90);

    // Zoom in about a fixed cursor: the plane point under it must not move.
    const anchor = '(function(){var s=Archify.view.state();var c=document.querySelector(".diagram-container");var cs=getComputedStyle(c);var px=700-parseFloat(cs.paddingLeft),py=450-parseFloat(cs.paddingTop);return [(px-s.x)/s.scale,(py-s.y)/s.scale];})()';
    const before = await run(anchor);
    for (let index = 0; index < 8; index += 1) await wheel(700, 450, 0, -100, 2);
    const after = await run(anchor);
    const zoomed = await state();
    assert.ok(zoomed.scale > 3, `upstream stopped at 3x of fit; got ${zoomed.scale}`);
    assert.ok(Math.abs(before[0] - after[0]) < 0.5 && Math.abs(before[1] - after[1]) < 0.5, 'zoom is anchored at the cursor');
    assert.equal(zoomed.level, 'full');

    for (let index = 0; index < 40; index += 1) await wheel(700, 450, 0, 100, 2);
    const far = await state();
    assert.ok(far.scale < 1 && far.scale >= 0.2 - 1e-9, 'zooms out past fit, to a floor');

    await run('Archify.view.actualSize()');
    assert.equal((await state()).pct, '100%', 'the percent label reports real pixels');
    await run('Archify.view.reset()');
    const fit = await state();
    assert.deepEqual([fit.scale, fit.x, fit.y], [1, 0, 0]);
  } finally {
    await browser.close();
  }
});
