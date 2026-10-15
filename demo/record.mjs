// Records the showcase video of the app.
//
//   cd Project/demo
//   npm run record                      # all scenes  -> output/showcase.mp4
//   node record.mjs notes graph         # only some scenes (handy while tuning)
//
// Needs the backend (:8000) and frontend (:3000) running. Drives the installed
// Microsoft Edge with Playwright, captures frames over the DevTools screencast
// (sharper than Playwright's built-in recorder), then encodes 1080p H.264 with ffmpeg.
// Everything the demo edits (notes, graph, ticked problems) is snapshotted first
// and restored afterwards, and notes created during the run are deleted.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = "http://localhost:3000";
const API = "http://localhost:8000";
const OUT_DIR = path.join(HERE, "output");
const FRAMES_DIR = path.join(OUT_DIR, "frames");
const OUTPUT = path.join(OUT_DIR, "showcase.mp4");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

// 1440x810 CSS pixels rendered at 4/3 density = crisp 1920x1080 frames.
const VIEWPORT = { width: 1440, height: 810 };
const SCALE = 4 / 3;

// ---------------------------------------------------------------- overlays

// A visible cursor (headless browsers don't draw one), click ripples and captions.
const OVERLAY = () => {
  const install = () => {
    if (document.getElementById("__demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__demo-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px;
        pointer-events: none; transform: translate(-3px, -2px); transition: transform .08s ease-out; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
      #__demo-cursor.down { transform: translate(-3px, -2px) scale(.85); }
      .__demo-ripple { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 2px solid rgba(129,140,248,.9); pointer-events: none; animation: __demo-ripple .5s ease-out forwards; }
      @keyframes __demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      #__demo-caption { position: fixed; z-index: 2147483645; left: 50%; bottom: 28px; transform: translate(-50%, 12px); opacity: 0;
        max-width: 80vw; padding: 12px 22px; border-radius: 14px; pointer-events: none;
        background: rgba(15,23,42,.88); border: 1px solid rgba(129,140,248,.45); box-shadow: 0 12px 40px rgba(0,0,0,.5);
        color: #f1f5f9; font: 600 19px/1.35 Inter, system-ui, sans-serif; text-align: center; backdrop-filter: blur(6px);
        transition: opacity .35s ease, transform .35s ease; }
      #__demo-caption.show { opacity: 1; transform: translate(-50%, 0); }
      #__demo-caption small { display: block; margin-top: 3px; font-weight: 500; font-size: 14px; color: #a5b4fc; }
    `;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "__demo-cursor";
    cursor.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(cursor);
    const caption = document.createElement("div");
    caption.id = "__demo-caption";
    document.body.appendChild(caption);
    window.addEventListener("mousemove", (e) => (cursor.style.left = `${e.clientX}px`, cursor.style.top = `${e.clientY}px`), true);
    window.addEventListener("mousedown", (e) => {
      cursor.classList.add("down");
      const r = document.createElement("div");
      r.className = "__demo-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    window.addEventListener("mouseup", () => cursor.classList.remove("down"), true);
    window.__caption = (title, sub) => {
      if (!title) return caption.classList.remove("show");
      caption.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ""}`;
      caption.classList.add("show");
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.status === 204 ? null : res.json();
};

function helpers(page) {
  let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

  const moveTo = async (x, y, ms = 600) => {
    const steps = Math.max(8, Math.round(ms / 16));
    await page.mouse.move(x, y, { steps });
    mouse = { x, y };
  };
  const centerOf = async (target) => {
    const loc = typeof target === "string" ? page.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`Not visible: ${target}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };
  const hover = async (target, ms = 600) => {
    const c = await centerOf(target);
    await moveTo(c.x, c.y, ms);
    return c;
  };
  const click = async (target, { ms = 600, pause = 350, offset } = {}) => {
    const c = await centerOf(target);
    const x = offset ? c.box.x + offset.x : c.x;
    const y = offset ? c.box.y + offset.y : c.y;
    await moveTo(x, y, ms);
    await sleep(120);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(pause);
  };
  const drag = async (from, to, ms = 900) => {
    await moveTo(from.x, from.y, 500);
    await page.mouse.down();
    await sleep(120);
    await moveTo(to.x, to.y, ms);
    await sleep(150);
    await page.mouse.up();
    await sleep(300);
  };
  const type = (text, delay = 55) => page.keyboard.type(text, { delay });
  const caption = async (title, sub, hold = 0) => {
    await page.evaluate(([t, s]) => window.__caption?.(t, s), [title, sub]);
    if (hold) await sleep(hold);
  };
  // Apps are opened from the Dock now; ids match the Dock's data-dock attributes.
  const APP_IDS = { Dashboard: "dashboard", Guitar: "guitar", Reading: "reading", LeetCode: "leetcode", Tasks: "tasks", Calendar: "tasks", Notes: "notes" };
  const nav = async (label) => {
    await click(`[data-dock="${APP_IDS[label]}"]`, { ms: 700 });
    await sleep(1000);
  };
  const win = (id) => `[data-window="${id}"]`;
  const zoomWindow = async (id) => {
    await click(`${win(id)} [data-light="zoom"]`, { pause: 700 });
  };
  const openNote = async (title) => {
    await click(page.locator(`${win("notes")} aside button`, { hasText: title }).first());
    await sleep(700);
  };
  return { moveTo, centerOf, hover, click, drag, type, caption, nav, win, zoomWindow, openNote, get mouse() { return mouse; } };
}

// ---------------------------------------------------------------- scenes

const SCENES = {
  async intro(page, h) {
    await h.caption("yogurt", "Your habits, notes and calendar - on a Mac OS X Aqua desktop", 2600);

    // the Dock: magnification as the pointer glides across it
    const first = await h.centerOf('[data-dock="dashboard"]');
    const last = await h.centerOf('[data-dock="notes"]');
    await h.moveTo(first.x - 40, first.y, 700);
    await h.moveTo(last.x + 40, last.y, 1600);
    await h.moveTo(first.x + 60, first.y, 1200);

    await h.caption("Every section is a window", "Drag it, stack it, minimise it into the Dock");
    await h.nav("Guitar");
    const bar = await h.centerOf(`${h.win("guitar")} header.aqua-titlebar`);
    await h.drag(bar, { x: bar.x + 140, y: bar.y + 50 }, 1000);
    await h.click(`${h.win("guitar")} [data-light="minimize"]`, { pause: 1100 });
    await h.nav("Guitar");
    await sleep(600);
    await h.click(`${h.win("guitar")} [data-light="close"]`, { pause: 700 });
    await h.caption(null);
  },

  async notes(page, h) {
    await h.nav("Notes");
    await h.zoomWindow("notes");
    await h.caption("Notes, inspired by Obsidian", "Live preview - only the line you're editing shows its markdown");
    await h.openNote("Two Pointer Patterns");
    await sleep(1200);
    const editor = `${h.win("notes")} section.card`;

    // tick markers are clickable everywhere
    await h.caption("Clickable tick markers", "Toggle a task without leaving the rendered view");
    await h.click(page.locator(`${editor} [role=checkbox][aria-checked=false]`).first(), { pause: 900 });

    // edit a line in place, Enter continues the checklist
    await h.caption("Type like a document", "Enter continues the checklist · Ctrl+L toggles a tick marker");
    const lastTask = page.locator(`${editor} [data-block]`, { hasText: "Trapping Rain Water" }).first();
    const box = await lastTask.boundingBox();
    await h.click(lastTask, { offset: { x: box.width - 12, y: box.height / 2 } });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await h.type("Move Zeroes - write-pointer trick");
    await page.keyboard.press("Enter");
    await h.type("Compare with ");

    // [[ links with autocomplete
    await h.caption("[[Links]] between notes", "Autocomplete as you type - unknown titles become new notes");
    await h.type("[[DP", 120);
    await sleep(900);
    await page.keyboard.press("Enter");
    await sleep(500);
    await page.keyboard.press("Escape");
    await sleep(900);

    // follow the link, show backlinks
    await h.caption("Follow links and see backlinks", "Every note lists the notes that mention it");
    await h.click(page.locator(`${editor} [data-block] button`, { hasText: "DP Cheatsheet" }).first(), { pause: 1200 });
    const mentions = page.locator(`${editor} h4`, { hasText: "Linked mentions" });
    await mentions.scrollIntoViewIfNeeded();
    await h.hover(mentions, 700);
    await sleep(1800);
    await h.caption(null);
  },

  async graph(page, h) {
    await h.caption("Graph notes", "Mind-map your roadmap: nodes, groups and animated connections");
    await h.openNote("DSA Roadmap");
    const canvas = page.locator(`${h.win("notes")} .graph-canvas`);
    await canvas.press("f");
    await sleep(1500);

    // hover = connections become flowing dots
    await h.caption("Hover to trace connections", "Linked arrows turn into flowing dots, everything else dims");
    for (const id of ["n_bt", "n_ll", "n_rtrav"]) {
      await h.hover(`[data-node-id="${id}"]`, 700);
      await sleep(1700);
    }

    // fluid dragging - arrows re-route to stay visible
    await h.caption("Fluid, self-adjusting arrows", "Arrows re-attach to the nearest side as nodes move");
    const bt = await h.centerOf('[data-node-id="n_bt"]');
    await h.drag(bt, { x: bt.x - 160, y: bt.y + 40 }, 1300);
    await sleep(500);
    const moved = await h.centerOf('[data-node-id="n_bt"]');
    await h.drag(moved, bt, 1000);

    // build: new node, connect, priority, group
    await h.caption("Build as you think", "Double-click to add a node · drag from its edge dots to connect");
    // find an empty patch of canvas near the top-right for the new node
    const spot = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      for (let dy = 90; dy < r.height - 120; dy += 30) {
        for (let dx = 140; dx < r.width / 2; dx += 30) {
          const x = r.right - dx;
          const y = r.top + dy;
          const hit = document.elementFromPoint(x, y);
          const clear = [[0, 0], [-70, 0], [70, 0], [0, -30], [0, 30]].every(([ox, oy]) => {
            const el = document.elementFromPoint(x + ox, y + oy);
            return el && !el.closest("[data-node-id],[data-group-id],[data-ui],[data-edge-id]");
          });
          if (hit && clear) return { x, y };
        }
      }
      return { x: r.right - 170, y: r.top + 110 };
    }, `${h.win("notes")} .graph-canvas`);
    await h.moveTo(spot.x, spot.y, 700);
    await page.mouse.dblclick(spot.x, spot.y);
    await sleep(300);
    await h.type("Segment Tree");
    await page.keyboard.press("Enter");
    await sleep(500);

    const heap = page.locator('[data-node-id="n_heap"]');
    await h.hover(heap, 600);
    await sleep(300);
    const handle = await h.centerOf(heap.locator(".ghandle-right"));
    const target = await h.centerOf(page.locator("[data-node-id]", { hasText: "Segment Tree" }).first());
    await h.drag(handle, target, 1100);
    await sleep(900);

    await h.caption("Priorities, progress and accents", "Each node can also link to a note - Ctrl+click opens it");
    await h.click(page.locator("[data-node-id]", { hasText: "Segment Tree" }).first(), { pause: 500 });
    await h.click(page.locator(`${h.win("notes")} [data-ui] button`, { hasText: "High" }).first(), { pause: 600 });
    await h.click(page.locator(`${h.win("notes")} [data-ui] [role=switch]`).first(), { pause: 900 });

    await h.caption("Group related ideas", "Shift-click to multi-select, Ctrl+G to group");
    await h.click('[data-node-id="n_heap"]', { pause: 200 });
    await page.keyboard.down("Shift");
    await h.click(page.locator("[data-node-id]", { hasText: "Segment Tree" }).first(), { pause: 200 });
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+g");
    await sleep(300);
    await h.type("Range Queries");
    await page.keyboard.press("Enter");
    await sleep(1400);
    await canvas.press("f");
    await sleep(1500);
    await h.zoomWindow("notes");
    await h.caption(null);
  },

  async floating(page, h) {
    await h.caption("Floating notes", "Pop any note out - pin it to keep it on screen across windows");
    const fab = page.locator('button[aria-label="Floating notes"]');
    await h.click(fab, { pause: 500 });
    await h.click(fab.locator("xpath=..").locator("button", { hasText: "DP Cheatsheet" }).first(), { pause: 900 });
    await h.click('.floating-note button[title^="Pin"]', { pause: 600 });
    const grip = await h.centerOf('.floating-note [title="Drag to move"]');
    await h.drag(grip, { x: grip.x - 380, y: grip.y + 120 }, 1000);
    await h.nav("Tasks");
    await sleep(1200);
    await h.nav("LeetCode");
    await sleep(1200);
    await h.click('.floating-note button[title^="Close"]', { pause: 600 });
    await h.caption(null);
  },

  async tour(page, h) {
    await h.caption("A calendar like iCal", "Day, week, month and schedule views - every event is a written note");
    await h.nav("Tasks");
    await sleep(1500);
    await page.keyboard.press("j");
    await sleep(1600);
    await page.keyboard.press("m");
    await sleep(1800);
    await page.keyboard.press("w");
    await page.keyboard.press("t");
    await sleep(800);

    await h.caption("LeetCode problems live in a note", "Tick a problem to mark it solved - stats update instantly");
    await h.nav("LeetCode");
    await sleep(1800);

    await h.caption("A Minecraft enchanting room", "Pick a book - it flies to the enchanting table and opens to your notes");
    await h.nav("Reading");
    await sleep(1000);
    await h.click(page.locator(`${h.win("reading")} .mc-book`).first(), { pause: 2600 });
    await h.click(page.locator(`${h.win("reading")} button`, { hasText: "Put back" }).first(), { pause: 1800 });

    await h.caption("Random scale generator", "Each key once per round - switch sets in one panel");
    await h.nav("Guitar");
    for (let i = 0; i < 3; i += 1) await h.click(page.locator(`${h.win("guitar")} button`, { hasText: /^Next$/ }).first(), { pause: 700 });
    await sleep(800);
    await h.caption(null);
  },

  async dark(page, h) {
    await h.caption("Dark mode", "One click in the menu bar - the whole desktop follows");
    await h.click('.aqua-menubar button[aria-label="Switch to dark mode"]', { pause: 1600 });
    await h.nav("Notes");
    await sleep(1400);
    await h.nav("Tasks");
    await sleep(1400);
    await h.click('.aqua-menubar button[aria-label="Switch to light mode"]', { pause: 1000 });
    await h.caption(null);
  },

  async outro(page, h) {
    await h.click(".aqua-menubar >> text=Window", { pause: 700 });
    await h.click(page.locator(".aqua-menu-item", { hasText: "Bring All to Front" }), { pause: 600 });
    await h.nav("Dashboard");
    await h.caption("yogurt", "FastAPI · React · PostgreSQL", 3500);
    await h.caption(null);
    await sleep(800);
  },
};

// ---------------------------------------------------------------- snapshot / restore

async function snapshot() {
  return { notes: await api("GET", "/notes"), problems: await api("GET", "/leetcode/problems") };
}

async function restore(before) {
  const keep = new Set(before.notes.map((n) => n.id));
  for (const n of await api("GET", "/notes")) if (!keep.has(n.id)) await api("DELETE", `/notes/${n.id}`);
  for (const n of before.notes) {
    const { title, content, graph, floating, floating_page, pinned, pos_x, pos_y, width, height } = n;
    await api("PATCH", `/notes/${n.id}`, { title, content, graph, floating, floating_page, pinned, pos_x, pos_y, width, height });
  }
  const now = new Map((await api("GET", "/leetcode/problems")).map((p) => [p.id, p]));
  for (const p of before.problems) {
    if (now.get(p.id)?.solved !== p.solved) await api("PATCH", `/leetcode/problems/${p.id}`, { solved: p.solved, solved_date: p.solved_date });
  }
}

// ---------------------------------------------------------------- capture + encode

function encode(frames, endTime) {
  const list = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.t ?? endTime;
    list.push(`file '${path.basename(f.file)}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  list.push(`file '${path.basename(frames[frames.length - 1].file)}'`); // concat demuxer needs the last file twice
  const listFile = path.join(FRAMES_DIR, "frames.ffconcat");
  fs.writeFileSync(listFile, `ffconcat version 1.0\n${list.join("\n")}\n`);
  const args = [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", OUTPUT,
  ];
  const r = spawnSync(ffmpegPath, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
}

async function main() {
  const wanted = process.argv.slice(2);
  const scenes = wanted.length ? wanted : Object.keys(SCENES);
  for (const s of scenes) if (!SCENES[s]) throw new Error(`Unknown scene "${s}" - pick from: ${Object.keys(SCENES).join(", ")}`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const before = await snapshot();

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "light" });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  // Start from a clean desktop with just the Dashboard window open.
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("yogurt.windows.v1"));
  await page.goto(APP, { waitUntil: "networkidle" });
  await sleep(600);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(FRAMES_DIR, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });

  const h = helpers(page);
  try {
    for (const name of scenes) {
      console.log(`scene: ${name}`);
      await SCENES[name](page, h);
    }
    await sleep(600);
  } finally {
    const endTime = Date.now() / 1000;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await browser.close();
    await sleep(1500); // let any debounced saves land before restoring
    await restore(before);
    console.log(`restored ${before.notes.length} notes`);
    if (frames.length) {
      encode(frames, Math.max(endTime, frames[frames.length - 1].t + 0.5));
      console.log(`\nwrote ${OUTPUT} (${frames.length} frames)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
