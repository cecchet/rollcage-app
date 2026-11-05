// Builds gusset_data.js: where each junction gusset of the 3D model sits,
// worked out from the tubes it joins (cage_parts/), so cage_view.js can
// draw every gusset itself -- at the size entered in Part 4, and against
// whichever door bar design is in place -- instead of shipping a fixed STL
// per gusset.
//   node tools/build-gussets.mjs
// Re-run after changing any tube in cage_parts/ (or tools/build-door-
// bends.mjs), then bump gusset_data.js's ?v= in index.html.
//
// A plate gusset ("plates") is given by its junction P (where the 2 tube
// axes meet), the 2 tube branches it spans (unit vectors u, v away from P)
// and the tubes' radius r; cage_view.js builds a triangle in the tubes'
// plane from the inner corner between them, its legs along each tube.
// Gussets at the 253-15 / door bar junction depend on the door bar there,
// so they carry one entry per door bar variant:
//   x      -- 253-9's X (the bar from the front lateral's top)
//   upper  -- 253-10 / NASCAR's top rail
//   bent1, bent2 -- 253-9's 2 bend bars' upper bar, 1 or 2 bends per bar
// The 2-piece 253-15 itself is drawn the same way ("pieces"): from its
// foot F to where it meets that door bar J, and on to its top T, so its
// split always lands on the door bar actually there.
// "side" gussets (a continuous 253-15 passing beside the door bar) bridge
// the 2 tubes instead: P15/d15 the 253-15 axis point nearest the door bar
// and its direction, PD the door bar's axis point nearest it.
// "bend" holds 253-9's bend bars' centerlines, for the one-piece gusset
// between them. "scaled": the A/B-pillar gussets (CAD parts with holes,
// welded to the car's body on one side) are only resized -- about the
// middle of their weld along the tube.
// Units: the model's (about 10mm); x front to rear, y left to right, z up.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doorBendBars } from "./build-door-bends.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARTS = join(APP, "cage_parts");
const viewSrc = readFileSync(join(APP, "cage_view.js"), "utf8");
const Z_FIXUPS = eval("(" + viewSrc.match(/const Z_FIXUPS = (\{[\s\S]*?\});/)[1] + ")");

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(...a);
const norm = (a) => mul(a, 1 / len(a));
const round = (a) => a.map((v) => Math.round(v * 1000) / 1000);

function load(f) {
  const b = readFileSync(join(PARTS, f));
  const n = b.readUInt32LE(80), dz = Z_FIXUPS[f] || 0, seen = new Map();
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const p = [b.readFloatLE(o + k * 12), b.readFloatLE(o + k * 12 + 4), b.readFloatLE(o + k * 12 + 8) + dz];
      seen.set(p.map((v) => v.toFixed(2)).join(","), p);
    }
  }
  return [...seen.values()];
}
// A straight tube's axis (principal direction through its vertices) and
// radius.
function tubeLine(f) {
  const pts = load(f);
  const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  pts.forEach((p) => { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; });
  let d = [1, 0.3, 0.2];
  for (let it = 0; it < 80; it++) d = norm([dot(C[0], d), dot(C[1], d), dot(C[2], d)]);
  let r = 0;
  pts.forEach((p) => { const w = sub(p, c); r = Math.max(r, len(sub(w, mul(d, dot(w, d))))); });
  return { a: c, d, r, file: f };
}
// The points of 2 lines (a, d) nearest each other.
function nearest(L1, L2) {
  const w = sub(L1.a, L2.a), A = dot(L1.d, L1.d), B = dot(L1.d, L2.d), C = dot(L2.d, L2.d), D = dot(L1.d, w), E = dot(L2.d, w);
  const den = A * C - B * B, s = (B * E - C * D) / den, t = (A * E - B * D) / den;
  const P1 = add(L1.a, mul(L1.d, s)), P2 = add(L2.a, mul(L2.d, t));
  return { P1, P2, P: mul(add(P1, P2), 0.5), gap: len(sub(P1, P2)) };
}
const HINT = { left: [0, -1, 0], right: [0, 1, 0], upper: [0, 0, 1], lower: [0, 0, -1], front: [-1, 0, 0], rear: [1, 0, 0] };
// The plate between 2 crossing tubes in the angle facing `towards`.
function xPlate(A, B, towards) {
  const { P, gap } = nearest(A, B);
  if (gap > 0.6) throw new Error(A.file + " / " + B.file + " don't meet (" + gap.toFixed(2) + ")");
  let best = null;
  for (const sa of [1, -1]) for (const sb of [1, -1]) {
    const u = mul(A.d, sa), v = mul(B.d, sb), score = dot(norm(add(u, v)), towards);
    if (!best || score > best.score) best = { score, u, v };
  }
  return { P: round(P), u: round(best.u), v: round(best.v), r: round([Math.max(A.r, B.r)])[0] };
}
// The plate at J between the branch J->to and a door bar's branch picked
// by a direction hint.
function piecePlate(J, to, door, hint, r) {
  const v = dot(door.d, hint) >= 0 ? door.d : mul(door.d, -1);
  return { P: round(J), u: round(norm(sub(to, J))), v: round(v), r };
}

