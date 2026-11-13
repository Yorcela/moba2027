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
  secondTour: 6 * 60,    // à partir de là, chaque bulletin compte double (60 % de la durée, recalculé)
  campChannel: 10,       // s immobile dans un camp de jungle neutre
  campChannelOwn: 12,    // … dans un camp de son côté de la carte
  campChannelFoe: 7,     // … dans un camp du côté adverse (plus risqué, plus rapide)
  meetingExtra: 2,       // s de plus à chaque meeting déjà organisé par le camp (et +70 € de dons)
  mairieRespawn: 55,
  meetingRespawn: 45,
  recallTime: 4,
  respawnMax: 15,        // délai de retour max (1 s par point de sondage)
  timeLimit: 10 * 60,    // durée de la partie : 5, 10 ou 15 min (choisie dans le menu)
  durations: [5, 10, 15],
  qgRadius: 190,
  passiveDons: 1.5,      // € / s
  startDons: 300,
  startI: 0,             // tout le monde part de 0 % dans les sondages
  unlock: { Q: 5, W: 10, E: 15, R: 30 }, // % de sondage pour débloquer chaque sort
  pollGain: 1.8,         // multiplicateur des gains de sondage
  hitPoll: 0.002,        // points de sondage volés par point de dégât de polémique
  koPoll: 0.15,          // part du sondage perdue lors d'un scandale
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

