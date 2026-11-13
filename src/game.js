'use strict';
// ─── Moteur de règles ─────────────────────────────────────────────────────────
const Game = (() => {
  let S = null;
  let nextId = 1;
  const LANES = ['top', 'mid', 'bot'];

  // ── Création de la partie ──
  // Composition des équipes : 1 tank, 1 DPS, 1 soutien par camp, pris dans le camp ou chez les neutres.
  // buildRoster(candId, team) pour le solo, ou buildRoster([{ candId, team, pid }…]) pour plusieurs humains :
  // les bots complètent chaque camp avec les classes manquantes.
  function buildRoster(picks, playerTeam) {
    if (!Array.isArray(picks)) picks = picks ? [{ candId: picks, team: playerTeam }] : [];
    const used = new Set();
    const roster = [];
    for (const pk of picks) {
      const pd = CAND_BY_ID[pk.candId];
      if (!pd || used.has(pd.id)) continue;
      roster.push({ def: pd, team: pk.team || pd.team, player: true, pid: pk.pid, name: pk.name });
      used.add(pd.id);
    }
    for (const team of ['gauche', 'droite']) {
      for (const cls of ['tank', 'dps', 'soutien']) {
        if (roster.filter((r) => r.team === team).length >= 3) break;
        if (roster.some((r) => r.team === team && r.def.cls === cls)) continue;
        const pool = CANDIDATES.filter((d) => d.cls === cls && !used.has(d.id) && (d.team === team || d.neutral));
        // les candidats du camp sont bien plus souvent choisis que les neutres
        const weighted = pool.flatMap((d) => (d.neutral ? [d] : [d, d, d]));
        const d = U.pick(weighted);
        used.add(d.id);
        roster.push({ def: d, team });
      }
      // deux humains de même classe : on complète avec n'importe quelle classe
      while (roster.filter((r) => r.team === team).length < 3) {
        const pool = CANDIDATES.filter((d) => !used.has(d.id) && (d.team === team || d.neutral));
        const d = U.pick(pool);
        used.add(d.id);
        roster.push({ def: d, team });
      }
    }
    // ordre stable : gauche puis droite (les identifiants des candidats en dépendent)
    return roster.filter((r) => r.team === 'gauche').concat(roster.filter((r) => r.team === 'droite'));
  }

  // opts.online : partie sur serveur (pas de « joueur local », pas de difficulté)
  function newGame(playerCandId, playerTeam, roster, opts) {
    opts = opts || {};
    nextId = 1;
    S = {
      t: 0, over: false, winner: null, president: null, reason: '',
      cands: [], mil: [], proj: [], fx: [], floats: [], log: [],
      bureaux: [], obj: {}, camps: [],
      teams: {
        gauche: { up: { hp: 0, dmg: 0, spd: 0, n: 0, poll: 0 }, parrainages: 0 },
        droite: { up: { hp: 0, dmg: 0, spd: 0, n: 0, poll: 0 }, parrainages: 0 },
      },
      nextWave: CFG.waveFirst, waveN: 0, player: null, nerfTeam: null,
      // parties courtes : on monte plus vite dans les sondages
      pollMul: Math.sqrt(600 / CFG.timeLimit), elyseeWarned: {},
    };
    CFG.secondTour = Math.round(CFG.timeLimit * 0.6);
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
    S.roster = roster || buildRoster(playerCandId, playerTeam);
    for (const r of S.roster) {
      const c = mkCand(r.def, r.team);
      if (r.player) {
        c.isPlayer = true; c.pid = r.pid; c.pname = r.name;
        if (!S.player && !opts.online) S.player = c;
      }
      S.cands.push(c);
    }
    // la difficulté ne s'applique qu'aux bots adverses du solo
    if (S.player && !opts.online) S.nerfTeam = TEAMS[S.player.team].enemy;
    for (const c of S.cands) c.st = stats(c);
    addLog('La campagne officielle est ouverte !', null);
    return S;
  }

  function mkCand(def, team) {
    const q = MAP.QG[team];
    return {
      id: nextId++, kind: 'cand', def, team, x: q.x + U.rand(-30, 30), y: q.y + U.rand(-60, 60), r: 26,
      hp: def.hp, lastMax: def.hp, dead: false, respawnAt: 0, I: CFG.startI, dons: CFG.startDons, items: [], lv: {}, dots: [], regen: null, weakUntil: 0, weakPct: 0,
      cd: { Q: 0, W: 0, E: 0, R: 0 }, atkCd: 0, shield: 0, shieldUntil: 0, buffs: [], slowUntil: 0, slowPct: 0, stunUntil: 0,
      moveTo: null, target: null, campTarget: null, channel: null, dash: null, hitBy: {}, lastAttackedCandAt: -99,
      lane: def.lane, ai: { think: 0, nextJungle: U.rand(45, 80), off: U.rand(-60, 60) },
      kills: 0, deaths: 0, conv: 0, isPlayer: false, unl: {},
    };
  }

  // ── Sondage : intentions de vote en %, tout le monde part de 0 ──
  // les gains viennent des indécis (100 % − somme des candidats) ; les polémiques et scandales
  // transfèrent des points d'un candidat à l'autre.
  function share(c) { return c.I / 100; }
  function undecided() { let tot = 0; for (const x of S.cands) tot += x.I; return Math.max(0, 100 - tot); }
  function gain(c, x) {
    if (x <= 0) return 0;
    const u = undecided();
    const avg = (100 - u) / S.cands.length;
    const catchUp = avg > 0 ? 1 + Math.max(0, (avg - c.I) / avg) : 1; // les retardataires remontent plus vite
    const amt = x * CFG.pollGain * S.pollMul * Math.max(0.25, u / 100) * catchUp;
    const fromU = Math.min(u, amt);
    c.I += fromU;
    // plus d'indécis : les électeurs viennent du candidat adverse en tête
    if (amt > fromU) {
      const lead = S.cands.filter((e) => e.team !== c.team).sort((a, b) => b.I - a.I)[0];
      const t = Math.min(lead.I, (amt - fromU) * 0.5);
      lead.I -= t; c.I += t;
    }
    checkUnlock(c);
    return amt;
  }
  function transfer(from, to, x) {
    const amt = Math.min(from.I, x);
    from.I -= amt;
    if (to) { to.I += amt; checkUnlock(to); }
    else for (const e of S.cands) if (e.team !== from.team) { e.I += amt / 3; checkUnlock(e); }
    return amt;
  }
  // un sort débloqué le reste, même si le candidat redescend ensuite dans les sondages
  function checkUnlock(c) {
    for (const k of ['Q', 'W', 'E', 'R']) {
      if (!c.unl[k] && c.I >= CFG.unlock[k]) {
        c.unl[k] = true;
        if (!c.isPlayer) continue;
        float(c.x, c.y - 60, `${KEY_LABEL[k]} débloqué : ${c.def.abilities[k].name} !`, '#ffd34d', true, c.id);
        addLog(`${c.def.name} atteint ${CFG.unlock[k]} % : ${c.def.abilities[k].name} débloqué`, c.team);
      }
    }
  }
  function unlocked(c, key) { return !!c.unl[key]; }
  function power(c) { return U.clamp(0.85 + 0.009 * c.I, 0.85, 1.4); }
  // candidats adverses pilotés par l'IA : affaiblis selon la difficulté
  function foeBot(c) { return !!S.nerfTeam && !c.isPlayer && c.team === S.nerfTeam; }

  function stats(c) {
    const b = { dmg: 0, ap: 0, hp: 0, spd: 0, range: 0, as: 0, cdr: 0, armor: 0, regen: 0, income: 0, discount: 0 };
    for (const id of c.items) {
      const it = ITEM_BY_ID[id];
      const v = it.lv[c.lv[id] - 1].v;
      b[it.stat] += v;
      if (it.stat === 'range') b.dmg += v / 400;
    }
    let { dmg, hp, spd, range, as, cdr } = b;
    const m = power(c);
    let speed = c.def.spd * (1 + spd);
    let asMul = 1 + as;
    for (const b of c.buffs) {
      if (b.until <= S.t) continue;
      if (b.haste) speed *= 1 + b.haste;
      if (b.as) asMul += b.as;
      if (b.dmg) dmg += b.dmg;
    }
    if (c.slowUntil > S.t) speed *= 1 - c.slowPct;
    let dm = foeBot(c) ? DIFFICULTY[CFG.difficulty].dmg : 1;
    if (c.weakUntil > S.t) { dm *= 1 - c.weakPct; speed *= 1 - c.weakPct * 0.6; } // affaibli
    return {
      m, maxHp: c.def.hp * m * (1 + hp), ad: c.def.ad * m * (1 + dmg) * dm, ap: m * (1 + dmg + b.ap) * dm,
      range: c.def.range + range, as: c.def.as * asMul, speed, cdr: Math.min(0.4, cdr), armor: Math.min(0.45, b.armor), regen: b.regen, income: b.income, discount: Math.min(0.3, b.discount),
    };
  }

  // ── Journal / textes flottants ──
  function addLog(text, team) {
    S.log.push({ t: S.t, text, team });
    if (S.log.length > 7) S.log.shift();
  }
  // owner : identifiant du candidat à qui le texte est destiné (sinon visible par tous)
  function float(x, y, text, color, big, owner) {
    S.floats.push({ x, y, text, color: color || '#fff', until: S.t + (big ? 2 : 1.2), big: !!big, owner: owner || 0 });
  }

  // ── Dégâts / KO ──
  function damage(src, tgt, amt) {
    if (amt <= 0) return;
    if (tgt.kind === 'cand') {
      if (tgt.dead) return;
      if (tgt.st && tgt.st.armor) amt *= 1 - tgt.st.armor; // service d'ordre, avocats…
      if (tgt.shield > 0 && tgt.shieldUntil > S.t) {
        const a = Math.min(tgt.shield, amt);
        tgt.shield -= a; amt -= a;
      }
      tgt.hp -= amt;
      if (src && src.kind === 'cand') {
        tgt.hitBy[src.id] = S.t;
        src.lastAttackedCandAt = S.t;
        // chaque polémique fait baisser la cible dans les sondages au profit de l'attaquant
        transfer(tgt, src, amt * CFG.hitPoll);
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
    c.dead = true; c.deaths++; c.hp = 0; c.channel = null; c.dots = []; c.regen = null; c.weakUntil = 0; c.dash = null; c.target = null; c.moveTo = null; c.campTarget = null;
    if (c.busyCamp) { c.busyCamp.busy = null; c.busyCamp = null; }
    // le délai de retour suit le niveau dans les sondages (1 s par point, de 3 à 15 s)
    c.respawnAt = S.t + U.clamp(Math.round(c.I), 3, CFG.respawnMax);
    for (const k in c.cd) c.cd[k] = 0; // recharges remises à zéro
    c.diedAt = S.t;
    const loss = c.I * CFG.koPoll;
    c.I -= loss; // une partie des électeurs déçus retourne chez les indécis
    let killer = src && src.kind === 'cand' ? src : null;
    const enemies = S.cands.filter((e) => e.team !== c.team);
    if (!killer) {
      let best = -1;
      for (const e of enemies) if (c.hitBy[e.id] && S.t - c.hitBy[e.id] < 10 && c.hitBy[e.id] > best) { best = c.hitBy[e.id]; killer = e; }
    }
    if (killer) {
      killer.I += loss * 0.7; checkUnlock(killer); killer.dons += 250; killer.kills++;
      for (const e of enemies) {
        if (e !== killer && c.hitBy[e.id] && S.t - c.hitBy[e.id] < 10) { e.I += loss * 0.15; checkUnlock(e); e.dons += 100; }
      }
      addLog(`${c.def.name} est emporté${c.def.fem ? 'e' : ''} par une polémique de ${killer.def.name}`, killer.team);
    } else {
      for (const e of enemies) { e.I += (loss * 0.7) / enemies.length; checkUnlock(e); }
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
      src.dons += 22; gain(src, 0.45); src.conv++;
      if (src.isPlayer) float(m.x, m.y - 16, '+22 €', '#ffd34d', false, src.id);
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
        const n = Math.min(7, 4 + Math.floor(S.t / 240)) + up.n; // les vagues grossissent ; les flyers recrutent
        for (let i = 0; i < n; i++) {
          const ranged = i === 3 || i === 6 || i === 9;
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
    for (const b of S.bureaux) if (b.lane === lane && b.owner !== team) return false;
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
        // tout bureau tenu par l'adversaire sur le chemin (y compris un des siens qu'il a pris) doit être repris d'abord
        if (it.b.owner !== m.team) return it.b;
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
    const pm = 1 + 0.25 * S.teams[team].up.poll; // affiches : chaque bulletin pèse plus dans les sondages
    if (st.kind === 'bureau') {
      if (st.owner === team) {
        st.g = Math.min(CFG.bureauMax, st.g + 1);
      } else {
        st.g -= w;
        for (const c of mates) gain(c, 0.1 * pm);
        if (st.g <= 0) {
          const back = st.home === team;
          // un bureau repris par son camp d'origine ne retrouve que la moitié de ses bulletins
          st.owner = team; st.g = back ? Math.ceil(CFG.bureauMax / 2) : CFG.bureauMax; st.conquered = !back;
          for (const c of mates) { gain(c, 1.6 * pm); c.dons += 80; }
          addLog(`Bureau « ${st.name} » ${back ? 'repris' : 'conquis'} par la ${TEAMS[team].name.toLowerCase()}`, team);
          float(st.x, st.y - 50, back ? 'Bureau repris !' : 'Bureau conquis !', TEAMS[team].light, true);
        }
      }
    } else if (st.kind === 'obj') {
      const full = team === 'gauche' ? st.gauge >= st.max : st.gauge <= -st.max;
      if (full) return;
      st.gauge = U.clamp(st.gauge + TEAMS[team].dir * w, -st.max, st.max);
      for (const c of mates) { gain(c, 0.17 * pm); c.dons += 8; }
      if (st.ctrl && Math.sign(st.gauge) !== TEAMS[st.ctrl].dir) {
        addLog(`${st.name} : la ${TEAMS[st.ctrl].name.toLowerCase()} perd la majorité`, TEAMS[st.ctrl].enemy);
        st.ctrl = null;
      }
      if (Math.abs(st.gauge) >= st.max) {
        if (st.ctrl !== team && st.id === 'elysee') {
          st.ctrl = team;
          addLog(`Élysée : la ${TEAMS[team].name.toLowerCase()} remporte la présidentielle !`, team);
          float(st.x, st.y - 80, 'Présidentielle gagnée !', TEAMS[team].light, true);
        } else if (st.ctrl !== team) {
          st.ctrl = team;
          addLog(`${st.name} : majorité ${TEAMS[team].name.toLowerCase()} !`, team);
          float(st.x, st.y - 80, st.id === 'an' ? 'Majorité à l’Assemblée !' : 'Majorité au Sénat !', TEAMS[team].light, true);
        }
      }
    }
    float(m.x, m.y - 16, 'A voté !', '#ffffff');
  }

  // Victoire : Élysée plein ET majorité à l'Assemblée ou au Sénat
  function elyseeFull(team) { const o = S.obj.mid; return team === 'gauche' ? o.gauge >= o.max : o.gauge <= -o.max; }
  function checkVictory() {
    if (S.over) return;
    for (const team of ['gauche', 'droite']) {
      if (!elyseeFull(team)) continue;
      const an = S.obj.top.ctrl === team, sen = S.obj.bot.ctrl === team;
      if (an || sen) return endGame(team, `Présidentielle et majorité ${an && sen ? 'dans les deux chambres' : an ? 'à l’Assemblée' : 'au Sénat'}`);
      if (!S.elyseeWarned[team]) {
        S.elyseeWarned[team] = true;
        addLog(`Cohabitation ! La ${TEAMS[team].name.toLowerCase()} tient l’Élysée mais doit encore gagner l’Assemblée ou le Sénat`, team);
      }
    }
  }
  function endGame(team, reason, pres) {
    S.over = true; S.winner = team; S.reason = reason;
    const mates = S.cands.filter((c) => c.team === team).sort((a, b) => b.I - a.I);
    S.president = pres || mates[0];
  }

  // ── Actions des candidats ──
  function canAct(c) { return !c.dead && !c.channel && !c.dash && c.stunUntil <= S.t && !S.over; }

  function cast(c, key, tx, ty) {
    const ab = c.def.abilities[key];
    if (!ab || !canAct(c) || c.cd[key] > 0 || !unlocked(c, key)) return false;
    const st = c.st;
    const ap = st.ap;
    const dx = tx - c.x, dy = ty - c.y;
    const n = U.norm(dx, dy);
    const d = Math.hypot(dx, dy);
    switch (ab.type) {
      case 'skillshot':
        S.proj.push({
          kind: 'shot', src: c, team: c.team, x: c.x, y: c.y, vx: n.x * ab.speed, vy: n.y * ab.speed, range: ab.range, trav: 0,
          dmg: ab.dmg * ap, width: ab.width, ab, pierce: ab.pierce, hit: new Set(), label: ab.name, word: ab.name,
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
        if (ab.radius) S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: ab.radius, team: c.team, until: S.t + 0.4, t0: S.t, soft: true });
        for (const a of alliesNear(c, ab.radius)) {
          if (a !== c) gain(c, 0.15); // soutenir ses alliés compte aussi dans les sondages
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
      case 'zone': {
        const k = Math.min(1, ab.range / Math.max(1, d));
        S.fx.push({ type: 'zone', x: c.x + dx * k, y: c.y + dy * k, radius: ab.radius, team: c.team, src: c, dps: ab.dps * ap, until: S.t + ab.dur, t0: S.t });
        break;
      }
      case 'selfheal':
        heal(c, c, c.st.maxHp * ab.pct);
        if (ab.haste) c.buffs.push({ haste: ab.haste, until: S.t + ab.dur });
        S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: 90, team: c.team, until: S.t + 0.4, t0: S.t, heal: true });
        break;
      case 'regen':
        c.regen = { hps: (c.st.maxHp * ab.pct) / ab.dur, until: S.t + ab.dur };
        break;
      case 'globalheal':
        for (const a of S.cands) {
          if (a.team !== c.team || a.dead) continue;
          heal(c, a, a.st.maxHp * ab.pct);
          if (ab.haste) a.buffs.push({ haste: ab.haste, until: S.t + ab.dur });
          S.fx.push({ type: 'ring', x: a.x, y: a.y, radius: 110, team: a.team, until: S.t + 0.6, t0: S.t, heal: true });
          if (a !== c) gain(c, 0.2);
        }
        break;
      case 'haste':
        for (const a of alliesNear(c, ab.radius)) {
          if (a !== c) gain(c, 0.15);
          a.buffs.push({ haste: ab.pct, until: S.t + ab.dur });
          if (ab.shield) { a.shield = (a.shieldUntil > S.t ? a.shield : 0) + ab.shield * ap; a.shieldUntil = S.t + ab.dur; }
        }
        S.fx.push({ type: 'ring', x: c.x, y: c.y, radius: ab.radius, team: c.team, until: S.t + 0.35, t0: S.t, soft: true });
        break;
    }
    if (ab.buff) c.buffs.push({ dmg: ab.buff.dmg, until: S.t + ab.buff.dur });
    c.cd[key] = ab.cd * (1 - st.cdr);
    if (c.channel && c.channel.type === 'recall') c.channel = null;
    return true;
  }

  // effets secondaires d'un sort sur un candidat touché
  function afflict(src, e, ab) {
    if (!ab || e.kind !== 'cand') return;
    if (ab.slow) { e.slowPct = ab.slow; e.slowUntil = S.t + ab.slowDur; }
    if (ab.stun) e.stunUntil = Math.max(e.stunUntil, S.t + ab.stun);
    if (ab.dot) e.dots.push({ src, dps: ab.dot.dps * src.st.ap, until: S.t + ab.dot.dur });
    if (ab.weaken) { e.weakPct = Math.max(e.weakUntil > S.t ? e.weakPct : 0, ab.weaken.pct); e.weakUntil = S.t + ab.weaken.dur; }
  }
  function heal(src, a, amt) {
    const before = a.hp;
    a.hp = Math.min(a.st.maxHp, a.hp + amt);
    if (a.hp - before > 1 && (a.isPlayer || src.isPlayer)) float(a.x, a.y - 30, `+${Math.round(a.hp - before)}`, '#7be38f', false, a.isPlayer ? a.id : src.id);
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
        afflict(src, e, ab);
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

  // prochain niveau d'un objet : de plus en plus cher, de plus en plus puissant
  function itemNext(c, id) {
    const it = ITEM_BY_ID[id];
    const off = 1 - ((c.st && c.st.discount) || 0); // mesures d'économies : tout coûte moins cher
    if (it.team) {
      const lvl = S.teams[c.team].up[it.key];
      return lvl >= 3 ? null : { lvl: lvl + 1, name: it.name, cost: Math.round(it.cost * (lvl + 1) * off), desc: it.desc };
    }
    const lvl = c.lv[id] || 0;
    if (lvl >= it.lv.length) return null;
    const L = it.lv[lvl];
    return { lvl: lvl + 1, name: itemName(it, c.team, lvl + 1), cost: Math.round(L.cost * off), desc: it.fmt(L.v) };
  }
  function buy(c, id) {
    const it = ITEM_BY_ID[id];
    if (!it || S.over) return 'Indisponible';
    if (!c.dead && !inOwnQG(c)) return 'Achats uniquement au QG de campagne';
    const nx = itemNext(c, id);
    if (!nx) return 'Niveau maximum atteint';
    if (!it.team && !c.lv[id] && c.items.length >= 6) return 'Inventaire plein (6)';
    if (c.dons < nx.cost) return 'Pas assez de dons';
    if (it.team) {
      const up = S.teams[c.team].up;
      up[it.key]++;
      addLog(`${c.def.name} équipe les militants : ${it.name} (niv. ${up[it.key]})`, c.team);
    } else {
      const ratio = c.hp / c.st.maxHp;
      if (!c.lv[id]) c.items.push(id);
      c.lv[id] = nx.lvl;
      c.st = stats(c);
      c.hp = ratio * c.st.maxHp; c.lastMax = c.st.maxHp;
    }
    c.dons -= nx.cost;
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
      c.dons += (CFG.passiveDons + c.st.income) * dt;
      if (sen === c.team) { gain(c, 0.04 * dt); c.dons += 1.5 * dt; S.teams[c.team].parrainages += 0.25 * dt; }
    }

    for (const c of S.cands) { if (c.isPlayer) steer(c); updateCand(c, dt); }
    updateMilitants(dt);
    updateBureaux(dt);
    updateProj(dt);
    updateFx(dt);
    S.floats = S.floats.filter((f) => f.until > S.t);

    checkVictory();
    // fin du temps : le candidat en tête des sondages l'emporte pour son camp
    if (S.t >= CFG.timeLimit && !S.over) {
      const top = [...S.cands].sort((a, b) => b.I - a.I)[0];
      endGame(top.team, `Fin du temps : ${top.def.name} arrive en tête des sondages`, top);
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
    else c.hp = Math.min(c.st.maxHp, c.hp + c.st.maxHp * (0.005 + c.st.regen) * dt);
    const eq = MAP.QG[TEAMS[c.team].enemy];
    if (U.dist(c, eq) < CFG.qgRadius + 40) damage(null, c, 400 * dt);
    if (c.dead) return;

    // Brûlures (dégâts sur la durée) et régénération
    if (c.dots.length) {
      c.dots = c.dots.filter((d) => d.until > S.t);
      for (const d of c.dots) { damage(d.src, c, d.dps * dt); if (c.dead) return; }
    }
    if (c.regen) {
      if (c.regen.until <= S.t) c.regen = null;
      else c.hp = Math.min(c.st.maxHp, c.hp + c.regen.hps * dt);
    }

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

    // Canalisation (camp de jungle : rester immobile ; retour au QG)
    if (c.channel && (c.moveTo || c.campTarget || (c.target && !c.autoTarget))) {
      // le candidat bouge : la canalisation est annulée et repartira de zéro
      if (c.channel.type === 'camp') { c.channel.camp.busy = null; c.busyCamp = null; }
      if (c.isPlayer) float(c.x, c.y - 50, c.channel.type === 'camp' ? 'Récolte annulée' : 'Retour annulé', '#ff9b9b', false, c.id);
      c.channel = null;
    }
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
        const dur = campDuration(c, camp);
        c.channel = { type: 'camp', camp, until: S.t + dur, dur };
        camp.busy = c; c.busyCamp = camp; c.campTarget = null; c.moveTo = null; c.target = null;
        return;
      } else { moveToward(c, camp.x, camp.y, c.st.speed, dt); return; }
    }

    if (c.isPlayer) { playerCombat(c, dt); return; }

    // Attaque
    const tg = c.target;
    if (tg) {
      if (!alive(tg)) c.target = null;
      else {
        const d = U.dist(c, tg);
        if (d <= c.st.range + tg.r) {
          if (c.atkCd <= 0) shoot(c, tg);
          return;
        }
        moveToward(c, tg.x, tg.y, c.st.speed, dt);
        return;
      }
    }
    if (c.moveTo) {
      if (moveToward(c, c.moveTo.x, c.moveTo.y, c.st.speed, dt)) c.moveTo = null;
    }
  }

  // immobile 12 s de son côté de la carte, 7 s chez l'adversaire, 10 s en zone neutre
  function campDuration(c, camp) {
    const base = camp.side === c.team ? CFG.campChannelOwn : camp.side === 'neutre' ? CFG.campChannel : CFG.campChannelFoe;
    // chaque meeting déjà organisé par ce camp dure plus longtemps (mais rapporte plus)
    return camp.type === 'meeting' ? base + CFG.meetingExtra * camp.h[c.team] : base;
  }
  function campReward(team, camp) {
    const h = camp.h[team];
    return camp.type === 'mairie' ? Math.round(12 * (1 + 0.35 * h)) : Math.round(100 + 70 * h);
  }

  function alive(t) { return t.kind === 'cand' ? !t.dead : !t.converted && S.mil.includes(t); }
  function inRange(c, t) { return U.dist(c, t) <= c.st.range + t.r; }
  function shoot(c, tg) {
    S.proj.push({ kind: 'atk', src: c, team: c.team, x: c.x, y: c.y, target: tg, speed: 1100, dmg: c.st.ad, word: U.pick(QUIPS) });
    c.atkCd = 1 / c.st.as;
    c.lastAtkAt = S.t; c.face = Math.atan2(tg.y - c.y, tg.x - c.x); c.lastShot = tg;
  }
  // Joueur : les attaques partent toutes seules, même en se déplaçant.
  // Priorité : cible verrouillée (clic / Tab), puis militant adverse, puis candidat adverse à portée.
  function playerCombat(c, dt) {
    if (c.target && !alive(c.target)) { c.target = null; c.autoTarget = false; }
    if (c.atkCd <= 0) {
      let tg = c.target && inRange(c, c.target) ? c.target : null;
      if (!tg) tg = nearestFoe(c, S.mil, c.st.range);
      if (!tg) tg = nearestFoe(c, S.cands, c.st.range);
      if (tg) shoot(c, tg);
    }
    if (c.moveTo) { if (moveToward(c, c.moveTo.x, c.moveTo.y, c.st.speed, dt)) c.moveTo = null; }
    else if (c.target && !c.autoTarget && !inRange(c, c.target)) moveToward(c, c.target.x, c.target.y, c.st.speed, dt);
  }
  function nearestFoe(c, list, range) {
    let best = null, bd = Infinity;
    for (const e of list) {
      if (e.team === c.team || !alive(e)) continue;
      const d = U.dist(c, e) - e.r;
      if (d <= range && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function harvest(c, camp) {
    camp.busy = null; c.busyCamp = null;
    const team = c.team;
    const h = camp.h[team];
    if (camp.type === 'mairie') {
      // plus le camp a déjà été vidé par ce camp, plus la mairie rapporte de parrainages
      const p = campReward(team, camp);
      gain(c, p / 6); S.teams[team].parrainages += p;
      float(camp.x, camp.y - 60, `+${p} parrainages`, '#9be28f', true);
      camp.availableAt = S.t + CFG.mairieRespawn;
    } else {
      const d = campReward(team, camp);
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
            afflict(p.src, t, p.ab);
            if (!p.pierce) { done = true; break; }
          }
        }
        if (!done) keep.push(p);
      }
    }
    S.proj = keep;
  }

  function updateFx(dt) {
    const keep = [];
    for (const f of S.fx) {
      if (f.type === 'blast') {
        if (!f.done && S.t >= f.at) {
          f.done = true;
          aoe(f.src, f.x, f.y, f.radius, f.dmg, f.ab);
          f.until = S.t + 0.4;
        }
        if (!f.done || S.t < f.until) keep.push(f);
      } else {
        if (f.type === 'zone') aoe(f.src, f.x, f.y, f.radius, f.dps * dt, {});
        if (S.t < f.until) keep.push(f);
      }
    }
    S.fx = keep;
  }

  // ── Commandes des joueurs humains (solo comme en ligne) ──
  // Déplacement au clavier : direction maintenue, convertie en destination proche à chaque pas.
  function steer(c) {
    const n = c.kbDir;
    if (!n) return;
    if (c.dead || c.dash || c.stunUntil > S.t || S.over) return;
    c.moveTo = { x: c.x + n.x * 90, y: c.y + n.y * 90 };
    c.face = Math.atan2(n.y, n.x);
    if (c.target && !c.autoTarget) c.target = null; // on garde une cible verrouillée par Tab
    c.campTarget = null;
  }
  function nearestEnemy(list, c, maxD) {
    let best = null, bd = maxD;
    for (const e of list) { if (e.team === c.team || !alive(e)) continue; const d = U.dist(c, e); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function enemyAt(c, w) {
    let best = null, bd = Infinity;
    for (const e of S.cands) if (e.team !== c.team && !e.dead) { const d = U.dist(e, w); if (d < e.r + 26 && d < bd) { bd = d; best = e; } }
    if (best) return best;
    for (const m of S.mil) if (m.team !== c.team && !m.converted) { const d = U.dist(m, w); if (d < m.r + 22 && d < bd) { bd = d; best = m; } }
    return best;
  }
  const SELF_CAST = ['nova', 'shield', 'haste', 'selfheal', 'regen', 'globalheal'];
  // visée automatique : cible verrouillée, sinon candidat adverse le plus proche, sinon militant
  function castAuto(c, k, dir) {
    const ab = c.def.abilities[k];
    if (!ab) return null;
    if (SELF_CAST.includes(ab.type)) return tryCast(c, k, c.x, c.y);
    if (ab.type === 'heal') {
      let hurt = c, low = c.hp / c.st.maxHp;
      for (const a of S.cands) if (a.team === c.team && !a.dead && U.dist(a, c) < ab.range && a.hp / a.st.maxHp < low) { low = a.hp / a.st.maxHp; hurt = a; }
      return tryCast(c, k, hurt.x, hurt.y);
    }
    const reach = Math.min(ab.range || 600, 1600) + 150;
    const locked = c.target && alive(c.target) && U.dist(c, c.target) < reach ? c.target : null;
    const t = locked || nearestEnemy(S.cands, c, reach) || nearestEnemy(S.mil, c, reach);
    if (ab.type === 'dash') {
      if (dir) return tryCast(c, k, c.x + dir.x * ab.range, c.y + dir.y * ab.range);
      if (t) return tryCast(c, k, t.x, t.y);
      const f = c.face || 0;
      return tryCast(c, k, c.x + Math.cos(f) * ab.range, c.y + Math.sin(f) * ab.range);
    }
    if (!t) return unlocked(c, k) ? 'Aucune cible à portée' : tryCast(c, k, c.x, c.y);
    let tx = t.x, ty = t.y;
    if (ab.type === 'skillshot' && t.kind === 'cand' && t.moveTo) {
      const n = U.norm(t.moveTo.x - t.x, t.moveTo.y - t.y), lead = (U.dist(c, t) / ab.speed) * t.st.speed * 0.7;
      tx += n.x * lead; ty += n.y * lead;
    }
    return tryCast(c, k, tx, ty);
  }
  function tryCast(c, k, x, y) {
    if (cast(c, k, x, y)) return null;
    const ab = c.def.abilities[k];
    if (!unlocked(c, k)) return `${ab.name} se débloque à ${CFG.unlock[k]} % dans les sondages (vous : ${c.I.toFixed(1)} %)`;
    if (c.cd[k] > 0) return `${ab.name} : encore ${c.cd[k].toFixed(1)} s`;
    return null;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  // msg : intention envoyée par le joueur ; renvoie un message à afficher (ou null)
  function input(c, msg) {
    if (!S || !c || !msg || S.over) return null;
    switch (msg.t) {
      case 'dir': {
        const dx = U.clamp(num(msg.x), -1, 1), dy = U.clamp(num(msg.y), -1, 1);
        if (dx || dy) c.kbDir = U.norm(dx, dy);
        else if (c.kbDir) { c.kbDir = null; c.moveTo = null; }
        return null;
      }
      case 'goto': {
        if (c.dead || c.dash || c.stunUntil > S.t) return null;
        const w = { x: U.clamp(num(msg.x), -MAP.R, MAP.R), y: U.clamp(num(msg.y), -MAP.R, MAP.R) };
        const tgt = enemyAt(c, w);
        if (tgt) { c.target = tgt; c.autoTarget = false; c.moveTo = null; c.campTarget = null; return null; }
        for (const camp of S.camps) {
          if (U.dist(camp, w) < camp.r + 20) {
            if (!campAvailable(camp)) return 'Ce camp n’est pas disponible pour l’instant';
            c.campTarget = camp; c.target = null; c.moveTo = null; return null;
          }
        }
        c.moveTo = w; c.target = null; c.campTarget = null;
        return null;
      }
      case 'cast': {
        const k = msg.k;
        if (!['Q', 'W', 'E', 'R'].includes(k)) return null;
        if (msg.aim) return tryCast(c, k, num(msg.x), num(msg.y));
        const dir = msg.dx || msg.dy ? U.norm(num(msg.dx), num(msg.dy)) : c.kbDir;
        return castAuto(c, k, dir);
      }
      case 'camp': {
        if (c.dead) return null;
        let best = null, bd = 420;
        for (const camp of S.camps) { const d = U.dist(camp, c); if (d < bd) { bd = d; best = camp; } }
        if (!best) return 'Aucune mairie ni aucun meeting à proximité';
        if (!campAvailable(best)) return `${best.name} : pas disponible pour l’instant`;
        c.campTarget = best; c.target = null; c.moveTo = null;
        return null;
      }
      case 'lock': {
        if (c.dead) return null;
        const t = nearestEnemy(S.cands, c, 1000);
        if (!t) { c.target = null; return 'Aucun candidat adverse à proximité'; }
        c.target = t; c.autoTarget = true; // prioritaire pour les attaques et les sorts, sans le poursuivre
        return `Cible : ${t.def.name}`;
      }
      case 'unlock': c.target = null; return 'Cible libérée';
      case 'stop': c.moveTo = null; c.target = null; c.campTarget = null; return null;
      case 'recall': recall(c); return null;
      case 'buy': {
        const it = ITEM_BY_ID[msg.id];
        if (!it) return null;
        const nx = itemNext(c, it.id);
        return buy(c, it.id) || `${nx.name} (niv. ${nx.lvl}) : acheté`;
      }
    }
    return null;
  }

  return {
    newGame, update, input, castAuto, cast, buy, recall, share, power, stats, canAct, campAvailable, inOwnQG, laneOwnedBy, station,
    foeBot, unlocked, undecided, campDuration, campReward, alive, itemNext, elyseeFull, buildRoster,
    get S() { return S; },
  };
})();
