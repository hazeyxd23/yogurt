// Minecraft-style 16x16 sprites, drawn pixel by pixel (structured patterns, not random
// noise) onto a canvas once and cached as data URLs. Shown scaled with
// `image-rendering: pixelated`.

export const BOOK_COLORS = ["#a12722", "#2f4fa8", "#4c7a1e", "#b8941c", "#1e7f7f", "#5f3a8f", "#7a4a20", "#a8326e"];

export function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const c = (shift) => Math.round(((n >> shift) & 255) + (target - ((n >> shift) & 255)) * t);
  return `#${[c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Deterministic per-pixel jitter (a hash, so every render looks identical).
const jitter = (x, y, seed = 1) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function paint(w, h, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const px = (x, y, color) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  draw(px);
  return canvas.toDataURL();
}

/** Paint from a character map: each character picks a colour from `palette` ("." = transparent). */
function fromMap(rows, palette) {
  return paint(rows[0].length, rows.length, (px) => rows.forEach((row, y) => [...row].forEach((ch, x) => px(x, y, palette[ch]))));
}

// ---------------------------------------------------------------- blocks

function planks(px, ox = 0, oy = 0, rows = 16) {
  const tones = ["#c29d62", "#b48f58", "#a8854f", "#b99560"];
  const seams = [9, 3, 12, 6]; // vertical joint per plank, staggered like the real texture
  for (let y = 0; y < rows; y += 1) {
    const plank = Math.floor(y / 4);
    for (let x = 0; x < 16; x += 1) {
      let c = tones[(x + plank * 3 + (y % 4 === 1 ? 1 : 0)) % tones.length];
      if (jitter(x, y, 7) < 0.12) c = "#9e7d4a"; // grain flecks
      if (y % 4 === 0 && jitter(x, y, 3) < 0.35) c = "#c9a76e"; // top edge highlight
      if (y % 4 === 3) c = "#7a5d34"; // plank shadow line
      if (x === seams[plank % 4] && y % 4 !== 3) c = "#86663a";
      px(ox + x, oy + y, c);
    }
  }
}

const SPINES = [
  ["#a12722", 2], ["#2f4fa8", 1], ["#4c7a1e", 2], [null, 1], ["#b8941c", 1], ["#1e7f7f", 2],
  ["#5f3a8f", 1], ["#7a4a20", 2], ["#a8326e", 1], ["#2f4fa8", 1], ["#4c7a1e", 1],
];

function bookRow(px, top, height, offset) {
  let x = 1;
  let i = offset;
  while (x < 15) {
    const [color, w] = SPINES[i % SPINES.length];
    i += 1;
    for (let dx = 0; dx < w && x < 15; dx += 1, x += 1) {
      for (let y = 0; y < height; y += 1) {
        if (!color) {
          px(x, top + y, y < height - 1 ? "#2c1d0e" : "#3a2814"); // gap between books
          continue;
        }
        const short = (i % 3 === 0 && y === 0); // some books are a pixel shorter
        let c = color;
        if (short) c = "#2c1d0e";
        else if (y === 0 || (y === 1 && i % 3 === 0)) c = "#efe6cc"; // page tops
        else if (y === 2 && i % 2 === 0) c = "#d8b543"; // gold band
        else if (dx === 0 && w === 2) c = shadeHex(color, 0.22); // lit edge
        else if (dx === w - 1) c = shadeHex(color, -0.28); // shadowed edge
        px(x, top + y, c);
      }
    }
  }
}

const PAINTERS = {
  planks: () => paint(16, 16, (px) => planks(px)),

  // Classic bookshelf: plank frame with two rows of spines.
  bookshelf: () =>
    paint(16, 16, (px) => {
      planks(px);
      for (let y = 1; y < 15; y += 1) {
        px(0, y, "#7a5d34");
        px(15, y, "#6b5030");
      }
      bookRow(px, 1, 6, 0);
      bookRow(px, 9, 6, 5);
      for (let x = 0; x < 16; x += 1) {
        px(x, 7, "#a8854f");
        px(x, 8, "#7a5d34");
        px(x, 15, "#7a5d34");
      }
    }),

  bricks: () =>
    paint(16, 16, (px) => {
      const bases = ["#9a4f3c", "#8e4636", "#a65a45", "#8a4435"];
      for (let y = 0; y < 16; y += 1) {
        const row = Math.floor(y / 4);
        const off = row % 2 ? 4 : 0;
        for (let x = 0; x < 16; x += 1) {
          const ly = y % 4;
          const lx = (x + off) % 8;
          if (ly === 3 || lx === 7) {
            px(x, y, jitter(x, y, 5) < 0.5 ? "#b9ab9b" : "#a99b8b"); // mortar
            continue;
          }
          const brick = Math.floor((x + off) / 8) + row * 3;
          let c = bases[brick % bases.length];
          if (ly === 0 || lx === 0) c = shadeHex(c, 0.16);
          else if (ly === 2 || lx === 6) c = shadeHex(c, -0.14);
          if (jitter(x, y, 9) < 0.1) c = shadeHex(c, -0.2);
          px(x, y, c);
        }
      }
    }),

  // Cyan wool carpet: a woven look from alternating diagonal threads.
  carpet: () =>
    paint(16, 16, (px) => {
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          let c = "#16929a";
          if ((x + y) % 4 === 0) c = "#1ca7ad";
          else if ((x - y + 16) % 4 === 0) c = "#127b83";
          else if ((x + 2 * y) % 7 === 0) c = "#1a9ea4";
          if (jitter(x, y, 11) < 0.08) c = "#0f6f77";
          px(x, y, c);
        }
      }
    }),

  // Enchanting table, top face: red cloth, diamond corners, obsidian rim.
  tableTop: () =>
    paint(16, 16, (px) => {
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const corner = (x < 4 || x > 11) && (y < 4 || y > 11);
          const rim = x === 0 || y === 0 || x === 15 || y === 15;
          let c;
          if (corner) {
            const cx = x < 4 ? x : 15 - x;
            const cy = y < 4 ? y : 15 - y;
            c = cx + cy <= 1 ? "#d9fcff" : cx === 3 || cy === 3 ? "#1f9aa0" : (cx + cy) % 2 ? "#5decf5" : "#3fd2db";
          } else if (rim) {
            c = jitter(x, y, 2) < 0.3 ? "#2c1f44" : "#140f20";
          } else {
            const d = (x + y) % 4 === 0 || (x - y + 16) % 4 === 0;
            c = d ? "#7c1424" : "#a81d32";
            if (x === 1 || y === 1 || x === 14 || y === 14) c = "#5e0f1b";
            if ((x === 7 || x === 8) && (y === 7 || y === 8)) c = "#c6283f";
          }
          px(x, y, c);
        }
      }
    }),

  // Enchanting table, front face: cloth draped over obsidian, diamond corners.
  tableSide: () =>
    paint(16, 12, (px) => {
      for (let y = 0; y < 12; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          let c;
          if (y < 4 && (x < 3 || x > 12)) {
            const cx = x < 3 ? x : 15 - x;
            c = y === 0 ? "#d9fcff" : cx === 2 || y === 3 ? "#1f9aa0" : (cx + y) % 2 ? "#5decf5" : "#3fd2db";
          } else if (y < 3 || (y === 3 && x > 2 && x < 13) || (y < 6 && x > 5 && x < 10 && !(y === 5 && (x === 6 || x === 9)))) {
            c = y === 0 ? "#c6283f" : (x + y) % 3 === 0 ? "#7c1424" : "#a81d32";
            if (y === 3 || (y === 5 && x > 6 && x < 9)) c = "#5e0f1b";
          } else {
            const vein = (x * 2 + y * 3) % 11 === 0 || (x * 3 - y + 33) % 13 === 0;
            c = vein ? "#3b2a5e" : jitter(x, y, 4) < 0.5 ? "#140f20" : "#1b1429";
            if (vein && jitter(x, y, 8) < 0.3) c = "#5a3f8a";
          }
          px(x, y, c);
        }
      }
    }),

  // The enchanting table's own book, floating open.
  openBook: () =>
    fromMap(
      [
        "....................",
        "..wwwwwww..wwwwwww..",
        ".wpppppppw wpppppppw",
        ".wplllllpwwwplllllpw",
        ".wpppppppwwwpppppppw",
        ".wplllllpwwwplllllpw",
        ".wpppppppwwwpppppppw",
        ".wplllpppwwwpllllppw",
        "cwpppppppwwwpppppppw",
        "ccwwwwwwwwwwwwwwwwcc",
        ".ccccccccccccccccccc",
        "..dddddddddddddddd..",
      ].map((r) => r.replace(" ", "w")),
      { w: "#d6c9a3", p: "#f4ecd5", l: "#a39270", c: "#8a4a20", d: "#5a2d10" }
    ),

  // Closed brown book (idle on the table).
  closedBook: () =>
    fromMap(
      [
        "..cccccccccccc..",
        ".cCCCCCCCCCCCCc.",
        ".cCggggggggggCcp",
        ".cCgCCCCCCCCgCcp",
        ".cCgCyyyyyyCgCcp",
        ".cCgCCCCCCCCgCcp",
        ".cCgCCCCCCCCgCcp",
        ".cCgCyyyyyyCgCcp",
        ".cCgCCCCCCCCgCcp",
        ".cCggggggggggCcp",
        ".cCCCCCCCCCCCCcp",
        "..ccccccccccccpp",
      ],
      { c: "#4a250e", C: "#7a4320", g: "#d8b543", y: "#a3812a", p: "#efe6cc" }
    ),
};

const cache = {};

/** Data URL for a named texture (planks, bookshelf, bricks, carpet, tableTop, tableSide, openBook, closedBook). */
export function texture(name) {
  if (!cache[name]) cache[name] = PAINTERS[name]();
  return cache[name];
}

/** Background style for a tiled texture shown at `size` px per 16 texture pixels. */
export function tiled(name, size = 48) {
  return { backgroundImage: `url(${texture(name)})`, backgroundSize: `${size}px ${size}px`, imageRendering: "pixelated" };
}

/** A book spine sprite in the given colour (8x12), for chiseled-shelf slots. */
export function bookSprite(color) {
  const key = `spine-${color}`;
  if (!cache[key]) {
    cache[key] = fromMap(
      [
        "........",
        ".pppppp.",
        ".hmmmmd.",
        ".hggggd.",
        ".hmmmmd.",
        ".hmMmmd.",
        ".hmMmmd.",
        ".hmmmmd.",
        ".hggggd.",
        ".hmmmmd.",
        ".hmmmmd.",
        ".dddddd.",
      ],
      { p: "#efe6cc", h: shadeHex(color, 0.25), m: color, M: shadeHex(color, 0.1), d: shadeHex(color, -0.35), g: "#d8b543" }
    );
  }
  return cache[key];
}

/** Leather cover for the open book on the table (16x20), in the book's colour. */
export function coverSprite(color) {
  const key = `cover-${color}`;
  if (!cache[key]) {
    cache[key] = paint(16, 20, (px) => {
      for (let y = 0; y < 20; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          let c = jitter(x, y, 6) < 0.2 ? shadeHex(color, -0.08) : color;
          if (x < 2) c = shadeHex(color, -0.4); // spine
          else if (x === 2) c = shadeHex(color, -0.2);
          if (y === 0 || x === 15 || y === 19) c = shadeHex(color, -0.3);
          const corner = (x >= 13 && (y <= 2 || y >= 17)) || (x >= 3 && x <= 4 && (y <= 2 || y >= 17));
          if (corner) c = (x + y) % 2 ? "#e9c95a" : "#b8941c";
          if ((y === 6 || y === 13) && x > 4 && x < 13) c = "#d8b543";
          px(x, y, c);
        }
      }
    });
  }
  return cache[key];
}
