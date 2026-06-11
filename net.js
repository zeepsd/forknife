'use strict';
/* ============================================================
   FORKNIFE net — play-with-friends P2P multiplayer (PeerJS)

   Host-authoritative: the host's browser runs the whole sim
   (bots, bullets, storm, loot) exactly like solo. Guests send
   inputs and render snapshots. Movement is client-authoritative
   for guests (zero input lag; it's a friends game, not an
   anti-cheat problem).

   Wire protocol (reliable ordered DataChannel, ~per message):
     guest -> host:  {t:'hello',name}  {t:'in',...30Hz}  {t:'act',a,...}
     host -> guest:  {t:'lobby',names} {t:'reject',why}
                     {t:'start',you,roster,world}  {t:'snap',...15Hz}
   ============================================================ */

const SNAP_MS = 66;        // ~15 snapshots/sec
const INPUT_MS = 33;       // ~30 input packets/sec
const INTERP = 0.12;       // guests render remotes 120ms in the past
const MAX_GUESTS = 5;

let peer = null;
let roomCode = '';
let selfName = '';
let hostGuests = [];       // host: [{id, name, conn}]
let guestConn = null;      // guest: connection to host
let snapTimer = null, inputTimer = null;
let pendingSnaps = [];
let playerById = new Map();
let bulletById = new Map();
let winnerShown = false;
let stormTick = 0;
let busDirX = 0, busDirY = 0;

/* ---------------- tiny utils ---------------- */
const r0 = Math.round;
function cleanName(n) {
  n = String(n || '').replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 12);
  return n || null;
}
function aLerp(a, b, k) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * k;
}
function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — they read like 1/0
  let c = '';
  for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}
function getName() {
  const v = cleanName(document.getElementById('nameInput').value);
  return v || 'PLAYER' + randi(10, 99);
}
function setStatus(msg) { document.getElementById('netStatus').textContent = msg || ''; }
function destroyPeer() {
  if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
  if (inputTimer) { clearInterval(inputTimer); inputTimer = null; }
  if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
  hostGuests = []; guestConn = null; pendingSnaps = [];
}
window.netShutdown = () => { destroyPeer(); NET.mode = 'solo'; };

/* ---------------- lobby UI ---------------- */
const lobbyEl = document.getElementById('lobby');
const lobbyListEl = document.getElementById('lobbyList');
const startBtnEl = document.getElementById('startBtn');
const lobbyWaitEl = document.getElementById('lobbyWait');

function showLobby(asHost) {
  document.getElementById('menu').style.display = 'none';
  lobbyEl.style.display = 'flex';
  document.getElementById('lobbyCode').textContent = roomCode;
  startBtnEl.style.display = asHost ? '' : 'none';
  lobbyWaitEl.style.display = asHost ? 'none' : '';
}
function renderLobbyList(names) {
  lobbyListEl.innerHTML = '';
  names.forEach((n, i) => {
    const div = document.createElement('div');
    div.textContent = (i === 0 ? '👑 ' : '🔪 ') + n;
    if (n === selfName) div.className = 'you';
    lobbyListEl.appendChild(div);
  });
}
function backToMenu(msg) {
  destroyPeer();
  NET.mode = 'solo';
  lobbyEl.style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
  setStatus(msg || '');
}

