'use strict';
// ─── Utilitaires ────────────────────────────────────────────────────────────
const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  norm: (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; },
  rand: (a, b) => a + Math.random() * (b - a),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  fmtTime: (s) => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },
};

// ─── Camps ──────────────────────────────────────────────────────────────────
const TEAMS = {
  gauche: { name: 'Gauche', color: '#e0384b', light: '#ff8a96', dark: '#5c1520', dir: 1, enemy: 'droite' },
  droite: { name: 'Droite', color: '#2f6fe0', light: '#8fb4ff', dark: '#132a5e', dir: -1, enemy: 'gauche' },
};

// ─── Réglages (à équilibrer) ─────────────────────────────────────────────────
const CFG = {
  waveFirst: 5,          // s avant la première vague de militants
  waveEvery: 22,         // s entre deux vagues
  bureauMax: 6,          // bulletins pour conquérir un bureau de vote
  objMax: { top: 10, mid: 16, bot: 10 }, // bulletins pour contrôler AN / gagner l'Élysée / contrôler le Sénat
  secondTour: 15 * 60,   // à partir de là, chaque bulletin compte double
  campChannel: 10,       // s d'immobilisation dans un camp de jungle
  mairieRespawn: 55,
  meetingRespawn: 45,
  recallTime: 4,
  timeLimit: 25 * 60,    // scrutin forcé
  qgRadius: 190,
  passiveDons: 1.5,      // € / s
  startDons: 300,
  startI: 100,           // influence de départ (base du sondage)
  bureauRange: 360,
  milDmgBonus: 1.8,      // les polémiques des candidats convertissent plus vite les militants
  difficulty: 'facile',
};

// Difficulté : ne s'applique qu'aux candidats adverses pilotés par l'IA
const DIFFICULTY = {
  facile: { label: 'Facile', dmg: 0.65, react: 0.45, abil: 0.4 },
  normal: { label: 'Normal', dmg: 0.85, react: 0.25, abil: 0.75 },
  difficile: { label: 'Difficile', dmg: 1.0, react: 0.12, abil: 1 },
};

const LANE_BY_ROLE = { tribun: 'mid', tireur: 'bot', rempart: 'top' };
const ROLE_NAMES = { tribun: 'Tribun · dégâts de zone', tireur: 'Tireur · dégâts à distance', rempart: 'Rempart · soutien / contrôle' };
const LANE_NAMES = { top: 'Voie de l’Assemblée', mid: 'Avenue de l’Élysée', bot: 'Voie du Sénat' };

