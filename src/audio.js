'use strict';
// ─── Sons : effets synthétisés (Web Audio), sons et musiques en MP3, phrases cultes en synthèse vocale ───
// Le navigateur n'autorise le son qu'après une action du joueur : le contexte audio
// démarre au premier clic ou à la première touche.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, noiseBuf = null;
  const cfg = { musicVol: 0.45, sfxVol: 0.75, musicMute: false, sfxMute: false, track: 'defaut' };
  let musicOn = false;
  const last = {}; // limite de fréquence par effet

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.ratio.value = 4;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
    return true;
  }
  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    sfxBus.gain.setTargetAtTime(cfg.sfxMute ? 0 : cfg.sfxVol, t, 0.05);
  }
  function set(o) { Object.assign(cfg, o); apply(); applyMusic(); }

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
    // fin de meeting : foule qui acclame (enregistrement)
    crowd(vol = 1) {
      if (!ok('crowd', 1)) return;
      sample('crowd', vol);
    },
    // fin de collecte de parrainages : griffonnages puis carillon
    signatures(vol = 1) {
      if (!ok('signatures', 0.8)) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) noise(sfxBus, t + i * 0.09, 0.06, 'bandpass', 3200 + i * 300, 3, 0.12 * vol);
      [76, 81, 88].forEach((n, i) => tone(sfxBus, 'sine', hz(n), 0, t + 0.38 + i * 0.1, 0.005, 0.9, 0.14 * vol));
    },
    // fin de partie : son de victoire (enregistrement) puis slogan de campagne du président élu,
    // ou thème de défaite synthétisé
    end(won, quote) {
      if (!ctx || cfg.sfxMute) return;
      if (won) {
        const a = sample('victory', 1);
        let said = false;
        // extrait audio propre au candidat s'il existe, sinon slogan en synthèse vocale
        const say = () => { if (!said) { said = true; if (quote && quote.audio) voice(quote.audio); else speak(quote); } };
        if (a) { a.addEventListener('ended', say); a.addEventListener('error', say); }
        setTimeout(say, 6000); // au cas où « ended » n'arrive pas
        return;
      }
      const t = ctx.currentTime + 0.05;
      const seq = [[67, 0, 0.3], [65, 0.32, 0.3], [63, 0.64, 0.3], [60, 0.96, 1.2]];
      for (const [n, at, d] of seq) {
        tone(sfxBus, 'triangle', hz(n), 0, t + at, 0.02, d, 0.12, 2200);
        tone(sfxBus, 'sawtooth', hz(n - 12), 0, t + at, 0.02, d, 0.07, 1000);
      }
      for (const n of [48, 51, 55]) tone(sfxBus, 'sawtooth', hz(n), 0, t + 0.96, 0.05, 1.8, 0.05, 1500);
      tone(sfxBus, 'sine', 110, 40, t + 0.96, 0.005, 0.6, 0.5);
    },
  };

  // ── sons enregistrés (MP3) ──
  const SAMPLES = { crowd: 'assets/sfx/crowd.mp3', victory: 'assets/sfx/victory.mp3' };
  const preload = {};
  function sample(name, vol) {
    if (cfg.sfxMute) return null;
    if (!preload[name]) { preload[name] = new Audio(SAMPLES[name]); preload[name].preload = 'auto'; }
    const a = preload[name].cloneNode();
    a.volume = Math.max(0, Math.min(1, cfg.sfxVol * vol));
    a.play().catch(() => {});
    return a;
  }
  // slogan lu par la voix française du navigateur (synthèse vocale)
  function speak(q) {
    if (!q || cfg.sfxMute || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(q.say || q.text);
    u.lang = 'fr-FR';
    const v = speechSynthesis.getVoices().find((x) => /^fr(-|_)FR/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^fr/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = q.rate || 1; u.pitch = q.pitch || 1; u.volume = Math.min(1, cfg.sfxVol * 1.2);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  if (window.speechSynthesis) speechSynthesis.getVoices(); // charge la liste des voix

  // ── musique : fichiers MP3 en boucle (version « défaut » ou « patriote ») ──
  const TRACKS = { defaut: 'assets/music/soundtrack.mp3', patriote: 'assets/music/la-marseillaise.mp3' };
  let el = null;
  // extrait de victoire d'un candidat : la musique s'efface le temps qu'il passe
  let voiceEl = null, duck = false;
  function voice(src) {
    stopVoice();
    if (cfg.sfxMute) return;
    voiceEl = new Audio(src);
    voiceEl.volume = Math.min(1, cfg.sfxVol * 1.1);
    duck = true; applyMusic();
    const done = () => { if (voiceEl && voiceEl.src.endsWith(src)) { voiceEl = null; duck = false; applyMusic(); } };
    voiceEl.addEventListener('ended', done); voiceEl.addEventListener('error', done);
    voiceEl.play().catch(done);
  }
  function stopVoice() {
    if (voiceEl) { voiceEl.pause(); voiceEl = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (duck) { duck = false; applyMusic(); }
  }
  function applyMusic() {
    if (!el) { el = new Audio(); el.loop = true; el.preload = 'none'; }
    el.volume = Math.min(1, cfg.musicVol * 0.7) * (duck ? 0.15 : 1);
    if (!musicOn || cfg.musicMute || !ctx) { el.pause(); return; }
    const track = TRACKS[cfg.track] ? cfg.track : 'defaut';
    if (el.dataset.track !== track) { el.dataset.track = track; el.src = TRACKS[track]; }
    if (el.paused) el.play().catch(() => { /* lecture refusée : réessayée au prochain geste */ });
  }
  function music(on) { musicOn = on; applyMusic(); }

  // démarrage au premier geste du joueur
  const unlock = () => {
    if (!ensure()) return;
    applyMusic();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  return { set, cfg, music, sfx, speak, stopVoice, get ready() { return !!ctx; }, get musicState() { return el && { paused: el.paused, track: el.dataset.track, time: el.currentTime }; } };
})();
