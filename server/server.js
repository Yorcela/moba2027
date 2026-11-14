'use strict';
// ─── Serveur de jeu en ligne de Campagne 2027 ─────────────────────────────────
// Serveur autoritaire : chaque salle fait tourner sa propre copie du moteur
// (src/data.js, map.js, game.js, ai.js chargés dans un contexte vm isolé) à 60 Hz
// et diffuse l'état aux joueurs ~20 fois par seconde. Les clients n'envoient que
// leurs intentions (déplacement, cible, sort, récolte, rappel, achat).
// Sert aussi les fichiers statiques du jeu : http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..');
const TICK = 1 / 60;
const SNAP_EVERY = 3; // 60 / 3 = 20 instantanés par seconde
const PICK_TIME = +process.env.PICK_TIME || 45; // s pour choisir son candidat
const MM_COOP_WAIT = +process.env.MM_COOP_WAIT || 20; // s avant de lancer une partie coop incomplète
const MM_PVP_WAIT = +process.env.MM_PVP_WAIT || 60; // s avant de compléter un 3 contre 3 avec des bots
const MAX_NAME = 18;

// ── Moteur : une copie isolée par salle ──
const SCRIPTS = ['data', 'map', 'game', 'ai'].map((f) => {
  const file = path.join(ROOT, 'src', f + '.js');
  return new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
});
function makeEngine() {
  const ctx = vm.createContext({ console, Math, Date, JSON });
  for (const s of SCRIPTS) s.runInContext(ctx);
  return vm.runInContext('({ Game, CFG, CAND_BY_ID, CANDIDATES, TEAMS, MAP })', ctx);
}
const REF = makeEngine(); // pour les données des candidats (lecture seule)

// ── Fichiers statiques ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { p = ''; }
  if (p === '/') p = '/index.html';
  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const ok = /^\/(index\.html|map\.html|src\/[\w-]+\.js|docs\/[\w-]+\.(jpg|png)|assets\/[\w\/-]+\.(glb|gltf|bin|png|jpg|txt|mp3))$/.test(p) && !p.includes('..');
  const file = path.join(ROOT, p);
  if (!ok || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Introuvable'); }
  // envoi en flux, avec les requêtes partielles (Range) pour la musique
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Introuvable'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : st.size - +m[2], end = m[1] && m[2] ? +m[2] : st.size - 1;
      if (start < 0 || start >= st.size || end < start) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

// ── Joueurs, salles, files d'attente ──
const rooms = new Map(); // code → salle
const queues = { coop: [], pvp: [] };
const queueSince = { coop: 0, pvp: 0 };
let nextPid = 1;

function send(pl, msg) { if (pl.ws.readyState === 1) pl.ws.send(JSON.stringify(msg)); }
function now() { return Date.now() / 1000; }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const pickRand = (a) => a[Math.floor(Math.random() * a.length)];

// mode 'coop' : tous les humains dans le même camp contre des bots ; 'pvp' : 3 contre 3
function createRoom(mode, opts) {
  const room = {
    code: newCode(), mode, phase: 'lobby', players: [], host: null,
    team: opts.team || pickRand(['gauche', 'droite']), duration: opts.duration || 10,
    matchmade: !!opts.matchmade, pickUntil: 0, engine: null, S: null, loop: null, step: 0, sent: new WeakSet(), logKey: '',
  };
  rooms.set(room.code, room);
  return room;
}
function roomInfo(room) {
  return {
    t: 'room', code: room.code, mode: room.mode, phase: room.phase, host: room.host, team: room.team, duration: room.duration,
    matchmade: room.matchmade, pickLeft: room.phase === 'pick' ? Math.max(0, room.pickUntil - now()) : 0,
    players: room.players.map((p) => ({ id: p.id, name: p.name, team: p.team, pick: p.pick, ready: p.ready })),
  };
}
function broadcastRoom(room) { const info = roomInfo(room); for (const p of room.players) send(p, info); }

function joinRoom(pl, room) {
  leave(pl);
  const max = room.mode === 'pvp' ? 6 : 3;
  if (room.phase !== 'lobby') return send(pl, { t: 'err', msg: 'La partie de cette salle a déjà commencé' });
  if (room.players.length >= max) return send(pl, { t: 'err', msg: 'Salle complète (3 joueurs)' });
  room.players.push(pl);
  pl.room = room; pl.pick = null; pl.ready = false; pl.team = room.team;
  if (!room.host) room.host = pl.id;
  broadcastRoom(room);
}

function leave(pl) {
  for (const m of ['coop', 'pvp']) {
    const i = queues[m].indexOf(pl);
    if (i >= 0) { queues[m].splice(i, 1); broadcastQueue(m); }
  }
  const room = pl.room;
  if (!room) return;
  pl.room = null;
  room.players = room.players.filter((p) => p !== pl);
  if (room.phase === 'play') {
    // la partie continue : un bot reprend le candidat
    const c = room.S && room.S.cands.find((x) => x.pid === pl.id);
    if (c) {
      c.isPlayer = false; c.kbDir = null; c.moveTo = null; c.target = null; c.ai.think = 0;
      for (const p of room.players) send(p, { t: 'toast', msg: `${pl.name} a quitté la partie : un bot reprend ${c.def.name}` });
    }
  } else {
    if (room.host === pl.id) room.host = room.players[0] ? room.players[0].id : null;
    if (room.phase === 'pick') checkPickDone(room);
  }
  if (!room.players.length) closeRoom(room);
  else if (room.phase === 'lobby' || room.phase === 'pick') broadcastRoom(room);
}
function closeRoom(room) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
  rooms.delete(room.code);
}