// ─── Candidats v1 (3 + 3) ────────────────────────────────────────────────────
// Kits inspirés du style public de chacun, volontairement symétriques pour l'équilibre.
const CANDIDATES = [
  {
    id: 'melenchon', name: 'Jean-Luc Mélenchon', initials: 'JLM', party: 'LFI', team: 'gauche', role: 'tribun', fem: false,
    hp: 540, ad: 34, range: 500, as: 0.75, spd: 300,
    abilities: {
      Q: { name: 'Tirade', type: 'skillshot', cd: 6, range: 950, dmg: 95, speed: 950, width: 34, desc: 'Une longue tirade en ligne droite.' },
      W: { name: 'Bain de foule', type: 'nova', cd: 10, radius: 260, dmg: 70, slow: 0.35, slowDur: 2, desc: 'Dégâts autour de soi et ralentissement.' },
      E: { name: 'Marche', type: 'dash', cd: 12, range: 380, desc: 'Se déplace rapidement vers le curseur.' },
      R: { name: 'Grand meeting', type: 'blast', cd: 60, range: 900, radius: 320, delay: 0.9, dmg: 240, desc: 'Après un court délai, frappe une grande zone.' },
    },
  },
  {
    id: 'glucksmann', name: 'Raphaël Glucksmann', initials: 'RG', party: 'Place publique', team: 'gauche', role: 'tireur', fem: false,
    hp: 560, ad: 46, range: 600, as: 0.9, spd: 305,
    abilities: {
      Q: { name: 'Tribune européenne', type: 'skillshot', cd: 7, range: 1050, dmg: 85, speed: 1100, width: 30, pierce: true, desc: 'Traverse toutes les cibles sur sa ligne.' },
      W: { name: 'Plaidoyer', type: 'shield', cd: 14, radius: 0, amount: 160, dur: 3, as: 0.4, desc: 'Bouclier et +40 % vitesse d’attaque.' },
      E: { name: 'Pas de côté', type: 'dash', cd: 9, range: 300, desc: 'Court déplacement rapide.' },
      R: { name: 'Coalition', type: 'haste', cd: 55, radius: 650, pct: 0.35, dur: 4, shield: 120, desc: 'Alliés proches : +35 % vitesse et bouclier.' },
    },
  },
  {
    id: 'tondelier', name: 'Marine Tondelier', initials: 'MT', party: 'Les Écologistes', team: 'gauche', role: 'rempart', fem: true,
    hp: 640, ad: 32, range: 460, as: 0.8, spd: 310,
    abilities: {
      Q: { name: 'Tract vert', type: 'skillshot', cd: 7, range: 900, dmg: 60, speed: 900, width: 36, slow: 0.4, slowDur: 2, desc: 'Ralentit fortement la cible touchée.' },
      W: { name: 'Coulée verte', type: 'heal', cd: 14, range: 700, radius: 230, hps: 32, dur: 4, desc: 'Zone qui soigne les alliés.' },
      E: { name: 'À vélo', type: 'haste', cd: 12, radius: 420, pct: 0.4, dur: 3, desc: 'Alliés proches : +40 % vitesse.' },
      R: { name: 'Mobilisation', type: 'shield', cd: 60, radius: 700, amount: 210, dur: 4, desc: 'Gros bouclier sur tous les alliés proches.' },
    },
  },
  {
    id: 'lepen', name: 'Marine Le Pen', initials: 'MLP', party: 'RN', team: 'droite', role: 'tribun', fem: true,
    hp: 540, ad: 34, range: 500, as: 0.75, spd: 300,
    abilities: {
      Q: { name: 'Discours', type: 'skillshot', cd: 6, range: 950, dmg: 95, speed: 950, width: 34, desc: 'Un discours en ligne droite.' },
      W: { name: 'Rassemblement', type: 'nova', cd: 10, radius: 260, dmg: 70, slow: 0.35, slowDur: 2, desc: 'Dégâts autour de soi et ralentissement.' },
      E: { name: 'Tournée', type: 'dash', cd: 12, range: 380, desc: 'Se déplace rapidement vers le curseur.' },
      R: { name: 'Meeting géant', type: 'blast', cd: 60, range: 900, radius: 320, delay: 0.9, dmg: 240, desc: 'Après un court délai, frappe une grande zone.' },
    },
  },
  {
    id: 'philippe', name: 'Édouard Philippe', initials: 'EP', party: 'Horizons', team: 'droite', role: 'tireur', fem: false,
    hp: 560, ad: 46, range: 600, as: 0.9, spd: 305,
    abilities: {
      Q: { name: 'Note technique', type: 'skillshot', cd: 7, range: 1050, dmg: 85, speed: 1100, width: 30, pierce: true, desc: 'Traverse toutes les cibles sur sa ligne.' },
      W: { name: 'Course de fond', type: 'shield', cd: 14, radius: 0, amount: 160, dur: 3, as: 0.4, desc: 'Bouclier et +40 % vitesse d’attaque.' },
      E: { name: 'Foulée', type: 'dash', cd: 9, range: 300, desc: 'Court déplacement rapide.' },
      R: { name: 'Horizon', type: 'haste', cd: 55, radius: 650, pct: 0.35, dur: 4, shield: 120, desc: 'Alliés proches : +35 % vitesse et bouclier.' },
    },
  },
  {
    id: 'retailleau', name: 'Bruno Retailleau', initials: 'BR', party: 'LR', team: 'droite', role: 'rempart', fem: false,
    hp: 660, ad: 33, range: 440, as: 0.8, spd: 305,
    abilities: {
      Q: { name: 'Rappel à l’ordre', type: 'skillshot', cd: 9, range: 850, dmg: 60, speed: 950, width: 36, stun: 1.0, desc: 'Étourdit la première cible touchée.' },
      W: { name: 'Fermeté', type: 'shield', cd: 14, radius: 600, amount: 150, dur: 3, desc: 'Bouclier sur les alliés proches.' },
      E: { name: 'Charge', type: 'dash', cd: 13, range: 360, radius: 160, dmg: 50, stun: 0.6, desc: 'Fonce et étourdit à l’arrivée.' },
      R: { name: 'Tolérance zéro', type: 'blast', cd: 60, range: 800, radius: 280, delay: 0.6, dmg: 150, stun: 1.5, desc: 'Zone qui étourdit longuement.' },
    },
  },
];
const CAND_BY_ID = Object.fromEntries(CANDIDATES.map((c) => [c.id, c]));

// ─── Matériel de campagne ────────────────────────────────────────────────────
const ITEMS = [
  { id: 'portevoix', name: 'Porte-voix', icon: '📣', cost: 300, dmg: 0.2, desc: '+20 % dégâts des polémiques' },
  { id: 'cm', name: 'Community manager', icon: '📱', cost: 350, dmg: 0.12, range: 60, desc: '+12 % dégâts, +60 portée' },
  { id: 'media', name: 'Media training', icon: '🎙️', cost: 300, hp: 0.25, desc: '+25 % crédibilité max' },
  { id: 'bus', name: 'Bus de campagne', icon: '🚌', cost: 250, spd: 0.12, desc: '+12 % vitesse de déplacement' },
  { id: 'agence', name: 'Agence de com', icon: '📰', cost: 400, as: 0.3, desc: '+30 % vitesse d’attaque' },
  { id: 'conseillers', name: 'Équipe de conseillers', icon: '🧑‍💼', cost: 400, cdr: 0.2, desc: '−20 % temps de recharge' },
  // améliorations collectives des militants (niveau max 3 par camp)
  { id: 'tracts', team: true, key: 'hp', name: 'Tracts', icon: '📄', cost: 250, desc: 'Tous vos militants : +20 % PV' },
  { id: 'banderoles', team: true, key: 'dmg', name: 'Banderoles', icon: '🚩', cost: 250, desc: 'Tous vos militants : +20 % dégâts' },
  { id: 'baskets', team: true, key: 'spd', name: 'Baskets', icon: '👟', cost: 200, desc: 'Tous vos militants : +12 % vitesse' },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const BUILD_ORDER = {
  tribun: ['portevoix', 'conseillers', 'tracts', 'cm', 'media', 'bus', 'portevoix'],
  tireur: ['agence', 'portevoix', 'banderoles', 'cm', 'bus', 'media', 'agence'],
  rempart: ['media', 'tracts', 'bus', 'conseillers', 'baskets', 'media', 'portevoix'],
};

const BUREAU_NAMES = [
  'École Jaurès', 'Gymnase Zola', 'Salle des fêtes', 'Groupe scolaire Curie', 'Mairie annexe', 'Collège Hugo',
  'École des Tilleuls', 'Maison des assos', 'Salle polyvalente', 'École du Parc',
  'Centre culturel', 'École Prévert', 'Médiathèque', 'Foyer rural',
];
