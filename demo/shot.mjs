// Quick screenshots of the running app for checking the UI.
//   node shot.mjs <name> [path] [--size=1440x900] [--js="code to run before the shot"]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args[0] || "shot";
const route = args.find((a, i) => i > 0 && !a.startsWith("--")) || "/";
const size = (args.find((a) => a.startsWith("--size="))?.slice(7) || "1440x900").split("x").map(Number);
const js = args.find((a) => a.startsWith("--js="))?.slice(5);
const wait = Number(args.find((a) => a.startsWith("--wait="))?.slice(7) || 1500);

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, colorScheme: args.includes("--dark") ? "dark" : "light" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);
if (js) {
  await page.evaluate(`(async () => { ${js} })()`);
  await page.waitForTimeout(wait);
}
fs.mkdirSync(path.join(HERE, "output", "shots"), { recursive: true });
const file = path.join(HERE, "output", "shots", `${name}.png`);
await page.screenshot({ path: file });
await browser.close();
console.log(file);
if (errors.length) console.log("errors:\n" + errors.slice(0, 8).join("\n"));
