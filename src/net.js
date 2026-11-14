'use strict';
// ─── Client réseau : connexion au serveur, miroir de l'état, interpolation ────
// En ligne, le moteur ne tourne pas dans le navigateur : Game.S est un miroir
// reconstruit à partir des instantanés du serveur (~20 par seconde), interpolés
// avec un léger retard pour un rendu fluide à 60 images par seconde.
const Net = (() => {
  let ws = null;
  const handlers = {};
  let me = 0;
  let buf = [];
  let offset = null;
  const DELAY = 0.12; // s de retard d'affichage (≈ 2 instantanés)
  const M = { cand: new Map(), mil: new Map(), proj: new Map(), fx: new Map() };
  const FX_TYPES = ['ring', 'blast', 'heal', 'zone'];
  const TEAM = ['gauche', 'droite'];

  // serveur public utilisé quand la page n'est pas servie par un serveur de jeu
  // (GitHub Pages, fichier ouvert en local)
  const PUBLIC_SERVER = 'wss://moba2027.onrender.com/ws';
  // toujours le serveur public ; pour tester un serveur local : ?server=ws://localhost:8080/ws
  function defaultUrl() {
    const q = /[?&]server=([^&]+)/.exec(location.search);
    if (q) return decodeURIComponent(q[1]);
    if (typeof window !== 'undefined' && window.MOBA_SERVER) return window.MOBA_SERVER;
    return PUBLIC_SERVER;
  }
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return defaultUrl();
    if (/^https?:\/\//.test(u)) u = u.replace(/^http/, 'ws');
    if (!/^wss?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
    if (!/\/ws\/?$/.test(u)) u = u.replace(/\/$/, '') + '/ws';
    return u;
  }
  function emit(type, msg) { (handlers[type] || []).forEach((f) => f(msg)); }
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function connected() { return !!ws && ws.readyState === 1; }

  // se connecte (ou réutilise la connexion ouverte) et présente le joueur
  function connect(url, name) {
    url = normUrl(url);
    if (connected() && ws.url === url) { send({ t: 'hello', name, cid: Analytics.cid() }); return Promise.resolve(); }
    if (ws) { const old = ws; ws = null; try { old.close(); } catch (e) { /* ignore */ } }
    return new Promise((resolve, reject) => {
      let sock;
      try { sock = new WebSocket(url); } catch (e) { reject(new Error('Adresse de serveur invalide')); return; }
      ws = sock;
      let opened = false;
      sock.onopen = () => { opened = true; send({ t: 'hello', name, cid: Analytics.cid() }); resolve(); };
      sock.onerror = () => { if (!opened) reject(new Error('Impossible de joindre le serveur ' + url)); };
      sock.onclose = () => { if (ws === sock) ws = null; if (opened) emit('close', {}); };
      sock.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'welcome') me = m.id;
        if (m.t === 's') onSnap(m);
        emit(m.t, m);
      };
    });
  }
  function send(m) { if (connected()) ws.send(JSON.stringify(m)); }
  function close() { if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } } }

  // ── Miroir de la partie ──
  function startGame(msg) {
    CFG.timeLimit = msg.timeLimit;
    const roster = msg.roster.map((r) => ({ def: CAND_BY_ID[r.candId], team: r.team, player: !!r.pid, pid: r.pid, name: r.name }));
    Game.newGame(null, null, roster, { online: true });
    const S = Game.S;
    S.online = true;
    M.cand.clear(); M.mil.clear(); M.proj.clear(); M.fx.clear();
    S.cands.forEach((c, i) => {
      c.id = msg.roster[i].id;
      c.human = !!c.pid;
      c.isPlayer = c.pid === msg.you;
      c.st = { maxHp: c.def.hp, range: c.def.range, m: 1, cdr: 0, speed: c.def.spd, ap: 1, ad: c.def.ad };
      M.cand.set(c.id, c);
    });
    S.player = S.cands.find((c) => c.isPlayer);
    S.mil = []; S.proj = []; S.fx = []; S.floats = []; S.log = [];
    buf = []; offset = null;
    return S;
  }

  function resolve(r) {
    if (!r) return null;
    return (r[0] === 'c' ? M.cand : M.mil).get(+r.slice(1)) || null;
  }

  function onSnap(s) {
    const S = Game.S;
    if (!S || !S.online) return;
    const L = performance.now() / 1000;
    const d = L - s.T;
    if (offset === null || d < offset) offset = d; else offset += (d - offset) * 0.02;
    buf.push(s);
    if (buf.length > 30) buf.shift();
    // événements ponctuels : appliqués dès réception
    for (const f of s.fl) S.floats.push({ x: f[0], y: f[1], text: f[2], color: f[3], big: !!f[4], owner: f[5], until: f[6] });
    if (s.lg) S.log = s.lg.map((l) => ({ t: l[0], text: l[1], team: l[2] || null }));
  }

  const lerp = (a, b, k) => a + (b - a) * k;
  // appelée à chaque image : place le miroir au temps serveur « maintenant − DELAY »
  function frame() {
    const S = Game.S;
    if (!S || !S.online || !buf.length) return;
    const rT = performance.now() / 1000 - offset - DELAY;
    let b = buf.length - 1;
    while (b > 0 && buf[b - 1].T >= rT) b--;
    const B = buf[b], A = b > 0 ? buf[b - 1] : B;
    const k = A === B ? 1 : U.clamp((rT - A.T) / (B.T - A.T), 0, 1);
    // on oublie les instantanés trop anciens
    if (b > 2) buf.splice(0, b - 2);
    apply(S, A, B, k);
  }

  function apply(S, A, B, k) {
    S.t = lerp(A.T, B.T, k);
    // candidats
    const prevC = new Map(A.c.map((c) => [c.i, c]));
    for (const s of B.c) {
      const c = M.cand.get(s.i);
      if (!c) continue;
      const p = prevC.get(s.i);
      const smooth = p && !p.d && !s.d && Math.hypot(s.x - p.x, s.y - p.y) < 400;
      c.x = smooth ? lerp(p.x, s.x, k) : s.x; c.y = smooth ? lerp(p.y, s.y, k) : s.y;
      c.hp = smooth ? lerp(p.h, s.h, k) : s.h;
      c.st.maxHp = s.H; c.lastMax = s.H; c.st.range = s.rn; c.st.m = s.m; c.st.speed = s.sp; c.st.cdr = s.cr; c.st.discount = s.dc;
      c.I = s.I; c.dead = !!s.d; c.respawnAt = s.ra; c.diedAt = s.da;
      c.shield = s.sh; c.shieldUntil = s.su; c.stunUntil = s.st;
      c.channel = s.ch ? { type: s.ch[0], until: s.ch[1], dur: s.ch[2], camp: s.ch[3] >= 0 ? S.camps[s.ch[3]] : null } : null;
      c.dots = s.dt ? [{ until: Infinity }] : [];
      c.weakUntil = s.wu; c.regen = s.rg ? {} : null;
      c.face = s.f; c.lastAtkAt = s.la; c.kills = s.k; c.deaths = s.de; c.conv = s.cv;
      c.cd.Q = s.cd[0]; c.cd.W = s.cd[1]; c.cd.E = s.cd[2]; c.cd.R = s.cd[3];
      ['Q', 'W', 'E', 'R'].forEach((key, i) => { c.unl[key] = s.u[i] === '1'; });
      c.dons = s.dn;
      c.items = s.it.map((x) => x[0]); c.lv = {}; for (const [id, lv] of s.it) c.lv[id] = lv;
      c.autoTarget = !!s.at;
      c.human = !!s.hu || c.isPlayer;
    }
    // militants (identifiants du serveur)
    const prevM = new Map(A.m.map((m) => [m[0], m]));
    const seen = new Set();
    const mil = [];
    for (const s of B.m) {
      let m = M.mil.get(s[0]);
      const fl = s[5];
      if (!m) {
        m = { id: s[0], kind: 'mil', team: TEAM[fl & 1], ranged: !!(fl & 2), r: fl & 2 ? 10 : 12, x: s[1], y: s[2] };
        M.mil.set(s[0], m);
      }
      const p = prevM.get(s[0]);
      m.x = p ? lerp(p[1], s[1], k) : s[1]; m.y = p ? lerp(p[2], s[2], k) : s[2];
      m.hp = s[3]; m.maxHp = s[4];
      m.converted = !!(fl & 4); m.voting = fl & 8 ? {} : null;
      m.target = fl & 16 ? {} : null; m.atkCd = fl & 16 ? 1 : 0;
      seen.add(m.id); mil.push(m);
    }
    for (const id of M.mil.keys()) if (!seen.has(id)) M.mil.delete(id);
    S.mil = mil;
    // cibles (après les militants, pour les résoudre)
    for (const s of B.c) { const c = M.cand.get(s.i); if (c) { c.target = resolve(s.tg); c.lastShot = resolve(s.ls); } }
    // projectiles
    const prevP = new Map(A.p.map((p) => [p[0], p]));
    const proj = [];
    const seenP = new Set();
    for (const s of B.p) {
      let p = M.proj.get(s[0]);
      if (!p) {
        p = { id: s[0], kind: s[7] & 8 ? 'cat' : s[1] ? 'shot' : 'atk', team: TEAM[s[4]], word: s[5] || undefined, width: s[6], bureau: !!(s[7] & 1), small: !!(s[7] & 2), src: s[7] & 4 ? { kind: 'cand' } : { kind: 'other' } };
        M.proj.set(s[0], p);
      }
      const q = prevP.get(s[0]);
      p.x = q ? lerp(q[2], s[2], k) : s[2]; p.y = q ? lerp(q[3], s[3], k) : s[3]; p.face = s[8] || 0;
      seenP.add(p.id); proj.push(p);
    }
    for (const id of M.proj.keys()) if (!seenP.has(id)) M.proj.delete(id);
    S.proj = proj;
    // effets de zone
    const fx = [];
    const seenF = new Set();
    for (const s of B.f) {
      let f = M.fx.get(s[0]);
      if (!f) { f = { id: s[0] }; M.fx.set(s[0], f); }
      Object.assign(f, { type: FX_TYPES[s[1]], x: s[2], y: s[3], radius: s[4], team: TEAM[s[5]], t0: s[6], until: s[7], at: s[8], done: !!(s[9] & 1), heal: !!(s[9] & 2), soft: !!(s[9] & 4) });
      seenF.add(f.id); fx.push(f);
    }
    for (const id of M.fx.keys()) if (!seenF.has(id)) M.fx.delete(id);
    S.fx = fx;
    // bureaux, objectifs, camps, équipes
    B.b.forEach((s, i) => { const b = S.bureaux[i]; b.owner = TEAM[s[0]]; b.g = s[1]; b.conquered = !!s[2]; });
    ['top', 'mid', 'bot'].forEach((key, i) => { S.obj[key].gauge = B.o[i][0]; S.obj[key].ctrl = B.o[i][1] || null; });
    B.k.forEach((s, i) => { const c = S.camps[i]; c.availableAt = s[0]; c.busy = s[1] ? {} : null; c.h.gauche = s[2]; c.h.droite = s[3]; });
    TEAM.forEach((t, i) => { const x = S.teams[t], s = B.tm[i]; Object.assign(x.up, s[0]); x.parrainages = s[1]; });
    S.secondTour = !!B.sec;
    S.floats = S.floats.filter((f) => f.until > S.t - 0.5);
    if (B.ov && k >= 1) {
      S.over = true; S.winner = B.ov.w; S.reason = B.ov.r;
      S.president = M.cand.get(B.ov.p) || S.cands.filter((c) => c.team === B.ov.w).sort((a, b2) => b2.I - a.I)[0];
    }
  }

  return { connect, send, close, on, connected, startGame, frame, normUrl, defaultUrl, get me() { return me; } };
})();
