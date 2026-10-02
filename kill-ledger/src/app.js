// ===== App v2 =====
const LS_KEY = 'kill-ledger:v3';
const LS_OLD = 'kill-ledger:burning-one:v2';
const clone = o => JSON.parse(JSON.stringify(o));
const freshOpts = () => Object.assign(clone(DEFAULT_OPTS), {off:{}, mods:{}});
const builtinList = () => ({id:'builtin', builtin:true, meta:BUILTIN_META, groups:BUILTIN_GROUPS, armyRules:BUILTIN_ARMY_RULES, rules:{}, units:clone(DEFAULT_UNITS)});
const extraList = L => ({id:L.id, builtin:true, meta:L.meta, groups:L.groups, armyRules:L.armyRules, rules:L.rules, base:L.units, units:clone(L.units)});
const S = { lists:Object.assign({builtin:builtinList()}, ...EXTRA_BUILTIN_LISTS.map(L=>({[L.id]:extraList(L)}))), listId:'builtin-burning-v2', units:null, targets: clone(DEFAULT_TARGETS), opts: freshOpts(), edit:false, rule:null, modScope:'all', pending:null, importErr:null };
S.units = S.lists.builtin.units;
(function load(){
  try {
    let d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!d){ const old = JSON.parse(localStorage.getItem(LS_OLD) || 'null'); if (old) d = {opts:old.opts, targets:old.targets, lists:{builtin:{units:old.units}}, listId:'builtin'}; }
    if (!d) return;
    if (d.lists){ for (const [id, L] of Object.entries(d.lists)){ if (S.lists[id] && S.lists[id].builtin){ if (L.units) S.lists[id].units = L.units; } else S.lists[id] = L; } }
    if (d.listId && S.lists[d.listId]) S.listId = d.listId;
    if (d.targets) S.targets = d.targets;
    if (d.opts) S.opts = Object.assign(freshOpts(), d.opts);
    // older saves kept cover and half range as global switches
    if (S.opts.cover || S.opts.half){ S.opts.mods.all = Object.assign({}, MOD0, S.opts.mods.all||{}, S.opts.cover?{cover:true}:{}, S.opts.half?{half:true}:{}); }
    delete S.opts.cover; delete S.opts.half;
  } catch(e){}
})();
function save(){
  try {
    const lists = {};
    for (const [id, L] of Object.entries(S.lists)) lists[id] = L.builtin ? {units:L.units} : L;
    localStorage.setItem(LS_KEY, JSON.stringify({lists, listId:S.listId, targets:S.targets, opts:S.opts}));
  } catch(e){}
}
function applyList(id){
  const L = S.lists[id] || S.lists.builtin;
  S.listId = L.id;
  LIST_META = L.meta; GROUPS = L.groups || {}; ARMY_RULES = L.armyRules || [];
  RULES = Object.assign({}, BASE_RULES, L.rules || {});
  S.units = L.units;
  S.modScope = 'all'; S.rule = null; S.edit = false;
  document.title = `Kill Ledger: ${LIST_META.name}`;
  $('#listname').textContent = LIST_META.name; $('#listsub').textContent = LIST_META.sub || '';
}
// target marks only count when a unit in this list can set them
function availableMarks(){ const m = new Set(); for (const u of S.units) for (const id of (u.rules||[])) if (RULES[id] && RULES[id].mark) m.add(RULES[id].mark); return m; }
function effOpts(o){
  o = o || S.opts; const av = availableMarks(); const e = Object.assign({}, o);
  MARKS.forEach(([k])=>{ if (!av.has(k)) e[k] = false; });
  return e;
}

const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f1 = n => (Math.round(n*10)/10).toFixed(1);
const f2 = n => (Math.round(n*100)/100).toFixed(2);
const $ = s => document.querySelector(s);
const atk = (u,t,o) => attackUnit(u, t, effOpts(o), S.units);

function heat(roi){
  if (roi >= 100){ const m = Math.min(85, 62 + (roi-100)/4); return {bg:`color-mix(in oklab, var(--gold) ${m}%, var(--surface))`, fg:'var(--gold-ink)', cls:'eff'}; }
  if (roi >= 65){ const m = 36 + (roi-65)/35*26; return {bg:`color-mix(in oklab, var(--jade) ${m}%, var(--surface))`, fg:'var(--jade-ink)', cls:'eff'}; }
  if (roi >= 35){ const m = 7 + (roi-35)/30*17; return {bg:`color-mix(in oklab, var(--jade) ${m}%, var(--surface))`, fg:'var(--ink)', cls:''}; }
  return {bg:'transparent', fg:'var(--muted)', cls:''};
}
const barBg = h => h.bg==='transparent' ? 'color-mix(in oklab, var(--muted) 30%, var(--surface))' : h.bg;

function allAttackers(){ return S.units.concat(attackerList(S.units, Object.assign({}, S.opts, {combine:true})).filter(u=>u.combined)); }
const findUnit = id => allAttackers().find(u=>u.id===id);
const findTarget = id => S.targets.find(t=>t.id===id);
const rows = () => attackerList(S.units, S.opts);
const phaseLabel = p => ({all:'Shooting and melee', ranged:'Shooting only', melee:'Melee only'})[p];
const unitById = id => S.units.find(u=>u.id===id);
const shortNm = n => n.replace('Corsair ','').replace('Prince ','');

function unitSub(u){
  const b = [`${unitPts(u,S.opts)} pts`];
  if (u.enh) b.push(S.opts.enh ? `incl. ${u.enh.nm}` : `${u.enh.nm} excluded`);
  if (u.sub) b.push(u.sub);
  return b.join(', ');
}
function sectionOf(u){
  if (u.combined) return 'Attached units';
  if (u.grp) return `${GROUPS[u.grp].nm}: ${GROUPS[u.grp].short}`;
  return u.cat || 'Other';
}

// ---------- rule state ----------
function ruleState(owner, id){
  const r = RULES[id];
  if (!r) return 'note';
  if (r.mark) return S.opts[r.mark] ? 'mark-on' : 'mark-off';
  if (!r.dmg) return r.todo ? 'todo' : 'note';
  if (S.opts.off[ruleKey(owner,id)]) return 'off';
  return (r.cond && !S.opts[r.cond]) ? 'idle' : 'on';
}
function chip(owner, id, label){
  const st = ruleState(owner, id), r = RULES[id];
  const sel = S.rule && S.rule.id===id && S.rule.owner===owner ? ' sel' : '';
  const title = st==='todo' ? 'Looks like it changes damage, but it isn’t modelled yet' : st==='note' ? 'Real rule, no effect on damage dealt' : st==='idle' ? `Waiting for: ${r.condNm}` : (st.startsWith('mark') ? 'Target mark' : (st==='on'?'Counted in the maths':'Switched off'));
  return `<button type="button" class="chip ${st}${sel}" data-rule="${id}" data-owner="${owner}" title="${esc(title)}">${esc(label || r.nm)}</button>`;
}

