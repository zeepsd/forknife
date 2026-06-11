'use strict';
/* ============================================================
   FORKNIFE — the legally distinct battle royale
   Single-file canvas game. No dependencies, all original art.
   ============================================================ */

/* ---------------- utils ---------------- */
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist  = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
function pickWeighted(pairs) { // [[value, weight], ...]
  let total = 0; for (const p of pairs) total += p[1];
  let r = Math.random() * total;
  for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* ---------------- data ---------------- */
const W = 3000;            // world is W x W
const GRID = 64;           // build grid cell size
const PLAYER_R = 20;
const BOT_COUNT = 15;

const RARITY = [
  { name: 'Common',    color: '#b4bac4', mult: 1.00 },
  { name: 'Uncommon',  color: '#46d160', mult: 1.10 },
  { name: 'Rare',      color: '#3aa0ff', mult: 1.21 },
  { name: 'Epic',      color: '#bb5cf5', mult: 1.33 },
  { name: 'Legendary', color: '#ffa226', mult: 1.47 },
];

const WEAPONS = {
  pickaxe: { name: 'Pickaxe', melee: true, dmg: 20, structDmg: 50, rate: 2.2, range: 78 },
  pistol:  { name: 'Pistol',         dmg: 24, rate: 4.5,  mag: 16, reload: 1.2, spread: 0.055, speed: 1500, range: 900,  auto: false, len: 26, wide: 7 },
  smg:     { name: 'SMG',            dmg: 15, rate: 11,   mag: 30, reload: 1.6, spread: 0.14,  speed: 1400, range: 680,  auto: true,  len: 30, wide: 8 },
  shotgun: { name: 'Pump Shotgun',   dmg: 9,  rate: 1.05, mag: 5,  reload: 2.3, spread: 0.17,  speed: 1300, range: 430,  auto: false, len: 36, wide: 9, pellets: 6 },
  ar:      { name: 'Assault Rifle',  dmg: 30, rate: 5.5,  mag: 30, reload: 2.0, spread: 0.05,  speed: 1700, range: 1100, auto: true,  len: 38, wide: 8 },
  sniper:  { name: 'Bolt Sniper',    dmg: 105,rate: 0.8,  mag: 1,  reload: 2.4, spread: 0.004, speed: 2600, range: 2000, auto: false, len: 46, wide: 7 },
};

const HEALS = {
  bandage: { name: 'Bandage',      time: 2.5, color: '#ff8aa0', cap: 10 },
  medkit:  { name: 'Medkit',       time: 6.0, color: '#ff4d5e', cap: 3  },
  mini:    { name: 'Mini Shield',  time: 2.0, color: '#57c8ff', cap: 8  },
  big:     { name: 'Big Shield',   time: 4.0, color: '#2a7dff', cap: 4  },
};

const STORM_PHASES = [
  { wait: 20, shrink: 18, r: 900, dps: 1 },
  { wait: 15, shrink: 14, r: 550, dps: 2 },
  { wait: 12, shrink: 12, r: 330, dps: 4 },
  { wait: 10, shrink: 10, r: 190, dps: 6 },
  { wait: 9,  shrink: 9,  r: 100, dps: 8 },
  { wait: 8,  shrink: 14, r: 40,  dps: 10 },
];

const BOT_NAMES = [
  'DefaultDanny', 'TTV_SweatLord', 'xX_NoSkin_Xx', 'BushWookie', 'CrankedKid99',
  'LtLlama', 'SgtSlurp', 'DoorTaker', 'MatsGoblin', 'OneShotOtto',
  'WKey_Wayne', 'StormCamper', 'LootGremlin', 'RampRat', 'BoxedLikeAFish',
];
const BOT_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#9775fa', '#f783ac', '#e8590c', '#74b816', '#15aabf', '#cc5de8', '#ff8787', '#a9e34b'];

/* ---------------- canvas / view ---------------- */
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
const view = { w: 0, h: 0 };
const cam = { x: W / 2, y: W / 2 };
let DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth; view.h = window.innerHeight;
  cvs.width = view.w * DPR; cvs.height = view.h * DPR;
  cvs.style.width = view.w + 'px'; cvs.style.height = view.h + 'px';
}
window.addEventListener('resize', resize);
resize();

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); return this; };
}

/* ---------------- audio ---------------- */
let actx = null, masterGain = null, muted = false;
let noiseBuf = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = 0.16;
    masterGain.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
}
function tone(freq, dur, type, vol, slideTo) {
  if (!actx || muted) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, actx.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), actx.currentTime + dur);
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g); g.connect(masterGain);
  o.start(); o.stop(actx.currentTime + dur + 0.02);
}
function noise(dur, vol, freq) {
  if (!actx || muted) return;
  const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.7;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(masterGain);
  s.start(); s.stop(actx.currentTime + dur + 0.02);
}
const SFX = {
  pistol:  v => { noise(0.07, 0.5 * v, 2000); tone(200, 0.06, 'square', 0.22 * v, 80); },
  smg:     v => { noise(0.05, 0.38 * v, 2400); tone(260, 0.04, 'square', 0.16 * v, 120); },
  shotgun: v => { noise(0.16, 0.7 * v, 900);  tone(110, 0.14, 'square', 0.3 * v, 50); },
  ar:      v => { noise(0.07, 0.5 * v, 1500); tone(170, 0.07, 'square', 0.24 * v, 70); },
  sniper:  v => { noise(0.28, 0.8 * v, 600);  tone(90, 0.25, 'sawtooth', 0.32 * v, 35); },
  swing:   v => { noise(0.09, 0.16 * v, 500); },
  thunk:   v => { tone(95, 0.08, 'square', 0.3 * v, 60); noise(0.05, 0.25 * v, 300); },
  pickup:  v => { tone(620, 0.07, 'sine', 0.25 * v); setTimeout(() => tone(880, 0.09, 'sine', 0.25 * v), 60); },
  build:   v => { tone(150, 0.07, 'triangle', 0.35 * v); noise(0.04, 0.2 * v, 800); },
  breakS:  v => { noise(0.18, 0.5 * v, 700); tone(120, 0.12, 'sawtooth', 0.2 * v, 50); },
  hitmark: v => { tone(1250, 0.035, 'sine', 0.22 * v); },
  hurt:    v => { tone(120, 0.13, 'sawtooth', 0.3 * v, 70); },
  heal:    v => { tone(420, 0.3, 'sine', 0.18 * v, 700); },
  shield:  v => { tone(520, 0.12, 'sine', 0.2 * v, 760); setTimeout(() => tone(700, 0.12, 'sine', 0.18 * v, 940), 90); },
  storm:   v => { tone(440, 0.22, 'square', 0.16 * v); setTimeout(() => tone(330, 0.3, 'square', 0.16 * v), 240); },
  elim:    v => { tone(880, 0.1, 'square', 0.22 * v); setTimeout(() => tone(660, 0.16, 'square', 0.22 * v), 100); },
  chest:   v => { tone(523, 0.12, 'sine', 0.2 * v); setTimeout(() => tone(659, 0.12, 'sine', 0.2 * v), 90); setTimeout(() => tone(784, 0.18, 'sine', 0.22 * v), 180); },
  horn:    v => { tone(310, 0.4, 'sawtooth', 0.2 * v); setTimeout(() => tone(392, 0.5, 'sawtooth', 0.2 * v), 280); },
  land:    v => { noise(0.1, 0.2 * v, 250); },
  win:     v => { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.28, 'square', 0.2 * v), i * 130)); },
  lose:    v => { tone(220, 0.4, 'sawtooth', 0.2 * v, 110); },
};
function sfx(name, vol) { const f = SFX[name]; if (f) f(vol == null ? 1 : vol); }
function sfxAt(name, x, y) {
  const d = dist(x, y, cam.x, cam.y);
  if (d > 1300) return;
  sfx(name, clamp(1 - d / 1300, 0.05, 1));
}

/* ---------------- input ---------------- */
const keys = {};
const mouse = { x: 0, y: 0, down: false, clicked: false };
window.addEventListener('keydown', e => {
  if (e.code === 'Space') e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  onKey(e.code);
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
cvs.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cvs.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; mouse.clicked = true; } });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
window.addEventListener('wheel', e => {
  if (!me || !me.alive || game.phase !== 'play') return;
  const dir = e.deltaY > 0 ? 1 : -1;
  let s = me.sel;
  for (let i = 0; i < 5; i++) {
    s = (s + dir + 5) % 5;
    if (s === 0 || me.slots[s]) break;
  }
  selectSlot(s);
});
function worldMouse() {
  return { x: cam.x + (mouse.x - view.w / 2), y: cam.y + (mouse.y - view.h / 2) };
}

/* ---------------- game state ---------------- */
const game = {
  phase: 'menu',     // menu | bus | play
  over: false,
  time: 0,
  meDead: false,
  winner: null,
};
let players = [], me = null;
let bullets = [], loots = [], particles = [], dmgNums = [], feed = [];
let trees = [], rocks = [], bushes = [], chests = [], patches = [];
const walls = new Map(); // "cx,cy" -> wall
const storm = { x: W / 2, y: W / 2, r: 1500, phase: 0, state: 'wait', t: STORM_PHASES[0].wait, fx: 0, fy: 0, fr: 0, tx: 0, ty: 0, tr: 0 };
const bus = { active: false, x: 0, y: 0, x0: 0, y0: 0, x1: 0, y1: 0, t: 0, T: 0, ang: 0 };
let announceBig = '', announceSmall = '', announceT = 0;
let hintText = '', hintT = 0;
let shake = 0;
let nearChest = null, nearLoot = null;

function announce(big, small) { announceBig = big; announceSmall = small || ''; announceT = 3.2; }
function hint(t) { hintText = t; hintT = 1.6; }
function addFeed(text, color) { feed.unshift({ text, color: color || '#fff', t: 6 }); if (feed.length > 6) feed.pop(); }
function addDmg(x, y, val, color) { dmgNums.push({ x: x + rand(-10, 10), y: y - 24, val: Math.max(1, Math.round(val)), color, t: 0.9 }); }
function addParticles(x, y, color, n, spd, size) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(spd * 0.3, spd);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.3, 0.7), maxT: 0.7, color, size: size || rand(2, 5) });
  }
}