// Types de sorts : skillshot (projectile), nova (zone autour de soi), blast (zone à distance, différée),
// zone (zone persistante qui brûle), dash, shield (sur soi si radius 0, sinon de zone), heal (zone de soin),
// selfheal (soin immédiat sur soi), regen (soin sur soi dans la durée), globalheal (tous les alliés), haste.
// Modificateurs : slow/slowDur, stun, dot { dps, dur } (brûlure), weaken { pct, dur } (affaiblit dégâts et vitesse),
// buff { dmg, dur } (renforce le lanceur), pierce.
const CANDIDATES = [
  {
    id: 'melenchon', name: 'Jean-Luc Mélenchon', initials: 'JLM', party: 'LFI', team: 'gauche', role: 'mage', fem: false,
    hp: 520, ad: 32, range: 380, as: 0.72, spd: 300,
    abilities: {
      Q: { name: 'Tirade', type: 'skillshot', cd: 6, range: 950, dmg: 80, speed: 950, width: 34, dot: { dps: 14, dur: 3 }, desc: 'Projectile enflammé : dégâts puis brûlure pendant 3 s.' },
      W: { name: 'Bain de foule', type: 'nova', cd: 10, radius: 260, dmg: 75, slow: 0.35, slowDur: 2, desc: 'Dégâts autour de soi et ralentissement.' },
      E: { name: 'Marche', type: 'dash', cd: 12, range: 380, desc: 'Déplacement rapide.' },
      R: { name: 'Grand soir', type: 'zone', cd: 55, range: 900, radius: 300, dps: 65, dur: 4, desc: 'Embrase une grande zone : brûlure continue pendant 4 s.' },
    },
  },
  {
    id: 'glucksmann', name: 'Raphaël Glucksmann', initials: 'RG', party: 'Place publique', team: 'gauche', role: 'tireur', fem: false,
    hp: 520, ad: 48, range: 450, as: 0.9, spd: 300,
    abilities: {
      Q: { name: 'Tribune européenne', type: 'skillshot', cd: 7, range: 1050, dmg: 85, speed: 1100, width: 30, pierce: true, desc: 'Traverse toutes les cibles sur sa ligne.' },
      W: { name: 'Plaidoyer', type: 'shield', cd: 14, radius: 0, amount: 150, dur: 4, as: 0.5, desc: 'Bouclier sur soi et +50 % vitesse d’attaque.' },
      E: { name: 'Pas de côté', type: 'dash', cd: 9, range: 300, desc: 'Court déplacement rapide.' },
      R: { name: 'Sanctions', type: 'skillshot', cd: 60, range: 3200, dmg: 230, speed: 1900, width: 50, weaken: { pct: 0.3, dur: 4 }, desc: 'Projectile qui traverse la carte et affaiblit la cible (−30 % dégâts et vitesse).' },
    },
  },
  {
    id: 'tondelier', name: 'Marine Tondelier', initials: 'MT', party: 'Les Écologistes', team: 'gauche', role: 'soigneur', fem: true,
    hp: 600, ad: 30, range: 360, as: 0.8, spd: 310,
    abilities: {
      Q: { name: 'Tract vert', type: 'skillshot', cd: 7, range: 900, dmg: 65, speed: 900, width: 36, slow: 0.4, slowDur: 2, desc: 'Ralentit fortement la cible touchée.' },
      W: { name: 'Coulée verte', type: 'heal', cd: 13, range: 700, radius: 230, hps: 34, dur: 4, desc: 'Zone qui soigne les alliés pendant 4 s.' },
      E: { name: 'Haie protectrice', type: 'shield', cd: 14, radius: 550, amount: 140, dur: 4, desc: 'Bouclier sur tous les alliés proches.' },
      R: { name: 'Transition', type: 'globalheal', cd: 70, pct: 0.35, haste: 0.25, dur: 3, desc: 'Soigne tous les alliés, où qu’ils soient, de 35 % et les accélère.' },
    },
  },
  {
    id: 'lepen', name: 'Marine Le Pen', initials: 'MLP', party: 'RN', team: 'droite', role: 'colosse', fem: true,
    hp: 640, ad: 38, range: 300, as: 0.8, spd: 305,
    abilities: {
      Q: { name: 'Discours', type: 'skillshot', cd: 6, range: 900, dmg: 85, speed: 950, width: 34, desc: 'Un discours en ligne droite.' },
      W: { name: 'Rassemblement', type: 'nova', cd: 11, radius: 250, dmg: 60, weaken: { pct: 0.25, dur: 4 }, desc: 'Dégâts autour de soi et affaiblit les ennemis (−25 %).' },
      E: { name: 'Tournée', type: 'dash', cd: 12, range: 380, radius: 150, dmg: 60, slow: 0.3, slowDur: 1.5, desc: 'Fonce et frappe à l’arrivée.' },
      R: { name: 'Second souffle', type: 'regen', cd: 70, pct: 0.75, dur: 10, buff: { dmg: 0.25, dur: 10 }, desc: 'Récupère 75 % de sa crédibilité en 10 s, +25 % dégâts.' },
    },
  },
  {
    id: 'philippe', name: 'Édouard Philippe', initials: 'EP', party: 'Horizons', team: 'droite', role: 'assassin', fem: false,
    hp: 540, ad: 44, range: 320, as: 0.85, spd: 320,
    abilities: {
      Q: { name: 'Note technique', type: 'skillshot', cd: 6, range: 900, dmg: 80, speed: 1100, width: 30, slow: 0.25, slowDur: 1.5, desc: 'Projectile rapide qui ralentit.' },
      W: { name: 'Course de fond', type: 'selfheal', cd: 14, pct: 0.25, haste: 0.3, dur: 2, desc: 'Se soigne de 25 % et accélère.' },
      E: { name: 'Foulée', type: 'dash', cd: 10, range: 340, radius: 140, dmg: 90, desc: 'Fonce et frappe à l’arrivée.' },
      R: { name: 'Réforme', type: 'blast', cd: 50, range: 650, radius: 170, delay: 0.3, dmg: 240, dot: { dps: 30, dur: 4 }, desc: 'Frappe ciblée, puis brûlure pendant 4 s.' },
    },
  },
  {
    id: 'retailleau', name: 'Bruno Retailleau', initials: 'BR', party: 'LR', team: 'droite', role: 'bastion', fem: false,
    hp: 720, ad: 34, range: 290, as: 0.75, spd: 300,
    abilities: {
      Q: { name: 'Rappel à l’ordre', type: 'skillshot', cd: 9, range: 850, dmg: 65, speed: 950, width: 36, stun: 1.0, desc: 'Étourdit la première cible touchée.' },
      W: { name: 'Fermeté', type: 'shield', cd: 13, radius: 0, amount: 260, dur: 4, desc: 'Gros bouclier sur soi.' },
      E: { name: 'Charge', type: 'dash', cd: 13, range: 360, radius: 160, dmg: 50, stun: 0.6, desc: 'Fonce et étourdit à l’arrivée.' },
      R: { name: 'Ordre républicain', type: 'nova', cd: 55, radius: 330, dmg: 140, stun: 0.8, weaken: { pct: 0.35, dur: 4 }, desc: 'Étourdit et affaiblit (−35 %) tous les ennemis autour.' },
    },
  },
];
// ─── Classes (tank / DPS / soutien) et archétypes de kits inspirés des MOBA ──
const CLASS_NAMES = { tank: 'Tank', dps: 'DPS', soutien: 'Soutien' };
const CLASS_LANE = { tank: 'top', dps: 'mid', soutien: 'bot' }; // voie préférée de chaque classe
const ARCH = {
  mage: { cls: 'dps', name: 'Mage · zone et brûlures', build: 'mage',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 6, range: 950, dmg: 80, speed: 950, width: 34, dot: { dps: 14, dur: 3 }, desc: 'Projectile enflammé : dégâts puis brûlure 3 s.' },
      W: { name: n[1], type: 'nova', cd: 10, radius: 260, dmg: 75, slow: 0.35, slowDur: 2, desc: 'Dégâts autour de soi et ralentissement.' },
      E: { name: n[2], type: 'dash', cd: 12, range: 380, desc: 'Déplacement rapide.' },
      R: { name: n[3], type: 'zone', cd: 55, range: 900, radius: 300, dps: 65, dur: 4, desc: 'Embrase une grande zone pendant 4 s.' },
    }) },
  tireur: { cls: 'dps', name: 'Tireur · dégâts à distance', build: 'tireur',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 7, range: 1050, dmg: 85, speed: 1100, width: 30, pierce: true, desc: 'Traverse toutes les cibles sur sa ligne.' },
      W: { name: n[1], type: 'shield', cd: 14, radius: 0, amount: 150, dur: 4, as: 0.5, desc: 'Bouclier sur soi, +50 % vitesse d’attaque.' },
      E: { name: n[2], type: 'dash', cd: 9, range: 300, desc: 'Court déplacement rapide.' },
      R: { name: n[3], type: 'skillshot', cd: 60, range: 3200, dmg: 230, speed: 1900, width: 50, weaken: { pct: 0.3, dur: 4 }, desc: 'Traverse la carte et affaiblit la cible (−30 %).' },
    }) },
  assassin: { cls: 'dps', name: 'Assassin · mobile, élimine une cible', build: 'assassin',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 6, range: 900, dmg: 80, speed: 1100, width: 30, slow: 0.25, slowDur: 1.5, desc: 'Projectile rapide qui ralentit.' },
      W: { name: n[1], type: 'selfheal', cd: 14, pct: 0.25, haste: 0.3, dur: 2, desc: 'Se soigne de 25 % et accélère.' },
      E: { name: n[2], type: 'dash', cd: 10, range: 340, radius: 140, dmg: 90, desc: 'Fonce et frappe à l’arrivée.' },
      R: { name: n[3], type: 'blast', cd: 50, range: 650, radius: 170, delay: 0.3, dmg: 240, dot: { dps: 30, dur: 4 }, desc: 'Frappe ciblée puis brûlure 4 s.' },
    }) },
  artilleur: { cls: 'dps', name: 'Artilleur · frappe de très loin', build: 'mage',
    kit: (n) => ({
      Q: { name: n[0], type: 'blast', cd: 5, range: 1100, radius: 120, delay: 0.6, dmg: 95, desc: 'Frappe différée à très longue portée.' },
      W: { name: n[1], type: 'skillshot', cd: 10, range: 950, dmg: 60, speed: 1000, width: 40, weaken: { pct: 0.25, dur: 3 }, desc: 'Affaiblit la cible touchée (−25 %).' },
      E: { name: n[2], type: 'haste', cd: 12, radius: 0, pct: 0.45, dur: 2.5, desc: '+45 % vitesse pour se replacer.' },
      R: { name: n[3], type: 'zone', cd: 60, range: 1500, radius: 260, dps: 55, dur: 5, desc: 'Zone brûlante à 1 500 de portée pendant 5 s.' },
    }) },
  duelliste: { cls: 'dps', name: 'Duelliste · corps à corps, se soigne', build: 'combattant',
    kit: (n) => ({
      Q: { name: n[0], type: 'nova', cd: 6, radius: 220, dmg: 80, desc: 'Frappe tout autour de soi.' },
      W: { name: n[1], type: 'shield', cd: 12, radius: 0, amount: 160, dur: 3, as: 0.35, desc: 'Bouclier sur soi, +35 % vitesse d’attaque.' },
      E: { name: n[2], type: 'dash', cd: 10, range: 360, radius: 130, dmg: 60, stun: 0.5, desc: 'Fonce, frappe et étourdit brièvement.' },
      R: { name: n[3], type: 'regen', cd: 60, pct: 0.5, dur: 6, buff: { dmg: 0.4, dur: 6 }, desc: 'Récupère 50 % en 6 s, +40 % dégâts.' },
    }) },
  bastion: { cls: 'tank', name: 'Bastion · contrôle et étourdissements', build: 'tank',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 9, range: 850, dmg: 65, speed: 950, width: 36, stun: 1.0, desc: 'Étourdit la première cible touchée.' },
      W: { name: n[1], type: 'shield', cd: 13, radius: 0, amount: 260, dur: 4, desc: 'Gros bouclier sur soi.' },
      E: { name: n[2], type: 'dash', cd: 13, range: 360, radius: 160, dmg: 50, stun: 0.6, desc: 'Fonce et étourdit à l’arrivée.' },
      R: { name: n[3], type: 'nova', cd: 55, radius: 330, dmg: 140, stun: 0.8, weaken: { pct: 0.35, dur: 4 }, desc: 'Étourdit et affaiblit (−35 %) tout autour.' },
    }) },
  colosse: { cls: 'tank', name: 'Colosse · encaisse et récupère', build: 'combattant',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 6, range: 900, dmg: 85, speed: 950, width: 34, desc: 'Projectile en ligne droite.' },
      W: { name: n[1], type: 'nova', cd: 11, radius: 250, dmg: 60, weaken: { pct: 0.25, dur: 4 }, desc: 'Dégâts autour de soi, affaiblit (−25 %).' },
      E: { name: n[2], type: 'dash', cd: 12, range: 380, radius: 150, dmg: 60, slow: 0.3, slowDur: 1.5, desc: 'Fonce et frappe à l’arrivée.' },
      R: { name: n[3], type: 'regen', cd: 70, pct: 0.75, dur: 10, buff: { dmg: 0.25, dur: 10 }, desc: 'Récupère 75 % en 10 s, +25 % dégâts.' },
    }) },
  rempart: { cls: 'tank', name: 'Rempart · protège son équipe', build: 'tank',
    kit: (n) => ({
      Q: { name: n[0], type: 'nova', cd: 7, radius: 240, dmg: 60, slow: 0.4, slowDur: 2, desc: 'Ralentit tous les ennemis autour.' },
      W: { name: n[1], type: 'shield', cd: 14, radius: 550, amount: 170, dur: 4, desc: 'Bouclier sur tous les alliés proches.' },
      E: { name: n[2], type: 'dash', cd: 13, range: 360, radius: 160, dmg: 40, stun: 0.7, desc: 'Fonce et étourdit à l’arrivée.' },
      R: { name: n[3], type: 'blast', cd: 55, range: 700, radius: 340, delay: 0.5, dmg: 110, slow: 0.5, slowDur: 3, weaken: { pct: 0.3, dur: 5 }, desc: 'Grande zone qui ralentit et affaiblit (−30 %).' },
    }) },
  soigneur: { cls: 'soutien', name: 'Soigneur · soins de zone et globaux', build: 'soutien',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 7, range: 900, dmg: 65, speed: 900, width: 36, slow: 0.4, slowDur: 2, desc: 'Ralentit fortement la cible touchée.' },
      W: { name: n[1], type: 'heal', cd: 13, range: 700, radius: 230, hps: 34, dur: 4, desc: 'Zone qui soigne les alliés 4 s.' },
      E: { name: n[2], type: 'shield', cd: 14, radius: 550, amount: 140, dur: 4, desc: 'Bouclier sur les alliés proches.' },
      R: { name: n[3], type: 'globalheal', cd: 70, pct: 0.35, haste: 0.25, dur: 3, desc: 'Soigne tous les alliés de 35 %, où qu’ils soient.' },
    }) },
  protecteur: { cls: 'soutien', name: 'Protecteur · boucliers', build: 'soutien',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 9, range: 850, dmg: 55, speed: 950, width: 36, stun: 0.8, desc: 'Étourdit la première cible touchée.' },
      W: { name: n[1], type: 'shield', cd: 11, radius: 550, amount: 160, dur: 4, desc: 'Bouclier sur les alliés proches.' },
      E: { name: n[2], type: 'haste', cd: 12, radius: 450, pct: 0.35, dur: 3, desc: 'Alliés proches : +35 % vitesse.' },
      R: { name: n[3], type: 'shield', cd: 60, radius: 900, amount: 320, dur: 5, as: 0.3, desc: 'Énorme bouclier et +30 % vitesse d’attaque pour l’équipe.' },
    }) },
  enchanteur: { cls: 'soutien', name: 'Enchanteur · soigne et affaiblit', build: 'soutien',
    kit: (n) => ({
      Q: { name: n[0], type: 'skillshot', cd: 7, range: 900, dmg: 55, speed: 950, width: 38, weaken: { pct: 0.3, dur: 3 }, desc: 'Affaiblit la cible touchée (−30 %).' },
      W: { name: n[1], type: 'heal', cd: 12, range: 650, radius: 220, hps: 30, dur: 4, desc: 'Zone qui soigne les alliés 4 s.' },
      E: { name: n[2], type: 'haste', cd: 11, radius: 450, pct: 0.4, dur: 3, desc: 'Alliés proches : +40 % vitesse.' },
      R: { name: n[3], type: 'nova', cd: 55, radius: 420, dmg: 90, slow: 0.45, slowDur: 3, weaken: { pct: 0.4, dur: 4 }, desc: 'Ralentit et affaiblit (−40 %) tous les ennemis autour.' },
    }) },
};
const ROLE_NAMES = Object.fromEntries(Object.entries(ARCH).map(([k, a]) => [k, a.name]));
const LANE_NAMES = { top: 'Voie de l’Assemblée', mid: 'Avenue de l’Élysée', bot: 'Voie du Sénat' };
// statistiques de base par classe
const CLASS_STATS = {
  tank: { hp: 700, ad: 34, range: 290, as: 0.75, spd: 300 },
  dps: { hp: 530, ad: 44, range: 400, as: 0.85, spd: 305 },
  soutien: { hp: 600, ad: 30, range: 360, as: 0.8, spd: 310 },
};
const NEUTRAL_MALUS = 0.88; // les candidats neutres ou inclassables sont plus faibles