// ---------- modifier bar ----------
const MOD_GROUPS = [
  [['hit','Hit',[[-1,'−1'],[0,'Off'],[1,'+1']],'Net change capped at ±1'], ['wound','Wound',[[-1,'−1'],[0,'Off'],[1,'+1']],'Net change capped at ±1'], ['ap','AP',[[-2,'−2'],[-1,'−1'],[0,'Off'],[1,'+1'],[2,'+2'],[3,'+3']],'Changes the AP characteristic, so it stacks with Assassins’ Eye. −1 is Armour of Contempt']],
  [['sus','Sustained 1',[[false,'Off'],[true,'On']]], ['lethal','Lethal',[[false,'Off'],[true,'On']]], ['rrHit','Re-roll hit',[['off','Off'],['1s','1s'],['full','Full']]], ['rrWound','Re-roll wound',[['off','Off'],['1s','1s'],['full','Full']]]],
  [['cover','Cover',[[false,'Off'],[true,'On']],'Ranged only'], ['half','Half range',[[false,'Off'],[true,'On']],'Melta, Rapid Fire'], ['rf','Rapid Fire',[[0,'Off'],[1,'1'],[2,'2'],[3,'3'],[4,'4']],'Extra attacks per gun, only within half range. Takes the higher of this and the weapon’s own']],
];
function scopeName(sc){
  if (sc==='all') return 'All units';
  const u = findUnit(sc);
  return u ? `${u.nm}${u.sub?` (${u.sub})`:''}` : sc;
}
function modSummary(m){
  const p = [];
  if (m.hit) p.push(`${m.hit>0?'+':'−'}1 hit`); if (m.wound) p.push(`${m.wound>0?'+':'−'}1 wound`); if (m.ap) p.push(`${m.ap>0?'+':'−'}${Math.abs(m.ap)} AP`);
  if (m.sus) p.push('Sustained 1'); if (m.lethal) p.push('Lethal');
  if (m.rrHit && m.rrHit!=='off') p.push(`re-roll hits ${m.rrHit==='1s'?'of 1':'in full'}`);
  if (m.rrWound && m.rrWound!=='off') p.push(`re-roll wounds ${m.rrWound==='1s'?'of 1':'in full'}`);
  if (m.rf) p.push(`Rapid Fire ${m.rf}${m.half?'':' (needs half range)'}`);
  const scoped = p.length && m.apply && m.apply!=='both' ? `${p.join(', ')} (${m.apply} only)` : p.join(', ');
  const extra = []; if (m.cover) extra.push('target in cover'); if (m.half) extra.push('half range');
  return [scoped, extra.join(', ')].filter(Boolean).join('; ');
}
function rowModified(u){
  const sc = new Set([u.id]);
  if (!u.combined && u.grp) sc.add('grp-'+u.grp);
  if (u.combined) u.members.forEach(m=>sc.add(m));
  return [...sc].some(s=>modIsSet(S.opts.mods[s]));
}
function renderModBar(){
  const sc = S.modScope, m = Object.assign({}, MOD0, S.opts.mods[sc]||{});
  const seg = (key, list) => `<span class="seg sm" role="group" aria-label="${esc(key)}">${list.map(([v,l])=>`<button type="button" data-mod="${key}" data-mval="${String(v)}" aria-pressed="${String(m[key])===String(v)}">${l}</button>`).join('')}</span>`;
  const combined = attackerList(S.units, Object.assign({}, S.opts, {combine:true})).filter(u=>u.combined);
  const opt = (id, label) => `<option value="${id}" ${id===sc?'selected':''}>${esc(label)}${modIsSet(S.opts.mods[id])?' •':''}</option>`;
  const options = opt('all','All units')
    + `<optgroup label="Attached units">${combined.map(u=>opt(u.id,u.nm)).join('')}</optgroup>`
    + `<optgroup label="Datasheets">${S.units.map(u=>opt(u.id, u.nm + (u.sub?` (${u.sub})`:''))).join('')}</optgroup>`;
  const groups = MOD_GROUPS.map((g,gi)=>`<div class="mcluster c${gi+2}">${g.map(([k,l,list,note])=>`<div class="mg"><span class="ml">${l}</span>${seg(k,list)}${note?`<span class="mnote">${note}</span>`:''}</div>`).join('')}</div>${gi===0?'<span class="mbreak" aria-hidden="true"></span>':''}`).join('');
  const active = Object.keys(S.opts.mods).filter(k=>modIsSet(S.opts.mods[k]));
  if (S.modOpen === undefined) S.modOpen = window.innerWidth > 760;
  return `<details class="modwrap" ${S.modOpen?'open':''}><summary>Modifiers: ${active.length ? `${active.length} set` : 'none'}</summary><div class="modbar" role="group" aria-label="Modifiers">
      <div class="mcluster c1">
        <div class="mg"><label class="ml" for="modscope">Unit</label><select id="modscope" data-modscope>${options}</select></div>
        <div class="mg"><span class="ml">Applies to</span>${seg('apply',[['both','Both'],['ranged','Ranged'],['melee','Melee']])}</div>
      </div>
      ${groups}
      ${modIsSet(S.opts.mods[sc]) ? `<button class="btn ghost" type="button" data-act="mod-clear">Clear ${sc==='all'?'all-units':'this unit’s'} modifiers</button>` : ''}
    </div>
    <p class="modsum">${active.length ? 'Modifiers in play: ' + active.map(k=>`<b>${esc(scopeName(k))}</b> ${esc(modSummary(S.opts.mods[k]))}`).join('. ') + '.' : 'No modifiers. Pick a unit (or all of them) and set a buff or debuff; it stacks with the list’s own rules, capped at ±1 to hit and wound.'}</p></details>`;
}

// ---------- controls ----------
const SITUATION = [
  ['charged','Charged this turn','Lance weapons add 1 to the wound roll.'],
  ['stationary','Remained stationary','Heavy weapons add 1 to hit.'],
  ['objective','Target is on an objective','For rules that upgrade against objective holders, like Reavers of the Void.'],
  ['char','Target is a Character unit','For rules that only work against Characters, like Assassins’ Eye or Trophy Taker.'],
  ['selfObj','Your unit is on an objective','For rules that work while your unit holds an objective, like Deeds of Legend.'],
];
const MARKS = [
  ['riven','Riven','kharseth','Fury of the Void: +1 Strength for every attack.'],
  ['web','Webbed','lhykhis','Whispering Web: critical hits on 5+.'],
  ['guide','Guided','farseer','Guide: +1 to hit for every attack.'],
  ['quarry','Raiders’ quarry','voidscarred','Piratical Raiders: Lethal Hits for Yriel and the Voidscarred.'],
  ['spiritmark','Spirit-marked','spiritseer','Spirit Mark: Sustained Hits 1 for the Wraithblades.'],
  ['shattered','Shattered','','Shattered Defences: +1 AP for ranged attacks against a marked Monster or Vehicle.'],
  ['hailstrike','Hailstrike-marked','','Hailstrike: ranged attacks against it ignore cover.'],
];
const ACCOUNTING = [
  ['enh','Count enhancement points','Enhancements raise the cost you divide by.'],
  ['cap','Stop at the unit’s total wounds','Overkill beyond the target’s wound pool earns nothing.'],
];
function renderControls(view){
  const o = S.opts;
  const seg = (key, list) => `<span class="seg" role="group">${list.map(([v,l])=>`<button type="button" data-set="${key}" data-val="${v}" aria-pressed="${String(o[key])===String(v)}">${l}</button>`).join('')}</span>`;
  const openAttr = $('#controls details.assume')?.open ? ' open' : '';
  const tog = ([k,l,d]) => `<label class="tog"><input type="checkbox" data-opt="${k}" ${o[k]?'checked':''}><span>${l}<small>${d}</small></span></label>`;
  const av = availableMarks();
  const marksOn = MARKS.filter(m=>o[m[0]] && av.has(m[0])).map(m=>m[1].toLowerCase());
  const sitOn = SITUATION.filter(s=>o[s[0]]).map(s=>s[1].toLowerCase());
  $('#controls').innerHTML = `
    <nav class="tabs" aria-label="Views">
      <a href="#/" ${view==='matrix'?'aria-current="page"':''}>Damage matrix</a>
      <a href="#/rules" ${view==='rules'?'aria-current="page"':''}>Rules matrix</a>
      <a href="#/import" ${view==='import'?'aria-current="page"':''}>Import a list</a>
    </nav>
    <div class="controls">
      <span><span class="seglabel">Phase</span>${seg('phase',[['all','All'],['ranged','Shooting'],['melee','Melee']])}</span>
      <span><span class="seglabel">Attached units</span>${seg('combine',[['true','As one unit'],['false','Split']])}</span>
      ${renderModBar()}
      <details class="assume"${openAttr}>
        <summary>Situation: ${sitOn.length?esc(sitOn.join(', ')):'none'}. Target marks: ${marksOn.length?esc(marksOn.join(', ')):'none'}.</summary>
        <div class="assume-grid">
          <div><h3>Situation</h3>${SITUATION.map(tog).join('')}</div>
          ${(()=>{ const av = availableMarks(); const list = MARKS.filter(m=>av.has(m[0])); if (!list.length) return ''; return `<div><h3>Target marks <span class="hint">set by your units during the turn</span></h3>${list.map(([k,l,src,d])=>{ const who = S.units.find(u=>(u.rules||[]).some(id=>RULES[id]&&RULES[id].mark===k&&RULES[id].src!=='Received')); return tog([k,`${l}${who?` <span class="by">by ${esc(who.nm)}</span>`:''}`,d]); }).join('')}</div>`; })()}
          <div><h3>Accounting</h3>${ACCOUNTING.map(tog).join('')}
            <div class="presets">
              <button class="btn" type="button" data-act="preset-table">Table defaults</button>
              <button class="btn" type="button" data-act="preset-cog">Bare datasheets</button>
            </div>
            <small class="hint">Bare datasheets turns off leader buffs and re-rolls, which is how the Cogitator scores units.</small>
          </div>
        </div>
      </details>
    </div>`;
}

