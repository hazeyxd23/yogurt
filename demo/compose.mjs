// Step 2 of the showcase video: edit the raw capture into an Apple-style spot.
//
// Reads output/capture/manifest.json (frames + timed markers + rectangles), plays an
// edit list where every shot lasts a whole number of beats, and renders 1080p frames in
// a headless browser: eased camera zooms onto the logged rectangles, frosted-glass
// callouts placed next to what they describe, kinetic title cards and a logo reveal.
// The soundtrack (music.mjs) is generated with the same timings and muxed in.
//
//   node compose.mjs            -> output/yogurt-showcase.mp4

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";
import { makeMusic } from "./music.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAP = path.join(HERE, "output", "capture");
const OUTPUT = path.join(HERE, "output", "yogurt-showcase.mp4");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FPS = 30;
const BEAT = 0.5; // 120 BPM
const W = 1920;
const H = 1080;

const manifest = JSON.parse(fs.readFileSync(path.join(CAP, "manifest.json"), "utf8"));
const { marks, rects, frames } = manifest;
const VW = manifest.viewport.width; // capture CSS size (1440x810)
const VH = manifest.viewport.height;
const PX = manifest.scale; // frame pixels per CSS px

// ---------------------------------------------------------------- the edit

const P = (text, sub) => ({ text, sub });
const EDIT = [
  { type: "words", beats: 2, words: ["Your", "habits."] },
  { type: "words", beats: 2, words: ["Your", "notes."] },
  { type: "words", beats: 2, words: ["One", "desktop."], gradient: true },
  { type: "logo", beats: 4 },
  { type: "clip", beats: 8, from: "dock.sweep", to: "launch.end", float: "in",
    cam: [{ at: 0, rect: "dock", zoom: 2.2 }, { at: 0.55, rect: "full" }],
    say: [{ ...P("Remember desktops?", "yogurt brings them back - right in your browser."), at: [0.45, 0.98], place: "top-left" }] },
  { type: "clip", beats: 6, from: "drag.win", to: "drag.win.end",
    cam: [{ at: 0, rect: "full", zoom: 1.08 }],
    say: [{ ...P("Drag. Stack. Minimise.", "Just like a Mac from 2007."), at: [0.1, 0.95], place: "bottom-right" }] },
  { type: "clip", beats: 4, from: "notes.open", to: "tick",
    cam: [{ at: 0, rect: "full" }, { at: 0.7, rect: "notes.editor", zoom: 1.35 }],
    say: [{ ...P("Notes, rethought.", "Inspired by Obsidian."), at: [0.2, 0.98], place: "top-left", gradient: true }] },
  { type: "clip", beats: 4, from: "tick", to: "tick.end", cam: [{ at: 0, rect: "tick", zoom: 2.3 }],
    say: [{ ...P("Tick it.", "Checkboxes work everywhere - even mid-edit."), at: [0.15, 0.95], near: "tick", side: "right" }] },
  { type: "clip", beats: 6, from: "type", to: "type.end", cam: [{ at: 0, rect: "type", zoom: 2 }],
    say: [{ ...P("Type like a document.", "Lists continue themselves."), at: [0.1, 0.95], near: "type", side: "auto" }] },
  { type: "clip", beats: 6, from: "link", to: "link.open", cam: [{ at: 0, rect: "type", zoom: 2 }, { at: 0.4, rect: "link", zoom: 2.4 }],
    say: [{ ...P("Link anything.", "Type [[ and pick a note."), at: [0.2, 0.97], near: "link", side: "auto" }] },
  { type: "clip", beats: 4, from: "link.open", to: "link.end", cam: [{ at: 0, rect: "link.open", zoom: 2.4 }, { at: 0.6, rect: "notes.editor", zoom: 1.35 }],
    say: [{ ...P("Click to follow.", "Every link opens its note."), at: [0.1, 0.95], place: "top-left" }] },
  { type: "clip", beats: 4, from: "backlinks", to: "backlinks.end", cam: [{ at: 0, rect: "backlinks", zoom: 1.9 }],
    say: [{ ...P("See every connection.", "Backlinks, automatically."), at: [0.1, 0.95], near: "backlinks", side: "top" }] },
  { type: "clip", beats: 4, from: "graph.wide", to: "graph.wide.end", cam: [{ at: 0, rect: "full", zoom: 1 }, { at: 1, rect: "graph", zoom: 1.12 }],
    say: [{ ...P("Think in graphs.", "Graph notes for roadmaps and ideas."), at: [0.1, 0.98], place: "top-left", gradient: true }] },
  { type: "clip", beats: 6, from: "hover", to: "hover.end", cam: [{ at: 0, rect: "hover.bt", zoom: 2.1 }],
    say: [{ ...P("Watch ideas flow.", "Hover a node to trace its links."), at: [0.12, 0.95], near: "hover.bt", side: "auto", dark: true }] },
  { type: "clip", beats: 6, from: "build", to: "build.end", cam: [{ at: 0, rect: "build", zoom: 2 }],
    say: [{ ...P("Build as you think.", "Double-click. Drag to connect."), at: [0.1, 0.95], near: "build", side: "auto", dark: true }] },
  { type: "clip", beats: 4, from: "inspect", to: "inspect.end", cam: [{ at: 0, rect: "inspect", zoom: 1.9 }],
    say: [{ ...P("Prioritise.", "Priority, progress, accents."), at: [0.1, 0.95], near: "inspect", side: "left", dark: true }] },
  { type: "clip", beats: 4, from: "group", to: "group.end", cam: [{ at: 0, rect: "group", zoom: 2.1 }],
    say: [{ ...P("Group it.", "Shift-click, Ctrl+G."), at: [0.1, 0.95], near: "group", side: "auto", dark: true }] },
  { type: "clip", beats: 2, from: "group.end", to: "graph.fit", cam: [{ at: 0, rect: "group", zoom: 2.1 }, { at: 0.9, rect: "full" }] },
  { type: "clip", beats: 8, from: "float", to: "float.end", cam: [{ at: 0, rect: "full", zoom: 1.05 }, { at: 1, rect: "full", zoom: 1.12 }],
    say: [{ ...P("Notes that float.", "Pin one and it follows you between windows."), at: [0.25, 0.97], place: "top-left" }] },
  { type: "clip", beats: 3, from: "cal.month", to: "cal.month.end", cam: [{ at: 0, rect: "full", zoom: 1.12 }, { at: 1, rect: "full" }],
    say: [{ ...P("Calendar.", null), at: [0.05, 0.98], place: "bottom-left" }] },
  { type: "clip", beats: 3, from: "lc", to: "lc.end", cam: [{ at: 0, rect: "lc", zoom: 1.25 }, { at: 1, rect: "lc", zoom: 1.1 }],
    say: [{ ...P("LeetCode.", null), at: [0.05, 0.98], place: "bottom-right" }] },
  { type: "clip", beats: 3, from: "read", to: "read.end", cam: [{ at: 0, rect: "library", zoom: 1.6 }, { at: 1, rect: "library", zoom: 1.9 }],
    say: [{ ...P("Reading.", "In an enchanting room."), at: [0.05, 0.98], near: "library", side: "left" }] },
  { type: "clip", beats: 3, from: "scales", to: "scales.end", cam: [{ at: 0, rect: "scales", zoom: 1.5 }],
    say: [{ ...P("Guitar.", null), at: [0.05, 0.98], near: "scales", side: "right" }] },
  { type: "clip", beats: 8, from: "dark", to: "dark.end", cam: [{ at: 0, rect: "full", zoom: 1.1 }, { at: 1, rect: "full" }],
    say: [{ ...P("And when the lights go down.", "Dark mode, one click away."), at: [0.25, 0.97], place: "center", dark: true }] },
  { type: "clip", beats: 4, from: "final", to: "final.end", float: "out", cam: [{ at: 0, rect: "full" }] },
  { type: "end", beats: 10 },
];

