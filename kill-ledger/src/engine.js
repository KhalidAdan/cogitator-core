// ===== Engine v2 =====
function avgDice(x){
  if (typeof x === 'number') return x;
  const m = String(x).trim().toUpperCase().match(/^(\d*)D(\d+)(?:\+(\d+))?$/);
  if (m){ const k = m[1] ? +m[1] : 1, f = +m[2], add = m[3] ? +m[3] : 0; return k*(f+1)/2 + add; }
  const n = parseFloat(x); return isNaN(n) ? 0 : n;
}
function diceDist(x){
  if (typeof x === 'number') return [[x,1]];
  const m = String(x).trim().toUpperCase().match(/^(\d*)D(\d+)(?:\+(\d+))?$/);
  if (!m){ const n = parseFloat(x); return [[isNaN(n)?0:n,1]]; }
  const k = m[1] ? +m[1] : 1, f = +m[2], add = m[3] ? +m[3] : 0;
  let dist = new Map([[0,1]]);
  for (let i=0;i<k;i++){ const nd = new Map(); for (const [v,p] of dist) for (let r=1;r<=f;r++) nd.set(v+r,(nd.get(v+r)||0)+p/f); dist = nd; }
  return [...dist].map(([v,p])=>[v+add,p]);
}
function woundNeed(S,T){ if (S>=2*T) return 2; if (S>T) return 3; if (S===T) return 4; if (2*S<=T) return 6; return 5; }
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const ruleKey = (owner,id)=>owner+':'+id;

// ----- modifier bar -----
const MOD0 = {apply:'both', hit:0, wound:0, ap:0, sus:false, lethal:false, rrHit:'off', rrWound:'off', cover:false, half:false, rf:0};
const RR_RANK = {off:0, '1s':1, full:2};
function modIsSet(m){ return !!m && Object.keys(MOD0).some(k=>k!=='apply' && m[k]!==undefined && m[k]!==MOD0[k]); }
function modScopes(unit, w){
  const s = ['all', unit.id];
  if (!unit.combined && unit.grp) s.push('grp-'+unit.grp);
  if (unit.combined && w && w._owner) s.push(w._owner);
  return [...new Set(s)];
}
function modsFor(unit, w, opts){
  const mods = opts.mods || {};
  const out = {hit:0, wound:0, ap:0, sus:false, lethal:false, rrHit:'off', rrWound:'off', cover:false, half:false, rf:0};
  for (const sc of modScopes(unit, w)){
    const m = mods[sc]; if (!modIsSet(m)) continue;
    if (m.cover) out.cover = true;
    if (m.half) out.half = true;
    const ok = !m.apply || m.apply==='both' || (m.apply==='ranged') === (w.t==='r');
    if (!ok) continue;
    out.hit += m.hit||0; out.wound += m.wound||0; out.ap += m.ap||0;
    if ((m.rf||0) > out.rf) out.rf = m.rf;
    if (m.sus) out.sus = true; if (m.lethal) out.lethal = true;
    if (RR_RANK[m.rrHit||'off'] > RR_RANK[out.rrHit]) out.rrHit = m.rrHit;
    if (RR_RANK[m.rrWound||'off'] > RR_RANK[out.rrWound]) out.rrWound = m.rrWound;
  }
  return out;
}

// Rules that change damage and apply to this attacker (own + attached-unit propagation)
function effectiveRules(unit, allUnits){
  const out = [];
  const add = (owner, id) => { const r = RULES[id]; if (r && r.dmg && !out.some(x=>x.id===id && x.owner===owner)) out.push({id, owner, r}); };
  if (unit.combined){
    for (const mid of unit.members){ const m = allUnits.find(x=>x.id===mid); if (m) m.rules.forEach(id=>add(m.id,id)); }
  } else {
    (unit.rules||[]).forEach(id=>add(unit.id,id));
    if (unit.grp) for (const m of allUnits) if (m.grp===unit.grp && m.id!==unit.id) (m.rules||[]).forEach(id=>{ if (RULES[id] && RULES[id].scope==='unit') add(m.id,id); });
  }
  return out;
}
function ruleActive(er, opts){
  if (er.r.mark) return !!opts[er.r.mark];
  return !(opts.off && opts.off[ruleKey(er.owner, er.id)]);
}

