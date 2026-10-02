// ===== Data: "The Burning One and the Exile" =====
// Weapon keys: A, sk (BS/WS, 0 for torrent), S, AP (positive), D. kw flags as in the engine.
// alt: weapons sharing an alt id are one weapon with several profiles; the engine fires the better one.
// off: carried but not used (pistol rule etc.)

const BUILTIN_META = {
  name: 'The Burning One and the Exile',
  sub: '2,000 pts, Corsair Coterie and Path of the Outcast, Priority Assets. 11th edition faction pack profiles.',
};

// ---------- Rules library ----------
// dmg: true = changes damage dealt, so the engine models it (fx), false = shown in the rules matrix only.
// scope: 'unit' = applies to every model in the attached unit (leader and bodyguard), 'self' = this datasheet only.
// mark: rules that mark an enemy unit; their switch lives with the target marks.
const BASE_RULES = {
  // army and detachments
  'battle-focus':   {nm:'Battle Focus', src:'Army rule', dmg:false, txt:'Spend Battle Focus tokens for Agile Manoeuvres: extra move, longer pile-ins, Fade Back and similar repositioning.'},
  'relentless':     {nm:'Relentless Raiders', src:'Corsair Coterie', dmg:false, txt:'While you control an objective, an enemy unit that ends a Normal, Advance, Fall Back or Charge move on it takes D3 mortal wounds on a 2+. Triggered by enemy movement, not by your attacks, so it sits outside the matrix.'},
  'void-thieves':   {nm:'Void Thieves', src:'Corsair Coterie', dmg:false, txt:'Anhrathe units keep an objective under your control after they leave it, until the opponent’s level of control is higher at the end of a phase.'},
  'veterans':       {nm:'Veterans of the Void', src:'Corsair Coterie', dmg:false, txt:'Each Anhrathe unit may take one unique Corsair Enhancement for points.'},
  'far-reaching':   {nm:'Far-Reaching Doom', src:'Path of the Outcast', dmg:false, txt:'When Rangers or Shroud Runners shoot, enemy units have +6" detection range until they have shot.'},
  // enhancements
  'archraider':     {nm:'Archraider', src:'Enhancement', dmg:false, txt:'Lord of Deceit (Aura): once per turn, an enemy Stratagem used on a unit within 12" costs 1CP more.'},
  'voidstone':      {nm:'Voidstone', src:'Enhancement', dmg:false, txt:'Models in the unit have a 5+ invulnerable save.'},
  'assassins-eye':  {nm:'Assassins’ Eye', src:'Enhancement', dmg:true, def:true, cond:'char', condNm:'Target is a Character unit', txt:'Ranged attacks that target a Character unit get +1 AP. None of the 19 benchmark targets is a Character, so it sits idle until you switch on “Target is a Character unit”. With that on, every target is treated as a unit with a Character in it.', fx:{apRanged:1}},
  'camo-snipers':   {nm:'Camouflaged Snipers', src:'Enhancement', dmg:false, txt:'This unit’s ranged attacks don’t stop it from being hidden.'},
  // leader abilities
  'burning-lance':  {nm:'Burning Lance', src:'Leader', scope:'unit', dmg:false, txt:'While leading, Melta weapons in the unit get +6" range. That makes the “within half range” switch realistic for the Dragons; it doesn’t change the dice.'},
  'unquenchable':   {nm:'Unquenchable Resolve', src:'Datasheet', dmg:false, txt:'The first time Fuegan is destroyed, he stands back up with full wounds on a 2+.'},
  'fury-void':      {nm:'Fury of the Void', src:'Datasheet', dmg:true, mark:'riven', txt:'After Kharseth’s unit shoots, an enemy unit hit by Dread of the Deep Void is riven: every Aeldari attack against it gets +1 Strength until end of turn.'},
  'aethersense':    {nm:'Aethersense', src:'Datasheet', dmg:false, txt:'Enemy units arriving from Reserves can’t be set up within 12" of Kharseth.'},
  'whispering-web': {nm:'Whispering Web', src:'Datasheet', dmg:true, mark:'web', txt:'After Lhykhis shoots, an enemy unit she hit is webbed: Aeldari attacks against it score critical hits on unmodified 5+.'},
  'empyric-ambush': {nm:'Empyric Ambush', src:'Leader', scope:'unit', dmg:false, txt:'While leading, the Warp Spiders can charge after using Flickerjump.'},
  'piratical-hero': {nm:'Piratical Hero', src:'Leader', scope:'unit', dmg:true, def:true, txt:'While Yriel leads a unit, every attack made by a model in it (Yriel included) has Sustained Hits 1 and adds 1 to the hit roll. On a 2+ weapon the +1 changes nothing, because an unmodified 1 always misses; the Sustained Hits still adds an extra hit on every 6.', fx:{hit:1, sus:1}},
  'prince-corsairs':{nm:'Prince of Corsairs', src:'Datasheet', dmg:false, txt:'After deployment, redeploy up to three Aeldari units, into Strategic Reserves if you like.'},
  // unit abilities
  'assured':        {nm:'Assured Destruction', src:'Datasheet', scope:'unit', dmg:true, def:true, txt:'In the Shooting phase, ranged attacks against Monster or Vehicle units can re-roll the hit, the wound and the damage roll. Fuegan benefits while he leads them.', fx:{assured:1}},
  'reavers':        {nm:'Reavers of the Void', src:'Datasheet', scope:'unit', dmg:true, def:true, txt:'Re-roll hit rolls of 1; re-roll any hit roll if the target is within range of an objective (switch “Target is on an objective”). Kharseth benefits while he leads them.', fx:{reavers:1}},
  'raiders':        {nm:'Piratical Raiders', src:'Datasheet', scope:'unit', dmg:true, mark:'quarry', txt:'Pick one enemy unit at the start of the battle. Weapons in this unit have Lethal Hits and Precision against it. Yriel benefits while he leads them.'},
  'flickerjump':    {nm:'Flickerjump', src:'Datasheet', dmg:false, txt:'Normal move becomes 24", no charge that turn, mortal wound on each 1 rolled per model.'},
  'guide':          {nm:'Guide', src:'Datasheet', dmg:true, mark:'guide', txt:'End of your Movement phase: pick an enemy unit within 18". Every Aeldari attack against it gets +1 to hit.'},
  'branching':      {nm:'Branching Fates', src:'Leader', dmg:false, txt:'While leading, once per phase turn one hit, wound or damage roll into a 6. Your Farseer isn’t leading anything here, so it’s idle.'},
  'spirit-mark':    {nm:'Spirit Mark', src:'Datasheet', dmg:true, mark:'spiritmark', grants:{kw:'WRAITH CONSTRUCT', rule:'spirit-marked'}, txt:'Pick a Wraith Construct unit within 6" and an enemy unit: that Wraith unit gets Sustained Hits 1 against it.'},
  'spirit-marked':  {nm:'Spirit Mark (from Spiritseer)', src:'Received', dmg:true, mark:'spiritmark', txt:'When the Spiritseer marks the target, the Wraithblades get Sustained Hits 1 against it.', fx:{spiritRecipient:1}},
  'tears-isha':     {nm:'Tears of Isha', src:'Datasheet', dmg:false, txt:'Command phase: a nearby Wraith Construct unit returns a model or heals D3.'},
  'spiritseer-lo':  {nm:'Spiritseer', src:'Datasheet', dmg:false, txt:'Lone Operative while within 3" of a Wraith Construct unit.'},
  'psyguide':       {nm:'Psychic Guidance', src:'Datasheet', dmg:true, def:true, txt:'Within 12" of a friendly Aeldari Psyker: Leadership 6+ and +1 to hit. On by default since the Farseer and Spiritseer run with them.', fx:{hit:1}},
  'malevolent':     {nm:'Malevolent Souls', src:'Datasheet', dmg:false, txt:'A Wraithblade killed in melee before it fights gets to fight anyway on a 3+.'},
  'target-acq':     {nm:'Target Acquisition', src:'Datasheet', dmg:false, txt:'After shooting, an enemy unit hit by the long rifles loses the benefit of cover for the rest of the phase. In practice: switch “Target has cover” off for anyone shooting after them.'},
  'path-outcast':   {nm:'Path of the Outcast', src:'Datasheet', dmg:false, txt:'When an enemy ends a move within 8", the Rangers can make a D6" Normal move.'},
  'raid-run':       {nm:'Raid and Run', src:'Datasheet', dmg:false, txt:'End of the Fight phase: move or fall back D3+3".'},
  'serpent-shield': {nm:'Wave Serpent Shield', src:'Datasheet', dmg:false, txt:'Ranged attacks with Strength higher than its Toughness get −1 to wound.'},
  'hallucinogen':   {nm:'Hallucinogen Grenades', src:'Datasheet', dmg:false, txt:'Start of the opponent’s Shooting phase: give an Aeldari Infantry unit within 36" Stealth.'},
  // wargear
  'mistshield':     {nm:'Mistshield', src:'Wargear', dmg:false, txt:'The Felarch has a 4+ invulnerable save.'},
  'channeller':     {nm:'Channeller Stones', src:'Wargear', dmg:false, txt:'Once per turn the first failed save in the unit has its damage set to 0.'},
  'faolchu':        {nm:'Faolchú', src:'Wargear', scope:'unit', dmg:true, def:true, txt:'Ranged weapons in the bearer’s unit have Ignores Cover. Only matters when “Target has cover” is on.', fx:{ic:1}},
  'forceshield':    {nm:'Forceshield', src:'Wargear', dmg:false, txt:'4+ invulnerable save.'},
  'shrine-token':   {nm:'Aspect Shrine token', src:'Wargear', dmg:false, txt:'Once per battle, turn one hit or wound roll by a non-Character model into an unmodified 6. Too small and one-off to price into an average.'},
};


