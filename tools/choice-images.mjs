// Draws the 3D-model pictures of 2 choice cards, from the app served at
// http://localhost:5003:
//   node tools/manual/driver.mjs tools/choice-images.mjs 1280 900
// - images/253-15_<option>.png, "Windscreen pillar (A-pillar) reinforcement
//   253-15": a 253-3 base structure and 253-9 door bars as ghost bars and
//   that choice's 253-15 bars in their 3D color, seen from the front left.
// - images/harness_bar_<option>.png, "Harness bar": a 253-3 base structure
//   as ghost bars and that choice's harness bar, seen from the rear left.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const W = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const BTN = `const btn = (re) => [...document.querySelectorAll('button, a.btn')].find(b => re.test(b.textContent.trim()) && b.offsetParent);`;

const BASE = ["Main rollbar.stl", "Front left lateral.stl", "Front right lateral.stl", "Transverse member.stl", "Left backstay.stl", "Right backstay.stl",
  "Foot front left.stl", "Foot front right.stl", "Foot main rollbar left.stl", "Foot main rollbar right.stl", "Foot rear left.stl", "Foot rear right.stl"];
const DOORS = ["Left door bar 1-  253-9.stl", "Left door bar 2-  253-9.stl", "Right door bar 1-  253-9.stl", "Right door bar 2-  253-9.stl"];
const ONE = { left: ["253-15 Left.stl"], right: ["253-15 Right.stl"] };
const TWO = { left: ["253-15 left lower.stl", "253-15 left upper.stl"], right: ["253-15 right lower.stl", "253-15 right upper.stl"] };

const FRONT = [-2.0, 1.2], REAR = [-1.0, 1.15], SIDE = [-1.2, 1.2];
const side = (l, r) => ({ left: [l], right: [r], both: [l, r], none: [] });

// An X's 2 half bars, each in its own color (the continuous tube in the
// bar's own), so the continuous one stands out.
const HALF_COLORS = ["#ffffff", "#22c55e"];
const REAR0 = [0, 1.45], REAR_HIGH = [0, 1.0], TOP = [Math.PI / 4, Math.PI / 4] /* the viewer's own default angle: the front reads at a glance */, LEFT_SIDE = [-Math.PI / 2, 1.45], RIGHT_SIDE = [Math.PI / 2, 1.45];
const MAIN_DIAG_TR = "Main diagonal  1-  253-7.stl", MAIN_DIAG_TL = "Main diagonal  2-  253-7.stl", MAIN_DIAG = [MAIN_DIAG_TR, MAIN_DIAG_TL];
const REAR_DIAG = ["Rear diagonal 1.stl", "Rear diagonal 2.stl"], ROOF_X = ["Roof bar 1.stl", "Roof bar 2.stl"], X19 = ["253-19 left.stl", "253-19 right.stl"];

// The door bar designs of one side, seen from that side: each with and
// without a sill bar (the card's 2 groups), and "none".
function doorSet(side) {
  const cap = side === "left" ? "Left" : "Right";
  const sill = "Sill bar " + cap + ".stl";
  const x1 = cap + " door bar 1-  253-9.stl", x2 = cap + " door bar 2-  253-9.stl";
  const leg = side === "left" ? "Left door bar 2-  253-9.stl" : "Right door bar 1-  253-9.stl";
  const bent = (n) => [cap + " door bar upper 253-9 " + n + ".stl", cap + " door bar lower 253-9 " + n + ".stl"];
  const designs = {
    // Config 1: the tube from the bottom front (the 253-11 leg) continuous.
    "253-9-intersection-1": { files: [x1, x2], gaps: { [leg === x1 ? x2 : x1]: leg }, halfGap: 10 },
    "253-9-intersection-2": { files: [x1, x2], gaps: { [leg]: leg === x1 ? x2 : x1 }, halfGap: 10 },
    "253-9-bent": bent("1 bend"),
    "253-9-bent-2": bent("2 bends"),
    "253-10": ["Door bar 253-10 upper " + side + ".stl", "Door bar 253-10 front " + side + ".stl", "Door bar 253-10 rear " + side + ".stl"],
  };
  const options = {};
  Object.entries(designs).forEach(([id, d]) => {
    if (Array.isArray(d)) { options[id] = d; options[id + "-sill"] = d.concat([sill]); return; }
    options[id] = d;
    options[id + "-sill"] = Object.assign({}, d, { files: d.files.concat([sill]) });
  });
  options["253-11"] = [sill, leg];
  options.nascar = ["Door bar 253-10 upper " + side + ".stl", "Nascar " + side + " 1.stl", "Nascar " + side + " 2.stl", sill];
  options["single-bar"] = [leg];
  options.none = [];
  return { prefix: "door-" + side + "_", ghost: BASE, color: "#bcbd22", orbit: side === "left" ? LEFT_SIDE : RIGHT_SIDE, options };
}

