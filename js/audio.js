'use strict';
// Sound — synthesized with WebAudio, no samples.
(function (CT) {
  let ctx = null, sfxBus = null, musBus = null, noiseBuf = null;
  let soundOn = true, musicOn = true, music = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = soundOn ? 0.55 : 0; sfxBus.connect(comp);
    musBus = ctx.createGain(); musBus.gain.value = musicOn ? 0.32 : 0; musBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (musicOn) startMusic();
    return true;
  }
  function env(g, t, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
  function tone(type, f0, f1, t, dur, vol, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.008, vol, dur); o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, ftype, f0, f1, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, 0.01, vol, dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const ok = () => ctx && soundOn;
  const last = {};
  function gate(key, gap) { const t = ctx.currentTime; if (last[key] && t - last[key] < gap) return false; last[key] = t; return true; }
  const S = {
    grow(mine) {
      if (!ok() || (!mine && !gate('grow', 0.25))) return; const t = ctx.currentTime, v = mine ? 0.5 : 0.18;
      noise(t, 0.45, v * 0.5, 'bandpass', 380, 1500, 6);
      tone('sine', 110, 210, t, 0.4, v * 0.35);
      tone('triangle', 330, 520, t + 0.05, 0.25, v * 0.12);
    },
    cut() {
      if (!ok()) return; const t = ctx.currentTime;
      noise(t, 0.09, 0.6, 'highpass', 2500, 5000, 0.7);
      tone('square', 900, 140, t, 0.16, 0.12);
      tone('sine', 220, 60, t + 0.02, 0.22, 0.35);
    },
    wallCut() {
      if (!ok() || !gate('wall', 0.15)) return; const t = ctx.currentTime;
      noise(t, 0.12, 0.3, 'bandpass', 1200, 300, 3);
      tone('sine', 300, 90, t, 0.18, 0.2);
    },
    occupied(gain) {
      if (!ok()) return; const t = ctx.currentTime;
      if (gain) { tone('sine', 523, 523, t, 0.25, 0.3); tone('sine', 784, 784, t + 0.07, 0.3, 0.26); tone('triangle', 1046, 1046, t + 0.14, 0.35, 0.12); }
      else { tone('sawtooth', 220, 150, t, 0.35, 0.12); tone('sine', 196, 130, t + 0.05, 0.4, 0.3); }
    },
    begin() {
      if (!ok()) return; const t = ctx.currentTime;
      noise(t, 0.7, 0.35, 'lowpass', 200, 2400, 1.2);
      tone('sine', 196, 392, t + 0.1, 0.6, 0.18);
    },
    passed() {
      if (!ok()) return; const t = ctx.currentTime;
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone('triangle', f, f, t + i * 0.11, 0.5, 0.22));
      tone('sine', 262, 262, t, 1.2, 0.2);
    },
    failed() {
      if (!ok()) return; const t = ctx.currentTime;
      [440, 349, 294, 220].forEach((f, i) => tone('sawtooth', f, f * 0.97, t + i * 0.18, 0.5, 0.09));
      tone('sine', 110, 55, t + 0.6, 1.2, 0.35);
    },
    mutate() {
      if (!ok()) return; const t = ctx.currentTime;
      [392, 494, 587, 740, 988].forEach((f, i) => tone('sine', f, f * 1.01, t + i * 0.06, 0.45, 0.16));
      noise(t, 0.6, 0.15, 'bandpass', 600, 3000, 4);
    },
    place() { if (!ok()) return; const t = ctx.currentTime; tone('sine', 520, 780, t, 0.08, 0.15); },
    remove() { if (!ok()) return; const t = ctx.currentTime; tone('sine', 400, 180, t, 0.1, 0.15); },
    click() { if (!ok()) return; tone('sine', 880, 660, ctx.currentTime, 0.06, 0.12); },
  };
  // Generative ambient: slow minor pad + bubbles
  function startMusic() {
    if (!ctx || music) return;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(musBus);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 2; lp.connect(out);
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.05; lfoG.gain.value = 380; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    const chords = [[110, 130.8, 164.8], [87.3, 110, 130.8], [98, 116.5, 146.8], [82.4, 98, 123.5]];
    const voices = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.detune.value = (i % 2 ? 7 : -7);
      const g = ctx.createGain(); g.gain.value = i % 2 ? 0.05 : 0.09; o.connect(g); g.connect(lp); o.start(); voices.push(o);
    }
    let ci = 0;
    const setChord = () => {
      const c = chords[ci % chords.length], t = ctx.currentTime; ci++;
      voices.forEach((o, i) => o.frequency.setTargetAtTime(c[i % 3] * (i < 3 ? 1 : 2), t, 1.6));
    };
    setChord();
    const chordTimer = setInterval(setChord, 9000);
    const bubbleTimer = setInterval(() => {
      if (Math.random() < 0.55) {
        const t = ctx.currentTime + Math.random() * 0.4, f = [440, 523, 587, 659, 784, 880][Math.floor(Math.random() * 6)];
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
        o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        env(g, t, 0.01, 0.06, 0.9); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.1);
      }
    }, 1400);
    music = { out, voices, lfo, chordTimer, bubbleTimer };
  }
  function stopMusic() {
    if (!music) return; const m = music; music = null;
    clearInterval(m.chordTimer); clearInterval(m.bubbleTimer);
    m.out.gain.cancelScheduledValues(ctx.currentTime); m.out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => { m.voices.forEach(o => o.stop()); m.lfo.stop(); }, 2500);
  }
  CT.Audio = {
    ensure, S,
    get soundOn() { return soundOn; }, get musicOn() { return musicOn; },
    setSound(v) { soundOn = v; if (sfxBus) sfxBus.gain.value = v ? 0.55 : 0; },
    setMusic(v) { musicOn = v; if (!ctx) return; musBus.gain.value = v ? 0.32 : 0; if (v) startMusic(); else stopMusic(); },
  };
})(window.CT);