// ---------- damage matrix ----------
function renderMatrix(){
  const R = rows();
  const M = R.map(u=>({u, cells:S.targets.map(t=>atk(u,t))}));
  const inf = S.targets.filter(t=>t.cls==='inf'), veh = S.targets.filter(t=>t.cls!=='inf');
  const ordered = inf.concat(veh), idx = ordered.map(t=>S.targets.indexOf(t));
  const colCls = t => t.id===veh[0]?.id ? 'first-veh' : (t.id===inf[0]?.id ? 'first-inf' : '');
  let body = '', last = null;
  for (const {u,cells} of M){
    const sec = sectionOf(u);
    if (sec!==last){ body += `<tr class="sec"><td colspan="${ordered.length+3}">${esc(sec)}</td></tr>`; last = sec; }
    const vals = cells.map(c=>c.roi), avg = vals.reduce((a,b)=>a+b,0)/vals.length;
    let bi = 0; vals.forEach((v,i)=>{ if (v>vals[bi]) bi=i; });
    body += `<tr><td class="rowh"><a href="#/unit/${u.id}"><span class="un">${esc(u.nm)}${rowModified(u)?'<span class="modtag">modified</span>':''}</span><span class="um">${esc(unitSub(u))}</span></a></td>`;
    ordered.forEach((t,k)=>{ const c = cells[idx[k]], h = heat(c.roi);
      body += `<td class="c ${h.cls} ${colCls(t)}"><a href="#/unit/${u.id}/vs/${t.id}" style="background:${h.bg};color:${h.fg}" title="${esc(u.nm)} into ${esc(t.nm)}: ${f1(c.roi)}%">${Math.round(c.roi)}</a></td>`; });
    body += `<td class="agg">${Math.round(avg)}</td><td class="agg best" title="${esc(S.targets[bi].nm)}">${esc(S.targets[bi].nm)}</td></tr>`;
  }
  const cov = ordered.map((t,k)=>M.filter(r=>r.cells[idx[k]].roi>=65).length);
  body += `<tr class="cov"><td class="rowh">Units at 65% or better</td>${cov.map((n,k)=>`<td class="${n===0?'zero':''} ${colCls(ordered[k])}">${n}</td>`).join('')}<td></td><td></td></tr>`;
  const head = `<tr class="grp"><th class="rowh"></th><th class="inf" colspan="${inf.length}">Infantry and beasts</th><th class="veh" colspan="${veh.length}">Vehicles and monsters</th><th colspan="2"></th></tr>
    <tr><th class="rowh corner">Your unit, then target</th>${ordered.map(t=>`<th class="tg ${colCls(t)}"><a href="#/target/${t.id}"><span class="tn">${esc(t.nm)}</span><span class="tm">T${t.T}, ${t.pts} pts</span></a></th>`).join('')}
    <th class="tg aggh">Avg</th><th class="tg aggh l">Best into</th></tr>`;
  $('#view').innerHTML = `
    <div class="legend">
      <div class="eq">Return = <em>wounds dealt</em> ÷ <em>your points</em> × <em>their points per wound</em></div>
      <div class="keyrow">
        <span><span class="sw" style="background:${heat(120).bg}"></span>100%+ pays for itself</span>
        <span><span class="sw" style="background:${heat(80).bg}"></span>65–99% efficient</span>
        <span><span class="sw" style="background:${heat(50).bg}"></span>35–64% chip damage</span>
        <span>${esc(phaseLabel(S.opts.phase))}. Every damage rule in the list is applied unless you switch it off in the rules matrix.</span>
      </div>
    </div>
    <div class="mx-scroll"><table class="mx"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <ul class="findings">${findings(M, ordered, idx).join('')}</ul>`;
}

function findings(M, ordered, idx){
  const out = [];
  const best = ordered.map((t,k)=>{ let b=null; for (const r of M){ const c=r.cells[idx[k]]; if (!b || c.roi>b.c.roi) b={u:r.u,c}; } return {t,b}; });
  const weak = best.filter(x=>x.b.c.roi<65).sort((a,b)=>a.b.c.roi-b.b.c.roi);
  if (weak.length){ const w = weak[0];
    out.push(`<li class="alert">Nothing here removes <a href="#/target/${w.t.id}">${esc(w.t.nm)}</a> efficiently. Your best answer is <a href="#/unit/${w.b.u.id}/vs/${w.t.id}">${esc(w.b.u.nm)}</a> at <b>${f1(w.b.c.roi)}%</b>${weak.length>1?`, and ${weak.length-1} other target${weak.length>2?'s sit':' sits'} under the 65% line too`:''}.</li>`);
  } else out.push(`<li>Every benchmark target has at least one answer at 65% or better.</li>`);
  const counts = M.map(r=>({u:r.u, n:r.cells.filter(c=>c.roi>=65).length, peak:r.cells.reduce((m,c,i)=>c.roi>m.roi?{roi:c.roi,i}:m,{roi:-1,i:0})})).sort((a,b)=>b.n-a.n || b.peak.roi-a.peak.roi);
  const p = counts[0];
  out.push(`<li class="gold"><a href="#/unit/${p.u.id}">${esc(p.u.nm)}</a> is your prime trigger: 65% or better into <b>${p.n} of ${ordered.length}</b> targets, peaking at ${f1(p.peak.roi)}% into ${esc(S.targets[p.peak.i].nm)}.</li>`);
  if (S.opts.enh){
    const members = u => u.combined ? u.members.map(unitById) : [u];
    const avg = (u, o) => S.targets.reduce((s,t)=>s+atk(u,t,o).roi,0)/S.targets.length;
    const taxed = M.filter(r=>r.u.enh).map(r=>{
      const a = r.cells.reduce((s,c)=>s+c.roi,0)/r.cells.length;
      const free = avg(r.u, Object.assign({}, S.opts, {enh:false}));
      const off = Object.assign({}, S.opts.off); members(r.u).forEach(m=>{ if (m && m.enh) off[ruleKey(m.id, m.enh.id)] = true; });
      const none = avg(r.u, Object.assign({}, S.opts, {enh:false, off}));
      const adds = members(r.u).some(m=>{ const er = m && m.enh && RULES[m.enh.id]; return er && er.dmg && (!er.cond || S.opts[er.cond]); });
      return {u:r.u, a, free, none, adds};
    }).sort((x,y)=>(y.free-y.a)-(x.free-x.a));
    if (taxed.length){ const r = taxed[0];
      out.push(r.adds
        ? `<li><a href="#/unit/${r.u.id}">${esc(r.u.nm)}</a> pays ${r.u.enh.pts} pts for ${esc(r.u.enh.nm)}, the biggest enhancement cost in the list. With it the unit averages <b>${f1(r.a)}%</b>; without it at all, ${f1(r.none)}%. ${Math.abs(r.a - r.none) < 2 ? 'It roughly breaks even on damage alone.' : r.a > r.none ? 'Its damage more than covers its cost.' : 'Its damage doesn’t cover its cost against these targets.'}</li>`
        : `<li><a href="#/unit/${r.u.id}">${esc(r.u.nm)}</a> pays ${r.u.enh.pts} pts for ${esc(r.u.enh.nm)}, which adds no damage against these targets, so its average return drops from ${f1(r.free)}% to <b>${f1(r.a)}%</b>. That’s the biggest enhancement cost in the list.</li>`);
    }
  }
  return out;
}

