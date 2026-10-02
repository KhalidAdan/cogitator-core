// Engine calibration: with "bare datasheets" settings, these rows must reproduce the
// Culling Cogitator's published numbers (rounded) for all 19 benchmark targets.
// Run: node tests/calibration.test.js
const D = require('../src/data.js');
global.RULES = D.RULES;
const E = require('../src/engine.js');

const off = {};
D.DEFAULT_UNITS.forEach(u => D.COGITATOR_RULES_OFF.forEach(r => off[u.id + ':' + r] = true));
const bare = Object.assign({}, D.COGITATOR_OPTS, { off, mods: {} });
const U = id => D.DEFAULT_UNITS.find(u => u.id === id);

const EXPECT = {
  yriel:            [44,88,56,48,81,84,81,90,55,68,47,61,66,83,49,89,78,38,75],
  fuegan:           [34,67,48,32,65,70,52,48,29,54,37,40,44,42,22,48,34,17,44],
  kharseth:         [34,57,34,41,31,27,23,32,5,6,5,9,7,9,8,8,10,7,7],
  'shroud-runners': [68,105,73,58,38,27,15,21,23,23,17,35,20,19,19,14,21,18,13],
};
let fails = 0;
for (const [id, want] of Object.entries(EXPECT)){
  const u = Object.assign({}, U(id));
  if (id === 'yriel') u.pts = 95; // Cogitator scored Yriel without Archraider
  const got = D.DEFAULT_TARGETS.map(t => Math.round(E.attackUnit(u, t, bare, D.DEFAULT_UNITS).roi));
  const bad = got.map((g,i)=>g!==want[i] ? `${D.DEFAULT_TARGETS[i].nm}: got ${g}, want ${want[i]}` : null).filter(Boolean);
  if (bad.length){ fails++; console.log(`FAIL ${id}\n  ` + bad.join('\n  ')); } else console.log(`ok   ${id}`);
}
const ws = E.attackUnit(Object.assign({}, U('yriel'), {pts:95}), D.DEFAULT_TARGETS.find(t=>t.id==='warp-spiders'), bare, D.DEFAULT_UNITS);
const ok88 = ws.total.toFixed(2)==='3.98' && ws.roi.toFixed(1)==='88.0';
console.log(`${ok88?'ok  ':'FAIL'} Yriel @95 into Warp Spiders: Σ ${ws.total.toFixed(2)} → ${ws.roi.toFixed(1)}% (want 3.98 → 88.0%)`);
if (!ok88) fails++;
process.exit(fails ? 1 : 0);