/* ---------------- world gen ---------------- */
function farFromAll(x, y, arr, minD) {
  for (const o of arr) if (dist2(x, y, o.x, o.y) < minD * minD) return false;
  return true;
}
function genWorld() {
  trees = []; rocks = []; bushes = []; chests = []; loots = []; patches = []; walls.clear();
  for (let i = 0; i < 26; i++) patches.push({ x: rand(0, W), y: rand(0, W), rx: rand(120, 380), ry: rand(90, 280), a: rand(0, 3.14) });
  let guard = 0;
  while (rocks.length < 42 && guard++ < 2000) {
    const x = rand(90, W - 90), y = rand(90, W - 90);
    if (farFromAll(x, y, rocks, 110)) rocks.push({ x, y, r: rand(24, 40), hp: 250, maxHp: 250, seed: Math.random() });
  }
  guard = 0;
  while (trees.length < 115 && guard++ < 4000) {
    const x = rand(70, W - 70), y = rand(70, W - 70);
    if (farFromAll(x, y, trees, 85) && farFromAll(x, y, rocks, 80))
      trees.push({ x, y, r: rand(30, 48), hp: 150, maxHp: 150, sway: rand(0, 6.28), hitT: 0 });
  }
  guard = 0;
  while (bushes.length < 34 && guard++ < 2000) {
    const x = rand(70, W - 70), y = rand(70, W - 70);
    if (farFromAll(x, y, trees, 70) && farFromAll(x, y, rocks, 70)) bushes.push({ x, y, r: rand(34, 46) });
  }
  guard = 0;
  while (chests.length < 26 && guard++ < 3000) {
    const x = rand(140, W - 140), y = rand(140, W - 140);
    if (farFromAll(x, y, chests, 230) && farFromAll(x, y, trees, 70) && farFromAll(x, y, rocks, 70))
      chests.push({ x, y, open: false, llama: false, glow: rand(0, 6.28) });
  }
  // two supply llamas
  for (let i = 0; i < 2; i++) {
    const x = rand(200, W - 200), y = rand(200, W - 200);
    chests.push({ x, y, open: false, llama: true, glow: rand(0, 6.28) });
  }
  // scattered floor loot
  for (let i = 0; i < 85; i++) {
    const x = rand(100, W - 100), y = rand(100, W - 100);
    const roll = Math.random();
    if (roll < 0.58) spawnLoot(x, y, randomWeaponItem(false));
    else if (roll < 0.85) spawnLoot(x, y, randomHealItem());
    else spawnLoot(x, y, { kind: 'mats', count: 30 });
  }
}

/* ---------------- items / loot ---------------- */
function randomWeaponItem(fromChest) {
  const type = pickWeighted([['pistol', 24], ['smg', 24], ['shotgun', 20], ['ar', 26], ['sniper', 6]]);
  const rarity = fromChest
    ? pickWeighted([[1, 30], [2, 35], [3, 25], [4, 10]])
    : pickWeighted([[0, 40], [1, 30], [2, 18], [3, 9], [4, 3]]);
  return { kind: 'weapon', type, rarity, mag: WEAPONS[type].mag };
}
function randomHealItem() {
  const type = pickWeighted([['bandage', 34], ['mini', 34], ['big', 18], ['medkit', 14]]);
  return { kind: 'heal', type, count: type === 'bandage' ? 3 : type === 'mini' ? 3 : 1 };
}
function spawnLoot(x, y, item) {
  loots.push(Object.assign({ x: clamp(x, 40, W - 40), y: clamp(y, 40, W - 40), bob: rand(0, 6.28) }, item));
}
function tossLoot(x, y, item) { spawnLoot(x + rand(-34, 34), y + rand(-34, 34), item); }
function dmgOf(item) { return WEAPONS[item.type].dmg * RARITY[item.rarity].mult; }
function openChest(ch, byMe) {
  if (ch.open) return;
  ch.open = true;
  sfxAt('chest', ch.x, ch.y);
  addParticles(ch.x, ch.y, ch.llama ? '#bb5cf5' : '#ffd54a', 16, 150);
  if (ch.llama) {
    tossLoot(ch.x, ch.y, { kind: 'mats', count: 60 });
    tossLoot(ch.x, ch.y, { kind: 'mats', count: 60 });
    tossLoot(ch.x, ch.y, { kind: 'heal', type: 'big', count: 2 });
    tossLoot(ch.x, ch.y, { kind: 'heal', type: 'medkit', count: 1 });
    if (byMe) hint('Llama! Nice.');
  } else {
    tossLoot(ch.x, ch.y, randomWeaponItem(true));
    tossLoot(ch.x, ch.y, randomHealItem());
    tossLoot(ch.x, ch.y, { kind: 'mats', count: 30 });
  }
}

/* ---------------- players ---------------- */
function makePlayer(name, isBot, color) {
  return {
    name, isBot, color,
    x: W / 2, y: W / 2, r: PLAYER_R,
    hp: 100, shield: 0, alive: true,
    air: false, alt: 0, glideTx: 0, glideTy: 0, dropped: false,
    aim: 0, kills: 0, mats: 0,
    slots: [{ kind: 'pickaxe' }, null, null, null, null], sel: 0,
    fireCd: 0, reloadT: 0, reloadMax: 0, swingT: 0, swingHit: true,
    useT: 0, useMax: 0,
    buildMode: false, buildCd: 0,
    hurtT: 0, moveAng: 0, moving: false,
    // bot brain
    skill: rand(0.45, 0.95), wpX: 0, wpY: 0, wpT: 0, retargetT: rand(0, 0.4),
    enemy: null, enemySince: 0, strafe: 1, strafeT: 0,
    botWeapon: null, botMag: 0, botReload: 0, botHeals: 0, gearT: rand(1.5, 4), healT: 0,
    burstT: rand(0.3, 0.8), pauseT: 0,
  };
}
function selectSlot(s) {
  if (!me.alive) return;
  if (s !== 0 && !me.slots[s]) return;
  if (me.sel !== s) { me.sel = s; me.useT = 0; me.reloadT = 0; me.buildMode = false; }
}
function selectedItem(p) { return p.sel === 0 ? p.slots[0] : p.slots[p.sel]; }

function pickupLoot(p, lo) {
  if (lo.kind === 'mats') { p.mats = Math.min(999, p.mats + lo.count); sfx('pickup', 0.7); return true; }
  if (lo.kind === 'heal') {
    for (let i = 1; i < 5; i++) {
      const s = p.slots[i];
      if (s && s.kind === 'heal' && s.type === lo.type) {
        const cap = HEALS[lo.type].cap;
        if (s.count >= cap) return false;
        s.count = Math.min(cap, s.count + lo.count);
        sfx('pickup', 0.8); return true;
      }
    }
  }
  for (let i = 1; i < 5; i++) {
    if (!p.slots[i]) {
      p.slots[i] = { kind: lo.kind, type: lo.type, rarity: lo.rarity, mag: lo.mag, count: lo.count };
      sfx('pickup', 0.8);
      return true;
    }
  }
  return false; // full
}
function swapWithSelected(lo) {
  if (me.sel === 0) { hint('Inventory full — select a slot (2-5) to swap'); return false; }
  const cur = me.slots[me.sel];
  me.slots[me.sel] = { kind: lo.kind, type: lo.type, rarity: lo.rarity, mag: lo.mag, count: lo.count };
  const idx = loots.indexOf(lo);
  if (idx >= 0) loots.splice(idx, 1);
  tossLoot(me.x, me.y, cur);
  sfx('pickup', 0.8);
  me.useT = 0; me.reloadT = 0;
  return true;
}
function dropSelected() {
  if (!me.alive || me.sel === 0) return;
  const cur = me.slots[me.sel];
  if (!cur) return;
  tossLoot(me.x + Math.cos(me.aim) * 40, me.y + Math.sin(me.aim) * 40, cur);
  me.slots[me.sel] = null;
  me.sel = 0; me.useT = 0; me.reloadT = 0;
}