// ---------------------------------------------------------------- timing

let clock = 0;
for (const shot of EDIT) {
  shot.start = clock;
  shot.dur = shot.beats * BEAT;
  clock += shot.dur;
  if (shot.type === "clip") {
    for (const k of [shot.from, shot.to]) if (!(k in marks)) throw new Error(`missing mark "${k}"`);
    shot.src0 = marks[shot.from];
    shot.src1 = marks[shot.to];
  }
}
const TOTAL = clock;
const at = (type, i = 0) => EDIT.filter((s) => s.type === type)[i];
const first = (pred) => EDIT.find(pred);
const PLAN = {
  total: TOTAL,
  drop: at("logo").start,
  leadFrom: first((s) => s.from === "graph.wide").start,
  leadTo: first((s) => s.from === "cal.month").start,
  breakFrom: first((s) => s.from === "dark").start,
  breakTo: first((s) => s.from === "dark").start + first((s) => s.from === "dark").dur,
  hit: at("end").start,
};

// ---------------------------------------------------------------- camera

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function view(spec) {
  if (spec.rect === "full") {
    const z = spec.zoom || 1;
    return fit({ cx: VW / 2, cy: VH / 2, z });
  }
  const r = rects[spec.rect];
  if (!r) throw new Error(`missing rect "${spec.rect}"`);
  const zFit = Math.min(VW / r.w, VH / r.h) * 0.9;
  const z = clamp(Math.min(zFit, spec.zoom || 2.4), 1, 2.6);
  return fit({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, z });
}

