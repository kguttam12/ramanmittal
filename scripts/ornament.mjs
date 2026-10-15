#!/usr/bin/env node
/*
  Guilloche ornaments: the engraved patterns of stamp paper and certificates.
  - rosette(): the large background rosette (assets/img/guilloche.svg)
  - medallion(seed): a small, different seal for each poetry theme (made at build time)
  - seal(): the RM favicon
  Run directly to regenerate the static files:  node scripts/ornament.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const f = n => String(Math.round(n * 2) / 2);

function band({ R, amp, lobes, copies, steps = 720 }) {
  const out = [];
  for (let k = 0; k < copies; k++) {
    const ph = (2 * Math.PI * k) / (lobes * copies);
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = (2 * Math.PI * i) / steps;
      const r = R + amp * Math.sin(lobes * (t + ph));
      d += (i ? "L" : "M") + f(r * Math.cos(t)) + " " + f(r * Math.sin(t));
    }
    out.push(d + "Z");
  }
  return out;
}
function trochoid({ R, r, d, turns, steps }) {
  let p = "";
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * turns * i) / steps;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    p += (i ? "L" : "M") + f(x) + " " + f(y);
  }
  return [p];
}
function petals({ R, n, depth, copies, steps = 900 }) {
  // rose-like loops: r = R * (1 - depth * |sin(n t / 2)|), rotated copies
  const out = [];
  for (let k = 0; k < copies; k++) {
    const ph = (Math.PI * 2 * k) / (n * copies);
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = (2 * Math.PI * i) / steps;
      const r = R * (1 - depth * Math.abs(Math.sin((n * (t + ph)) / 2)));
      d += (i ? "L" : "M") + f(r * Math.cos(t)) + " " + f(r * Math.sin(t));
    }
    out.push(d + "Z");
  }
  return out;
}
const circle = r => `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`;
const svg = (vb, stroke, width, paths, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round">${paths.map(d => `<path d="${d}"/>`).join("")}${extra}</svg>\n`;

export function rosette(stroke = "#9AA3F0") {
  return svg("-520 -520 1040 1040", stroke, 1.1, [
    ...band({ R: 470, amp: 22, lobes: 36, copies: 6, steps: 900 }),
    circle(500), circle(438),
    ...band({ R: 380, amp: 34, lobes: 24, copies: 5, steps: 720 }),
    circle(338),
    ...trochoid({ R: 300, r: 300 * 7 / 32, d: 150, turns: 7, steps: 1800 }),
    circle(150),
    ...band({ R: 118, amp: 16, lobes: 16, copies: 4, steps: 360 }),
    circle(86)
  ]);
}

// A distinct seal for each theme. seed = theme position (0, 1, 2 …)
export function medallion(seed, stroke) {
  const s = seed % 8, lobes = [18, 20, 22, 24, 26, 28, 30, 32][s];
  const tr = [[7, 32], [5, 24], [9, 40], [7, 30], [11, 48], [5, 22], [9, 38], [7, 34]][s];
  const pet = [6, 8, 10, 12, 7, 9, 11, 5][s];
  return svg("-100 -100 200 200", stroke, 0.7, [
    circle(97), circle(92),
    ...band({ R: 84, amp: 5, lobes: lobes * 2, copies: 3, steps: 560 }),
    circle(76),
    ...trochoid({ R: 70, r: (70 * tr[0]) / tr[1], d: Math.min(36 + (s % 3) * 6, 73 - (70 - (70 * tr[0]) / tr[1])), turns: tr[0], steps: 1000 }),
    circle(30),
    ...petals({ R: 26, n: pet, depth: 0.55, copies: 2, steps: 480 }),
    circle(6)
  ]);
}

export function seal(bg = "#101E45", ring = "#9AA3F0", text = "#E6E8FB") {
  const rings = [...band({ R: 40, amp: 4, lobes: 18, copies: 3, steps: 360 }), circle(47), circle(33)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100"><circle r="50" fill="${bg}"/><g fill="none" stroke="${ring}" stroke-width="1.4">${rings.map(d => `<path d="${d}"/>`).join("")}</g><text x="0" y="9" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="${text}">RM</text></svg>\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  fs.writeFileSync(path.join(ROOT, "assets/img/guilloche.svg"), rosette());
  fs.writeFileSync(path.join(ROOT, "assets/img/favicon.svg"), seal());
  console.log("Wrote assets/img/guilloche.svg and assets/img/favicon.svg");
}
