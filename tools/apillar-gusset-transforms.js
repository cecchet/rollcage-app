// Computes the per-gusset transforms app.js uses (A_PILLAR_2PC_GUSSET_
// UPPER_BAR_TRANSFORMS) to move the 253-15 2-piece gussets from the
// 253-9 door bar junction they were modeled at to the pillar's junction
// with the 253-10 / NASCAR upper horizontal bar -- re-angled, not just
// slid, so each gusset's door-bar edge lies along the horizontal bar.
//
// Each gusset gets a linear map M (+ pivot) with:
//   pillar direction it was modeled along -> the upper 253-15 piece's
//     direction (the new junction is on the upper piece);
//   the modeled door-bar direction -> the 253-10 upper bar's direction;
//   the normal of the old (pillar, door bar) plane -> the new plane's.
// and the old junction point maps onto the new one. Printed as three.js
// column-major 4x4 arrays. Run:  node app/tools/apillar-gusset-transforms.js
const fs = require("fs");
const path = require("path");
const PARTS = path.join(__dirname, "..", "cage_parts");

function load(f) {
  const b = fs.readFileSync(path.join(PARTS, f));
  const n = b.readUInt32LE(80);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let j = 0; j < 3; j++) pts.push([b.readFloatLE(o + j * 12), b.readFloatLE(o + j * 12 + 4), b.readFloatLE(o + j * 12 + 8)]);
  }
  return pts;
}
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const centroid = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
// A straight tube STL is 2 end rings: split its vertices by which end
// they're nearer and return the 2 ring centers (the tube's axis ends).
function tubeEnds(f) {
  const pts = load(f);
  const c = centroid(pts);
  let far = pts[0];
  pts.forEach((p) => { if (Math.hypot(...sub(p, c)) > Math.hypot(...sub(far, c))) far = p; });
  const a = [], b = [];
  pts.forEach((p) => (Math.hypot(...sub(p, far)) < Math.hypot(...sub(p, sub(mul(c, 2), far))) ? a : b).push(p));
  const ea = centroid(a), eb = centroid(b);
  return ea[2] <= eb[2] ? [ea, eb] : [eb, ea];
}
// Closest point on line (p, d) to line (q, e) -- the "intersection" of 2
// nearly-crossing tube axes.
function closestOnFirst(p, d, q, e) {
  const w = sub(p, q), a = dot(d, d), b = dot(d, e), c = dot(e, e), dd = dot(d, w), ee = dot(e, w);
  const t = (b * ee - c * dd) / (a * c - b * b);
  return add(p, mul(d, t));
}
// 3x3 inverse (rows).
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map((r) => r.map((v) => v / det));
}
const matMul = (x, y) => x.map((r, i) => [0, 1, 2].map((j) => r[0] * y[0][j] + r[1] * y[1][j] + r[2] * y[2][j]));
const cols = (u, v, w) => [[u[0], v[0], w[0]], [u[1], v[1], w[1]], [u[2], v[2], w[2]]];

const out = {};
["left", "right"].forEach((side) => {
  const [loA, loB] = tubeEnds("253-15 " + side + " lower.stl");
  const [upA, upB] = tubeEnds("253-15 " + side + " upper.stl");
  const pLower = norm(sub(loB, loA)), pUpper = norm(sub(upB, upA));
  const bar = tubeEnds("Door bar 253-10 upper " + side + ".stl").sort((m, n) => m[0] - n[0]);
  const h = norm(sub(bar[1], bar[0])); // rearward (+x)

  const g = {};
  ["upper front", "upper rear", "lower front", "lower rear"].forEach((k) => { g[k] = centroid(load("253-15 gusset " + side + " " + k + ".stl")); });
  // The door bar the gussets were modeled around runs between the
  // midpoints of the front pair and of the rear pair (upper/lower
  // gussets straddle it).
  const frontMid = mul(add(g["upper front"], g["lower front"]), 0.5);
  const rearMid = mul(add(g["upper rear"], g["lower rear"]), 0.5);
  const d = norm(sub(rearMid, frontMid)); // rearward
  const jOld = closestOnFirst(loB, pLower, frontMid, d);
  const jNew = closestOnFirst(upA, pUpper, bar[0], h);

  const nNew = norm(cross(pUpper, h));
  ["upper front", "upper rear", "lower front", "lower rear"].forEach((k) => {
    const pOld = k.indexOf("upper") === 0 ? pUpper : pLower;
    const nOld = norm(cross(pOld, d));
    const m = matMul(cols(pUpper, h, nNew), inv3(cols(pOld, d, nOld)));
    // v' = jNew + M (v - jOld)  =>  translation = jNew - M jOld
    const mj = m.map((r) => dot(r, jOld));
    const t = sub(jNew, mj);
    const r4 = (v) => +v.toFixed(5);
    out["253-15 gusset " + side + " " + k + ".stl"] = [
      m[0][0], m[1][0], m[2][0], 0,
      m[0][1], m[1][1], m[2][1], 0,
      m[0][2], m[1][2], m[2][2], 0,
      t[0], t[1], t[2], 1,
    ].map(r4);
  });
  console.error(side, "jOld", jOld.map((v) => v.toFixed(2)).join(","), "jNew", jNew.map((v) => v.toFixed(2)).join(","),
    "angle old/new", (Math.acos(dot(pLower, d)) * 180 / Math.PI).toFixed(1), (Math.acos(dot(pUpper, h)) * 180 / Math.PI).toFixed(1));
});
console.log(JSON.stringify(out, null, 2));
