'use strict';
// ─── IA des candidats non joueurs ─────────────────────────────────────────────
const AI = (() => {
  function enemyBureauDanger(S, c, pos) {
    // position couverte par un bureau adverse sans militant allié pour encaisser
    for (const b of S.bureaux) {
      if (b.owner === c.team) continue;
      if (U.dist(b, pos) < CFG.bureauRange + 10) {
        const tank = S.mil.some((m) => m.team === c.team && !m.converted && U.dist(m, b) < CFG.bureauRange);
        if (!tank) return true;
      }
    }
    return false;
  }

  function nearestEnemyCand(S, c, maxD) {
    let best = null, bd = maxD;
    for (const e of S.cands) {
      if (e.team === c.team || e.dead) continue;
      const d = U.dist(c, e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function laneFront(S, c) {
    const L = MAP.lanes[c.lane];
    const dir = TEAMS[c.team].dir;
    let front = null;
    for (const m of S.mil) {
      if (m.team !== c.team || m.lane !== c.lane || m.converted) continue;
      const s = L.project(m);
      if (front === null || (s - front) * dir > 0) front = s;
    }
    if (front === null) {
      // pas de militants : se placer devant son bureau allié le plus avancé
      let best = dir > 0 ? 0 : L.len;
      for (const b of S.bureaux) if (b.lane === c.lane && b.owner === c.team && (b.s - best) * dir > 0) best = b.s;
      front = best + dir * 60;
    }
    const p = L.at(front - dir * 110);
    // décalage latéral stable par candidat
    const q = L.at(front - dir * 100);
    const n = U.norm(q.y - p.y, -(q.x - p.x));
    return { x: p.x + n.x * c.ai.off, y: p.y + n.y * c.ai.off };
  }

  function shop(S, c) {
    const order = BUILD_ORDER[c.def.role];
    const owned = {};
    for (const id of c.items) owned[id] = (owned[id] || 0) + 1;
    const seen = {};
    for (const id of order) {
      seen[id] = (seen[id] || 0) + 1;
      const it = ITEM_BY_ID[id];
      if (it.team) {
        if (S.teams[c.team].up[it.key] >= Math.min(3, seen[id])) continue;
      } else if ((owned[id] || 0) >= seen[id]) continue;
      if (c.dons >= it.cost) { Game.buy(c, id); return; }
      return; // on économise pour l'objet suivant
    }
  }

  function useAbilities(S, c, foe, mode) {
    const abs = c.def.abilities;
    const hpR = c.hp / c.st.maxHp;
    for (const key of ['R', 'Q', 'W', 'E']) {
      if (c.cd[key] > 0) continue;
      const ab = abs[key];
      const fd = foe ? U.dist(c, foe) : Infinity;
      const foeR = foe ? foe.hp / foe.st.maxHp : 1;
      let ok = false, tx = foe ? foe.x : c.x, ty = foe ? foe.y : c.y;
      switch (ab.type) {
        case 'skillshot':
          ok = foe && fd < ab.range * 0.85 && (key !== 'R');
          if (ok && foe.moveTo) { const n = U.norm(foe.moveTo.x - foe.x, foe.moveTo.y - foe.y); const lead = (fd / ab.speed) * foe.st.speed * 0.6; tx += n.x * lead; ty += n.y * lead; }
          break;
        case 'blast':
          ok = foe && fd < ab.range && (key !== 'R' || foeR < 0.7 || mode === 'fight');
          break;
        case 'nova':
          ok = foe && fd < ab.radius + foe.r - 10;
          break;
        case 'dash':
          if (mode === 'flee') {
            const q = MAP.QG[c.team];
            tx = q.x; ty = q.y; ok = !!foe && fd < 500;
          } else ok = foe && foeR < 0.35 && fd > c.st.range * 0.8 && fd < c.st.range + ab.range && mode === 'fight';
          break;
        case 'shield':
          if (!ab.radius) ok = foe && fd < 600;
          else ok = foe && S.cands.some((a) => a.team === c.team && !a.dead && U.dist(a, c) < ab.radius && a.hp / a.st.maxHp < 0.6);
          break;
        case 'heal': {
          const hurt = S.cands.find((a) => a.team === c.team && !a.dead && U.dist(a, c) < ab.range && a.hp / a.st.maxHp < 0.65);
          if (hurt) { ok = true; tx = hurt.x; ty = hurt.y; }
          break;
        }
        case 'haste':
          ok = (mode === 'flee' && foe && fd < 600) || (mode === 'fight' && foe && fd > c.st.range && fd < 900);
          break;
      }
      if (ok && Game.cast(c, key, tx, ty)) return true;
    }
    // nettoyage de vague : sort de zone sur un groupe de militants
    if (mode === 'farm' && hpR > 0.4) {
      for (const key of ['Q', 'W']) {
        const ab = abs[key];
        if (c.cd[key] > 0 || !ab.dmg) continue;
        const reach = ab.type === 'nova' ? ab.radius : ab.range * 0.7;
        const near = S.mil.filter((m) => m.team !== c.team && !m.converted && U.dist(m, c) < reach);
        if (near.length >= 3) {
          const t = near[0];
          if (Game.cast(c, key, t.x, t.y)) return true;
        }
      }
    }
    return false;
  }

  function think(c, dt, S) {
    c.ai.think -= dt;
    const foe = nearestEnemyCand(S, c, 900);
    const hpR = c.hp / c.st.maxHp;
    const q = MAP.QG[c.team];

    // 1) au QG : se soigner et faire ses achats
    if (Game.inOwnQG(c)) {
      shop(S, c);
      if (hpR < 0.92 && c.ai.state === 'heal') { c.moveTo = null; c.target = null; return; }
      if (c.ai.state === 'heal') c.ai.state = 'lane';
    }

    // 2) en danger : on rentre
    if (hpR < 0.28 || c.ai.state === 'heal') {
      c.ai.state = 'heal';
      c.target = null; c.campTarget = null;
      if (!foe || U.dist(c, foe) > 800) { Game.recall(c); return; }
      useAbilities(S, c, foe, 'flee');
      c.moveTo = { x: q.x, y: q.y };
      return;
    }

    if (c.ai.think > 0) return;
    c.ai.think = 0.15;

    // 3) combat contre un candidat
    if (foe) {
      const fd = U.dist(c, foe);
      const foeR = foe.hp / foe.st.maxHp;
      const allies = S.cands.filter((a) => a.team === c.team && !a.dead && U.dist(a, foe) < 900).length;
      const enemies = S.cands.filter((e) => e.team !== c.team && !e.dead && U.dist(e, c) < 900).length;
      const favourable = (hpR > foeR - 0.1 && allies >= enemies) || foeR < 0.3 || foe.channel;
      const safe = !enemyBureauDanger(S, c, foe) || foeR < 0.2;
      if (favourable && safe && fd < 800) {
        c.ai.state = 'lane'; c.campTarget = null;
        c.target = foe;
        useAbilities(S, c, foe, 'fight');
        return;
      }
      if (!favourable && fd < 520) {
        useAbilities(S, c, foe, 'flee');
        const n = U.norm(c.x - foe.x, c.y - foe.y);
        const back = U.norm(q.x - c.x, q.y - c.y);
        c.target = null;
        c.moveTo = { x: c.x + (n.x + back.x) * 200, y: c.y + (n.y + back.y) * 200 };
        return;
      }
    }

    // 4) jungle : mairies (parrainages) et meetings (dons)
    if (c.ai.state === 'jungle' && c.campTarget) return;
    if (S.t > c.ai.nextJungle && hpR > 0.6 && !foe) {
      let best = null, bd = 1500;
      for (const camp of S.camps) {
        if (camp.side !== c.team && camp.side !== 'neutre') continue;
        if (!Game.campAvailable(camp)) continue;
        const d = U.dist(c, camp);
        if (d < bd) { bd = d; best = camp; }
      }
      if (best) {
        c.ai.state = 'jungle'; c.campTarget = best; c.target = null; c.moveTo = null;
        c.ai.nextJungle = S.t + U.rand(40, 70);
        return;
      }
      c.ai.nextJungle = S.t + 10;
    }
    c.ai.state = 'lane';

    // 5) convertir les militants adverses de sa voie
    let mil = null, md = 650;
    for (const m of S.mil) {
      if (m.team === c.team || m.converted) continue;
      const d = U.dist(c, m);
      if (d >= md) continue;
      if (enemyBureauDanger(S, c, m)) continue;
      // priorité aux militants presque convertis (dernier coup)
      const score = d - (m.hp < c.st.ad * 1.2 ? 250 : 0);
      if (score < md) { md = score; mil = m; }
    }
    if (mil) {
      c.target = mil; c.moveTo = null;
      useAbilities(S, c, foe, 'farm');
      return;
    }

    // 6) se replacer derrière la ligne de front
    c.target = null;
    const p = laneFront(S, c);
    if (enemyBureauDanger(S, c, p)) {
      c.moveTo = { x: c.x + (q.x - c.x) * 0.2, y: c.y + (q.y - c.y) * 0.2 };
    } else c.moveTo = p;
  }

  return { think };
})();