function unitPts(unit, opts){ const e = unit.enh ? unit.enh.pts : 0; return opts.enh ? unit.pts : unit.pts - e; }

// rules the engine handles by name (calibrated before the generic effect system existed)
const LEGACY_FX = new Set(['piratical-hero','psyguide','raiders','spirit-marked','reavers','assured','faolchu','assassins-eye']);
// does a target match a keyword condition like {only:['MONSTER','VEHICLE']} or {not:[...]}?
function kwCond(c, tKw){
  if (!c) return true;
  const has = k => tKw.split(/[\s,]+/).includes(k) || tKw.includes(k);
  if (c.only && !c.only.some(has)) return false;
  if (c.not && c.not.some(has)) return false;
  return true;
}
function targetKw(tgt, opts){ let k = String(tgt.kw||'').toUpperCase(); if (opts.char && !/CHARACTER/.test(k)) k += ' CHARACTER'; return k; }

function attackUnit(unit, tgt, opts, allUnits, phase){
  phase = phase || opts.phase;
  allUnits = allUnits || [];
  const er = effectiveRules(unit, allUnits).filter(x=>ruleActive(x, opts));
  // target marks with a generic effect apply to every attacker in the list
  const marks = [];
  for (const [id, r] of Object.entries(RULES)) if (r.mark && r.global && r.fx && opts[r.mark]) marks.push({id, owner:'mark', r});
  let rows = [];
  for (const w of unit.w){
    if (phase==='ranged' && w.t!=='r') continue;
    if (phase==='melee' && w.t!=='m') continue;
    if (w.off){ rows.push({w, skipped:w.off}); continue; }
    // in a combined unit, a rule that isn't shared only covers its own datasheet's weapons
    const mine = er.filter(x=>!unit.combined || x.r.scope==='unit' || !w._owner || w._owner===x.owner).concat(marks);
    const has = id => mine.find(x=>x.id===id);
    rows.push(Object.assign({w}, attackWeapon(w, tgt, opts, has, modsFor(unit, w, opts), mine)));
  }
  // one profile per multi-profile weapon, one melee weapon per model
  const alts = {};
  rows.forEach(r=>{ if (r.w.alt && !r.skipped){ (alts[r.w.alt] = alts[r.w.alt]||[]).push(r); } });
  for (const k in alts){
    const g = alts[k]; const best = g.reduce((a,b)=>b.dealt>a.dealt?b:a);
    g.forEach(r=>{ if (r!==best){ r.skipped = /(^|:)m\d*:/.test(r.w.alt) ? 'This model fights with a better weapon here' : 'The other profile does more damage here'; r.dealt = 0; } });
  }
  let total = rows.reduce((s,r)=>s+(r.skipped?0:(r.dealt||0)),0);
  const pool = tgt.W*tgt.N;
  const capped = opts.cap && total > pool;
  if (opts.cap) total = Math.min(total, pool);
  const pts = unitPts(unit, opts);
  const ppw = tgt.pts/pool;
  return {rows, total, pts, ppw, roi: pts>0 ? total/pts*ppw*100 : 0, pool, capped, rules: er};
}

