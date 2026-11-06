// The manual's wide-screen shot (46-wide), after screenshots.mjs:
//   node driver.mjs screenshots-wide.mjs 1800 1000
// The RS4 Rally car sample on Part 2, the 3D model and Part 8 on the right.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (re) => `{ const b = [...document.querySelectorAll('button, a.btn')].find(b => ${re}.test(b.textContent.trim()) && b.offsetParent); if (!b) throw new Error('no button ' + ${JSON.stringify(String(re))}); b.click(); }`;

export default async function (a) {
  await a.go("http://localhost:5003/");
  await a.eval(`${wait(500)} const exit = [...document.querySelectorAll('button')].find(b => /Exit the tutorial/.test(b.textContent)); if (exit) exit.click();
    ${wait(500)} if (!document.getElementById('library-dialog')) ${click("/^Rollcage library$/")} ${wait(3000)}
    [...document.querySelectorAll('.library-section-sample .load-dialog-card')].find(c => /RS4 Rally car/.test(c.textContent)).click(); ${wait(500)}
    ${click("/^Start from template$/")} ${wait(3500)}
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /^Part 1/.test(o.text)));
    sel.value = [...sel.options].find(o => o.text.startsWith('Part 2 ')).value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    ${wait(2500)} window.scrollTo(0, 0); ${wait(500)}`);
  await a.shot("46-wide");
}
