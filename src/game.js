'use strict';
// ─── Moteur de règles ─────────────────────────────────────────────────────────
const Game = (() => {
  let S = null;
  let nextId = 1;
  const LANES = ['top', 'mid', 'bot'];

  // ── Création de la partie ──
  function newGame(playerCandId) {
    nextId = 1;
    S = {
      t: 0, over: false, winner: null, president: null, reason: '',
      cands: [], mil: [], proj: [], fx: [], floats: [], log: [],
      bureaux: [], obj: {}, camps: [],
      teams: {
        gauche: { up: { hp: 0, dmg: 0, spd: 0 }, parrainages: 0 },
        droite: { up: { hp: 0, dmg: 0, spd: 0 }, parrainages: 0 },
      },
      nextWave: CFG.waveFirst, waveN: 0, player: null,
    };
    MAP.bureauDefs.forEach(([lane, home, pos], i) => {
      S.bureaux.push({
        id: 'b' + i, kind: 'bureau', lane, home, owner: home, g: CFG.bureauMax,
        x: pos.x, y: pos.y, r: 42, s: MAP.lanes[lane].project(pos), atkCd: 0, name: BUREAU_NAMES[i],
      });
    });
    for (const k of LANES) {
      const o = MAP.objectives[k];
      S.obj[k] = { ...o, kind: 'obj', gauge: 0, max: CFG.objMax[k], ctrl: null, s: MAP.lanes[k].project(o) };
    }
    MAP.campDefs.forEach(([type, pos, side, name], i) => {
      S.camps.push({ id: 'c' + i, kind: 'camp', type, side, name, x: pos.x, y: pos.y, r: 56, availableAt: 0, busy: null, h: { gauche: 0, droite: 0 } });
    });
    for (const def of CANDIDATES) {
      const c = mkCand(def);
      if (def.id === playerCandId) { c.isPlayer = true; S.player = c; }
      S.cands.push(c);
    }
    for (const c of S.cands) c.st = stats(c);
    addLog('La campagne officielle est ouverte !', null);
    return S;
  }

  function mkCand(def) {
    const q = MAP.QG[def.team];
    return {
      id: nextId++, kind: 'cand', def, team: def.team, x: q.x + U.rand(-30, 30), y: q.y + U.rand(-60, 60), r: 26,
      hp: def.hp, lastMax: def.hp, dead: false, respawnAt: 0, I: CFG.startI, dons: CFG.startDons, items: [],
      cd: { Q: 0, W: 0, E: 0, R: 0 }, atkCd: 0, shield: 0, shieldUntil: 0, buffs: [], slowUntil: 0, slowPct: 0, stunUntil: 0,
      moveTo: null, target: null, campTarget: null, channel: null, dash: null, hitBy: {}, lastAttackedCandAt: -99,
      lane: LANE_BY_ROLE[def.role], ai: { think: 0, nextJungle: U.rand(45, 80), off: U.rand(-60, 60) },
      kills: 0, deaths: 0, conv: 0, isPlayer: false,
    };
  }

  // ── Sondage : part d'influence de chaque candidat, normalisée à 100 % ──
  function share(c) {
    let tot = 0;
    for (const x of S.cands) tot += x.I;
    return c.I / tot;
  }
  function power(c) { return U.clamp(1 + 1.2 * (share(c) - 1 / 6), 0.8, 1.45); }
  // candidats adverses pilotés par l'IA : affaiblis selon la difficulté
  function foeBot(c) { return S.player && !c.isPlayer && c.team !== S.player.team; }

  function stats(c) {
    let dmg = 0, hp = 0, spd = 0, range = 0, as = 0, cdr = 0;
    for (const id of c.items) {
      const it = ITEM_BY_ID[id];
      dmg += it.dmg || 0; hp += it.hp || 0; spd += it.spd || 0; range += it.range || 0; as += it.as || 0; cdr += it.cdr || 0;
    }
    const m = power(c);
    let speed = c.def.spd * (1 + spd);
    let asMul = 1 + as;
    for (const b of c.buffs) {
      if (b.until <= S.t) continue;
      if (b.haste) speed *= 1 + b.haste;
      if (b.as) asMul += b.as;
    }
    if (c.slowUntil > S.t) speed *= 1 - c.slowPct;
    const dm = foeBot(c) ? DIFFICULTY[CFG.difficulty].dmg : 1;
    return {
      m, maxHp: c.def.hp * m * (1 + hp), ad: c.def.ad * m * (1 + dmg) * dm, ap: m * (1 + dmg) * dm,
      range: c.def.range + range, as: c.def.as * asMul, speed, cdr: Math.min(0.4, cdr),
    };
  }

  // ── Journal / textes flottants ──
  function addLog(text, team) {
    S.log.push({ t: S.t, text, team });
    if (S.log.length > 7) S.log.shift();
  }
  function float(x, y, text, color, big) {
    S.floats.push({ x, y, text, color: color || '#fff', until: S.t + (big ? 2 : 1.2), big: !!big });
  }

  // ── Dégâts / KO ──
  function damage(src, tgt, amt) {
    if (amt <= 0) return;
    if (tgt.kind === 'cand') {
      if (tgt.dead) return;
      if (tgt.shield > 0 && tgt.shieldUntil > S.t) {
        const a = Math.min(tgt.shield, amt);
        tgt.shield -= a; amt -= a;
      }
      tgt.hp -= amt;
      if (src && src.kind === 'cand') {
        tgt.hitBy[src.id] = S.t;
        src.lastAttackedCandAt = S.t;
        // chaque polémique fait baisser la cible dans les sondages au profit de l'attaquant
        const tr = Math.min(Math.max(0, tgt.I - 20), amt * 0.008);
        tgt.I -= tr; src.I += tr;
      }
      if (tgt.channel && tgt.channel.type === 'recall') tgt.channel = null;
      if (tgt.hp <= 0) koCand(tgt, src);
    } else if (tgt.kind === 'mil') {
      if (tgt.converted) return;
      tgt.hp -= src && src.kind === 'cand' ? amt * CFG.milDmgBonus : amt;
      if (tgt.hp <= 0) convert(tgt, src);
    }
  }

  function koCand(c, src) {
    c.dead = true; c.deaths++; c.hp = 0; c.channel = null; c.dash = null; c.target = null; c.moveTo = null; c.campTarget = null;
    if (c.busyCamp) { c.busyCamp.busy = null; c.busyCamp = null; }
    c.respawnAt = S.t + 5 + (S.t / 60) * 0.5;
    c.diedAt = S.t;
    const loss = Math.max(0, c.I - 20) * 0.12;
    c.I -= loss;
    let killer = src && src.kind === 'cand' ? src : null;
    const enemies = S.cands.filter((e) => e.team !== c.team);
    if (!killer) {
      let best = -1;
      for (const e of enemies) if (c.hitBy[e.id] && S.t - c.hitBy[e.id] < 10 && c.hitBy[e.id] > best) { best = c.hitBy[e.id]; killer = e; }
    }
    if (killer) {
      killer.I += loss * 0.7; killer.dons += 250; killer.kills++;
      for (const e of enemies) {
        if (e !== killer && c.hitBy[e.id] && S.t - c.hitBy[e.id] < 10) { e.I += loss * 0.15; e.dons += 100; }
      }
      addLog(`${c.def.name} est emporté${c.def.fem ? 'e' : ''} par une polémique de ${killer.def.name}`, killer.team);
    } else {
      for (const e of enemies) e.I += (loss * 0.7) / enemies.length;
      addLog(`${c.def.name} est rattrapé${c.def.fem ? 'e' : ''} par une polémique`, TEAMS[c.team].enemy);
    }
    float(c.x, c.y - 40, 'Scandale !', '#ffd34d', true);
    c.hitBy = {};
    const q = MAP.QG[c.team];
    c.x = q.x; c.y = q.y;
  }

  function convert(m, src) {
    m.converted = true; m.hp = 0; m.voting = null; m.fadeUntil = S.t + 5;
    if (src && src.kind === 'cand') {
      src.dons += 22; src.I += 2.5; src.conv++;
      if (src.isPlayer) float(m.x, m.y - 16, '+22 €', '#ffd34d');
    }
  }

  // ── Vagues de militants ──
  function spawnWave() {
    S.waveN++;
    const growth = 1 + 0.05 * (S.t / 60);
    for (const lane of LANES) {
      const L = MAP.lanes[lane];
      for (const team of ['gauche', 'droite']) {
        const dir = TEAMS[team].dir;
        const up = S.teams[team].up;
        const an = S.obj.top.ctrl === team ? 1.25 : 1;
        const n = Math.min(7, 4 + Math.floor(S.t / 240)); // les vagues grossissent au fil de la campagne
        for (let i = 0; i < n; i++) {
          const ranged = i === 3 || i === 6;
          const s0 = (team === 'gauche' ? 170 : L.len - 170) - dir * i * 46;
          const p = L.at(s0);
          const maxHp = (ranged ? 95 : 150) * growth * (1 + 0.2 * up.hp) * an;
          S.mil.push({
            id: nextId++, kind: 'mil', team, lane, ranged, x: p.x + U.rand(-8, 8), y: p.y + U.rand(-8, 8), r: ranged ? 10 : 12,
            hp: maxHp, maxHp, dmg: (ranged ? 17 : 13) * growth * (1 + 0.2 * up.dmg) * an, range: ranged ? 260 : 46,
            spd: 108 * (1 + 0.12 * up.spd), atkCd: 0, target: null, retarget: 0, voting: null, converted: false,
          });
        }
      }
    }
  }

  // Prochaine "station" d'un militant : bureau à remplir / conquérir, ou objectif
  // une voie est ouverte pour un camp quand il a conquis tous les bureaux adverses de cette voie
  function laneOwnedBy(team, lane) {
    for (const b of S.bureaux) if (b.lane === lane && b.home !== team && b.owner !== team) return false;
    return true;
  }
  function station(m) {
    const dir = TEAMS[m.team].dir;
    const list = S.bureaux.filter((b) => b.lane === m.lane).map((b) => ({ s: b.s, b }));
    list.push({ s: S.obj[m.lane].s, o: S.obj[m.lane] });
    list.sort((a, b) => (a.s - b.s) * dir);
    const unlocked = laneOwnedBy(m.team, m.lane);
    for (const it of list) {
      if (it.b) {
        // on ne vote que dans les bureaux adverses ; un bureau conquis le reste (comme une tourelle détruite)
        if (it.b.owner !== m.team && !it.b.conquered) return it.b;
      } else {
        const o = it.o;
        const full = m.team === 'gauche' ? o.gauge >= o.max : o.gauge <= -o.max;
        if (unlocked && !full) return o;
      }
    }
    return S.obj[m.lane]; // tout est acquis : on tient l'objectif
  }

  function applyVote(m, st) {
    const team = m.team;
    const mates = S.cands.filter((c) => c.team === team);
    const w = S.t >= CFG.secondTour ? 2 : 1; // second tour : bulletins doublés
    if (st.kind === 'bureau') {
      if (st.owner === team) {
        st.g = Math.min(CFG.bureauMax, st.g + 1);
      } else {
        st.g -= w;
        for (const c of mates) c.I += 0.6;
        if (st.g <= 0) {
          st.owner = team; st.g = CFG.bureauMax; st.conquered = true;
          for (const c of mates) { c.I += 10; c.dons += 80; }
          addLog(`Bureau « ${st.name} » conquis par la ${TEAMS[team].name.toLowerCase()}`, team);
          float(st.x, st.y - 50, 'Bureau conquis !', TEAMS[team].light, true);
        }
      }
    } else if (st.kind === 'obj') {
      const full = team === 'gauche' ? st.gauge >= st.max : st.gauge <= -st.max;
      if (full) return;
      st.gauge = U.clamp(st.gauge + TEAMS[team].dir * w, -st.max, st.max);
      for (const c of mates) { c.I += 1; c.dons += 8; }
      if (st.ctrl && Math.sign(st.gauge) !== TEAMS[st.ctrl].dir) {
        addLog(`${st.name} : la ${TEAMS[st.ctrl].name.toLowerCase()} perd la majorité`, TEAMS[st.ctrl].enemy);
        st.ctrl = null;
      }
      if (Math.abs(st.gauge) >= st.max) {
        if (st.id === 'elysee') return endGame(team, 'Élysée conquis');
        if (st.ctrl !== team) {
          st.ctrl = team;
          addLog(`${st.name} : majorité ${TEAMS[team].name.toLowerCase()} !`, team);
          float(st.x, st.y - 80, st.id === 'an' ? 'Majorité à l’Assemblée !' : 'Majorité au Sénat !', TEAMS[team].light, true);
        }
      }
    }
    float(m.x, m.y - 16, 'A voté !', '#ffffff');
  }

  function endGame(team, reason) {
    S.over = true; S.winner = team; S.reason = reason;
    const mates = S.cands.filter((c) => c.team === team).sort((a, b) => b.I - a.I);
    S.president = mates[0];
  }

  // ── Actions des candidats ──
  function canAct(c) { return !c.dead && !c.channel && !c.dash && c.stunUntil <= S.t && !S.over; }

  function cast(c, key, tx, ty) {
    const ab = c.def.abilities[key];
    if (!ab || !canAct(c) || c.cd[key] > 0) return false;
    const st = c.st;
    const ap = st.ap;
    const dx = tx - c.x, dy = ty - c.y;
    const n = U.norm(dx, dy);
    const d = Math.hypot(dx, dy);
    switch (ab.type) {
      case 'skillshot':
        S.proj.push({
          kind: 'shot', src: c, team: c.team, x: c.x, y: c.y, vx: n.x * ab.speed, vy: n.y * ab.speed, range: ab.range, trav: 0,
          dmg: ab.dmg * ap, width: ab.width, slow: ab.slow, slowDur: ab.slowDur, stun: ab.stun, pierce: ab.pierce, hit: new Set(), label: ab.name,
        });
        break;
      case 'nova':
        aoe(c, c.x, c.y, ab.radius, ab.dmg * ap, ab);
        S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: ab.radius, team: c.team, until: S.t + 0.35, t0: S.t });
        break;
      case 'dash': {
        const len = Math.min(ab.range, Math.max(60, d));
        c.dash = { vx: n.x * 1400, vy: n.y * 1400, until: S.t + len / 1400, ab };
        c.target = null; c.moveTo = null;
        break;
      }
      case 'blast': {
        const k = Math.min(1, ab.range / Math.max(1, d));
        const bx = c.x + dx * k, by = c.y + dy * k;
        S.fx.push({ type: 'blast', x: bx, y: by, radius: ab.radius, team: c.team, src: c, at: S.t + ab.delay, t0: S.t, dmg: ab.dmg * ap, ab });
        break;
      }
      case 'shield':
        for (const a of alliesNear(c, ab.radius)) {
          if (a !== c) c.I += 1; // soutenir ses alliés compte aussi dans les sondages
          a.shield = Math.max(a.shieldUntil > S.t ? a.shield : 0, 0) + ab.amount * ap;
          a.shieldUntil = S.t + ab.dur;
          if (ab.as) a.buffs.push({ as: ab.as, until: S.t + ab.dur });
        }
        break;
      case 'heal': {
        const k = Math.min(1, ab.range / Math.max(1, d));
        S.fx.push({ type: 'heal', x: c.x + dx * k, y: c.y + dy * k, radius: ab.radius, team: c.team, hps: ab.hps * ap, until: S.t + ab.dur, t0: S.t });
        break;
      }
      case 'haste':
        for (const a of alliesNear(c, ab.radius)) {
          if (a !== c) c.I += 1;
          a.buffs.push({ haste: ab.pct, until: S.t + ab.dur });
          if (ab.shield) { a.shield = (a.shieldUntil > S.t ? a.shield : 0) + ab.shield * ap; a.shieldUntil = S.t + ab.dur; }
        }
        S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: ab.radius, team: c.team, until: S.t + 0.35, t0: S.t, soft: true });
        break;
    }
    c.cd[key] = ab.cd * (1 - st.cdr);
    if (c.channel && c.channel.type === 'recall') c.channel = null;
    return true;
  }

  function alliesNear(c, radius) {
    if (!radius) return [c];
    return S.cands.filter((a) => a.team === c.team && !a.dead && U.dist(a, c) <= radius);
  }

  function aoe(src, x, y, radius, dmg, ab) {
    const enemy = TEAMS[src.team].enemy;
    for (const e of S.cands) {
      if (e.team !== enemy || e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) <= radius + e.r) {
        damage(src, e, dmg);
        if (ab.slow) { e.slowPct = ab.slow; e.slowUntil = S.t + ab.slowDur; }
        if (ab.stun) e.stunUntil = Math.max(e.stunUntil, S.t + ab.stun);
      }
    }
    for (const m of S.mil) {
      if (m.team !== enemy || m.converted) continue;
      if (Math.hypot(m.x - x, m.y - y) <= radius + m.r) damage(src, m, dmg);
    }
  }

  function recall(c) {
    if (!canAct(c)) return;
    c.channel = { type: 'recall', until: S.t + CFG.recallTime, dur: CFG.recallTime };
    c.target = null; c.moveTo = null; c.campTarget = null;
  }

  function inOwnQG(c) { return U.dist(c, MAP.QG[c.team]) <= CFG.qgRadius + 20; }

  function buy(c, id) {
    const it = ITEM_BY_ID[id];
    if (!it || S.over) return 'Indisponible';
    if (!c.dead && !inOwnQG(c)) return 'Achats uniquement au QG de campagne';
    if (c.dons < it.cost) return 'Pas assez de dons';
    if (it.team) {
      const up = S.teams[c.team].up;
      if (up[it.key] >= 3) return 'Niveau maximum atteint';
      up[it.key]++;
      addLog(`${c.def.name} équipe les militants : ${it.name} (niv. ${up[it.key]})`, c.team);
    } else {
      if (c.items.length >= 6) return 'Inventaire plein (6)';
      const ratio = c.hp / c.st.maxHp;
      c.items.push(id);
      c.st = stats(c);
      c.hp = ratio * c.st.maxHp; c.lastMax = c.st.maxHp;
    }
    c.dons -= it.cost;
    return null;
  }

  function campAvailable(camp) { return S.t >= camp.availableAt && !camp.busy; }

  // ── Mise à jour ──
  function update(dt) {
    if (!S || S.over) return;
    S.t += dt;

    for (const c of S.cands) {
      c.st = stats(c);
      if (!c.dead && Math.abs(c.st.maxHp - c.lastMax) > 0.5) { c.hp *= c.st.maxHp / c.lastMax; c.lastMax = c.st.maxHp; }
      c.buffs = c.buffs.filter((b) => b.until > S.t);
    }

    if (S.t >= S.nextWave) { spawnWave(); S.nextWave += CFG.waveEvery; }
    if (!S.secondTour && S.t >= CFG.secondTour) {
      S.secondTour = true;
      addLog('Second tour ! Chaque bulletin compte désormais double', null);
    }

    // Sénat : élus locaux → parrainages et dons
    const sen = S.obj.bot.ctrl;
    for (const c of S.cands) {
      c.dons += CFG.passiveDons * dt;
      if (sen === c.team) { c.I += 0.25 * dt; c.dons += 1.5 * dt; S.teams[c.team].parrainages += 0.25 * dt; }
    }

    for (const c of S.cands) updateCand(c, dt);
    updateMilitants(dt);
    updateBureaux(dt);
    updateProj(dt);
    updateFx(dt);
    S.floats = S.floats.filter((f) => f.until > S.t);

    if (S.t >= CFG.timeLimit && !S.over) {
      const g = S.obj.mid.gauge;
      let team = g > 0 ? 'gauche' : g < 0 ? 'droite' : null;
      if (!team) {
        const tot = (t) => S.cands.filter((c) => c.team === t).reduce((a, c) => a + c.I, 0);
        team = tot('gauche') >= tot('droite') ? 'gauche' : 'droite';
      }
      endGame(team, 'Scrutin clos (temps écoulé)');
    }
  }

  function moveToward(e, tx, ty, speed, dt) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const step = Math.min(d, speed * dt);
    e.x += (dx / d) * step; e.y += (dy / d) * step;
    clampToCity(e);
    return step >= d - 0.5;
  }
  function clampToCity(e) {
    const d = Math.hypot(e.x, e.y);
    const max = MAP.R - 30;
    if (d > max) { e.x *= max / d; e.y *= max / d; }
  }

  function updateCand(c, dt) {
    if (c.dead) {
      if (S.t >= c.respawnAt) {
        c.dead = false; c.st = stats(c); c.hp = c.st.maxHp; c.lastMax = c.st.maxHp;
        const q = MAP.QG[c.team];
        c.x = q.x + U.rand(-30, 30); c.y = q.y + U.rand(-50, 50);
      }
      return;
    }
    for (const k in c.cd) c.cd[k] = Math.max(0, c.cd[k] - dt);
    c.atkCd = Math.max(0, c.atkCd - dt);
    if (c.shieldUntil <= S.t) c.shield = 0;

    // QG : soin rapide chez soi, service d'ordre chez l'adversaire
    if (inOwnQG(c)) c.hp = Math.min(c.st.maxHp, c.hp + c.st.maxHp * 0.15 * dt);
    else c.hp = Math.min(c.st.maxHp, c.hp + c.st.maxHp * 0.005 * dt);
    const eq = MAP.QG[TEAMS[c.team].enemy];
    if (U.dist(c, eq) < CFG.qgRadius + 40) damage(null, c, 400 * dt);
    if (c.dead) return;

    // Zones de soin
    for (const f of S.fx) {
      if (f.type === 'heal' && f.team === c.team && Math.hypot(c.x - f.x, c.y - f.y) <= f.radius) {
        c.hp = Math.min(c.st.maxHp, c.hp + f.hps * dt);
      }
    }

    // Déplacement éclair
    if (c.dash) {
      c.x += c.dash.vx * dt; c.y += c.dash.vy * dt; clampToCity(c);
      if (S.t >= c.dash.until) {
        const ab = c.dash.ab;
        if (ab.dmg || ab.stun) {
          aoe(c, c.x, c.y, ab.radius || 150, (ab.dmg || 0) * c.st.ap, ab);
          S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: ab.radius || 150, team: c.team, until: S.t + 0.3, t0: S.t });
        }
        c.dash = null;
      }
      return;
    }

    // Canalisation (camp de jungle : immobilisé 10 s ; retour au QG)
    if (c.channel) {
      if (S.t >= c.channel.until) {
        const ch = c.channel;
        c.channel = null;
        if (ch.type === 'recall') {
          const q = MAP.QG[c.team];
          c.x = q.x; c.y = q.y;
        } else if (ch.type === 'camp') harvest(c, ch.camp);
      }
      return;
    }
    if (c.stunUntil > S.t) return;

    if (!c.isPlayer) AI.think(c, dt, S);
    if (c.channel || c.dash) return;

    // Camp de jungle ciblé
    if (c.campTarget) {
      const camp = c.campTarget;
      if (!campAvailable(camp)) { c.campTarget = null; }
      else if (U.dist(c, camp) <= camp.r + c.r + 24) {
        c.channel = { type: 'camp', camp, until: S.t + CFG.campChannel, dur: CFG.campChannel };
        camp.busy = c; c.busyCamp = camp; c.campTarget = null; c.moveTo = null; c.target = null;
        return;
      } else { moveToward(c, camp.x, camp.y, c.st.speed, dt); return; }
    }

    // Attaque automatique du joueur à l'arrêt : cible la plus proche à portée
    if (c.isPlayer && !c.target && !c.moveTo && !c.campTarget) {
      let best = null, bd = Infinity;
      const enemy = TEAMS[c.team].enemy;
      for (const e of S.cands) if (e.team === enemy && !e.dead) { const d = U.dist(c, e) - e.r; if (d <= c.st.range && d < bd) { bd = d; best = e; } }
      for (const m of S.mil) if (m.team === enemy && !m.converted) { const d = U.dist(c, m) - m.r; if (d <= c.st.range && d < bd) { bd = d; best = m; } }
      if (best) { c.target = best; c.autoTarget = true; }
    }

    // Attaque
    const tg = c.target;
    if (tg) {
      const alive = tg.kind === 'cand' ? !tg.dead : !tg.converted && S.mil.includes(tg);
      if (!alive) c.target = null;
      else {
        const d = U.dist(c, tg);
        if (d <= c.st.range + tg.r) {
          if (c.atkCd <= 0) {
            S.proj.push({ kind: 'atk', src: c, team: c.team, x: c.x, y: c.y, target: tg, speed: 1100, dmg: c.st.ad });
            c.atkCd = 1 / c.st.as;
            c.lastAtkAt = S.t; c.face = Math.atan2(tg.y - c.y, tg.x - c.x);
          }
          return;
        }
        // une cible automatique hors de portée est abandonnée (on ne poursuit pas)
        if (c.autoTarget) { c.target = null; c.autoTarget = false; return; }
        moveToward(c, tg.x, tg.y, c.st.speed, dt);
        return;
      }
    }
    if (c.moveTo) {
      if (moveToward(c, c.moveTo.x, c.moveTo.y, c.st.speed, dt)) c.moveTo = null;
    }
  }

  function harvest(c, camp) {
    camp.busy = null; c.busyCamp = null;
    const team = c.team;
    const h = camp.h[team];
    if (camp.type === 'mairie') {
      // plus le camp a déjà été vidé par ce camp, plus la mairie rapporte de parrainages
      const p = Math.round(12 * (1 + 0.35 * h));
      c.I += p; S.teams[team].parrainages += p;
      float(camp.x, camp.y - 60, `+${p} parrainages`, '#9be28f', true);
      camp.availableAt = S.t + CFG.mairieRespawn;
    } else {
      const d = Math.round(90 + 25 * h);
      c.dons += d;
      float(camp.x, camp.y - 60, `+${d} € de dons`, '#ffd34d', true);
      camp.availableAt = S.t + CFG.meetingRespawn;
    }
    camp.h[team]++;
  }

  function updateMilitants(dt) {
    const keep = [];
    for (const m of S.mil) {
      if (m.converted) {
        // le militant converti rentre chez lui sans voter
        const q = MAP.QG[m.team];
        moveToward(m, q.x, q.y, 140, dt);
        if (S.t < m.fadeUntil && U.dist(m, q) > 60) keep.push(m);
        continue;
      }
      if (m.voting) {
        if (S.t >= m.voting.until) { applyVote(m, m.voting.st); continue; } // a voté : il quitte la carte
        keep.push(m);
        continue;
      }
      keep.push(m);
      m.atkCd = Math.max(0, m.atkCd - dt);
      m.retarget -= dt;
      if (m.retarget <= 0 || (m.target && (m.target.dead || m.target.converted))) {
        m.retarget = 0.25;
        m.target = acquire(m);
      }
      const L = MAP.lanes[m.lane];
      if (m.target) {
        const t = m.target;
        const d = U.dist(m, t);
        if (d <= m.range + m.r + t.r) {
          if (m.atkCd <= 0) {
            if (m.ranged) S.proj.push({ kind: 'atk', src: m, team: m.team, x: m.x, y: m.y, target: t, speed: 800, dmg: m.dmg, small: true });
            else damage(m, t, m.dmg);
            m.atkCd = 1.1;
          }
        } else moveToward(m, t.x, t.y, m.spd, dt);
        continue;
      }
      const st = station(m);
      if (U.dist(m, st) <= st.r + m.r + 16) {
        m.voting = { st, until: S.t + 0.8 };
        continue;
      }
      const curS = L.project(m);
      const ds = st.s - curS;
      if (Math.abs(ds) < 40) moveToward(m, st.x, st.y, m.spd, dt);
      else {
        const p = L.at(curS + Math.sign(ds) * Math.min(90, Math.abs(ds)));
        moveToward(m, p.x, p.y, m.spd, dt);
      }
    }
    S.mil = keep;
    // légère séparation pour éviter les empilements
    for (let i = 0; i < S.mil.length; i++) {
      const a = S.mil[i];
      if (a.converted) continue;
      for (let j = i + 1; j < S.mil.length; j++) {
        const b = S.mil[j];
        if (b.converted) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r + 2;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2), push = (min - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push; b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }
  }

  function acquire(m) {
    let best = null, bd = 330;
    for (const o of S.mil) {
      if (o.team === m.team || o.converted) continue;
      const d = U.dist(m, o);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) return best;
    // candidat adverse qui vient d'attaquer un candidat allié, sinon le plus proche
    bd = 280;
    for (const c of S.cands) {
      if (c.team === m.team || c.dead) continue;
      const d = U.dist(m, c);
      const lim = S.t - c.lastAttackedCandAt < 2 ? 420 : 280;
      if (d < lim && d < bd + (lim - 280)) { bd = d; best = c; }
    }
    return best;
  }

  function updateBureaux(dt) {
    const min = S.t / 60;
    for (const b of S.bureaux) {
      b.atkCd = Math.max(0, b.atkCd - dt);
      if (b.atkCd > 0) continue;
      const enemy = TEAMS[b.owner].enemy;
      let tgt = null, bd = CFG.bureauRange;
      // priorité : un candidat qui agresse un candidat allié à portée
      for (const c of S.cands) {
        if (c.team !== enemy || c.dead) continue;
        const d = U.dist(b, c);
        if (d < CFG.bureauRange && S.t - c.lastAttackedCandAt < 2) {
          const victimNear = S.cands.some((a) => a.team === b.owner && !a.dead && U.dist(a, b) < CFG.bureauRange + 100);
          if (victimNear && d < bd) { bd = d; tgt = c; }
        }
      }
      // le président du bureau ne s'en prend jamais aux électeurs (militants) : seulement aux candidats adverses
      if (!tgt) {
        bd = CFG.bureauRange;
        for (const c of S.cands) if (c.team === enemy && !c.dead) { const d = U.dist(b, c); if (d < bd) { bd = d; tgt = c; } }
      }
      if (tgt) {
        const dmg = (tgt.isPlayer ? 60 : 80) + 4 * min;
        S.proj.push({ kind: 'atk', src: b, team: b.owner, x: b.x, y: b.y - 20, target: tgt, speed: 900, dmg, bureau: true });
        b.atkCd = 1.25;
      }
    }
  }

  function updateProj(dt) {
    const keep = [];
    for (const p of S.proj) {
      if (p.kind === 'atk') {
        const t = p.target;
        const alive = t.kind === 'cand' ? !t.dead : !t.converted && S.mil.includes(t);
        if (!alive) continue;
        const arrived = moveToward(p, t.x, t.y, p.speed, dt);
        if (arrived || U.dist(p, t) < t.r) {
          damage(p.src.kind === 'bureau' ? null : p.src, t, p.dmg);
          continue;
        }
        keep.push(p);
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.trav += Math.hypot(p.vx, p.vy) * dt;
        let done = p.trav >= p.range;
        const enemy = TEAMS[p.team].enemy;
        const targets = S.cands.filter((c) => c.team === enemy && !c.dead).concat(S.mil.filter((m) => m.team === enemy && !m.converted));
        for (const t of targets) {
          if (p.hit.has(t)) continue;
          if (Math.hypot(t.x - p.x, t.y - p.y) <= p.width + t.r) {
            p.hit.add(t);
            damage(p.src, t, p.dmg);
            if (t.kind === 'cand') {
              if (p.slow) { t.slowPct = p.slow; t.slowUntil = S.t + p.slowDur; }
              if (p.stun) t.stunUntil = Math.max(t.stunUntil, S.t + p.stun);
            }
            if (!p.pierce) { done = true; break; }
          }
        }
        if (!done) keep.push(p);
      }
    }
    S.proj = keep;
  }

  function updateFx() {
    const keep = [];
    for (const f of S.fx) {
      if (f.type === 'blast') {
        if (!f.done && S.t >= f.at) {
          f.done = true;
          aoe(f.src, f.x, f.y, f.radius, f.dmg, f.ab);
          f.until = S.t + 0.4;
        }
        if (!f.done || S.t < f.until) keep.push(f);
      } else if (S.t < f.until) keep.push(f);
    }
    S.fx = keep;
  }

  return {
    newGame, update, cast, buy, recall, share, power, stats, canAct, campAvailable, inOwnQG, laneOwnedBy, station,
    foeBot,
    get S() { return S; },
  };
})();