function fit({ cx, cy, z }) {
  const hw = VW / 2 / z;
  const hh = VH / 2 / z;
  return { cx: clamp(cx, hw, VW - hw), cy: clamp(cy, hh, VH - hh), z };
}

function cameraAt(shot, u) {
  const keys = shot.cam.map((k) => ({ at: k.at, v: view(k) }));
  let cam;
  if (u <= keys[0].at) cam = { ...keys[0].v };
  else {
    let i = keys.length - 1;
    while (i > 0 && keys[i].at > u) i -= 1;
    if (i === keys.length - 1) cam = { ...keys[i].v };
    else {
      const a = keys[i];
      const b = keys[i + 1];
      const e = ease((u - a.at) / (b.at - a.at));
      cam = {
        cx: a.v.cx + (b.v.cx - a.v.cx) * e,
        cy: a.v.cy + (b.v.cy - a.v.cy) * e,
        z: a.v.z * (b.v.z / a.v.z) ** e,
      };
    }
  }
  // slow drift, plus a little punch-in right after the cut
  const punch = 1 + 0.05 * Math.exp(-(u * shot.dur) / 0.12);
  cam.z *= (1 + 0.035 * u) * punch;
  return fit(cam);
}

/** CSS point in the capture -> output pixel, for a camera. */
const project = (cam, x, y) => {
  const k = (cam.z * W) / VW;
  return { x: (x - cam.cx) * k + W / 2, y: (y - cam.cy) * k + H / 2 };
};

// ---------------------------------------------------------------- callouts

const CALLOUT_W = 560;