// Candidats supplémentaires (liste Poligraph des candidatures annoncées ou pressenties)
// look : cheveux (hair, style swept|messy|long|short|bald), costume, peau, lunettes, barbe… (caricature, sans photo)
const EXTRA = [
  // ── gauche ──
  ['arthaud', 'Nathalie Arthaud', 'NA', 'Lutte ouvrière', 'gauche', 'mage', ['Tract ouvrier', 'Piquet de grève', 'Manif', 'Grève générale'], { hair: 0x6b4a32, style: 'short', suit: 0x8a1f2b, fem: 1 }],
  ['batho', 'Delphine Batho', 'DB', 'Génération écologie', 'gauche', 'enchanteur', ['Alerte climat', 'Oasis', 'Pédibus', 'Décroissance'], { hair: 0x2a1d17, style: 'short', suit: 0x2f7a46, fem: 1 }],
  ['bouamrane', 'Karim Bouamrane', 'KB', 'La France humaine et forte', 'gauche', 'rempart', ['Discours de quartier', 'Bouclier social', 'Élan', 'Pacte républicain'], { hair: 0x1b1612, style: 'short', suit: 0x25304a, beard: 0x1b1612, skin: 0xc79a74 }],
  ['cazeneuve', 'Bernard Cazeneuve', 'BC', 'La Convention', 'gauche', 'bastion', ['Rappel de l’État', 'Sang-froid', 'Intervention', 'État de droit'], { hair: 0x9a9a9a, style: 'bald', suit: 0x23283a, glasses: 1, tie: 0x8a1f2b }],
  ['kazib', 'Anasse Kazib', 'AK', 'Révolution permanente', 'gauche', 'assassin', ['Coup de gueule', 'Débrayage', 'Blocage', 'Révolution'], { hair: 0x161210, style: 'short', suit: 0x3a3a3a, beard: 0x161210, skin: 0xb98a63 }],
  ['labib', 'Selma Labib', 'SL', 'NPA-Révolutionnaires', 'gauche', 'artilleur', ['Tract', 'Assemblée générale', 'Cortège', 'Convergence des luttes'], { hair: 0x1f1612, style: 'long', suit: 0x8a1f2b, fem: 1, skin: 0xd9a983 }],
  ['roussel', 'Fabien Roussel', 'FR', 'PCF', 'gauche', 'colosse', ['Coup de rouge', 'Fête de l’Huma', 'Usine', 'Les jours heureux'], { hair: 0x3a2a20, style: 'short', suit: 0x8a1f2b, tie: 0xd7263d }],
  ['ruffin', 'François Ruffin', 'FRu', 'Nous président', 'gauche', 'duelliste', ['Coup de com', 'Reportage', 'Tournée des usines', 'Merci patron !'], { hair: 0x4a3426, style: 'messy', suit: 0x3b4252, stubble: 0x4a3426 }],
  // ── droite ──
  ['attal', 'Gabriel Attal', 'GA', 'Renaissance', 'droite', 'tireur', ['Petite phrase', 'Plateau', 'Échappée', 'Majorité absolue'], { hair: 0x1f1813, style: 'short', suit: 0x1e2a5a, tie: 0x2f55c4, height: 0.97 }],
  ['becht', 'Olivier Becht', 'OB', 'Sans étiquette', 'droite', 'protecteur', ['Note de synthèse', 'Dossier', 'Navette', 'Coalition'], { hair: 0x3a2a20, style: 'short', suit: 0x2a2f3a, glasses: 1, tie: 0x3f6fd8 }],
  ['bertrand', 'Xavier Bertrand', 'XB', 'Nous France', 'droite', 'rempart', ['Proximité', 'Bouclier régional', 'Tournée', 'France du travail'], { hair: 0x8a8a8a, style: 'bald', suit: 0x23324f, glasses: 1, tie: 0x1f3f8f }],
  ['dupontaignan', 'Nicolas Dupont-Aignan', 'NDA', 'Debout la France', 'droite', 'artilleur', ['Coup de semonce', 'Référendum', 'Debout !', 'Grand débat'], { hair: 0xa8a8a8, style: 'swept', suit: 0x22314f, tie: 0xd7263d }],
  ['lisnard', 'David Lisnard', 'DL', 'Nouvelle Énergie', 'droite', 'soigneur', ['Arrêté municipal', 'Jardin public', 'Navette', 'Libertés locales'], { hair: 0x2a1f19, style: 'short', suit: 0x1f2a44, tie: 0x3f6fd8 }],
  ['philippot', 'Florian Philippot', 'FP', 'Les Patriotes', 'droite', 'assassin', ['Vidéo en direct', 'Contre-tout', 'Sortie', 'Grand soir patriote'], { hair: 0x1f1813, style: 'short', suit: 0x22283a, glasses: 1 }],
  ['platret', 'Gilles Platret', 'GP', 'LR', 'droite', 'bastion', ['Arrêté', 'Fermeté', 'Charge', 'Ordre municipal'], { hair: 0x3a2a20, style: 'short', suit: 0x2a2f3a, tie: 0x1f3f8f }],
  ['villepin', 'Dominique de Villepin', 'DdV', 'La France humaine et forte', 'droite', 'mage', ['Envolée lyrique', 'Grandeur', 'Panache', 'Discours à l’ONU'], { hair: 0xd8d8d8, style: 'swept', suit: 0x1f2333, tie: 0x3a3f8f, height: 1.1 }],
  ['zemmour', 'Éric Zemmour', 'EZ', 'Reconquête', 'droite', 'tireur', ['Chronique', 'Polémique', 'Plateau', 'Reconquête'], { hair: 0x2a221c, style: 'bald', suit: 0x22283a, tie: 0x1f3f8f, height: 0.92 }],
  // ── neutres ou inclassables (plus faibles, jouables dans les deux camps) ──
  ['asselineau', 'François Asselineau', 'FA', 'UPR', 'neutre', 'enchanteur', ['Article 50', 'Conférence', 'Diaporama', 'Conférence de 3 h'], { hair: 0x8a8a8a, style: 'short', suit: 0x2a2f3a, glasses: 1 }],
  ['branco', 'Juan Branco', 'JB', 'Sans étiquette', 'neutre', 'assassin', ['Révélation', 'Thread', 'Fuite', 'Crépuscule'], { hair: 0x2a1d17, style: 'long', suit: 0x1b1b1f, stubble: 0x2a1d17 }],
  ['cheve', 'Joël Chevé', 'JC', 'La France Adulte', 'neutre', 'rempart', ['Bon sens', 'Maturité', 'Pas de côté', 'Âge de raison'], { hair: 0xbdbdbd, style: 'short', suit: 0x3b4252 }],
  ['dubuisson', 'Emmanuel Dubuisson', 'ED', 'Sans étiquette', 'neutre', 'protecteur', ['Proposition', 'Citoyenneté', 'Covoiturage', 'Union'], { hair: 0x4a3426, style: 'short', suit: 0x30384a }],
  ['egger', 'Clara Egger', 'CE', 'Solution démocratique', 'neutre', 'enchanteur', ['RIC', 'Bulletin', 'Agora', 'Démocratie directe'], { hair: 0x7a5236, style: 'long', suit: 0x4a5a7a, fem: 1 }],
  ['markovic', 'Mira Markovic', 'MM', 'Parti animaliste', 'neutre', 'soigneur', ['Pétition', 'Refuge', 'Transhumance', 'Arche de Noé'], { hair: 0x3a2a20, style: 'long', suit: 0x6a8a3a, fem: 1 }],
  ['mikolajczak', 'Antoine Mikolajczak', 'AM', 'Équinoxe', 'neutre', 'tireur', ['Tableur', 'Expertise', 'Cap', 'Équinoxe'], { hair: 0x6b4a32, style: 'short', suit: 0x2f4f6a }],
  ['polony', 'Natacha Polony', 'NP', 'Sans étiquette', 'neutre', 'mage', ['Éditorial', 'Souveraineté', 'Chronique', 'Une de magazine'], { hair: 0xe0c27a, style: 'short', suit: 0x2a2f3a, fem: 1 }],
  ['riner', 'Teddy Riner', 'TR', 'Sans étiquette', 'neutre', 'colosse', ['Ippon', 'Kimono', 'Balayage', 'Médaille d’or'], { hair: 0x161210, style: 'bald', suit: 0xf2f2f2, skin: 0x7a5238, height: 1.25 }],
  ['verdier', 'Fabien Verdier', 'FV', 'Sans étiquette', 'neutre', 'duelliste', ['Interpellation', 'Coup de poing', 'Avancée', 'Sursaut'], { hair: 0x4a3426, style: 'messy', suit: 0x3b4252 }],
];
for (const [id, name, initials, party, team, arch, names, look] of EXTRA) {
  const A = ARCH[arch];
  CANDIDATES.push({
    id, name, initials, party, team, role: arch, fem: !!look.fem, ...CLASS_STATS[A.cls],
    abilities: A.kit(names), look,
  });
}
for (const d of CANDIDATES) {
  d.cls = ARCH[d.role].cls;
  d.lane = CLASS_LANE[d.cls];
  d.neutral = d.team === 'neutre';
  if (d.neutral) { d.hp = Math.round(d.hp * NEUTRAL_MALUS); d.ad = Math.round(d.ad * NEUTRAL_MALUS); }
}
const CAND_BY_ID = Object.fromEntries(CANDIDATES.map((c) => [c.id, c]));

