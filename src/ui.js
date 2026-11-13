'use strict';
// ─── Interface : menu, HUD, contrôles (souris + clavier), boucle 3D ───────────
(() => {
  const $ = (s) => document.querySelector(s);
  const gl = $('#game3d');
  const ov = $('#overlay'), g = ov.getContext('2d');
  const mm = $('#minimap'), mg = mm.getContext('2d');
  R3.init(gl);

  const cam = { x: 0, y: 0, dist: 1250, locked: true };
  let W = 0, H = 0, dpr = 1, aimKey = null, paused = false, running = false;
  const mouse = { x: 0, y: 0, inside: false };
  let shopOpen = false, hudTick = 0, toastUntil = 0, clickFx = null, hover = null;
  const keys = new Set();
  let kbMoving = false;

  // préférences (confort personnel, peut être indisponible)
  const prefs = { controls: 'mixte', difficulty: 'facile', duration: 10 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('moba2027-prefs') || '{}')); } catch (e) { /* stockage indisponible */ }
  function savePrefs() { try { localStorage.setItem('moba2027-prefs', JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
  if (!DIFFICULTY[prefs.difficulty]) prefs.difficulty = 'facile';
  CFG.difficulty = prefs.difficulty;
  if (!CFG.durations.includes(prefs.duration)) prefs.duration = 10;
  CFG.timeLimit = prefs.duration * 60;

  // libellés des touches selon la disposition du clavier (ZQSD sur AZERTY)
  const keyLabel = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyQ: 'Q', KeyE: 'E', KeyR: 'R' };
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then((m) => {
      for (const k of Object.keys(keyLabel)) { const v = m.get(k); if (v) keyLabel[k] = v.toUpperCase(); }
      renderMenu();
    }).catch(() => {});
  }
  const moveKeysLabel = () => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((k) => keyLabel[k]).join('');

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    R3.resize(W, H);
    ov.width = W * dpr; ov.height = H * dpr; ov.style.width = W + 'px'; ov.style.height = H + 'px';
    mm.width = mm.height = 200 * dpr; mm.style.width = mm.style.height = '200px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Menu ──
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
    const opt = $('#options');
    opt.innerHTML = `
      <label>Difficulté
        <select id="opt-diff">${Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}"${prefs.difficulty === k ? ' selected' : ''}>${d.label}</option>`).join('')}</select>
      </label>
      <label>Durée
        <select id="opt-dur">${CFG.durations.map((m) => `<option value="${m}"${prefs.duration === m ? ' selected' : ''}>${m} min</option>`).join('')}</select>
      </label>
      <label>Contrôles
        <select id="opt-ctl">
          <option value="mixte"${prefs.controls === 'mixte' ? ' selected' : ''}>Flèches (ou souris) · sorts ${keyLabel.KeyQ} ${keyLabel.KeyW} ${keyLabel.KeyE} ${keyLabel.KeyR}</option>
          <option value="clavier"${prefs.controls === 'clavier' ? ' selected' : ''}>Clavier ${moveKeysLabel()} · sorts 1 2 3 4</option>
        </select>
      </label>`;
    $('#opt-diff').onchange = (e) => { prefs.difficulty = e.target.value; CFG.difficulty = prefs.difficulty; savePrefs(); };
    $('#opt-dur').onchange = (e) => { prefs.duration = +e.target.value; CFG.timeLimit = prefs.duration * 60; savePrefs(); };
    $('#opt-ctl').onchange = (e) => { prefs.controls = e.target.value; savePrefs(); renderMenu(); };
    $('#keys-help').innerHTML = controlsHelp();
    const list = $('#pick-cands');
    list.innerHTML = '';
    if (!chosenTeam) { list.innerHTML = '<p class="hint">Choisissez d’abord votre camp : vous pourrez incarner un candidat de ce camp ou un candidat neutre (plus faible).</p>'; return; }
    // candidats du camp + neutres (plus faibles), groupés par classe
    for (const cls of ['tank', 'dps', 'soutien']) {
      const h = document.createElement('h3');
      h.className = 'cls-title';
      h.textContent = { tank: 'Tanks — voie de l’Assemblée', dps: 'DPS — avenue de l’Élysée', soutien: 'Soutiens — voie du Sénat' }[cls];
      list.appendChild(h);
      for (const d of CANDIDATES.filter((c) => c.cls === cls && (c.team === chosenTeam || c.neutral))) {
        const card = document.createElement('button');
        card.className = 'cand-card ' + chosenTeam + (d.neutral ? ' neutral' : '');
        card.dataset.id = d.id;
        const ab = d.abilities;
        card.title = ['Q', 'W', 'E', 'R'].map((k, i) => `${spellKey(k, i)} ${ab[k].name} — ${ab[k].desc}`).join('\n');
        card.innerHTML = `
          <div class="avatar ${chosenTeam}">${d.initials}</div>
          <div class="cc-body">
            <div class="cc-name">${d.name}${d.neutral ? ' <span class="neu">neutre · plus faible</span>' : ''}</div>
            <div class="cc-meta">${d.party} · ${CLASS_NAMES[d.cls]} · ${ROLE_NAMES[d.role]}</div>
            <ul>${['Q', 'W', 'E', 'R'].map((k, i) => `<li><b>${spellKey(k, i)}</b> ${ab[k].name} <span>— ${ab[k].desc}</span></li>`).join('')}</ul>
          </div>`;
        card.onclick = () => start(d.id, chosenTeam);
        list.appendChild(card);
      }
    }
  }
  function spellKey(k, i) { return prefs.controls === 'clavier' ? String(i + 1) : keyLabel['Key' + k]; }
  function syncKeyLabels() { ['Q', 'W', 'E', 'R'].forEach((k, i) => { KEY_LABEL[k] = spellKey(k, i); }); }
  function controlsHelp() {
    const base = prefs.controls === 'clavier'
      ? `<kbd>${moveKeysLabel()}</kbd> ou <kbd>flèches</kbd> se déplacer · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> sorts`
      : `<kbd>flèches</kbd> (ou clic) se déplacer · <kbd>${keyLabel.KeyQ}</kbd><kbd>${keyLabel.KeyW}</kbd><kbd>${keyLabel.KeyE}</kbd><kbd>${keyLabel.KeyR}</kbd> sorts`;
    return `${base} · les attaques partent <b>toutes seules</b> sur l’ennemi à portée, et les sorts visent <b>automatiquement</b> ·
      sorts débloqués à ${CFG.unlock.Q} / ${CFG.unlock.W} / ${CFG.unlock.E} / ${CFG.unlock.R} % dans les sondages ·
      <kbd>Tab</kbd> verrouiller un candidat · <kbd>Entrée</kbd> récolter le camp le plus proche · <kbd>B</kbd> retour au QG ·
      <kbd>P</kbd> boutique (<kbd>flèches</kbd> + <kbd>Entrée</kbd> pour acheter ou améliorer) · <kbd>Espace</kbd> caméra libre · <kbd>Échap</kbd> pause · <kbd>Maj</kbd>+sort : viser à la souris`;
  }
  renderMenu();

  function start(candId, team) {
    syncKeyLabels();
    Game.newGame(candId, team);
    const p = Game.S.player;
    cam.x = p.x; cam.y = p.y; cam.locked = true;
    $('#menu').classList.add('hidden');
    $('#end').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    buildAbilityBar();
    buildShop();
    running = true; paused = false;
    tipsDone = false;
    $('#tips').classList.remove('hidden');
  }

  // ── Barre de sorts ──
  function buildAbilityBar() {
    const p = Game.S.player;
    const bar = $('#abilities');
    bar.innerHTML = '';
    ['Q', 'W', 'E', 'R'].forEach((k, i) => {
      const ab = p.def.abilities[k];
      const el = document.createElement('button');
      el.className = 'ab';
      el.id = 'ab-' + k;
      el.title = `${ab.name} — ${ab.desc} (recharge ${ab.cd} s)`;
      el.innerHTML = `<span class="key">${spellKey(k, i)}</span><span class="abn">${ab.name}</span><span class="cdv"></span><div class="cdo"></div><span class="lock">🔒 ${CFG.unlock[k]} %</span>`;
      el.onclick = () => castAuto(k);
      bar.appendChild(el);
    });
    $('#me-avatar').textContent = p.def.initials;
    $('#me-avatar').className = 'avatar ' + p.team;
    $('#me-name').textContent = p.def.name;
  }
  // visée automatique : cible verrouillée, sinon candidat adverse le plus proche, sinon militant
  function nearest(list, p, maxD) {
    let best = null, bd = maxD;
    for (const e of list) { if (e.team === p.team || !Game.alive(e)) continue; const d = U.dist(p, e); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function castAuto(k) {
    const S = Game.S, p = S.player;
    const ab = p.def.abilities[k];
    if (['nova', 'shield', 'haste', 'selfheal', 'regen', 'globalheal'].includes(ab.type)) return tryCast(k, p.x, p.y);
    if (ab.type === 'heal') {
      let hurt = p, low = p.hp / p.st.maxHp;
      for (const a of S.cands) if (a.team === p.team && !a.dead && U.dist(a, p) < ab.range && a.hp / a.st.maxHp < low) { low = a.hp / a.st.maxHp; hurt = a; }
      return tryCast(k, hurt.x, hurt.y);
    }
    const reach = Math.min(ab.range || 600, 1600) + 150;
    const locked = p.target && Game.alive(p.target) && U.dist(p, p.target) < reach ? p.target : null;
    const t = locked || nearest(S.cands, p, reach) || nearest(S.mil, p, reach);
    if (ab.type === 'dash') {
      const kd = keyDir();
      if (kd) return tryCast(k, p.x + kd.x * ab.range, p.y + kd.y * ab.range);
      if (t) return tryCast(k, t.x, t.y);
      const f = p.face || 0;
      return tryCast(k, p.x + Math.cos(f) * ab.range, p.y + Math.sin(f) * ab.range);
    }
    if (!t) { if (Game.unlocked(p, k)) toast('Aucune cible à portée'); else tryCast(k, p.x, p.y); return; }
    let tx = t.x, ty = t.y;
    if (ab.type === 'skillshot' && t.kind === 'cand' && t.moveTo) {
      const n = U.norm(t.moveTo.x - t.x, t.moveTo.y - t.y), lead = (U.dist(p, t) / ab.speed) * t.st.speed * 0.7;
      tx += n.x * lead; ty += n.y * lead;
    }
    tryCast(k, tx, ty);
  }
  function tryCast(k, x, y) {
    const p = Game.S.player;
    if (Game.cast(p, k, x, y)) return;
    if (!Game.unlocked(p, k)) toast(`${p.def.abilities[k].name} se débloque à ${CFG.unlock[k]} % dans les sondages (vous : ${p.I.toFixed(1)} %)`);
    else if (p.cd[k] > 0) toast(`${p.def.abilities[k].name} : encore ${p.cd[k].toFixed(1)} s`);
  }

  // ── Boutique ──
  function buildShop() {
    const list = $('#shop-list');
    list.innerHTML = '';
    shopOrder = [];
    // objets groupés par catégorie ; flèches + Entrée, ou 1 à 9 pour les premiers
    for (const [cat, label] of Object.entries(ITEM_CATS)) {
      const h = document.createElement('h4');
      h.className = 'shop-cat';
      h.textContent = label;
      list.appendChild(h);
      for (const it of ITEMS.filter((x) => x.cat === cat)) {
        const i = shopOrder.length;
        shopOrder.push(it);
        const b = document.createElement('button');
        b.className = 'shop-item' + (it.team ? ' team' : '');
        b.dataset.id = it.id;
        b.innerHTML = `<span class="num">${i < 9 ? i + 1 : ''}</span><span class="ic">${it.icon}</span><span class="nm"></span><span class="ds"></span><span class="pr"></span><span class="lv"></span><span class="pips"></span>`;
        b.onclick = () => buyItem(it);
        list.appendChild(b);
      }
    }
  }
  let shopOrder = [], shopSel = 0;
  function buyItem(it) {
    const nx = Game.itemNext(Game.S.player, it.id);
    const err = Game.buy(Game.S.player, it.id);
    toast(err || `${nx.name} (niv. ${nx.lvl}) : acheté`);
    refreshShop();
  }
  function refreshShop() {
    const S = Game.S, p = S.player;
    const inQG = p.dead || Game.inOwnQG(p);
    $('#shop-where').textContent = inQG ? 'Vous êtes au QG : achats possibles.' : 'Retournez au QG de campagne (touche B) pour acheter.';
    for (const b of document.querySelectorAll('.shop-item')) {
      const it = ITEM_BY_ID[b.dataset.id];
      const nx = Game.itemNext(p, it.id);
      const cur = it.team ? S.teams[p.team].up[it.key] : p.lv[it.id] || 0;
      b.disabled = !inQG || !nx || p.dons < nx.cost;
      const max = it.team ? 3 : it.lv.length;
      b.querySelector('.nm').textContent = nx ? (cur ? `Améliorer : ${nx.name}` : nx.name) : itemName(it, p.team, max);
      b.querySelector('.ds').textContent = nx ? (cur && !it.team ? `${it.fmt(it.lv[cur - 1].v)} → ` : '') + nx.desc : `Niveau maximum : ${it.team ? it.desc : it.fmt(it.lv[max - 1].v)}`;
      b.querySelector('.pr').textContent = nx ? nx.cost + ' €' : '—';
      b.querySelector('.lv').textContent = `niv. ${cur}/${max}`;
      b.querySelector('.pips').innerHTML = Array.from({ length: max }, (_, k) => `<i class="${k < cur ? 'on' : ''}"></i>`).join('');
      b.classList.toggle('sel', shopOrder[shopSel] === it);
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

  // ── Souris ──
  const mouseWorld = () => R3.pickGround(mouse.x, mouse.y, W, H);
  ov.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; });
  ov.addEventListener('mouseleave', () => { mouse.inside = false; });
  ov.addEventListener('contextmenu', (e) => e.preventDefault());
  ov.addEventListener('wheel', (e) => { cam.dist = U.clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 650, 2400); e.preventDefault(); }, { passive: false });
  ov.addEventListener('mousedown', (e) => {
    if (!running || paused) return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
    const p = Game.S.player;
    const w = mouseWorld();
    if (aimKey) { tryCast(aimKey, w.x, w.y); aimKey = null; return; }
    if (p.dead || p.dash || p.stunUntil > Game.S.t) return;
    order(p, w);
    clickFx = { x: w.x, y: w.y, t: performance.now() };
  });

  function enemyAt(w) {
    const S = Game.S, p = S.player;
    let best = null, bd = Infinity;
    for (const c of S.cands) if (c.team !== p.team && !c.dead) { const d = U.dist(c, w); if (d < c.r + 26 && d < bd) { bd = d; best = c; } }
    if (best) return best;
    for (const m of S.mil) if (m.team !== p.team && !m.converted) { const d = U.dist(m, w); if (d < m.r + 22 && d < bd) { bd = d; best = m; } }
    return best;
  }

  function order(p, w) {
    const S = Game.S;
    const tgt = enemyAt(w);
    if (tgt) { p.target = tgt; p.autoTarget = false; p.moveTo = null; p.campTarget = null; return; }
    for (const camp of S.camps) {
      if (U.dist(camp, w) < camp.r + 20) {
        if (!Game.campAvailable(camp)) { toast('Ce camp n’est pas disponible pour l’instant'); return; }
        p.campTarget = camp; p.target = null; p.moveTo = null; return;
      }
    }
    p.moveTo = w; p.target = null; p.campTarget = null;
  }

  function activateCamp(p) {
    const S = Game.S;
    let best = null, bd = 420;
    for (const camp of S.camps) { const d = U.dist(camp, p); if (d < bd) { bd = d; best = camp; } }
    if (!best) { toast('Aucune mairie ni aucun meeting à proximité'); return; }
    if (!Game.campAvailable(best)) { toast(`${best.name} : pas disponible pour l’instant`); return; }
    p.campTarget = best; p.target = null; p.moveTo = null;
  }
  function lockNearest(p) {
    const t = nearest(Game.S.cands, p, 1000);
    if (!t) { p.target = null; toast('Aucun candidat adverse à proximité'); return; }
    p.target = t; p.autoTarget = true; // prioritaire pour les attaques et les sorts, sans le poursuivre
    toast(`Cible : ${t.def.name}`);
  }

  // ── Clavier ──
  const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const MOVE_WASD = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }; // = ZQSD sur AZERTY
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('keydown', (e) => {
    if (!running) return;
    if (e.target && e.target.tagName === 'SELECT') return;
    const code = e.code;
    const p = Game.S.player;
    if (code === 'Escape') {
      if (shopOpen) toggleShop(false);
      else if (aimKey) aimKey = null;
      else { paused = !paused; $('#pause').classList.toggle('hidden', !paused); }
      return;
    }
    if (paused) return;
    const clavier = prefs.controls === 'clavier';
    if (shopOpen && /^(Digit|Numpad)[1-9]$/.test(code)) { const it = shopOrder[+code.slice(-1) - 1]; if (it) buyItem(it); e.preventDefault(); return; }
    if (shopOpen && (MOVE[code] || code === 'Enter' || code === 'NumpadEnter')) {
      // boutique au clavier : flèches pour choisir, Entrée pour acheter / améliorer
      e.preventDefault();
      if (code === 'ArrowDown' || code === 'ArrowRight') shopSel = (shopSel + 1) % shopOrder.length;
      else if (code === 'ArrowUp' || code === 'ArrowLeft') shopSel = (shopSel + shopOrder.length - 1) % shopOrder.length;
      else buyItem(shopOrder[shopSel]);
      refreshShop();
      return;
    }
    if (MOVE[code] || (clavier && MOVE_WASD[code])) { keys.add(code); e.preventDefault(); return; }
    if (code === 'Enter' || code === 'NumpadEnter') { e.preventDefault(); if (!p.dead) activateCamp(p); return; }
    if (code === 'Tab') { e.preventDefault(); if (!p.dead) lockNearest(p); return; }
    const spellByCode = clavier
      ? { Digit1: 'Q', Digit2: 'W', Digit3: 'E', Digit4: 'R', Numpad1: 'Q', Numpad2: 'W', Numpad3: 'E', Numpad4: 'R' }
      : { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', Digit1: 'Q', Digit2: 'W', Digit3: 'E', Digit4: 'R' };
    const k = spellByCode[code];
    if (k) {
      e.preventDefault();
      if (e.repeat) return;
      if (e.shiftKey) { aimKey = k; return; }
      castAuto(k);
      return;
    }
    if (code === 'KeyB') Game.recall(p);
    else if (code === 'KeyP') toggleShop();
    else if (code === 'Space') { cam.locked = !cam.locked; toast(cam.locked ? 'Caméra verrouillée' : 'Caméra libre (bords de l’écran)'); e.preventDefault(); }
    else if (code === 'KeyS' && !clavier) { p.moveTo = null; p.target = null; p.campTarget = null; }
    else if (code === 'KeyX') { p.target = null; toast('Cible libérée'); }
  });

  function keyDir() {
    let dx = 0, dy = 0;
    for (const c of keys) { const v = MOVE[c] || (prefs.controls === 'clavier' && MOVE_WASD[c]); if (v) { dx += v[0]; dy += v[1]; } }
    return dx || dy ? U.norm(dx, dy) : null;
  }
  function keyboardMove() {
    const S = Game.S, p = S.player;
    const n = keyDir();
    if (n) {
      // bouger pendant une récolte ou un retour au QG l'annule
      if (p.dead || p.dash || p.stunUntil > S.t || S.over) return;
      p.moveTo = { x: p.x + n.x * 90, y: p.y + n.y * 90 };
      p.face = Math.atan2(n.y, n.x);
      if (p.target && !p.autoTarget) p.target = null; // on garde une cible verrouillée par Tab
      p.campTarget = null;
      kbMoving = true;
    } else if (kbMoving) {
      kbMoving = false;
      p.moveTo = null;
    }
  }

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
    const und = Game.undecided();
    return [...S.cands].sort((a, b) => b.I - a.I).map((c) => {
      const pc = Game.share(c) * 100;
      return `<div class="poll-row${c.isPlayer ? ' me' : ''}${c.dead ? ' dead' : ''}">
        <span class="pn">${c.def.name}${c.dead && !S.over ? ` <em>· retour ${Math.ceil(c.respawnAt - S.t)} s</em>` : ''}</span><span class="pv">${pc.toFixed(1)} %</span>
        <div class="pb"><div style="width:${Math.min(100, pc * 2.5)}%;background:${TEAMS[c.team].color}"></div></div>
        <span class="pk">${c.kills} KO · ${c.deaths} scandales · ${c.conv} conv.</span></div>`;
    }).join('') + `<div class="poll-row und"><span class="pn">Indécis</span><span class="pv">${und.toFixed(1)} %</span></div>`;
  }

  function updateHUD() {
    const S = Game.S, p = S.player;
    $('#timer').textContent = 'Reste ' + U.fmtTime(Math.max(0, CFG.timeLimit - S.t));
    for (const k of ['top', 'mid', 'bot']) {
      const o = S.obj[k];
      const el = $('#obj-' + k);
      const f = o.gauge / o.max;
      el.querySelector('.fill-g').style.width = Math.max(0, f) * 50 + '%';
      el.querySelector('.fill-d').style.width = Math.max(0, -f) * 50 + '%';
      const open = Game.laneOwnedBy('gauche', k) || Game.laneOwnedBy('droite', k);
      el.querySelector('.st').textContent = o.ctrl ? (k === 'mid' ? 'Présidentielle : ' : 'Majorité ') + TEAMS[o.ctrl].name.toLowerCase()
        : `${Math.abs(o.gauge)}/${o.max} bulletins` + (open ? ' · voie ouverte' : '');
    }
    $('#poll-list').innerHTML = pollRows(S);
    $('#parr').textContent = `Parrainages — gauche : ${Math.floor(S.teams.gauche.parrainages)} · droite : ${Math.floor(S.teams.droite.parrainages)}`;
    $('#me-hp').style.width = U.clamp(p.hp / p.st.maxHp, 0, 1) * 100 + '%';
    $('#me-hpt').textContent = p.dead ? `Retour dans ${Math.ceil(p.respawnAt - S.t)} s` : `Crédibilité ${Math.ceil(p.hp)} / ${Math.ceil(p.st.maxHp)}`;
    $('#me-dons').textContent = Math.floor(p.dons) + ' €';
    const nextK = ['Q', 'W', 'E', 'R'].find((k) => !Game.unlocked(p, k));
    $('#me-poll').textContent = p.I.toFixed(1) + ' % · puissance ×' + p.st.m.toFixed(2)
      + (nextK ? ` · ${KEY_LABEL[nextK]} à ${CFG.unlock[nextK]} %` : ' · tous les sorts débloqués');
    $('#me-items').innerHTML = Array.from({ length: 6 }, (_, i) => {
      const id = p.items[i];
      if (!id) return '<span class="slot" title="vide"></span>';
      const it = ITEM_BY_ID[id], L = it.lv[p.lv[id] - 1];
      return `<span class="slot" title="${itemName(it, p.team, p.lv[id])} (niv. ${p.lv[id]}/${it.lv.length}) — ${it.fmt(L.v)}">${it.icon}<sub>${p.lv[id]}</sub></span>`;
    }).join('');
    const e = p.def.fem ? 'e' : '';
    let status = '';
    if (p.channel && p.channel.type === 'camp') status = `${p.channel.camp.name} : restez immobile encore ${Math.ceil(p.channel.until - S.t)} s (bouger annule)`;
    else if (p.channel) status = `Retour au QG dans ${Math.ceil(p.channel.until - S.t)} s`;
    else if (p.stunUntil > S.t) status = `Étourdi${e}`;
    else if (p.target && p.target.kind === 'cand' && !p.dead) status = `Cible : ${p.target.def.name} (X pour libérer)`;
    else if (p.lastShot && S.t - (p.lastAtkAt || -9) < 1.5 && !p.dead) status = p.lastShot.kind === 'mil' ? 'Conversion d’un militant…' : `Polémique contre ${p.lastShot.def.name}`;
    $('#me-status').textContent = status;
    for (const k of ['Q', 'W', 'E', 'R']) {
      const el = $('#ab-' + k);
      const cd = p.cd[k];
      const max = p.def.abilities[k].cd * (1 - p.st.cdr);
      el.querySelector('.cdo').style.height = (cd > 0 ? (cd / max) * 100 : 0) + '%';
      el.querySelector('.cdv').textContent = cd > 0 ? Math.ceil(cd) : '';
      el.classList.toggle('aim', aimKey === k);
      el.classList.toggle('locked', !Game.unlocked(p, k));
    }
    $('#log').innerHTML = S.log.slice().reverse().map((l) =>
      `<div class="ll" style="border-color:${l.team ? TEAMS[l.team].color : '#888'}"><span>${U.fmtTime(l.t)}</span> ${l.text}</div>`).join('');
    if (shopOpen) refreshShop();
    updateTips(S, p);
  }

  // ── Écran de retour au QG (bien visible) ──
  function updateRespawn(S) {
    const p = S.player;
    const el = $('#respawn');
    if (!p.dead) { el.classList.add('hidden'); gl.classList.remove('dead'); return; }
    el.classList.remove('hidden'); gl.classList.add('dead');
    const left = Math.max(0, p.respawnAt - S.t);
    const total = Math.max(0.1, p.respawnAt - (p.diedAt || S.t));
    $('#rs-count').textContent = Math.ceil(left);
    $('#rs-bar').style.width = (1 - left / total) * 100 + '%';
  }

  // ── Astuces contextuelles ──
  let tipsDone = false;
  function updateTips(S, p) {
    const el = $('#tips');
    if (tipsDone || S.t > 150) { el.classList.add('hidden'); tipsDone = true; return; }
    el.classList.toggle('hidden', p.dead);
    const enemyMil = S.mil.some((m) => m.team !== p.team && !m.converted && U.dist(m, p) < 900);
    let tip;
    if (S.t < 12) tip = `Votre QG est à ${p.team === 'gauche' ? 'l’ouest' : 'l’est'}. Votre voie : <b>${LANE_NAMES[p.lane]}</b>. Avancez <b>derrière vos militants</b>.`;
    else if (enemyMil) tip = `Militants adverses en vue ! Approchez-vous : dès qu’ils sont dans votre cercle jaune, vos <b>polémiques partent toutes seules</b>. Chaque conversion vous fait monter dans les sondages : <b>${KEY_LABEL.Q}</b> se débloque à ${CFG.unlock.Q} %.`;
    else tip = `Les bureaux adverses tirent sur <b>vous</b> (cercle rouge), pas sur les militants : restez derrière eux. Près d’une mairie ou d’un meeting, <b>Entrée</b> pour récolter : ${CFG.campChannelOwn} s immobile de votre côté, ${CFG.campChannelFoe} s chez l’adversaire.`;
    $('#tips-text').innerHTML = tip;
  }
  $('#tips-close').onclick = () => { tipsDone = true; $('#tips').classList.add('hidden'); };

  function showEnd() {
    const S = Game.S;
    running = false;
    updateHUD();
    $('#respawn').classList.add('hidden'); gl.classList.remove('dead');
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

  // ── Surcouche 2D (barres, noms, textes) projetée sur la 3D ──
  function P(x, y, h) { return R3.project(x, y, h, W, H); }
  function groundCircle(x, y, r, color, width, dash) {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
    g.beginPath();
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; const q = P(x + Math.cos(a) * r, y + Math.sin(a) * r, 2); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
    g.stroke(); g.setLineDash([]);
  }
  function drawOverlay(S, now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!S) return;
    const p = S.player;
    const scale = 1250 / cam.dist;
    if (!p.dead) groundCircle(p.x, p.y, p.st.range, 'rgba(255,211,77,0.35)', 1.5);
    for (const b of S.bureaux) if (b.owner !== p.team && !p.dead && U.dist(p, b) < CFG.bureauRange + 300) groundCircle(b.x, b.y, CFG.bureauRange, 'rgba(255,90,90,0.55)', 2, [8, 8]);
    if (hover) groundCircle(hover.x, hover.y, hover.r + 12, '#ff5a5a', 3);
    if (p.target && !p.dead && (p.target.kind === 'mil' ? !p.target.converted : !p.target.dead)) groundCircle(p.target.x, p.target.y, p.target.r + 8, '#ffd34d', 2.5);
    if (aimKey && !p.dead) {
      const ab = p.def.abilities[aimKey], w = mouseWorld();
      if (ab.type === 'skillshot' || ab.type === 'dash') {
        const n = U.norm(w.x - p.x, w.y - p.y), a = P(p.x, p.y, 2), b = P(p.x + n.x * ab.range, p.y + n.y * ab.range, 2);
        g.strokeStyle = 'rgba(255,211,77,0.8)'; g.lineWidth = 4; g.setLineDash([10, 8]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      } else if (ab.radius) {
        const self = ab.type === 'nova' || ab.type === 'haste' || ab.type === 'shield';
        groundCircle(self ? p.x : w.x, self ? p.y : w.y, ab.radius, 'rgba(255,211,77,0.8)', 3, [10, 8]);
      }
    }
    if (clickFx && now - clickFx.t < 350) groundCircle(clickFx.x, clickFx.y, 20 * (1 - (now - clickFx.t) / 350) + 6, 'rgba(95,209,122,0.9)', 3);
    for (const o of Object.values(S.obj)) {
      const q = P(o.x, o.y, o.id === 'elysee' ? 175 : 165);
      g.font = `800 ${Math.round(16 * scale)}px system-ui`; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(o.name, q.x, q.y); g.fillStyle = '#fff'; g.fillText(o.name, q.x, q.y);
      const w = 150 * scale, h = 9 * scale, x = q.x - w / 2, y = q.y + 12 * scale;
      g.fillStyle = '#11151b'; g.fillRect(x, y, w, h);
      const f = o.gauge / o.max;
      g.fillStyle = f > 0 ? TEAMS.gauche.color : TEAMS.droite.color;
      if (f > 0) g.fillRect(x + w / 2 - (w / 2) * f, y, (w / 2) * f, h); else g.fillRect(x + w / 2, y, (w / 2) * -f, h);
      g.fillStyle = '#fff'; g.fillRect(x + w / 2 - 1, y - 2, 2, h + 4);
    }
    for (const c of S.camps) {
      const q = P(c.x, c.y, 85);
      g.font = `700 ${Math.round(12 * scale)}px system-ui`; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)';
      let txt, col;
      if (S.t < c.availableAt) { txt = `${c.type === 'mairie' ? 'Mairie' : 'Meeting'} · ${Math.ceil(c.availableAt - S.t)} s`; col = '#9aa4b1'; }
      else if (c.busy) { txt = 'occupé'; col = '#ffd34d'; }
      else if (c.type === 'mairie') { txt = `+${Game.campReward(p.team, c)} parrainages · ${Game.campDuration(p, c)} s`; col = '#9be28f'; }
      else { txt = `+${Game.campReward(p.team, c)} € de dons · ${Game.campDuration(p, c)} s`; col = '#ffd34d'; }
      g.strokeText(txt, q.x, q.y); g.fillStyle = col; g.fillText(txt, q.x, q.y);
      if (!p.dead && !p.channel && Game.campAvailable(c) && U.dist(c, p) < 420) {
        const q2 = P(c.x, c.y, 60);
        g.font = `800 ${Math.round(13 * scale)}px system-ui`;
        g.strokeText('Entrée : récolter', q2.x, q2.y + 16); g.fillStyle = '#fff'; g.fillText('Entrée : récolter', q2.x, q2.y + 16);
      }
    }
    for (const m of S.mil) {
      if (m.converted || m.hp >= m.maxHp) continue;
      const q = P(m.x, m.y, 55);
      const w = 26 * scale;
      g.fillStyle = '#000'; g.fillRect(q.x - w / 2 - 1, q.y - 1, w + 2, 5);
      g.fillStyle = m.team === p.team ? '#5fd17a' : '#ff6b6b'; g.fillRect(q.x - w / 2, q.y, w * (m.hp / m.maxHp), 3);
    }
    for (const c of S.cands) {
      if (c.dead) continue;
      const q = P(c.x, c.y, 150 * (c.def.id === 'philippe' ? 1.1 : 1));
      const w = 80 * Math.max(0.75, scale), x = q.x - w / 2, y = q.y;
      g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x - 2, y - 2, w + 4, 11);
      g.fillStyle = c.team === p.team ? '#5fd17a' : '#e5484d';
      g.fillRect(x, y, w * U.clamp(c.hp / c.st.maxHp, 0, 1), 7);
      if (c.shield > 0 && c.shieldUntil > S.t) { const sw = Math.min(w, (w * c.shield) / c.st.maxHp); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x + w - sw, y, sw, 7); }
      g.font = '800 13px system-ui'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)';
      const pct = c.I.toFixed(1) + ' %';
      g.strokeText(pct, q.x, y - 10); g.fillStyle = TEAMS[c.team].light; g.fillText(pct, q.x, y - 10);
      g.font = '600 12px system-ui';
      g.strokeText(c.def.name, q.x, y + 18); g.fillStyle = c.isPlayer ? '#ffd34d' : '#fff'; g.fillText(c.def.name, q.x, y + 18);
      if (c.channel) {
        const pr = 1 - (c.channel.until - S.t) / c.channel.dur;
        g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x, y + 27, w, 5);
        g.fillStyle = c.channel.type === 'recall' ? '#8fb4ff' : '#9be28f'; g.fillRect(x, y + 27, w * pr, 5);
      }
      const tags = [];
      if (c.stunUntil > S.t) tags.push(['✶ étourdi', '#ffd34d']);
      if (c.dots.some((d) => d.until > S.t)) tags.push(['🔥 brûlure', '#ff9a4d']);
      if (c.weakUntil > S.t) tags.push(['▼ affaibli', '#c79bff']);
      if (c.regen) tags.push(['✚ récupère', '#7be38f']);
      g.font = '800 13px system-ui';
      tags.forEach(([txt, col], i) => { g.strokeText(txt, q.x, y - 28 - i * 15); g.fillStyle = col; g.fillText(txt, q.x, y - 28 - i * 15); });
    }
    for (const f of S.floats) {
      const life = f.until - S.t, dur = f.big ? 2 : 1.2;
      const q = P(f.x, f.y, 90 + (dur - life) * 40);
      g.globalAlpha = U.clamp(life / 0.4, 0, 1);
      g.font = `800 ${f.big ? 20 : 13}px system-ui`; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(f.text, q.x, q.y); g.fillStyle = f.color; g.fillText(f.text, q.x, q.y);
    }
    g.globalAlpha = 1;
  }

  // ── Boucle ──
  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (running && !paused) {
      keyboardMove();
      acc += dt;
      while (acc >= STEP && running) {
        Game.update(STEP); acc -= STEP;
        if (Game.S.over) showEnd();
      }
    } else acc = 0;

    const t = now / 1000;
    const S = Game.S;
    if (S) {
      const p = S.player;
      if (cam.locked) {
        const tgt = p.dead ? MAP.QG[p.team] : p;
        cam.x += (tgt.x - cam.x) * Math.min(1, dt * 8); cam.y += (tgt.y - cam.y) * Math.min(1, dt * 8);
      } else if (running && mouse.inside) {
        const edge = 24, sp = 1300 * dt * (cam.dist / 1250);
        if (mouse.x < edge) cam.x -= sp;
        if (mouse.x > W - edge) cam.x += sp;
        if (mouse.y < edge) cam.y -= sp;
        if (mouse.y > H - edge) cam.y += sp;
        cam.x = U.clamp(cam.x, -MAP.R, MAP.R); cam.y = U.clamp(cam.y, -MAP.R, MAP.R);
      }
      R3.setCamera(cam.x, cam.y, cam.dist);
      hover = running && mouse.inside ? enemyAt(mouseWorld()) : null;
      ov.style.cursor = hover ? 'pointer' : 'crosshair';
      R3.sync(S, dt, t);
      R3.render();
      drawOverlay(S, now);
      const a = R3.pickGround(0, H * 0.2, W, H), b = R3.pickGround(W, H, W, H);
      const vw = Math.max(1, Math.abs(b.x - a.x));
      Render.drawMinimap(mg, S, { x: cam.x, y: (a.y + b.y) / 2, z: (W * dpr) / vw }, W * dpr, (W * dpr * Math.abs(b.y - a.y)) / vw, 200 * dpr);
      if (running) updateRespawn(S);
      hudTick -= dt;
      if (hudTick <= 0 && running) { hudTick = 0.2; updateHUD(); }
    } else {
      R3.setCamera(Math.cos(t * 0.06) * 700, Math.sin(t * 0.06) * 500, 2300);
      R3.sync(null, dt, t);
      R3.render();
      drawOverlay(null, now);
    }
    if (toastUntil && now > toastUntil) { $('#toast').classList.remove('show'); toastUntil = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__moba = { start, cam, get S() { return Game.S; } };
})();
