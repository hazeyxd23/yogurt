// Original soundtrack for the showcase video, synthesised from scratch (no samples,
// no licensed audio): an upbeat 120 BPM electronic track in D major (D-A-Bm-G).
//
// makeMusic(plan, file) writes a 44.1 kHz stereo WAV. `plan` (seconds) lines the
// arrangement up with the edit: { total, drop, leadFrom, leadTo, breakFrom, breakTo, hit }.

import fs from "node:fs";

const SR = 44100;
const TAU = Math.PI * 2;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

// One-pole-pair biquad (RBJ cookbook) for low/high/band-pass.
class Biquad {
  constructor(type, freq, q = 0.707) {
    this.type = type;
    this.q = q;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq);
  }
  set(freq) {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * this.q);
    let b0;
    let b1;
    let b2;
    if (this.type === "lp") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (this.type === "hp") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

let seed = 12345;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x3fffffff) - 1;
};

const saw = (phase) => 2 * (phase - Math.floor(phase + 0.5));

export function makeMusic(plan, file) {
  const N = Math.ceil(plan.total * SR);
  const drums = [new Float32Array(N), new Float32Array(N)];
  const music = [new Float32Array(N), new Float32Array(N)];
  const send = [new Float32Array(N), new Float32Array(N)]; // reverb send
  const echo = [new Float32Array(N), new Float32Array(N)]; // delay send
  const kickTimes = [];

  const beat = 0.5; // 120 BPM
  const bar = beat * 4;
  const add = (bus, i, l, r = l) => {
    if (i >= 0 && i < N) {
      bus[0][i] += l;
      bus[1][i] += r;
    }
  };
  const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

  // ---------------- instruments ----------------
  const kick = (t0, amp = 1) => {
    kickTimes.push(t0);
    let ph = 0;
    const s0 = Math.round(t0 * SR);
    for (let k = 0; k < 0.45 * SR; k += 1) {
      const t = k / SR;
      const f = 46 + 110 * Math.exp(-t * 30);
      ph += f / SR;
      let v = Math.sin(TAU * ph) * Math.exp(-t * 7.5);
      if (k < 140) v += noise() * 0.35 * (1 - k / 140);
      add(drums, s0 + k, v * amp * 0.95);
    }
  };
  const clap = (t0, amp = 1) => {
    const bp = new Biquad("bp", 1500, 0.9);
    const s0 = Math.round(t0 * SR);
    for (let k = 0; k < 0.3 * SR; k += 1) {
      const t = k / SR;
      const bursts = [0, 0.011, 0.022].reduce((acc, b) => acc + (t >= b && t < b + 0.008 ? 1 : 0), 0);
      const env = bursts ? 1 : Math.exp(-(t - 0.022) * 22);
      const v = bp.run(noise()) * env * 1.6 * amp;
      add(drums, s0 + k, v * 0.95, v);
      add(send, s0 + k, v * 0.35);
    }
  };
  const hat = (t0, amp = 1, open = false) => {
    const hp = new Biquad("hp", 7500, 0.8);
    const s0 = Math.round(t0 * SR);
    const len = (open ? 0.22 : 0.05) * SR;
    for (let k = 0; k < len; k += 1) {
      const v = hp.run(noise()) * Math.exp(-(k / SR) * (open ? 14 : 70)) * amp;
      add(drums, s0 + k, v * 0.8, v);
    }
  };
  const bass = (t0, f, dur, amp = 1) => {
    const lp = new Biquad("lp", 420, 1.1);
    const s0 = Math.round(t0 * SR);
    let p1 = 0;
    let p2 = 0;
    for (let k = 0; k < dur * SR; k += 1) {
      const t = k / SR;
      p1 += f / SR;
      p2 += (f * 1.006) / SR;
      const env = Math.min(1, t / 0.005) * (t > dur - 0.03 ? Math.max(0, (dur - t) / 0.03) : 1) * (0.75 + 0.25 * Math.exp(-t * 8));
      const v = lp.run(saw(p1) + saw(p2) * 0.6 + Math.sin(TAU * p1 * 0.5) * 0.8) * env * amp;
      add(music, s0 + k, v);
    }
  };
  const pad = (t0, notes, dur, cutoff = 1800, amp = 1) => {
    const filters = [new Biquad("lp", cutoff, 0.8), new Biquad("lp", cutoff, 0.8)];
    const s0 = Math.round(t0 * SR);
    const voices = notes.flatMap((f, n) => [-7, 0, 7].map((c, v) => ({ f: f * 2 ** (c / 1200), ph: (n * 0.31 + v * 0.17) % 1, side: v - 1 })));
    for (let k = 0; k < dur * SR; k += 1) {
      const t = k / SR;
      const env = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.4);
      let l = 0;
      let r = 0;
      for (const vo of voices) {
        vo.ph += vo.f / SR;
        const s = saw(vo.ph);
        l += s * (1 - vo.side * 0.5);
        r += s * (1 + vo.side * 0.5);
      }
      const vl = filters[0].run(l) * env * amp * 0.06;
      const vr = filters[1].run(r) * env * amp * 0.06;
      add(music, s0 + k, vl, vr);
      add(send, s0 + k, vl * 0.5, vr * 0.5);
    }
  };
  const pluck = (t0, f, p = 0, amp = 1) => {
    const lp = new Biquad("lp", 3200, 1.4);
    const s0 = Math.round(t0 * SR);
    const [gl, gr] = pan(p);
    let ph = 0;
    for (let k = 0; k < 0.28 * SR; k += 1) {
      const t = k / SR;
      if (k % 32 === 0) lp.set(500 + 3500 * Math.exp(-t * 14));
      ph += f / SR;
      const sq = (ph % 1) < 0.5 ? 1 : -1;
      const v = lp.run(sq * 0.55 + saw(ph * 1.003) * 0.45) * Math.exp(-t * 11) * amp * 0.22;
      add(music, s0 + k, v * gl, v * gr);
      add(echo, s0 + k, v * gl * 0.6, v * gr * 0.6);
    }
  };
  const lead = (t0, f, dur, amp = 1) => {
    const lp = new Biquad("lp", 2600, 0.9);
    const s0 = Math.round(t0 * SR);
    let ph = 0;
    for (let k = 0; k < dur * SR; k += 1) {
      const t = k / SR;
      const vib = t > 0.12 ? 1 + 0.004 * Math.sin(TAU * 5.5 * t) : 1;
      ph += (f * vib) / SR;
      const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
      const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.05) * (0.7 + 0.3 * Math.exp(-t * 6));
      const v = lp.run(tri * 0.7 + saw(ph) * 0.3) * env * amp * 0.17;
      add(music, s0 + k, v * 0.9, v);
      add(echo, s0 + k, v * 0.45);
      add(send, s0 + k, v * 0.3);
    }
  };
  const riser = (t0, dur) => {
    const bp = new Biquad("bp", 400, 2.5);
    const s0 = Math.round(t0 * SR);
    let ph = 0;
    for (let k = 0; k < dur * SR; k += 1) {
      const u = k / (dur * SR);
      if (k % 32 === 0) bp.set(300 + 7000 * u * u);
      ph += (180 + 900 * u * u) / SR;
      const v = (bp.run(noise()) * 0.9 + Math.sin(TAU * ph) * 0.12) * u * u * 0.5;
      add(music, s0 + k, v, v);
      add(send, s0 + k, v * 0.4);
    }
  };
  const impact = (t0, amp = 1) => {
    const hp = new Biquad("hp", 2500, 0.6);
    const s0 = Math.round(t0 * SR);
    let ph = 0;
    for (let k = 0; k < 2.2 * SR; k += 1) {
      const t = k / SR;
      ph += (38 + 40 * Math.exp(-t * 6)) / SR;
      const boom = Math.sin(TAU * ph) * Math.exp(-t * 2.2);
      const crash = hp.run(noise()) * Math.exp(-t * 2.4) * 0.35;
      add(drums, s0 + k, (boom * 0.9 + crash) * amp, (boom * 0.9 + crash * 0.8) * amp);
      add(send, s0 + k, crash * 0.6 * amp);
    }
  };

  // ---------------- arrangement ----------------
  const chords = [
    { root: midi(38), pad: [62, 66, 69].map(midi), arp: [62, 66, 69, 74] }, // D
    { root: midi(33), pad: [61, 64, 69].map(midi), arp: [61, 64, 69, 73] }, // A
    { root: midi(35), pad: [62, 66, 71].map(midi), arp: [62, 66, 71, 74] }, // Bm
    { root: midi(31), pad: [62, 67, 71].map(midi), arp: [62, 67, 71, 74] }, // G
  ];
  const hook = [
    [81, null, 78, 81, 83, 81, 78, 76],
    [76, null, 73, 76, 81, null, 76, null],
    [78, null, 74, 78, 83, 81, 78, 74],
    [79, 78, 76, 74, 71, null, 74, null],
  ];
  const inBreak = (t) => t >= plan.breakFrom && t < plan.breakTo;
  const bars = Math.ceil(plan.total / bar);

  for (let b = 0; b < bars; b += 1) {
    const t = b * bar;
    const c = chords[b % 4];
    const intro = t < plan.drop;
    const outro = t >= plan.hit;
    const brk = inBreak(t);

    // pads everywhere, darker in the intro / breakdown
    pad(t, c.pad, bar + 0.05, intro ? 700 + 1500 * (t / plan.drop) : brk ? 600 : outro ? 1200 : 2000, outro ? 0.8 : 1);

    for (let s = 0; s < 16; s += 1) {
      const ts = t + s * (beat / 4);
      if (ts >= plan.total - 0.01) break;
      const arpNote = midi(c.arp[[0, 1, 2, 3, 2, 1, 2, 3][s % 8]] + 12);
      if (!outro || ts < plan.hit + bar) pluck(ts, arpNote, s % 2 ? 0.45 : -0.45, intro ? 0.35 + 0.65 * (t / plan.drop) : brk ? 0.45 : 0.75);
    }

    if (intro || outro) continue;

    for (let q = 0; q < 4; q += 1) {
      const tb = t + q * beat;
      if (!brk || q % 2 === 0) kick(tb, brk ? 0.55 : 1);
      if (!brk && (q === 1 || q === 3)) clap(tb);
      if (!brk) {
        hat(tb + beat / 2, 0.9, q === 3 && b % 2 === 1);
        if (t >= plan.leadTo) hat(tb + beat / 4, 0.35); // busier hats in the montage
      }
    }
    if (!brk) {
      for (let e = 0; e < 8; e += 1) bass(t + e * (beat / 2), c.root * (e % 4 === 3 ? 2 : 1), beat / 2 - 0.02, e % 2 ? 0.75 : 1);
    }
    if (t >= plan.leadFrom && t < plan.leadTo) {
      hook[b % 4].forEach((m, e) => m && lead(t + e * (beat / 2), midi(m), beat / 2 - 0.03));
    }
  }
  riser(Math.max(0, plan.drop - 3), 3);
  impact(plan.drop, 0.9);
  riser(plan.breakTo - 2, 2);
  impact(plan.hit, 1);

  // ---------------- mix: echo, reverb, sidechain, master ----------------
  const delay = Math.round(beat * 0.75 * SR); // dotted eighth
  for (let ch = 0; ch < 2; ch += 1) {
    const e = echo[ch];
    for (let i = delay; i < N; i += 1) e[i] += e[i - delay] * 0.42;
    const m = music[ch];
    for (let i = 0; i < N; i += 1) m[i] += e[i] * 0.55;
  }
  const combs = [1557, 1617, 1491, 1422].map((d, i) => ({ d: d + i * 23, buf: new Float32Array(d + i * 23), idx: 0 }));
  for (let ch = 0; ch < 2; ch += 1) {
    const s = send[ch];
    for (const c of combs) {
      c.buf.fill(0);
      c.idx = 0;
    }
    const out = music[ch];
    for (let i = 0; i < N; i += 1) {
      let rv = 0;
      for (const c of combs) {
        const y = c.buf[c.idx];
        c.buf[c.idx] = s[i] + y * 0.82;
        c.idx = (c.idx + 1) % c.d;
        rv += y;
      }
      out[i] += rv * 0.09;
    }
  }

  // sidechain: duck the music under every kick
  const duck = new Float32Array(N).fill(1);
  for (const k of kickTimes) {
    const s0 = Math.round(k * SR);
    for (let j = 0; j < 0.3 * SR && s0 + j < N; j += 1) duck[s0 + j] = Math.min(duck[s0 + j], 1 - 0.6 * Math.exp(-(j / SR) / 0.09));
  }

  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  let peak = 0;
  for (let i = 0; i < N; i += 1) {
    const t = i / SR;
    const fade = Math.min(1, t / 0.05) * Math.min(1, (plan.total - t) / 2.5);
    outL[i] = Math.tanh((drums[0][i] + music[0][i] * duck[i]) * 1.15) * fade;
    outR[i] = Math.tanh((drums[1][i] + music[1][i] * duck[i]) * 1.15) * fade;
    peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  }

  const gain = 0.89 / peak;
  const data = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i] * gain)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i] * gain)) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

// `node music.mjs` renders a preview with a default plan.
if (process.argv[1] && process.argv[1].endsWith("music.mjs")) {
  const out = makeMusic({ total: 68, drop: 6, leadFrom: 22, leadTo: 46, breakFrom: 56, breakTo: 60, hit: 62 }, "output/music-preview.wav");
  console.log(out);
}