// ---------- Space Marines / White Scars (11th edition codex), added from an imported roster ----------
Object.assign(BASE_RULES, {
  'combat-doctrines':   {nm:'Combat Doctrines', src:'Army rule', dmg:false, txt:'Once per battle each, switch the army (or a unit) into a doctrine: Assault lets units advance and still charge, Devastator gives ranged attacks Assault, Tactical lets units fall back and still shoot or charge. All movement, so the matrix leaves it out.'},
  'full-throttle':      {nm:'Full-throttle Assault', src:'Datasheet', scope:'unit', dmg:true, def:true, cond:'charged', condNm:'Charged this turn', txt:'After charging, Thunder Hammers get +1 to hit and Sustained Hits 1, and every other melee weapon gets +1 Damage and Sustained Hits 1. The whole attached unit benefits.',
                         fx:[{phase:'melee', when:'charged', weapon:'thunder hammer', hit:1, grant:{sus:1}}, {phase:'melee', when:'charged', weaponNot:'thunder hammer', d:1, grant:{sus:1}}]},
  'shattered-defences': {nm:'Shattered Defences', src:'Datasheet', dmg:true, mark:'shattered', global:true, txt:'After the Thunderstrike shoots, a Monster or Vehicle it hit is marked: friendly Adeptus Astartes ranged attacks against it get +1 AP.', fx:{phase:'ranged', vs:{only:['MONSTER','VEHICLE']}, ap:1}},
  'thunderstrike':      {nm:'Thunderstrike', src:'Datasheet', dmg:true, def:true, txt:'Ranged attacks against Monster or Vehicle units get +1 to wound.', fx:{phase:'ranged', vs:{only:['MONSTER','VEHICLE']}, wound:1}},
  'damaged':            {nm:'Damaged', src:'Datasheet', dmg:false, txt:'While at or below the listed wounds, the model’s attacks get −1 to hit. The matrix assumes it’s healthy; set −1 Hit for it in the modifier bar if it isn’t.'},
  'bladeguard':         {nm:'Bladeguard', src:'Datasheet', scope:'unit', dmg:true, def:true, txt:'Once per turn in the Fight phase, pick +1 to hit for the unit’s melee attacks, or −1 to be hit. The matrix assumes you take the attack bonus.', fx:{phase:'melee', hit:1}},
  'furious-assault':    {nm:'Furious Assault', src:'Enhancement', scope:'unit', dmg:true, def:true, txt:'Melee attacks gain Sustained Hits 1 against anything that isn’t a Monster or Vehicle.', fx:{phase:'melee', vs:{not:['MONSTER','VEHICLE']}, grant:{sus:1}}},
  'spear-chogoris':     {nm:'Spear of Chogoris', src:'Leader', scope:'unit', dmg:false, txt:'Ranged attacks gain Assault, and advancing doesn’t stop the unit charging. Movement only.'},
  'trophy-taker':       {nm:'Trophy Taker', src:'Leader', scope:'unit', dmg:true, def:true, cond:'char', condNm:'Target is a Character unit', txt:'Against Character units, re-roll hit rolls of 1 and wound rolls of 1. The whole attached unit benefits.', fx:{rrHit:'ones', rrWound:'ones', when:'char'}},
  'for-the-khan':       {nm:'For the Khan!', src:'Leader', scope:'unit', dmg:true, def:true, txt:'Ranged attacks gain Assault and melee attacks gain Lance, so the unit gets +1 to wound on the charge.', fx:{phase:'melee', grant:{lance:1}}},
  'tactical-precision': {nm:'Tactical Precision', src:'Leader', scope:'unit', dmg:true, def:true, txt:'The unit’s attacks gain Lethal Hits against anything that isn’t a Monster or Vehicle.', fx:{vs:{not:['MONSTER','VEHICLE']}, grant:{lethal:1}}},
  'hunters-eye':        {nm:'Hunter’s Eye', src:'Enhancement', scope:'unit', dmg:true, def:true, txt:'The unit’s ranged attacks gain Ignores Cover and Sustained Hits 1.', fx:{phase:'ranged', grant:{sus:1, ic:1}}},
  'deeds-of-legend':    {nm:'Deeds of Legend', src:'Leader', scope:'unit', dmg:true, def:true, cond:'selfObj', condNm:'Your unit is on an objective', txt:'While the unit is within range of an objective, its melee attacks get +1 Attack.', fx:{phase:'melee', when:'selfObj', a:1}},
  'imperiums-sword':    {nm:'Imperium’s Sword', src:'Enhancement', dmg:false, txt:'Gives the bearer an extra weapon. Its profile comes in with the roster file, so it’s already in the loadout.'},
  'litany-of-hate':     {nm:'Litany of Hate', src:'Leader', scope:'unit', dmg:true, def:true, txt:'Melee attacks gain Lance, so the unit gets +1 to wound on the charge.', fx:{phase:'melee', grant:{lance:1}}},
  'catechism-of-fire':  {nm:'Catechism of Fire', src:'Leader', scope:'unit', dmg:true, def:true, txt:'When the unit shoots, pick a visible enemy: ranged attacks against it gain Devastating Wounds. The matrix assumes you pick the unit you’re shooting.', fx:{phase:'ranged', grant:{dev:1}}},
  'spearpoint-paragon': {nm:'Spearpoint Paragon', src:'Enhancement', scope:'self', dmg:true, def:true, txt:'The bearer’s own melee attacks get +1 Strength and +1 AP, or +2 of each if it charged this turn.', fx:[{phase:'melee', whenNot:'charged', s:1, ap:1}, {phase:'melee', when:'charged', s:2, ap:2}]},
  'hailstrike':         {nm:'Hailstrike', src:'Datasheet', dmg:true, mark:'hailstrike', global:true, txt:'After the Hailstrike shoots, a unit it hit is marked: friendly Adeptus Astartes ranged attacks against it ignore cover.', fx:{phase:'ranged', grant:{ic:1}}},
  'into-the-fray':      {nm:'Into the Fray', src:'Leader', scope:'unit', dmg:true, def:true, cond:'charged', condNm:'Charged this turn', txt:'After charging, melee attacks gain Cleave 1: +1 attack for every five models in the target unit.', fx:{phase:'melee', when:'charged', grant:{cleave:1}}},
  'spearpoint-tf':      {nm:'Spearpoint Task Force', src:'Detachment', dmg:false, txt:'Detachment rule: select the Assault or Tactical Doctrine one extra time per battle; friendly Mounted and Speeder units get +1 to Advance rolls; Suboden Khan’s unit gains Wrath of the First Khan. White Scars only. Movement only, so the matrix leaves it out.'},
  'assault-brethren':   {nm:'Assault Brethren', src:'Detachment', dmg:false, txt:'Detachment rule: select the Assault Doctrine one extra time per battle. With Spearpoint Task Force as well, you have enough doctrine uses to keep one active every battle round.'},
  'wrath-first-khan':   {nm:'Wrath of the First Khan', src:'Detachment', scope:'unit', dmg:false, txt:'From Spearpoint Task Force. At the end of the Fight phase, if Suboden’s unit was eligible to fight, it can make a Normal move if unengaged or Fall Back if engaged. That frees it to charge again next turn, which is when its charge bonuses (Full-throttle Assault, Lance) apply.'},
  'targeted-intercession': {nm:'Targeted Intercession', src:'Datasheet', scope:'unit', dmg:true, def:true, cond:'charged', condNm:'Charged this turn', txt:'After charging, melee attacks get +1 Strength and +1 AP.', fx:{phase:'melee', when:'charged', s:1, ap:1}},
});

