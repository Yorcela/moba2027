'use strict';
// ─── Statistiques de jeu (anonymes) ───────────────────────────────────────────
// Stockage : une base Postgres si DATABASE_URL est renseignée (Neon, Supabase…,
// indispensable sur un hébergement au disque éphémère comme Render gratuit), sinon un
// fichier JSON Lines (STATS_FILE, par défaut data/stats.jsonl). Toutes les lignes sont
// chargées en mémoire au démarrage puis ajoutées au fil de l'eau. Les parties en ligne sont enregistrées par le serveur ; les
// parties solo, qui tournent dans le navigateur, sont signalées par le client
// (POST /api/stats/solo). Les joueurs sont comptés grâce à un identifiant
// aléatoire stocké dans leur navigateur : aucune donnée personnelle.
//
// Types de lignes :
//   { k: 'start', t, mode, mm, cids }                      partie commencée
//   { k: 'game', t, mode, mm, dur, len, diff?, win, why, pres, side?, cids, c: [[candId, camp, humain, %, KO, scandales, conv.], …] }
const fs = require('fs');
const path = require('path');

const MODES = ['solo', 'coop', 'pvp'];
const CID_RE = /^[a-z0-9-]{8,40}$/i;
const TEAMS = ['gauche', 'droite'];

// ── Stockage dans un fichier ──
function fileStore(file) {
  return {
    name: 'fichier ' + file,
    async load() {
      const out = [];
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { /* ignore */ }
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return out; } // pas encore de fichier
      for (const line of text.split('\n')) {
        if (!line) continue;
        try { out.push(JSON.parse(line)); } catch (e) { /* ligne abîmée : ignorée */ }
      }
      return out;
    },
    append(row) { return fs.promises.appendFile(file, JSON.stringify(row) + '\n'); },
  };
}

// ── Stockage dans Postgres : une table, une ligne JSON par événement ──
function pgStore(url) {
  const { Pool } = require('pg');
  // pas de SSL en local, sur le réseau privé de Render (hôte sans domaine : dpg-…-a) ou si sslmode=disable
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { /* adresse invalide : pg signalera l'erreur */ }
  const local = /^(localhost|127\.0\.0\.1)$/.test(host) || (!!host && !host.includes('.')) || /sslmode=disable/.test(url);
  const pool = new Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error('Statistiques : connexion Postgres perdue', e.message));
  return {
    name: 'Postgres',
    async load() {
      await pool.query('CREATE TABLE IF NOT EXISTS stats_rows (id BIGSERIAL PRIMARY KEY, row JSONB NOT NULL)');
      const r = await pool.query('SELECT row FROM stats_rows ORDER BY id');
      return r.rows.map((x) => x.row);
    },
    append(row) { return pool.query('INSERT INTO stats_rows (row) VALUES ($1)', [row]); },
  };
}