function placeCallout(c, cam) {
  const fixed = {
    "top-left": { x: 90, y: 90, tx: 0, ty: 0, from: [-1, 0] },
    "top-right": { x: W - 90, y: 90, tx: -100, ty: 0, from: [1, 0] },
    "bottom-left": { x: 90, y: H - 90, tx: 0, ty: -100, from: [0, 1] },
    "bottom-right": { x: W - 90, y: H - 90, tx: -100, ty: -100, from: [0, 1] },
    center: { x: W / 2, y: H / 2, tx: -50, ty: -50, from: [0, 1] },
  };
  if (c.place) return fixed[c.place];
  const r = rects[c.near];
  const a = project(cam, r.x, r.y);
  const b = project(cam, r.x + r.w, r.y + r.h);
  const room = { right: W - b.x, left: a.x, bottom: H - b.y, top: a.y };
  let side = c.side;
  if (side === "auto") side = room.right > CALLOUT_W + 120 ? "right" : room.left > CALLOUT_W + 120 ? "left" : room.bottom > 260 ? "bottom" : room.top > 260 ? "top" : null;
  if (side === "right" && room.right < CALLOUT_W + 120) side = null;
  if (side === "left" && room.left < CALLOUT_W + 120) side = null;
  if (!side) return fixed["top-left"];
  const cy = clamp((a.y + b.y) / 2, 160, H - 160);
  const cx = clamp((a.x + b.x) / 2, CALLOUT_W / 2 + 70, W - CALLOUT_W / 2 - 70);
  if (side === "right") return { x: Math.min(b.x + 50, W - CALLOUT_W - 70), y: cy, tx: 0, ty: -50, from: [-1, 0] };
  if (side === "left") return { x: Math.max(a.x - 50, CALLOUT_W + 70), y: cy, tx: -100, ty: -50, from: [1, 0] };
  if (side === "bottom") return { x: cx, y: Math.min(b.y + 40, H - 240), tx: -50, ty: 0, from: [0, -1] };
  return { x: cx, y: Math.max(a.y - 40, 240), tx: -50, ty: -100, from: [0, 1] };
}

function calloutState(shot, u, cam) {
  return (shot.say || [])
    .filter((c) => u >= c.at[0] - 0.001 && u <= c.at[1])
    .map((c) => {
      // positions are decided once per shot, from the camera at the callout's start
      c.pos = c.pos || placeCallout(c, cameraAt(shot, c.at[0]));
      const tIn = (u - c.at[0]) * shot.dur;
      const tOut = (c.at[1] - u) * shot.dur;
      const pIn = ease(clamp(tIn / 0.38, 0, 1));
      const pOut = ease(clamp(tOut / 0.22, 0, 1));
      const p = Math.min(pIn, pOut);
      return {
        text: c.text,
        sub: c.sub,
        dark: Boolean(c.dark),
        gradient: Boolean(c.gradient),
        ...c.pos,
        opacity: p,
        dx: (1 - pIn) * 46 * -c.pos.from[0],
        dy: (1 - pIn) * 46 * -c.pos.from[1],
        blur: (1 - p) * 10,
        scale: 0.96 + 0.04 * pIn,
      };
    });
}

// ---------------------------------------------------------------- frames

function frameAt(srcT) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= srcT) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].f;
}

function stateAt(t) {
  const shot = EDIT.find((s) => t >= s.start && t < s.start + s.dur) || EDIT[EDIT.length - 1];
  const u = clamp((t - shot.start) / shot.dur, 0, 1);
  const local = t - shot.start;
  const state = { kind: shot.type, u, local, dur: shot.dur, flash: 0 };
  if (t >= PLAN.drop && t < PLAN.drop + 0.25) state.flash = 1 - (t - PLAN.drop) / 0.25;
  if (shot.type === "words") Object.assign(state, { words: shot.words, gradient: shot.gradient, beat: BEAT });
  if (shot.type === "clip") {
    const cam = cameraAt(shot, u);
    const k = (cam.z * W) / VW / PX; // frame px -> output px
    state.img = {
      src: `http://capture.local/${frameAt(shot.src0 + u * (shot.src1 - shot.src0))}`,
      s: k,
      tx: W / 2 - cam.cx * PX * k,
      ty: H / 2 - cam.cy * PX * k,
    };
    if (shot.float) {
      const e = shot.float === "in" ? ease(clamp(u / 0.6, 0, 1)) : 1 - ease(clamp((u - 0.2) / 0.8, 0, 1));
      state.stage = { scale: 0.7 + 0.3 * e, tilt: 16 * (1 - e), radius: 14 * (1 - e), full: e };
    }
    state.callouts = calloutState(shot, u, cam);
  }
  return state;
}

// ---------------------------------------------------------------- the renderer page