// One set per card: its ghost bars, its bars' 3D color, the view, and the
// bars of each choice (a yes/no card: "yes" and "no").
const SETS = [
  {
    prefix: "253-15_", ghost: BASE.concat(DOORS), color: "#ffdd00", orbit: [Math.PI, 1.35], // straight from the front: the 2-bar side's kink shows
    options: {
      continuous: ONE.left.concat(ONE.right),
      two_bars: TWO.left.concat(TWO.right),
      mixed_left_two: TWO.left.concat(ONE.right),
      mixed_right_two: ONE.left.concat(TWO.right),
      none: [],
    },
  },
  {
    prefix: "harness_bar_", ghost: BASE, color: "#c9a227", orbit: REAR,
    options: { "253-26-27": ["253-26,27 harness bar.stl"], "253-28-66": ["253-28,66 rear harness bar.stl"], none: [] },
  },
  { prefix: "253-30_", ghost: BASE, color: "#8ecae6", orbit: REAR, options: { yes: ["253-30 lower main hoop bar.stl"], no: [] } },
  {
    prefix: "253-17_", ghost: BASE.concat(DOORS), color: "#4dd0e1", orbit: SIDE,
    options: {
      upper: ["253-17 left upper.stl", "253-17 right upper.stl"],
      lower: ["253-17 left lower.stl", "253-17 right lower.stl"],
      both: ["253-17 left upper.stl", "253-17 right upper.stl", "253-17 left lower.stl", "253-17 right lower.stl"],
      none: [],
    },
  },
  { prefix: "253-18_", ghost: BASE, color: "#ff5252", orbit: REAR, options: { yes: ["253-18.stl"], no: [] } },
  {
    prefix: "253-25_", ghost: BASE.concat(DOORS), color: "#ff9e4a", orbit: SIDE,
    options: { yes: ["253-25 upper left.stl", "253-25 upper right.stl", "253-25 lower left.stl", "253-25 lower right.stl"], no: [] },
  },
  { prefix: "253-29_", ghost: BASE, color: "#7986cb", orbit: FRONT, options: { yes: ["Dash bar 253-29.stl"], no: [] } },
  { prefix: "253-31-temple_", ghost: BASE, color: "#5ec9a3", orbit: [-2.47, 1.625] /* the view picked in the 3D model */, options: side("253-31 temple bar left.stl", "253-31 temple bar right.stl") },
  {
    prefix: "253-31-windshield_", ghost: BASE.concat(ONE.left, ONE.right), color: "#ef6ba0", orbit: [Math.PI, 0.6], // from the front and above
    options: side("253-31 windshield left.stl", "253-31 windshield right.stl"),
  },

  // ---- Main rollbar diagonals, seen from the rear ----
  {
    prefix: "main-diag_", ghost: BASE, color: "#e377c2", orbit: REAR0,
    options: {
      "253-7-1": { files: MAIN_DIAG, gaps: { [MAIN_DIAG_TL]: MAIN_DIAG_TR } },
      "253-7-2": { files: MAIN_DIAG, gaps: { [MAIN_DIAG_TR]: MAIN_DIAG_TL } },
      "diag-left": [MAIN_DIAG_TL],
      "diag-right": [MAIN_DIAG_TR],
      "diag-horizontal": ["253-26,27 harness bar.stl"],
      "diag-lower-half": ["Main rollbar lower half left.stl", "Main rollbar lower half right.stl"],
      "diag-v-center": ["Main rollbar V left.stl", "Main rollbar V right.stl"],
      none: [],
    },
  },
  // ---- Backstay diagonals, seen from the rear and above ----
  {
    prefix: "backstay-diag_", ghost: BASE, color: "#17becf", orbit: REAR_HIGH,
    options: {
      "253-20": ["Rear diagonal 1.stl"],
      "253-20-right": ["Rear diagonal 2.stl"],
      "253-21-1": { files: REAR_DIAG, gaps: { "Rear diagonal 2.stl": "Rear diagonal 1.stl" } },
      "253-21-2": { files: REAR_DIAG, gaps: { "Rear diagonal 1.stl": "Rear diagonal 2.stl" } },
      "253-22": ["Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl"],
      none: [],
    },
  },
  // ---- Roof bars, seen from behind and above, turned a little ----
  {
    prefix: "roof_", ghost: BASE, color: "#ff7f0e", orbit: TOP,
    options: {
      "253-12-1": { files: ROOF_X, gaps: { "Roof bar 2.stl": "Roof bar 1.stl" } },
      "253-12-2": { files: ROOF_X, gaps: { "Roof bar 1.stl": "Roof bar 2.stl" } },
      "253-13": ["Roof bar 253-13 left.stl", "Roof bar 253-13 right.stl"],
      "253-14": ["Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl"],
      "single-center": ["Roof bar single center.stl"],
      "single-front-left": ["Roof bar 1.stl"],
      "single-front-right": ["Roof bar 2.stl"],
      none: [],
    },
  },
  // ---- Rear lower X 253-19 (on the floor behind the main rollbar), seen from behind and above ----
  {
    prefix: "253-19_", ghost: BASE, color: "#b565d8", orbit: [0, 0.5],
    options: {
      "253-19-1": { files: X19, gaps: { "253-19 right.stl": "253-19 left.stl" }, halfGap: 14 }, // a shallow X: a longer gap to show past the continuous tube
      "253-19-2": { files: X19, gaps: { "253-19 left.stl": "253-19 right.stl" }, halfGap: 14 },
      none: [],
    },
  },
  doorSet("left"),
  doorSet("right"),
];

