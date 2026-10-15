// Step 1 of the showcase video: drive the app and capture raw footage.
//
// Records double-resolution frames (2880x1620) over the DevTools screencast and logs
// a timeline of named markers plus the on-screen rectangles the editor should frame,
// so compose.mjs can cut to the beat and zoom onto the action. Everything the demo
// edits is snapshotted first and restored afterwards.
//
//   node capture.mjs            -> output/capture/{frames/*.jpg, manifest.json}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = "http://localhost:3000";
const API = "http://localhost:8000";
const OUT = path.join(HERE, "output", "capture");
const FRAMES = path.join(OUT, "frames");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const VIEWPORT = { width: 1440, height: 810 };

// A macOS-style pointer and click ripple (headless browsers draw no cursor).
const CURSOR = () => {
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__cursor { position: fixed; z-index: 2147483647; left: -40px; top: -40px; width: 26px; height: 26px; pointer-events: none;
        transform: translate(-4px, -3px); transition: transform .08s ease-out; filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); }
      #__cursor.down { transform: translate(-4px, -3px) scale(.86); }
      .__ripple { position: fixed; z-index: 2147483646; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
        border: 3px solid rgba(80,150,255,.85); pointer-events: none; animation: __ripple .5s ease-out forwards; }
      @keyframes __ripple { from { transform: scale(.25); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }
    `;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5v17.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);
    addEventListener("pointermove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener("pointerdown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div");
      r.className = "__ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener("pointerup", () => c.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const api = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.status === 204 ? null : res.json();
};

// ---------------------------------------------------------------- helpers

function helpers(page, log) {
  const loc = (t) => (typeof t === "string" ? page.locator(t).first() : t);
  const boxOf = async (t) => {
    const l = loc(t);
    await l.scrollIntoViewIfNeeded().catch(() => {});
    const b = await l.boundingBox();
    if (!b) throw new Error(`not visible: ${t}`);
    return b;
  };
  // Eased pointer motion: accelerate, then settle onto the target like a real hand.
  let pointer = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  const moveTo = async (x, y, ms = 450) => {
    const from = { ...pointer };
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps;
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    }
    pointer = { x, y };
  };
  const centerOf = async (t) => {
    const b = await boxOf(t);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const hover = async (t, ms = 450) => {
    const c = await centerOf(t);
    await moveTo(c.x, c.y, ms);
    return c;
  };
  const click = async (t, { ms = 450, pause = 250, offset } = {}) => {
    const c = await centerOf(t);
    await moveTo(offset ? c.box.x + offset.x : c.x, offset ? c.box.y + offset.y : c.y, ms);
    await sleep(80);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(pause);
  };
  const drag = async (from, to, ms = 700) => {
    await moveTo(from.x, from.y, 350);
    await page.mouse.down();
    await sleep(90);
    await moveTo(to.x, to.y, ms);
    await sleep(120);
    await page.mouse.up();
    await sleep(250);
  };
  const type = (text, delay = 45) => page.keyboard.type(text, { delay });
  const mark = (name) => {
    log.marks[name] = now();
  };
  /** Remember where something is on screen (CSS px), optionally padded / unioned with more targets. */
  const rect = async (name, targets, pad = 16) => {
    const list = Array.isArray(targets) ? targets : [targets];
    const boxes = [];
    for (const t of list) boxes.push(typeof t === "object" && "width" in t ? t : await boxOf(t));
    const x = Math.min(...boxes.map((b) => b.x)) - pad;
    const y = Math.min(...boxes.map((b) => b.y)) - pad;
    const r = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    const btm = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    log.rects[name] = { x, y, w: r - x, h: btm - y };
  };
  const win = (id) => `[data-window="${id}"]`;
  const open = async (id, pause = 800) => {
    await click(`[data-dock="${id}"]`, { ms: 500 });
    await sleep(pause);
  };
  return { loc, boxOf, moveTo, centerOf, hover, click, drag, type, mark, rect, win, open };
}

// ---------------------------------------------------------------- the performance

async function perform(page, h) {
  const { mark, rect, win } = h;

  // --- desktop: empty desktop, Dock sweep, launching apps ---
  await page.goto(`${APP}/desktop`, { waitUntil: "networkidle" });
  await sleep(500);
  await rect("dock", ".aqua-dock", 30);
  const first = await h.centerOf('[data-dock="dashboard"]');
  const last = await h.centerOf('[data-dock="notes"]');
  await h.moveTo(first.x - 60, first.y + 4, 200);
  mark("dock.sweep");
  await h.moveTo(last.x + 50, last.y, 1400);
  await h.moveTo(first.x + 20, first.y, 900);
  mark("dock.sweep.end");

  mark("launch");
  await h.open("dashboard", 500);
  await h.open("guitar", 500);
  await h.open("tasks", 500);
  await h.open("notes", 900);
  mark("launch.end");

  // grab the Notes title bar, then one smooth glide - the window rides with the pointer
  const bar = await h.centerOf(`${win("notes")} header.aqua-titlebar`);
  await h.moveTo(bar.x - 60, bar.y, 500);
  await sleep(250);
  mark("drag.win");
  await page.mouse.down();
  await sleep(150);
  await h.moveTo(bar.x + 110, bar.y + 70, 1400);
  await sleep(200);
  await page.mouse.up();
  await sleep(450);
  mark("drag.win.end");

  // --- notes ---
  await h.click(`${win("notes")} [data-light="zoom"]`, { pause: 600 });
  await h.click(page.locator(`${win("notes")} aside button`, { hasText: "Two Pointer Patterns" }).first(), { pause: 700 });
  const editor = `${win("notes")} section.card`;
  await rect("notes.editor", editor, 0);
  mark("notes.open");

  const box = page.locator(`${editor} [role=checkbox][aria-checked=false]`).first();
  await rect("tick", [box, page.locator(`${editor} [data-block]`, { hasText: "Trapping Rain Water" }).first()], 40);
  await h.hover(box, 500);
  mark("tick");
  await h.click(box, { ms: 150, pause: 700 });
  mark("tick.end");

  const lastTask = page.locator(`${editor} [data-block]`, { hasText: "Trapping Rain Water" }).first();
  const tb = await lastTask.boundingBox();
  await rect("type", [lastTask, { x: tb.x, y: tb.y, width: tb.width, height: tb.height + 70 }], 30);
  mark("type");
  await h.click(lastTask, { offset: { x: tb.width - 12, y: tb.height / 2 }, pause: 200 });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await h.type("Move Zeroes - write-pointer trick");
  await page.keyboard.press("Enter");
  mark("type.end");
  await h.type("Compare with ");
  mark("link");
  await h.type("[[DP", 110);
  await sleep(500);
  await rect("link", [`${editor} [role=listbox]`, `${editor} [data-block] textarea`], 30);
  await sleep(300);
  await h.click(page.locator(`${editor} [role=listbox] button`, { hasText: "DP Cheatsheet" }).first(), { ms: 550, pause: 350 });
  await page.keyboard.press("Escape");
  await sleep(450);
  // follow the link that was just made
  const madeLink = page.locator(`${editor} [data-block] button`, { hasText: "DP Cheatsheet" }).last();
  await rect("link.open", madeLink, 70);
  mark("link.open");
  await h.click(madeLink, { ms: 550, pause: 1100 });
  mark("link.end");

  const mentions = page.locator(`${editor} h4`, { hasText: "Linked mentions" });
  await mentions.scrollIntoViewIfNeeded();
  await rect("backlinks", [mentions, page.locator(`${editor} h4`, { hasText: "Links" })], 60);
  mark("backlinks");
  await h.hover(mentions, 500);
  await sleep(1200);
  mark("backlinks.end");

  // --- graph ---
  await h.click(page.locator(`${win("notes")} aside button`, { hasText: "DSA Roadmap" }).first(), { pause: 600 });
  const canvas = page.locator(`${win("notes")} .graph-canvas`);
  await canvas.press("f");
  await sleep(1000);
  await rect("graph", canvas, 0);
  mark("graph.wide");
  await sleep(1500);
  mark("graph.wide.end");

  await rect("hover.bt", ['[data-node-id="n_bt"]', '[data-node-id="n_rec"]', '[data-node-id="n_rtrav"]', '[data-node-id="n_ltrav"]', '[data-group-id="g_adv"]'], 30);
  mark("hover");
  await h.hover('[data-node-id="n_bt"]', 500);
  await sleep(1600);
  await h.hover('[data-node-id="n_rtrav"]', 400);
  await sleep(1300);
  mark("hover.end");

  // a fresh node in an empty patch near the top-right, connected from Heap
  const spot = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    const free = (x, y) => [[0, 0], [-80, 0], [80, 0], [0, -30], [0, 30], [-80, -30], [80, -30], [-80, 30], [80, 30]].every(([ox, oy]) => {
      const el = document.elementFromPoint(x + ox, y + oy);
      return el && !el.closest("[data-node-id],[data-group-id],[data-ui],[data-edge-id]");
    });
    const maxX = r.right - 330; // the inspector panel opens on the right
    // up and to the right of Linked List, with some breathing room
    const ll = [...document.querySelectorAll("[data-node-id]")].find((n) => n.textContent.trim() === "Linked List");
    if (ll) {
      const b = ll.getBoundingClientRect();
      for (const dy of [-60, -75, -45, -90, -30])
        for (let dx = 150; dx <= 260; dx += 15) {
          const x = b.right + dx - 60;
          const y = b.top + b.height / 2 + dy;
          if (x < maxX && y > r.top + 50 && free(x, y)) return { x, y };
        }
    }
    for (let dy = 90; dy < r.height - 120; dy += 30)
      for (let dx = 330; dx < r.width * 0.6; dx += 30)
        if (free(r.right - dx, r.top + dy)) return { x: r.right - dx, y: r.top + dy };
    return { x: r.right - 400, y: r.top + 120 };
  }, `${win("notes")} .graph-canvas`);
  await rect("build", ['[data-node-id="n_heap"]', { x: spot.x - 90, y: spot.y - 40, width: 180, height: 80 }], 50);
  mark("build");
  await h.moveTo(spot.x, spot.y, 450);
  await page.mouse.dblclick(spot.x, spot.y);
  await sleep(200);
  await h.type("Segment Tree", 55);
  await page.keyboard.press("Enter");
  await sleep(350);
  const heap = page.locator('[data-node-id="n_heap"]');
  await h.hover(heap, 400);
  await sleep(200);
  const handle = await h.centerOf(heap.locator(".ghandle-right"));
  const target = await h.centerOf(page.locator("[data-node-id]", { hasText: "Segment Tree" }).first());
  await h.drag(handle, target, 900);
  await sleep(700);
  mark("build.end");

  const seg = page.locator("[data-node-id]", { hasText: "Segment Tree" }).first();
  await h.click(seg, { pause: 400 });
  await rect("inspect", [seg, `${win("notes")} [data-ui].w-60`], 30);
  mark("inspect");
  await h.click(page.locator(`${win("notes")} [data-ui] button`, { hasText: "High" }).first(), { pause: 500 });
  await h.click(page.locator(`${win("notes")} [data-ui] [role=switch]`).first(), { pause: 700 });
  mark("inspect.end");

  await rect("group", ['[data-node-id="n_heap"]', seg], 90);
  mark("group");
  await h.click('[data-node-id="n_heap"]', { pause: 150 });
  await page.keyboard.down("Shift");
  await h.click(seg, { pause: 150 });
  await page.keyboard.up("Shift");
  await page.keyboard.press("Control+g");
  await sleep(250);
  await h.type("Range Queries", 50);
  await page.keyboard.press("Enter");
  await sleep(1100);
  mark("group.end");
  await canvas.press("f");
  await sleep(1300);
  mark("graph.fit");
  await h.click(`${win("notes")} [data-light="zoom"]`, { pause: 700 });

  // --- floating note that follows you between windows ---
  const fab = page.locator('button[aria-label="Floating notes"]');
  mark("float");
  await h.click(fab, { pause: 350 });
  await h.click(fab.locator("xpath=..").locator("button", { hasText: "DP Cheatsheet" }).first(), { pause: 600 });
  await h.click('.floating-note button[title^="Pin"]', { pause: 400 });
  const grip = await h.centerOf('.floating-note [title="Drag to move"]');
  await h.drag(grip, { x: grip.x - 300, y: grip.y + 90 }, 700);
  await h.open("tasks", 900);
  await h.open("leetcode", 900);
  mark("float.end");
  await h.click('.floating-note button[title^="Close"]', { pause: 400 });

  // --- montage material ---
  await h.open("tasks", 700);
  await page.keyboard.press("m");
  await sleep(900);
  mark("cal.month");
  await sleep(1400);
  mark("cal.month.end");
  await page.keyboard.press("w");
  await page.keyboard.press("t");
  await sleep(400);

  await h.open("leetcode", 700);
  await rect("lc", `${win("leetcode")} .aqua-window-body`, 0);
  mark("lc");
  await h.moveTo(700, 500, 900);
  mark("lc.end");

  await h.open("reading", 800);
  await rect("library", `${win("reading")} .mc-scene`, 20);
  mark("read");
  await h.click(page.locator(`${win("reading")} .mc-book`).first(), { pause: 2400 });
  mark("read.end");
  await h.click(page.locator(`${win("reading")} button`, { hasText: "Put back" }).first(), { pause: 1500 });

  await h.open("guitar", 700);
  await rect("scales", `${win("guitar")} .card >> nth=0`, 10);
  mark("scales");
  for (let i = 0; i < 4; i += 1) await h.click(page.locator(`${win("guitar")} button`, { hasText: /^Next$/ }).first(), { ms: 250, pause: 450 });
  mark("scales.end");

  // --- dark mode ---
  mark("dark");
  await h.click('.aqua-menubar button[aria-label="Switch to dark mode"]', { pause: 1200 });
  await h.open("notes", 1000);
  await h.open("tasks", 1100);
  mark("dark.end");
  await h.click('.aqua-menubar button[aria-label="Switch to light mode"]', { pause: 600 });

  // --- the whole desktop, for the closing shot ---
  await h.click(".aqua-menubar >> text=Window", { pause: 400 });
  await h.click(page.locator(".aqua-menu-item", { hasText: "Bring All to Front" }), { pause: 400 });
  await h.open("dashboard", 800);
  await h.moveTo(1300, 760, 600);
  mark("final");
  await sleep(2000);
  mark("final.end");
}

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
  const current = new Map((await api("GET", "/leetcode/problems")).map((p) => [p.id, p]));
  for (const p of before.problems) {
    if (current.get(p.id)?.solved !== p.solved) await api("PATCH", `/leetcode/problems/${p.id}`, { solved: p.solved, solved_date: p.solved_date });
  }
}

// ---------------------------------------------------------------- main

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
const before = await snapshot();
const log = { viewport: VIEWPORT, scale: 2, frames: [], marks: {}, rects: {} };

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--force-device-scale-factor=2"] });
const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light" });
await context.addInitScript(CURSOR);
const page = await context.newPage();
await page.goto(APP, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.removeItem("yogurt.windows.v1");
  localStorage.setItem("yogurt.theme", "light");
});

const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const f = `f${String(log.frames.length).padStart(6, "0")}.jpg`;
  fs.writeFileSync(path.join(FRAMES, f), Buffer.from(data, "base64"));
  log.frames.push({ f, t: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 2880, maxHeight: 1620 });

try {
  await perform(page, helpers(page, log));
  await sleep(400);
} finally {
  await cdp.send("Page.stopScreencast").catch(() => {});
  await browser.close();
  await sleep(1500);
  await restore(before);
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(log, null, 1));
  console.log(`captured ${log.frames.length} frames, ${Object.keys(log.marks).length} marks; restored ${before.notes.length} notes`);
}
