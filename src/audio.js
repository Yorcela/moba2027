'use strict';
// ─── Sons : effets et musique, entièrement synthétisés (Web Audio, aucun fichier) ───
// Le navigateur n'autorise le son qu'après une action du joueur : le contexte audio
// démarre au premier clic ou à la première touche.
const Sound = (() => {
  let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  const cfg = { musicVol: 0.45, sfxVol: 0.75, musicMute: false, sfxMute: false };
  let musicOn = false, sched = null, nextBeat = 0, beat = 0;
  const last = {}; // limite de fréquence par effet

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.ratio.value = 4;
    master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
    if (musicOn) startScheduler();
    return true;
  }
  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicBus.gain.setTargetAtTime(cfg.musicMute ? 0 : cfg.musicVol * 0.5, t, 0.05);
    sfxBus.gain.setTargetAtTime(cfg.sfxMute ? 0 : cfg.sfxVol, t, 0.05);
  }
  function set(o) { Object.assign(cfg, o); apply(); }

  // ── briques de synthèse ──
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(bus, type, f0, f1, t, a, d, peak, filt) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    let node = o;
    if (filt) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; o.connect(f); node = f; }
    node.connect(g); g.connect(bus);
    env(g, t, a, peak, d);
    o.start(t); o.stop(t + a + d + 0.05);
  }
  function noise(bus, t, dur, type, freq, q, peak, a) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(bus);
    env(g, t, a || 0.005, peak, dur);
    s.start(t, Math.random()); s.stop(t + (a || 0.005) + dur + 0.05);
    return g;
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12); // note MIDI → fréquence
  function ok(name, gap) {
    if (!ctx || cfg.sfxMute) return false;
    const now = ctx.currentTime;
    if (last[name] && now - last[name] < gap) return false;
    last[name] = now;
    return true;
  }

  // ── effets sonores (vol : 0..1 selon la distance) ──
  const sfx = {
    // attaque automatique : petit « pfiou » de bulle de parole
    attack(vol = 1) {
      if (!ok('attack', 0.07)) return;
      const t = ctx.currentTime;
      tone(sfxBus, 'triangle', 720 + Math.random() * 120, 260, t, 0.005, 0.09, 0.22 * vol);
      noise(sfxBus, t, 0.05, 'bandpass', 2400, 2, 0.06 * vol);
    },
    // lancement d'un sort : montée scintillante
    cast(vol = 1) {
      if (!ok('cast', 0.05)) return;
      const t = ctx.currentTime;
      tone(sfxBus, 'sawtooth', 260, 1100, t, 0.01, 0.28, 0.16 * vol, 2600);
      tone(sfxBus, 'sine', 880, 1760, t + 0.05, 0.01, 0.3, 0.12 * vol);
      noise(sfxBus, t, 0.25, 'highpass', 5000, 0.7, 0.05 * vol, 0.05);
    },
    // bureau de vote conquis : fanfare montante (pour soi) ou descendante (perdu)
    conquest(good = true, vol = 1) {
      if (!ok('conquest', 0.3)) return;
      const t = ctx.currentTime;
      const notes = good ? [60, 64, 67, 72] : [67, 63, 60, 55];
      notes.forEach((n, i) => {
        tone(sfxBus, 'square', hz(n), 0, t + i * 0.09, 0.01, i === 3 ? 0.55 : 0.12, 0.09 * vol, 1800);
        tone(sfxBus, 'sawtooth', hz(n - 12), 0, t + i * 0.09, 0.01, i === 3 ? 0.55 : 0.12, 0.06 * vol, 900);
      });
      // coup de tampon sur l'urne
      tone(sfxBus, 'sine', 140, 60, t, 0.003, 0.18, 0.4 * vol);
    },
    // fin de meeting : foule qui acclame et applaudit
    crowd(vol = 1) {
      if (!ok('crowd', 1)) return;
      const t = ctx.currentTime;
      const g = noise(sfxBus, t, 2.2, 'bandpass', 900, 0.6, 0.22 * vol, 0.35);
      g.gain.setTargetAtTime(0.0001, t + 1.6, 0.4);
      noise(sfxBus, t + 0.1, 1.8, 'bandpass', 1900, 1.2, 0.08 * vol, 0.3);
      for (let i = 0; i < 26; i++) noise(sfxBus, t + 0.15 + Math.random() * 1.9, 0.03, 'bandpass', 1500 + Math.random() * 1500, 1.5, (0.1 + Math.random() * 0.12) * vol);
      // quelques « hourra ! »
      for (let i = 0; i < 3; i++) tone(sfxBus, 'sawtooth', 300 + i * 70, 420 + i * 60, t + 0.2 + i * 0.25, 0.08, 0.35, 0.025 * vol, 1200);
    },
    // fin de collecte de parrainages : griffonnages puis carillon
    signatures(vol = 1) {
      if (!ok('signatures', 0.8)) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) noise(sfxBus, t + i * 0.09, 0.06, 'bandpass', 3200 + i * 300, 3, 0.12 * vol);
      [76, 81, 88].forEach((n, i) => tone(sfxBus, 'sine', hz(n), 0, t + 0.38 + i * 0.1, 0.005, 0.9, 0.14 * vol));
    },
    // fin de partie : fanfare de victoire ou thème de défaite
    end(won) {
      if (!ctx || cfg.sfxMute) return;
      const t = ctx.currentTime + 0.05;
      const seq = won ? [[60, 0, 0.18], [64, 0.18, 0.18], [67, 0.36, 0.18], [72, 0.54, 0.5], [67, 1.04, 0.16], [72, 1.2, 1.1]]
        : [[67, 0, 0.3], [65, 0.32, 0.3], [63, 0.64, 0.3], [60, 0.96, 1.2]];
      for (const [n, at, d] of seq) {
        tone(sfxBus, won ? 'square' : 'triangle', hz(n), 0, t + at, 0.02, d, 0.12, 2200);
        tone(sfxBus, 'sawtooth', hz(n - 12), 0, t + at, 0.02, d, 0.07, 1000);
      }
      const chord = won ? [60, 64, 67, 72] : [48, 51, 55];
      for (const n of chord) tone(sfxBus, 'sawtooth', hz(n), 0, t + (won ? 1.2 : 0.96), 0.05, 1.8, 0.05, 1500);
      tone(sfxBus, 'sine', 110, 40, t + (won ? 1.2 : 0.96), 0.005, 0.6, 0.5);
    },
  };

  // ── musique épique en boucle : la mineur, 100 BPM, 8 mesures ──
  // basse en ostinato, nappe de cordes, taikos, cuivre sur un motif héroïque une boucle sur deux
  const BPM = 100, SPB = 60 / BPM;
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]]; // Am F C G Am F G E
  const MELODY = [ // [temps dans la boucle, note, durée en temps]
    [0, 69, 1.5], [1.5, 72, 0.5], [2, 76, 2], [4, 77, 1.5], [5.5, 76, 0.5], [6, 72, 2], [8, 74, 1], [9, 72, 1], [10, 71, 2],
    [12, 74, 1.5], [13.5, 76, 0.5], [14, 79, 2], [16, 81, 3], [19, 79, 1], [20, 77, 2], [22, 76, 2], [24, 74, 1], [25, 76, 1], [26, 79, 2], [28, 80, 4],
  ];
  function scheduleBeat(b, t) {
    const bar = Math.floor(b / 4) % 8, inBar = b % 4, loopBeat = b % 32, loopN = Math.floor(b / 32);
    const chord = PROG[bar];
    // basse : croches, fondamentale puis octave
    for (let k = 0; k < 2; k++) tone(musicBus, 'sawtooth', hz(chord[0] - 24 + k * 12), 0, t + (k * SPB) / 2, 0.01, SPB * 0.45, 0.18, 500);
    // nappe de cordes au début de chaque mesure
    if (inBar === 0) {
      for (const n of chord) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
        f.type = 'lowpass'; f.frequency.value = 1300;
        o.connect(f); f.connect(g); g.connect(musicBus);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 0.5);
        g.gain.setValueAtTime(0.028, t + SPB * 3.4);
        g.gain.linearRampToValueAtTime(0.0001, t + SPB * 4);
        o.start(t); o.stop(t + SPB * 4 + 0.05);
      }
    }
    // taikos sur les temps 1 et 3 (+ le « et » du 3), caisse claire sur 2 et 4, roulement en fin de boucle
    if (inBar === 0 || inBar === 2) tone(musicBus, 'sine', 130, 45, t, 0.004, 0.45, 0.55);
    if (inBar === 2) tone(musicBus, 'sine', 120, 45, t + SPB / 2, 0.004, 0.35, 0.35);
    if (inBar === 1 || inBar === 3) noise(musicBus, t, 0.12, 'bandpass', 1800, 0.8, 0.07);
    noise(musicBus, t + SPB / 2, 0.03, 'highpass', 7000, 0.7, 0.025);
    if (bar === 7 && inBar >= 2) for (let k = 0; k < 4; k++) tone(musicBus, 'sine', 150, 60, t + (k * SPB) / 4, 0.003, 0.15, 0.3);
    if (loopN % 2 === 1) {
      for (const [at, n, dur] of MELODY) {
        if (at >= loopBeat && at < loopBeat + 1) {
          const st = t + (at - loopBeat) * SPB;
          tone(musicBus, 'square', hz(n), 0, st, 0.04, dur * SPB * 0.9, 0.05, 1600);
          tone(musicBus, 'sawtooth', hz(n - 12), 0, st, 0.04, dur * SPB * 0.9, 0.035, 1200);
        }
      }
    }
  }
  function startScheduler() {
    if (sched || !ctx) return;
    nextBeat = ctx.currentTime + 0.1;
    sched = setInterval(() => {
      // onglet en arrière-plan : on ne rattrape pas le retard
      if (nextBeat < ctx.currentTime - 0.5) nextBeat = ctx.currentTime + 0.05;
      while (nextBeat < ctx.currentTime + 0.25) { scheduleBeat(beat++, nextBeat); nextBeat += SPB; }
    }, 50);
  }
  function music(on) {
    musicOn = on;
    if (on && ctx) startScheduler();
    if (!on && sched) { clearInterval(sched); sched = null; }
  }

  // démarrage au premier geste du joueur
  const unlock = () => {
    if (!ensure()) return;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  return { set, cfg, music, sfx, get ready() { return !!ctx; } };
})();