/* ---------------- combat ---------------- */
function spawnBullet(owner, ang, stats, dmg) {
  const pellets = stats.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const a = ang + (Math.random() - 0.5) * 2 * stats.spread;
    const sx = owner.x + Math.cos(a) * (owner.r + 12);
    const sy = owner.y + Math.sin(a) * (owner.r + 12);
    bullets.push({ x: sx, y: sy, px: sx, py: sy, dx: Math.cos(a), dy: Math.sin(a), speed: stats.speed, dmg, owner, traveled: 0, maxDist: stats.range });
  }
}
function tryFireWeapon(p, item, wantFire, wantHold) {
  const stats = WEAPONS[item.type];
  if (p.reloadT > 0) return;
  if (item.mag <= 0) { startReload(p, item); return; }
  const trigger = stats.auto ? wantHold : wantFire;
  if (!trigger || p.fireCd > 0) return;
  item.mag--;
  p.fireCd = 1 / stats.rate;
  spawnBullet(p, p.aim, stats, dmgOf(item));
  sfxAt(item.type, p.x, p.y);
  if (p === me) shake = Math.min(8, shake + (item.type === 'sniper' ? 6 : item.type === 'shotgun' ? 4 : 1.5));
  if (item.mag <= 0) startReload(p, item);
}
function startReload(p, item) {
  if (p.reloadT > 0 || item.mag >= WEAPONS[item.type].mag) return;
  p.reloadT = WEAPONS[item.type].reload;
  p.reloadMax = p.reloadT;
  p.reloadItem = item;
}
function swingPickaxe(p, wantHold) {
  const stats = WEAPONS.pickaxe;
  if (p.swingT <= 0 && wantHold && p.fireCd <= 0) {
    p.swingT = 1 / stats.rate;
    p.swingHit = false;
    p.fireCd = 1 / stats.rate;
    sfxAt('swing', p.x, p.y);
  }
}
function meleeResolve(p) {
  // called once mid-swing
  const stats = WEAPONS.pickaxe;
  const hx = p.x + Math.cos(p.aim) * stats.range * 0.7;
  const hy = p.y + Math.sin(p.aim) * stats.range * 0.7;
  let hitSomething = false;
  // walls first
  const ck = cellKey(Math.floor(hx / GRID), Math.floor(hy / GRID));
  if (walls.has(ck)) { damageWall(ck, stats.structDmg, p); hitSomething = true; }
  if (!hitSomething) for (const t of trees) {
    if (dist2(hx, hy, t.x, t.y) < (t.r + 14) * (t.r + 14)) {
      t.hp -= stats.structDmg; t.hitT = 0.25;
      p.mats = Math.min(999, p.mats + 15);
      if (p === me) addDmg(t.x, t.y, 15, '#c8e664');
      addParticles(hx, hy, '#5a9c3c', 6, 120);
      sfxAt('thunk', p.x, p.y);
      if (t.hp <= 0) { trees.splice(trees.indexOf(t), 1); addParticles(t.x, t.y, '#4e8c34', 18, 180); sfxAt('breakS', t.x, t.y); }
      hitSomething = true; break;
    }
  }
  if (!hitSomething) for (const rk of rocks) {
    if (dist2(hx, hy, rk.x, rk.y) < (rk.r + 14) * (rk.r + 14)) {
      rk.hp -= stats.structDmg;
      p.mats = Math.min(999, p.mats + 12);
      if (p === me) addDmg(rk.x, rk.y, 12, '#d7dde6');
      addParticles(hx, hy, '#9aa3ad', 6, 120);
      sfxAt('thunk', p.x, p.y);
      if (rk.hp <= 0) { rocks.splice(rocks.indexOf(rk), 1); addParticles(rk.x, rk.y, '#8d959e', 18, 180); sfxAt('breakS', rk.x, rk.y); }
      hitSomething = true; break;
    }
  }
  if (!hitSomething) for (const q of players) {
    if (q === p || !q.alive || q.air) continue;
    if (dist2(hx, hy, q.x, q.y) < (q.r + 16) * (q.r + 16)) {
      applyDamage(q, WEAPONS.pickaxe.dmg, p, 'Pickaxe', false);
      hitSomething = true; break;
    }
  }
}
function applyDamage(victim, dmg, attacker, label, isStorm) {
  if (!victim.alive) return;
  let hpDmg = dmg;
  if (!isStorm && victim.shield > 0) {
    const absorbed = Math.min(victim.shield, dmg);
    victim.shield -= absorbed;
    hpDmg = dmg - absorbed;
    if (absorbed > 0.5) addDmg(victim.x, victim.y, absorbed, '#57c8ff');
  }
  if (hpDmg > 0.5 && !isStorm) addDmg(victim.x, victim.y + 8, hpDmg, '#ffffff');
  victim.hp -= hpDmg;
  victim.hurtT = 0.3;
  if (!isStorm) {
    addParticles(victim.x, victim.y, victim.color, 5, 140, 3);
    if (attacker === me && victim !== me) sfx('hitmark', 0.9);
    if (victim === me) { sfx('hurt', 0.9); shake = Math.min(10, shake + 4); }
  }
  if (victim.hp <= 0) killPlayer(victim, attacker, label, isStorm);
}
function killPlayer(victim, attacker, label, isStorm) {
  victim.alive = false;
  victim.hp = 0;
  addParticles(victim.x, victim.y, victim.color, 26, 240, 5);
  sfxAt('elim', victim.x, victim.y);
  const who = isStorm ? 'The Storm' : (attacker ? attacker.name : '???');
  addFeed(`${who} eliminated ${victim.name}`, attacker === me ? '#ffd54a' : (victim === me ? '#ff5d6c' : '#e6e8ff'));
  if (attacker && attacker !== victim && !isStorm) attacker.kills++;
  if (victim.isBot) dropBotLoot(victim);
  if (victim === me && !game.meDead) {
    game.meDead = true;
    const placement = players.filter(p => p.alive).length + 1;
    sfx('lose');
    showDefeat(placement, who);
  }
  checkWin();
}
function dropBotLoot(b) {
  if (b.botWeapon) tossLoot(b.x, b.y, { kind: 'weapon', type: b.botWeapon.type, rarity: b.botWeapon.rarity, mag: WEAPONS[b.botWeapon.type].mag });
  for (let i = 0; i < b.botHeals; i++) if (chance(0.7)) tossLoot(b.x, b.y, { kind: 'heal', type: pick(['bandage', 'mini']), count: 1 });
  tossLoot(b.x, b.y, { kind: 'mats', count: randi(20, 50) });
}
function checkWin() {
  if (game.over || game.phase === 'menu') return;
  const alive = players.filter(p => p.alive);
  if (alive.length === 1) {
    game.over = true;
    game.winner = alive[0];
    if (alive[0] === me) { sfx('win'); showVictory(); confettiBurst(); }
    else updateWinnerLine(alive[0].name);
  } else if (alive.length === 0 && !game.meDead) {
    game.over = true;
  }
}

/* ---------------- walls / building ---------------- */
function cellKey(cx, cy) { return cx + ',' + cy; }
function damageWall(key, dmg, attacker) {
  const wall = walls.get(key);
  if (!wall) return;
  wall.hp -= dmg;
  addParticles(wall.cx * GRID + GRID / 2, wall.cy * GRID + GRID / 2, '#b07c44', 5, 110);
  if (wall.hp <= 0) {
    walls.delete(key);
    sfxAt('breakS', wall.cx * GRID, wall.cy * GRID);
    addParticles(wall.cx * GRID + GRID / 2, wall.cy * GRID + GRID / 2, '#9c6b38', 14, 170);
  }
}
function buildGhostCell() {
  const wm = worldMouse();
  let cx = Math.floor(wm.x / GRID), cy = Math.floor(wm.y / GRID);
  // clamp to within reach
  const px = clamp(cx * GRID + GRID / 2, me.x - 200, me.x + 200);
  const py = clamp(cy * GRID + GRID / 2, me.y - 200, me.y + 200);
  cx = Math.floor(px / GRID); cy = Math.floor(py / GRID);
  return { cx, cy };
}
function canPlaceWall(cx, cy) {
  if (cx < 0 || cy < 0 || cx * GRID >= W || cy * GRID >= W) return false;
  if (walls.has(cellKey(cx, cy))) return false;
  const x = cx * GRID + GRID / 2, y = cy * GRID + GRID / 2;
  for (const p of players) if (p.alive && !p.air && Math.abs(p.x - x) < GRID / 2 + p.r - 6 && Math.abs(p.y - y) < GRID / 2 + p.r - 6) return false;
  for (const rk of rocks) if (dist2(x, y, rk.x, rk.y) < (rk.r + 20) * (rk.r + 20)) return false;
  for (const ch of chests) if (dist2(x, y, ch.x, ch.y) < 50 * 50) return false;
  return true;
}
function tryPlaceWall() {
  if (me.mats < 10) { hint('Not enough mats (need 10)'); return; }
  const { cx, cy } = buildGhostCell();
  if (!canPlaceWall(cx, cy)) return;
  walls.set(cellKey(cx, cy), { cx, cy, hp: 150, maxHp: 150 });
  me.mats -= 10;
  me.buildCd = 0.16;
  sfxAt('build', me.x, me.y);
}

/* ---------------- LOS / collision ---------------- */
function losBlock(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const steps = Math.ceil(d / 26);
  const dx = (bx - ax) / steps, dy = (by - ay) / steps;
  let x = ax, y = ay;
  for (let i = 1; i < steps; i++) {
    x += dx; y += dy;
    if (walls.has(cellKey(Math.floor(x / GRID), Math.floor(y / GRID)))) return 'wall';
    for (const rk of rocks) if (dist2(x, y, rk.x, rk.y) < rk.r * rk.r) return 'rock';
  }
  return null;
}
function inBush(p) {
  for (const b of bushes) if (dist2(p.x, p.y, b.x, b.y) < (b.r - 6) * (b.r - 6)) return true;
  return false;
}
function resolveCircle(p, ox, oy, orad) {
  const minD = orad + p.r;
  const d2 = dist2(p.x, p.y, ox, oy);
  if (d2 < minD * minD && d2 > 0.01) {
    const d = Math.sqrt(d2);
    p.x = ox + (p.x - ox) / d * minD;
    p.y = oy + (p.y - oy) / d * minD;
  }
}
function resolveWorld(p) {
  p.x = clamp(p.x, p.r, W - p.r);
  p.y = clamp(p.y, p.r, W - p.r);
  for (const t of trees) resolveCircle(p, t.x, t.y, 13);
  for (const rk of rocks) resolveCircle(p, rk.x, rk.y, rk.r * 0.9);
  for (const ch of chests) if (!ch.open) resolveCircle(p, ch.x, ch.y, 20);
  // walls (AABB)
  const cx0 = Math.floor((p.x - p.r) / GRID), cx1 = Math.floor((p.x + p.r) / GRID);
  const cy0 = Math.floor((p.y - p.r) / GRID), cy1 = Math.floor((p.y + p.r) / GRID);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    if (!walls.has(cellKey(cx, cy))) continue;
    const nx = clamp(p.x, cx * GRID, cx * GRID + GRID);
    const ny = clamp(p.y, cy * GRID, cy * GRID + GRID);
    const ddx = p.x - nx, ddy = p.y - ny;
    const dd2 = ddx * ddx + ddy * ddy;
    if (dd2 < p.r * p.r) {
      if (dd2 > 0.01) {
        const dd = Math.sqrt(dd2);
        p.x = nx + ddx / dd * p.r; p.y = ny + ddy / dd * p.r;
      } else {
        // center inside wall: push to nearest edge
        const left = p.x - cx * GRID, right = cx * GRID + GRID - p.x;
        const top = p.y - cy * GRID, bot = cy * GRID + GRID - p.y;
        const m = Math.min(left, right, top, bot);
        if (m === left) p.x = cx * GRID - p.r; else if (m === right) p.x = cx * GRID + GRID + p.r;
        else if (m === top) p.y = cy * GRID - p.r; else p.y = cy * GRID + GRID + p.r;
      }
    }
  }
}

/* ---------------- bullets ---------------- */
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x; b.py = b.y;
    const move = b.speed * dt;
    const steps = Math.max(1, Math.ceil(move / 14));
    const sx = b.dx * move / steps, sy = b.dy * move / steps;
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += sx; b.y += sy; b.traveled += move / steps;
      if (b.x < 0 || b.y < 0 || b.x > W || b.y > W || b.traveled > b.maxDist) { dead = true; break; }
      const ck = cellKey(Math.floor(b.x / GRID), Math.floor(b.y / GRID));
      if (walls.has(ck)) { damageWall(ck, b.dmg, b.owner); dead = true; break; }
      for (const rk of rocks) if (dist2(b.x, b.y, rk.x, rk.y) < rk.r * rk.r) { addParticles(b.x, b.y, '#9aa3ad', 3, 80); dead = true; break; }
      if (dead) break;
      for (const p of players) {
        if (p === b.owner || !p.alive || p.air) continue;
        if (dist2(b.x, b.y, p.x, p.y) < (p.r + 2) * (p.r + 2)) {
          applyDamage(p, b.dmg, b.owner, 'gun', false);
          dead = true; break;
        }
      }
    }
    if (dead) bullets.splice(i, 1);
  }
}