document.getElementById('hostBtn').addEventListener('click', () => { initAudio(); hostRoom(); });
document.getElementById('joinBtn').addEventListener('click', () => { initAudio(); joinRoom(); });
document.getElementById('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('joinBtn').click(); });
document.getElementById('leaveBtn').addEventListener('click', () => location.reload());
{
  const saved = localStorage.getItem('fk-name');
  if (saved) document.getElementById('nameInput').value = saved;
  document.getElementById('nameInput').addEventListener('change', e => localStorage.setItem('fk-name', e.target.value));
}

/* ============================================================
   HOST
   ============================================================ */
function hostRoom() {
  selfName = getName();
  localStorage.setItem('fk-name', selfName);
  roomCode = makeCode();
  setStatus('opening room…');
  destroyPeer();
  peer = new Peer('forknife-' + roomCode);
  peer.on('open', () => {
    setStatus('');
    showLobby(true);
    renderLobbyList([selfName]);
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') { hostRoom(); return; } // code taken — roll again
    backToMenu('connection error: ' + err.type);
  });
  peer.on('connection', conn => {
    conn.on('data', d => hostOnData(conn, d));
    conn.on('close', () => hostDropGuest(conn));
    conn.on('error', () => hostDropGuest(conn));
  });
  startBtnEl.onclick = () => {
    if (NET.mode === 'host') return;
    hostStartMatch();
  };
}
function lobbyNames() { return [selfName, ...hostGuests.map(g => g.name)]; }
function hostBroadcastLobby() {
  const names = lobbyNames();
  renderLobbyList(names);
  for (const g of hostGuests) if (g.conn.open) g.conn.send({ t: 'lobby', names });
}
function hostOnData(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    if (NET.mode === 'host') { conn.send({ t: 'reject', why: 'match already in progress' }); setTimeout(() => conn.close(), 200); return; }
    if (hostGuests.length >= MAX_GUESTS) { conn.send({ t: 'reject', why: 'room is full' }); setTimeout(() => conn.close(), 200); return; }
    let name = cleanName(d.name) || 'PLAYER' + randi(10, 99);
    while (lobbyNames().includes(name)) name = name.slice(0, 10) + randi(2, 9);
    hostGuests.push({ id: hostGuests.length + 1, name, conn });
    hostBroadcastLobby();
    return;
  }
  const g = hostGuests.find(x => x.conn === conn);
  if (!g) return;
  const p = playerById.get(g.id);
  if (!p || NET.mode !== 'host') return;
  if (d.t === 'in') {
    p.netInput = d;
  } else if (d.t === 'act') {
    if (!p.alive) return;
    switch (d.a) {
      case 'click': p.clickQueue = Math.min(4, p.clickQueue + 1); break;
      case 'slot': selectSlot(p, Math.max(0, Math.min(4, d.n | 0))); break;
      case 'reload': { const it = selectedItem(p); if (it && it.kind === 'weapon') startReload(p, it); break; }
      case 'interact': doInteract(p); break;
      case 'dropItem': dropSelected(p); break;
      case 'drop': if (bus.active && !p.dropped) dropPlayer(p, bus.x, bus.y); break;
      case 'place': tryPlaceWall(p, d.cx | 0, d.cy | 0); break;
    }
  }
}
function hostDropGuest(conn) {
  const idx = hostGuests.findIndex(g => g.conn === conn);
  if (idx < 0) return;
  const g = hostGuests.splice(idx, 1)[0];
  if (NET.mode !== 'host') {
    // still in lobby — reassign ids to match join order
    hostGuests.forEach((x, i) => { x.id = i + 1; });
    hostBroadcastLobby();
    return;
  }
  const p = playerById.get(g.id);
  if (p && p.alive) {
    p.alive = false;
    addFeed(`${p.name} disconnected`, '#8a8fb8');
    NET.emit({ e: 'feed', txt: `${p.name} disconnected`, c: '#8a8fb8' });
    dropHumanLoot(p);
    checkWin();
  }
}
function hostStartMatch() {
  startGame({ mode: 'host', myName: selfName, guests: hostGuests.map(g => ({ id: g.id, name: g.name })) });
  playerById = new Map(players.map(p => [p.id, p]));
  const roster = players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.isBot ? 1 : 0 }));
  const world = buildWorldPayload();
  for (const g of hostGuests) {
    if (g.conn.open) g.conn.send({ t: 'start', you: g.id, roster, world });
  }
  if (snapTimer) clearInterval(snapTimer);
  snapTimer = setInterval(() => {
    if (NET.mode !== 'host') return;
    const snap = buildSnapshot();
    for (const g of hostGuests) if (g.conn.open) g.conn.send(snap);
  }, SNAP_MS);
}
window.netRematch = () => {
  if (peer && NET.mode === 'host') hostStartMatch();
  else location.reload();
};
function buildWorldPayload() {
  return {
    trees: trees.map(t => ({ id: t.id, x: r0(t.x), y: r0(t.y), r: r0(t.r), hp: t.hp })),
    rocks: rocks.map(k => ({ id: k.id, x: r0(k.x), y: r0(k.y), r: r0(k.r), seed: +k.seed.toFixed(2) })),
    bushes: bushes.map(b => ({ x: r0(b.x), y: r0(b.y), r: r0(b.r) })),
    patches: patches.map(pa => ({ x: r0(pa.x), y: r0(pa.y), rx: r0(pa.rx), ry: r0(pa.ry), a: +pa.a.toFixed(2) })),
    chests: chests.map(c => ({ id: c.id, x: r0(c.x), y: r0(c.y), open: c.open ? 1 : 0, llama: c.llama ? 1 : 0 })),
    loots: loots.map(lo => ({ id: lo.id, x: r0(lo.x), y: r0(lo.y), kind: lo.kind, type: lo.type, rarity: lo.rarity, count: lo.count, mag: lo.mag })),
  };
}
function heldOf(p) {
  if (p.isBot) return p.botWeapon ? p.botWeapon.type : 'pickaxe';
  const it = selectedItem(p);
  return (it && it.kind === 'weapon') ? it.type : 'pickaxe';
}
function encodeSlots(slots) {
  return slots.map(s => s ? { k: s.kind, t: s.type, r: s.rarity, m: s.mag, c: s.count } : 0);
}
function buildSnapshot() {
  const snap = {
    t: 'snap',
    ph: game.phase,
    over: game.over ? 1 : 0,
    win: game.over && game.winner ? game.winnerId : -1,
    st: {
      x: r0(storm.x), y: r0(storm.y), r: r0(storm.r),
      phase: storm.phase, state: storm.state, t: +storm.t.toFixed(2),
      tx: r0(storm.tx), ty: r0(storm.ty), tr: r0(storm.tr),
    },
    p: players.map(p => {
      const e = {
        i: p.id, x: r0(p.x), y: r0(p.y), a: +p.aim.toFixed(2),
        hp: Math.max(0, Math.ceil(p.hp)), sh: r0(p.shield),
        al: p.alive ? 1 : 0, air: p.air ? 1 : 0, alt: +p.alt.toFixed(2),
        dr: p.dropped ? 1 : 0, h: heldOf(p), sw: p.swingT > 0 ? 1 : 0,
        k: p.kills, bf: p.buildFlag ? 1 : 0,
      };
      if (!p.isBot) {
        e.m = p.mats; e.sl = encodeSlots(p.slots); e.se = p.sel;
        e.rt = +p.reloadT.toFixed(2); e.rm = p.reloadMax;
        e.ut = +p.useT.toFixed(2); e.um = p.useMax;
      }
      return e;
    }),
    b: bullets.map(b => ({ i: b.id, w: b.w, x: r0(b.x), y: r0(b.y), dx: +b.dx.toFixed(3), dy: +b.dy.toFixed(3), sp: r0(b.speed) })),
    w: [...walls.values()].map(w => ({ x: w.cx, y: w.cy, hp: r0(w.hp) })),
    ev: NET.events.splice(0),
  };
  if (bus.active) snap.bus = { x: r0(bus.x), y: r0(bus.y), x0: r0(bus.x0), y0: r0(bus.y0), x1: r0(bus.x1), y1: r0(bus.y1) };
  return snap;
}

