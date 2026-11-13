'use strict';
// ─── Rendu canvas ─────────────────────────────────────────────────────────────
const Render = (() => {
  const COL = {
    void: '#0b0e13', ground: '#232a33', street: '#3b4450', streetLine: '#5d6774', ring: '#353e49',
    block: '#2b333d', blockEdge: '#323b46', text: 'rgba(255,255,255,0.55)', neutral: '#4caf72',
  };
  const SECTOR_TINT = { gauche: 'rgba(224,56,75,0.10)', droite: 'rgba(47,111,224,0.10)', neutre: 'rgba(76,175,114,0.09)' };
  const teamCol = (t) => (t ? TEAMS[t].color : '#8a94a3');

  // ── Carte statique pré-rendue (immeubles, avenues, quartiers) ──
  let staticCanvas = null;
  const SC = 0.6; // échelle de pré-rendu
  function buildStatic() {
    const size = Math.ceil(MAP.R * 2 * SC) + 4;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.setTransform(SC, 0, 0, SC, size / 2, size / 2);
    drawBase(g);
    staticCanvas = cv;
  }

  function seeded(seed) {
    let s = Math.floor(Math.abs(seed)) % 2147483646 + 1;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  function nearStreet(x, y, pad) {
    const r = Math.hypot(x, y);
    if (Math.abs(r - MAP.RING) < 60 + pad) return true;
    for (const av of MAP.avenues) {
      const a = av.deg * MAP.D2R;
      const d = Math.abs(x * Math.sin(a) + y * Math.cos(a)); // distance à l'avenue (y vers le bas)
      if (d < av.width / 2 + pad) return true;
    }
    return false;
  }

  let blocksCache = null;
  function blockList() {
    if (blocksCache) return blocksCache;
    const rnd = seeded(2027);
    const avoid = [...MAP.campDefs.map((c) => c[1]), MAP.objectives.mid, MAP.QG.gauche, MAP.QG.droite, MAP.objectives.top, MAP.objectives.bot];
    const out = [];
    for (let x = -MAP.R; x < MAP.R; x += 74) {
      for (let y = -MAP.R; y < MAP.R; y += 74) {
        const cx = x + 37, cy = y + 37;
        if (Math.hypot(cx, cy) > MAP.R - 50) continue;
        if (nearStreet(cx, cy, 40)) continue;
        if (avoid.some((p) => Math.hypot(p.x - cx, p.y - cy) < 150)) continue;
        if (Math.hypot(cx, cy) < 280) continue;
        const w = 40 + rnd() * 24, h = 40 + rnd() * 24;
        out.push({ x: cx, y: cy, w, h, park: rnd() < 0.12, hgt: 30 + rnd() * 80 });
      }
    }
    blocksCache = out;
    return out;
  }

  // texture du sol pour la 3D (sans immeubles)
  function makeGround(scale) {
    const size = Math.ceil(MAP.R * 2 * scale) + 4;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = COL.void; g.fillRect(0, 0, size, size);
    g.setTransform(scale, 0, 0, scale, size / 2, size / 2);
    drawBase(g, false);
    return { canvas: cv, worldSize: size / scale };
  }

  function drawBase(g, blocks = true) {
    g.fillStyle = COL.ground;
    g.beginPath(); g.arc(0, 0, MAP.R, 0, Math.PI * 2); g.fill();
    for (const s of MAP.sectors) {
      g.fillStyle = SECTOR_TINT[s.side];
      g.beginPath(); g.moveTo(0, 0);
      g.arc(0, 0, MAP.R, -s.a1 * MAP.D2R, -s.a0 * MAP.D2R);
      g.closePath(); g.fill();
    }
    // immeubles (pâtés de maisons) — en 3D ils sont extrudés, ici seulement leur emprise
    for (const b of blockList()) {
      if (blocks) {
        g.fillStyle = COL.block; g.strokeStyle = COL.blockEdge; g.lineWidth = 2;
        roundRect(g, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 6); g.fill(); g.stroke();
      } else {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        roundRect(g, b.x - b.w / 2 - 4, b.y - b.h / 2 - 4, b.w + 8, b.h + 8, 6); g.fill();
      }
      if (b.park) { g.fillStyle = 'rgba(76,175,114,0.25)'; g.beginPath(); g.arc(b.x, b.y, 14, 0, Math.PI * 2); g.fill(); }
    }
    // boulevard circulaire
    g.strokeStyle = COL.ring; g.lineWidth = 120;
    g.beginPath(); g.arc(0, 0, MAP.RING, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = COL.streetLine; g.lineWidth = 3; g.setLineDash([26, 22]);
    g.beginPath(); g.arc(0, 0, MAP.RING, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    // 3 avenues (diamètres)
    g.save();
    g.beginPath(); g.arc(0, 0, MAP.R, 0, Math.PI * 2); g.clip();
    for (const av of MAP.avenues) {
      const a = MAP.P(av.deg, MAP.R), b = MAP.P(av.deg + 180, MAP.R);
      g.strokeStyle = COL.street; g.lineWidth = av.width;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = COL.streetLine; g.lineWidth = 3; g.setLineDash([26, 22]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    // place de l'Élysée (rond-point)
    g.fillStyle = '#2e3742';
    g.beginPath(); g.arc(0, 0, 250, 0, Math.PI * 2); g.fill();
    g.strokeStyle = COL.streetLine; g.lineWidth = 3; g.stroke();
    // bord de la ville
    g.strokeStyle = '#4a5462'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, MAP.R, 0, Math.PI * 2); g.stroke();
    // noms des quartiers
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.font = 'italic 700 48px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of MAP.sectors) {
      const p = MAP.P((s.a0 + s.a1) / 2, 1080);
      g.fillText(s.name, p.x, p.y);
    }
    // noms des avenues (le long de chaque diamètre)
    g.fillStyle = 'rgba(255,255,255,0.30)'; g.font = '700 20px system-ui, sans-serif';
    for (const av of MAP.avenues) {
      const p = MAP.P(av.deg, 640);
      g.save(); g.translate(p.x, p.y); g.rotate(-av.deg * MAP.D2R);
      g.fillText(av.name.toUpperCase(), 0, av.deg === 0 ? -72 : 0);
      g.restore();
    }
    g.save(); g.fillStyle = 'rgba(255,255,255,0.30)'; g.font = '700 20px system-ui, sans-serif';
    const pb = MAP.P(135, MAP.RING); g.translate(pb.x, pb.y); g.rotate(-45 * MAP.D2R);
    g.fillText('BOULEVARD CIRCULAIRE', 0, 0); g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // ── Bâtiments ──
  function drawQG(g, team) {
    const q = MAP.QG[team], T = TEAMS[team];
    g.fillStyle = T.color + '22';
    g.beginPath(); g.arc(q.x, q.y, CFG.qgRadius, 0, Math.PI * 2); g.fill();
    g.strokeStyle = T.color; g.lineWidth = 4; g.setLineDash([14, 10]); g.stroke(); g.setLineDash([]);
    g.fillStyle = T.dark; g.strokeStyle = T.color; g.lineWidth = 5;
    roundRect(g, q.x - 80, q.y - 60, 160, 120, 14); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('QG', q.x, q.y - 12);
    g.font = '600 15px system-ui, sans-serif'; g.fillText('de campagne', q.x, q.y + 18);
    g.font = '800 20px system-ui, sans-serif'; g.fillStyle = T.light;
    g.fillText(T.name.toUpperCase(), q.x, q.y - 82);
  }

  function gaugeColor(o) {
    if (o.ctrl) return TEAMS[o.ctrl].color;
    if (o.gauge > 0) return TEAMS.gauche.light;
    if (o.gauge < 0) return TEAMS.droite.light;
    return '#c9cfd8';
  }

  function drawObjective(g, o, t) {
    const col = gaugeColor(o);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.beginPath(); g.arc(o.x, o.y, o.r + 30, 0, Math.PI * 2); g.fill();
    if (o.id === 'elysee') {
      g.fillStyle = '#e9e4d6'; g.strokeStyle = col; g.lineWidth = 6;
      roundRect(g, o.x - 130, o.y - 60, 260, 92, 8); g.fill(); g.stroke();
      g.fillStyle = '#d9d2c0';
      roundRect(g, o.x - 130, o.y + 20, 60, 60, 6); g.fill();
      roundRect(g, o.x + 70, o.y + 20, 60, 60, 6); g.fill();
      g.fillStyle = '#b7ad96';
      for (let i = -3; i <= 3; i++) g.fillRect(o.x + i * 22 - 4, o.y - 46, 8, 60);
      g.fillStyle = '#6d6553'; g.beginPath(); g.moveTo(o.x - 60, o.y - 60); g.lineTo(o.x, o.y - 92); g.lineTo(o.x + 60, o.y - 60); g.closePath(); g.fill();
      flag(g, o.x, o.y - 92, t);
    } else {
      g.fillStyle = '#e4dfd2'; g.strokeStyle = col; g.lineWidth = 6;
      roundRect(g, o.x - 100, o.y - 46, 200, 92, 8); g.fill(); g.stroke();
      g.fillStyle = '#b7ad96';
      for (let i = -3; i <= 3; i++) g.fillRect(o.x + i * 26 - 4, o.y - 34, 8, 62);
      if (o.id === 'senat') { g.fillStyle = '#a79d86'; g.beginPath(); g.arc(o.x, o.y - 46, 34, Math.PI, 0); g.fill(); }
      else { g.fillStyle = '#6d6553'; g.beginPath(); g.moveTo(o.x - 70, o.y - 46); g.lineTo(o.x, o.y - 76); g.lineTo(o.x + 70, o.y - 46); g.closePath(); g.fill(); }
      flag(g, o.x + 80, o.y - 46, t);
    }
    g.fillStyle = '#fff'; g.font = '800 24px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ny = o.id === 'elysee' ? o.y + 110 : o.y + 74;
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 5; g.strokeText(o.name, o.x, ny);
    g.fillText(o.name, o.x, ny);
    if (o.gauge !== undefined) {
      const w = 220, h = 14, x = o.x - w / 2, y = ny + 20;
      g.fillStyle = '#11151b'; g.fillRect(x, y, w, h);
      const f = o.gauge / o.max;
      g.fillStyle = f > 0 ? TEAMS.gauche.color : TEAMS.droite.color;
      if (f > 0) g.fillRect(x + w / 2 - (w / 2) * f, y, (w / 2) * f, h);
      else g.fillRect(x + w / 2, y, (w / 2) * -f, h);
      g.fillStyle = '#fff'; g.fillRect(x + w / 2 - 1, y - 3, 2, h + 6);
      g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
      if (o.ctrl) { g.fillStyle = TEAMS[o.ctrl].light; g.font = '700 16px system-ui, sans-serif'; g.fillText('Majorité ' + TEAMS[o.ctrl].name.toLowerCase(), o.x, y + 32); }
    }
  }

  function flag(g, x, y, t) {
    g.fillStyle = '#555'; g.fillRect(x - 2, y - 40, 4, 40);
    const wv = Math.sin((t || 0) * 4) * 2;
    g.fillStyle = '#2f55c4'; g.fillRect(x + 2, y - 40 + wv * 0.2, 10, 18);
    g.fillStyle = '#fff'; g.fillRect(x + 12, y - 40 + wv * 0.5, 10, 18);
    g.fillStyle = '#e0384b'; g.fillRect(x + 22, y - 40 + wv, 10, 18);
  }

  function drawBureau(g, b, showRange) {
    const col = teamCol(b.owner);
    if (showRange) {
      g.strokeStyle = col + '66'; g.lineWidth = 2; g.setLineDash([8, 8]);
      g.beginPath(); g.arc(b.x, b.y, CFG.bureauRange, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = '#1a1f26'; g.strokeStyle = col; g.lineWidth = 4;
    roundRect(g, b.x - 36, b.y - 30, 72, 52, 8); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(b.x - 16, b.y - 16, 32, 26);
    g.fillStyle = col; g.fillRect(b.x - 9, b.y - 13, 18, 4);
    for (let i = 0; i < CFG.bureauMax; i++) {
      g.fillStyle = i < b.g ? col : '#444c57';
      g.fillRect(b.x - 33 + i * 11.5, b.y + 28, 9, 8);
    }
  }

  function drawCamp(g, c, t) {
    const avail = t >= c.availableAt;
    g.globalAlpha = avail ? 1 : 0.45;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (c.type === 'mairie') {
      g.fillStyle = '#d8d1bf'; g.strokeStyle = '#8fd18a'; g.lineWidth = 4;
      roundRect(g, c.x - 46, c.y - 30, 92, 60, 6); g.fill(); g.stroke();
      g.fillStyle = '#8b826d'; g.beginPath(); g.moveTo(c.x - 50, c.y - 30); g.lineTo(c.x, c.y - 56); g.lineTo(c.x + 50, c.y - 30); g.closePath(); g.fill();
      g.fillStyle = '#6b6350'; g.fillRect(c.x - 9, c.y + 4, 18, 26);
      flag(g, c.x + 28, c.y - 30, t);
      g.fillStyle = '#1b2a1b'; g.font = '800 13px system-ui, sans-serif';
      g.fillText('MAIRIE', c.x, c.y - 10);
    } else {
      g.fillStyle = '#5a3d7a'; g.strokeStyle = '#ffd34d'; g.lineWidth = 4;
      g.beginPath(); g.ellipse(c.x, c.y - 10, 54, 26, 0, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffd34d'; g.fillRect(c.x - 3, c.y - 34, 6, 22); g.beginPath(); g.arc(c.x, c.y - 36, 6, 0, Math.PI * 2); g.fill();
      const rnd = seeded(c.x * 7 + c.y * 13);
      for (let i = 0; i < 16; i++) {
        g.fillStyle = ['#e0384b', '#2f6fe0', '#f1f1f1', '#4caf72'][i % 4];
        g.beginPath(); g.arc(c.x - 46 + rnd() * 92, c.y + 6 + rnd() * 26, 5, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#fff'; g.font = '800 13px system-ui, sans-serif';
      g.fillText('MEETING', c.x, c.y - 52);
    }
    g.globalAlpha = 1;
    if (!avail) {
      g.fillStyle = '#fff'; g.font = '800 22px system-ui, sans-serif';
      g.fillText(Math.ceil(c.availableAt - t) + ' s', c.x, c.y + 50);
    } else if (c.busy) {
      g.fillStyle = '#ffd34d'; g.font = '700 15px system-ui, sans-serif';
      g.fillText('occupé', c.x, c.y + 50);
    }
  }

  // ── Unités ──
  function drawMilitant(g, m) {
    const T = TEAMS[m.team];
    if (m.converted) {
      g.globalAlpha = 0.35; g.fillStyle = '#9aa3ad';
      g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      return;
    }
    g.fillStyle = T.color; g.strokeStyle = T.dark; g.lineWidth = 3;
    if (m.ranged) { g.beginPath(); g.rect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2); g.fill(); g.stroke(); }
    else { g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.fillStyle = '#fff'; g.fillRect(m.x + 4, m.y - m.r - 6, 9, 11);
    if (m.voting) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(m.x, m.y, m.r + 5, 0, Math.PI * 2); g.stroke(); }
    if (m.hp < m.maxHp) {
      g.fillStyle = '#000'; g.fillRect(m.x - 14, m.y - m.r - 12, 28, 4);
      g.fillStyle = T.light; g.fillRect(m.x - 14, m.y - m.r - 12, 28 * (m.hp / m.maxHp), 4);
    }
  }

  function drawCand(g, c, S) {
    if (c.dead) return;
    const T = TEAMS[c.team];
    if (c.isPlayer) { g.strokeStyle = '#ffd34d'; g.lineWidth = 4; g.beginPath(); g.arc(c.x, c.y, c.r + 9, 0, Math.PI * 2); g.stroke(); }
    if (c.shield > 0 && c.shieldUntil > S.t) {
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
      g.beginPath(); g.arc(c.x, c.y, c.r + 14, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = T.dark; g.strokeStyle = T.color; g.lineWidth = 5;
    g.beginPath(); g.arc(c.x, c.y, c.r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = `800 ${c.def.initials.length > 2 ? 15 : 18}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.def.initials, c.x, c.y + 1);
    const w = 76, x = c.x - w / 2, y = c.y - c.r - 26;
    g.fillStyle = '#000'; g.fillRect(x - 2, y - 2, w + 4, 12);
    g.fillStyle = c.team === S.player.team ? '#5fd17a' : '#e5484d';
    g.fillRect(x, y, w * U.clamp(c.hp / c.st.maxHp, 0, 1), 8);
    if (c.shield > 0 && c.shieldUntil > S.t) {
      const sw = Math.min(w, (w * c.shield) / c.st.maxHp);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x + w - sw, y, sw, 8);
    }
    g.fillStyle = T.light; g.font = '800 14px system-ui, sans-serif';
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3;
    const pct = (Game.share(c) * 100).toFixed(1) + ' %';
    g.strokeText(pct, c.x, y - 11); g.fillText(pct, c.x, y - 11);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '600 13px system-ui, sans-serif';
    g.strokeText(c.def.name, c.x, c.y + c.r + 15); g.fillText(c.def.name, c.x, c.y + c.r + 15);
    if (c.stunUntil > S.t) { g.fillStyle = '#ffd34d'; g.font = '800 16px system-ui'; g.fillText('✶ ✶', c.x, c.y - c.r - 50); }
    if (c.channel) {
      const p = 1 - (c.channel.until - S.t) / c.channel.dur;
      g.strokeStyle = c.channel.type === 'recall' ? '#8fb4ff' : '#9be28f'; g.lineWidth = 5;
      g.beginPath(); g.arc(c.x, c.y, c.r + 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); g.stroke();
    }
  }

  function drawProj(g, p) {
    if (p.kind === 'atk') {
      if (p.bureau) { g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(p.x, p.y, 7, 0, Math.PI * 2); g.fill(); return; }
      if (p.small) { g.fillStyle = TEAMS[p.team].light; g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill(); return; }
      bubble(g, p.x, p.y, 10, TEAMS[p.team].light, '!');
    } else {
      g.strokeStyle = TEAMS[p.team].light + '88'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06); g.stroke();
      bubble(g, p.x, p.y, p.width * 0.6, TEAMS[p.team].color, '!!');
    }
  }
  function bubble(g, x, y, r, col, txt) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - r * 0.3, y + r * 0.8); g.lineTo(x - r * 0.9, y + r * 1.4); g.lineTo(x + r * 0.2, y + r * 0.9); g.fill();
    g.fillStyle = '#111'; g.font = `900 ${Math.round(r * 1.3)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, x, y + 1);
  }

  function drawFx(g, f, t) {
    const T = TEAMS[f.team];
    if (f.type === 'blast') {
      if (!f.done) {
        const p = U.clamp((t - f.t0) / (f.at - f.t0), 0, 1);
        g.strokeStyle = T.color; g.lineWidth = 4; g.setLineDash([12, 10]);
        g.beginPath(); g.arc(f.x, f.y, f.radius, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.fillStyle = T.color + '33'; g.beginPath(); g.arc(f.x, f.y, f.radius * p, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = T.light + '66'; g.beginPath(); g.arc(f.x, f.y, f.radius, 0, Math.PI * 2); g.fill();
      }
    } else if (f.type === 'ring') {
      const p = U.clamp((t - f.t0) / (f.until - f.t0), 0, 1);
      g.strokeStyle = (f.soft ? '#ffffff' : T.light) + Math.round((1 - p) * 200).toString(16).padStart(2, '0');
      g.lineWidth = 8; g.beginPath(); g.arc(f.x, f.y, f.radius * (0.6 + 0.4 * p), 0, Math.PI * 2); g.stroke();
    } else if (f.type === 'heal') {
      g.fillStyle = 'rgba(95,209,122,0.18)'; g.strokeStyle = 'rgba(95,209,122,0.8)'; g.lineWidth = 3;
      g.beginPath(); g.arc(f.x, f.y, f.radius, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  // ── Monde complet ──
  function drawWorld(g, S, cam, W, H, opts = {}) {
    if (!staticCanvas) buildStatic();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COL.void; g.fillRect(0, 0, W, H);
    g.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
    const sz = staticCanvas.width / SC;
    g.drawImage(staticCanvas, -sz / 2, -sz / 2, sz, sz);
    const t = S ? S.t : 0;
    drawQG(g, 'gauche'); drawQG(g, 'droite');
    const objs = S ? Object.values(S.obj) : Object.values(MAP.objectives);
    for (const o of objs) drawObjective(g, o, t);
    const camps = S ? S.camps : MAP.campDefs.map(([type, p, side, name]) => ({ type, x: p.x, y: p.y, side, name, availableAt: 0 }));
    for (const c of camps) drawCamp(g, c, t);
    if (opts.labels) {
      g.fillStyle = '#fff'; g.font = '600 15px system-ui'; g.textAlign = 'center';
      for (const c of camps) g.fillText(c.name, c.x, c.y + 50);
    }
    const bureaux = S ? S.bureaux : MAP.bureauDefs.map(([lane, home, p]) => ({ owner: home, x: p.x, y: p.y, g: CFG.bureauMax }));
    const pl = S && S.player;
    for (const b of bureaux) drawBureau(g, b, opts.labels || (pl && !pl.dead && U.dist(pl, b) < CFG.bureauRange + 250 && b.owner !== pl.team));
    if (!S) return;
    for (const f of S.fx) if (f.type === 'heal' || f.type === 'blast') drawFx(g, f, t);
    for (const m of S.mil) drawMilitant(g, m);
    for (const c of S.cands) drawCand(g, c, S);
    for (const p of S.proj) drawProj(g, p);
    for (const f of S.fx) if (f.type === 'ring') drawFx(g, f, t);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const f of S.floats) {
      const life = f.until - t;
      const dur = f.big ? 2 : 1.2;
      g.globalAlpha = U.clamp(life / 0.4, 0, 1);
      g.fillStyle = f.color; g.font = `800 ${f.big ? 22 : 14}px system-ui, sans-serif`;
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4;
      const y = f.y - (dur - life) * 30;
      g.strokeText(f.text, f.x, y); g.fillText(f.text, f.x, y);
    }
    g.globalAlpha = 1;
    if (pl && !pl.dead && opts.showRange) {
      g.strokeStyle = 'rgba(255,211,77,0.25)'; g.lineWidth = 2;
      g.beginPath(); g.arc(pl.x, pl.y, pl.st.range, 0, Math.PI * 2); g.stroke();
    }
    if (opts.aim && pl && !pl.dead) {
      const { x, y, ab } = opts.aim;
      g.strokeStyle = 'rgba(255,211,77,0.6)'; g.lineWidth = 3; g.setLineDash([10, 8]);
      if (ab.type === 'skillshot' || ab.type === 'dash') {
        const n = U.norm(x - pl.x, y - pl.y); const L = ab.range;
        g.beginPath(); g.moveTo(pl.x, pl.y); g.lineTo(pl.x + n.x * L, pl.y + n.y * L); g.stroke();
      } else if (ab.radius) {
        const self = ab.type === 'nova' || ab.type === 'haste' || ab.type === 'shield';
        g.beginPath(); g.arc(self ? pl.x : x, self ? pl.y : y, ab.radius, 0, Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);
    }
  }

  // ── Mini-carte ──
  function drawMinimap(g, S, cam, W, H, size) {
    const s = size / (MAP.R * 2 + 100);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.setTransform(s, 0, 0, s, size / 2, size / 2);
    g.fillStyle = '#1b2129'; g.beginPath(); g.arc(0, 0, MAP.R, 0, Math.PI * 2); g.fill();
    for (const sc of MAP.sectors) {
      g.fillStyle = SECTOR_TINT[sc.side]; g.beginPath(); g.moveTo(0, 0);
      g.arc(0, 0, MAP.R, -sc.a1 * MAP.D2R, -sc.a0 * MAP.D2R); g.closePath(); g.fill();
    }
    g.strokeStyle = '#3b4450'; g.lineWidth = 90;
    g.beginPath(); g.arc(0, 0, MAP.RING, 0, Math.PI * 2); g.stroke();
    g.save(); g.beginPath(); g.arc(0, 0, MAP.R, 0, Math.PI * 2); g.clip();
    for (const av of MAP.avenues) {
      const a = MAP.P(av.deg, MAP.R), b = MAP.P(av.deg + 180, MAP.R);
      g.lineWidth = av.width; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.restore();
    for (const t of ['gauche', 'droite']) { const q = MAP.QG[t]; g.fillStyle = TEAMS[t].color; g.fillRect(q.x - 90, q.y - 90, 180, 180); }
    for (const o of Object.values(S.obj)) { g.fillStyle = gaugeColor(o); g.beginPath(); g.arc(o.x, o.y, o.r, 0, Math.PI * 2); g.fill(); }
    for (const c of S.camps) { g.fillStyle = S.t >= c.availableAt ? (c.type === 'mairie' ? '#8fd18a' : '#ffd34d') : '#555'; g.beginPath(); g.arc(c.x, c.y, 50, 0, Math.PI * 2); g.fill(); }
    for (const b of S.bureaux) { g.fillStyle = TEAMS[b.owner].color; g.strokeStyle = '#fff'; g.lineWidth = 14; g.fillRect(b.x - 50, b.y - 50, 100, 100); g.strokeRect(b.x - 50, b.y - 50, 100, 100); }
    for (const m of S.mil) { if (m.converted) continue; g.fillStyle = TEAMS[m.team].light; g.fillRect(m.x - 22, m.y - 22, 44, 44); }
    for (const c of S.cands) {
      if (c.dead) continue;
      g.fillStyle = TEAMS[c.team].color; g.strokeStyle = c.isPlayer ? '#ffd34d' : '#fff'; g.lineWidth = c.isPlayer ? 40 : 20;
      g.beginPath(); g.arc(c.x, c.y, 75, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 16;
    g.strokeRect(cam.x - W / 2 / cam.z, cam.y - H / 2 / cam.z, W / cam.z, H / cam.z);
  }

  return { drawWorld, drawMinimap, buildStatic, makeGround, blockList, gaugeColor, seeded };
})();