// ── Matchmaking ──
function broadcastQueue(mode) {
  const q = queues[mode];
  const wait = mode === 'coop' ? MM_COOP_WAIT : MM_PVP_WAIT;
  const left = q.length ? Math.max(0, queueSince[mode] + wait - now()) : wait;
  for (const p of q) send(p, { t: 'queue', mode, n: q.length, need: mode === 'coop' ? 3 : 6, left: Math.ceil(left), min: mode === 'pvp' ? 2 : 1 });
}
function enqueue(pl, mode) {
  leave(pl);
  if (!queues[mode].length) queueSince[mode] = now();
  queues[mode].push(pl);
  matchmake();
}
function matchmake() {
  const t = now();
  // coop : 3 joueurs, ou ceux qui attendent depuis assez longtemps (les bots complètent)
  const qc = queues.coop;
  while (qc.length >= 3 || (qc.length && t - queueSince.coop >= MM_COOP_WAIT)) {
    formMatch('coop', qc.splice(0, 3));
    queueSince.coop = t;
  }
  // 3 contre 3 : 6 joueurs, ou au moins 2 après l'attente (camps équilibrés, bots en renfort)
  const qp = queues.pvp;
  while (qp.length >= 6 || (qp.length >= 2 && t - queueSince.pvp >= MM_PVP_WAIT)) {
    formMatch('pvp', qp.splice(0, 6));
    queueSince.pvp = t;
  }
  broadcastQueue('coop'); broadcastQueue('pvp');
}
function formMatch(mode, group) {
  const room = createRoom(mode, { matchmade: true });
  // le serveur attribue les camps : on ne choisit pas son camp en matchmaking
  const order = group.slice().sort(() => Math.random() - 0.5);
  const first = pickRand(['gauche', 'droite']);
  order.forEach((p, i) => {
    room.players.push(p);
    p.room = room; p.pick = null; p.ready = false;
    p.team = mode === 'coop' ? room.team : i % 2 === 0 ? first : REF.TEAMS[first].enemy;
  });
  startPick(room);
}

// ── Sélection des candidats ──
function startPick(room) {
  room.phase = 'pick';
  room.pickUntil = now() + PICK_TIME;
  for (const p of room.players) { p.pick = null; p.ready = false; if (room.mode === 'coop') p.team = room.team; }
  broadcastRoom(room);
}
const CLS_ART = { tank: 'le tank', dps: 'le DPS', soutien: 'le soutien' };
function pickError(room, pl, candId) {
  const d = REF.CAND_BY_ID[candId];
  if (!d) return 'Candidat inconnu';
  if (d.team !== pl.team && !d.neutral) return 'Ce candidat appartient à l’autre camp';
  const other = room.players.find((p) => p !== pl && p.pick === candId);
  if (other) return `${d.name} est déjà choisi par ${other.name}`;
  // 1 tank, 1 DPS, 1 soutien par équipe
  const mate = room.players.find((p) => p !== pl && p.team === pl.team && p.pick && REF.CAND_BY_ID[p.pick].cls === d.cls);
  if (mate) return `${mate.name} joue déjà ${CLS_ART[d.cls]} de votre équipe`;
  return null;
}
function autoPick(room, pl) {
  pl.pick = null;
  const free = REF.CANDIDATES.filter((d) => !pickError(room, pl, d.id));
  const own = free.filter((d) => !d.neutral);
  const d = pickRand(own.length ? own : free);
  if (d) pl.pick = d.id;
}
function checkPickDone(room) {
  if (room.phase !== 'pick' || !room.players.length) return;
  const all = room.players.every((p) => p.pick && p.ready);
  if (!all && now() < room.pickUntil) return;
  for (const p of room.players) if (!p.pick || pickError(room, p, p.pick)) autoPick(room, p);
  startGame(room);
}