/* ============================================================
   GUEST
   ============================================================ */
function joinRoom() {
  selfName = getName();
  localStorage.setItem('fk-name', selfName);
  const code = (document.getElementById('codeInput').value || '').toUpperCase().trim();
  if (code.length !== 4) { setStatus('enter the 4-letter room code'); return; }
  roomCode = code;
  setStatus('connecting…');
  destroyPeer();
  peer = new Peer();
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') backToMenu('no room with code ' + code);
    else backToMenu('connection error: ' + err.type);
  });
  peer.on('open', () => {
    guestConn = peer.connect('forknife-' + code, { reliable: true });
    guestConn.on('open', () => {
      guestConn.send({ t: 'hello', name: selfName });
      setStatus('');
      showLobby(false);
      renderLobbyList([selfName]);
    });
    guestConn.on('data', guestOnData);
    guestConn.on('close', () => guestLostHost());
    guestConn.on('error', () => guestLostHost());
  });
}
function guestLostHost() {
  if (NET.mode !== 'guest') { backToMenu('host closed the room'); return; }
  const endEl2 = document.getElementById('end');
  endEl2.style.background = 'rgba(8,10,25,0.7)';
  endEl2.innerHTML = `
    <div class="placement red">CONNECTION LOST</div>
    <div class="sub">the host left the match</div>
    <button id="againBtn" class="btn">BACK TO MENU</button>`;
  endEl2.style.display = 'flex';
  document.getElementById('againBtn').onclick = () => location.reload();
}
function guestOnData(d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'lobby') { renderLobbyList(d.names); selfName = d.names.find(n => n === selfName) || selfName; }
  else if (d.t === 'reject') backToMenu(d.why);
  else if (d.t === 'start') initGuestGame(d);
  else if (d.t === 'snap') { pendingSnaps.push(d); if (pendingSnaps.length > 8) pendingSnaps.shift(); }
}
function initGuestGame(d) {
  NET.mode = 'guest';
  winnerShown = false;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('end').style.display = 'none';
  lobbyEl.style.display = 'none';

  // rebuild the host's world locally
  trees = d.world.trees.map(t => ({ id: t.id, x: t.x, y: t.y, r: t.r, hp: t.hp, maxHp: 150, sway: rand(0, 6.28), hitT: 0 }));
  rocks = d.world.rocks.map(k => ({ id: k.id, x: k.x, y: k.y, r: k.r, hp: 250, maxHp: 250, seed: k.seed }));
  bushes = d.world.bushes.map(b => ({ x: b.x, y: b.y, r: b.r }));
  patches = d.world.patches.map(pa => ({ x: pa.x, y: pa.y, rx: pa.rx, ry: pa.ry, a: pa.a }));
  chests = d.world.chests.map(c => ({ id: c.id, x: c.x, y: c.y, open: !!c.open, llama: !!c.llama, glow: rand(0, 6.28) }));
  loots = d.world.loots.map(lo => ({ id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, type: lo.type, rarity: lo.rarity, count: lo.count, mag: lo.mag, bob: rand(0, 6.28) }));
  walls.clear();

  players = d.roster.map(r => {
    const p = makePlayer(r.name, false, r.color);
    p.id = r.id;
    p.buf = [];
    if (r.bot) p.heldOverride = 'pickaxe';
    return p;
  });
  playerById = new Map(players.map(p => [p.id, p]));
  me = playerById.get(d.you);
  me.heldOverride = null;

  bullets = []; particles = []; dmgNums = []; feed = [];
  bulletById = new Map();
  game.phase = 'bus'; game.over = false; game.meDead = false; game.winner = null; game.winnerId = -1; game.time = 0;
  stormTick = 0;
  Object.assign(storm, { x: W / 2, y: W / 2, r: 1500, phase: 0, state: 'wait', t: STORM_PHASES[0].wait });
  bus.active = true;

  if (inputTimer) clearInterval(inputTimer);
  inputTimer = setInterval(sendInput, INPUT_MS);
}
function sendInput() {
  if (NET.mode !== 'guest' || !guestConn || !guestConn.open || !me) return;
  guestConn.send({
    t: 'in',
    x: r0(me.x), y: r0(me.y),
    alt: +me.alt.toFixed(3), air: me.air ? 1 : 0, dr: me.dropped ? 1 : 0,
    aim: +me.aim.toFixed(3),
    f: (me.alive && !me.air && mouse.down && !me.buildMode) ? 1 : 0,
    b: me.buildMode ? 1 : 0,
  });
}
window.netAction = (a, extra) => {
  if (NET.mode !== 'guest' || !guestConn || !guestConn.open) return;
  guestConn.send(Object.assign({ t: 'act', a }, extra || {}));
};
window.netGuestInteract = () => {
  // local UX checks, authoritative pickup happens on the host
  if (nearLoot && !nearChest && me.sel === 0) {
    const full = me.slots.slice(1).every(s => s) &&
      !(nearLoot.kind === 'mats') &&
      !(nearLoot.kind === 'heal' && me.slots.some(s => s && s.kind === 'heal' && s.type === nearLoot.type && s.count < HEALS[nearLoot.type].cap));
    if (full) { hint('Inventory full — select a slot (2-5) to swap'); return; }
  }
  window.netAction('interact');
};

