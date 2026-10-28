// The user manual's screenshots, taken in headless Chrome from the app
// served at http://localhost:5003 (the RS4 Rally car sample):
//   rm -r profile out; node driver.mjs screenshots.mjs 1280 900
// (A fresh profile: the library starts empty, as on a first visit.) Then
// build the web page (published by GitHub Pages from docs/) from the manual
// doc's markdown export:
//   node build-html.mjs <manual.md> ../../docs/rollcage-user-manual.html
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (re, scope = "document") => `{ const b = [...${scope}.querySelectorAll('button, a.btn')].find(b => ${re}.test(b.textContent.trim()) && b.offsetParent); if (!b) throw new Error('no button ' + ${JSON.stringify(String(re))}); b.click(); }`;
const pickPart = (n) => `
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /^Part 1/.test(o.text)));
  sel.value = [...sel.options].find(o => o.text.startsWith('Part ${n} ')).value; sel.dispatchEvent(new Event('change', { bubbles: true }));
  ${wait(1200)} window.scrollTo(0, 0); ${wait(300)}`;
// Marks an element (found by the expression) with an id, for a clipped shot.
const unstick = `[...document.querySelectorAll('body *')].forEach(x => { if (getComputedStyle(x).position === 'sticky') x.style.setProperty('position', 'static', 'important'); });`;
const mark = (expr, id) => `{ ${unstick} document.getElementById('${id}')?.removeAttribute('id'); const e = ${expr}; if (!e) throw new Error('no element for ${id}'); e.id = '${id}'; e.scrollIntoView({ block: 'start' }); } ${wait(400)}`;