const BUILTIN_ARMY_RULES = ['battle-focus','relentless','void-thieves','veterans','far-reaching'];
// army rules by faction and detachment, used when importing a roster
const FACTION_ARMY_RULES = {aeldari:['battle-focus'], asuryani:['battle-focus'],
  'space marines':['combat-doctrines'], 'adeptus astartes':['combat-doctrines'], 'white scars':['combat-doctrines'], 'ultramarines':['combat-doctrines'], 'imperial fists':['combat-doctrines'],
  'iron hands':['combat-doctrines'], 'raven guard':['combat-doctrines'], 'salamanders':['combat-doctrines'], 'blood angels':['combat-doctrines'], 'dark angels':['combat-doctrines'], 'space wolves':['combat-doctrines']};
const DETACHMENT_RULES = {'corsair coterie':['relentless','void-thieves','veterans'], 'path of the outcast':['far-reaching'],
  'spearpoint task force':['spearpoint-tf'], 'assault brethren':['assault-brethren']};
const DETACHMENT_UNIT_GRANTS = {'spearpoint-tf':[{name:'suboden khan', rule:'wrath-first-khan'}]};
const ARMY_RULE_SCOPE = {'combat-doctrines':'Every unit, once per doctrine','spearpoint-tf':'Every unit','assault-brethren':'Every unit','battle-focus':'Every unit','relentless':'Objectives you control','void-thieves':'Anhrathe units','veterans':'Anhrathe units','far-reaching':'Rangers and Shroud Runners'};

