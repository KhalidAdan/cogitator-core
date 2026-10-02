#!/usr/bin/env python3
"""Importer regression: parse each fixture roster (+ text export) in a real browser and
compare every matrix cell with the matching built-in list, split and combined.

Run after build.py:  python3 tests/import.test.py   (needs: pip install playwright; playwright install chromium)
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'dist' / 'kill-ledger.html').as_uri()
CASES = [  # (roster, text export, built-in list id to compare against, unit names to skip)
  ('burning-v2.ros', 'burning-v2.txt', 'builtin-burning-v2', []),
  ('cophasta.ros',   'cophasta.txt',   'builtin-cophasta',   []),
  # the hand-built v1 list shares every unit with v2 except the Rangers and Skyreavers C
  ('burning-v2.ros', 'burning-v2.txt', 'builtin', ['Rangers A','Rangers B','Corsair Skyreavers C']),
]
JS = """([xml, txt, listId, skip]) => {
  const p = IMP.parse(xml, txt);
  const id = 'test-' + Math.random().toString(36).slice(2);
  S.lists[id] = {id, meta:p.meta, groups:p.groups, armyRules:p.armyRules, rules:p.rules, base:p.units, units:JSON.parse(JSON.stringify(p.units))};
  const out = {warnings:p.warnings, cells:0, diffs:[]};
  const norm = s => s.toLowerCase().replace(/^corsair /,'').replace(/ [ab]$/,'');
  for (const combine of [false, true]){
    S.opts.combine = combine;
    applyList(id);   const imp = rows().map(u=>({nm:u.nm, m:u.models, r:S.targets.map(t=>atk(u,t).roi)}));
    applyList(listId); const ref = rows().map(u=>({nm:u.nm + (u.sub?' '+u.sub:''), base:u.nm, m:u.models, r:S.targets.map(t=>atk(u,t).roi)}));
    for (const a of imp){
      if (skip.some(s=>a.nm.includes(s))) continue;
      const b = ref.find(x=>x.nm===a.nm) || ref.find(x=>x.base===a.nm) || ref.find(x=>norm(x.base)===norm(a.nm) && x.m===a.m && !imp.some(y=>y!==a && y.nm===x.base));
      if (!b){ out.diffs.push(`${combine?'C':'S'} ${a.nm}: no match in ${listId}`); continue; }
      a.r.forEach((v,i)=>{ out.cells++; if (Math.abs(v-b.r[i])>0.05) out.diffs.push(`${combine?'C':'S'} ${a.nm} → ${S.targets[i].nm}: ${b.r[i].toFixed(1)} vs ${v.toFixed(1)}`); });
    }
  }
  delete S.lists[id];
  return out; }"""
fails = 0
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(300)
    for ros, txt, ref, skip in CASES:
        xml = (ROOT/'fixtures'/ros).read_text(encoding='utf-8'); t = (ROOT/'fixtures'/txt).read_text(encoding='utf-8')
        r = pg.evaluate(JS, [xml, t, ref, skip])
        status = 'ok  ' if not r['diffs'] else 'FAIL'
        if r['diffs']: fails += 1
        print(f"{status} {ros} vs {ref}: {r['cells']} cells, {len(r['diffs'])} differ, warnings: {r['warnings'] or 'none'}")
        for d in r['diffs'][:10]: print('     ', d)
    if errs: print('page errors:', errs); fails += 1
    b.close()
sys.exit(1 if fails else 0)