// ---------- rules matrix ----------
function renderRules(){
  const army = ARMY_RULES.length ? ARMY_RULES.map(id=>`<div class="armyrule">${chip('army',id)}<span>${esc(ARMY_RULE_SCOPE[id]||'')}</span></div>`).join('') : '<span class="none">None in the library for this list yet.</span>';
  let body = '', last = null;
  const none = '<span class="none">none</span>';
  for (const u of S.units){
    const sec = u.grp ? `${GROUPS[u.grp].nm}: ${GROUPS[u.grp].short}` : (u.cat||'Other');
    if (sec!==last){ body += `<tr class="sec"><td colspan="6">${esc(sec)}</td></tr>`; last = sec; }
    const own = (u.rules||[]).filter(id=>RULES[id]);
    const enh = u.enh ? chip(u.id, u.enh.id, `${u.enh.nm} (+${u.enh.pts})`) : none;
    const abil = own.filter(id=>!['Wargear','Enhancement','Received'].includes(RULES[id].src) && !RULES[id].mark && !ARMY_RULES.includes(id)).map(id=>chip(u.id,id)).join('') || none;
    const gear = own.filter(id=>RULES[id].src==='Wargear').map(id=>chip(u.id,id)).join('') || none;
    const recv = u.grp ? S.units.filter(m=>m.grp===u.grp && m.id!==u.id).flatMap(m=>(m.rules||[]).filter(id=>RULES[id] && RULES[id].scope==='unit').map(id=>chip(m.id,id,`${RULES[id].nm} ← ${shortNm(m.nm)}`))).join('') : '';
    const marks = own.filter(id=>RULES[id].mark).map(id=>chip(u.id,id)).join('');
    body += `<tr><td class="rowh"><a href="#/unit/${u.id}"><span class="un">${esc(u.nm)}</span><span class="um">${esc(unitSub(u))}${u.role?`, ${u.role.toLowerCase()}`:''}</span></a></td>
      <td>${enh}</td><td>${abil}</td><td>${gear}</td><td>${recv || `<span class="none">${u.grp?'nothing shared':'not attached'}</span>`}</td><td>${marks || none}</td></tr>`;
  }
  const dmgCount = Object.values(RULES).filter(r=>r.dmg).length, all = Object.keys(RULES).length;
  $('#view').innerHTML = `
    <div class="legend">
      <div class="eq">Every rule in the list, and whether it moves the numbers</div>
      <div class="keyrow">
        <span><span class="chip on demo">Counted</span> changes damage and is in the maths</span>
        <span><span class="chip idle demo">Idle</span> changes damage, but its condition is off</span>
        <span><span class="chip off demo">Off</span> changes damage, switched off</span>
        <span><span class="chip mark-off demo">Mark</span> marks a target; switch it on to apply</span>
        <span><span class="chip note demo">Noted</span> real rule, no effect on damage dealt</span>
        <span><span class="chip todo demo">Not modelled</span> looks like it changes damage, not in the maths yet</span>
      </div>
      <p class="lede">${(()=>{ const ids = new Set(S.units.flatMap(u=>u.rules||[]).concat(ARMY_RULES)); const list=[...ids].map(id=>RULES[id]).filter(Boolean); const dm=list.filter(r=>r.dmg).length, td=list.filter(r=>r.todo).length; return `${list.length} rules across the army, ${dm} of which change how much damage your units deal${td?`, and ${td} that probably do but aren’t modelled yet`:''}.`; })()} Tap any rule to read it and switch it. Stratagems are left out.</p>
    </div>
    <div class="armyrules"><h3>Army and detachments</h3><div class="armygrid">${army}</div></div>
    <div class="mx-scroll"><table class="rx"><thead><tr><th class="rowh">Unit</th><th>Enhancement</th><th>Abilities</th><th>Wargear</th><th>Shared from its attached unit</th><th>Marks a target</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderDrawer(){
  const d = $('#drawer');
  if (!S.rule || !RULES[S.rule.id]){ d.hidden = true; d.innerHTML=''; return; }
  const {id, owner} = S.rule, r = RULES[id], st = ruleState(owner,id);
  const ownerU = unitById(owner);
  const who = owner==='army' ? '' : (r.scope==='unit' && ownerU?.grp ? `${ownerU.nm} and the rest of ${GROUPS[ownerU.grp].short}` : (ownerU?.nm||''));
  let ctl;
  if (r.mark){ const m = MARKS.find(x=>x[0]===r.mark); ctl = `<label class="tog big"><input type="checkbox" data-opt="${r.mark}" ${S.opts[r.mark]?'checked':''}><span>Target is ${esc(m?m[1].toLowerCase():r.mark)}<small>Applies to every matchup in the matrix while it’s on.</small></span></label>`; }
  else if (r.dmg){
    ctl = `<label class="tog big"><input type="checkbox" data-rulesw="${owner}:${id}" ${st!=='off'?'checked':''}><span>Count it in the damage maths</span></label>`;
    if (r.cond) ctl += `<label class="tog big"><input type="checkbox" data-opt="${r.cond}" ${S.opts[r.cond]?'checked':''}><span>${esc(r.condNm)}<small>${S.opts[r.cond]?'On: the rule is changing the numbers now.':'Off: the rule is idle in every matchup.'}</small></span></label>`;
  }
  else if (r.todo) ctl = `<p class="hint">This reads like it changes damage, but the engine doesn’t model it yet. Approximate it with the modifier bar for now, or paste it to Claude to turn it into a proper rule.</p>`;
  else ctl = `<p class="hint">Doesn’t change damage dealt, so the matrix leaves it out.</p>`;
  d.hidden = false;
  d.innerHTML = `<div class="dr-in"><div class="dr-head"><div><div class="dr-src">${esc(r.src)}${who?`, ${esc(who)}`:''}</div><h4>${esc(r.nm)}</h4></div><button class="x" type="button" data-act="close-rule" aria-label="Close">×</button></div><p>${esc(r.txt)}</p>${ctl}</div>`;
}

// ---------- unit dossier ----------
function kwText(w){
  const k = w.kw||{}, t=[];
  // conditional abilities read like "Lethal Hits (not vs monster/vehicle)"
  const cnd = key => { const c = k.when && k.when[key]; if (!c) return ''; return c.not ? ` (not vs ${c.not.join('/').toLowerCase()})` : ` (vs ${c.only.join('/').toLowerCase()})`; };
  const push = t.push.bind(t);
  t.push = (s, key) => push(s + (key ? cnd(key) : ''));
  if (k.torrent) t.push('Torrent'); if (k.lethal) t.push('Lethal Hits','lethal'); if (k.sus) t.push(`Sustained ${k.sus}`,'sus');
  if (k.tl) t.push('Twin-linked','tl'); if (k.dev) t.push('Devastating','dev'); if (k.lance) t.push('Lance','lance');
  if (k.blast) t.push(k.blast>1?`Blast ${k.blast}`:'Blast'); if (k.cleave) t.push(`Cleave ${k.cleave}`); if (k.melta) t.push(`Melta ${k.melta}`); if (k.heavy) t.push('Heavy'); if (k.rf) t.push(`Rapid Fire ${k.rf}`);
  if (k.anti) t.push(`Anti-${String(k.anti[0]).toLowerCase()} ${k.anti[1]}+`); if (k.pistol) t.push('Pistol / close-quarters'); if (k.ic) t.push('Ignores Cover','ic');
  if (k.precision) t.push('Precision','precision'); if (k.psychic) t.push('Psychic'); if (k.extra) t.push('Extra Attacks'); if (k.oneshot) t.push('One Shot');
  if (k.hazardous) t.push('Hazardous'); if (k.indirect) t.push('Indirect Fire'); if (k.other) t.push(...k.other);
  if (w.alt) t.push(/(^|:)m\d*:/.test(w.alt) ? 'one melee weapon per model' : 'pick one profile');
  return t.join(', ');
}
function kwSerialize(k){ k=k||{}; const t=[];
  ['torrent','lethal','tl','dev','lance','blast','heavy','pistol','ic','precision','psychic','extra'].forEach(x=>{ if(k[x]) t.push(x); });
  if (k.sus) t.push('sus'+k.sus); if (k.melta) t.push('melta'+k.melta); if (k.rf) t.push('rf'+k.rf); if (k.anti) t.push(`anti-${k.anti[0].toLowerCase()}${k.anti[1]}`);
  return t.join(' '); }
function kwParse(s){ const k={};
  for (let tok of String(s).toLowerCase().split(/[\s,]+/).filter(Boolean)){
    tok = tok.replace(/twin-?linked/,'tl').replace(/^ignores?-?cover$/,'ic').replace(/^devastating$/,'dev').replace(/\+$/,''); let m;
    if ((m = tok.match(/^(sus|sustained)(\d)$/))) k.sus=+m[2];
    else if ((m = tok.match(/^melta(\d)$/))) k.melta=+m[1];
    else if ((m = tok.match(/^(rf|rapidfire)(\d)$/))) k.rf=+m[2];
    else if ((m = tok.match(/^anti-([a-z]+?)(\d)$/))) k.anti=[m[1].toUpperCase(), +m[2]];
    else if (['torrent','lethal','tl','dev','lance','blast','heavy','pistol','ic','precision','psychic','extra'].includes(tok)) k[tok]=1;
  } return k; }

function rulesInPlay(u){
  const er = effectiveRules(u, S.units);
  const members = u.combined ? u.members.map(unitById) : [u];
  const noteCount = members.reduce((s,m)=>s+(m.rules||[]).filter(id=>RULES[id] && !RULES[id].dmg).length,0);
  const chips = er.map(x=>chip(x.owner, x.id, (x.owner===u.id || u.combined) ? RULES[x.id].nm : `${RULES[x.id].nm} ← ${shortNm(unitById(x.owner).nm)}`)).join('');
  return `<h3 class="sh">Rules in play <span>${er.length ? 'tap one to read or switch it' : 'none of this unit’s rules change damage'}</span></h3>
    ${er.length?`<div class="chips">${chips}</div>`:''}
    ${noteCount?`<p class="hint">${noteCount} more rule${noteCount>1?'s':''} on ${u.combined?'these datasheets':'this datasheet'} don’t change damage. <a href="#/rules">See them in the rules matrix</a>.</p>`:''}`;
}

function renderUnit(id, tid){
  const u = findUnit(id);
  if (!u){ $('#view').innerHTML = `<p class="empty">That unit isn’t in this list. <a href="#/">Back to the matrix</a>.</p>`; return; }
  const results = S.targets.map(t=>({t, r:atk(u,t)}));
  let sel = tid ? results.find(x=>x.t.id===tid) : null;
  if (!sel) sel = results.reduce((a,b)=>b.r.roi>a.r.roi?b:a);
  const groupLine = u.combined ? `${GROUPS[u.grp].nm}, ${u.models} models` : (u.grp ? `${GROUPS[u.grp].nm} ${u.role.toLowerCase()}, ${u.models} model${u.models>1?'s':''}` : `${u.cat}, ${u.models} model${u.models>1?'s':''}`);
  const base = unitPts(u, Object.assign({},S.opts,{enh:false}));
  const ptsLine = u.enh ? (S.opts.enh ? `${base} + ${u.enh.pts} for ${u.enh.nm}` : `${u.enh.nm} (${u.enh.pts}) excluded`) : 'datasheet cost';
  const avg = results.reduce((s,x)=>s+x.r.roi,0)/results.length;
  const vs = sel.t.id;
  const barList = cls => results.filter(x=>(cls==='inf')===(x.t.cls==='inf')).sort((a,b)=>b.r.roi-a.r.roi).map(({t,r})=>{ const h = heat(r.roi);
    return `<li class="${t.id===vs?'sel':''}"><a class="bn" href="#/unit/${u.id}/vs/${t.id}">${esc(t.nm)}</a><a class="track" href="#/unit/${u.id}/vs/${t.id}" aria-label="${esc(t.nm)} ${f1(r.roi)}%"><span class="fill" style="width:${Math.min(r.roi,200)/2}%;background:${barBg(h)}"></span><span class="mk" style="left:32.5%"></span><span class="mk m100" style="left:50%"></span></a><span class="bv">${Math.round(r.roi)}%</span></li>`; }).join('');
  const split = u.combined ? `<p class="hint">Split view: ${u.members.map(mid=>`<a href="#/unit/${mid}/vs/${vs}">${esc(unitById(mid).nm)}</a>`).join(', ')}.</p>`
    : (u.grp ? `<p class="hint">Part of <a href="#/unit/grp-${u.grp}/vs/${vs}">${esc(GROUPS[u.grp].short)}</a>; the rules they share still apply in this split view.</p>` : '');
  $('#view').innerHTML = `
    <div class="crumbs"><a href="#/">Damage matrix</a></div>
    <div class="dhead">
      <div><h2>${esc(u.nm)}</h2><div class="meta">${esc(groupLine)}${u.sub?`, ${esc(u.sub)}`:''}. Averages ${f1(avg)}% across ${S.targets.length} targets. ${esc(phaseLabel(S.opts.phase))}.</div>${split}</div>
      <div class="ptsbig">${unitPts(u,S.opts)} pts<small>${esc(ptsLine)}</small></div>
    </div>
    <div class="dgrid">
      <section>
        <h3 class="sh">Matchups <span>sorted by return; marks at 65% and 100%</span></h3>
        <ul class="bars"><li class="cls">Infantry and beasts</li>${barList('inf')}<li class="cls">Vehicles and monsters</li>${barList('veh')}</ul>
      </section>
      <section>
        <h3 class="sh">Attack detail <span>into ${esc(sel.t.nm)}</span></h3>
        ${detailTable(sel.r)}
        ${sigma(u, sel.t, sel.r)}
        ${rulesInPlay(u)}
        <h3 class="sh">Loadout <span>${u.combined?'edit the members to change these':'what the matrix is built from'}</span></h3>
        ${loadout(u)}
      </section>
    </div>`;
}

function detailTable(r){
  const tr = r.rows.map(x=>{
    if (x.skipped) return `<tr class="skip"><td><span class="wn">${esc(x.w.nm)}</span><span class="wnotes">${esc(x.skipped)}</span></td><td>${x.w.t==='r'?'ranged':'melee'}</td><td>${x.w.n}</td><td colspan="6">not used</td></tr>`;
    return `<tr><td><span class="wn">${esc(x.w.nm)}</span>${x.notes.length?`<span class="wnotes">${esc(x.notes.join(', '))}</span>`:''}</td><td>${x.w.t==='r'?'ranged':'melee'}</td><td>${x.models}</td><td>${f1(x.attacks)}</td><td>${f1(x.hitChance*100)}%${x.susExtra>0.0005?`<span class="sub">+${f1(x.susExtra*100)} sustained</span>`:''}</td><td>${f1(x.wound*100)}%${x.lethalShare>0.0005?`<span class="sub">incl. lethal</span>`:''}</td><td>${f1(x.fail*100)}%</td><td>${f2(x.dmg)}</td><td class="dealt">${f2(x.dealt)}</td></tr>`;
  }).join('');
  return `<div class="tbl-scroll"><table class="dt"><thead><tr><th>Weapon</th><th>Type</th><th>Models</th><th>Attacks</th><th title="Chance to hit. The small line is extra hits per attack from Sustained Hits">Hit</th><th title="Wounds per hit. Lethal Hits count as automatic wounds">Wound</th><th title="Share of wounds that get past saves">Fail save</th><th>Dmg/wound</th><th>Wounds dealt</th></tr></thead><tbody>${tr || `<tr><td colspan="9" class="emptyrow">No ${S.opts.phase==='ranged'?'ranged':'melee'} weapons on this unit.</td></tr>`}</tbody></table></div>`;
}

function sigma(u, t, r){
  const cls = r.roi>=100?'hi':(r.roi<35?'lo':'');
  const share = r.total/r.pool*100;
  let alt = '';
  if (u.enh && S.opts.enh){ const off = atk(u,t,Object.assign({},S.opts,{enh:false})); alt = `Without ${esc(u.enh.nm)} (${off.pts} pts) the same attacks return ${f1(off.roi)}%.`; }
  const poolLine = r.capped ? `That wipes all ${r.pool} wounds; the extra is ignored because overkill is capped.`
    : share>=100 ? `That’s more than the unit’s ${r.pool} wounds, so ${f1(r.total-r.pool)} of it is overkill unless you switch on the cap.`
    : `That’s ${Math.round(share)}% of the unit’s ${r.pool} wounds.`;
  return `<div class="sigma" id="sigma">
    <div class="line">
      <span class="term">Σ ${f2(r.total)}<small>wounds dealt</small></span>
      <span class="op">(</span><span class="term">${f2(r.total)}<small>wounds</small></span><span class="op">÷</span><span class="term">${r.pts}<small>your points</small></span><span class="op">)</span>
      <span class="op">×</span><span class="term">${f1(r.ppw)}<small>their pts per wound</small></span>
      <span class="op">×</span><span class="term">100</span><span class="op">=</span><span class="term res ${cls}">${f1(r.roi)}%<small>return</small></span>
    </div>
    <p>${esc(u.nm)} ${u.combined?'remove':'removes'} about <b>${Math.round(r.total*r.ppw)} pts</b> of ${esc(t.nm)} for the ${r.pts} pts ${u.combined?'they cost':'spent'}. ${poolLine}</p>
    ${alt?`<p class="alt">${alt}</p>`:''}
  </div>`;
}

function loadout(u){
  const editable = S.edit && !u.combined;
  const btn = u.combined ? '' : `<div class="editbar"><button class="btn ${S.edit?'primary':''}" type="button" data-act="toggle-edit">${S.edit?'Done editing':'Edit profiles'}</button>
    ${S.edit?`<label>Points <input class="ptsin" data-upts="${u.id}" value="${u.pts}"></label>`:''}</div>`;
  const rowsHtml = u.w.map((w,i)=>{
    if (!editable) return `<tr class="${w.off?'skip':''}"><td><span class="wn">${esc(w.nm)}</span>${w.off?`<span class="wnotes">${esc(w.off)}</span>`:''}</td><td>${w.t==='r'?'ranged':'melee'}</td><td>${w.n}</td><td>${esc(w.A)}</td><td>${w.kw&&w.kw.torrent?'N/A':w.sk+'+'}</td><td>${w.S}</td><td>${w.AP?'-'+w.AP:'0'}</td><td>${esc(w.D)}</td><td class="l">${esc(kwText(w))}</td></tr>`;
    const inp = (f,v,c='') => `<input class="${c}" data-u="${u.id}" data-i="${i}" data-f="${f}" value="${esc(v)}">`;
    return `<tr><td>${inp('nm',w.nm,'nmin')}</td><td>${w.t==='r'?'ranged':'melee'}</td><td>${inp('n',w.n)}</td><td>${inp('A',w.A)}</td><td>${inp('sk',w.sk)}</td><td>${inp('S',w.S)}</td><td>${inp('AP',w.AP)}</td><td>${inp('D',w.D)}</td><td class="l">${inp('kw',kwSerialize(w.kw),'kwin')}</td></tr>`;
  }).join('');
  const help = editable ? `<p class="hint">Abilities are typed as words: torrent lethal sus1 tl dev lance blast melta2 heavy rf1 anti-infantry2 pistol ic. Changes save in this browser and recalculate everything.</p>` : '';
  return btn + `<div class="tbl-scroll"><table class="dt"><thead><tr><th>Weapon</th><th>Type</th><th>Models</th><th>A</th><th>BS/WS</th><th>S</th><th>AP</th><th>D</th><th class="l">Abilities</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` + help;
}

// ---------- target page ----------
function renderTarget(tid){
  const t = findTarget(tid);
  if (!t){ $('#view').innerHTML = `<p class="empty">Unknown target. <a href="#/">Back to the matrix</a>.</p>`; return; }
  const R = rows().map(u=>({u, r:atk(u,t)})).sort((a,b)=>b.r.roi-a.r.roi);
  const fld = (f,l,c='') => `<label>${l}<input class="${c}" data-t="${t.id}" data-f="${f}" value="${esc(t[f])}"></label>`;
  $('#view').innerHTML = `
    <div class="crumbs"><a href="#/">Damage matrix</a></div>
    <div class="dhead">
      <div><h2>${esc(t.nm)}</h2><div class="meta">${t.N} model${t.N>1?'s':''} with ${t.W} wound${t.W>1?'s':''} each, ${t.pts} pts, so every wound is worth ${f1(t.pts/(t.W*t.N))} pts.</div></div>
      <div class="ptsbig">${f1(t.pts/(t.W*t.N))}<small>points per wound</small></div>
    </div>
    <div class="tprof">${fld('pts','Points')}${fld('T','Toughness')}${fld('Sv','Save')}${fld('inv','Invuln (0 = none)')}${fld('W','Wounds each')}${fld('N','Models')}${fld('fnp','Feel No Pain (0 = none)')}${fld('dr','Damage reduction')}${fld('kw','Keyword','wide')}</div>
    <section style="padding-top:16px">
      <h3 class="sh">Who removes it best <span>${esc(phaseLabel(S.opts.phase))}</span></h3>
      <ul class="bars">${R.map(({u,r})=>{ const h=heat(r.roi);
        return `<li><a class="bn" href="#/unit/${u.id}/vs/${t.id}">${esc(u.nm)}${u.sub?` (${esc(u.sub)})`:''}</a><a class="track" href="#/unit/${u.id}/vs/${t.id}" aria-label="${f1(r.roi)}%"><span class="fill" style="width:${Math.min(r.roi,200)/2}%;background:${barBg(h)}"></span><span class="mk" style="left:32.5%"></span><span class="mk m100" style="left:50%"></span></a><span class="bv">${Math.round(r.roi)}%</span></li>`; }).join('')}</ul>
    </section>`;
}

// ---------- footer ----------
function renderFoot(){
  const bare = Object.assign({}, COGITATOR_OPTS, {off:{}});
  DEFAULT_UNITS.forEach(u=>COGITATOR_RULES_OFF.forEach(r=>bare.off[ruleKey(u.id,r)]=true));
  const chk = attackUnit(DEFAULT_UNITS.find(u=>u.id==='yriel'), DEFAULT_TARGETS.find(t=>t.id==='warp-spiders'), bare, DEFAULT_UNITS);
  $('#foot').innerHTML = `
    <p>Calibration: with bare datasheets, the Yriel, Fuegan, Kharseth and Shroud Runners rows reproduce the Cogitator’s numbers against all 19 targets. Live check, Yriel into Warp Spiders: <span class="check">Σ ${f2(chk.total)} → ${f1(chk.roi)}%</span>. Expected values only. Stratagems are left out on purpose.</p>
    <p><button class="linkbtn" type="button" data-act="reset">Restore this list and the default targets</button></p>`;
}

// ---------- router ----------
let lastPath = '';
function route(){
  const h = location.hash.replace(/^#\/?/,'').split('/');
  const view = h[0]==='rules' ? 'rules' : h[0]==='import' ? 'import' : (h[0]==='unit'||h[0]==='target' ? 'detail' : 'matrix');
  renderListPick();
  renderControls(view);
  if (h[0]==='import'){ $('#controls').innerHTML = renderTabsOnly(view); renderImport(); renderDrawer(); renderFoot(); return; }
  if (h[0]==='unit' && h[1]) renderUnit(h[1], h[2]==='vs' ? h[3] : null);
  else if (h[0]==='target' && h[1]) renderTarget(h[1]);
  else if (h[0]==='rules') renderRules();
  else renderMatrix();
  renderDrawer();
  renderFoot();
}
window.addEventListener('hashchange', ()=>{
  const path = location.hash.split('/vs/')[0];
  const sameUnit = path===lastPath && location.hash.includes('/vs/');
  lastPath = path; S.rule = null;
  route();
  if (!sameUnit) window.scrollTo(0,0);
  else { const s = document.getElementById('sigma'); if (s){ s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
});

document.addEventListener('click', e=>{
  const b = e.target.closest('[data-set]');
  if (b){ let v = b.dataset.val; if (v==='true') v=true; else if (v==='false') v=false; S.opts[b.dataset.set]=v; save(); route(); return; }
  const mb = e.target.closest('[data-mod]');
  if (mb){
    const k = mb.dataset.mod; let v = mb.dataset.mval;
    if (v==='true') v = true; else if (v==='false') v = false; else if (/^-?\d+$/.test(v)) v = +v;
    const cur = Object.assign({}, MOD0, S.opts.mods[S.modScope]||{}, {[k]:v});
    if (modIsSet(cur)) S.opts.mods[S.modScope] = cur; else delete S.opts.mods[S.modScope];
    if (k==='apply' && !modIsSet(cur)) S.opts.mods[S.modScope] = cur; // keep the scope choice even before a modifier is set
    save(); route(); return;
  }
  const c = e.target.closest('[data-rule]');
  if (c && !c.classList.contains('demo')){ S.rule = {id:c.dataset.rule, owner:c.dataset.owner}; route(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act==='close-rule'){ S.rule=null; route(); }
  if (act==='mod-clear'){ delete S.opts.mods[S.modScope]; save(); route(); }
  if (act==='preset-table'){ S.opts = Object.assign(freshOpts(), {phase:S.opts.phase, combine:S.opts.combine}); save(); route(); }
  if (act==='preset-cog'){ const off={}; S.units.forEach(u=>COGITATOR_RULES_OFF.forEach(r=>off[ruleKey(u.id,r)]=true)); S.opts = Object.assign(freshOpts(), COGITATOR_OPTS, {off, phase:S.opts.phase, combine:S.opts.combine}); save(); route(); }
  if (act==='toggle-edit'){ S.edit = !S.edit; route(); }
  if (act==='reset'){ const L = S.lists[S.listId]; L.units = L.id==='builtin' ? clone(DEFAULT_UNITS) : clone(L.base); S.targets = clone(DEFAULT_TARGETS); S.opts = freshOpts(); applyList(S.listId); save(); route(); }
  if (act==='import-read') return doImport();
  if (act==='import-save') return saveImport();
  if (act==='import-cancel'){ S.pending = null; S.importErr = null; route(); }
  if (act==='list-delete'){ const id = a.dataset.id; if (id && id!=='builtin' && confirm('Delete this list from your browser?')){ delete S.lists[id]; if (S.listId===id) applyList('builtin'); save(); route(); } }
  if (act==='list-open'){ applyList(a.dataset.id); save(); location.hash = '#/'; route(); }
});
document.addEventListener('change', e=>{
  const el = e.target;
  if (el.dataset.opt){ S.opts[el.dataset.opt] = el.checked; save(); route(); return; }
  if (el.id==='listpick'){ if (el.value==='__import'){ location.hash = '#/import'; } else { applyList(el.value); save(); route(); } return; }
  if (el.dataset.pts){ const p = S.pending; const u = p && p.units.find(x=>x.id===el.dataset.pts); if (u){ u.pts = Math.max(0, parseFloat(el.value)||0); } return; }
  if (el.dataset.enhpts){ const p = S.pending; const u = p && p.units.find(x=>x.id===el.dataset.enhpts); if (u && u.enh){ const v = Math.max(0, parseFloat(el.value)||0); u.enh.pts = v; } return; }
  if (el.id==='impname'){ if (S.pending) S.pending.meta.name = el.value.trim() || S.pending.meta.name; return; }
  if (el.hasAttribute('data-modscope')){ S.modScope = el.value; route(); const s=$('#modscope'); if (s) s.focus(); return; }
  if (el.dataset.rulesw){ if (el.checked) delete S.opts.off[el.dataset.rulesw]; else S.opts.off[el.dataset.rulesw] = true; save(); route(); return; }
  if (el.dataset.upts){ const u=unitById(el.dataset.upts); const v=parseFloat(el.value); if(u && v>0){ u.pts=v; save(); route(); } return; }
  if (el.dataset.u){
    const u = unitById(el.dataset.u); if (!u) return;
    const w = u.w[+el.dataset.i], f = el.dataset.f, v = el.value.trim();
    if (f==='nm') w.nm = v || w.nm; else if (f==='kw') w.kw = kwParse(v);
    else if (f==='A' || f==='D') w[f] = /d/i.test(v) ? v.toUpperCase() : (parseFloat(v)||0);
    else if (f==='AP') w.AP = Math.abs(parseFloat(v)||0); else w[f] = parseFloat(v)||0;
    save(); route(); return;
  }
  if (el.dataset.t){
    const t = findTarget(el.dataset.t); if (!t) return; const f = el.dataset.f, v = el.value.trim();
    if (f==='kw') t.kw = v.toUpperCase(); else { const n=parseFloat(v); if (!isNaN(n) && n>=0) t[f] = (f==='N'||f==='W'||f==='pts') ? Math.max(1,n) : n; }
    save(); route();
  }
});
document.addEventListener('toggle', e=>{ if (e.target.classList && e.target.classList.contains('modwrap')) S.modOpen = e.target.open; }, true);
document.addEventListener('keydown', e=>{ if (e.key==='Escape' && S.rule){ S.rule=null; route(); } });

(function theme(){
  const KEY='kill-ledger:theme'; let mode='auto';
  try { mode = localStorage.getItem(KEY) || 'auto'; } catch(e){}
  const apply = ()=>{ if (mode==='auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', mode); $('#themebtn').textContent = 'Theme: '+mode; };
  apply();
  $('#themebtn').addEventListener('click', ()=>{ mode = mode==='auto'?'light':(mode==='light'?'dark':'auto'); try{localStorage.setItem(KEY,mode);}catch(e){} apply(); });
})();
applyList(S.listId);
lastPath = location.hash.split('/vs/')[0];
route();

// ---------- lists and import ----------
function renderListPick(){
  const sel = $('#listpick'); if (!sel) return;
  const opts = Object.values(S.lists).map(L=>`<option value="${L.id}" ${L.id===S.listId?'selected':''}>${esc(L.meta.name)}${L.builtin?' (built-in)':''}</option>`).join('');
  sel.innerHTML = opts + `<option value="__import">Import a list…</option>`;
}
function renderTabsOnly(view){
  return `<nav class="tabs" aria-label="Views">
      <a href="#/" ${view==='matrix'?'aria-current="page"':''}>Damage matrix</a>
      <a href="#/rules" ${view==='rules'?'aria-current="page"':''}>Rules matrix</a>
      <a href="#/import" ${view==='import'?'aria-current="page"':''}>Import a list</a>
    </nav>`;
}
function ruleCounts(u, rules){
  let dmg=0, note=0, todo=0;
  for (const id of u.rules||[]){ const r = (rules&&rules[id]) || BASE_RULES[id]; if (!r) continue; if (r.dmg) dmg++; else if (r.todo) todo++; else note++; }
  return {dmg, note, todo};
}
function renderImport(){
  const p = S.pending;
  const lists = Object.values(S.lists).map(L=>{
    const pts = L.units.reduce((s,u)=>s+(u.pts||0),0);
    return `<tr><td><b>${esc(L.meta.name)}</b>${L.builtin?' <span class="hint">built-in</span>':''}${L.id===S.listId?' <span class="hint">open now</span>':''}</td><td>${L.units.length}</td><td>${pts}</td>
      <td class="l"><button class="btn" type="button" data-act="list-open" data-id="${L.id}">Open</button>${L.builtin?'':` <button class="btn ghost danger" type="button" data-act="list-delete" data-id="${L.id}">Delete</button>`}</td></tr>`;
  }).join('');
  let review = '';
  if (p){
    const total = p.units.reduce((s,u)=>s+(u.pts||0),0);
    const rows = p.units.map(u=>{
      const c = ruleCounts(u, p.rules);
      const grp = u.grp ? `${u.role==='Leader'?'leads':'led in'} ${esc(p.groups[u.grp].short)}` : '<span class="none">—</span>';
      const enh = u.enh ? `${esc(u.enh.nm)} <input class="ptsmini" data-enhpts="${u.id}" value="${u.enh.pts}" aria-label="Enhancement points"> pts` : '<span class="none">—</span>';
      return `<tr><td><b>${esc(u.nm)}</b><span class="um">${esc(u.kw.filter(k=>['CHARACTER','INFANTRY','VEHICLE','MONSTER','MOUNTED','BATTLELINE'].includes(k)).map(k=>k.toLowerCase()).join(', '))}</span></td>
        <td>${u.models}</td><td><input class="ptsmini" data-pts="${u.id}" value="${u.pts}" aria-label="Points for ${esc(u.nm)}"></td><td class="l">${grp}</td><td class="l">${enh}</td><td>${u.w.filter(w=>!w.off).length}</td>
        <td class="l">${c.dmg?`<span class="chip on demo">${c.dmg} counted</span>`:''}${c.todo?`<span class="chip todo demo">${c.todo} not modelled</span>`:''}${c.note?`<span class="chip note demo">${c.note} noted</span>`:''}</td></tr>`;
    }).join('');
    const st = p.stats;
    review = `<section class="imp-review">
      <h3 class="sh">Check it before saving</h3>
      <label class="impname">List name <input id="impname" value="${esc(p.meta.name)}"></label>
      <p class="lede">${st.units} units, ${st.models} models, ${total} pts. ${Object.keys(p.groups).length} attached units found. ${st.known} rules already in the library, ${st.newRules} new ones read from the file${st.todo?`, ${st.todo} of which look like they change damage`:''}.${p.armyRules.length?` Army and detachment rules: ${p.armyRules.map(id=>esc(BASE_RULES[id].nm)).join(', ')}.`:''}</p>
      ${p.warnings.length?`<ul class="warns">${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
      <div class="tbl-scroll"><table class="dt imp"><thead><tr><th>Unit</th><th>Models</th><th>Points</th><th class="l">Attached</th><th class="l">Enhancement</th><th>Weapons</th><th class="l">Rules</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="presets"><button class="btn primary" type="button" data-act="import-save">Save and open the matrix</button><button class="btn" type="button" data-act="import-cancel">Cancel</button></div>
    </section>`;
  }
  $('#view').innerHTML = `
    <div class="dhead"><div><h2>Import a list</h2><div class="meta">Roster files from 40k.app, NewRecruit or BattleScribe (.ros or .rosz). Stats, weapons, leaders and rule text come from the file.</div></div></div>
    <div class="impform">
      <label class="drop">Roster file<input type="file" id="impfile" accept=".ros,.rosz,application/xml,text/xml,application/zip"><span class="hint">${S.impFile?esc(S.impFile.name):'Choose a .ros or .rosz file'}</span></label>
      <label class="txt">Text export, optional<textarea id="imptext" rows="7" placeholder="Paste the 40k.app text export here for points, enhancement costs, detachments and wargear like Faolchú that roster files leave out.">${esc(S.impText||'')}</textarea></label>
      <div class="presets"><button class="btn primary" type="button" data-act="import-read" ${S.impFile?'':'disabled'}>Read the roster</button></div>
      ${S.importErr?`<p class="err">${esc(S.importErr)}</p>`:''}
    </div>
    ${review}
    <section class="mylists"><h3 class="sh">Your lists</h3><div class="tbl-scroll"><table class="dt"><thead><tr><th>List</th><th>Units</th><th>Points</th><th class="l"></th></tr></thead><tbody>${lists}</tbody></table></div></section>`;
}
async function doImport(){
  S.importErr = null;
  try {
    if (!S.impFile) throw new Error('Choose a roster file first.');
    const xml = await IMP.readFile(S.impFile);
    S.pending = IMP.parse(xml, S.impText||'');
  } catch(e){ S.pending = null; S.importErr = e.message || String(e); }
  route();
}
function saveImport(){
  const p = S.pending; if (!p) return;
  const id = 'L' + Date.now().toString(36);
  S.lists[id] = {id, meta:p.meta, groups:p.groups, armyRules:p.armyRules, rules:p.rules, base:clone(p.units), units:clone(p.units), gameSystem:p.gameSystem};
  S.pending = null; S.impFile = null; S.impText = '';
  applyList(id); save();
  location.hash = '#/';
}
document.addEventListener('input', e=>{ if (e.target.id==='imptext') S.impText = e.target.value; });
document.addEventListener('change', e=>{ if (e.target.id==='impfile'){ S.impFile = e.target.files[0] || null; S.pending = null; S.importErr = null; route(); } });