function createStats(opts) {
  const store = opts.databaseUrl ? pgStore(opts.databaseUrl) : fileStore(opts.file);
  const cands = opts.cands; // CAND_BY_ID du moteur (lecture seule)
  let rows = [];
  let cache = null, cacheAt = 0;
  let ready = false;
  const early = []; // lignes reçues avant la fin du chargement
  let markLoaded;
  const loadedP = new Promise((res) => { markLoaded = res; }); // les écritures attendent le chargement (pas de doublon, table créée)

  // ── Lecture au démarrage (réessaie si la base dort encore, comme Neon gratuit) ──
  (async function load(attempt) {
    try {
      const loaded = await store.load();
      rows = loaded.concat(early);
      ready = true; cache = null;
      markLoaded();
      console.log(`Statistiques : ${loaded.length} lignes chargées (${store.name})`);
    } catch (e) {
      console.error(`Statistiques : chargement impossible (${store.name}) :`, e.message || e.code || String(e));
      if (attempt < 6) setTimeout(() => load(attempt + 1), 5000 * (attempt + 1));
    }
  })(0);

  function add(row) {
    (ready ? rows : early).push(row);
    cache = null;
    loadedP.then(() => store.append(row)).catch((err) => console.error('Statistiques : écriture impossible', err.message));
  }
  const cid = (v) => (typeof v === 'string' && CID_RE.test(v) ? v : null);
  const r1 = (v) => Math.round(v * 10) / 10;

  // ── Enregistrement ──
  function gameStart(mode, mm, cids) {
    add({ k: 'start', t: Date.now(), mode, mm: mm ? 1 : 0, cids: (cids || []).map(cid).filter(Boolean) });
  }
  // S : état final du moteur ; extra : { mode, mm, dur, cids }
  function gameEnd(S, extra) {
    add({
      k: 'game', t: Date.now(), mode: extra.mode, mm: extra.mm ? 1 : 0, dur: extra.dur, len: Math.round(S.t),
      win: S.winner, why: S.reason, pres: S.president ? S.president.def.id : null,
      cids: (extra.cids || []).map(cid).filter(Boolean),
      c: S.cands.map((c) => [c.def.id, c.team, c.isPlayer ? 1 : 0, r1(c.I), c.kills, c.deaths, c.conv]),
    });
  }

  // ── Partie solo signalée par le navigateur (vérifiée, puis enregistrée) ──
  const hits = new Map(); // ip → horodatages récents (limite d'envoi)
  function allow(ip) {
    const t = Date.now();
    const h = (hits.get(ip) || []).filter((x) => t - x < 10 * 60e3);
    if (h.length >= 40) return false;
    h.push(t); hits.set(ip, h);
    if (hits.size > 5000) hits.clear();
    return true;
  }
  function soloReport(body, ip) {
    if (!allow(ip)) return 'trop de requêtes';
    const b = body || {};
    const id = cid(b.cid);
    if (!id) return 'identifiant manquant';
    if (b.k === 'start') { gameStart('solo', false, [id]); return null; }
    if (b.k !== 'game') return 'type inconnu';
    if (!TEAMS.includes(b.win) || !TEAMS.includes(b.side)) return 'camp inconnu';
    if (![5, 10, 15].includes(b.dur) || !(b.len >= 0 && b.len <= 16 * 60)) return 'durée invalide';
    if (!['facile', 'normal', 'difficile'].includes(b.diff)) return 'difficulté inconnue';
    if (!Array.isArray(b.c) || b.c.length !== 6) return 'candidats invalides';
    const c = [];
    for (const x of b.c) {
      if (!Array.isArray(x) || !cands[x[0]] || !TEAMS.includes(x[1])) return 'candidat inconnu';
      const n = (v, max) => Math.max(0, Math.min(max, +v || 0));
      c.push([x[0], x[1], x[2] ? 1 : 0, r1(n(x[3], 100)), Math.round(n(x[4], 999)), Math.round(n(x[5], 999)), Math.round(n(x[6], 9999))]);
    }
    if (c.filter((x) => x[2]).length !== 1) return 'un seul joueur en solo';
    if (!cands[b.pres]) return 'président inconnu';
    add({ k: 'game', t: Date.now(), mode: 'solo', mm: 0, dur: b.dur, len: Math.round(b.len), diff: b.diff, side: b.side,
      win: b.win, why: String(b.why || '').slice(0, 120), pres: b.pres, cids: [id], c });
    return null;
  }

  // ── Synthèse pour la page des statistiques ──
  function reasonKind(why) {
    if (/parrainages/i.test(why)) return 'parrainages';
    if (/Fin du temps/i.test(why)) return 'sondage';
    if (/majorité/i.test(why)) return 'elysee';
    return 'autre';
  }
  function summary() {
    if (cache && Date.now() - cacheAt < 15e3) return cache;
    const players = new Set(), players30 = new Set();
    const started = { solo: 0, coop: 0, coopMM: 0, pvp: 0 };
    const finished = { solo: 0, coop: 0, coopMM: 0, pvp: 0 };
    const key = (r) => (r.mode === 'coop' && r.mm ? 'coopMM' : r.mode);
    const camps = { gauche: 0, droite: 0 };
    const campsByMode = {};
    const reasons = { elysee: 0, parrainages: 0, sondage: 0, autre: 0 };
    const solo = {}; // difficulté → { n, won }
    const durs = {};
    const days = {}; // AAAA-MM-JJ → parties terminées
    const C = {}; // candidat → agrégats
    let lenSum = 0, games = 0;
    const since30 = Date.now() - 30 * 864e5;
    for (const r of rows) {
      if (!MODES.includes(r.mode)) continue;
      for (const id of r.cids || []) { players.add(id); if (r.t >= since30) players30.add(id); }
      if (r.k === 'start') { started[key(r)]++; continue; }
      if (r.k !== 'game') continue;
      games++;
      finished[key(r)]++;
      lenSum += r.len || 0;
      if (camps[r.win] !== undefined) camps[r.win]++;
      const cm = campsByMode[key(r)] = campsByMode[key(r)] || { gauche: 0, droite: 0 };
      if (cm[r.win] !== undefined) cm[r.win]++;
      reasons[reasonKind(r.why || '')]++;
      durs[r.dur] = (durs[r.dur] || 0) + 1;
      const d = new Date(r.t).toISOString().slice(0, 10);
      days[d] = (days[d] || 0) + 1;
      if (r.mode === 'solo' && r.diff) {
        const s = solo[r.diff] = solo[r.diff] || { n: 0, won: 0 };
        s.n++; if (r.win === r.side) s.won++;
      }
      // premier des sondages en fin de partie
      const top = (r.c || []).reduce((m, x) => (!m || x[3] > m[3] ? x : m), null);
      for (const x of r.c || []) {
        const [id, team, human, poll, k, de, conv] = x;
        const a = C[id] = C[id] || { games: 0, wins: 0, human: 0, humanWins: 0, pres: 0, first: 0, poll: 0, kills: 0, deaths: 0, conv: 0 };
        a.games++;
        if (team === r.win) a.wins++;
        if (human) { a.human++; if (team === r.win) a.humanWins++; }
        if (r.pres === id) a.pres++;
        if (top === x) a.first++;
        a.poll += poll; a.kills += k; a.deaths += de; a.conv += conv;
      }
    }
    const candStats = Object.entries(C).map(([id, a]) => ({
      id, games: a.games, picks: a.human, winRate: a.wins / a.games, humanWinRate: a.human ? a.humanWins / a.human : null,
      pres: a.pres, first: a.first, poll: r1(a.poll / a.games), kills: r1(a.kills / a.games), deaths: r1(a.deaths / a.games), conv: r1(a.conv / a.games),
    }));
    // 30 derniers jours, y compris ceux sans partie
    const daily = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); daily.push([d, days[d] || 0]); }
    cache = {
      updated: Date.now(), ready, players: players.size, players30: players30.size, games, avgLen: games ? Math.round(lenSum / games) : 0,
      started, finished, camps, campsByMode, reasons, solo, durs, daily, cands: candStats,
    };
    cacheAt = Date.now();
    return cache;
  }

  return { gameStart, gameEnd, soloReport, summary };
}

module.exports = { createStats };