/* ---------------- storm ---------------- */
function setNextStormTarget() {
  const ph = STORM_PHASES[storm.phase];
  const maxOff = Math.max(0, storm.r - ph.r);
  const a = rand(0, Math.PI * 2), m = rand(0, maxOff * 0.8);
  storm.fx = storm.x; storm.fy = storm.y; storm.fr = storm.r;
  storm.tx = clamp(storm.x + Math.cos(a) * m, ph.r, W - ph.r);
  storm.ty = clamp(storm.y + Math.sin(a) * m, ph.r, W - ph.r);
  storm.tr = ph.r;
}
function updateStorm(dt) {
  if (game.phase !== 'play' && game.phase !== 'bus') return;
  if (storm.phase >= STORM_PHASES.length) { dpsTick(dt, STORM_PHASES[STORM_PHASES.length - 1].dps); return; }
  const ph = STORM_PHASES[storm.phase];
  storm.t -= dt;
  if (storm.state === 'wait') {
    if (storm.t <= 0) {
      storm.state = 'shrink'; storm.t = ph.shrink;
      setNextStormTarget();
      announce('STORM SHRINKING', 'Get to the safe zone!');
      sfx('storm', 0.8);
    }
  } else { // shrink
    const k = clamp(1 - storm.t / ph.shrink, 0, 1);
    storm.x = lerp(storm.fx, storm.tx, k);
    storm.y = lerp(storm.fy, storm.ty, k);
    storm.r = lerp(storm.fr, storm.tr, k);
    if (storm.t <= 0) {
      storm.phase++;
      if (storm.phase < STORM_PHASES.length) {
        storm.state = 'wait'; storm.t = STORM_PHASES[storm.phase].wait;
        announce('ZONE ' + (storm.phase + 1), 'Next shrink in ' + STORM_PHASES[storm.phase].wait + 's');
      } else {
        announce('FINAL ZONE', 'Fight!');
      }
    }
  }
  dpsTick(dt, ph.dps);
}
function dpsTick(dt, dps) {
  for (const p of players) {
    if (!p.alive || p.air || !p.dropped) continue;
    if (dist2(p.x, p.y, storm.x, storm.y) > storm.r * storm.r) {
      p.hp -= dps * dt;
      p.stormTick = (p.stormTick || 0) + dt;
      if (p === me && p.stormTick > 0.8) { p.stormTick = 0; sfx('hurt', 0.5); }
      if (p.hp <= 0) killPlayer(p, null, 'storm', true);
    }
  }
}

/* ---------------- bus / drop ---------------- */
function startBus() {
  const side = randi(0, 1);
  const m = 200;
  if (side === 0) { // left -> right
    bus.x0 = -m; bus.y0 = rand(W * 0.25, W * 0.75);
    bus.x1 = W + m; bus.y1 = rand(W * 0.25, W * 0.75);
  } else { // top -> bottom
    bus.x0 = rand(W * 0.25, W * 0.75); bus.y0 = -m;
    bus.x1 = rand(W * 0.25, W * 0.75); bus.y1 = W + m;
  }
  bus.T = dist(bus.x0, bus.y0, bus.x1, bus.y1) / 480;
  bus.t = 0; bus.active = true;
  bus.x = bus.x0; bus.y = bus.y0;
  bus.ang = Math.atan2(bus.y1 - bus.y0, bus.x1 - bus.x0);
  for (const p of players) {
    if (p.isBot) p.dropAt = rand(0.12, 0.85) * bus.T;
  }
  sfx('horn', 0.9);
  announce('BATTLE BUS', 'Press SPACE to drop!');
}
function dropPlayer(p, x, y) {
  p.dropped = true; p.air = true; p.alt = 1;
  p.x = clamp(x, 60, W - 60); p.y = clamp(y, 60, W - 60);
  const a = rand(0, Math.PI * 2), mdist = rand(150, 800);
  p.glideTx = clamp(p.x + Math.cos(a) * mdist, 80, W - 80);
  p.glideTy = clamp(p.y + Math.sin(a) * mdist, 80, W - 80);
}
function updateBus(dt) {
  if (!bus.active) return;
  bus.t += dt;
  const k = clamp(bus.t / bus.T, 0, 1);
  bus.x = lerp(bus.x0, bus.x1, k);
  bus.y = lerp(bus.y0, bus.y1, k);
  for (const p of players) {
    if (p.isBot && !p.dropped && bus.t >= p.dropAt) dropPlayer(p, bus.x + rand(-300, 300), bus.y + rand(-300, 300));
  }
  if (k >= 1) {
    bus.active = false;
    if (!me.dropped) { dropPlayer(me, clamp(bus.x, 100, W - 100), clamp(bus.y, 100, W - 100)); game.phase = 'play'; }
  }
}
function updateAir(p, dt) {
  // glide steering
  if (p === me) {
    let mx = 0, my = 0;
    if (keys.KeyW) my -= 1; if (keys.KeyS) my += 1;
    if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1;
    const l = Math.hypot(mx, my);
    if (l > 0) { p.x += mx / l * 300 * dt; p.y += my / l * 300 * dt; }
  } else {
    const d = dist(p.x, p.y, p.glideTx, p.glideTy);
    if (d > 10) {
      p.x += (p.glideTx - p.x) / d * 260 * dt;
      p.y += (p.glideTy - p.y) / d * 260 * dt;
    }
  }
  p.x = clamp(p.x, 60, W - 60); p.y = clamp(p.y, 60, W - 60);
  p.alt -= dt / 2.7;
  if (p.alt <= 0) {
    p.alt = 0; p.air = false;
    addParticles(p.x, p.y, '#cfe8b8', 10, 120);
    if (p === me) { sfx('land', 0.8); hint('Find a weapon! Walk over loot or press E'); }
    resolveWorld(p);
  }
}

/* ---------------- bot AI ---------------- */
function botEquip(b) {
  const type = pickWeighted([['pistol', 25], ['smg', 25], ['shotgun', 20], ['ar', 25], ['sniper', 5]]);
  const rarity = pickWeighted([[0, 38], [1, 30], [2, 20], [3, 9], [4, 3]]);
  b.botWeapon = { type, rarity };
  b.botMag = WEAPONS[type].mag;
  b.botHeals = randi(0, 2);
  if (chance(0.4)) b.shield = pick([25, 50]);
}
function botBand(type) {
  return { pistol: 300, smg: 220, shotgun: 150, ar: 330, sniper: 520 }[type] || 280;
}
function updateBot(b, dt) {
  if (b.air) { updateAir(b, dt); return; }
  // gear up shortly after landing
  if (!b.botWeapon) {
    b.gearT -= dt;
    if (b.gearT <= 0) botEquip(b);
  }
  b.retargetT -= dt;
  if (b.retargetT <= 0) {
    b.retargetT = rand(0.3, 0.55);
    let best = null, bestD = 380 * 380;
    for (const q of players) {
      if (q === b || !q.alive || q.air) continue;
      if (inBush(q) && dist2(b.x, b.y, q.x, q.y) > 150 * 150) continue;
      const d2v = dist2(b.x, b.y, q.x, q.y);
      if (d2v < bestD) { const blk = losBlock(b.x, b.y, q.x, q.y); if (blk !== 'rock') { best = q; bestD = d2v; } }
    }
    // hurt bots panic and break off half the time
    if (best && b.hp < 40 && chance(0.5)) {
      const d = dist(b.x, b.y, best.x, best.y) || 1;
      b.wpX = clamp(b.x - (best.x - b.x) / d * 600, 60, W - 60);
      b.wpY = clamp(b.y - (best.y - b.y) / d * 600, 60, W - 60);
      b.wpT = 3;
      best = null;
    }
    if (best !== b.enemy) { b.enemy = best; b.enemySince = 0; }
  }
  if (b.enemy && (!b.enemy.alive || b.enemy.air)) b.enemy = null;
  if (b.enemy) b.enemySince += dt;

  // storm avoidance (highest priority)
  const dStorm = dist(b.x, b.y, storm.x, storm.y);
  const safeTx = storm.state === 'shrink' ? storm.tx : storm.x;
  const safeTy = storm.state === 'shrink' ? storm.ty : storm.y;
  const safeTr = storm.state === 'shrink' ? storm.tr : storm.r;
  const inDanger = dStorm > storm.r - 120;
  if (inDanger) {
    const a = rand(0, Math.PI * 2), m = rand(0, safeTr * 0.55);
    if (b.wpT <= 0 || dist2(b.wpX, b.wpY, safeTx, safeTy) > safeTr * safeTr) {
      b.wpX = clamp(safeTx + Math.cos(a) * m, 60, W - 60);
      b.wpY = clamp(safeTy + Math.sin(a) * m, 60, W - 60);
      b.wpT = 4;
    }
  }

  // healing
  if (b.healT > 0) {
    b.healT -= dt;
    if (b.healT <= 0) { b.hp = Math.min(100, b.hp + 45); b.botHeals--; sfxAt('heal', b.x, b.y); }
    return; // stand still while healing
  }
  if (b.hp < 38 && b.botHeals > 0 && (!b.enemy || dist2(b.x, b.y, b.enemy.x, b.enemy.y) > 480 * 480) && !inDanger) {
    b.healT = 2.4;
    return;
  }

  let mvX = 0, mvY = 0;
  const speed = 235;
  if (b.enemy && b.botWeapon) {
    const e = b.enemy;
    const d = dist(b.x, b.y, e.x, e.y);
    const band = botBand(b.botWeapon.type);
    const toX = (e.x - b.x) / (d || 1), toY = (e.y - b.y) / (d || 1);
    // approach / back off
    if (!inDanger) {
      if (d > band + 40) { mvX += toX; mvY += toY; }
      else if (d < band - 40) { mvX -= toX; mvY -= toY; }
      // strafe
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = chance(0.5) ? 1 : -1; b.strafeT = rand(0.7, 1.5); }
      mvX += -toY * b.strafe * 0.8; mvY += toX * b.strafe * 0.8;
    }
    // aim & fire
    const stats = WEAPONS[b.botWeapon.type];
    const err = (0.16 + (1 - b.skill) * 0.20 + d / 2400 * 0.12 + (e.moving ? 0.12 : 0));
    b.aim = Math.atan2(e.y - b.y, e.x - b.x) + (Math.random() - 0.5) * 2 * err;
    if (b.botReload > 0) {
      b.botReload -= dt;
      if (b.botReload <= 0) b.botMag = stats.mag;
    } else if (b.pauseT > 0) {
      b.pauseT -= dt; // catching their breath between bursts
    } else {
      b.burstT -= dt;
      if (b.burstT <= 0) {
        b.pauseT = rand(0.9, 1.9);
        b.burstT = rand(0.4, 0.9);
      } else if (b.enemySince > 1.0 && d < stats.range * 0.92 && b.fireCd <= 0) {
        const blk = losBlock(b.x, b.y, e.x, e.y);
        if (blk !== 'rock') {
          b.botMag--;
          b.fireCd = 1 / stats.rate * (1.15 + (1 - b.skill) * 0.7);
          spawnBullet(b, b.aim, stats, WEAPONS[b.botWeapon.type].dmg * RARITY[b.botWeapon.rarity].mult * 0.65);
          sfxAt(b.botWeapon.type, b.x, b.y);
          if (b.botMag <= 0) b.botReload = stats.reload;
        }
      }
    }
  } else if (b.enemy && !b.botWeapon) {
    // unarmed: run away
    const e = b.enemy;
    const d = dist(b.x, b.y, e.x, e.y) || 1;
    mvX -= (e.x - b.x) / d; mvY -= (e.y - b.y) / d;
    b.aim = Math.atan2(mvY, mvX);
  }
  // wander / waypoint
  if (!b.enemy || inDanger) {
    b.wpT -= dt;
    if (b.wpT <= 0 || dist2(b.x, b.y, b.wpX, b.wpY) < 60 * 60) {
      b.wpT = rand(3, 7);
      const a = rand(0, Math.PI * 2), m = rand(0, storm.r * 0.7);
      b.wpX = clamp(storm.x + Math.cos(a) * m, 60, W - 60);
      b.wpY = clamp(storm.y + Math.sin(a) * m, 60, W - 60);
    }
    const d = dist(b.x, b.y, b.wpX, b.wpY) || 1;
    mvX += (b.wpX - b.x) / d; mvY += (b.wpY - b.y) / d;
    if (!b.enemy) b.aim = Math.atan2(mvY, mvX);
  }
  const ml = Math.hypot(mvX, mvY);
  if (ml > 0.01) {
    b.x += mvX / ml * speed * dt;
    b.y += mvY / ml * speed * dt;
    b.moving = true;
  } else b.moving = false;
  b.fireCd -= dt;
  resolveWorld(b);
  // opportunistic loot upgrade
  for (let i = loots.length - 1; i >= 0; i--) {
    const lo = loots[i];
    if (dist2(b.x, b.y, lo.x, lo.y) > 48 * 48) continue;
    if (lo.kind === 'weapon' && (!b.botWeapon || lo.rarity > b.botWeapon.rarity)) {
      b.botWeapon = { type: lo.type, rarity: lo.rarity };
      b.botMag = WEAPONS[lo.type].mag; b.botReload = 0;
      loots.splice(i, 1);
    } else if (lo.kind === 'heal' && b.botHeals < 4) {
      b.botHeals += lo.count; loots.splice(i, 1);
    }
  }
  // open chests they stand near
  for (const ch of chests) {
    if (!ch.open && dist2(b.x, b.y, ch.x, ch.y) < 60 * 60 && chance(0.02)) openChest(ch, false);
  }
}

