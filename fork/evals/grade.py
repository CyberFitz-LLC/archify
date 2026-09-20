#!/usr/bin/env python3
"""Programmatic grader for the archify fork evals.
usage: grade.py <run_dir> <eval_name> <skill_dir>
Writes <run_dir>/grading.json with expectations[{text, passed, evidence}]."""
import json, os, re, subprocess, sys, html, shutil, tempfile
run_dir, eval_name, skill_dir = os.path.abspath(sys.argv[1]), sys.argv[2], os.path.abspath(sys.argv[3])
ws = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = next(e for e in json.load(open(os.path.join(ws, 'evals-full.json'))) if e['name'] == eval_name)
out = os.path.join(run_dir, 'outputs')
htmls = [f for f in os.listdir(out) if f.endswith('.html') and '.visual-check' not in f]
jsons = [f for f in os.listdir(out) if f.endswith('.json') and '.visual-check' not in f and 'receipt' not in f]
TYPE = {'commerce-platform-architecture': 'architecture', 'purchase-to-pay-workflow': 'workflow', 'bi-lineage-dataflow': 'dataflow'}[eval_name]
MIN_NODES = {'commerce-platform-architecture': 38, 'purchase-to-pay-workflow': 20, 'bi-lineage-dataflow': 30}[eval_name]
exp = []
def add(text, passed, evidence): exp.append({'text': text, 'passed': bool(passed), 'evidence': evidence})

add('Exactly one diagram HTML was delivered (the subject was not split across several diagrams)', len(htmls) == 1, f'html files: {htmls}')
page = open(os.path.join(out, htmls[0]), encoding='utf8').read() if htmls else ''
svg = re.search(r'<svg viewBox[\s\S]*?</svg>', page)
svg = svg.group(0) if svg else ''
tag = re.search(r'<html\b[^>]*>', page)
add('The diagram opens on the infinite canvas reader', bool(tag and 'data-layout="canvas"' in tag.group(0)), tag.group(0) if tag else 'no <html> tag')

nodes = set(re.findall(r'data-node-id="([^"]+)"', svg))
add(f'At least {MIN_NODES} nodes are drawn (one per named element, nothing merged away)', len(nodes) >= MIN_NODES, f'{len(nodes)} distinct nodes in the SVG')

text = html.unescape(re.sub(r'<[^>]+>', ' ', svg)).lower()
missing = [e for e in spec['entities'] if not any(alt.lower() in text for alt in e.split('|'))]
add(f'Every one of the {len(spec["entities"])} elements named in the request appears in the drawing itself (not only in a side card)', not missing, 'all present' if not missing else f'missing from the SVG: {missing}')

edges = set(re.findall(r'data-edge-from="([^"]+)"[^>]*data-edge-to="([^"]+)"', svg))
if eval_name == 'commerce-platform-architecture':
    hub = lambda name: sum(1 for a, b in edges if name in a.lower() or name in b.lower())
    v, d = hub('vault'), hub('datadog')
    add('The "all services pull secrets from Vault and ship telemetry to Datadog" relationships are drawn as lines, not replaced by a note', v >= 10 and d >= 10, f'{v} Vault relationships, {d} Datadog relationships, {len(edges)} relationships in total')
elif eval_name == 'purchase-to-pay-workflow':
    headers = re.findall(r'>\s*([0-9A-Za-z]{2}) / ([^<]+?)\s*<', svg)
    labels = [name.strip().lower() for _, name in headers]
    ok = bool(labels) and labels[-1].startswith('exception') and len(labels) == 7
    add('Lanes are in the order the user gave, with Exceptions last', ok, f'lane order found: {labels}')
else:
    stages = len(set(re.findall(r'data-composition-frame-id="(\d+)"', svg))) or len(re.findall(r'data-composition-frame-kind="stage"', svg))
    add('The eight named layers (sources, ingestion, landing, staging, conformance, warehouse, semantic, consumption) are not collapsed into five stages', stages >= 8, f'{stages} stage columns drawn')

cli = os.path.join(skill_dir, 'bin', 'archify.mjs')
env = dict(os.environ, ARCHIFY_CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', ARCHIFY_CHROME_NO_SANDBOX='1')
env.pop('ARCHIFY_DEFAULT_LAYOUT', None)
if jsons:
    r = subprocess.run(['node', cli, 'validate', TYPE, os.path.join(out, jsons[0]), '--quality', 'showcase', '--json'], capture_output=True, text=True, cwd=skill_dir, env=env)
    try:
        rec = json.loads(r.stdout); comp = (rec.get('composition') or {}).get('summary')
        ev = f'exit {r.returncode}; composition {comp}; ' + '; '.join(sorted({d.get("code", "") for d in rec.get("diagnostics") or []}))[:300]
    except Exception: ev = f'exit {r.returncode}: {r.stdout[:200]}'
    add('The authored specification passes the skill\'s own showcase-quality validation', r.returncode == 0, ev)
else:
    add('The authored specification passes the skill\'s own showcase-quality validation', False, 'no JSON specification saved')
if htmls:
    tmp = tempfile.mkdtemp(); copy = os.path.join(tmp, htmls[0]); shutil.copy(os.path.join(out, htmls[0]), copy)
    r = subprocess.run(['node', cli, 'visual-check', copy, '--json'], capture_output=True, text=True, cwd=skill_dir, env=env)
    try:
        rec = json.loads(r.stdout); ev = f'exit {r.returncode}; status {rec.get("status")}; ' + '; '.join(sorted({d.get("code", "") for d in rec.get("diagnostics") or []}))
    except Exception: ev = f'exit {r.returncode}: {r.stdout[:200]}'
    add('The delivered HTML passes the skill\'s own real-browser visual check', r.returncode == 0, ev)
    shutil.rmtree(tmp, ignore_errors=True)

passed = sum(1 for e in exp if e['passed'])
grading = {'expectations': exp, 'summary': {'passed': passed, 'failed': len(exp) - passed, 'total': len(exp), 'pass_rate': round(passed / len(exp), 4)}}
timing = os.path.join(run_dir, 'timing.json')
if os.path.exists(timing):
    t = json.load(open(timing)); grading['timing'] = {'total_duration_seconds': t.get('total_duration_seconds', 0)}
json.dump(grading, open(os.path.join(run_dir, 'grading.json'), 'w'), indent=2)
print(eval_name, os.path.basename(os.path.dirname(run_dir)), f'{passed}/{len(exp)}')
for e in exp: print('  ', 'PASS' if e['passed'] else 'FAIL', '-', e['text'][:90], '|', e['evidence'][:140])
