// Draws images/roof_corner_gussets.png, the "Roof corner gussets" card's
// picture: the 3D model with a 253-3 base structure as ghost bars and the 4
// roof corner gussets in their 3D color, from the app served at
// http://localhost:5003:
//   node tools/manual/driver.mjs tools/roof-corner-gussets-image.mjs 1280 900
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const W = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const BTN = `const btn = (re) => [...document.querySelectorAll('button, a.btn')].find(b => re.test(b.textContent.trim()) && b.offsetParent);`;

export default async function (a) {
  await a.go("http://localhost:5003/");
  await a.eval(`${W(800)} ${BTN} const exit = btn(/Exit the tutorial/); if (exit) exit.click(); ${W(500)}
    if (!document.getElementById('library-dialog')) { btn(/^Rollcage library$/).click(); ${W(2500)} }
    btn(/Start a new rollcage/).click(); ${W(2500)}
    const d = btn(/^Discard$/); if (d) { d.click(); ${W(2000)} }
    // Only the 253-3 base (ghost) and the 4 roof corner gussets (single
    // plate blue, as Part 2 draws them); everything else hidden.
    const base = ["Main rollbar.stl", "Front left lateral.stl", "Front right lateral.stl", "Transverse member.stl", "Left backstay.stl", "Right backstay.stl",
      "Foot front left.stl", "Foot front right.stl", "Foot main rollbar left.stl", "Foot main rollbar right.stl", "Foot rear left.stl", "Foot rear right.stl"];
    const gussets = ["front left", "front right", "rear left", "rear right"].map((p) => "Roof corner gusset " + p + ".stl");
    const colors = {};
    CageView.getAllFiles().forEach((f) => { if (!base.includes(f)) colors[f] = "hidden"; });
    gussets.forEach((f) => { colors[f] = "#2563eb"; });
    CageView.applyState(colors, true); ${W(1500)}
    // The viewer's own buttons and badges hidden; the shot framed on the
    // cage (a box over the middle of the canvas).
    const c = document.querySelector('#cage-viewer-panel canvas'); c.scrollIntoView(); ${W(300)}
    [...document.querySelectorAll('#cage-viewer-panel *')].forEach((e) => { if (e !== c && !e.contains(c)) e.style.visibility = 'hidden'; });
    const r = c.getBoundingClientRect();
    const box = document.createElement('div'); box.id = 'shot-model';
    Object.assign(box.style, { position: 'absolute', left: (r.left + scrollX + r.width * 0.24) + 'px', top: (r.top + scrollY + r.height * 0.17) + 'px', width: (r.width * 0.46) + 'px', height: (r.height * 0.79) + 'px', pointerEvents: 'none' });
    document.body.appendChild(box); ${W(500)}`);
  await a.shot("roof-corner-gussets", "#shot-model", 0);
  copyFileSync(join(here, "manual", "out", "roof-corner-gussets.png"), join(here, "..", "images", "roof_corner_gussets.png"));
  a.log("wrote images/roof_corner_gussets.png");
}
