// Photos on a laptop. A phone's "take a photo" opens its camera, but a laptop's
// browser just opens a file picker -- so on a laptop (a fine pointer, no touch
// screen), clicking any photo picker (an <input type="file" accept="image/...">)
// opens a chooser instead:
//   - Use my phone: a QR code; photos taken on the phone (photo-drop.html, next
//     to this file) come back to the laptop through the photo drop relay (the
//     photo_drop_* database functions -- a two-hour, unguessable session);
//   - Laptop camera: a live view from any camera the computer has (built in,
//     USB, or a phone set up as a wireless webcam), with a camera picker;
//   - Choose a file: the usual picker.
// The photos taken are handed to the picker itself (its files, then its
// input/change events), so the page handles them as if they'd been chosen --
// nothing else needs to know. Shared by the rollcage app, Digital logbooks and
// PassTech (which copies this file and photo-drop.html into its public folder).
// window.PHOTO_RELAY = { url, key } overrides the relay (a Supabase project and
// its public anon key); window.PhotoCapture.open(input) opens the chooser.
(function () {
  if (window.PhotoCapture) return;
  const RELAY = Object.assign({
    url: "https://opltqtjxrzlgucrgznft.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHRxdGp4cnpsZ3Vjcmd6bmZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNjk0NTAsImV4cCI6MjEwNjc0NTQ1MH0.zp9-mI7BUpjIltkZLa707tayiQ-9SvdOomYONU36wPI",
  }, window.PHOTO_RELAY || {});
  const QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  // This script's own folder: photo-drop.html sits next to it.
  const HERE = (document.currentScript && document.currentScript.src) || document.baseURI;

  // A laptop or desktop: a mouse or trackpad and no touch screen as the main pointer.
  const isDesktop = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isPhotoInput = (t) => t instanceof HTMLInputElement && t.type === "file" && /image/.test(t.accept || "") && !t.disabled;

  async function rpc(fn, args) {
    const r = await fetch(RELAY.url + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: RELAY.key, authorization: "Bearer " + RELAY.key },
      body: JSON.stringify(args || {}),
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error((data && (data.message || data.hint)) || "HTTP " + r.status);
    return data;
  }
  let qrLoading = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = QR_LIB; s.crossOrigin = "anonymous";
        s.onload = () => resolve(window.qrcode);
        s.onerror = () => { qrLoading = null; reject(new Error("couldn't load the QR code maker")); };
        document.head.appendChild(s);
      });
    }
    return qrLoading;
  }
  async function dataUrlToFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || "image/jpeg", lastModified: Date.now() });
  }
  // Hands the photos to the page's own picker, as if they'd been chosen there.
  function deliver(input, files) {
    if (!files.length) return;
    const dt = new DataTransfer();
    (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---- The chooser ----------------------------------------------------------
  const CSS = `
.pc-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.pc-box { --pc-bg: #fff; --pc-ink: #1d2329; --pc-muted: #5f6b76; --pc-line: #d6dce1; --pc-accent: #1f5fbf; --pc-soft: #eef3fa;
  background: var(--pc-bg); color: var(--pc-ink); border-radius: 12px; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto;
  box-shadow: 0 12px 40px rgba(0,0,0,.35); font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px 18px; }
@media (prefers-color-scheme: dark) { .pc-box { --pc-bg: #1c2127; --pc-ink: #e8edf2; --pc-muted: #9aa7b3; --pc-line: #36404a; --pc-accent: #6ea8ff; --pc-soft: #253041; } }
.pc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
.pc-head h2 { font-size: 1.1rem; margin: 0; }
.pc-x { border: none; background: none; color: var(--pc-muted); font-size: 1.4rem; cursor: pointer; line-height: 1; }
.pc-choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 520px) { .pc-choices { grid-template-columns: 1fr; } }
.pc-choice { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; border: 1px solid var(--pc-line); border-radius: 10px;
  background: var(--pc-bg); color: var(--pc-ink); font: inherit; cursor: pointer; text-align: center; }
.pc-choice:hover, .pc-choice.on { border-color: var(--pc-accent); background: var(--pc-soft); }
.pc-choice b { font-size: .95rem; } .pc-choice span { font-size: .78rem; color: var(--pc-muted); } .pc-choice i { font-style: normal; font-size: 1.6rem; }
.pc-pane { margin-top: 12px; }
.pc-qr { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.pc-qr-img { width: 200px; height: 200px; background: #fff; padding: 8px; border-radius: 8px; box-sizing: border-box; flex: none; }
.pc-qr-img svg, .pc-qr-img img { width: 100%; height: 100%; display: block; }
.pc-note { color: var(--pc-muted); font-size: .85rem; margin: 6px 0; }
.pc-link { font-size: .75rem; word-break: break-all; color: var(--pc-muted); }
.pc-err { color: #c0392b; font-size: .9rem; margin: 6px 0; }
.pc-video { width: 100%; max-height: 50vh; background: #000; border-radius: 8px; display: block; }
.pc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.pc-row select { flex: 1; min-width: 160px; font: inherit; padding: 6px; border-radius: 6px; border: 1px solid var(--pc-line); background: var(--pc-bg); color: var(--pc-ink); }
.pc-btn { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--pc-accent); background: var(--pc-accent); color: #fff; cursor: pointer; font-weight: 600; }
.pc-btn.secondary { background: none; color: var(--pc-accent); }
.pc-btn:disabled { opacity: .5; cursor: default; }
.pc-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pc-thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid var(--pc-line); }
.pc-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; border-top: 1px solid var(--pc-line); padding-top: 10px; }`;
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    });
    (children || []).flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : String(c)); });
    return n;
  }

  let open = null; // the chooser showing: { close }
  let bypass = null; // the input being let through to its own file picker
  function openChooser(input) {
    if (open) open.close();
    if (!document.getElementById("pc-style")) document.head.appendChild(el("style", { id: "pc-style" }, [CSS]));
    const multiple = input.multiple;
    const taken = []; // { file, url }
    let mode = null, stopMode = () => {};
    const pane = el("div", { class: "pc-pane" });
    const thumbs = el("div", { class: "pc-thumbs" });
    const useBtn = el("button", { type: "button", class: "pc-btn", disabled: true, onclick: () => finish() }, ["Use the photos"]);
    const choice = (id, icon, title, sub, fn) => el("button", { type: "button", class: "pc-choice", "data-mode": id, onclick: fn }, [el("i", {}, [icon]), el("b", {}, [title]), el("span", {}, [sub])]);
    const choices = el("div", { class: "pc-choices" }, [
      choice("phone", "📱", "Use my phone", "Scan a QR code, take the photo on the phone", () => setMode("phone")),
      choice("camera", "💻", "Laptop camera", "Webcam, USB camera, or a phone as a webcam", () => setMode("camera")),
      choice("file", "📁", "Choose a file", "A photo already on this computer", () => { close(); bypass = input; input.click(); bypass = null; }),
    ]);
    const box = el("div", { class: "pc-box", role: "dialog", "aria-modal": "true", "aria-label": "Add a photo" }, [
      el("div", { class: "pc-head" }, [el("h2", {}, [multiple ? "Add photos" : "Add a photo"]), el("button", { type: "button", class: "pc-x", "aria-label": "Close", onclick: () => close() }, ["×"])]),
      choices, pane, thumbs,
      el("div", { class: "pc-foot" }, [el("button", { type: "button", class: "pc-btn secondary", onclick: () => close() }, ["Cancel"]), multiple ? useBtn : null]),
    ]);
    const overlay = el("div", { class: "pc-overlay", onclick: (e) => { if (e.target === overlay) close(); } }, [box]);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);

    function add(file) {
      const url = URL.createObjectURL(file);
      taken.push({ file, url });
      thumbs.append(el("img", { src: url, alt: "" }));
      useBtn.disabled = false;
      useBtn.textContent = "Use " + taken.length + " photo" + (taken.length === 1 ? "" : "s");
      if (!multiple) finish();
    }
    function finish() {
      const files = taken.map((t) => t.file);
      close();
      deliver(input, files);
    }
    function close() {
      stopMode();
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      setTimeout(() => taken.forEach((t) => URL.revokeObjectURL(t.url)), 60000);
      open = null;
    }
    function setMode(m) {
      if (mode === m) return;
      stopMode(); stopMode = () => {};
      mode = m;
      choices.querySelectorAll(".pc-choice").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
      pane.replaceChildren();
      stopMode = m === "phone" ? phonePane(pane, add) : cameraPane(pane, add);
    }
    open = { close };
  }

  // ---- Use my phone ---------------------------------------------------------
  function phonePane(pane, add) {
    let session = null, stopped = false, timer = null, received = 0;
    const status = el("p", { class: "pc-note" }, ["Getting a link for your phone…"]);
    pane.append(status);
    (async () => {
      try {
        session = await rpc("photo_drop_open");
        if (stopped) { rpc("photo_drop_close", { p_session: session }).catch(() => {}); return; }
        const link = new URL("photo-drop.html", HERE).href + "#" + session;
        const qr = (await loadQr())(0, "M");
        qr.addData(link); qr.make();
        const img = el("div", { class: "pc-qr-img" });
        img.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        status.textContent = "Scan this with your phone's camera, then take the photos there: they appear here a few seconds later. Both need an internet connection.";
        pane.replaceChildren(el("div", { class: "pc-qr" }, [img, el("div", { style: "flex:1;min-width:180px" }, [status, el("p", { class: "pc-note", id: "pc-count" }, ["Waiting for photos…"]), el("p", { class: "pc-link" }, [link])])]));
        poll();
      } catch (e) {
        status.replaceWith(el("p", { class: "pc-err" }, ["Couldn't set up the phone link (" + e.message + "). Without internet, use the laptop camera or choose a file."]));
      }
    })();
    async function poll() {
      if (stopped) return;
      try {
        const r = await rpc("photo_drop_take", { p_session: session });
        for (const dataUrl of r.photos || []) {
          received++;
          add(await dataUrlToFile(dataUrl, "phone-photo-" + received + ".jpg"));
          if (stopped) return;
        }
        const count = pane.querySelector("#pc-count");
        if (count) count.textContent = received ? received + " photo" + (received === 1 ? "" : "s") + " received -- keep going, or use them below." : "Waiting for photos…";
        if (r.open === false) { if (count) count.textContent = "This link has expired: close and choose Use my phone again."; return; }
      } catch (e) { /* a dropped connection: try again */ }
      timer = setTimeout(poll, 2000);
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (session) rpc("photo_drop_close", { p_session: session }).catch(() => {});
    };
  }

  // ---- Laptop camera --------------------------------------------------------
  function cameraPane(pane, add) {
    let stream = null, stopped = false;
    const video = el("video", { class: "pc-video", autoplay: true, playsinline: true, muted: true });
    const pick = el("select", { "aria-label": "Camera", onchange: () => start(pick.value) });
    const shoot = el("button", { type: "button", class: "pc-btn", disabled: true, onclick: snap }, ["📸 Take photo"]);
    const note = el("p", { class: "pc-note" }, ["Starting the camera…"]);
    pane.append(video, el("div", { class: "pc-row" }, [pick, shoot]), note);
    async function start(deviceId) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      shoot.disabled = true;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("this browser can't use the camera here (it needs https)");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ width: { ideal: 1920 }, height: { ideal: 1080 } }, deviceId ? { deviceId: { exact: deviceId } } : {}) });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        shoot.disabled = false;
        // The cameras, named once the browser has the permission.
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        const current = stream.getVideoTracks()[0].getSettings().deviceId;
        pick.replaceChildren(...cams.map((c, i) => el("option", { value: c.deviceId, selected: c.deviceId === current }, [c.label || "Camera " + (i + 1)])));
        pick.style.display = cams.length > 1 ? "" : "none";
        note.textContent = cams.length > 1 ? "Pick the camera above. A phone can be one too: Windows 11 Phone Link, Camo, Iriun or DroidCam make it a wireless webcam." :
          "Tip: a phone can be a wireless webcam too (Windows 11 Phone Link, Camo, Iriun or DroidCam) -- it then shows up here.";
      } catch (e) {
        note.replaceWith(el("p", { class: "pc-err" }, ["No camera: " + (e.name === "NotAllowedError" ? "the browser was refused access -- allow the camera for this site and try again." : e.name === "NotFoundError" ? "none is connected." : e.message)]));
      }
    }
    function snap() {
      const w = video.videoWidth, hgt = video.videoHeight;
      if (!w) return;
      const c = document.createElement("canvas");
      c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(video, 0, 0, w, hgt);
      c.toBlob((blob) => { if (blob) add(new File([blob], "camera-" + Date.now() + ".jpg", { type: "image/jpeg", lastModified: Date.now() })); }, "image/jpeg", 0.9);
      video.animate([{ opacity: 0.3 }, { opacity: 1 }], 250);
    }
    start();
    return () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }

  // A photo picker clicked on a laptop opens the chooser instead of the file dialog.
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!isPhotoInput(t) || t === bypass || !isDesktop()) return;
    e.preventDefault();
    e.stopPropagation();
    openChooser(t);
  }, true);

  window.PhotoCapture = { open: openChooser, isDesktop };
})();