// ── Partie ──
function startGame(room) {
  const E = makeEngine();
  room.engine = E;
  E.CFG.timeLimit = room.duration * 60;
  const picks = room.players.map((p) => ({ candId: p.pick, team: p.team, pid: p.id, name: p.name }));
  room.S = E.Game.newGame(null, null, E.Game.buildRoster(picks), { online: true });
  room.phase = 'play';
  room.step = 0;
  const roster = room.S.cands.map((c) => ({ id: c.id, candId: c.def.id, team: c.team, pid: c.pid || 0, name: c.pname || '' }));
  for (const p of room.players) send(p, { t: 'start', roster, you: p.id, timeLimit: E.CFG.timeLimit, mode: room.mode, code: room.code });
  let last = process.hrtime.bigint(), acc = 0;
  room.loop = setInterval(() => {
    const t = process.hrtime.bigint();
    acc += Math.min(0.25, Number(t - last) / 1e9);
    last = t;
    while (acc >= TICK && !room.S.over) {
      acc -= TICK;
      E.Game.update(TICK);
      room.step++;
      if (room.step % SNAP_EVERY === 0 && !room.S.over) broadcastSnap(room);
    }
    if (room.S.over) {
      // dernier instantané avec le résultat, puis la salle se ferme
      room.phase = 'over';
      broadcastSnap(room);
      clearInterval(room.loop); room.loop = null;
      for (const p of room.players) p.room = null;
      room.players = [];
      rooms.delete(room.code);
    }
  }, 1000 / 60);
}

// ── Instantanés compacts ──
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
function ref(e) { return !e ? 0 : (e.kind === 'cand' ? 'c' : 'm') + e.id; }
const idMap = new WeakMap();
let nextObjId = 1;
function oid(o) { let i = idMap.get(o); if (!i) { i = nextObjId++; idMap.set(o, i); } return i; }
const FX_TYPES = ['ring', 'blast', 'heal', 'zone'];
function snapshot(room) {
  const S = room.S;
  const cands = S.cands.map((c) => {
    const st = c.st;
    return {
      i: c.id, x: r1(c.x), y: r1(c.y), h: Math.round(c.hp), H: Math.round(st.maxHp), I: r2(c.I), d: c.dead ? 1 : 0,
      ra: r2(c.respawnAt), da: r2(c.diedAt || 0), sh: Math.round(c.shield), su: r2(c.shieldUntil), st: r2(c.stunUntil),
      ch: c.channel ? [c.channel.type, r2(c.channel.until), r2(c.channel.dur), c.channel.camp ? S.camps.indexOf(c.channel.camp) : -1] : 0,
      dt: c.dots.some((d) => d.until > S.t) ? 1 : 0, wu: r2(c.weakUntil), rg: c.regen ? 1 : 0,
      f: r2(c.face || 0), la: r2(c.lastAtkAt || -9), k: c.kills, de: c.deaths, cv: c.conv,
      rn: Math.round(st.range), m: r2(st.m), sp: Math.round(st.speed), cr: r2(st.cdr), dc: r2(st.discount || 0),
      cd: [r2(c.cd.Q), r2(c.cd.W), r2(c.cd.E), r2(c.cd.R)], u: ['Q', 'W', 'E', 'R'].map((k) => (c.unl[k] ? 1 : 0)).join(''),
      dn: Math.floor(c.dons), it: c.items.map((id) => [id, c.lv[id]]), tg: ref(c.target), at: c.autoTarget ? 1 : 0, ls: ref(c.lastShot),
      hu: c.isPlayer ? 1 : 0,
    };
  });
  const mil = S.mil.map((m) => [m.id, r1(m.x), r1(m.y), Math.round(m.hp), Math.round(m.maxHp),
    (m.team === 'droite' ? 1 : 0) | (m.ranged ? 2 : 0) | (m.converted ? 4 : 0) | (m.voting ? 8 : 0) | (m.target && m.atkCd > 0.8 ? 16 : 0)]);
  const proj = S.proj.map((p) => [oid(p), p.kind === 'shot' ? 1 : 0, r1(p.x), r1(p.y), p.team === 'droite' ? 1 : 0, p.word || '', p.width || 0,
    (p.bureau ? 1 : 0) | (p.small ? 2 : 0) | (p.src && p.src.kind === 'cand' ? 4 : 0) | (p.kind === 'cat' ? 8 : 0), r2(p.face || 0)]);
  const fx = S.fx.map((f) => [oid(f), FX_TYPES.indexOf(f.type), r1(f.x), r1(f.y), Math.round(f.radius), f.team === 'droite' ? 1 : 0,
    r2(f.t0), r2(f.until || 0), r2(f.at || 0), (f.done ? 1 : 0) | (f.heal ? 2 : 0) | (f.soft ? 4 : 0)]);
  const floats = [];
  for (const f of S.floats) if (!room.sent.has(f)) { room.sent.add(f); floats.push([r1(f.x), r1(f.y), f.text, f.color, f.big ? 1 : 0, f.owner || 0, r2(f.until)]); }
  const snap = {
    t: 's', T: r2(S.t), c: cands, m: mil, p: proj, f: fx, fl: floats,
    b: S.bureaux.map((b) => [b.owner === 'droite' ? 1 : 0, b.g, b.conquered ? 1 : 0]),
    o: ['top', 'mid', 'bot'].map((k) => [S.obj[k].gauge, S.obj[k].ctrl || 0]),
    k: S.camps.map((c) => [r2(c.availableAt), c.busy ? 1 : 0, c.h.gauche, c.h.droite]),
    tm: ['gauche', 'droite'].map((t) => { const x = S.teams[t]; return [x.up, Math.floor(x.parrainages)]; }),
    sec: S.secondTour ? 1 : 0,
  };
  const lastLog = S.log[S.log.length - 1];
  const logKey = S.log.length + '|' + (lastLog ? lastLog.t + lastLog.text : '');
  if (logKey !== room.logKey) { room.logKey = logKey; snap.lg = S.log.map((l) => [r2(l.t), l.text, l.team || 0]); }
  if (S.over) snap.ov = { w: S.winner, r: S.reason, p: S.president ? S.president.id : 0 };
  return snap;
}
function broadcastSnap(room) {
  const msg = JSON.stringify(snapshot(room));
  for (const p of room.players) if (p.ws.readyState === 1) p.ws.send(msg);
}

