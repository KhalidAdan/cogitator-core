// ===== Roster importer (.ros / .rosz from 40k.app, NewRecruit, BattleScribe) =====
const IMP = (function(){
  const kids = (el, name) => el ? [...el.children].filter(c=>c.localName===name) : [];
  const kid = (el, name) => kids(el, name)[0] || null;
  const clean = s => String(s||'').replace(/\*\*/g,'').replace(/\u2011|\u2010/g,'-').replace(/\s+/g,' ').trim();
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,'').replace(/\(upgrade\)/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const slug = s => norm(s).replace(/ /g,'-') || 'x';
  const SMALL = new Set(['a','an','and','as','at','but','by','for','in','of','on','or','the','to','vs','with']);
  // all-caps list names read better in title case; anything already mixed-case is left alone
  const titleCase = s => s !== s.toUpperCase() ? s : s.toLowerCase().split(' ').map((w,i)=>(i>0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase()+w.slice(1)).join(' ');

  // ---------- weapon profile ----------
  function parseKw(str){
    const kw = {}, other = [];
    for (let t0 of String(str||'').split(',').map(x=>x.trim()).filter(Boolean)){
      // "SUSTAINED HITS 1: non-MONSTER/VEHICLE" only applies against (or not against) those keywords
      let t = t0, cond = null;
      const ci = t0.indexOf(':');
      if (ci > 0){ t = t0.slice(0,ci).trim(); const c = t0.slice(ci+1).trim(); const neg = /^non-/i.test(c); const list = c.replace(/^non-/i,'').split(/[\/,]/).map(s=>s.trim().toUpperCase()).filter(Boolean); cond = neg ? {not:list} : {only:list}; }
      const l = t.toLowerCase(); let m;
      const before = JSON.stringify(kw);
      if (l==='assault' || l==='-' || l==='–' || l==='—' || l==='none') continue;
      else if (l==='pistol' || l==='close-quarters' || l==='close quarters') kw.pistol = 1;
      else if ((m = l.match(/^blast(?: (\d+|d3))?$/))) kw.blast = m[1] ? (m[1]==='d3' ? 2 : +m[1]) : 1;
      else if ((m = l.match(/^cleave (\d+|d3)/))) kw.cleave = m[1]==='d3' ? 2 : +m[1];
      else if (l==='one shot') kw.oneshot = 1;
      else if ((m = l.match(/^rapid fire (\d+)/))) kw.rf = +m[1];
      else if ((m = l.match(/^sustained hits (\d+|d3)/))) kw.sus = m[1]==='d3' ? 2 : +m[1];
      else if (l==='lethal hits') kw.lethal = 1;
      else if (l==='devastating wounds') kw.dev = 1;
      else if (l==='twin-linked') kw.tl = 1;
      else if (l==='torrent') kw.torrent = 1;
      else if ((m = l.match(/^melta (\d+)/))) kw.melta = +m[1];
      else if (l==='heavy') kw.heavy = 1;
      else if (l==='lance') kw.lance = 1;
      else if (l==='ignores cover') kw.ic = 1;
      else if (l==='precision') kw.precision = 1;
      else if (l==='psychic') kw.psychic = 1;
      else if (l==='hazardous') kw.hazardous = 1;
      else if (l==='extra attacks') kw.extra = 1;
      else if (l==='indirect fire') kw.indirect = 1;
      else if ((m = l.match(/^anti-(.+?) (\d)\+$/))) kw.anti = [m[1].toUpperCase(), +m[2]];
      else other.push(t0);
      if (cond){ const added = Object.keys(kw).filter(k=>!(k in JSON.parse(before))); if (added.length){ kw.when = kw.when || {}; added.forEach(k=>kw.when[k] = cond); } }
    }
    if (other.length) kw.other = other;
    return kw;
  }
  const num = v => { const n = parseInt(String(v).replace(/[^\d-]/g,''),10); return isNaN(n) ? 0 : n; };
  const dice = v => { const s = String(v||'').trim().toUpperCase(); return /D/.test(s) ? s.replace(/\s+/g,'') : (parseFloat(s)||0); };
  function weaponFromProfile(p, count){
    const ch = {}; p.querySelectorAll('characteristic').forEach(c=>ch[c.getAttribute('name')] = (c.textContent||'').trim());
    const melee = p.getAttribute('typeName')==='Melee Weapons' || /^melee$/i.test(ch.Range||'');
    const kw = parseKw(ch.Keywords);
    const skill = ch[melee?'WS':'BS'] || '';
    return { nm: clean(p.getAttribute('name')), t: melee?'m':'r', n: count, A: dice(ch.A), sk: /n\/a/i.test(skill) || kw.torrent ? 0 : num(skill), S: num(ch.S), AP: Math.abs(num(ch.AP)), D: dice(ch.D), kw, range: ch.Range||'' };
  }
  const profKey = w => JSON.stringify([w.nm, w.t, w.A, w.sk, w.S, w.AP, w.D, w.kw]);
  const avgD = x => typeof x==='number' ? x : (()=>{ const m = String(x).match(/^(\d*)D(\d+)(?:\+(\d+))?$/); return m ? (m[1]?+m[1]:1)*(+m[2]+1)/2 + (m[3]?+m[3]:0) : 0; })();
  // y is at least as good as x in every number, and has every keyword x has
  function dominates(y, x){
    if (avgD(y.A) < avgD(x.A) || y.sk > x.sk || y.S < x.S || y.AP < x.AP || avgD(y.D) < avgD(x.D)) return false;
    const kx = Object.keys(x.kw||{}).filter(k=>k!=='other'), ky = Object.keys(y.kw||{});
    return kx.every(k=>ky.includes(k)) && !(x.kw.other||[]).length;
  }

  // ---------- model groups ----------
  function collectWeapons(sel, out){
    for (const s of kids(kid(sel,'selections'),'selection')){
      if (s.getAttribute('type')==='model') continue;
      const n = +s.getAttribute('number') || 1;
      const profs = kids(kid(s,'profiles'),'profile').filter(p=>/Weapons$/.test(p.getAttribute('typeName')||''));
      profs.forEach(p=>out.push({w: weaponFromProfile(p, n), upg: clean(s.getAttribute('name')), multi: profs.length>1}));
      collectWeapons(s, out);
    }
    return out;
  }
  function modelGroups(top){
    const groups = [];
    if (top.getAttribute('type')==='model') groups.push({n:+top.getAttribute('number')||1, nm:clean(top.getAttribute('name')), items:collectWeapons(top, []), prof:unitProfile(top)});
    for (const s of kids(kid(top,'selections'),'selection')){
      if (s.getAttribute('type')==='model') groups.push({n:+s.getAttribute('number')||1, nm:clean(s.getAttribute('name')), items:collectWeapons(s, []), prof:unitProfile(s)});
    }
    if (top.getAttribute('type')!=='model'){ // weapons hanging off the unit itself rather than a model
      const loose = collectWeapons(top, []);
      if (loose.length) groups.push({n:0, nm:'unit wargear', items:loose, prof:unitProfile(top)});
    }
    return groups;
  }
  function unitProfile(sel){
    const p = kids(kid(sel,'profiles'),'profile').find(p=>p.getAttribute('typeName')==='Unit');
    if (!p) return null;
    const ch = {}; p.querySelectorAll('characteristic').forEach(c=>ch[c.getAttribute('name')] = (c.textContent||'').trim());
    return {T:num(ch.T), Sv:num(ch.SV), W:num(ch.W), M:ch.M, Ld:ch.LD, OC:ch.OC};
  }

  // ---------- rules ----------
  const STRUCTURAL = new Set(['attached to','led by','supported by','leader','support','invulnerable save','battle focus']);
  const CORE = ['scouts','stealth','deep strike','lone operative','infiltrators','deadly demise','fights first','feel no pain','firing deck','hover','leader','scout'];
  function libraryIndex(){ const m = {}; for (const [id,r] of Object.entries(BASE_RULES)) m[norm(r.nm)] = id; return m; }
  // "Damaged 4", "Deadly Demise D3", "Scouts 7"" → the name without its number
  const baseName = k => k.replace(/ (d?\d+|x)$/,'').replace(/ once per .*$/,'').trim();
  function looksOffensive(txt){
    const t = txt.toLowerCase();
    const terms = /hit roll|wound roll|strength characteristic|armour penetration|damage characteristic|re-?roll|\[(lethal|sustained|devastating|anti|twin|ignores|lance|precision|torrent|blast|melta|rapid)|critical (hit|wound)|attacks characteristic|mortal wound/.test(t);
    const ours = /makes an attack|makes a ranged attack|makes a melee attack|weapons equipped by|attacks? made by/.test(t);
    const theirs = /an attack targets (this|that) (unit|model)|attack (is )?allocated to|targets this unit|targets this model/.test(t);
    return terms && ours && !theirs;
  }

  // ---------- text export (points, enhancements, wargear names, detachments) ----------
  function parseText(text){
    const out = {name:'', faction:'', detachments:[], mission:'', units:{}, order:[], entries:[]};
    if (!text || !text.trim()) return out;
    const lines = text.replace(/\r/g,'').split('\n');
    const head = lines.filter(l=>l.trim()).slice(0,4);
    out.name = (head[0]||'').trim();
    const parts = (head[1]||'').split(/\s*[·•|]\s*/).map(s=>s.trim()).filter(Boolean);
    if (parts.length){ out.faction = parts[0]; out.detachments = parts.slice(1); }
    const mis = lines.find(l=>/^\s*Mission:/i.test(l)); if (mis) out.mission = mis.replace(/^\s*Mission:\s*/i,'').trim();
    let cur = null, curIndent = 0, section = '';
    for (const l of lines){
      const sec = l.match(/^(\S.*?) \[(\d+) pts\]\s*$/);
      if (sec){ section = sec[1].trim(); cur = null; continue; }
      const m = l.match(/^(\s+)(.+?) \[(\d+) pts\](?: \((\d+) models?\))?(?:\s*-\s*(.+?))?\s*$/);
      if (m){ cur = {nm:m[2].trim(), pts:+m[3], models:m[4]?+m[4]:null, enh:null, gear:'', tag:m[5]||'', section, idx:out.entries.length};
        curIndent = m[1].length; out.entries.push(cur); if (!out.units[norm(cur.nm)]) out.units[norm(cur.nm)] = cur; out.order.push(norm(cur.nm)); continue; }
      if (cur && /^\s/.test(l) && (l.match(/^\s*/)[0].length > curIndent)){
        const e = l.match(/Enhancement:\s*(.+?)\s*\(\+(\d+) pts\)/);
        if (e) cur.enh = {nm:e[1].trim(), pts:+e[2]}; else cur.gear += ' ' + l.trim();
      } else if (!/^\s/.test(l)) cur = null;
    }
    return out;
  }

  // ---------- main ----------
  function parse(xmlText, exportText){
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That file isn’t valid roster XML.');
    const roster = doc.documentElement;
    if (roster.localName!=='roster') throw new Error('No <roster> found. Is this a BattleScribe/NewRecruit/40k.app roster?');
    const txt = parseText(exportText);
    const lib = libraryIndex();
    const warnings = [], rules = {}, units = [], armyFound = new Set();
    const tops = [];
    for (const f of roster.getElementsByTagNameNS('*','force')) for (const s of kids(kid(f,'selections'),'selection')){
      const t = s.getAttribute('type');
      if (t==='unit' || t==='model') tops.push(s);
    }
    const ids = new Set();
    for (const top of tops){
      const nm = clean(top.getAttribute('name'));
      let id = slug(nm); while (ids.has(id)) id += '-2'; ids.add(id);
      const cats = [...top.getElementsByTagNameNS('*','category')].map(c=>c.getAttribute('name')).filter(c=>c && !/^Faction:/i.test(c));
      const kw = [...new Set(cats.map(c=>c.toUpperCase()))];
      const isVM = kw.includes('VEHICLE') || kw.includes('MONSTER');
      // abilities
      const abil = kids(kid(top,'profiles'),'profile').filter(p=>p.getAttribute('typeName')==='Abilities').map(p=>({nm:clean(p.getAttribute('name')), txt:clean([...p.querySelectorAll('characteristic')].map(c=>c.textContent).join(' '))}));
      const get = n => abil.find(a=>a.nm.toLowerCase()===n);
      const unitRules = []; let enh = null;
      for (const a of abil){
        let name = a.nm, src = 'Datasheet';
        if (/^enhancement:/i.test(name)){ name = name.replace(/^enhancement:\s*/i,''); src = 'Enhancement'; }
        const key = norm(name);
        if (src!=='Enhancement' && STRUCTURAL.has(key)) continue;
        let rid = lib[key] || lib[baseName(key)];
        if (rid && BASE_RULES[rid].src==='Army rule'){ armyFound.add(rid); continue; }
        if (!rid){
          rid = 'imp-' + slug(name);
          if (!rules[rid]){
            const core = CORE.some(c=>key.startsWith(c));
            const leader = /while this model is leading a unit/i.test(a.txt);
            const body = (a.txt && a.txt.trim()!=='-') ? a.txt : '(no text in the roster file)';
            rules[rid] = {nm:name, src: src==='Enhancement' ? 'Enhancement' : core ? 'Core' : leader ? 'Leader' : 'Datasheet', dmg:false, txt:body, imported:true,
              scope: /leading a unit|a model in this unit|models in this unit/i.test(a.txt) ? 'unit' : undefined, todo: !core && looksOffensive(a.txt)};
          }
        }
        if (src==='Enhancement') enh = {id:rid, nm:name, pts:0};
        if (!unitRules.includes(rid)) unitRules.push(rid);
      }
      // weapons: per model group, then merge
      let groups = modelGroups(top).filter(g=>g.items.length || g.prof);
      // merge groups with identical loadouts
      const merged = [];
      for (const g of groups){
        const sig = JSON.stringify(g.items.map(i=>profKey(i.w)).sort());
        const same = merged.find(m=>m.sig===sig);
        if (same){ same.n += g.n; same.items.forEach((it,ix)=>{ const o = g.items.find(x=>profKey(x.w)===profKey(it.w)); if (o) it.w.n += o.w.n; }); }
        else merged.push(Object.assign({}, g, {sig}));
      }
      const w = [];
      merged.forEach((g, gi)=>{
        const items = g.items.map(i=>Object.assign({}, i, {w:Object.assign({}, i.w)}));
        // one weapon with several profiles, or "Name - profile" siblings: pick one per attack
        const byBase = {};
        items.forEach(i=>{ const base = i.multi ? i.upg : (i.w.nm.includes(' - ') ? i.w.nm.split(' - ')[0] : null); if (base) (byBase[base] = byBase[base]||[]).push(i); });
        for (const [base, list] of Object.entries(byBase)) if (list.length>1) list.forEach(i=>i.w.alt = `p${gi}:${slug(base)}`);
        // pistol rule
        const ranged = items.filter(i=>i.w.t==='r');
        if (!isVM && ranged.some(i=>!i.w.kw.pistol) ) ranged.filter(i=>i.w.kw.pistol).forEach(i=>i.w.off = 'Fires its other guns instead (pistol rule)');
        // melee: drop weapons that another option beats outright, then pick per target
        let melee = items.filter(i=>i.w.t==='m' && !i.w.kw.extra && !i.w.alt);
        melee = melee.filter(i=>!melee.some(j=>j!==i && dominates(j.w, i.w) && profKey(j.w)!==profKey(i.w)));
        if (melee.length>1) melee.forEach(i=>i.w.alt = `m${gi}:melee`);
        items.forEach(i=>{ if (i.w.t==='m' && !i.w.kw.extra && !i.w.alt && !melee.includes(i)) i.drop = true; });
        items.filter(i=>!i.drop).forEach(i=>w.push(i.w));
      });
      // merge identical rows that aren't choices
      const rows = [];
      for (const x of w){
        const same = !x.alt && rows.find(r=>!r.alt && profKey(r)===profKey(x) && (r.off||'')===(x.off||''));
        if (same) same.n += x.n; else rows.push(x);
      }
      rows.forEach(r=>{ delete r.range; });
      rows.sort((a,b)=>(a.t===b.t?0:(a.t==='r'?-1:1)) || (a.off?1:0)-(b.off?1:0));
      const models = groups.reduce((s,g)=>s+g.n,0) || 1;
      const prof = (groups.find(g=>g.prof)||{}).prof || null;
      const inv = get('invulnerable save'); 
      const u = { id, nm, pts:0, models, kw, rules:unitRules, w:rows, grp:null, role:null, cat:null,
        stats: prof ? Object.assign({}, prof, {inv: inv ? num(inv.txt) : 0, invRangedOnly: inv ? /ranged attacks only/i.test(inv.txt) : false}) : null,
        _attachedTo: (get('attached to')||{}).txt || null, _ledBy: (get('led by')||get('supported by')||{}).txt || null, _support: !!get('support') && !get('leader') };
      if (enh) u.enh = enh;
      units.push(u);
    }

    // points, enhancement costs and wargear from the text export
    // match roster units to text-export entries: unique exact names first, then by the attached-unit section
    // their leader sits in (text exports repeat names like "Outrider Squad"), then by name without an A/B letter
    const used = new Set(), match = new Map(), fuzzy = new Set();
    const E = txt.entries || [];
    const take = (u, e) => { match.set(u, e); used.add(e.idx); };
    const baseN = s => norm(s).replace(/ [a-z]$/,'');
    for (const u of units){ const c = E.filter(e=>!used.has(e.idx) && norm(e.nm)===norm(u.nm)); if (c.length===1) take(u, c[0]); }
    for (const u of units){
      if (match.has(u)) continue;
      const partners = [u._ledBy, u._attachedTo].filter(Boolean).map(n=>units.find(x=>norm(x.nm)===norm(n))).filter(Boolean);
      const lead = units.filter(x=>x._attachedTo && norm(x._attachedTo)===norm(u.nm));
      const secs = new Set([...partners, ...lead].map(x=>match.get(x)).filter(Boolean).map(e=>e.section));
      const c = E.filter(e=>!used.has(e.idx) && secs.has(e.section) && baseN(e.nm)===baseN(u.nm));
      if (c.length) take(u, c.find(e=>e.models===u.models) || c[0]);
    }
    for (const u of units){
      if (match.has(u)) continue;
      const c = E.filter(e=>!used.has(e.idx) && baseN(e.nm)===baseN(u.nm));
      const pick = c.find(e=>e.models===u.models) || c[0];
      if (pick){ take(u, pick); fuzzy.add(u); }
    }
    for (const u of units){
      const t = match.get(u);
      if (!t){ if (Object.keys(txt.units).length) warnings.push(`${u.nm}: not found in the text export, so it has no points yet.`); continue; }
      if (fuzzy.has(u)) warnings.push(`${u.nm} matched to “${t.nm}” in the text export (${t.pts} pts) by name only. Check that’s the right one.`);
      if (/warlord/i.test(t.tag||'')) u.warlord = true;
      u.pts = t.pts;
      if (t.enh){ if (u.enh) u.enh.pts = t.enh.pts; else warnings.push(`${u.nm}: the text export lists ${t.enh.nm}, but the roster file doesn’t.`); }
      const gear = norm(t.gear);
      for (const [id, r] of Object.entries(BASE_RULES)) if (r.src==='Wargear' && gear.includes(norm(r.nm)) && !u.rules.includes(id)) u.rules.push(id);
    }
    const unmatched = E.filter(e=>!used.has(e.idx));
    if (unmatched.length) warnings.push(`In the text export but not the roster file: ${unmatched.map(e=>e.nm).join(', ')}.`);
    if (!Object.keys(txt.units).length) warnings.push('No text export, so every unit starts at 0 pts. Add points below before saving.');
    // rules that grant other rules (e.g. Spirit Mark → Wraith Constructs)
    const all = new Set(units.flatMap(u=>u.rules));
    for (const id of all){ const g = (BASE_RULES[id]||{}).grants; if (g) units.forEach(u=>{ if (u.kw.includes(g.kw) && !u.rules.includes(g.rule)) u.rules.push(g.rule); }); }

    // leaders
    const byName = n => units.find(u=>norm(u.nm)===norm(n));
    const groups = {}; const order = [];
    for (const u of units){
      if (!u._attachedTo) continue;
      const bg = byName(u._attachedTo);
      if (!bg){ warnings.push(`${u.nm} is attached to “${u._attachedTo}”, which isn’t in the roster.`); continue; }
      let key = bg.id;
      if (!groups[key]){ groups[key] = {bg, leaders:[]}; order.push(key); }
      groups[key].leaders.push(u);
    }
    const pos = u => { const e = match.get(u); return e ? e.idx : 999 + units.indexOf(u); };
    order.sort((a,b)=>Math.min(...groups[a].leaders.map(pos), pos(groups[a].bg)) - Math.min(...groups[b].leaders.map(pos), pos(groups[b].bg)));
    const short = n => n.replace(/^Corsair /,'').replace(/^Prince /,'');
    const G = {};
    order.forEach((k, i)=>{
      const L = String.fromCharCode(65+i), g = groups[k];
      G[L] = {nm:`Attached unit ${L}`, short: [...g.leaders.map(l=>short(l.nm)), short(g.bg.nm)].join(' + ')};
      g.leaders.forEach(l=>{ l.grp = L; l.role = l._support ? 'Support' : 'Leader'; });
      g.bg.grp = L; g.bg.role = 'Bodyguard';
    });
    // sections for everything else
    const SEC = ['Characters','Battleline','Dedicated transport','Infantry','Mounted','Beasts and swarms','Vehicles and monsters','Other'];
    for (const u of units){
      const k = u.kw;
      u.cat = k.includes('CHARACTER') ? 'Characters' : k.includes('BATTLELINE') ? 'Battleline' : k.includes('DEDICATED TRANSPORT') ? 'Dedicated transport'
        : (k.includes('VEHICLE')||k.includes('MONSTER')) ? 'Vehicles and monsters' : k.includes('MOUNTED') ? 'Mounted' : k.includes('INFANTRY') ? 'Infantry' : (k.includes('BEASTS')||k.includes('SWARM')) ? 'Beasts and swarms' : 'Other';
      if (u.grp && u.role!=='Bodyguard' && !u.kw.includes('CHARACTER')) u.cat = 'Characters';
      if (u._ledBy && !u.grp) warnings.push(`${u.nm} says it’s led by ${u._ledBy}, but that leader doesn’t point back to it.`);
      delete u._attachedTo; delete u._ledBy; delete u._support;
    }
    units.sort((a,b)=>{
      if (a.grp || b.grp){ if (!a.grp) return 1; if (!b.grp) return -1; if (a.grp!==b.grp) return a.grp<b.grp?-1:1; const o = {Leader:0, Support:1, Bodyguard:2}; return o[a.role]-o[b.role]; }
      return SEC.indexOf(a.cat)-SEC.indexOf(b.cat) || pos(a)-pos(b);
    });

    // army and detachment rules we know about
    const army = [];
    const facKey = norm(txt.faction || (roster.querySelector('force')||{getAttribute:()=>''}).getAttribute('catalogueName'));
    (FACTION_ARMY_RULES[facKey]||[]).forEach(id=>army.push(id));
    armyFound.forEach(id=>{ if (!army.includes(id)) army.push(id); });
    const dets = txt.detachments.length ? txt.detachments : [];
    const unknownDets = [];
    dets.forEach(d=>{ const r = DETACHMENT_RULES[norm(d)]; if (r) r.forEach(id=>{ if (!army.includes(id)) army.push(id); }); else unknownDets.push(d); });

    const force = roster.getElementsByTagNameNS('*','force')[0];
    const meta = {
      name: titleCase(txt.name || clean(roster.getAttribute('name')) || 'Imported list'),
      faction: txt.faction || (force && force.getAttribute('catalogueName')) || '',
      detachments: dets, mission: txt.mission,
    };
    meta.sub = [meta.faction, dets.join(' and '), meta.mission].filter(Boolean).join(', ') + '. Imported from a roster file.';
    const stats = {
      units: units.length, models: units.reduce((s,u)=>s+u.models,0), weapons: units.reduce((s,u)=>s+u.w.length,0),
      known: [...new Set(units.flatMap(u=>u.rules).concat(army))].filter(id=>BASE_RULES[id]).length,
      newRules: Object.keys(rules).length, todo: Object.values(rules).filter(r=>r.todo).length, unknownDets,
    };
    // detachment rules that hand a named unit an extra ability (e.g. Wrath of the First Khan)
    army.forEach(id=>(DETACHMENT_UNIT_GRANTS[id]||[]).forEach(g=>units.forEach(u=>{ if (norm(u.nm).includes(g.name) && !u.rules.includes(g.rule)) u.rules.push(g.rule); })));
    if (unknownDets.length) warnings.push(`No rules library yet for ${unknownDets.join(' or ')}. Its detachment rules won’t show until we add them.`);
    return {meta, units, groups:G, armyRules:army, rules, warnings, stats, gameSystem: roster.getAttribute('gameSystemName')||''};
  }

  async function readFile(file){
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0,4));
    const isZip = head[0]===0x50 && head[1]===0x4b;
    if (!isZip) return new TextDecoder('utf-8').decode(buf);
    if (typeof JSZip==='undefined') throw new Error('Couldn’t load the unzip library for .rosz files. Export as .ros instead, or try again online.');
    const zip = await JSZip.loadAsync(buf);
    const entry = Object.values(zip.files).find(f=>!f.dir && /\.ros$/i.test(f.name)) || Object.values(zip.files).find(f=>!f.dir);
    if (!entry) throw new Error('The .rosz archive is empty.');
    return entry.async('string');
  }
  return {parse, readFile, parseText, parseKw};
})();