const LOGO = fs.readFileSync(path.join(HERE, "..", "frontend", "public", "yogurt.svg"), "utf8");
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; font-family: Inter, "Segoe UI", sans-serif; }
  #bg { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 35%, #2b5fb8 0%, #102a63 45%, #050b1f 100%); }
  #stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; }
  #screen { position: absolute; inset: 0; overflow: hidden; }
  #stage.float #screen { box-shadow: 0 60px 140px rgba(0,0,0,.6); }
  #chrome { position: absolute; left: 0; right: 0; bottom: 100%; height: 78px; display: none; flex-direction: column;
    border-radius: 14px 14px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,.45); border-bottom: none;
    background: linear-gradient(180deg, #ececec 0%, #d4d4d4 55%, #bcbcbc 100%); box-shadow: inset 0 1px 0 #fff;
    font-family: "Lucida Grande", "Segoe UI", sans-serif; color: #2a2a2a; }
  #stage.float #chrome { display: flex; }
  #chrome .row1 { position: relative; height: 30px; display: flex; align-items: center; padding: 0 14px; }
  #chrome .lights { display: flex; gap: 9px; }
  #chrome .lights i { width: 15px; height: 15px; border-radius: 50%; border: 1px solid rgba(0,0,0,.3);
    box-shadow: inset 0 2px 2px rgba(255,255,255,.7); }
  #chrome .title { position: absolute; left: 0; right: 0; text-align: center; font-size: 15px; }
  #chrome .row2 { height: 46px; display: flex; align-items: center; gap: 12px; padding: 0 16px 8px; }
  #chrome .nav { display: flex; }
  #chrome .nav span { width: 38px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 20px;
    border: 1px solid #8e8e8e; background: linear-gradient(#fff, #e3e3e3 50%, #d6d6d6 51%, #ededed); color: #555; }
  #chrome .nav span:first-child { border-radius: 8px 0 0 8px; }
  #chrome .nav span:last-child { border-radius: 0 8px 8px 0; border-left: none; }
  #chrome .address { flex: 1; height: 30px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-radius: 6px;
    background: #fff; border: 1px solid #8a8a8a; box-shadow: inset 0 1px 2px rgba(0,0,0,.2); font-size: 16px; color: #333; }
  #chrome .address svg { width: 30px; height: auto; }
  #chrome .search { width: 260px; height: 30px; border-radius: 15px; background: #fff; border: 1px solid #8a8a8a;
    box-shadow: inset 0 1px 2px rgba(0,0,0,.2); }
  #img { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
  .callout { position: absolute; width: max-content; max-width: ${CALLOUT_W}px; padding: 26px 34px 28px; border-radius: 28px;
    background: rgba(255,255,255,.74); backdrop-filter: blur(26px) saturate(1.8); color: #1d1d1f;
    box-shadow: 0 30px 80px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.6); }
  .callout.dark { background: rgba(22,22,26,.72); color: #f5f5f7; box-shadow: 0 30px 80px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.12); }
  .callout h2 { font-weight: 800; font-size: 58px; line-height: 1.02; letter-spacing: -2.2px; }
  .callout p { margin-top: 10px; font-weight: 500; font-size: 25px; line-height: 1.3; color: #48484c; letter-spacing: -.3px; }
  .callout.dark p { color: #a1a1a8; }
  .grad { background: linear-gradient(100deg, #2f80ff 0%, #7b5cff 50%, #ff5ea8 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #title { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 34px; }
  .word { font-weight: 800; font-size: 150px; letter-spacing: -6px; color: #f5f5f7; }
  #flash { position: absolute; inset: 0; background: #fff; pointer-events: none; }
  #logo { position: absolute; left: 50%; top: 50%; width: 760px; }
  #wordmark { position: absolute; left: 50%; font-weight: 800; letter-spacing: -5px; color: #fff; white-space: nowrap; }
  .tag { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; text-align: center; }
</style></head><body>
<div id="bg"></div>
<div id="stage">
  <div id="chrome">
    <div class="row1"><div class="lights"><i style="background:#fc5f55"></i><i style="background:#fdbc2e"></i><i style="background:#2ac840"></i></div><div class="title">yogurt</div></div>
    <div class="row2"><div class="nav"><span>&#8249;</span><span>&#8250;</span></div><div class="address" id="address"></div><div class="search"></div></div>
  </div>
  <div id="screen"><img id="img"></div>
</div>
<div id="layer"></div>
<div id="flash"></div>
<script>
  const LOGO = ${JSON.stringify(LOGO)};
  const $ = (id) => document.getElementById(id);
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let lastSrc = null;
  document.getElementById("address").innerHTML = LOGO.split("#blue").join("#blue-tab").split('id="blue"').join('id="blue-tab"') + "<span>localhost:3000</span>";

  window.render = async (s) => {
    const stage = $("stage"), img = $("img"), layer = $("layer");
    $("flash").style.opacity = s.flash;
    $("bg").style.opacity = s.kind === "clip" ? 1 : s.kind === "words" ? 0 : 1;
    layer.innerHTML = "";

    if (s.kind === "clip") {
      stage.style.display = "block";
      if (s.img.src !== lastSrc) {
        img.src = s.img.src;
        await img.decode().catch(() => {});
        lastSrc = s.img.src;
      }
      img.style.transform = "translate(" + s.img.tx + "px," + s.img.ty + "px) scale(" + s.img.s + ")";
      if (s.stage) {
        stage.className = "float";
        stage.style.transform = "translateY(" + 39 * s.stage.scale * (1 - s.stage.full) + "px) perspective(2600px) rotateX(" + s.stage.tilt + "deg) scale(" + s.stage.scale + ")";
        $("screen").style.borderRadius = "0 0 " + s.stage.radius + "px " + s.stage.radius + "px";
      } else {
        stage.className = "";
        stage.style.transform = "none";
        $("screen").style.borderRadius = "0";
      }
      for (const c of s.callouts) {
        const el = document.createElement("div");
        el.className = "callout" + (c.dark ? " dark" : "");
        el.innerHTML = "<h2" + (c.gradient ? " class=grad" : "") + ">" + esc(c.text) + "</h2>" + (c.sub ? "<p>" + esc(c.sub) + "</p>" : "");
        el.style.left = c.x + "px";
        el.style.top = c.y + "px";
        el.style.opacity = c.opacity;
        el.style.filter = "blur(" + c.blur + "px)";
        el.style.transform = "translate(" + c.tx + "%," + c.ty + "%) translate(" + c.dx + "px," + c.dy + "px) scale(" + c.scale + ")";
        layer.appendChild(el);
      }
      return;
    }

    stage.style.display = "none";
    if (s.kind === "words") {
      const t = document.createElement("div");
      t.id = "title";
      s.words.forEach((w, i) => {
        const tw = s.local - i * s.beat;
        const p = clamp(tw / 0.22, 0, 1);
        const out = clamp((s.dur - s.local) / 0.12, 0, 1);
        const el = document.createElement("span");
        el.className = "word" + (s.gradient ? " grad" : "");
        el.textContent = w;
        el.style.opacity = Math.min(p, out);
        el.style.transform = "translateY(" + (1 - ease(p)) * 40 + "px) scale(" + (1.18 - 0.18 * ease(p)) + ")";
        el.style.filter = "blur(" + (1 - p) * 14 + "px)";
        t.appendChild(el);
      });
      layer.appendChild(t);
      return;
    }

    // logo reveal (on the drop) and end card
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;inset:0";
    const p = clamp(s.local / 0.7, 0, 1);
    const logo = document.createElement("div");
    logo.id = "logo";
    logo.innerHTML = LOGO;
    const end = s.kind === "end";
    const size = end ? 0.62 : 1;
    logo.style.transform = "translate(-50%," + (end ? -88 : -62) + "%) scale(" + (0.3 + 0.7 * back(p)) * size + ")";
    logo.style.opacity = clamp(s.local / 0.18, 0, 1) * clamp((s.dur - s.local) / 0.5, 0, 1);
    box.appendChild(logo);
    const wm = document.createElement("div");
    wm.id = "wordmark";
    wm.textContent = "yogurt";
    const q = clamp((s.local - 0.35) / 0.5, 0, 1);
    wm.style.fontSize = (end ? 132 : 110) + "px";
    wm.style.top = (end ? 560 : 700) + "px";
    wm.style.opacity = ease(q) * clamp((s.dur - s.local) / 0.5, 0, 1);
    wm.style.transform = "translate(-50%, " + (1 - ease(q)) * 30 + "px)";
    box.appendChild(wm);
    if (!end) {
      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent = "a productivity web app";
      const r = clamp((s.local - 0.7) / 0.45, 0, 1);
      tag.style.cssText += ";top:838px;font-size:40px;font-weight:600;letter-spacing:-1px;color:#cfe2ff;opacity:" + ease(r) * clamp((s.dur - s.local) / 0.3, 0, 1) + ";transform:translateX(-50%) translateY(" + (1 - ease(r)) * 20 + "px)";
      box.appendChild(tag);
    }
    if (end) {
      const lines = [
        ["Your habits, notes and calendar.", 736, 44, 700, "#f5f5f7", 0.9],
        ["One desktop.", 800, 44, 700, null, 1.15],
        ["The way computers used to feel.", 872, 30, 500, "#c7c7cc", 1.6],
        ["Built with FastAPI · React · PostgreSQL", 948, 24, 500, "#8e8e96", 2.0],
      ];
      for (const [text, top, size2, weight, color, delay] of lines) {
        const el = document.createElement("div");
        el.className = "tag" + (color ? "" : " grad");
        el.textContent = text;
        const r = clamp((s.local - delay) / 0.5, 0, 1);
        el.style.cssText += ";top:" + top + "px;font-size:" + size2 + "px;font-weight:" + weight + ";letter-spacing:-1px;" + (color ? "color:" + color + ";" : "") +
          "opacity:" + ease(r) * clamp((s.dur - s.local) / 0.5, 0, 1) + ";transform:translateX(-50%) translateY(" + (1 - ease(r)) * 24 + "px)";
        box.appendChild(el);
      }
    }
    layer.appendChild(box);
  };
</script></body></html>`;

// ---------------------------------------------------------------- main

const musicFile = makeMusic(PLAN, path.join(HERE, "output", "soundtrack.wav"));
console.log(`edit: ${EDIT.length} shots, ${TOTAL.toFixed(1)}s; music plan`, PLAN);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.route("http://capture.local/**", (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  route.fulfill({ path: path.join(CAP, "frames", name), contentType: "image/jpeg" });
});
await page.setContent(PAGE, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// `node compose.mjs --stills 3 9.5 17` renders a few frames as PNGs to check the edit.
const stillsAt = process.argv.indexOf("--stills");
if (stillsAt !== -1) {
  const times = process.argv.slice(stillsAt + 1).map(Number);
  const dir = path.join(HERE, "output", "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of times) {
    await page.evaluate((s) => window.render(s), stateAt(t));
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(1)}.png`) });
  }
  await browser.close();
  console.log(`stills in ${dir}`);
  process.exit(0);
}

const ff = spawn(ffmpegPath, [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-i", musicFile,
  "-map", "0:v", "-map", "1:a",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "256k", "-af", "volume=0.9",
  "-shortest", "-movflags", "+faststart", OUTPUT,
], { stdio: ["pipe", "inherit", "inherit"] });

const total = Math.round(TOTAL * FPS);
const started = Date.now();
for (let i = 0; i < total; i += 1) {
  await page.evaluate((s) => window.render(s), stateAt(i / FPS));
  const jpg = await page.screenshot({ type: "jpeg", quality: 93 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 150 === 0) console.log(`frame ${i}/${total}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`wrote ${OUTPUT}`);