export default async function (a) {
  await a.go("http://localhost:5003/");
  // The library, as on a first visit (the tutorial closed), then the RS4 sample selected.
  await a.eval(`${wait(500)} const exit = [...document.querySelectorAll('button')].find(b => /Exit the tutorial/.test(b.textContent)); if (exit) exit.click();
    ${wait(500)} if (!document.getElementById('library-dialog')) ${click("/^Rollcage library$/")} ${wait(3000)}`);
  await a.shot("01-library");
  await a.eval(`[...document.querySelectorAll('.library-section-sample .load-dialog-card')].find(c => /RS4 Rally car/.test(c.textContent)).click(); ${wait(500)}
    document.querySelector('.load-dialog-card.selected').scrollIntoView({ block: 'center' }); ${wait(800)}`);
  await a.shot("02-library-samples");
  await a.eval(`${click("/^Start from template$/")} ${wait(3500)}`);

  // The main screen, on Part 1.
  await a.eval(pickPart(1));
  await a.shot("03-main");
  // Part 1: the vehicle, then the pictures (a card opened).
  await a.shot("11-part1-vehicle", "#app > .panel", 8, 1250);
  await a.eval(mark(`document.querySelectorAll('#app > .panel')[1]`, "shot-picpanel"));
  await a.shot("12a-part1-pictures", "#shot-picpanel", 8, 1250);
  const doorCat = `[...document.querySelectorAll('.picture-category-heading')].find(h => /Door bars — Right/.test(h.textContent)).parentElement`;
  await a.eval(`${doorCat}.querySelector('img.picture-card-photo').click(); ${wait(800)}`);
  await a.eval(mark(`${doorCat}.querySelector('.picture-card:not(.picture-card-collapsed)')`, "shot-pics"));
  await a.shot("12-part1-picture-card", "#shot-pics", 8, 1250);
  await a.eval(mark(`[...document.querySelectorAll('.picture-category-heading')].find(h => /Overview/.test(h.textContent)).parentElement`, "shot-overview"));
  await a.shot("13-part1-overview-pictures", "#shot-overview", 8, 700);

  // Part 2: the panel, and one card opened (base structure, with its diagrams).
  await a.eval(pickPart(2));
  await a.shot("21-part2", "#app > .panel", 8, 1000);
  await a.eval(`document.querySelector('#section-main_structure_layout .element-head, #section-main_structure_layout .collapsed-head').click(); ${wait(800)}`);
  await a.eval(mark(`document.getElementById('section-main_structure_layout')`, "shot-card"));
  await a.shot("22-part2-card", "#shot-card", 8, 1200);

  for (const n of [3, 4, 5, 6]) {
    await a.eval(pickPart(n));
    await a.shot("3" + n + "-part" + n, "#app > .panel", 8, 1100);
  }
  // Part 3: a tubing card opened.
  await a.eval(pickPart(3));
  await a.eval(`const h = document.querySelector('#section-primary_tubing .collapsed-head'); if (h) h.click(); ${wait(700)}`);
  await a.eval(mark(`document.getElementById('section-primary_tubing')`, "shot-tubing"));
  await a.shot("33b-part3-tubing", "#shot-tubing", 8, 900);

  // Part 7 with ARA picked.
  await a.eval(pickPart(7));
  await a.eval(`const b = [...document.querySelectorAll('#compliance-panel button')].find(b => /Show details/.test(b.textContent)); if (b) b.click(); ${wait(800)}`);
  await a.shot("37a-part7-none", "#app > .panel", 8, 700);
  await a.eval(`const sel = [...document.querySelectorAll('#compliance-panel select')].find(s => [...s.options].some(o => o.value === 'ara'));
    sel.value = 'ara'; sel.dispatchEvent(new Event('change', { bubbles: true })); ${wait(1000)} window.scrollTo(0, 0); ${wait(300)}`);
  await a.shot("37-part7", "#app > .panel", 8, 1300);
  // Part 8.
  await a.eval(pickPart(8));
  await a.shot("38-part8", "#app > .panel", 8, 1300);

  // The session bar with unsaved changes.
  await a.eval(`window.scrollTo(0, 0); ${wait(300)}`);
  await a.shot("40-session-bar", ".session-bar", 10);
  // The library: currently editing, then Save.
  await a.eval(`${click("/^Rollcage library$/")} ${wait(2500)}`);
  await a.eval(mark(`document.querySelector('.library-section-current')`, "shot-current"));
  await a.shot("41-library-current", "#shot-current", 8);
  await a.eval(`${click("/^Save$/", "document.getElementById('library-current')")} ${wait(1500)}`);
  await a.eval(`[...document.querySelectorAll('.library-section-saved .load-dialog-card')][0].click(); ${wait(1500)}`);
  await a.eval(mark(`document.querySelector('.library-section-saved')`, "shot-saved"));
  await a.shot("42-library-saved", "#shot-saved", 8);
  // Its 3D print dialog.
  await a.eval(`${click("/^3D print$/", "document.querySelector('.library-section-saved')")} ${wait(2500)}`);
  await a.shot("45-print", ".confirm-dialog", 10);
  await a.eval(`${click("/^Cancel$/", "document.querySelector('.confirm-dialog')")} ${wait(500)}`);
  // Save as.
  await a.eval(`${click("/^Save as/", "document.querySelector('#library-current')")} ${wait(600)}`);
  await a.shot("43-save-as", ".confirm-dialog", 10);
  await a.eval(`${click("/^Cancel$/", "document.querySelector('.confirm-dialog')")} ${wait(500)} ${click("/^Back to editing$/", "document.querySelector('#library-current')")} ${wait(800)}`);
  // Unsaved changes prompt: change something, then start a new rollcage.
  await a.eval(`const i = document.getElementById('rollcageNameInput'); i.value = 'RS4 Rally car -- Froooog (copy)'; i.dispatchEvent(new Event('input', { bubbles: true })); ${wait(300)}
    ${click("/^Rollcage library$/")} ${wait(1500)} ${click("/^Start a new rollcage$/")} ${wait(600)}`);
  await a.shot("44-unsaved", ".confirm-dialog", 10);
}