function attackWeapon(w, tgt, opts, has, md, ruleList){
  const notes = [];
  md = md || {hit:0, wound:0, ap:0, sus:false, lethal:false, rrHit:'off', rrWound:'off', cover:false, half:false, rf:0};
  const ranged = w.t==='r';
  const tKw = targetKw(tgt, opts);
  const vehMon = /VEHICLE|MONSTER/.test(tKw);
  // weapon abilities, minus any whose keyword condition the target doesn't meet
  const kw = Object.assign({}, w.kw || {});
  if (kw.when) for (const k of Object.keys(kw.when)) if (!kwCond(kw.when[k], tKw)) delete kw[k];

  const mn = [];
  if (md.hit) mn.push(`${md.hit>0?'+':'−'}${Math.abs(md.hit)} hit`);
  if (md.wound) mn.push(`${md.wound>0?'+':'−'}${Math.abs(md.wound)} wound`);
  if (md.ap) mn.push(`${md.ap>0?'+':'−'}${Math.abs(md.ap)} AP`);
  if (md.sus) mn.push('Sustained 1'); if (md.lethal) mn.push('Lethal');
  if (md.rrHit!=='off') mn.push(`re-roll hits ${md.rrHit==='1s'?'of 1':'(full)'}`);
  if (md.rrWound!=='off') mn.push(`re-roll wounds ${md.rrWound==='1s'?'of 1':'(full)'}`);
  if (md.rf && ranged && md.rf > (kw.rf||0) && !md.half) mn.push(`Rapid Fire ${md.rf} (idle: not within half range)`);
  if (mn.length) notes.push('Modifier: '+mn.join(', '));

  // generic rule effects (fx) from the rules library
  const fx = {hit:0, wound:0, s:0, ap:0, a:0, d:0, rrHit:null, rrWound:null};
  const RR = {null:0, ones:1, all:2};
  const bare = String(w.nm||'').replace(/^[^:]*:\s*/,'').toLowerCase();
  for (const x of (ruleList||[])){
    if (LEGACY_FX.has(x.id) || !x.r.fx) continue;
    let used = false;
    for (const e of [].concat(x.r.fx)){
      if (e.phase==='melee' && ranged) continue;
      if (e.phase==='ranged' && !ranged) continue;
      if (e.when && !opts[e.when]) continue;
      if (e.whenNot && opts[e.whenNot]) continue;
      if (e.vs && !kwCond(e.vs, tKw)) continue;
      if (e.weapon && !bare.includes(e.weapon)) continue;
      if (e.weaponNot && bare.includes(e.weaponNot)) continue;
      fx.hit += e.hit||0; fx.wound += e.wound||0; fx.s += e.s||0; fx.ap += e.ap||0; fx.a += e.a||0; fx.d += e.d||0;
      if (e.rrHit && RR[e.rrHit] > RR[fx.rrHit]) fx.rrHit = e.rrHit;
      if (e.rrWound && RR[e.rrWound] > RR[fx.rrWound]) fx.rrWound = e.rrWound;
      if (e.grant) for (const [k,v] of Object.entries(e.grant)){ if (typeof v==='number' && typeof kw[k]==='number') kw[k] = Math.max(kw[k], v); else if (!kw[k]) kw[k] = v; }
      used = true;
    }
    if (used) notes.push(x.r.nm);
  }

  // attacks
  let perModel = avgDice(w.A) + fx.a;
  if (fx.a) notes.push(`+${fx.a} A`);
  if (kw.blast){ const b = Math.floor(tgt.N/5) * (+kw.blast||1); if (b){ perModel += b; notes.push(`Blast +${b}`); } }
  if (kw.cleave && !ranged){ const b = Math.floor(tgt.N/5) * (+kw.cleave||1); if (b){ perModel += b; notes.push(`Cleave +${b}`); } }
  const rf = ranged ? Math.max(kw.rf||0, md.rf||0) : 0;
  if (rf && md.half){ perModel += rf; notes.push(`Rapid Fire +${rf}`); }
  const attacks = w.n * perModel;

  // modifiers
  let hitMod = md.hit + fx.hit, sus = Math.max(kw.sus || 0, md.sus ? 1 : 0), lethal = !!kw.lethal || md.lethal, rrHit = null, rrWound = kw.tl ? 'all' : null, rrDmg = false, ic = !!kw.ic, apB = md.ap + fx.ap, sB = fx.s, critOn = 6;
  if (has('piratical-hero')){ hitMod += 1; sus = Math.max(sus,1); notes.push('Piratical Hero'); }
  if (has('psyguide')){ hitMod += 1; notes.push('Psychic Guidance'); }
  if (opts.guide){ hitMod += 1; notes.push('Guide'); }
  if (kw.heavy && opts.stationary && ranged){ hitMod += 1; notes.push('Heavy'); }
  hitMod = clamp(hitMod,-1,1);
  if (has('raiders') && opts.quarry){ lethal = true; notes.push('Piratical Raiders'); }
  if (has('spirit-marked') && opts.spiritmark){ sus = Math.max(sus,1); notes.push('Spirit Mark'); }
  if (has('reavers')){ rrHit = opts.objective ? 'all' : 'ones'; notes.push(opts.objective ? 'Reavers: re-roll hits' : 'Reavers: re-roll 1s'); }
  if (has('assured') && ranged && vehMon){ rrHit = 'all'; rrWound = 'all'; rrDmg = true; notes.push('Assured Destruction'); }
  if (fx.rrHit && RR[fx.rrHit] > RR[rrHit]) rrHit = fx.rrHit;
  if (fx.rrWound && RR[fx.rrWound] > RR[rrWound]) rrWound = fx.rrWound;
  if (md.rrHit==='full') rrHit = 'all'; else if (md.rrHit==='1s' && !rrHit) rrHit = 'ones';
  if (md.rrWound==='full') rrWound = 'all'; else if (md.rrWound==='1s' && !rrWound) rrWound = 'ones';
  if (has('faolchu') && ranged){ ic = true; }
  if (has('assassins-eye') && ranged && opts.char){ apB += 1; notes.push('Assassins’ Eye +1 AP'); }
  if (opts.riven){ sB += 1; notes.push('Riven +1 S'); }
  if (opts.web){ critOn = 5; }

  // hit
  let pN, pC;
  if (kw.torrent){ pN = 1; pC = 0; notes.push('Torrent'); }
  else {
    let bs = w.sk;
    if (ranged && md.cover){ if (ic) notes.push('Ignores cover'); else { bs += 1; notes.push('Cover −1 BS'); } }
    const need = clamp(bs - hitMod, 2, 6);
    let pS = (7 - Math.min(need, critOn))/6, pc = (7 - critOn)/6;
    if (rrHit==='all'){ pc = pc + (1-pS)*pc; pS = pS + (1-pS)*pS; }
    else if (rrHit==='ones'){ pS = pS + pS/6; pc = pc + pc/6; }
    pN = pS - pc; pC = pc;
    if (critOn===5) notes.push('Whispering Web');
  }
  if (sus && pC) notes.push(`Sustained ${sus}`);
  if (lethal && pC) notes.push('Lethal Hits');
  const hitsPerAttack = pN + pC*(1+sus);
  const toRoll = pN + pC*sus + (lethal ? 0 : pC);
  const autoW = lethal ? pC : 0;

  // wound
  let wn = woundNeed(w.S + sB, tgt.T);
  if (fx.s) notes.push(`+${fx.s} S`);
  let wMod = md.wound + fx.wound;
  if (kw.lance && opts.charged && !ranged){ wMod += 1; notes.push('Lance'); }
  wn = clamp(wn - clamp(wMod,-1,1), 2, 6);
  let critW = 6;
  if (kw.anti && String(kw.anti[0]).split('/').some(k=>kwCond({only:[k]}, tKw))){ critW = Math.min(6, kw.anti[1]); notes.push(`Anti-${String(kw.anti[0]).toLowerCase()} ${kw.anti[1]}+`); }
  let qS = (7 - Math.min(wn, critW))/6, qC = (7 - critW)/6;
  if (rrWound==='all'){ qC = qC + (1-qS)*qC; qS = qS + (1-qS)*qS; if (kw.tl) notes.push('Twin-linked'); }
  else if (rrWound==='ones'){ qS = qS + qS/6; qC = qC + qC/6; }
  const rolledW = toRoll*qS, critWounds = toRoll*qC;
  const dev = !!kw.dev;
  const normalW = (dev ? rolledW - critWounds : rolledW) + autoW;
  const mortalW = dev ? critWounds : 0;
  if (dev && mortalW) notes.push('Devastating');
  const woundsPerAttack = rolledW + autoW;

  // save
  if (fx.ap) notes.push(`+${fx.ap} AP`);
  const sv = tgt.Sv + Math.max(0, (w.AP||0) + apB);
  const needS = tgt.inv ? Math.min(sv, tgt.inv) : sv;
  const pf = needS >= 7 ? 1 : clamp((needS-1)/6, 0, 1);

  // damage
  const melta = (kw.melta && md.half) ? kw.melta : 0;
  if (melta) notes.push(`Melta +${melta}`);
  if (fx.d) notes.push(`+${fx.d} D`);
  const add = melta + fx.d;
  const dist = diceDist(w.D);
  const capN = v => Math.min(tgt.dr ? Math.max(1, v+add-tgt.dr) : v+add, tgt.W);
  const capM = v => Math.min(v+add, tgt.W);
  const exp = (f) => { let e = 0; for (const [v,p] of dist) e += f(v)*p; if (rrDmg && dist.length>1){ const e1 = e; e = 0; for (const [v,p] of dist) e += Math.max(f(v), e1)*p; } return e; };
  const dN = exp(capN), dM = exp(capM);
  const fnpMul = tgt.fnp ? (tgt.fnp-1)/6 : 1;

  const unsavedPerAttack = normalW*pf + mortalW;
  const dealt = attacks * (normalW*pf*dN + mortalW*dM) * fnpMul;
  const wound = hitsPerAttack ? woundsPerAttack/hitsPerAttack : 0;
  const fail = woundsPerAttack ? unsavedPerAttack/woundsPerAttack : 0;
  const denom = attacks*hitsPerAttack*wound*fail;
  const dmg = denom ? dealt/denom : dN*fnpMul;
  if (kw.oneshot) notes.push('One Shot: once per battle');
  return {models:w.n, attacks, hit:hitsPerAttack, hitChance:pN+pC, susExtra:pC*sus, lethalShare: hitsPerAttack ? autoW/hitsPerAttack : 0, wound, fail, dmg, dealt, notes};
}

