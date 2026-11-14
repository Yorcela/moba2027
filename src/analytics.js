'use strict';
// ─── Statistiques : identifiant anonyme, parties solo, Google Analytics, page des stats ───
// - Un identifiant aléatoire (localStorage) compte les joueurs uniques, sans donnée personnelle.
// - Les parties solo sont signalées au serveur de jeu (les parties en ligne y sont déjà enregistrées).
// - Google Analytics n'est chargé qu'avec l'accord du visiteur (bandeau), et seulement si
//   window.GA_ID est renseigné dans index.html : un conteneur Google Tag Manager (GTM-…)
//   ou directement une mesure Google Analytics 4 (G-…).
const Analytics = (() => {
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  };
  let id = store.get('moba2027-cid');
  if (!id || !/^[a-z0-9-]{8,40}$/i.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
    store.set('moba2027-cid', id);
  }
  const cid = () => id;

  // adresse HTTP du serveur de jeu, déduite de son adresse WebSocket
  function apiBase() {
    let u = 'wss://moba2027.onrender.com/ws';
    try { u = Net.defaultUrl(); } catch (e) { /* ignore */ }
    return u.replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
  }
  // text/plain : pas de requête préalable CORS ; keepalive : part même si l'onglet se ferme
  function post(body) {
    try {
      fetch(apiBase() + '/api/stats/solo', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
    } catch (e) { /* hors ligne */ }
  }

  // ── Google Analytics (avec consentement) ──
  const GA_ID = typeof window.GA_ID === 'string' && /^(G|GTM)-[A-Z0-9]+$/.test(window.GA_ID) ? window.GA_ID : '';
  const GTM = GA_ID.startsWith('GTM-');
  let gaOn = false;
  function loadGA() {
    if (!GA_ID || gaOn) return;
    gaOn = true;
    // balise Google fournie par GA4, chargée telle quelle (mais seulement après consentement)
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (!GTM) window.gtag('config', GA_ID); // avec un conteneur GTM-…, la configuration GA4 est dans le conteneur
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/' + (GTM ? 'gtm.js' : 'gtag/js') + '?id=' + GA_ID;
    document.head.appendChild(s);
  }
  function consent() { return store.get('moba2027-consent'); }
  function setConsent(yes) {
    store.set('moba2027-consent', yes ? 'oui' : 'non');
    const b = $('#consent'); if (b) b.remove();
    if (yes) loadGA();
    else if (gaOn) location.reload(); // retire le script de la page
  }
  function banner() {
    if (!GA_ID || consent() || $('#consent')) return;
    const b = document.createElement('div');
    b.id = 'consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Mesure d’audience');
    b.innerHTML = `<p>On aimerait mesurer l’audience du jeu avec Google Analytics (visites, pays, appareil). Ça dépose des cookies : d’accord ?</p>
      <div><button type="button" id="consent-no">Refuser</button><button type="button" id="consent-yes">Accepter</button></div>`;
    document.body.appendChild(b);
    $('#consent-no').onclick = () => setConsent(false);
    $('#consent-yes').onclick = () => setConsent(true);
  }
  if (consent() === 'oui') loadGA();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
  // événements de jeu envoyés à GA4
  function event(name, params) { if (gaOn && window.gtag) window.gtag('event', name, params || {}); }

  // ── Parties ──
  let soloRun = null;
  function gameStart(mode, extra) {
    event('game_start', Object.assign({ mode }, extra || {}));
    if (mode === 'solo') { soloRun = Object.assign({}, extra); post({ k: 'start', cid: id }); }
  }
  // S : état final ; en ligne, le serveur enregistre déjà la partie
  function gameEnd(S, mode) {
    const me = S.player;
    const won = me && S.winner === me.team;
    event('game_end', { mode, won: won ? 1 : 0, candidate: me ? me.def.id : '', length: Math.round(S.t) });
    if (mode !== 'solo' || !soloRun || !me) return;
    const run = soloRun; soloRun = null;
    post({
      k: 'game', cid: id, dur: run.duration, diff: run.difficulty, len: Math.round(S.t), side: me.team,
      win: S.winner, why: S.reason, pres: S.president ? S.president.def.id : '',
      c: S.cands.map((c) => [c.def.id, c.team, c === me ? 1 : 0, Math.round(c.I * 10) / 10, c.kills, c.deaths, c.conv]),
    });
  }

  // ── Page des statistiques ──
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');
  const fmtLen = (s) => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
  const MODE_ROWS = [['solo', '🤖 Solo contre les bots'], ['coop', '🤝 3 joueurs contre les bots · salle à code'], ['coopMM', '🤝 3 joueurs contre les bots · matchmaking'], ['pvp', '⚔️ 3 contre 3 · matchmaking']];
  const REASONS = [['elysee', 'Élysée + majorité'], ['parrainages', '500 parrainages'], ['sondage', 'En tête des sondages à la fin du temps']];
  const COLS = [
    ['name', 'Candidat', null], ['games', 'Parties', 'Toutes les parties, joueur ou bot'], ['picks', 'Choisi', 'Nombre de fois joué par un humain'],
    ['winRate', 'Victoire', 'Part des parties gagnées par son camp'], ['humanWinRate', 'Victoire (humain)', 'Quand un humain le joue'],
    ['pres', 'Élu', 'Nombre de fois élu président'], ['poll', 'Sondage', 'Score moyen dans les sondages en fin de partie'],
    ['kills', 'KO', 'Moyenne par partie'], ['deaths', 'Scandales', 'Moyenne par partie'],
  ];
  let data = null, sortKey = 'winRate', sortDir = -1, loading = false;

  // barre partagée gauche / droite, avec libellés (l'identité n'est pas portée que par la couleur)
  function splitBar(w, label) {
    const n = w.gauche + w.droite;
    if (!n) return `<div class="st-split-row"><span>${label}</span><em class="st-none">aucune partie</em></div>`;
    const g = w.gauche / n;
    return `<div class="st-split-row"><span>${label} <small>· ${n} partie${n > 1 ? 's' : ''}</small></span>
      <div class="st-split" role="img" aria-label="Gauche ${pct(g)}, droite ${pct(1 - g)}">
        ${w.gauche ? `<i class="g" style="flex:${w.gauche}" title="Gauche : ${w.gauche} victoire${w.gauche > 1 ? 's' : ''} (${pct(g)})">Gauche ${pct(g)}</i>` : ''}
        ${w.droite ? `<i class="d" style="flex:${w.droite}" title="Droite : ${w.droite} victoire${w.droite > 1 ? 's' : ''} (${pct(1 - g)})">Droite ${pct(1 - g)}</i>` : ''}
      </div></div>`;
  }
  function hbars(rows) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([label, v, sub]) => `<div class="st-hbar" title="${esc(label)} : ${v}">
      <span>${esc(label)}</span><div><i style="width:${(v / max) * 100}%"></i></div><b>${v}${sub ? ` <small>${sub}</small>` : ''}</b></div>`).join('');
  }
  function candTable() {
    const rows = data.cands.map((c) => Object.assign({ name: CAND_BY_ID[c.id] ? CAND_BY_ID[c.id].name : c.id, team: CAND_BY_ID[c.id] ? CAND_BY_ID[c.id].team : '' }, c));
    rows.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return sortDir * x.localeCompare(y);
      return sortDir * ((x == null ? -1 : x) - (y == null ? -1 : y));
    });
    if (!rows.length) return '<p class="hint">Pas encore de partie terminée.</p>';
    const fmt = (k, v) => (k === 'winRate' || k === 'humanWinRate' ? pct(v) : k === 'poll' ? v.toFixed(1) + ' %' : v);
    return `<div class="st-table-wrap"><table class="st-table">
      <thead><tr>${COLS.map(([k, l, t]) => `<th${t ? ` title="${esc(t)}"` : ''}><button type="button" data-sort="${k}" class="${sortKey === k ? 'on' : ''}">${l}${sortKey === k ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td><span class="st-dot ${esc(r.team)}"></span>${esc(r.name)}</td>${COLS.slice(1).map(([k]) => `<td>${fmt(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }
  function draw(el) {
    if (!data) return;
    const D = data;
    const totalStart = Object.values(D.started).reduce((a, b) => a + b, 0);
    const days = D.daily, maxDay = Math.max(1, ...days.map((d) => d[1]));
    const soloRows = ['facile', 'normal', 'difficile'].map((k) => {
      const s = D.solo[k];
      return `<tr><td>${DIFFICULTY[k].label}</td><td>${s ? s.n : 0}</td><td>${s ? pct(s.won / s.n) : '—'}</td></tr>`;
    }).join('');
    el.innerHTML = `
      ${D.ready === false ? '<p class="status err">L’historique des statistiques est en cours de chargement sur le serveur : les chiffres ci-dessous sont incomplets. Réessayez dans une minute.</p>' : ''}
      <div class="st-tiles">
        <div class="st-tile"><b>${D.players}</b><span>joueurs uniques</span><small>${D.players30} sur les 30 derniers jours</small></div>
        <div class="st-tile"><b>${D.games}</b><span>parties terminées</span><small>${totalStart} commencées</small></div>
        <div class="st-tile"><b>${D.games ? fmtLen(D.avgLen) : '—'}</b><span>durée moyenne</span><small>d’une partie terminée</small></div>
      </div>
      <h4>Parties par mode</h4>
      <div class="st-table-wrap"><table class="st-table st-modes"><thead><tr><th>Mode</th><th>Commencées</th><th>Terminées</th><th title="Parties commencées mais jamais terminées (abandon, onglet fermé)">Abandons</th></tr></thead>
        <tbody>${MODE_ROWS.map(([k, l]) => {
          const s = D.started[k], f = D.finished[k];
          return `<tr><td>${l}</td><td>${s}</td><td>${f}</td><td>${s ? pct(Math.max(0, s - f) / s) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <h4>Parties terminées · 30 derniers jours</h4>
      <div class="st-days" role="img" aria-label="Parties terminées par jour sur 30 jours, maximum ${maxDay}">
        ${days.map(([d, n]) => `<div title="${d.split('-').reverse().join('/')} : ${n} partie${n > 1 ? 's' : ''}"><i style="height:${n ? Math.max(4, (n / maxDay) * 100) : 0}%"></i></div>`).join('')}
      </div>
      <div class="st-days-axis"><span>${days[0][0].split('-').reverse().slice(0, 2).join('/')}</span><span>max ${maxDay} / jour</span><span>aujourd’hui</span></div>
      <h4>Quel camp gagne ?</h4>
      ${splitBar(D.camps, 'Toutes les parties')}
      ${MODE_ROWS.map(([k, l]) => (D.campsByMode[k] ? splitBar(D.campsByMode[k], l) : '')).join('')}
      <div class="st-cols">
        <div><h4>Comment on gagne</h4>${hbars(REASONS.map(([k, l]) => [l, D.reasons[k] || 0, D.games ? pct((D.reasons[k] || 0) / D.games) : '']))}</div>
        <div><h4>Solo : victoires du joueur</h4>
          <table class="st-table"><thead><tr><th>Difficulté</th><th>Parties</th><th>Victoires</th></tr></thead><tbody>${soloRows}</tbody></table></div>
      </div>
      <h4>Durée choisie</h4>
      ${hbars([5, 10, 15].map((m) => [`${m} min`, D.durs[m] || 0]))}
      <h4>Candidats <small>· cliquez sur une colonne pour trier</small></h4>
      ${candTable()}
      <p class="hint">Statistiques anonymes (un identifiant aléatoire par navigateur), mises à jour en direct. Les parties solo sont comptées quand le serveur de jeu est joignable.
        Les « victoires » d’un candidat sont celles de son camp ; « Élu » compte les fois où il devient président.
        ${GA_ID ? `<br>Mesure d’audience Google Analytics : ${consent() === 'oui' ? 'acceptée' : 'refusée'} · <button type="button" class="st-link" id="st-consent">${consent() === 'oui' ? 'la refuser' : 'l’accepter'}</button>` : ''}</p>`;
    for (const b of el.querySelectorAll('[data-sort]')) {
      b.onclick = () => {
        const k = b.dataset.sort;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
        draw(el);
        const nb = el.querySelector(`[data-sort="${k}"]`); if (nb) nb.focus();
      };
    }
    const cb = el.querySelector('#st-consent');
    if (cb) cb.onclick = () => { setConsent(consent() !== 'oui'); draw(el); };
  }
  async function render(el) {
    if (loading) return;
    if (!data) el.innerHTML = '<p class="hint">Chargement des statistiques… (le serveur peut mettre une minute à se réveiller)</p>';
    else draw(el);
    loading = true;
    try {
      const r = await fetch(apiBase() + '/api/stats', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      draw(el);
    } catch (e) {
      if (!data) el.innerHTML = '<p class="hint">Le serveur de statistiques ne répond pas pour l’instant (il peut être en veille) : réessayez dans une minute.</p>';
    } finally { loading = false; }
  }

  return { cid, gameStart, gameEnd, render, event };
})();