// ── Messages des clients ──
function onMessage(pl, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  if (!msg || typeof msg.t !== 'string') return;
  const room = pl.room;
  switch (msg.t) {
    case 'hello':
      pl.name = String(msg.name || '').replace(/[<>&"'`]/g, '').trim().slice(0, MAX_NAME) || pl.name;
      return send(pl, { t: 'welcome', id: pl.id, name: pl.name });
    case 'create': {
      const team = ['gauche', 'droite'].includes(msg.team) ? msg.team : null;
      const duration = [5, 10, 15].includes(msg.duration) ? msg.duration : 10;
      leave(pl);
      return joinRoom(pl, createRoom('coop', { team, duration }));
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!r || r.matchmade) return send(pl, { t: 'err', msg: 'Aucune salle avec ce code' });
      return joinRoom(pl, r);
    }
    case 'queue':
      if (msg.mode === 'coop' || msg.mode === 'pvp') enqueue(pl, msg.mode);
      return;
    case 'leave':
      leave(pl);
      return send(pl, { t: 'left' });
    case 'settings':
      // l'hôte d'une salle à code choisit le camp et la durée
      if (!room || room.phase !== 'lobby' || room.host !== pl.id) return;
      if (['gauche', 'droite'].includes(msg.team)) { room.team = msg.team; for (const p of room.players) p.team = room.team; }
      if ([5, 10, 15].includes(msg.duration)) room.duration = msg.duration;
      return broadcastRoom(room);
    case 'begin':
      if (room && room.phase === 'lobby' && room.host === pl.id) startPick(room);
      return;
    case 'pick': {
      if (!room || room.phase !== 'pick') return;
      const err = pickError(room, pl, msg.candId);
      if (err) return send(pl, { t: 'err', msg: err });
      pl.pick = msg.candId; pl.ready = false;
      return broadcastRoom(room);
    }
    case 'ready':
      if (!room || room.phase !== 'pick' || !pl.pick) return;
      pl.ready = !!msg.on;
      broadcastRoom(room);
      return checkPickDone(room);
    case 'in': {
      // intention de jeu : appliquée par le moteur sur le candidat du joueur
      if (!room || room.phase !== 'play' || !msg.m || typeof msg.m !== 'object') return;
      const c = room.S.cands.find((x) => x.pid === pl.id && x.isPlayer);
      if (!c) return;
      const r = room.engine.Game.input(c, msg.m);
      if (r) send(pl, { t: 'toast', msg: r });
      return;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 512 }, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const pl = { id: nextPid++, ws, name: 'Militant ' + Math.floor(100 + Math.random() * 900), room: null, team: null, pick: null, ready: false };
  send(pl, { t: 'welcome', id: pl.id, name: pl.name });
  ws.on('message', (raw) => onMessage(pl, raw.toString()));
  ws.on('close', () => leave(pl));
  ws.on('error', () => {});
});

// horloge des files d'attente et de la sélection des candidats
setInterval(() => {
  matchmake();
  for (const room of rooms.values()) if (room.phase === 'pick') { checkPickDone(room); if (room.phase === 'pick') broadcastRoom(room); }
}, 1000);

server.listen(PORT, () => {
  console.log(`Campagne 2027 : serveur en ligne sur http://localhost:${PORT} (WebSocket ws://localhost:${PORT}/ws)`);
});