function attackerList(units, opts){
  if (!opts.combine) return units;
  const out = [], seen = new Set();
  for (const u of units){
    if (u.grp){ if (seen.has(u.grp)) continue; seen.add(u.grp); out.push(combineUnits(u.grp, units.filter(x=>x.grp===u.grp))); }
    else out.push(u);
  }
  return out;
}
function combineUnits(g, members){
  const short = m => m.nm.replace('Corsair ','').replace('Prince ','');
  const w = [];
  for (const m of members) for (const x of m.w) w.push(Object.assign({}, x, {nm:`${short(m)}: ${x.nm}`, alt: x.alt ? m.id+':'+x.alt : undefined, _owner: m.id}));
  const enhs = members.filter(m=>m.enh);
  return {
    id:'grp-'+g, nm: members.map(short).join(' + '), grp:g, combined:true, members: members.map(m=>m.id),
    pts: members.reduce((s,m)=>s+m.pts,0),
    enh: enhs.length ? {nm: enhs.map(m=>m.enh.nm).join(', '), pts: enhs.reduce((s,m)=>s+m.enh.pts,0), ids: enhs.map(m=>m.enh.id)} : null,
    models: members.reduce((s,m)=>s+m.models,0), w, rules:[],
  };
}

if (typeof module !== 'undefined') module.exports = {kwCond, MOD0, modIsSet, modScopes, modsFor, avgDice, diceDist, woundNeed, attackUnit, attackWeapon, attackerList, unitPts, effectiveRules, ruleActive};