/* ---------------- human update ---------------- */
function onKey(code) {
  if (game.phase === 'menu') return;
  if (code === 'KeyM') { muted = !muted; hint(muted ? 'Muted' : 'Sound on'); return; }
  if (code === 'Space' && game.phase === 'bus' && !me.dropped) {
    dropPlayer(me, bus.x, bus.y);
    game.phase = 'play';
    return;
  }
  if (!me || !me.alive || me.air) return;
  if (code.startsWith('Digit')) {
    const n = parseInt(code.slice(5), 10);
    if (n >= 1 && n <= 5) selectSlot(n - 1);
  }
  if (code === 'KeyQ' || code === 'KeyB') {
    me.buildMode = !me.buildMode;
    if (me.buildMode) { me.useT = 0; hint('BUILD MODE — click to place walls (10 mats)'); }
  }
  if (code === 'KeyR') {
    const item = selectedItem(me);
    if (item && item.kind === 'weapon') startReload(me, item);
  }
  if (code === 'KeyE') {
    if (nearChest) { openChest(nearChest, true); return; }
    if (nearLoot) {
      if (!pickupLoot(me, nearLoot)) { swapWithSelected(nearLoot); return; }
      const idx = loots.indexOf(nearLoot);
      if (idx >= 0) loots.splice(idx, 1);
    }
  }
  if (code === 'KeyG') dropSelected();
}
function updateMe(dt) {
  if (!me.alive) return;
  if (me.air) { updateAir(me, dt); return; }
  const wm = worldMouse();
  me.aim = Math.atan2(wm.y - me.y, wm.x - me.x);

  let mx = 0, my = 0;
  if (keys.KeyW) my -= 1; if (keys.KeyS) my += 1;
  if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1;
  const l = Math.hypot(mx, my);
  let speed = 250;
  if (me.useT > 0) speed *= 0.45;
  if (l > 0) {
    me.x += mx / l * speed * dt;
    me.y += my / l * speed * dt;
    me.moving = true; me.moveAng = Math.atan2(my, mx);
  } else me.moving = false;
  resolveWorld(me);

  me.fireCd -= dt;
  me.buildCd -= dt;

  // reload
  if (me.reloadT > 0) {
    me.reloadT -= dt;
    if (me.reloadT <= 0 && me.reloadItem) { me.reloadItem.mag = WEAPONS[me.reloadItem.type].mag; me.reloadItem = null; }
  }
  // swing anim & hit
  if (me.swingT > 0) {
    me.swingT -= dt;
    if (!me.swingHit && me.swingT < 1 / WEAPONS.pickaxe.rate * 0.55) { me.swingHit = true; meleeResolve(me); }
  }

  const item = selectedItem(me);
  if (me.buildMode) {
    if ((mouse.clicked || mouse.down) && me.buildCd <= 0) tryPlaceWall();
  } else if (item) {
    if (item.kind === 'pickaxe') swingPickaxe(me, mouse.down);
    else if (item.kind === 'weapon') tryFireWeapon(me, item, mouse.clicked, mouse.down);
    else if (item.kind === 'heal') {
      const h = HEALS[item.type];
      const canUse =
        (item.type === 'bandage' && me.hp < 75) ||
        (item.type === 'medkit' && me.hp < 100) ||
        (item.type === 'mini' && me.shield < 50) ||
        (item.type === 'big' && me.shield < 100);
      if (mouse.down && canUse) {
        if (me.useT <= 0) { me.useT = h.time; me.useMax = h.time; }
      }
      if (mouse.clicked && !canUse) {
        hint(item.type === 'mini' ? 'Minis cap shield at 50' : item.type === 'bandage' ? 'Bandages cap HP at 75' : 'Already full');
      }
      if (me.useT > 0) {
        if (!mouse.down) me.useT = 0; // cancel on release
        else {
          me.useT -= dt;
          if (me.useT <= 0) {
            if (item.type === 'bandage') { me.hp = Math.min(75, me.hp + 15); sfx('heal'); }
            if (item.type === 'medkit') { me.hp = 100; sfx('heal'); }
            if (item.type === 'mini') { me.shield = Math.min(50, me.shield + 25); sfx('shield'); }
            if (item.type === 'big') { me.shield = Math.min(100, me.shield + 50); sfx('shield'); }
            item.count--;
            if (item.count <= 0) { me.slots[me.sel] = null; me.sel = 0; }
          }
        }
      }
    }
  }

  // auto-pickup & nearby detection
  nearChest = null; nearLoot = null;
  let bestChD = 80 * 80, bestLoD = 70 * 70;
  for (const ch of chests) {
    if (ch.open) continue;
    const d2v = dist2(me.x, me.y, ch.x, ch.y);
    if (d2v < bestChD) { bestChD = d2v; nearChest = ch; }
  }
  for (let i = loots.length - 1; i >= 0; i--) {
    const lo = loots[i];
    const d2v = dist2(me.x, me.y, lo.x, lo.y);
    if (d2v < 38 * 38) {
      // walk-over auto pickup (mats always; others if room)
      if (lo.kind === 'mats' || pickupLoot(me, lo)) {
        if (lo.kind === 'mats') { me.mats = Math.min(999, me.mats + lo.count); sfx('pickup', 0.6); }
        loots.splice(i, 1);
        continue;
      }
    }
    if (d2v < bestLoD) { bestLoD = d2v; nearLoot = lo; }
  }
}

/* ---------------- update ---------------- */
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = clamp((t - lastT) / 1000, 0, 0.05);
  lastT = t;
  update(dt);
  render(t / 1000);
}
function update(dt) {
  game.time += dt;
  if (game.phase === 'menu') {
    // slow camera drift over the island
    const a = game.time * 0.05;
    cam.x = W / 2 + Math.cos(a) * 600;
    cam.y = W / 2 + Math.sin(a * 0.8) * 600;
    updateFx(dt);
    mouse.clicked = false;
    return;
  }
  updateBus(dt);
  updateStorm(dt);
  if (me && me.dropped) updateMe(dt);
  for (const p of players) if (p.isBot && p.alive && p.dropped) updateBot(p, dt);
  updateBullets(dt);
  updateFx(dt);

  // camera
  let camTx, camTy;
  if (game.phase === 'bus' && !me.dropped) { camTx = bus.x; camTy = bus.y; }
  else { camTx = me.x + Math.cos(me.aim) * 40; camTy = me.y + Math.sin(me.aim) * 40; }
  cam.x = lerp(cam.x, camTx, Math.min(1, dt * 7));
  cam.y = lerp(cam.y, camTy, Math.min(1, dt * 7));

  mouse.clicked = false;
}
function updateFx(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    if (p.t <= 0) particles.splice(i, 1);
  }
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    d.t -= dt; d.y -= 50 * dt;
    if (d.t <= 0) dmgNums.splice(i, 1);
  }
  for (let i = feed.length - 1; i >= 0; i--) {
    feed[i].t -= dt;
    if (feed[i].t <= 0) feed.splice(i, 1);
  }
  if (announceT > 0) announceT -= dt;
  if (hintT > 0) hintT -= dt;
  shake = Math.max(0, shake - dt * 26);
  for (const lo of loots) lo.bob += dt * 3;
  for (const tr of trees) if (tr.hitT > 0) tr.hitT -= dt;
}

