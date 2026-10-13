// Makes images/walkaround.gif -- the little looping "walk-around video" shown
// beside the video picker in Pictures: the RS4 sample's 3D cage turning a
// full circle, with a blinking red recording dot. Run with the app served at
// http://localhost:5003:   node driver.mjs walkaround-gif.mjs 1280 900
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;

export default async function (a) {
  await a.go("http://localhost:5003/");
  // The RS4 sample, ghost bars and occupants hidden: just its cage.
  await a.eval(`${wait(500)}
    const exit = [...document.querySelectorAll('button')].find(b => /Exit the tutorial/.test(b.textContent)); if (exit) exit.click(); ${wait(300)}
    if (!document.getElementById('library-dialog')) [...document.querySelectorAll('button')].find(b => /^Rollcage library$/.test(b.textContent.trim())).click();
    for (let i = 0; i < 20 && !document.querySelector('.load-dialog-card'); i++) { ${wait(300)} }
    [...document.querySelectorAll('.library-section-sample .load-dialog-card')].find(c => /RS4 Rally car/.test(c.textContent)).click(); ${wait(400)}
    [...document.querySelectorAll('button')].find(b => /^Start from template$/.test(b.textContent.trim()) && b.offsetParent).click(); ${wait(3500)}
    for (const label of ['Ghost bars', 'Occupants']) { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === label); if (b) b.click(); ${wait(400)} }
    window.scrollTo(0, 0); ${wait(500)}`);
  const b64 = await a.eval(`
    const W = 192, H = 144, N = 24;
    const src = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0];
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d', { willReadFrequently: true });
    // A 4:3 crop of the middle of the viewer.
    const ch = src.height * 0.92, cw = ch * 4 / 3, cx = (src.width - cw) / 2, cy = (src.height - ch) / 2;
    const frames = [];
    for (let i = 0; i < N; i++) {
      CageView.setOrbit(Math.PI / 4 + 2 * Math.PI * i / N, Math.PI / 3.2, 0);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.drawImage(src, cx, cy, cw, ch, 0, 0, W, H);
      // The recording dot, on for half a second, off for the next.
      if (Math.floor(i / 4) % 2 === 0) { g.fillStyle = '#e53935'; g.beginPath(); g.arc(14, 14, 6, 0, 2 * Math.PI); g.fill(); }
      frames.push(g.getImageData(0, 0, W, H).data);
    }
    CageView.resetView();
    // Palette: a 6x7x6 colour cube (252 colours) + 4 greys.
    const pal = [];
    for (let r = 0; r < 6; r++) for (let gg = 0; gg < 7; gg++) for (let b = 0; b < 6; b++) pal.push([Math.round(r * 51), Math.round(gg * 42.5), Math.round(b * 51)]);
    [[27, 30, 34], [60, 64, 70], [120, 124, 130], [200, 204, 210]].forEach(c => pal.push(c));
    const cache = new Map();
    const nearest = (r, gg, b) => {
      const k = (r >> 2) << 12 | (gg >> 2) << 6 | (b >> 2);
      if (cache.has(k)) return cache.get(k);
      let best = 0, bd = 1e9;
      for (let i = 0; i < pal.length; i++) { const p = pal[i]; const d = (p[0] - r) ** 2 + (p[1] - gg) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
      cache.set(k, best); return best;
    };
    // GIF89a writer (LZW, 8-bit codes).
    const bytes = [];
    const put = (...xs) => xs.forEach(x => bytes.push(x & 255));
    const word = (v) => put(v, v >> 8);
    const str = (s) => [...s].forEach(c => put(c.charCodeAt(0)));
    str('GIF89a'); word(W); word(H); put(0xF7, 0, 0);
    for (let i = 0; i < 256; i++) { const p = pal[i] || [0, 0, 0]; put(p[0], p[1], p[2]); }
    put(0x21, 0xFF, 11); str('NETSCAPE2.0'); put(3, 1); word(0); put(0); // loop forever
    const lzw = (idx) => {
      const minCode = 8, clear = 256, eoi = 257;
      let size = 9, next = 258, dict = new Map(), cur = 0, nbits = 0;
      const outB = [];
      const emit = (code) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { outB.push(cur & 255); cur >>>= 8; nbits -= 8; } };
      emit(clear);
      let prefix = idx[0];
      for (let i = 1; i < idx.length; i++) {
        const c = idx[i], key = prefix * 256 + c;
        if (dict.has(key)) { prefix = dict.get(key); continue; }
        emit(prefix);
        if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
        else { emit(clear); dict = new Map(); next = 258; size = 9; }
        prefix = c;
      }
      emit(prefix); emit(eoi);
      if (nbits > 0) outB.push(cur & 255);
      return outB;
    };
    for (const data of frames) {
      const idx = new Uint8Array(W * H);
      for (let p = 0, q = 0; p < idx.length; p++, q += 4) idx[p] = nearest(data[q], data[q + 1], data[q + 2]);
      put(0x21, 0xF9, 4, 0x04); word(12); put(0, 0); // 120 ms a frame
      put(0x2C); word(0); word(0); word(W); word(H); put(0);
      put(8);
      const enc = lzw(idx);
      for (let i = 0; i < enc.length; i += 255) { const chunk = enc.slice(i, i + 255); put(chunk.length); chunk.forEach(x => put(x)); }
      put(0);
    }
    put(0x3B);
    let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
    return btoa(s);`);
  const file = join(here, "..", "..", "images", "walkaround.gif");
  writeFileSync(file, Buffer.from(b64, "base64"));
  a.log("Wrote", file, Buffer.from(b64, "base64").length, "bytes");
}
