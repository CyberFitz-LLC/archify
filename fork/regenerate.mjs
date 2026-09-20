#!/usr/bin/env node
// CyberFitz fork: rebuild every generated artifact from its sources.
//
// Generated files are never hand-merged. After any upstream merge or fork edit,
// run this and commit the result:
//   archify/assets/template.html                 <- viewer/*
//   archify/renderers/shared/generated-validators.mjs <- archify/schemas/*
//   examples/*.html, archify/examples/*.html     <- example JSON + template
//   examples/web-app.html                        <- template style/script blocks
//   examples/checkout-platform-delta.*, docs/gallery  <- compare + gallery builders
//   docs/assets/archify-live-proof.*            <- --showcase (needs Chrome + ffmpeg)
//   archify.zip                                  <- archify/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'archify');
const quiet = !process.argv.includes('--verbose');
const run = (cmd, args, cwd = skill, env = {}) => execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' });
// Upstream-owned showcase artifacts stay in the page reader so they remain
// byte-identical to upstream and never conflict in a merge.
const PAGE = { ARCHIFY_DEFAULT_LAYOUT: 'page' };

run('npm', ['run', '--silent', 'generate:viewer']);
run('npm', ['run', '--silent', 'generate:validators']);
run(process.execPath, ['scripts/render-examples.mjs', path.join(root, 'examples')]);
run(process.execPath, ['scripts/render-examples.mjs']);

// examples/web-app.html is the hand-placed fallback example. Only its
// template-owned <style>/<script> blocks track the template.
const template = fs.readFileSync(path.join(skill, 'assets/template.html'), 'utf8');
const webAppPath = path.join(root, 'examples/web-app.html');
let webApp = fs.readFileSync(webAppPath, 'utf8');
for (const tag of ['style', 'script']) {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  const owned = (block) => !block.includes('type="application/json"');
  const fresh = (template.match(re) || []).filter((b) => !b.includes('[PROJECT NAME]') && owned(b));
  let index = 0;
  webApp = webApp.replace(re, (block) => {
    if (block.includes('Sample Web App') || !owned(block)) return block;
    const next = fresh[index++];
    if (next === undefined) throw new Error(`web-app.html has more <${tag}> blocks than the template`);
    return next;
  });
  if (index !== fresh.length) throw new Error(`web-app.html <${tag}> block count differs from the template (${index} vs ${fresh.length}); re-derive it by hand`);
}
fs.writeFileSync(webAppPath, webApp);

// The checked-in architecture compare artifact embeds both rendered sides.
run(process.execPath, ['bin/archify.mjs', 'compare', 'architecture',
  'examples/checkout-platform.base.architecture.json',
  'examples/checkout-platform.head.architecture.json',
  path.join(root, 'examples/checkout-platform-delta.html'),
  '--receipt', path.join(root, 'examples/checkout-platform-delta.receipt.json'),
  '--quality', 'showcase', '--json'], skill, PAGE);
// Upstream's proof gallery under docs/ is rebuilt so its freshness test passes.
run(process.execPath, [path.join(root, 'scripts/build-gallery.mjs'), path.join(root, 'docs')], skill, PAGE);

// Upstream's README motion proof records the gallery artifact hashes, so it goes
// stale whenever the template changes. It needs Chrome and ffmpeg; without them
// the step is skipped with a warning and readme-showcase.test.mjs will fail.
if (process.argv.includes('--showcase')) {
  try {
    run(process.execPath, [path.join(root, 'scripts/build-readme-showcase.mjs')], skill, PAGE);
  } catch (error) {
    console.warn(`fork: README showcase not rebuilt (${String(error.message).split('\n')[0]})`);
  }
}

if (process.argv.includes('--zip')) run('bash', ['scripts/build-zip.sh'], root);
console.log('fork: generated artifacts are fresh');