/* ---------------- guest frame update ---------------- */
function decodeSlots(sl) {
  return sl.map(s => s ? { kind: s.k, type: s.t, rarity: s.r, mag: s.m, count: s.c } : null);
}
const sndThisSnap = new Set();
function applySnap(s) {
  game.phase = s.ph;
  game.over = !!s.over;
  Object.assign(storm, s.st);
  if (s.bus) {
    Object.assign(bus, s.bus);
    bus.active = true;
    const dl = dist(bus.x0, bus.y0, bus.x1, bus.y1) || 1;
    busDirX = (bus.x1 - bus.x0) / dl; busDirY = (bus.y1 - bus.y0) / dl;
  } else bus.active = false;

  walls.clear();
  for (const w of s.w) walls.set(cellKey(w.x, w.y), { cx: w.x, cy: w.y, hp: w.hp, maxHp: 150 });

  const seen = new Set();
  sndThisSnap.clear();
  for (const nb of s.b) {
    seen.add(nb.i);
    let b = bulletById.get(nb.i);
    if (!b) {
      b = { id: nb.i, x: nb.x, y: nb.y, px: nb.x, py: nb.y, dx: nb.dx, dy: nb.dy, speed: nb.sp };
      bulletById.set(nb.i, b);
      bullets.push(b);
      if (nb.w && !sndThisSnap.has(nb.w)) { sndThisSnap.add(nb.w); sfxAt(nb.w, nb.x, nb.y); }
    } else {
      b.x = nb.x; b.y = nb.y; b.dx = nb.dx; b.dy = nb.dy;
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (!seen.has(bullets[i].id)) { bulletById.delete(bullets[i].id); bullets.splice(i, 1); }
  }

  const now = performance.now() / 1000;
  for (const np of s.p) {
    const p = playerById.get(np.i);
    if (!p) continue;
    p.alive = !!np.al;
    p.kills = np.k;
    if (p === me) {
      p.hp = np.hp; p.shield = np.sh; p.mats = np.m;
      p.slots = decodeSlots(np.sl);
      if (p.sel !== 0 && !p.slots[p.sel]) p.sel = 0;
      p.reloadT = np.rt; p.reloadMax = np.rm;
      p.useT = np.ut; p.useMax = np.um;
      if (np.dr && !p.dropped) {
        p.dropped = true;
        p.air = np.air === 1; p.alt = np.alt;
        p.x = np.x; p.y = np.y;
      }
    } else {
      p.heldOverride = np.h;
      p.buildFlag = !!np.bf;
      p.dropped = !!np.dr;
      p.hp = np.hp;
      if (np.sw && p.swingT <= 0) p.swingT = 1 / WEAPONS.pickaxe.rate;
      p.buf.push({ t: now, x: np.x, y: np.y, aim: np.a, alt: np.alt, air: !!np.air });
      if (p.buf.length > 14) p.buf.shift();
    }
  }
  for (const ev of (s.ev || [])) applyEvent(ev);
  if (s.over && s.win >= 0) handleWinner(s.win);
}
function applyEvent(ev) {
  switch (ev.e) {
    case 'sfx':
      sfxAt(ev.s, ev.x, ev.y);
      if (ev.s === 'breakS') addParticles(ev.x, ev.y, '#9c6b38', 12, 160);
      if (ev.s === 'build') addParticles(ev.x, ev.y, '#b07c44', 5, 110);
      if (ev.s === 'thunk') addParticles(ev.x, ev.y, '#9aa3ad', 4, 100);
      break;
    case 'ann': announce(ev.b, ev.s, ev.snd); break;
    case 'dmg': {
      if (ev.sh > 0) addDmg(ev.x, ev.y, ev.sh, '#57c8ff');
      if (ev.hp > 0) addDmg(ev.x, ev.y + 8, ev.hp, '#ffffff');
      addParticles(ev.x, ev.y, ev.c || '#fff', 5, 140, 3);
      const v = playerById.get(ev.vid);
      if (v) v.hurtT = 0.3;
      if (ev.aid === me.id && ev.vid !== me.id) sfx('hitmark', 0.9);
      if (ev.vid === me.id) { sfx('hurt', 0.9); shake = Math.min(10, shake + 4); }
      break;
    }
    case 'mats': if (ev.vid === me.id) addDmg(ev.x, ev.y, ev.n, '#c8e664'); break;
    case 'kill': {
      addFeed(`${ev.an} eliminated ${ev.vn}`, ev.aid === me.id ? '#ffd54a' : (ev.vid === me.id ? '#ff5d6c' : '#e6e8ff'));
      if (ev.vid === me.id && !game.meDead) {
        game.meDead = true;
        sfx('lose');
        showDefeat(ev.place, ev.an);
      }
      break;
    }
    case 'feed': addFeed(ev.txt, ev.c); break;
    case 'lootA': loots.push(Object.assign({ bob: rand(0, 6.28) }, ev.lo)); break;
    case 'lootD': {
      const i = loots.findIndex(l => l.id === ev.id);
      if (i >= 0) loots.splice(i, 1);
      break;
    }
    case 'chest': {
      const c = chests.find(x => x.id === ev.id);
      if (c && !c.open) { c.open = true; addParticles(c.x, c.y, c.llama ? '#bb5cf5' : '#ffd54a', 16, 150); }
      break;
    }
    case 'treeHit': {
      const t = trees.find(x => x.id === ev.id);
      if (t) { t.hitT = 0.25; t.hp -= 50; addParticles(t.x, t.y, '#5a9c3c', 6, 120); }
      break;
    }
    case 'treeD': {
      const i = trees.findIndex(x => x.id === ev.id);
      if (i >= 0) { addParticles(trees[i].x, trees[i].y, '#4e8c34', 18, 180); trees.splice(i, 1); }
      break;
    }
    case 'rockD': {
      const i = rocks.findIndex(x => x.id === ev.id);
      if (i >= 0) { addParticles(rocks[i].x, rocks[i].y, '#8d959e', 18, 180); rocks.splice(i, 1); }
      break;
    }
  }
}
function handleWinner(winId) {
  if (winnerShown) return;
  winnerShown = true;
  const w = playerById.get(winId);
  game.winner = w || null;
  if (w === me && !game.meDead) { sfx('win'); showVictory(); confettiBurst(); }
  else if (w) updateWinnerLine(w.name);
}
function interpolate(p, renderT) {
  const buf = p.buf;
  if (buf.length === 1) {
    p.x = buf[0].x; p.y = buf[0].y; p.aim = buf[0].aim; p.alt = buf[0].alt; p.air = buf[0].air;
    return;
  }
  if (renderT >= buf[buf.length - 1].t) {
    const last = buf[buf.length - 1];
    p.x = last.x; p.y = last.y; p.aim = last.aim; p.alt = last.alt; p.air = last.air;
    return;
  }
  for (let i = buf.length - 2; i >= 0; i--) {
    if (buf[i].t <= renderT) {
      const a = buf[i], b = buf[i + 1];
      const k = clamp((renderT - a.t) / (b.t - a.t || 0.001), 0, 1);
      p.x = lerp(a.x, b.x, k); p.y = lerp(a.y, b.y, k);
      p.aim = aLerp(a.aim, b.aim, k);
      p.alt = lerp(a.alt, b.alt, k);
      p.air = b.air;
      return;
    }
  }
  const first = buf[0];
  p.x = first.x; p.y = first.y; p.aim = first.aim; p.alt = first.alt; p.air = first.air;
}
window.netGuestUpdate = (dt) => {
  while (pendingSnaps.length) applySnap(pendingSnaps.shift());

  // self: simulate own movement locally for zero input lag
  if (me.alive && me.dropped) {
    if (me.air) {
      updateAir(me, dt);
    } else {
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
        me.moving = true;
      } else me.moving = false;
      resolveWorld(me);

      me.fireCd -= dt; me.buildCd -= dt;
      if (me.reloadT > 0) me.reloadT = Math.max(0, me.reloadT - dt);
      if (me.useT > 0) me.useT = mouse.down ? Math.max(0.01, me.useT - dt) : 0;
      if (me.swingT > 0) me.swingT -= dt;
      // local swing animation; the host resolves the actual hit
      if (me.sel === 0 && mouse.down && !me.buildMode && me.swingT <= 0 && me.fireCd <= 0) {
        me.swingT = 1 / WEAPONS.pickaxe.rate;
        me.fireCd = 1 / WEAPONS.pickaxe.rate;
      }
      if (me.buildMode && (mouse.clicked || mouse.down) && me.buildCd <= 0) {
        if (me.mats < 10) { if (mouse.clicked) hint('Not enough mats (need 10)'); }
        else {
          const g = buildGhostCell(me);
          if (canPlaceWall(g.cx, g.cy)) { window.netAction('place', { cx: g.cx, cy: g.cy }); me.buildCd = 0.18; }
        }
      }
      if (mouse.clicked && !me.buildMode) window.netAction('click');

      // interact prompts (display only)
      nearChest = null; nearLoot = null;
      let bestChD = 80 * 80, bestLoD = 70 * 70;
      for (const ch of chests) {
        if (ch.open) continue;
        const d2v = dist2(me.x, me.y, ch.x, ch.y);
        if (d2v < bestChD) { bestChD = d2v; nearChest = ch; }
      }
      for (const lo of loots) {
        const d2v = dist2(me.x, me.y, lo.x, lo.y);
        if (d2v < bestLoD) { bestLoD = d2v; nearLoot = lo; }
      }
      // storm pain feedback (damage itself is applied by the host)
      if (dist2(me.x, me.y, storm.x, storm.y) > storm.r * storm.r) {
        stormTick += dt;
        if (stormTick > 0.8) { stormTick = 0; sfx('hurt', 0.5); }
      }
    }
  }

  // remote players: render 120ms in the past, between snapshots
  const renderT = performance.now() / 1000 - INTERP;
  for (const p of players) {
    if (p === me || !p.buf || p.buf.length === 0) continue;
    interpolate(p, renderT);
    if (p.swingT > 0) p.swingT -= dt;
  }
  // bullets fly between snapshots
  for (const b of bullets) {
    b.px = b.x; b.py = b.y;
    b.x += b.dx * b.speed * dt;
    b.y += b.dy * b.speed * dt;
  }
  // bus glides between snapshots
  if (bus.active) { bus.x += busDirX * 480 * dt; bus.y += busDirY * 480 * dt; }
  if (storm.t > 0) storm.t -= dt; // cosmetic countdown, resynced every snap

  updateFx(dt);

  let camTx, camTy;
  if (!me.dropped && bus.active) { camTx = bus.x; camTy = bus.y; }
  else { camTx = me.x + Math.cos(me.aim) * 40; camTy = me.y + Math.sin(me.aim) * 40; }
  cam.x = lerp(cam.x, camTx, Math.min(1, dt * 7));
  cam.y = lerp(cam.y, camTy, Math.min(1, dt * 7));
};

// host needs the id map for its own match too (solo skips all of this)
window.netHostPlayerMap = () => playerById;