const out = { plates: {}, pieces: {}, side: {}, bend: {}, scaled: {} };
const xSet = (prefix, fileA, fileB, positions, suffix = ".stl") => {
  const A = tubeLine(fileA), B = tubeLine(fileB);
  positions.forEach((pos) => { out.plates[prefix + pos + suffix] = { x: xPlate(A, B, HINT[pos]) }; });
};
xSet("253-7 gusset ", "Main diagonal  1-  253-7.stl", "Main diagonal  2-  253-7.stl", ["left", "right", "upper", "lower"]);
xSet("Roof bars gusset ", "Roof bar 1.stl", "Roof bar 2.stl", ["left", "right", "front", "rear"]);
xSet("Rear backstay gusset ", "Rear diagonal 1.stl", "Rear diagonal 2.stl", ["left", "right", "upper", "lower"]);
xSet("253-19 gusset ", "253-19 left.stl", "253-19 right.stl", ["left", "right", "front", "rear"]);

const bends = doorBendBars();
["left", "right"].forEach((side) => {
  const cap = side === "left" ? "Left" : "Right";
  const bar1 = tubeLine(cap + " door bar 1-  253-9.stl"), bar2 = tubeLine(cap + " door bar 2-  253-9.stl");
  ["front", "rear"].forEach((pos) => { out.plates["Door bar gusset " + pos + " " + side + ".stl"] = { x: xPlate(bar1, bar2, HINT[pos]) }; });
  ["upper", "lower"].forEach((pos) => { out.plates["Door bar gusset " + pos + " " + side + ".virtual"] = { x: xPlate(bar1, bar2, HINT[pos]) }; });

  // The door bar crossing 253-15, per door bar variant.
  const lower15 = tubeLine("253-15 " + side + " lower.stl"), upper15 = tubeLine("253-15 " + side + " upper.stl");
  const xBar = [bar1, bar2].sort((a, b) => nearest(a, lower15).gap - nearest(b, lower15).gap)[0];
  const bentLine = (n) => {
    const c = bends[side][n].upper; // its first stretch: front lateral to the (front) bend
    return { a: c[0], d: norm(sub(c[1], c[0])), r: 2.5, file: cap + " door bar upper 253-9 " + n };
  };
  const doorBars = { x: xBar, upper: tubeLine("Door bar 253-10 upper " + side + ".stl"), bent1: bentLine(1), bent2: bentLine(2) };
  // The 2-piece 253-15's foot and top (the far ends of its 2 modeled
  // pieces), and where it meets each door bar: the door bar's axis point
  // nearest the foot-to-top line.
  const ends = (L) => { const ts = load(L.file).map((p) => dot(sub(p, L.a), L.d)); return [add(L.a, mul(L.d, Math.min(...ts))), add(L.a, mul(L.d, Math.max(...ts)))]; };
  const [F] = ends(lower15).sort((a, b) => a[2] - b[2]);
  const T = ends(upper15).sort((a, b) => b[2] - a[2])[0];
  const ft = { a: F, d: norm(sub(T, F)), file: "253-15 " + side + " foot-to-top" };
  out.pieces[side] = {};
  Object.entries(doorBars).forEach(([variant, door]) => {
    const J = nearest(ft, door).P2;
    out.pieces[side][variant] = { F: round(F), J: round(J), T: round(T), r: round([Math.max(lower15.r, upper15.r)])[0] };
    ["upper", "lower"].forEach((ul) => ["front", "rear"].forEach((fr) => {
      const key = "253-15 gusset " + side + " " + ul + " " + fr + ".stl";
      out.plates[key] = out.plates[key] || {};
      out.plates[key][variant] = piecePlate(J, ul === "upper" ? T : F, door, HINT[fr], Math.max(door.r, lower15.r));
    }));
  });
  const cont = tubeLine("253-15 " + cap + ".stl");
  const key = "253-15 side gusset " + side + ".stl";
  out.side[key] = {};
  Object.entries(doorBars).forEach(([variant, door]) => {
    const { P1, P2 } = nearest(cont, door);
    const d15 = cont.d[2] >= 0 ? cont.d : mul(cont.d, -1);
    out.side[key][variant] = { P15: round(P1), d15: round(d15), PD: round(P2), r: round([cont.r])[0], rD: round([door.r])[0] };
  });

  out.bend[side] = { normal: round(bends[side].normal) };
  [1, 2].forEach((n) => {
    out.bend[side][n] = { upper: bends[side][n].upper.map(round), lower: bends[side][n].lower.map(round), bends: bends[side][n].bends };
  });
});

// A/B-pillar gussets: resized about the middle of their weld along the
// tube (the vertices touching its surface).
[["A-pillar gusset left.stl", "Front left lateral.stl"], ["A-pillar gusset right.stl", "Front right lateral.stl"],
  ["B-pillar gusset left.stl", "Main rollbar.stl"], ["B-pillar gusset right.stl", "Main rollbar.stl"]].forEach(([g, tube]) => {
  const tubePts = load(tube), gPts = load(g);
  const touching = gPts.filter((p) => tubePts.some((q) => len(sub(p, q)) < 1.5));
  const anchor = mul((touching.length ? touching : gPts).reduce((s, p) => add(s, p), [0, 0, 0]), 1 / (touching.length || gPts.length));
  out.scaled[g] = { anchor: round(anchor) };
});

writeFileSync(join(APP, "gusset_data.js"),
  "// GENERATED by tools/build-gussets.mjs -- where each junction gusset sits in\n" +
  "// the 3D model (see that script). Don't edit by hand.\n" +
  "window.CAGE_GUSSET_DATA = " + JSON.stringify(out) + ";\n");
console.log("wrote gusset_data.js:", Object.keys(out.plates).length, "plates,", Object.keys(out.side).length, "side,", Object.keys(out.scaled).length, "scaled");