// The model drawn at 2x, cropped to the bars showing (ghost or colored)
// plus a margin, on a fixed 560x400 frame: every picture the same size, the
// cage filling it whatever the view.
const GRAB = `const url = CageView.viewImage();
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; });
  const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
  const sx = src.getContext('2d'); sx.drawImage(img, 0, 0);
  const px = sx.getImageData(0, 0, src.width, src.height).data;
  const bg = [px[0], px[1], px[2]];
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 0; y < src.height; y += 2) for (let x = 0; x < src.width; x += 2) {
    const o = (y * src.width + x) * 4;
    if (Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]) > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const OW = 560, OH = 400, m = 0.06;
  let w = (x1 - x0) * (1 + 2 * m), h = (y1 - y0) * (1 + 2 * m);
  if (w / h > OW / OH) h = w * OH / OW; else w = h * OW / OH;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const ox = out.getContext('2d'); ox.fillStyle = 'rgb(' + bg.join(',') + ')'; ox.fillRect(0, 0, OW, OH);
  ox.drawImage(src, cx - w / 2, cy - h / 2, w, h, 0, 0, OW, OH);
  return out.toDataURL('image/png').split(',')[1];`;

export default async function (a) {
  await a.go("http://localhost:5003/");
  await a.eval(`${W(800)} ${BTN} const exit = btn(/Exit the tutorial/); if (exit) exit.click(); ${W(500)}
    if (!document.getElementById('library-dialog')) { btn(/^Rollcage library$/).click(); ${W(2500)} }
    btn(/Start a new rollcage/).click(); ${W(2500)}
    const d = btn(/^Discard$/); if (d) { d.click(); ${W(2000)} }
    // No watermark logo drawn into the pictures.
    const logo = document.querySelector('.cage-viewer-watermark'); if (logo) logo.classList.remove('cage-viewer-watermark');
    document.querySelector('#cage-viewer-panel canvas').scrollIntoView(); ${W(300)}`);
  // ONLY=<prefix>[,<prefix>...] redraws just those cards' pictures.
  for (const set of SETS.filter((s) => !process.env.ONLY || process.env.ONLY.split(",").includes(s.prefix))) {
    await a.eval(`CageView.setOrbit(${set.orbit[0]}, ${set.orbit[1]}, 0); ${W(500)}`);
    for (const [id, opt] of Object.entries(set.options)) {
      // An option: its bars, or { files, gaps } for an X with 1 continuous
      // bar (its half bars cut short where they cross it, see CageView.setGaps).
      const files = Array.isArray(opt) ? opt : opt.files;
      // Only the ghost bars and this choice's own bars; everything else hidden.
      await a.eval(`const ghost = ${JSON.stringify(set.ghost)};
        const colors = {};
        CageView.getAllFiles().forEach((f) => { if (!ghost.includes(f)) colors[f] = "hidden"; });
        ${JSON.stringify(files)}.forEach((f) => { colors[f] = ${JSON.stringify(set.color)}; });
        CageView.applyState(colors, true); ${W(1500)}
        // After applyState: a part only loads once it's shown.
        CageView.setGaps(${JSON.stringify(Array.isArray(opt) ? {} : opt.gaps)}, ${(!Array.isArray(opt) && opt.halfGap) || 5}, ${JSON.stringify(HALF_COLORS)}); ${W(300)}`);
      const name = set.prefix + id;
      writeFileSync(join(here, "..", "images", name + ".png"), Buffer.from(await a.eval(GRAB), "base64"));
      a.log("wrote images/" + name + ".png");
    }
  }
  // New pictures under the same names: diagrams.js's IMG_V and its own
  // ?v= in index.html bumped, so browsers don't keep showing cached ones.
  const app = join(here, "..");
  const diagrams = readFileSync(join(app, "diagrams.js"), "utf8");
  writeFileSync(join(app, "diagrams.js"), diagrams.replace(/const IMG_V = (\d+);/, (m, n) => "const IMG_V = " + (+n + 1) + ";"));
  const index = readFileSync(join(app, "index.html"), "utf8");
  writeFileSync(join(app, "index.html"), index.replace(/diagrams\.js\?v=(\d+)/, (m, n) => "diagrams.js?v=" + (+n + 1)));
  a.log("bumped diagrams.js IMG_V and its ?v=");
}
