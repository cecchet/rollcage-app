// Draws the "Base structure layout" choice pictures from the app served at
// http://localhost:5003 -- each layout picked on a new rollcage, the live 3D
// model in its own colors, without the occupants or ghost bars, all from the
// same angle:
//   node tools/manual/driver.mjs tools/base-layout-images.mjs 1280 900
// - images/base_structure_<253-1|253-2|253-3|half_rollcage>.png
// (ORBIT=<theta>,<phi> tries another angle.)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const W = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const BTN = `const btn = (re) => [...document.querySelectorAll('button, a.btn')].find(b => re.test(b.textContent.trim()) && b.offsetParent);`;
const ORBIT = process.env.ORBIT ? process.env.ORBIT.split(",").map(Number) : [1.2, 1.1]; // from the right, slightly behind (as the first pictures)
const LAYOUTS = [["253-1", "253-1"], ["253-2", "253-2"], ["253-3", "253-3"], ["half-rollcage", "half_rollcage"]];

// The same crop as tools/choice-images.mjs: the bars showing plus a margin, on a 560x400 frame.
const GRAB = readFileSync(join(here, "choice-images.mjs"), "utf8").match(/const GRAB = `([\s\S]*?)`;/)[1];

export default async function (a) {
  await a.go("http://localhost:5003/");
  await a.sleep(3000);
  // (Each layout on a new rollcage: once picked, the choice card closes.)
  for (const [id, name] of LAYOUTS) {
  await a.eval(`${BTN} const exit = btn(/Exit the tutorial/); if (exit) exit.click(); ${W(500)}
    if (!document.getElementById('library-dialog')) { btn(/^Rollcage library$/).click(); ${W(2500)} }
    btn(/Start a new rollcage/).click(); ${W(2500)}
    const d = btn(/^Discard$/); if (d) { d.click(); ${W(2000)} }
    const logo = document.querySelector('.cage-viewer-watermark'); if (logo) logo.classList.remove('cage-viewer-watermark');
    // Part 2, the design: where the layout is picked.
    const part = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /^Part 2/.test(o.text)));
    part.value = [...part.options].find(o => /^Part 2/.test(o.text)).value; part.dispatchEvent(new Event('change', { bubbles: true })); ${W(2000)}
    document.querySelector('#cage-viewer-panel canvas').scrollIntoView(); ${W(300)}`);
    await a.eval(`const radios = [...document.querySelectorAll('input[type=radio][name=main_structure_layout]')];
      const r = radios[${LAYOUTS.findIndex(([x]) => x === id)}]; if (!r) throw new Error('no radio for ${id}');
      r.click(); ${W(2000)}
      // No occupants, no ghost bars: just the layout's own bars.
      for (const t of ['cageViewerGhostToggle', 'cageViewerDriverToggle']) { const b = document.getElementById(t); if (b && b.getAttribute('aria-pressed') === 'true') { b.click(); ${W(800)} } }
      CageView.setOrbit(${ORBIT[0]}, ${ORBIT[1]}, 0); ${W(800)}`);
    writeFileSync(join(here, "..", "images", "base_structure_" + name + ".png"), Buffer.from(await a.eval(GRAB), "base64"));
    a.log("wrote images/base_structure_" + name + ".png");
  }
  // New pictures under the same names: diagrams.js's IMG_V and its ?v= in index.html bumped.
  const app = join(here, "..");
  const diagrams = readFileSync(join(app, "diagrams.js"), "utf8");
  writeFileSync(join(app, "diagrams.js"), diagrams.replace(/const IMG_V = (\d+);/, (m, n) => "const IMG_V = " + (+n + 1) + ";"));
  const index = readFileSync(join(app, "index.html"), "utf8");
  writeFileSync(join(app, "index.html"), index.replace(/diagrams\.js\?v=(\d+)/, (m, n) => "diagrams.js?v=" + (+n + 1)));
  a.log("bumped diagrams.js IMG_V and its ?v=");
}
