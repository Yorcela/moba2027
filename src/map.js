'use strict';
// ─── Carte : un cercle traversé par 3 avenues (6 quartiers) + un boulevard circulaire ───
// Repère : centre (0,0), y vers le bas. Angle "mathématique" en degrés (0° = est, 90° = nord).
const MAP = (() => {
  const R = 1500;      // rayon de la ville
  const RING = 1320;   // rayon du boulevard circulaire
  const D2R = Math.PI / 180;
  const P = (deg, r) => ({ x: r * Math.cos(deg * D2R), y: -r * Math.sin(deg * D2R) });

  // Polyligne avec abscisse curviligne s (0 = QG gauche, len = QG droite)
  function poly(points) {
    const segs = [];
    let len = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({ a, b, l, s0: len });
      len += l;
    }
    return {
      points, segs, len,
      at(s) {
        s = U.clamp(s, 0, len);
        for (const sg of segs) {
          if (s <= sg.s0 + sg.l) {
            const t = (s - sg.s0) / sg.l;
            return { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
          }
        }
        const p = points[points.length - 1];
        return { x: p.x, y: p.y };
      },
      project(p) {
        let best = Infinity, bs = 0;
        for (const sg of segs) {
          const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
          let t = ((p.x - sg.a.x) * dx + (p.y - sg.a.y) * dy) / (sg.l * sg.l);
          t = U.clamp(t, 0, 1);
          const x = sg.a.x + dx * t, y = sg.a.y + dy * t;
          const d = (x - p.x) ** 2 + (y - p.y) ** 2;
          if (d < best) { best = d; bs = sg.s0 + sg.l * t; }
        }
        return bs;
      },
    };
  }
  function arc(a0, a1, step) {
    const pts = [];
    const n = Math.ceil(Math.abs(a1 - a0) / step);
    for (let i = 0; i <= n; i++) pts.push(P(a0 + ((a1 - a0) * i) / n, RING));
    return pts;
  }

  const QG = { gauche: { x: -RING, y: 0 }, droite: { x: RING, y: 0 } };

  // Les 3 voies des militants (comme top / mid / bot)
  const lanes = {
    top: poly(arc(180, 0, 4)),                                       // boulevard nord → Assemblée nationale
    mid: poly([{ x: -RING, y: 0 }, { x: 0, y: 0 }, { x: RING, y: 0 }]), // avenue centrale → Élysée
    bot: poly(arc(180, 360, 4)),                                     // boulevard sud → Sénat
  };

  const objectives = {
    top: { id: 'an', lane: 'top', name: 'Assemblée nationale', short: 'Assemblée', ...P(90, RING), r: 135 },
    mid: { id: 'elysee', lane: 'mid', name: 'Palais de l’Élysée', short: 'Élysée', x: 0, y: 0, r: 170 },
    bot: { id: 'senat', lane: 'bot', name: 'Sénat', short: 'Sénat', ...P(270, RING), r: 135 },
  };

  // 3 bureaux entre chaque QG et l'Élysée, 2 entre chaque QG et l'AN / le Sénat
  const bureauDefs = [
    ['mid', 'gauche', { x: -1060, y: 0 }], ['mid', 'gauche', { x: -790, y: 0 }], ['mid', 'gauche', { x: -520, y: 0 }],
    ['mid', 'droite', { x: 1060, y: 0 }], ['mid', 'droite', { x: 790, y: 0 }], ['mid', 'droite', { x: 520, y: 0 }],
    ['top', 'gauche', P(152, RING)], ['top', 'gauche', P(122, RING)],
    ['top', 'droite', P(28, RING)], ['top', 'droite', P(58, RING)],
    ['bot', 'gauche', P(208, RING)], ['bot', 'gauche', P(238, RING)],
    ['bot', 'droite', P(332, RING)], ['bot', 'droite', P(302, RING)],
  ];

  // Jungle : une mairie (parrainages) et un meeting (dons) par quartier
  const campDefs = [
    ['mairie', P(90, 880), 'neutre', 'Mairie du 7e'], ['meeting', P(90, 560), 'neutre', 'Meeting du Palais-Bourbon'],
    ['mairie', P(270, 880), 'neutre', 'Mairie du 6e'], ['meeting', P(270, 560), 'neutre', 'Meeting du Luxembourg'],
    ['mairie', P(140, 880), 'gauche', 'Mairie de Belleville'], ['meeting', P(163, 620), 'gauche', 'Meeting de la Bastille'],
    ['mairie', P(220, 880), 'gauche', 'Mairie de Ménilmontant'], ['meeting', P(197, 620), 'gauche', 'Meeting de la Nation'],
    ['mairie', P(40, 880), 'droite', 'Mairie de Passy'], ['meeting', P(17, 620), 'droite', 'Meeting du Trocadéro'],
    ['mairie', P(320, 880), 'droite', 'Mairie d’Auteuil'], ['meeting', P(343, 620), 'droite', 'Meeting de la Concorde'],
  ];

  // Les 6 quartiers découpés par les 3 avenues (angles en degrés)
  const sectors = [
    { a0: 0, a1: 60, side: 'droite', name: 'Passy' },
    { a0: 60, a1: 120, side: 'neutre', name: 'Palais-Bourbon' },
    { a0: 120, a1: 180, side: 'gauche', name: 'Belleville' },
    { a0: 180, a1: 240, side: 'gauche', name: 'Ménilmontant' },
    { a0: 240, a1: 300, side: 'neutre', name: 'Luxembourg' },
    { a0: 300, a1: 360, side: 'droite', name: 'Auteuil' },
  ];
  const avenues = [
    { deg: 0, name: 'Avenue de la Liberté', width: 120 },
    { deg: 60, name: 'Avenue de l’Égalité', width: 80 },
    { deg: 120, name: 'Avenue de la Fraternité', width: 80 },
  ];

  return { R, RING, P, QG, lanes, objectives, bureauDefs, campDefs, sectors, avenues, D2R };
})();
