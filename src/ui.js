'use strict';
// ─── Interface : menu, HUD, contrôles, boucle ─────────────────────────────────
(() => {
  const $ = (s) => document.querySelector(s);
  const cv = $('#game'), g = cv.getContext('2d');
  const mm = $('#minimap'), mg = mm.getContext('2d');
  const cam = { x: 0, y: 0, z: 0.85, locked: true };
  let W = 0, H = 0, dpr = 1, aimKey = null, paused = false, running = false;
  const mouse = { x: 0, y: 0 };
  let shopOpen = false, hudTick = 0, toastUntil = 0, clickFx = null;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    mm.width = mm.height = 200 * dpr; mm.style.width = mm.style.height = '200px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Menu de sélection ──
  let chosenTeam = null;
  function renderMenu() {
    const teamsEl = $('#pick-teams');
    teamsEl.innerHTML = '';
    for (const t of ['gauche', 'droite']) {
      const b = document.createElement('button');
      b.className = 'team-btn ' + t + (chosenTeam === t ? ' on' : '');
      b.textContent = 'QG ' + TEAMS[t].name;
      b.onclick = () => { chosenTeam = t; renderMenu(); };
      teamsEl.appendChild(b);
    }
    const list = $('#pick-cands');
    list.innerHTML = '';
    if (!chosenTeam) { list.innerHTML = '<p class="hint">Choisissez d’abord votre camp : vous ne pourrez incarner qu’un candidat de ce camp.</p>'; return; }
    for (const d of CANDIDATES.filter((c) => c.team === chosenTeam)) {
      const card = document.createElement('button');
      card.className = 'cand-card ' + d.team;
      card.dataset.id = d.id;
      const ab = d.abilities;
      card.innerHTML = `
        <div class="avatar ${d.team}">${d.initials}</div>
        <div class="cc-body">
          <div class="cc-name">${d.name}</div>
          <div class="cc-meta">${d.party} · ${ROLE_NAMES[d.role]} · ${LANE_NAMES[LANE_BY_ROLE[d.role]]}</div>
          <ul>${['Q', 'W', 'E', 'R'].map((k) => `<li><b>${k}</b> ${ab[k].name} — ${ab[k].desc}</li>`).join('')}</ul>
        </div>`;
      card.onclick = () => start(d.id);
      list.appendChild(card);
    }
  }
  renderMenu();

  function start(candId) {
    Game.newGame(candId);
    const p = Game.S.player;
    cam.x = p.x; cam.y = p.y; cam.locked = true;
    $('#menu').classList.add('hidden');
    $('#end').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    buildAbilityBar();
    buildShop();
    running = true; paused = false;
  }

  // ── Barre de sorts ──
  function buildAbilityBar() {
    const p = Game.S.player;
    const bar = $('#abilities');
    bar.innerHTML = '';
    for (const k of ['Q', 'W', 'E', 'R']) {
      const ab = p.def.abilities[k];
      const el = document.createElement('div');
      el.className = 'ab';
      el.id = 'ab-' + k;
      el.title = `${ab.name} — ${ab.desc} (recharge ${ab.cd} s)`;
      el.innerHTML = `<span class="key">${k}</span><span class="abn">${ab.name}</span><span class="cdv"></span><div class="cdo"></div>`;
      bar.appendChild(el);
    }
    $('#me-avatar').textContent = p.def.initials;
    $('#me-avatar').className = 'avatar ' + p.team;
    $('#me-name').textContent = p.def.name;
  }

  // ── Boutique ──
  function buildShop() {
    const list = $('#shop-list');
    list.innerHTML = '';
    for (const it of ITEMS) {
      const b = document.createElement('button');
      b.className = 'shop-item' + (it.team ? ' team' : '');
      b.dataset.id = it.id;
      b.innerHTML = `<span class="ic">${it.icon}</span><span class="nm">${it.name}</span><span class="ds">${it.desc}</span><span class="pr">${it.cost} €</span><span class="lv"></span>`;
      b.onclick = () => {
        const err = Game.buy(Game.S.player, it.id);
        toast(err || `${it.name} : acheté`);
        refreshShop();
      };
      list.appendChild(b);
    }
  }
  function refreshShop() {
    const S = Game.S, p = S.player;
    const inQG = p.dead || Game.inOwnQG(p);
    $('#shop-where').textContent = inQG ? 'Vous êtes au QG : achats possibles.' : 'Retournez au QG de campagne (touche B) pour acheter.';
    for (const b of document.querySelectorAll('.shop-item')) {
      const it = ITEM_BY_ID[b.dataset.id];
      b.disabled = !inQG || p.dons < it.cost;
      b.querySelector('.lv').textContent = it.team ? `niv. ${S.teams[p.team].up[it.key]}/3` : '';
    }
  }
  function toggleShop(force) {
    shopOpen = force !== undefined ? force : !shopOpen;
    $('#shop').classList.toggle('hidden', !shopOpen);
    if (shopOpen) refreshShop();
  }
  $('#shop-close').onclick = () => toggleShop(false);
  $('#btn-shop').onclick = () => toggleShop();

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    toastUntil = performance.now() + 1800;
  }

  // ── Entrées ──
  function toWorld(x, y) { return { x: (x - W / 2) / cam.z + cam.x, y: (y - H / 2) / cam.z + cam.y }; }
  cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { cam.z = U.clamp(cam.z * (e.deltaY > 0 ? 0.9 : 1.1), 0.35, 1.4); e.preventDefault(); }, { passive: false });
  cv.addEventListener('mousedown', (e) => {
    if (!running || paused) return;
    const p = Game.S.player;
    const w = toWorld(e.clientX, e.clientY);
    if (aimKey) { Game.cast(p, aimKey, w.x, w.y); aimKey = null; return; }
    if (p.dead || !Game.canAct(p)) return;
    order(p, w);
    clickFx = { x: w.x, y: w.y, t: performance.now() };
  });

  function order(p, w) {
    const S = Game.S;
    let tgt = null;
    for (const c of S.cands) if (c.team !== p.team && !c.dead && U.dist(c, w) < c.r + 18) tgt = c;
    if (!tgt) for (const m of S.mil) if (m.team !== p.team && !m.converted && U.dist(m, w) < m.r + 14) tgt = m;
    if (tgt) { p.target = tgt; p.moveTo = null; p.campTarget = null; return; }
    for (const camp of S.camps) {
      if (U.dist(camp, w) < camp.r + 10) {
        if (!Game.campAvailable(camp)) { toast('Ce camp n’est pas disponible pour l’instant'); return; }
        p.campTarget = camp; p.target = null; p.moveTo = null; return;
      }
    }
    p.moveTo = w; p.target = null; p.campTarget = null;
  }

  window.addEventListener('keydown', (e) => {
    if (!running) return;
    const k = e.key.toUpperCase();
    const p = Game.S.player;
    if (k === 'ESCAPE') {
      if (shopOpen) toggleShop(false);
      else if (aimKey) aimKey = null;
      else { paused = !paused; $('#pause').classList.toggle('hidden', !paused); }
      return;
    }
    if (paused) return;
    if (['Q', 'W', 'E', 'R'].includes(k)) {
      const w = toWorld(mouse.x, mouse.y);
      if (e.shiftKey) { aimKey = k; return; }
      if (!Game.cast(p, k, w.x, w.y) && p.cd[k] > 0) toast(`${p.def.abilities[k].name} : encore ${p.cd[k].toFixed(1)} s`);
      e.preventDefault();
    } else if (k === 'B') Game.recall(p);
    else if (k === 'P') toggleShop();
    else if (k === ' ') { cam.locked = !cam.locked; toast(cam.locked ? 'Caméra verrouillée' : 'Caméra libre (bords de l’écran)'); e.preventDefault(); }
    else if (k === 'S') { p.moveTo = null; p.target = null; p.campTarget = null; }
  });

  mm.addEventListener('mousedown', (e) => {
    if (!running) return;
    const r = mm.getBoundingClientRect();
    const s = 200 / (MAP.R * 2 + 100);
    const w = { x: (e.clientX - r.left - 100) / s, y: (e.clientY - r.top - 100) / s };
    if (e.button === 2 || e.shiftKey) order(Game.S.player, w);
    else { cam.locked = false; cam.x = w.x; cam.y = w.y; }
  });
  mm.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── HUD ──
  function pollRows(S) {
    return [...S.cands].sort((a, b) => b.I - a.I).map((c) => {
      const pc = Game.share(c) * 100;
      return `<div class="poll-row${c.isPlayer ? ' me' : ''}${c.dead ? ' dead' : ''}">
        <span class="pn">${c.def.name}</span><span class="pv">${pc.toFixed(1)} %</span>
        <div class="pb"><div style="width:${Math.min(100, pc * 2.2)}%;background:${TEAMS[c.team].color}"></div></div>
        <span class="pk">${c.kills} KO · ${c.deaths} scandales · ${c.conv} conv.</span></div>`;
    }).join('');
  }

  function updateHUD() {
    const S = Game.S, p = S.player;
    $('#timer').textContent = U.fmtTime(S.t) + ' / ' + U.fmtTime(CFG.timeLimit);
    for (const k of ['top', 'mid', 'bot']) {
      const o = S.obj[k];
      const el = $('#obj-' + k);
      const f = o.gauge / o.max;
      el.querySelector('.fill-g').style.width = Math.max(0, f) * 50 + '%';
      el.querySelector('.fill-d').style.width = Math.max(0, -f) * 50 + '%';
      const open = Game.laneOwnedBy('gauche', k) || Game.laneOwnedBy('droite', k);
      el.querySelector('.st').textContent = o.ctrl ? 'Majorité ' + TEAMS[o.ctrl].name.toLowerCase()
        : `${Math.abs(o.gauge)}/${o.max} bulletins` + (open ? ' · voie ouverte' : '');
    }
    $('#poll-list').innerHTML = pollRows(S);
    $('#parr').textContent = `Parrainages — gauche : ${Math.floor(S.teams.gauche.parrainages)} · droite : ${Math.floor(S.teams.droite.parrainages)}`;
    $('#me-hp').style.width = U.clamp(p.hp / p.st.maxHp, 0, 1) * 100 + '%';
    $('#me-hpt').textContent = p.dead ? `Retour dans ${Math.ceil(p.respawnAt - S.t)} s` : `Crédibilité ${Math.ceil(p.hp)} / ${Math.ceil(p.st.maxHp)}`;
    $('#me-dons').textContent = Math.floor(p.dons) + ' €';
    $('#me-poll').textContent = (Game.share(p) * 100).toFixed(1) + ' % · puissance ×' + p.st.m.toFixed(2);
    $('#me-items').innerHTML = Array.from({ length: 6 }, (_, i) => {
      const id = p.items[i];
      return `<span class="slot" title="${id ? ITEM_BY_ID[id].name + ' — ' + ITEM_BY_ID[id].desc : 'vide'}">${id ? ITEM_BY_ID[id].icon : ''}</span>`;
    }).join('');
    const e = p.def.fem ? 'e' : '';
    let status = '';
    if (p.dead) status = `Emporté${e} par une polémique… (achats possibles)`;
    else if (p.channel && p.channel.type === 'camp') status = `${p.channel.camp.name} : immobilisé${e} encore ${Math.ceil(p.channel.until - S.t)} s`;
    else if (p.channel) status = `Retour au QG dans ${Math.ceil(p.channel.until - S.t)} s`;
    else if (p.stunUntil > S.t) status = `Étourdi${e}`;
    $('#me-status').textContent = status;
    for (const k of ['Q', 'W', 'E', 'R']) {
      const el = $('#ab-' + k);
      const cd = p.cd[k];
      const max = p.def.abilities[k].cd * (1 - p.st.cdr);
      el.querySelector('.cdo').style.height = (cd > 0 ? (cd / max) * 100 : 0) + '%';
      el.querySelector('.cdv').textContent = cd > 0 ? Math.ceil(cd) : '';
      el.classList.toggle('aim', aimKey === k);
    }
    $('#log').innerHTML = S.log.slice().reverse().map((l) =>
      `<div class="ll" style="border-color:${l.team ? TEAMS[l.team].color : '#888'}"><span>${U.fmtTime(l.t)}</span> ${l.text}</div>`).join('');
    if (shopOpen) refreshShop();
  }

  function showEnd() {
    const S = Game.S;
    running = false;
    updateHUD();
    const pr = S.president, won = S.winner === S.player.team;
    const e = pr.def.fem ? 'e' : '';
    $('#end-title').textContent = won ? 'Victoire !' : 'Défaite…';
    $('#end-title').className = S.winner;
    $('#end-pres').innerHTML = `<b>${pr.def.name}</b> est élu${e} président${e} de la République`;
    $('#end-reason').textContent = `${S.reason} · camp ${TEAMS[S.winner].name.toLowerCase()} · ${U.fmtTime(S.t)}`;
    $('#end-poll').innerHTML = pollRows(S);
    $('#end').classList.remove('hidden');
  }
  $('#btn-replay').onclick = () => {
    $('#end').classList.add('hidden'); $('#hud').classList.add('hidden'); $('#menu').classList.remove('hidden');
    chosenTeam = null; renderMenu();
  };

  // ── Boucle ──
  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (running && !paused) {
      acc += dt;
      while (acc >= STEP && running) {
        Game.update(STEP); acc -= STEP;
        if (Game.S.over) showEnd();
      }
    } else acc = 0;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (Game.S) {
      const S = Game.S, p = S.player;
      if (cam.locked) {
        const tgt = p.dead ? MAP.QG[p.team] : p;
        cam.x += (tgt.x - cam.x) * Math.min(1, dt * 8); cam.y += (tgt.y - cam.y) * Math.min(1, dt * 8);
      } else if (running) {
        const edge = 24, sp = (1100 * dt) / cam.z;
        if (mouse.x < edge) cam.x -= sp;
        if (mouse.x > W - edge) cam.x += sp;
        if (mouse.y < edge) cam.y -= sp;
        if (mouse.y > H - edge) cam.y += sp;
        cam.x = U.clamp(cam.x, -MAP.R, MAP.R); cam.y = U.clamp(cam.y, -MAP.R, MAP.R);
      }
      const w = toWorld(mouse.x, mouse.y);
      const vcam = { x: cam.x, y: cam.y, z: cam.z * dpr };
      Render.drawWorld(g, S, vcam, W * dpr, H * dpr, { showRange: true, aim: aimKey ? { x: w.x, y: w.y, ab: p.def.abilities[aimKey] } : null });
      if (clickFx && now - clickFx.t < 350) {
        const k = 1 - (now - clickFx.t) / 350;
        g.strokeStyle = `rgba(95,209,122,${k})`; g.lineWidth = 3;
        g.beginPath(); g.arc(clickFx.x, clickFx.y, 18 * k + 6, 0, Math.PI * 2); g.stroke();
      }
      Render.drawMinimap(mg, S, vcam, W * dpr, H * dpr, 200 * dpr);
      hudTick -= dt;
      if (hudTick <= 0 && running) { hudTick = 0.2; updateHUD(); }
    } else {
      const t = now / 1000;
      Render.drawWorld(g, null, { x: Math.cos(t * 0.05) * 300, y: Math.sin(t * 0.05) * 300, z: (Math.min(W, H) / 3400) * dpr }, W * dpr, H * dpr);
    }
    if (toastUntil && now > toastUntil) { $('#toast').classList.remove('show'); toastUntil = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // accès pour les tests
  window.__moba = { start, cam, get S() { return Game.S; } };
})();