// ---------- Units ----------
const DEFAULT_UNITS = [
  { id:'fuegan', nm:'Fuegan', pts:130, grp:'A', role:'Leader', models:1, kw:['ASPECT WARRIOR','CHARACTER'],
    rules:['burning-lance','unquenchable'],
    w:[
      {nm:'Searsong – beam', t:'r', n:1, A:3, sk:2, S:8, AP:3, D:2, kw:{melta:1, sus:2}, alt:'searsong'},
      {nm:'Searsong – lance', t:'r', n:1, A:1, sk:2, S:14, AP:4, D:'D6', kw:{melta:6}, alt:'searsong'},
      {nm:'Fire Axe', t:'m', n:1, A:6, sk:2, S:5, AP:4, D:3, kw:{}},
    ]},
  { id:'fire-dragons', nm:'Fire Dragons', pts:110, grp:'A', role:'Bodyguard', models:5, kw:['ASPECT WARRIORS'],
    rules:['assured','shrine-token'],
    w:[
      {nm:'Exarch’s Dragon fusion gun', t:'r', n:1, A:1, sk:3, S:9, AP:4, D:'D6', kw:{melta:6}},
      {nm:'Dragon fusion gun', t:'r', n:4, A:1, sk:3, S:9, AP:4, D:'D6', kw:{melta:3}},
      {nm:'Close combat weapon', t:'m', n:5, A:2, sk:3, S:3, AP:0, D:1, kw:{}},
    ]},
  { id:'kharseth', nm:'Kharseth', pts:115, enh:{id:'archraider', nm:'Archraider', pts:35}, grp:'B', role:'Leader', models:1, kw:['ANHRATHE','PSYKER','CHARACTER'],
    rules:['fury-void','aethersense','void-thieves'],
    w:[
      {nm:'Dread of the Deep Void', t:'r', n:1, A:'D6+2', sk:3, S:3, AP:2, D:1, kw:{anti:['INFANTRY',2], blast:1, ic:1, psychic:1}},
      {nm:'Waystave', t:'m', n:1, A:3, sk:2, S:3, AP:0, D:3, kw:{anti:['INFANTRY',2], psychic:1}},
    ]},
  { id:'voidreavers-b', nm:'Corsair Voidreavers', sub:'with Kharseth', pts:65, grp:'B', role:'Bodyguard', models:5, kw:['ANHRATHE','BATTLELINE'],
    rules:['reavers','void-thieves','mistshield'],
    w:[
      {nm:'Blaster', t:'r', n:1, A:1, sk:3, S:8, AP:4, D:'D6+1', kw:{}},
      {nm:'Shuriken pistol', t:'r', n:3, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Neuro disruptor (Felarch)', t:'r', n:1, A:1, sk:3, S:4, AP:2, D:1, kw:{anti:['INFANTRY',2], pistol:1}},
      {nm:'Power sword', t:'m', n:5, A:2, sk:3, S:4, AP:2, D:1, kw:{}},
    ]},
  { id:'lhykhis', nm:'Lhykhis', pts:135, grp:'C', role:'Leader', models:1, kw:['ASPECT WARRIOR','CHARACTER'],
    rules:['whispering-web','empyric-ambush'],
    w:[
      {nm:'Brood Twain', t:'r', n:1, A:'D6+3', sk:0, S:6, AP:2, D:1, kw:{torrent:1, tl:1, ic:1}},
      {nm:'Weaverender', t:'m', n:1, A:5, sk:2, S:6, AP:2, D:2, kw:{lethal:1}},
      {nm:'Spider’s Fangs', t:'m', n:1, A:5, sk:2, S:4, AP:2, D:1, kw:{lethal:1, extra:1}},
    ]},
  { id:'warp-spiders', nm:'Warp Spiders', pts:105, grp:'C', role:'Bodyguard', models:5, kw:['ASPECT WARRIORS'],
    rules:['flickerjump','shrine-token'],
    w:[
      {nm:'Death spinner', t:'r', n:4, A:'D6', sk:0, S:4, AP:1, D:1, kw:{torrent:1, ic:1}},
      {nm:'Powerblade array (Exarch)', t:'m', n:1, A:10, sk:3, S:4, AP:2, D:1, kw:{lethal:1, tl:1}},
      {nm:'Close combat weapon', t:'m', n:4, A:2, sk:3, S:3, AP:0, D:1, kw:{}},
    ]},
  { id:'yriel', nm:'Prince Yriel', pts:95, grp:'D', role:'Leader', models:1, kw:['ANHRATHE','CHARACTER'],
    rules:['piratical-hero','prince-corsairs','void-thieves'],
    w:[
      {nm:'Eye of Wrath', t:'r', n:1, A:3, sk:2, S:6, AP:2, D:2, kw:{pistol:1}},
      {nm:'Shuriken pistol', t:'r', n:1, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Spear of Twilight', t:'m', n:1, A:5, sk:2, S:7, AP:3, D:3, kw:{lance:1}},
    ]},
  { id:'voidscarred', nm:'Corsair Voidscarred', pts:155, enh:{id:'voidstone', nm:'Voidstone', pts:15}, grp:'D', role:'Bodyguard', models:10, kw:['ANHRATHE','PSYKER'],
    rules:['raiders','void-thieves','faolchu','channeller','mistshield'],
    w:[
      {nm:'Wraithcannon', t:'r', n:1, A:1, sk:3, S:14, AP:4, D:'D6+1', kw:{}},
      {nm:'Blaster', t:'r', n:2, A:1, sk:3, S:8, AP:4, D:'D6+1', kw:{}},
      {nm:'Executioner (Way Seeker)', t:'r', n:1, A:3, sk:3, S:6, AP:2, D:'D3', kw:{anti:['INFANTRY',2], psychic:1}},
      {nm:'Long rifle', t:'r', n:1, A:1, sk:3, S:4, AP:1, D:2, kw:{heavy:1, precision:1}},
      {nm:'Fusion pistol', t:'r', n:1, A:1, sk:3, S:8, AP:4, D:'D6', kw:{melta:2, pistol:1}},
      {nm:'Neuro disruptor (Felarch)', t:'r', n:1, A:1, sk:3, S:4, AP:2, D:1, kw:{anti:['INFANTRY',2], pistol:1}},
      {nm:'Shuriken pistol', t:'r', n:4, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Shuriken pistol (Way Seeker)', t:'r', n:1, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}, off:'Fires the Executioner instead (pistol rule)'},
      {nm:'Power sword', t:'m', n:8, A:3, sk:3, S:4, AP:2, D:1, kw:{}},
      {nm:'Paired Hekatarii blades (Shade Runner)', t:'m', n:1, A:4, sk:2, S:3, AP:2, D:1, kw:{tl:1}},
      {nm:'Witch staff (Way Seeker)', t:'m', n:1, A:2, sk:2, S:3, AP:0, D:'D3', kw:{anti:['INFANTRY',2], psychic:1}},
    ]},
  { id:'farseer', nm:'Farseer', pts:60, grp:null, cat:'Characters', models:1, kw:['PSYKER','CHARACTER'],
    rules:['guide','branching'],
    w:[
      {nm:'Eldritch Storm', t:'r', n:1, A:'D6', sk:3, S:6, AP:2, D:'D3', kw:{blast:1, psychic:1}},
      {nm:'Shuriken pistol', t:'r', n:1, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}, off:'Casts Eldritch Storm instead (pistol rule)'},
      {nm:'Witchblade', t:'m', n:1, A:2, sk:2, S:3, AP:0, D:2, kw:{anti:['INFANTRY',2], psychic:1}},
    ]},
  { id:'spiritseer', nm:'Spiritseer', pts:50, grp:null, cat:'Characters', models:1, kw:['PSYKER','CHARACTER'],
    rules:['spirit-mark','tears-isha','spiritseer-lo'],
    w:[
      {nm:'Shuriken pistol', t:'r', n:1, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Witch staff', t:'m', n:1, A:2, sk:2, S:3, AP:0, D:'D3', kw:{anti:['INFANTRY',2], psychic:1}},
    ]},
  { id:'voidreavers-a', nm:'Corsair Voidreavers', sub:'unattached', pts:65, grp:null, cat:'Battleline', models:5, kw:['ANHRATHE','BATTLELINE'],
    rules:['reavers','void-thieves','mistshield'],
    w:[
      {nm:'Blaster', t:'r', n:1, A:1, sk:3, S:8, AP:4, D:'D6+1', kw:{}},
      {nm:'Shuriken pistol', t:'r', n:3, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Neuro disruptor (Felarch)', t:'r', n:1, A:1, sk:3, S:4, AP:2, D:1, kw:{anti:['INFANTRY',2], pistol:1}},
      {nm:'Power sword', t:'m', n:5, A:2, sk:3, S:4, AP:2, D:1, kw:{}},
    ]},
  { id:'shroud-runners', nm:'Shroud Runners', pts:180, enh:{id:'assassins-eye', nm:'Assassins’ Eye', pts:15}, grp:null, cat:'Mounted', models:6, kw:['MOUNTED'],
    rules:['target-acq','far-reaching'],
    w:[
      {nm:'Scatter laser', t:'r', n:6, A:6, sk:3, S:5, AP:0, D:1, kw:{sus:1}},
      {nm:'Long rifle', t:'r', n:6, A:1, sk:2, S:4, AP:1, D:2, kw:{precision:1}},
      {nm:'Shuriken pistol', t:'r', n:6, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}, off:'Fire rifles and lasers instead (pistol rule)'},
      {nm:'Close combat weapon', t:'m', n:6, A:1, sk:3, S:3, AP:0, D:1, kw:{}},
    ]},
  { id:'skyreavers-a', nm:'Corsair Skyreavers', sub:'10 models', pts:140, grp:null, cat:'Infantry', models:10, kw:['ANHRATHE'],
    rules:['raid-run','void-thieves'],
    w:[
      {nm:'Fusion gun', t:'r', n:2, A:1, sk:3, S:8, AP:4, D:'D6', kw:{melta:2}},
      {nm:'Blaster', t:'r', n:2, A:1, sk:3, S:8, AP:4, D:'D6+1', kw:{}},
      {nm:'Blast pistol (Felarch)', t:'r', n:1, A:1, sk:3, S:8, AP:3, D:'D3', kw:{pistol:1}},
      {nm:'Shuriken pistol', t:'r', n:5, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Corsair blade', t:'m', n:10, A:3, sk:3, S:4, AP:2, D:1, kw:{}},
    ]},
  { id:'skyreavers-b', nm:'Corsair Skyreavers', sub:'5 models', pts:75, grp:null, cat:'Infantry', models:5, kw:['ANHRATHE'],
    rules:['raid-run','void-thieves'],
    w:[
      {nm:'Fusion gun', t:'r', n:1, A:1, sk:3, S:8, AP:4, D:'D6', kw:{melta:2}},
      {nm:'Blaster', t:'r', n:1, A:1, sk:3, S:8, AP:4, D:'D6+1', kw:{}},
      {nm:'Blast pistol (Felarch)', t:'r', n:1, A:1, sk:3, S:8, AP:3, D:'D3', kw:{pistol:1}},
      {nm:'Shuriken pistol', t:'r', n:2, A:1, sk:3, S:4, AP:1, D:1, kw:{pistol:1}},
      {nm:'Corsair blade', t:'m', n:5, A:3, sk:3, S:4, AP:2, D:1, kw:{}},
    ]},
  { id:'rangers-a', nm:'Rangers', sub:'5 models', pts:70, enh:{id:'camo-snipers', nm:'Camouflaged Snipers', pts:10}, grp:null, cat:'Infantry', models:5, kw:['INFANTRY'],
    rules:['path-outcast','far-reaching'],
    w:[
      {nm:'Long rifle', t:'r', n:5, A:1, sk:3, S:4, AP:1, D:2, kw:{heavy:1, precision:1}},
      {nm:'Shuriken pistol', t:'r', n:5, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}, off:'Fire long rifles instead (pistol rule)'},
      {nm:'Close combat weapon', t:'m', n:5, A:1, sk:3, S:3, AP:0, D:1, kw:{}},
    ]},
  { id:'rangers-b', nm:'Rangers', sub:'10 models', pts:125, enh:{id:'assassins-eye', nm:'Assassins’ Eye', pts:15}, grp:null, cat:'Infantry', models:10, kw:['INFANTRY'],
    rules:['path-outcast','far-reaching'],
    w:[
      {nm:'Long rifle', t:'r', n:10, A:1, sk:3, S:4, AP:1, D:2, kw:{heavy:1, precision:1}},
      {nm:'Shuriken pistol', t:'r', n:10, A:1, sk:2, S:4, AP:1, D:1, kw:{pistol:1}, off:'Fire long rifles instead (pistol rule)'},
      {nm:'Close combat weapon', t:'m', n:10, A:1, sk:3, S:3, AP:0, D:1, kw:{}},
    ]},
  { id:'wraithblades', nm:'Wraithblades', pts:140, grp:null, cat:'Infantry', models:5, kw:['WRAITH CONSTRUCT'],
    rules:['psyguide','spirit-marked','malevolent','forceshield'],
    w:[
      {nm:'Ghostaxe', t:'m', n:5, A:3, sk:4, S:7, AP:2, D:2, kw:{}},
    ]},
  { id:'wave-serpent', nm:'Wave Serpent', pts:115, grp:null, cat:'Dedicated transport', models:1, kw:['VEHICLE'],
    rules:['serpent-shield'],
    w:[
      {nm:'Twin shuriken cannon', t:'r', n:1, A:3, sk:3, S:6, AP:1, D:2, kw:{lethal:1, tl:1}},
      {nm:'Twin shuriken catapult', t:'r', n:1, A:2, sk:3, S:4, AP:1, D:1, kw:{tl:1}},
      {nm:'Wraithbone hull', t:'m', n:1, A:3, sk:4, S:6, AP:0, D:1, kw:{}},
    ]},
  { id:'starfangs', nm:'Starfangs', pts:70, grp:null, cat:'Vehicles', models:1, kw:['ANHRATHE','VEHICLE'],
    rules:['hallucinogen','void-thieves'],
    w:[
      {nm:'Disintegrator cannon', t:'r', n:1, A:3, sk:3, S:6, AP:3, D:2, kw:{}},
      {nm:'Starfang grenade launcher', t:'r', n:1, A:'D3', sk:3, S:6, AP:3, D:2, kw:{blast:1}},
      {nm:'Wraithbone hull', t:'m', n:1, A:3, sk:4, S:6, AP:0, D:1, kw:{}},
    ]},
];
// enhancement rule ids are added to rules automatically
DEFAULT_UNITS.forEach(u=>{ if (u.enh && !u.rules.includes(u.enh.id)) u.rules.unshift(u.enh.id); });

const BUILTIN_GROUPS = {
  A:{nm:'Attached unit A', short:'Fuegan + Fire Dragons'},
  B:{nm:'Attached unit B', short:'Kharseth + Voidreavers'},
  C:{nm:'Attached unit C', short:'Lhykhis + Warp Spiders'},
  D:{nm:'Attached unit D', short:'Yriel + Voidscarred'},
};

// Benchmark targets, calibrated so Prince Yriel's row reproduces the Cogitator's published row.
const DEFAULT_TARGETS = [
  {id:'cadians', nm:'Cadian Shock Troops', pts:70, T:3, Sv:5, inv:0, W:1, N:10, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'warp-spiders', nm:'Warp Spiders', pts:105, T:3, Sv:3, inv:5, W:1, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'genestealers', nm:'Genestealers', pts:75, T:4, Sv:5, inv:5, W:2, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'boyz', nm:'Boyz', pts:85, T:5, Sv:5, inv:0, W:1, N:10, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'intercessors', nm:'Intercessor Squad', pts:95, T:5, Sv:3, inv:0, W:2, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'strike-squad', nm:'Strike Squad', pts:125, T:5, Sv:2, inv:0, W:2, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'wraithblades', nm:'Wraithblades', pts:140, T:6, Sv:2, inv:0, W:3, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'terminators', nm:'Terminator Squad', pts:195, T:6, Sv:2, inv:4, W:3, N:5, fnp:0, dr:0, kw:'INFANTRY', cls:'inf'},
  {id:'canoptek-wraiths', nm:'Canoptek Wraiths', pts:95, T:6, Sv:3, inv:4, W:4, N:3, fnp:0, dr:0, kw:'BEASTS', cls:'inf'},
  {id:'scout-sentinels', nm:'Scout Sentinels', pts:55, T:7, Sv:3, inv:0, W:7, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'rhino', nm:'Rhino', pts:70, T:9, Sv:3, inv:0, W:10, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'doomsday-ark', nm:'Doomsday Ark', pts:200, T:9, Sv:3, inv:4, W:14, N:1, fnp:0, dr:0, kw:'VEHICLE FLY', cls:'veh'},
  {id:'dreadknight', nm:'Nemesis Dreadknight', pts:205, T:9, Sv:2, inv:4, W:13, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'predator', nm:'Predator Annihilator', pts:135, T:10, Sv:3, inv:0, W:11, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'mutalith', nm:'Mutalith Vortex Beast', pts:170, T:10, Sv:4, inv:5, W:13, N:1, fnp:5, dr:0, kw:'MONSTER', cls:'veh'},
  {id:'vindicator', nm:'Vindicator', pts:185, T:11, Sv:2, inv:0, W:11, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'defiler', nm:'Defiler', pts:300, T:11, Sv:3, inv:5, W:18, N:1, fnp:6, dr:0, kw:'VEHICLE', cls:'veh'},
  {id:'ctan', nm:"Transcendent C'tan", pts:340, T:11, Sv:3, inv:4, W:16, N:1, fnp:5, dr:1, kw:'MONSTER', cls:'veh'},
  {id:'land-raider', nm:'Land Raider', pts:245, T:12, Sv:2, inv:0, W:16, N:1, fnp:0, dr:0, kw:'VEHICLE', cls:'veh'},
];

const DEFAULT_OPTS = {
  phase:'all', combine:true, enh:true, cap:false,
  // situation
  charged:true, stationary:false, objective:false, char:false,
  // target marks (set by a unit's ability during the turn)
  riven:false, web:false, guide:false, quarry:false, spiritmark:false, shattered:false, hailstrike:false,
  selfObj:false,
  // modifier bar: per scope ('all', a unit id, or 'grp-X')
  mods:{},
};
const COGITATOR_OPTS = Object.assign({}, DEFAULT_OPTS, {combine:false});
// per-rule switches that the Cogitator appears not to apply
const COGITATOR_RULES_OFF = ['piratical-hero','reavers','assured'];

// the active list's metadata, groups, army rules and rules library (swapped when you change list)
let LIST_META = BUILTIN_META, GROUPS = BUILTIN_GROUPS, ARMY_RULES = BUILTIN_ARMY_RULES, RULES = Object.assign({}, BASE_RULES);

if (typeof module !== 'undefined') module.exports = {BASE_RULES, FACTION_ARMY_RULES, DETACHMENT_RULES, LIST_META, RULES, ARMY_RULES, DEFAULT_UNITS, DEFAULT_TARGETS, DEFAULT_OPTS, COGITATOR_OPTS, COGITATOR_RULES_OFF, GROUPS};
