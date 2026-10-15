// Drives the Aqua desktop with a real mouse and checks the window manager.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const shot = (name) => path.join(HERE, "output", "shots", `${name}.png`);
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const windows = () =>
  page.$$eval("[data-window]", (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.window, hidden: el.classList.contains("hidden"), active: el.classList.contains("is-active"), z: el.style.zIndex, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    })
  );
const out = {};

// open Notes and Calendar from the Dock
await page.click('[data-dock="notes"]');
await page.waitForTimeout(900);
await page.click('[data-dock="tasks"]');
await page.waitForTimeout(900);
out.afterOpen = { url: page.url(), windows: await windows() };

// drag the Calendar window by its title bar
const bar = page.locator('[data-window="tasks"] header.aqua-titlebar');
const b = await bar.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + 15);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2 + 120, b.y + 90, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
out.afterDrag = (await windows()).find((w) => w.id === "tasks");

// click into the Notes window -> it comes to the front and the URL follows
await page.mouse.click(1380, 300);
await page.waitForTimeout(500);
out.afterFocusNotes = { url: page.url(), front: (await windows()).find((w) => w.active)?.id };

// minimise Notes into the Dock
await page.click('[data-window="notes"] [data-light="minimize"]');
await page.waitForTimeout(900);
out.afterMinimize = { url: page.url(), notes: (await windows()).find((w) => w.id === "notes") };
await page.screenshot({ path: shot("desk-minimized") });

// restore from the Dock
await page.click('[data-dock="notes"]');
await page.waitForTimeout(900);
out.afterRestore = (await windows()).find((w) => w.id === "notes");

// bring Calendar forward from the Dock, zoom it, then close it
await page.click('[data-dock="tasks"]');
await page.waitForTimeout(500);
out.afterDockFocus = { url: page.url(), front: (await windows()).find((w) => w.active)?.id };
await page.click('[data-window="tasks"] [data-light="zoom"]');
await page.waitForTimeout(700);
out.afterZoom = (await windows()).find((w) => w.id === "tasks");
await page.screenshot({ path: shot("desk-zoomed") });
await page.click('[data-window="tasks"] [data-light="close"]');
await page.waitForTimeout(600);
out.afterClose = { url: page.url(), windows: (await windows()).map((w) => w.id) };

// menu bar: Window menu lists open windows
await page.click(".aqua-menubar >> text=Window");
await page.waitForTimeout(300);
out.windowMenu = await page.$$eval(".aqua-menu .aqua-menu-item", (els) => els.map((e) => e.textContent.trim()));
await page.screenshot({ path: shot("desk-menu") });

console.log(JSON.stringify(out, null, 1));
if (errors.length) console.log("errors:\n" + errors.join("\n"));
await browser.close();