/* ---------------- rendering ---------------- */
let groundPattern = null;
function makeGround() {
  const t = document.createElement('canvas');
  t.width = t.height = 256;
  const g = t.getContext('2d');
  g.fillStyle = '#79c850';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 130; i++) {
    g.fillStyle = chance(0.5) ? 'rgba(106,180,66,0.5)' : 'rgba(140,214,96,0.45)';
    const x = rand(0, 256), y = rand(0, 256), r = rand(1.5, 4);
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = 'rgba(96,170,58,0.6)';
    g.lineWidth = 1.6;
    const x = rand(0, 256), y = rand(0, 256);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-3, 3), y - rand(4, 8)); g.stroke();
  }
  groundPattern = ctx.createPattern(t, 'repeat');
}
const S = (wx, wy) => ({ x: wx - cam.x + view.w / 2, y: wy - cam.y + view.h / 2 });

function render(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // screen shake
  if (shake > 0.2) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
  // ocean backdrop
  ctx.fillStyle = '#3f7fd2';
  ctx.fillRect(-20, -20, view.w + 40, view.h + 40);
  // island
  const o = S(0, 0);
  if (!groundPattern) makeGround();
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = groundPattern;
  ctx.fillRect(0, 0, W, W);
  // beach edge
  ctx.strokeStyle = '#e8d8a0'; ctx.lineWidth = 14; ctx.strokeRect(-7, -7, W + 14, W + 14);
  // darker grass patches
  for (const pa of patches) {
    ctx.save(); ctx.translate(pa.x, pa.y); ctx.rotate(pa.a);
    ctx.fillStyle = 'rgba(70,140,40,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 0, pa.rx, pa.ry, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // storm target ring (on ground)
  if (game.phase !== 'menu' && storm.state === 'shrink') {
    const c = S(storm.tx, storm.ty);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y, storm.tr, 0, 7); ctx.stroke();
  }

  drawLoots(time);
  drawChests(time);
  drawWalls();
  drawRocks();
  drawBullets();
  drawPlayers(time, false); // grounded
  drawBushes();
  drawTrees(time);
  drawParticles();
  drawStormOverlay(time);
  drawPlayers(time, true); // airborne, above everything
  drawBus(time);
  drawDmgNums();

  if (game.phase !== 'menu') {
    drawBuildGhost();
    drawHUD(time);
    drawCrosshair();
  }
}
function drawLoots(time) {
  for (const lo of loots) {
    const s = S(lo.x, lo.y);
    if (s.x < -60 || s.y < -60 || s.x > view.w + 60 || s.y > view.h + 60) continue;
    const bob = Math.sin(lo.bob) * 3;
    ctx.save();
    ctx.translate(s.x, s.y + bob);
    if (lo.kind === 'weapon') {
      const rc = RARITY[lo.rarity].color;
      ctx.shadowColor = rc; ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(20,24,40,0.85)';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rc; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.stroke();
      drawGunIcon(lo.type, 0, 0, 0.55, rc);
    } else if (lo.kind === 'heal') {
      const hc = HEALS[lo.type].color;
      ctx.shadowColor = hc; ctx.shadowBlur = 10;
      ctx.fillStyle = hc;
      ctx.beginPath(); ctx.roundRect(-7, -9, 14, 18, 4); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -3, 8, 3);
      ctx.fillRect(-1.5, -5.5, 3, 8);
    } else { // mats
      ctx.fillStyle = '#a0682f';
      ctx.save(); ctx.rotate(0.5);
      ctx.fillRect(-10, -4, 20, 8);
      ctx.fillStyle = '#c08a48'; ctx.fillRect(-10, -4, 20, 3);
      ctx.restore();
      ctx.fillStyle = '#8a5524'; ctx.fillRect(-9, 1, 18, 6);
    }
    ctx.restore();
  }
}
function drawGunIcon(type, x, y, scale, color) {
  const st = WEAPONS[type];
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.rotate(-0.5);
  ctx.fillStyle = color || '#dfe4ee';
  ctx.fillRect(-st.len / 2, -st.wide / 2, st.len, st.wide);
  ctx.fillRect(-st.len / 6, st.wide / 2 - 1, 6, 9);
  ctx.restore();
}
function drawChests(time) {
  for (const ch of chests) {
    const s = S(ch.x, ch.y);
    if (s.x < -80 || s.y < -80 || s.x > view.w + 80 || s.y > view.h + 80) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    if (ch.llama && !ch.open) {
      // supply llama: purple piñata buddy
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(0, 16, 20, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#9b59d0';
      ctx.beginPath(); ctx.roundRect(-16, -10, 32, 22, 7); ctx.fill();   // body
      ctx.beginPath(); ctx.roundRect(6, -26, 12, 20, 5); ctx.fill();     // neck/head
      ctx.fillStyle = '#b97fe8';
      ctx.fillRect(-16, 4, 32, 4);
      ctx.fillStyle = '#7a3bb0';
      ctx.fillRect(8, -30, 3, 6); ctx.fillRect(13, -30, 3, 6);           // ears
      ctx.fillStyle = '#fff'; ctx.fillRect(14, -22, 3, 3);               // eye
    } else if (!ch.open) {
      const pulse = 0.6 + Math.sin(time * 3 + ch.glow) * 0.4;
      ctx.shadowColor = 'rgba(255,200,60,' + pulse + ')'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#c8932e';
      ctx.beginPath(); ctx.roundRect(-18, -13, 36, 26, 5); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a8761e'; ctx.fillRect(-18, -3, 36, 3);
      ctx.fillStyle = '#ffd54a'; ctx.fillRect(-3, -6, 6, 9);
      ctx.strokeStyle = '#7a5410'; ctx.lineWidth = 2; ctx.strokeRect(-18, -13, 36, 26);
    } else {
      ctx.fillStyle = '#8a6a28';
      ctx.beginPath(); ctx.roundRect(-16, -8, 32, 18, 4); ctx.fill();
      ctx.fillStyle = '#5e470f'; ctx.fillRect(-13, -5, 26, 9);
    }
    ctx.restore();
  }
}
function drawWalls() {
  for (const wall of walls.values()) {
    const s = S(wall.cx * GRID, wall.cy * GRID);
    if (s.x < -GRID || s.y < -GRID || s.x > view.w + GRID || s.y > view.h + GRID) continue;
    ctx.fillStyle = '#a8743e';
    ctx.fillRect(s.x, s.y, GRID, GRID);
    ctx.strokeStyle = '#7c5226'; ctx.lineWidth = 3;
    ctx.strokeRect(s.x + 2, s.y + 2, GRID - 4, GRID - 4);
    ctx.strokeStyle = 'rgba(124,82,38,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + GRID / 3); ctx.lineTo(s.x + GRID, s.y + GRID / 3);
    ctx.moveTo(s.x, s.y + GRID * 2 / 3); ctx.lineTo(s.x + GRID, s.y + GRID * 2 / 3);
    ctx.stroke();
    const hpK = wall.hp / wall.maxHp;
    if (hpK < 0.999) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(s.x + 8, s.y + GRID - 10, GRID - 16, 5);
      ctx.fillStyle = hpK > 0.5 ? '#8be04a' : '#ffb02e';
      ctx.fillRect(s.x + 8, s.y + GRID - 10, (GRID - 16) * hpK, 5);
    }
  }
}
function drawRocks() {
  for (const rk of rocks) {
    const s = S(rk.x, rk.y);
    if (s.x < -80 || s.y < -80 || s.x > view.w + 80 || s.y > view.h + 80) continue;
    ctx.save(); ctx.translate(s.x, s.y);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(3, rk.r * 0.5, rk.r, rk.r * 0.45, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#a8b0ba';
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2;
      const rr = rk.r * (0.85 + 0.18 * Math.sin(a * 3 + rk.seed * 9));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c2cad4';
    ctx.beginPath(); ctx.arc(-rk.r * 0.25, -rk.r * 0.3, rk.r * 0.45, 0, 7); ctx.fill();
    ctx.restore();
  }
}
function drawBushes() {
  for (const b of bushes) {
    const s = S(b.x, b.y);
    if (s.x < -80 || s.y < -80 || s.x > view.w + 80 || s.y > view.h + 80) continue;
    ctx.fillStyle = 'rgba(40,110,30,0.92)';
    ctx.beginPath(); ctx.arc(s.x, s.y, b.r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(60,140,42,0.9)';
    ctx.beginPath(); ctx.arc(s.x - b.r * 0.3, s.y - b.r * 0.25, b.r * 0.55, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + b.r * 0.35, s.y + b.r * 0.1, b.r * 0.5, 0, 7); ctx.fill();
  }
}
function drawTrees(time) {
  for (const t of trees) {
    const s = S(t.x, t.y);
    if (s.x < -120 || s.y < -120 || s.x > view.w + 120 || s.y > view.h + 120) continue;
    const wob = (t.hitT > 0 ? Math.sin(time * 50) * 3 : 0) + Math.sin(time * 1.2 + t.sway) * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.ellipse(s.x + 6, s.y + 8, t.r * 0.9, t.r * 0.42, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a5226';
    ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, 7); ctx.fill();
    ctx.fillStyle = t.hp < t.maxHp ? '#3e8a2e' : '#3f9430';
    ctx.beginPath(); ctx.arc(s.x + wob, s.y - 6, t.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#54b03c';
    ctx.beginPath(); ctx.arc(s.x + wob - t.r * 0.25, s.y - 6 - t.r * 0.28, t.r * 0.62, 0, 7); ctx.fill();
  }
}
function drawBullets() {
  ctx.lineWidth = 3;
  for (const b of bullets) {
    const s1 = S(b.px, b.py), s2 = S(b.x, b.y);
    ctx.strokeStyle = 'rgba(255,232,150,0.95)';
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
  }
}
function drawPlayers(time, airOnly) {
  for (const p of players) {
    if (!p.alive || !p.dropped) continue;
    if (!!p.air !== airOnly) continue;
    const s = S(p.x, p.y);
    if (s.x < -120 || s.y < -120 || s.x > view.w + 120 || s.y > view.h + 120) continue;
    const scale = 1 + p.alt * 0.7;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,' + (0.22 - p.alt * 0.12) + ')';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 14 + p.alt * 60, p.r * (1 - p.alt * 0.4), p.r * 0.45 * (1 - p.alt * 0.4), 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(s.x, s.y - p.alt * 80);
    ctx.scale(scale, scale);
    // parachute
    if (p.air && p.alt > 0.05) {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, -34, 26, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-24, -32); ctx.lineTo(-8, -6); ctx.moveTo(24, -32); ctx.lineTo(8, -6);
      ctx.stroke();
    }
    // weapon in hands
    if (!p.air) {
      ctx.save();
      ctx.rotate(p.aim);
      const item = p.isBot ? (p.botWeapon ? { kind: 'weapon', type: p.botWeapon.type } : { kind: 'pickaxe' }) : (selectedItem(p) || { kind: 'pickaxe' });
      if (p === me && me.buildMode) {
        // holding mats
        ctx.fillStyle = '#a0682f'; ctx.fillRect(10, -8, 16, 16);
      } else if (item.kind === 'weapon') {
        const st = WEAPONS[item.type];
        ctx.fillStyle = '#2e3442';
        ctx.fillRect(p.r - 6, -st.wide / 2, st.len, st.wide);
        ctx.fillStyle = '#525c70';
        ctx.fillRect(p.r - 6, -st.wide / 2, st.len * 0.45, st.wide);
      } else {
        // pickaxe (swing anim)
        const swingK = p.swingT > 0 ? Math.sin((1 - p.swingT * WEAPONS.pickaxe.rate) * Math.PI) : 0;
        ctx.rotate(-0.9 + swingK * 1.6);
        ctx.fillStyle = '#7a5226'; ctx.fillRect(p.r - 4, -3, 30, 6);
        ctx.fillStyle = '#aab4c2';
        ctx.beginPath(); ctx.moveTo(p.r + 26, -12); ctx.lineTo(p.r + 38, 0); ctx.lineTo(p.r + 26, 12); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // body
    const hidden = !p.air && inBush(p);
    ctx.globalAlpha = hidden ? (p === me ? 0.55 : 0.12) : 1;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p === me ? '#ffffff' : 'rgba(20,24,40,0.8)';
    ctx.stroke();
    // face direction nub
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(Math.cos(p.aim) * p.r * 0.55, Math.sin(p.aim) * p.r * 0.55, 5.5, 0, 7);
    ctx.fill();
    // hurt flash
    if (p.hurtT > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + p.hurtT + ')';
      ctx.beginPath(); ctx.arc(0, 0, p.r + 2, 0, 7); ctx.fill();
      p.hurtT = Math.max(0, p.hurtT - 0.016);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // name (bush campers stay hidden)
    if (p !== me && !(hidden && !p.air)) {
      ctx.font = '700 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(p.name, s.x + 1, s.y - p.r - 8 - p.alt * 80 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, s.x, s.y - p.r - 9 - p.alt * 80);
    }
  }
}
function drawBus(time) {
  if (!bus.active) return;
  const s = S(bus.x, bus.y);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(0, 130, 60, 18, 0, 0, 7); ctx.fill();
  ctx.rotate(bus.ang);
  // balloon
  ctx.fillStyle = '#7a3bff';
  ctx.beginPath(); ctx.ellipse(0, -52, 44, 26, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-30, -40); ctx.lineTo(-26, -12); ctx.moveTo(30, -40); ctx.lineTo(26, -12); ctx.stroke();
  // bus body
  ctx.fillStyle = '#3aa0ff';
  ctx.beginPath(); ctx.roundRect(-46, -14, 92, 30, 8); ctx.fill();
  ctx.fillStyle = '#bfe2ff';
  for (let i = -3; i <= 3; i++) ctx.fillRect(i * 12 - 4, -8, 8, 8);
  ctx.fillStyle = '#2e7cc2'; ctx.fillRect(-46, 8, 92, 8);
  ctx.restore();
  // drop prompt
  if (!me.dropped) {
    ctx.font = '900 26px "Arial Black", Arial';
    ctx.textAlign = 'center';
    const pulse = 0.7 + Math.sin(time * 6) * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('PRESS SPACE TO DROP', view.w / 2 + 2, view.h * 0.78 + 2);
    ctx.fillStyle = 'rgba(255,213,74,' + pulse + ')';
    ctx.fillText('PRESS SPACE TO DROP', view.w / 2, view.h * 0.78);
  }
}
function drawParticles() {
  for (const p of particles) {
    const s = S(p.x, p.y);
    ctx.globalAlpha = clamp(p.t / p.maxT, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(s.x - p.size / 2, s.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
function drawDmgNums() {
  ctx.textAlign = 'center';
  for (const d of dmgNums) {
    const s = S(d.x, d.y);
    ctx.globalAlpha = clamp(d.t / 0.9, 0, 1);
    ctx.font = '900 17px "Arial Black", Arial';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(d.val, s.x + 1.5, s.y + 1.5);
    ctx.fillStyle = d.color;
    ctx.fillText(d.val, s.x, s.y);
  }
  ctx.globalAlpha = 1;
}
function drawStormOverlay(time) {
  if (game.phase === 'menu') return;
  const c = S(storm.x, storm.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-10, -10, view.w + 20, view.h + 20);
  ctx.arc(c.x, c.y, storm.r, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(120,50,210,0.34)';
  ctx.fill('evenodd');
  // edge glow
  ctx.strokeStyle = 'rgba(190,110,255,' + (0.7 + Math.sin(time * 4) * 0.2) + ')';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(c.x, c.y, storm.r, 0, 7); ctx.stroke();
  ctx.restore();
}
function drawBuildGhost() {
  if (!me || !me.alive || !me.buildMode || me.air) return;
  const { cx, cy } = buildGhostCell();
  const ok = canPlaceWall(cx, cy) && me.mats >= 10;
  const s = S(cx * GRID, cy * GRID);
  ctx.fillStyle = ok ? 'rgba(120,220,120,0.3)' : 'rgba(230,80,80,0.3)';
  ctx.fillRect(s.x, s.y, GRID, GRID);
  ctx.strokeStyle = ok ? 'rgba(140,255,140,0.9)' : 'rgba(255,90,90,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(s.x, s.y, GRID, GRID);
}
function drawCrosshair() {
  if (game.phase === 'bus' && !me.dropped) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  const m = mouse, g = 5, l = 8;
  ctx.beginPath();
  ctx.moveTo(m.x - g - l, m.y); ctx.lineTo(m.x - g, m.y);
  ctx.moveTo(m.x + g, m.y); ctx.lineTo(m.x + g + l, m.y);
  ctx.moveTo(m.x, m.y - g - l); ctx.lineTo(m.x, m.y - g);
  ctx.moveTo(m.x, m.y + g); ctx.lineTo(m.x, m.y + g + l);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(m.x, m.y, 1.5, 0, 7); ctx.fill();
}

/* ---------------- HUD ---------------- */
function drawHUD(time) {
  ctx.textAlign = 'left';
  // ---- top left: alive & kills
  const alive = players.filter(p => p.alive).length;
  hudPanel(16, 16, 150, 64);
  ctx.font = '900 20px "Arial Black", Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText('👥 ' + alive, 32, 44);
  ctx.fillStyle = '#ffd54a';
  ctx.fillText('⚔ ' + (me ? me.kills : 0), 96, 44);
  ctx.font = '700 10px Arial';
  ctx.fillStyle = '#aab'; ctx.fillText('ALIVE', 32, 64); ctx.fillText('ELIMS', 96, 64);

  // ---- announcements
  if (announceT > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(announceT, 0, 1);
    ctx.font = '900 38px "Arial Black", Arial';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(announceBig, view.w / 2 + 2, 92);
    ctx.fillStyle = '#ffd54a'; ctx.fillText(announceBig, view.w / 2, 90);
    if (announceSmall) {
      ctx.font = '700 16px Arial';
      ctx.fillStyle = '#fff'; ctx.fillText(announceSmall, view.w / 2, 118);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
  // ---- hint
  if (hintT > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(hintT, 0, 1);
    ctx.font = '700 15px Arial';
    ctx.fillStyle = '#fff';
    ctx.fillText(hintText, view.w / 2, view.h - 170);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
  // ---- interact prompt
  if (me && me.alive && !me.air) {
    let prompt = null;
    if (nearChest) prompt = nearChest.llama ? 'E — Crack the Llama' : 'E — Open Chest';
    else if (nearLoot) {
      const nm = nearLoot.kind === 'weapon' ? RARITY[nearLoot.rarity].name + ' ' + WEAPONS[nearLoot.type].name
        : nearLoot.kind === 'heal' ? HEALS[nearLoot.type].name : 'Mats';
      prompt = 'E — Take ' + nm;
    }
    if (prompt) {
      ctx.textAlign = 'center';
      ctx.font = '700 15px Arial';
      const wdt = ctx.measureText(prompt).width;
      hudPanel(view.w / 2 - wdt / 2 - 14, view.h - 152, wdt + 28, 30);
      ctx.fillStyle = '#ffd54a';
      ctx.fillText(prompt, view.w / 2, view.h - 132);
      ctx.textAlign = 'left';
    }
  }

  // ---- bottom left: hp / shield
  const bx = 16, bw = 260, byS = view.h - 74, byH = view.h - 48;
  hudPanel(bx - 4, byS - 18, bw + 24, 66);
  // shield
  ctx.fillStyle = 'rgba(40,60,90,0.8)';
  ctx.beginPath(); ctx.roundRect(bx + 8, byS - 6, bw, 13, 6); ctx.fill();
  ctx.fillStyle = '#57c8ff';
  if (me && me.shield > 0) { ctx.beginPath(); ctx.roundRect(bx + 8, byS - 6, bw * clamp(me.shield / 100, 0, 1), 13, 6); ctx.fill(); }
  // hp
  ctx.fillStyle = 'rgba(60,40,40,0.8)';
  ctx.beginPath(); ctx.roundRect(bx + 8, byH - 6, bw, 17, 7); ctx.fill();
  const hpK = me ? clamp(me.hp / 100, 0, 1) : 0;
  ctx.fillStyle = hpK > 0.5 ? '#7ae04a' : hpK > 0.25 ? '#ffb02e' : '#ff4d5e';
  ctx.beginPath(); ctx.roundRect(bx + 8, byH - 6, bw * hpK, 17, 7); ctx.fill();
  ctx.font = '900 13px "Arial Black", Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText(Math.ceil(me ? me.shield : 0), bx + bw + 16, byS + 5);
  ctx.fillText(Math.ceil(me ? Math.max(0, me.hp) : 0), bx + bw + 16, byH + 7);

  // ---- bottom center: hotbar
  const slotW = 56, gap = 7;
  const hbW = slotW * 5 + gap * 4;
  const hbX = view.w / 2 - hbW / 2, hbY = view.h - 78;
  for (let i = 0; i < 5; i++) {
    const x = hbX + i * (slotW + gap);
    const item = me ? me.slots[i] : null;
    const isSel = me && me.sel === i && !me.buildMode;
    ctx.fillStyle = isSel ? 'rgba(40,46,80,0.92)' : 'rgba(14,17,34,0.82)';
    ctx.beginPath(); ctx.roundRect(x, hbY, slotW, slotW, 9); ctx.fill();
    if (item && item.kind === 'weapon') {
      ctx.strokeStyle = RARITY[item.rarity].color; ctx.lineWidth = isSel ? 3 : 2;
    } else {
      ctx.strokeStyle = isSel ? '#ffd54a' : 'rgba(120,130,180,0.55)'; ctx.lineWidth = isSel ? 3 : 1.5;
    }
    ctx.beginPath(); ctx.roundRect(x, hbY, slotW, slotW, 9); ctx.stroke();
    // contents
    if (i === 0) {
      // pickaxe icon
      ctx.save(); ctx.translate(x + slotW / 2, hbY + slotW / 2); ctx.rotate(-0.7);
      ctx.fillStyle = '#7a5226'; ctx.fillRect(-3, -14, 6, 28);
      ctx.fillStyle = '#aab4c2';
      ctx.beginPath(); ctx.moveTo(-12, -14); ctx.lineTo(12, -14); ctx.lineTo(0, -6); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (item) {
      if (item.kind === 'weapon') drawGunIcon(item.type, x + slotW / 2, hbY + slotW / 2, 0.85, RARITY[item.rarity].color);
      else if (item.kind === 'heal') {
        ctx.fillStyle = HEALS[item.type].color;
        ctx.beginPath(); ctx.roundRect(x + slotW / 2 - 9, hbY + slotW / 2 - 12, 18, 24, 5); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(x + slotW / 2 - 5, hbY + slotW / 2 - 3, 10, 4);
        ctx.fillRect(x + slotW / 2 - 2, hbY + slotW / 2 - 6, 4, 10);
        ctx.font = '900 12px Arial'; ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
        ctx.fillText(item.count, x + slotW - 5, hbY + slotW - 6);
        ctx.textAlign = 'left';
      }
    }
    ctx.font = '700 10px Arial'; ctx.fillStyle = 'rgba(200,206,240,0.8)';
    ctx.fillText(i + 1, x + 5, hbY + 13);
  }
  // selected weapon label + ammo
  if (me) {
    const item = selectedItem(me);
    ctx.textAlign = 'center';
    if (me.buildMode) {
      ctx.font = '900 15px "Arial Black", Arial';
      ctx.fillStyle = '#8be04a';
      ctx.fillText('BUILD MODE [Q to exit]', view.w / 2, hbY - 26);
    } else if (item && item.kind === 'weapon') {
      ctx.font = '900 15px "Arial Black", Arial';
      ctx.fillStyle = RARITY[item.rarity].color;
      ctx.fillText(RARITY[item.rarity].name + ' ' + WEAPONS[item.type].name, view.w / 2, hbY - 26);
      ctx.font = '900 17px "Arial Black", Arial';
      ctx.fillStyle = '#fff';
      ctx.fillText(me.reloadT > 0 ? 'RELOADING' : item.mag + ' / ' + WEAPONS[item.type].mag, view.w / 2, hbY - 6);
    } else if (item && item.kind === 'heal') {
      ctx.font = '900 15px "Arial Black", Arial';
      ctx.fillStyle = HEALS[item.type].color;
      ctx.fillText(HEALS[item.type].name + ' — hold click to use', view.w / 2, hbY - 8);
    }
    // reload / use progress
    let prog = 0, progMax = 0;
    if (me.reloadT > 0) { prog = me.reloadMax - me.reloadT; progMax = me.reloadMax; }
    if (me.useT > 0) { prog = me.useMax - me.useT; progMax = me.useMax; }
    if (progMax > 0) {
      const pw = 170;
      ctx.fillStyle = 'rgba(10,12,28,0.8)';
      ctx.beginPath(); ctx.roundRect(view.w / 2 - pw / 2, hbY - 52, pw, 9, 5); ctx.fill();
      ctx.fillStyle = me.useT > 0 ? '#57c8ff' : '#ffd54a';
      ctx.beginPath(); ctx.roundRect(view.w / 2 - pw / 2, hbY - 52, pw * clamp(prog / progMax, 0, 1), 9, 5); ctx.fill();
    }
    ctx.textAlign = 'left';
  }

  // ---- bottom right: mats
  hudPanel(view.w - 126, view.h - 76, 110, 54);
  ctx.fillStyle = '#a0682f'; ctx.fillRect(view.w - 112, view.h - 60, 24, 14);
  ctx.fillStyle = '#c08a48'; ctx.fillRect(view.w - 112, view.h - 60, 24, 5);
  ctx.font = '900 22px "Arial Black", Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText(me ? me.mats : 0, view.w - 78, view.h - 46);
  ctx.font = '700 10px Arial'; ctx.fillStyle = '#aab';
  ctx.fillText('MATS [Q builds]', view.w - 112, view.h - 32);

  // ---- minimap (top right)
  const mmS = 168, mmX = view.w - mmS - 16, mmY = 16;
  ctx.fillStyle = 'rgba(10,14,30,0.78)';
  ctx.beginPath(); ctx.roundRect(mmX - 4, mmY - 4, mmS + 8, mmS + 8, 10); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(mmX, mmY, mmS, mmS, 7); ctx.clip();
  ctx.fillStyle = '#5d9c41';
  ctx.fillRect(mmX, mmY, mmS, mmS);
  const k = mmS / W;
  // storm on minimap
  ctx.beginPath();
  ctx.rect(mmX, mmY, mmS, mmS);
  ctx.arc(mmX + storm.x * k, mmY + storm.y * k, storm.r * k, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(130,60,220,0.45)';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#d8b4ff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(mmX + storm.x * k, mmY + storm.y * k, storm.r * k, 0, 7); ctx.stroke();
  if (storm.state === 'shrink') {
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(mmX + storm.tx * k, mmY + storm.ty * k, storm.tr * k, 0, 7); ctx.stroke();
  }
  // bus line
  if (bus.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(mmX + bus.x0 * k, mmY + bus.y0 * k); ctx.lineTo(mmX + bus.x1 * k, mmY + bus.y1 * k); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3aa0ff';
    ctx.beginPath(); ctx.arc(mmX + bus.x * k, mmY + bus.y * k, 4, 0, 7); ctx.fill();
  }
  // me
  if (me && me.alive && me.dropped) {
    const px = mmX + me.x * k, py = mmY + me.y * k;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();
  }
  ctx.restore();
  // storm timer under minimap
  let stormLabel;
  if (storm.phase >= STORM_PHASES.length) stormLabel = 'FINAL ZONE';
  else stormLabel = (storm.state === 'wait' ? 'Storm shrinks in ' : 'SHRINKING ') + fmtTime(storm.t);
  ctx.font = '700 13px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = storm.state === 'shrink' ? '#d8b4ff' : '#fff';
  ctx.fillText(stormLabel, mmX + mmS, mmY + mmS + 22);

  // ---- kill feed under storm timer
  ctx.font = '700 12px Arial';
  for (let i = 0; i < feed.length; i++) {
    const f = feed[i];
    ctx.globalAlpha = clamp(f.t / 1.5, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(f.text, mmX + mmS + 1, mmY + mmS + 46 + i * 19 + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, mmX + mmS, mmY + mmS + 45 + i * 19);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
function hudPanel(x, y, w, h) {
  ctx.fillStyle = 'rgba(10,14,30,0.72)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
}

/* ---------------- screens / flow ---------------- */
const menuEl = document.getElementById('menu');
const endEl = document.getElementById('end');
function showVictory() {
  endEl.style.background = 'rgba(8,10,25,0.45)';
  endEl.innerHTML = `
    <div class="placement gold">#1 VICTORY ROYALE</div>
    <div class="sub">${me.kills} elimination${me.kills === 1 ? '' : 's'} · ${BOT_COUNT + 1} players · absolute W</div>
    <button id="againBtn" class="btn">PLAY AGAIN</button>`;
  endEl.style.display = 'flex';
  document.getElementById('againBtn').onclick = () => location.reload();
}
function showDefeat(placement, killer) {
  endEl.style.background = 'rgba(8,10,25,0.45)';
  endEl.innerHTML = `
    <div class="placement red">#${placement}</div>
    <div class="sub">Eliminated by <b style="color:#fff">${killer}</b> · ${me.kills} elimination${me.kills === 1 ? '' : 's'}</div>
    <div class="sub" id="winnerLine" style="color:#ffd54a"></div>
    <button id="againBtn" class="btn">PLAY AGAIN</button>`;
  endEl.style.display = 'flex';
  document.getElementById('againBtn').onclick = () => location.reload();
}
function updateWinnerLine(name) {
  const el = document.getElementById('winnerLine');
  if (el) el.textContent = name + ' took the Victory Royale';
}
function confettiBurst() {
  for (let i = 0; i < 80; i++) {
    const a = rand(0, Math.PI * 2), s = rand(80, 420);
    particles.push({
      x: me.x, y: me.y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
      t: rand(0.8, 1.8), maxT: 1.8,
      color: pick(['#ffd54a', '#ff6b6b', '#4dabf7', '#69db7c', '#bb5cf5', '#fff']),
      size: rand(4, 8),
    });
  }
}
function startGame() {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  menuEl.style.display = 'none';
  endEl.style.display = 'none';
  genWorld();
  players = [];
  me = makePlayer('YOU', false, '#ffd54a');
  players.push(me);
  const names = BOT_NAMES.slice();
  for (let i = 0; i < BOT_COUNT; i++) {
    const idx = randi(0, names.length - 1);
    const nm = names.splice(idx, 1)[0] || ('Bot' + i);
    players.push(makePlayer(nm, true, BOT_COLORS[i % BOT_COLORS.length]));
  }
  Object.assign(storm, { x: W / 2, y: W / 2, r: 1500, phase: 0, state: 'wait', t: STORM_PHASES[0].wait });
  bullets = []; particles = []; dmgNums = []; feed = [];
  game.phase = 'bus'; game.over = false; game.meDead = false; game.winner = null; game.time = 0;
  startBus();
}
document.getElementById('playBtn').addEventListener('click', startGame);

/* ---------------- boot ---------------- */
genWorld(); // pretty backdrop behind the menu
makeGround();
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });

// expose for testing
window.G = () => ({ game, me, players, storm, bullets, loots, walls, bus });
