// README screenshots of the running app (frontend on :3000, backend on :8000).
//   node screenshots.mjs        -> ../docs/screenshots/*.png
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "docs", "screenshots");
const APP = "http://localhost:3000";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const win = (id) => `[data-window="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function session(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await context.addInitScript((t) => localStorage.setItem("yogurt.theme", t), theme);
  return context.newPage();
}

async function shot(page, name) {
  await sleep(700);
  await page.mouse.move(1435, 895); // park the cursor so no hover states linger
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
}

async function open(page, route) {
  await page.goto(`${APP}${route}`, { waitUntil: "networkidle" });
  await sleep(900);
}

async function openNote(page, title) {
  await page.locator(`${win("notes")} aside button`, { hasText: title }).first().click();
  await sleep(900);
}

// every shot gets a fresh session so windows from the previous shot don't linger
async function app(name, route, theme = "light", before) {
  const page = await session(theme);
  await open(page, route);
  if (before) await before(page);
  await shot(page, name);
  await page.context().close();
}

const desktop = (ids) => async (page) => {
  for (const id of ids) {
    await page.locator(`[data-dock="${id}"]`).click();
    await sleep(800);
  }
};
const fitGraph = async (page) => {
  await openNote(page, "DSA Roadmap");
  await page.locator(`${win("notes")} .graph-canvas`).press("f");
  await sleep(800);
};

await app("desktop", "/desktop", "light", desktop(["reading", "guitar", "dashboard"]));
await app("dashboard", "/");
await app("notes", "/notes", "light", (p) => openNote(p, "Two Pointer Patterns"));
await app("graph", "/notes", "light", fitGraph);
await app("calendar", "/tasks");
await app("leetcode", "/leetcode");
await app("reading", "/reading", "light", async (p) => {
  await p.locator(`${win("reading")} .mc-book`).first().click();
  await sleep(1500);
});
await app("guitar", "/guitar");
await app("ask", "/ask", "light", async (p) => {
  await p.locator(`${win("ask")} input`).fill("Which book have I spent the most time reading?");
  await p.locator(`${win("ask")} button[type=submit]`).click();
  await p.locator(`${win("ask")} summary`, { hasText: "SQL" }).waitFor({ timeout: 120000 });
  await p.locator(`${win("ask")} summary`, { hasText: "SQL" }).click();
  await sleep(600);
});
await app("dark", "/desktop", "dark", async (p) => {
  await desktop(["dashboard", "notes"])(p);
  await openNote(p, "Two Pointer Patterns");
});

await browser.close();
