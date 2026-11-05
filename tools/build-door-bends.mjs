// Builds the 3D parts of 253-9's "2 bend bars" door bars (cage_parts/):
// each side's upper and lower bar, bent once (a V) or twice (a flat
// stretch between 2 bends) (2020 FIA 253 Ch.8.3.2.1.2).
//   node tools/build-door-bends.mjs
// Then bump CAGE_PARTS_VERSION in cage_view.js. The one-piece gusset
// between the bars is drawn by cage_view.js, at the size entered, from
// these bars' centerlines (tools/build-gussets.mjs, which imports this).
//
// The bars run between the same 4 points as the straight 253-9 X bars
// ("Left door bar 1/2-  253-9.stl", their Z_FIXUPS baked in): front lateral
// top/bottom to main rollbar top/bottom. The model's units are ~10mm;
// D = 5 (the door bars' diameter). x: front to rear, y: left to right, z: up.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "cage_parts");
export const D = 5;
const R = D / 2;
const GAP = 0.5 * D; // between the 2 bars where they come closest (max D)
const BEND_RADIUS = 3 * D;
export const SIDES = {
  left: { fu: [87.6, 88.0, 47.94], ru: [209.9, 84.4, 48.77], fl: [87.2, 87.8, 10.57], rl: [206.5, 84.2, 10.24] },
  right: { fu: [87.6, 222.3, 47.94], ru: [209.9, 226.0, 48.77], fl: [87.2, 222.6, 10.57], rl: [206.5, 226.1, 10.24] },
};
// Where the bends are (x): in Zone A, 300mm behind the front lateral (x 87)
// and 200mm ahead of the main rollbar (x 208).
export const BENDS = { 1: [150], 2: [129, 171] };
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const len = (a) => Math.hypot(...a);
const norm = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// A bar's centerline: its end points and bend points, each bend rounded
// to BEND_RADIUS.
export function centerline(front, rear, bendXs, z) {
  const at = (x) => { const t = (x - front[0]) / (rear[0] - front[0]); return [x, front[1] + (rear[1] - front[1]) * t, z]; };
  const pts = [front, ...bendXs.map(at), rear];
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = norm(sub(pts[i - 1], pts[i])), b = norm(sub(pts[i + 1], pts[i]));
    const half = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / 2;
    const cut = Math.min(BEND_RADIUS / Math.tan(half), 0.45 * len(sub(pts[i - 1], pts[i])), 0.45 * len(sub(pts[i + 1], pts[i])));
    const p0 = add(pts[i], mul(a, cut)), p1 = add(pts[i], mul(b, cut));
    // A quadratic curve from p0 to p1 through the corner: close to the arc.
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      out.push(add(add(mul(p0, (1 - t) * (1 - t)), mul(pts[i], 2 * t * (1 - t))), mul(p1, t * t)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// A 12-sided tube along a centerline, closed at both ends.
function tube(line) {
  const tris = [], S = 12, rings = [];
  line.forEach((p, i) => {
    const t = norm(sub(line[Math.min(i + 1, line.length - 1)], line[Math.max(i - 1, 0)]));
    const n1 = norm(cross([0, 1, 0], t)), n2 = cross(t, n1);
    rings.push(Array.from({ length: S }, (_, k) => {
      const a = (2 * Math.PI * k) / S;
      return add(p, add(mul(n1, R * Math.cos(a)), mul(n2, R * Math.sin(a))));
    }));
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < S; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % S], c = rings[i + 1][k], d = rings[i + 1][(k + 1) % S];
      tris.push([a, c, b], [b, c, d]);
    }
  }
  const capped = (ring, center, flip) => ring.forEach((p, k) => tris.push(flip ? [center, ring[(k + 1) % S], p] : [center, p, ring[(k + 1) % S]]));
  capped(rings[0], line[0], false);
  capped(rings[rings.length - 1], line[line.length - 1], true);
  return tris;
}

function writeStl(name, tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write("Frog Racing rollcage -- " + name, 0, "ascii");
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    const n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])).map((v) => v || 0)) || [0, 0, 0];
    [n, ...t].forEach((v, k) => v.forEach((c, m) => buf.writeFloatLE(isFinite(c) ? c : 0, o + k * 12 + m * 4)));
  });
  writeFileSync(join(OUT, name), buf);
  console.log("wrote", name, tris.length, "triangles");
}

// Each side's upper and lower bar centerlines, 1 or 2 bends, and the
// door plane's normal.
export function doorBendBars() {
  const out = {};
  for (const [side, p] of Object.entries(SIDES)) {
    const zc = (p.fu[2] + p.ru[2] + p.fl[2] + p.rl[2]) / 4;
    const zUp = zc + (D + GAP) / 2, zLo = zc - (D + GAP) / 2;
    out[side] = { normal: norm(cross(sub(p.ru, p.fu), sub(p.fu, p.fl))) };
    for (const n of [1, 2]) out[side][n] = { upper: centerline(p.fu, p.ru, BENDS[n], zUp), lower: centerline(p.fl, p.rl, BENDS[n], zLo), bends: BENDS[n] };
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bars = doorBendBars();
  for (const side of Object.keys(SIDES)) {
    const cap = side === "left" ? "Left" : "Right";
    for (const n of [1, 2]) {
      const tag = n === 1 ? "1 bend" : "2 bends";
      writeStl(cap + " door bar upper 253-9 " + tag + ".stl", tube(bars[side][n].upper));
      writeStl(cap + " door bar lower 253-9 " + tag + ".stl", tube(bars[side][n].lower));
    }
  }
}