// ─── Programme et matériel de campagne ────────────────────────────────────────
// Les objets personnels sont des MESURES du programme, nommées selon le camp : sociales, écologiques et
// anti-libérales à gauche ; sécuritaires, régaliennes et budgétaires à droite. Chacune s'améliore jusqu'au
// niveau 5 (plus chère, plus puissante). 6 mesures au maximum.
// Le matériel de campagne (t-shirts, casquettes, banderoles, flyers, affiches) renforce tous les militants du camp.
const ITEM_CATS = { dps: 'Polémique (DPS)', tank: 'Résistance (tank)', sorts: 'Sorts', recharge: 'Recharge', vitesse: 'Vitesse', finances: 'Finances', militants: 'Matériel de campagne' };
const COSTS = [250, 450, 800, 1300, 2000];
const mkLv = (vals, costs = COSTS) => vals.map((v, i) => ({ cost: costs[i], v }));
const pct = (v) => Math.round(v * 100);
const ITEMS = [
  { id: 'portevoix', cat: 'dps', icon: '📣', stat: 'dmg', fmt: (v) => `+${pct(v)} % dégâts`, lv: mkLv([0.12, 0.25, 0.42, 0.62, 0.85]),
    names: { gauche: ['Taxe sur les superprofits', 'Impôt sur la fortune', 'Blocage des prix', 'Nationalisation des autoroutes', 'Taxe sur les milliardaires'],
      droite: ['Peines planchers', 'Comparution immédiate', 'Perpétuité réelle', 'Tolérance zéro', 'État fort'] } },
  { id: 'agence', cat: 'dps', icon: '📰', stat: 'as', fmt: (v) => `+${pct(v)} % vitesse d’attaque`, lv: mkLv([0.15, 0.3, 0.5, 0.72, 1]),
    names: { gauche: ['Manif du jeudi', 'Grève reconductible', 'Assemblées citoyennes', 'Référendum d’initiative citoyenne', 'Sixième République'],
      droite: ['Police de proximité', 'Brigades anti-squat', 'Expulsions accélérées', 'Contrôles aux frontières', 'Service militaire obligatoire'] } },
  { id: 'cm', cat: 'dps', icon: '📱', stat: 'range', fmt: (v) => `+${v} portée, +${Math.round(v / 4)} % dégâts`, lv: mkLv([30, 60, 95, 135, 180]),
    names: { gauche: ['Médias indépendants', 'Audiovisuel public renforcé', 'Presse libérée des milliardaires', 'Service public du numérique', 'Démocratie partout'],
      droite: ['Vidéoprotection', 'Caméras-piétons', 'Fichier unique', 'Renseignement territorial', 'Drones de surveillance'] } },
  { id: 'media', cat: 'tank', icon: '🏥', stat: 'hp', fmt: (v) => `+${pct(v)} % crédibilité max`, lv: mkLv([0.15, 0.3, 0.5, 0.75, 1.05]),
    names: { gauche: ['Hôpital public', '100 % Sécu', 'Smic à 1 600 €', 'Sécurité sociale alimentaire', 'Allocation d’autonomie'],
      droite: ['Rigueur budgétaire', 'Baisse des dépenses', 'Règle d’or', 'Équilibre des comptes', 'Remboursement de la dette'] } },
  { id: 'secu', cat: 'tank', icon: '🛡️', stat: 'armor', fmt: (v) => `−${pct(v)} % dégâts subis`, lv: mkLv([0.06, 0.12, 0.18, 0.24, 0.3], [300, 550, 900, 1400, 2100]),
    names: { gauche: ['Bouclier tarifaire', 'Bouclier social', 'Gel des loyers', 'Garantie d’emploi', 'Droit opposable au logement'],
      droite: ['Gendarmerie renforcée', 'Loi de programmation militaire', 'Porte-avions', 'Dissuasion nucléaire', 'Souveraineté régalienne'] } },
  { id: 'cure', cat: 'tank', icon: '🧘', stat: 'regen', fmt: (v) => `+${(v * 100).toFixed(1)} % crédibilité / s`, lv: mkLv([0.005, 0.01, 0.016, 0.023, 0.03], [200, 400, 700, 1100, 1700]),
    names: { gauche: ['Droit à la déconnexion', 'Semaine de 32 h', 'Congé climat', 'Retraite à 60 ans', 'Revenu de base'],
      droite: ['Retour de l’autorité', 'Uniforme à l’école', 'Travailler plus', 'Fin des 35 h', 'Culture du mérite'] } },
  { id: 'plateau', cat: 'sorts', icon: '🌱', stat: 'ap', fmt: (v) => `+${pct(v)} % puissance des sorts`, lv: mkLv([0.15, 0.32, 0.55, 0.8, 1.1]),
    names: { gauche: ['Rénovation thermique', 'Fret ferroviaire', 'Sortie des énergies fossiles', 'Planification écologique', 'Règle verte'],
      droite: ['Nucléaire civil', 'Simplification administrative', 'Baisse des impôts de production', 'Choc de compétitivité', 'Réindustrialisation'] } },
  { id: 'conseillers', cat: 'recharge', icon: '⏱️', stat: 'cdr', fmt: (v) => `−${pct(v)} % temps de recharge`, lv: mkLv([0.06, 0.12, 0.18, 0.24, 0.3]),
    names: { gauche: ['Budget participatif', 'Conventions citoyennes', 'Référendum local', 'Démocratie participative', 'Assemblée constituante'],
      droite: ['Suppression des comités Théodule', 'Gouvernement resserré', 'Ordonnances', '49.3', 'Référendum'] } },
  { id: 'bus', cat: 'vitesse', icon: '🚆', stat: 'spd', fmt: (v) => `+${pct(v)} % vitesse de déplacement`, lv: mkLv([0.06, 0.1, 0.14, 0.18, 0.22], [150, 300, 550, 900, 1400]),
    names: { gauche: ['Plan vélo', 'Gratuité des transports', 'Petites lignes de train', 'RER métropolitains', 'Trains de nuit'],
      droite: ['Permis à 17 ans', 'Fin des ZFE', 'Autoroutes à 140', 'TGV partout', 'Voiture pour tous'] } },
  { id: 'dons', cat: 'finances', icon: '💶', stat: 'income', fmt: (v) => `+${v} € / s de dons`, lv: mkLv([0.6, 1.2, 2, 3, 4.2], [200, 400, 700, 1100, 1600]),
    names: { gauche: ['Cotisations militantes', 'Souscription populaire', 'Financement participatif', 'Taxe sur les transactions financières', 'Banque publique d’investissement'],
      droite: ['Dîner de levée de fonds', 'Club des donateurs', 'Réseau d’affaires', 'Mécénat d’entreprise', 'Baisse des charges'] } },
  { id: 'achats', cat: 'finances', icon: '🏷️', stat: 'discount', fmt: (v) => `−${pct(v)} % sur tous les achats`, lv: mkLv([0.04, 0.08, 0.12, 0.16, 0.2], [200, 400, 700, 1100, 1600]),
    names: { gauche: ['Coopérative d’achat', 'Commande publique', 'Économie sociale et solidaire', 'Centrale d’achat publique', 'Prix plafonnés'],
      droite: ['Chasse au gaspillage', 'Appels d’offres', 'Audit des dépenses', 'Révision des politiques publiques', 'Zéro dépense inutile'] } },
  // matériel de campagne : améliorations collectives des militants (niveau max 3 par camp, de plus en plus chères)
  { id: 'tshirts', cat: 'militants', team: true, key: 'hp', name: 'T-shirts', icon: '👕', cost: 250, desc: 'Tous vos militants : +20 % PV' },
  { id: 'casquettes', cat: 'militants', team: true, key: 'spd', name: 'Casquettes', icon: '🧢', cost: 200, desc: 'Tous vos militants : +12 % vitesse' },
  { id: 'banderoles', cat: 'militants', team: true, key: 'dmg', name: 'Banderoles', icon: '🚩', cost: 250, desc: 'Tous vos militants : +20 % dégâts' },
  { id: 'flyers', cat: 'militants', team: true, key: 'n', name: 'Flyers', icon: '📄', cost: 300, desc: '+1 militant dans chaque vague' },
  { id: 'affiches', cat: 'militants', team: true, key: 'poll', name: 'Affiches', icon: '🖼️', cost: 300, desc: 'Bulletins de vos militants : +25 % de sondage' },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
// nom d'une mesure selon le camp (niveau 1 à 5)
function itemName(it, team, lvl) { return it.team ? it.name : it.names[team === 'droite' ? 'droite' : 'gauche'][lvl - 1]; }
// un id répété = monter cet objet d'un niveau
const BUILD_ORDER = {
  mage: ['plateau', 'dons', 'conseillers', 'tshirts', 'plateau', 'media', 'plateau', 'flyers', 'bus', 'conseillers', 'plateau', 'secu', 'media', 'plateau', 'conseillers'],
  combattant: ['portevoix', 'media', 'secu', 'portevoix', 'media', 'tshirts', 'bus', 'portevoix', 'secu', 'media', 'portevoix', 'cure', 'secu', 'media'],
  tireur: ['agence', 'portevoix', 'banderoles', 'agence', 'portevoix', 'cm', 'agence', 'flyers', 'portevoix', 'bus', 'agence', 'cm', 'portevoix', 'agence'],
  assassin: ['portevoix', 'bus', 'plateau', 'portevoix', 'plateau', 'conseillers', 'portevoix', 'plateau', 'media', 'portevoix', 'plateau', 'bus', 'conseillers'],
  soutien: ['dons', 'achats', 'media', 'conseillers', 'tshirts', 'affiches', 'cure', 'casquettes', 'plateau', 'dons', 'conseillers', 'media', 'flyers', 'plateau', 'cure'],
  tank: ['media', 'secu', 'tshirts', 'media', 'secu', 'cure', 'affiches', 'conseillers', 'media', 'secu', 'banderoles', 'media', 'secu', 'cure'],
};

const BUREAU_NAMES = [
  'École Jaurès', 'Gymnase Zola', 'Salle des fêtes', 'Groupe scolaire Curie', 'Mairie annexe', 'Collège Hugo',
  'École des Tilleuls', 'Maison des assos', 'Salle polyvalente', 'École du Parc',
  'Centre culturel', 'École Prévert', 'Médiathèque', 'Foyer rural',
];

// Libellé des touches de sort (AZERTY par défaut, ajusté par l'interface)
const KEY_LABEL = { Q: 'A', W: 'Z', E: 'E', R: 'R' };

// Phylactères : ce que les candidats se lancent à la figure
const QUIPS = [
  'Honte !', 'Démission !', 'Mensonge !', 'Et alors ?', 'Scandale !', 'Ridicule !', 'Fake news !', 'Amateur !',
  'Hors-sol !', 'Bla-bla !', 'Rendez l’argent !', 'Incompétent !', 'Populiste !', 'Assumez !', 'Pff…', 'Ça suffit !',
];
