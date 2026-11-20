// Design reviews and logbook requests -- the Rollcage assessment tool only (the Digital logbooks /
// Scrutineering site has its own account panel). Signed in with an email code, an owner sends a
// rollcage from this device's library to an approved fabricator or a listed scrutineer (the public
// directory) for a review, or to a scrutineer who issues logbooks for a logbook. Each version
// goes online as the rollcage file Export to file writes (photos included), and the design keeps
// them all: its history. A reviewer opens the design here in the editor, may change it, and sends
// it back with a note; the owner opens the latest version, changes it further, and sends it again
// -- to the same reviewer or another. Logbook requests are issued on the Scrutineering site.
// Server: logbook-app's supabase/migrations/20261120000000_design_reviews.sql.
//
// A saved rollcage's links (in its vehicle, kept on this device only):
//   vehicle.design = { id, seq, fp }: the owner's copy of a design, as of version seq
//   vehicle.review = { requestId, designId, seq, fp }: a reviewer's copy, for that request
// fp: the copy's content fingerprint when it matched that version (another now: changes not online).
(function () {
  if ((window.APP_CONFIG || {}).logbook) return;
  const app = window.RollcageApp;
  if (!app) return;
  const SERVER = {
    url: "https://opltqtjxrzlgucrgznft.supabase.co",
    // Public by design: the database's access rules protect the data.
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHRxdGp4cnpsZ3Vjcmd6bmZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNjk0NTAsImV4cCI6MjEwNjc0NTQ1MH0.zp9-mI7BUpjIltkZLa707tayiQ-9SvdOomYONU36wPI",
  };
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // The Scrutineering site: its emails (api/notify) and where logbook requests are issued.
  const SITE = LOCAL ? "http://localhost:5002" : "https://scrutineering.frogracing.us";
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const BUCKET = "design-files";

  const ui = { open: false, session: null, signIn: { email: "", code: "", sent: false, busy: false }, tab: "mine",
    designs: null, requests: null, form: null, busy: null, message: null, dir: null, show: {} };
  let sb = null;

  // ---- DOM helpers (as in the logbook app's account panel) ----
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "value") node.value = v;
      else if (k === "checked") node.checked = !!v;
      else node.setAttribute(k, v === true ? "" : v);
    });
    (children || []).flat(4).forEach((c) => { if (c != null && c !== false) node.append(c.nodeType ? c : String(c)); });
    return node;
  }
  const btn = (label, onclick, cls) => h("button", { type: "button", class: "btn " + (cls || ""), disabled: !!ui.busy, onclick }, [label]);
  const desc = (...c) => h("p", { class: "reviews-desc" }, c);
  const field = (label, input) => h("label", { class: "reviews-field" }, [h("span", {}, [label]), input]);
  const input = (attrs, onchange) => h("input", Object.assign({ type: "text", oninput: (e) => onchange(e.target.value) }, attrs));
  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : "");
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const say = (kind, text) => { ui.message = { kind, text }; render(); };
  const fail = (e) => { ui.busy = null; say("fail", (e && e.message) || String(e)); };

  // ---- The server ----
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement("script");
      s.src = src; s.crossOrigin = "anonymous"; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load the sign-in library: check the connection."));
      document.head.appendChild(s);
    });
  }
  async function client() {
    if (sb) return sb;
    await loadScript(SUPABASE_JS);
    sb = window.supabase.createClient(SERVER.url, SERVER.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data } = await sb.auth.getSession();
    ui.session = data.session;
    sb.auth.onAuthStateChange((event, session) => {
      ui.session = session;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") { ui.designs = ui.requests = null; if (session) load(); }
      render(); updateButton();
    });
    return sb;
  }
  async function rpc(fn, args) {
    const c = await client();
    const { data, error } = await c.rpc(fn, args || {});
    if (error) throw new Error(error.message);
    return data;
  }
  const me = () => (ui.session && ui.session.user && ui.session.user.email || "").toLowerCase();
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // A saved rollcage as a design file: its export, without this device's own links.
  async function fileOf(sessionId) {
    const data = await app.fileData(sessionId);
    if (!data) throw new Error("That rollcage isn't saved on this device.");
    delete data.sessionId;
    data.vehicle = Object.assign({}, data.vehicle);
    delete data.vehicle.design; delete data.vehicle.review; delete data.vehicle.server;
    const text = JSON.stringify(data);
    return { text, sha: await sha256(text), size: text.length };
  }
  async function upload(file) {
    const c = await client();
    const { error } = await c.storage.from(BUCKET).upload(file.sha, new Blob([file.text], { type: "application/json" }), { upsert: false, contentType: "application/json" });
    if (error && !/exist|duplicate/i.test(error.message || "") && String(error.statusCode) !== "409") throw new Error(error.message);
  }
  async function download(sha) {
    const c = await client();
    const { data, error } = await c.storage.from(BUCKET).download(sha);
    if (error) throw new Error(error.message || "Couldn't download the design");
    return JSON.parse(await data.text());
  }
  // The request's email (to its reviewer when sent, its owner when it comes back): best effort.
  async function notify(requestId, kind) {
    try {
      const r = await fetch(SITE + "/api/notify", { method: "POST", headers: { Authorization: "Bearer " + ui.session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, kind }) });
      return r.ok;
    } catch (e) { return false; }
  }
  async function load() {
    try {
      const [designs, requests] = await Promise.all([rpc("my_designs"), rpc("my_design_requests")]);
      ui.designs = designs || []; ui.requests = requests || [];
    } catch (e) { ui.designs = ui.designs || []; ui.requests = ui.requests || []; fail(e); }
    render(); updateButton();
  }

  // ---- This device's copies ----
  const local = () => app.listLocal();
  const ownCopy = (designId) => local().find((s) => s.vehicle && s.vehicle.design && s.vehicle.design.id === designId);
  const reviewCopy = (requestId) => local().find((s) => s.vehicle && s.vehicle.review && s.vehicle.review.requestId === requestId);
  // A copy's content fingerprint: what it holds, whatever this device calls its photos (their
  // ids differ on every device) and without its links.
  const LOCAL_KEYS = new Set(["id", "sessionId", "updatedAt", "design", "review", "server", "logbookRequest", "exportedFrom"]);
  async function fingerprint(sessionId) {
    const data = await app.fileData(sessionId);
    if (!data) return null;
    const images = data.images || {};
    delete data.images;
    const photos = await Promise.all(Object.values(images).map((r) => sha256((r && r.photo) || "")));
    return sha256(JSON.stringify(data, (k, v) => (LOCAL_KEYS.has(k) ? undefined : v)) + photos.sort().join(""));
  }
  // For showing it: worked out once per save, then the dialog redraws.
  const fpCache = {};
  function changedSince(s, link) {
    if (!link) return false;
    const c = fpCache[s.sessionId];
    if (!c || c.updatedAt !== s.updatedAt) {
      if (!c || !c.pending) {
        fpCache[s.sessionId] = { updatedAt: s.updatedAt, pending: true };
        fingerprint(s.sessionId).then((fp) => { fpCache[s.sessionId] = { updatedAt: s.updatedAt, fp }; render(); }, () => {});
      }
      return false;
    }
    return !c.pending && c.fp !== link.fp;
  }
  // For acting on it: worked out now.
  const changedNow = async (s, link) => !!link && (await fingerprint(s.sessionId)) !== link.fp;
  const latest = (d) => d.versions[d.versions.length - 1];
  const openRequest = (d) => d.requests.find((r) => r.status === "open");
  async function link(sessionId, key, value) {
    const s = local().find((x) => x.sessionId === sessionId);
    if (!s) return;
    const fp = value ? await fingerprint(sessionId) : null;
    const fresh = local().find((x) => x.sessionId === sessionId);
    fresh.vehicle = Object.assign({}, fresh.vehicle, { [key]: value ? Object.assign({}, value, { fp }) : undefined });
    app.saveLocal(fresh);
  }
  // The saved rollcage open in the editor, refusing unsaved changes.
  function savedOpen(sessionId) {
    if (app.currentSessionId() === sessionId && app.isDirty()) throw new Error("Save the rollcage first (it has unsaved changes), then send it.");
  }
  // Downloads a version and puts it on this device (replacing `replace`), then opens it.
  // link: [key, value] -- the copy's link (its fingerprint added once it's in).
  async function openVersion(sha, replace, vehicle, linkTo) {
    ui.busy = "Downloading the design…"; render();
    const data = await download(sha);
    const id = await app.importData(data, { replace: replace || null, vehicle, open: true });
    if (linkTo) await link(id, linkTo[0], linkTo[1]);
    ui.busy = null;
    return id;
  }

  // ---- Owner: sending a design ----
  // Uploads the copy as the design's next version, unless it matches the latest. Returns the design id.
  async function uploadOwnVersion(s, note, design) {
    savedOpen(s.sessionId);
    ui.busy = "Uploading the design…"; render();
    const file = await fileOf(s.sessionId);
    const last = design && latest(design);
    const link0 = s.vehicle.design;
    const changed = await changedNow(s, link0);
    if (design && last && link0 && link0.seq < last.seq && changed &&
        !confirm("Your copy here is version " + link0.seq + ", but version " + last.seq + " (" + last.authorName + ") is newer online. Sending yours makes it the latest -- without their changes. Send it anyway?")) {
      ui.busy = null; render(); return null;
    }
    if (design && last && last.fileSha === file.sha) { ui.busy = null; return design.id; }
    if (design && last && link0 && link0.seq === last.seq && !changed) { ui.busy = null; return design.id; }
    await upload(file);
    const res = await rpc("save_design_version", { p: { designId: design ? design.id : null, title: s.vehicle.name || "Roll cage design", fileSha: file.sha, fileSize: file.size, note } });
    await link(s.sessionId, "design", { id: res.designId, seq: res.seq });
    ui.busy = null;
    return res.designId;
  }
  async function loadDirectory() {
    try {
      const [fabs, scrs] = await Promise.all([rpc("fabricator_directory"), rpc("scrutineer_directory")]);
      ui.dir = { fabs: fabs || [], scrs: scrs || [] };
    } catch (e) { ui.dir = { fabs: [], scrs: [] }; fail(e); }
    render();
  }
  const place = (x) => [x.city, x.region, x.country].filter(Boolean).join(", ");
  const scope = (x) => [x.bodyName, x.disciplineName].filter(Boolean).join(" ");
  function startSend(kind, s, design) {
    ui.form = { kind, sessionId: s ? s.sessionId : null, designId: design ? design.id : null, pick: null, body: "", near: "", message: "", note: "", keepHistory: true };
    if (!ui.dir) loadDirectory();
    render();
  }
  async function send() {
    const f = ui.form;
    if (!f.pick) return say("fail", f.kind === "logbook" ? "Pick the scrutineer to issue the logbook." : "Pick who reviews it.");
    const design = f.designId ? (ui.designs || []).find((d) => d.id === f.designId) : null;
    const s = f.sessionId ? local().find((x) => x.sessionId === f.sessionId) : design && ownCopy(design.id);
    if (!s) return say("fail", "Open the latest version first: the design has no copy on this device.");
    try {
      const designId = await uploadOwnVersion(s, f.note, design);
      if (!designId) return;
      ui.busy = "Sending…"; render();
      const [kind, id] = f.pick.split(":");
      const requestId = await rpc("submit_design_request", { p: { designId, kind: f.kind, fabricatorId: kind === "fab" ? id : null, accreditationId: kind === "scr" ? id : null,
        message: f.message, keepHistory: f.kind === "logbook" && f.keepHistory } });
      ui.busy = "Emailing them…"; render();
      const mailed = await notify(requestId, "submitted");
      ui.busy = null; ui.form = null;
      await load();
      say("pass", (f.kind === "logbook" ? "Logbook request sent" : "Sent for review") + (mailed ? ": they were emailed." : " (the email couldn't be sent: they'll see it when they sign in)."));
    } catch (e) { fail(e); }
  }
  function renderSendForm() {
    const f = ui.form;
    const design = f.designId ? (ui.designs || []).find((d) => d.id === f.designId) : null;
    const s = f.sessionId ? local().find((x) => x.sessionId === f.sessionId) : design && ownCopy(design.id);
    const d = ui.dir;
    const all = !d ? [] : f.kind === "logbook" ? d.scrs.filter((x) => x.issuesLogbooks).map((x) => ["scr", x])
      : d.fabs.map((x) => ["fab", x]).concat(d.scrs.map((x) => ["scr", x]));
    const bodies = [...new Map(all.map(([, x]) => [x.body, x.bodyName])).entries()];
    const words = f.near.toLowerCase().split(/\s+/).filter(Boolean);
    const list = all.filter(([, x]) => (!f.body || x.body === f.body) && words.every((w) => [x.business, x.name, place(x)].join(" ").toLowerCase().includes(w)));
    return h("div", { class: "reviews-card reviews-form" }, [
      h("h3", {}, [f.kind === "logbook" ? "Request a logbook" : "Send for review", ": ", (design && design.title) || (s && s.vehicle.name) || "this rollcage"]),
      desc(f.kind === "logbook"
        ? "The scrutineer gets your design, inspects the car and issues its logbook from it. Pick a scrutineer who issues logbooks for your sanctioning body."
        : "The reviewer gets your design with its whole history, may change it, and sends it back with their comments."),
      s ? desc("From your copy on this device: ", h("strong", {}, [s.vehicle.name || "Unnamed"]),
        s.vehicle.design && !changedSince(s, s.vehicle.design) ? " (version " + s.vehicle.design.seq + ", unchanged)" : " (sent as a new version)") : null,
      s && (!s.vehicle.design || changedSince(s, s.vehicle.design)) ? field("What changed in this version (optional)", input({ value: f.note }, (v) => { f.note = v; })) : null,
      h("div", { class: "reviews-row" }, [
        field("Sanctioning body", h("select", { onchange: (e) => { f.body = e.target.value; render(); } }, [h("option", { value: "" }, ["Any"])].concat(
          bodies.map(([id, name]) => h("option", { value: id, selected: f.body === id }, [name]))))),
        field("Near (city, state…)", input({ value: f.near, "data-id": "rv-near" }, (v) => { f.near = v; render(); const box = document.querySelector('[data-id="rv-near"]'); if (box) { box.focus(); box.setSelectionRange(v.length, v.length); } })),
      ]),
      !d ? desc("Loading the directory…") : list.length ? h("div", { class: "reviews-picks" }, list.map(([k, x]) => h("label", { class: "reviews-pick" + (f.pick === k + ":" + x.id ? " picked" : "") }, [
        h("input", { type: "radio", name: "rv-pick", checked: f.pick === k + ":" + x.id, onchange: () => { f.pick = k + ":" + x.id; render(); } }),
        h("span", {}, [h("strong", {}, [x.business || x.name]), " · " + (k === "fab" ? "fabricator" : x.role === "technical_director" ? "technical director" : "scrutineer"),
          h("br"), h("small", {}, [[place(x), scope(x)].filter(Boolean).join(" · ")])]),
      ]))) : desc(all.length ? "Nobody matches." : f.kind === "logbook" ? "No scrutineer who issues logbooks is listed yet." : "Nobody is listed yet."),
      field("Message (optional)", h("textarea", { rows: 3, oninput: (e) => { f.message = e.target.value; } }, [f.message])),
      f.kind === "logbook" ? h("label", { class: "reviews-check" }, [h("input", { type: "checkbox", checked: f.keepHistory, onchange: (e) => { f.keepHistory = e.target.checked; } }),
        " Keep the design's history (its versions and reviews) with the logbook"]) : null,
      h("div", { class: "reviews-actions" }, [btn(f.kind === "logbook" ? "Send the logbook request" : "Send for review", send), btn("Cancel", () => { ui.form = null; render(); }, "secondary")]),
    ]);
  }

  // ---- History ----
  const STATUS = { open: "with", returned: "returned by", declined: "declined by", withdrawn: "withdrawn from", issued: "logbook issued by" };
  function history(d) {
    const events = d.versions.map((v) => ({ at: v.createdAt, text: "Version " + v.seq + " by " + (v.role === "owner" ? "the owner" : v.authorName) + (v.note ? ": " + v.note : "") }))
      .concat(d.requests.flatMap((r) => [{ at: r.createdAt, text: (r.kind === "logbook" ? "Logbook requested from " : "Sent for review to ") + r.reviewerName + " (version " + r.versionSeq + ")" + (r.message ? ": " + r.message : "") }]
        .concat(r.handledAt ? [{ at: r.handledAt, text: r.status === "returned" ? "Returned by " + r.reviewerName + (r.returnedSeq > r.versionSeq ? " with version " + r.returnedSeq : " unchanged") + (r.returnNote ? ": " + r.returnNote : "")
          : r.status === "declined" ? "Declined by " + r.reviewerName + (r.returnNote ? ": " + r.returnNote : "")
          : r.status === "withdrawn" ? "Request to " + r.reviewerName + " withdrawn"
          : "Logbook " + (r.logbookNumber || "") + " issued by " + r.reviewerName + (r.keepHistory ? " (keeps this history)" : "") }] : [])))
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    return h("ol", { class: "reviews-history" }, events.map((e) => h("li", {}, [h("small", {}, [fmt(e.at)]), " ", e.text])));
  }
  function statusLine(d) {
    const r = openRequest(d) || d.requests[d.requests.length - 1];
    const v = latest(d);
    return [plural(d.versions.length, "version"), r ? (r.kind === "logbook" && r.status === "open" ? "logbook requested from " : STATUS[r.status] + " ") + r.reviewerName + " " + fmt(r.handledAt || r.createdAt) : "not sent yet",
      v ? "latest by " + (v.role === "owner" ? "you" : v.authorName) : null].filter(Boolean).join(" · ");
  }

  // ---- Owner: my designs ----
  function renderMine() {
    const designs = ui.designs || [];
    const linked = new Set(designs.map((d) => d.id));
    // Saved rollcages not sent yet (or sent from another account): sendable as a new design.
    const unsent = local().filter((s) => !(s.vehicle && s.vehicle.design && linked.has(s.vehicle.design.id)) && !(s.vehicle && s.vehicle.review));
    const cur = app.currentSessionId();
    return [
      unsent.length ? h("div", { class: "reviews-card" }, [
        h("h3", {}, ["Send a rollcage from this device"]),
        desc("It becomes a design: each version you or a reviewer save is kept with it."),
        h("div", { class: "reviews-actions" }, [
          h("select", { onchange: (e) => { ui.show.pickLocal = e.target.value; } }, unsent.map((s) => h("option", { value: s.sessionId, selected: (ui.show.pickLocal || cur) === s.sessionId }, [(s.vehicle.name || "Unnamed") + (s.sessionId === cur ? " (open)" : "")]))),
          btn("Send for review", () => startSend("review", local().find((s) => s.sessionId === (ui.show.pickLocal || (unsent.find((x) => x.sessionId === cur) || unsent[0]).sessionId)))),
          btn("Request a logbook", () => startSend("logbook", local().find((s) => s.sessionId === (ui.show.pickLocal || (unsent.find((x) => x.sessionId === cur) || unsent[0]).sessionId))), "secondary"),
        ]),
      ]) : null,
      designs.length ? designs.map((d) => {
        const r = openRequest(d), copy = ownCopy(d.id), v = latest(d);
        const behind = copy && v && copy.vehicle.design.seq < v.seq;
        return h("div", { class: "reviews-card" }, [
          h("h3", {}, [d.title]),
          desc(statusLine(d)),
          copy ? desc("On this device: ", h("strong", {}, [copy.vehicle.name || d.title]), " -- version " + copy.vehicle.design.seq + (changedSince(copy, copy.vehicle.design) ? ", changed since" : "") + (behind ? " (version " + v.seq + " is newer)" : ""))
            : desc("Not on this device."),
          r && r.status === "open" && r.message ? desc("Your message: " + r.message) : null,
          (() => { const back = d.requests.filter((x) => x.returnNote).slice(-1)[0]; return back && !r ? desc(h("strong", {}, [back.reviewerName + ": "]), back.returnNote) : null; })(),
          h("div", { class: "reviews-actions" }, [
            v ? btn(copy ? (behind ? "Open version " + v.seq + " (newer)" : "Open it") : "Open it on this device", async () => {
              try {
                const changed = copy && await changedNow(copy, copy.vehicle.design);
                if (copy && !behind && !changed) { app.openLocal(copy.sessionId); close(); return; }
                if (copy && changed && !confirm("Your copy here has changes not sent. Replace it with version " + v.seq + "?")) return;
                await openVersion(v.fileSha, copy && copy.sessionId, null, ["design", { id: d.id, seq: v.seq }]);
                close();
              } catch (e) { fail(e); }
            }, behind ? "" : "secondary") : null,
            !r ? btn("Send for review", () => startSend("review", null, d)) : null,
            !r ? btn("Request a logbook", () => startSend("logbook", null, d), "secondary") : null,
            r ? btn("Withdraw the request", async () => {
              if (!confirm("Take the design back from " + r.reviewerName + "?")) return;
              try { await rpc("withdraw_design_request", { p_id: r.id }); await load(); say("pass", "Request withdrawn."); } catch (e) { fail(e); }
            }, "secondary") : null,
            btn(ui.show["h" + d.id] ? "Hide the history" : "History", () => { ui.show["h" + d.id] = !ui.show["h" + d.id]; render(); }, "secondary"),
          ]),
          ui.show["h" + d.id] ? history(d) : null,
          ui.show["h" + d.id] ? h("div", { class: "reviews-actions" }, d.versions.map((x) => btn("Open version " + x.seq + " as a copy", async () => {
            try { await openVersion(x.fileSha, null, { name: d.title + " (version " + x.seq + ")" }); close(); } catch (e) { fail(e); }
          }, "small secondary"))) : null,
        ]);
      }) : desc("No designs sent yet."),
    ];
  }

  // ---- Reviewer: designs sent to me ----
  async function sendBack(d, r, decline) {
    const note = prompt(decline ? "Decline -- why? (" + d.ownerEmail + " sees it)" : "Your comments for " + d.ownerEmail + " (optional):", "");
    if (note === null || (decline && !note.trim())) return;
    try {
      const copy = reviewCopy(r.id);
      if (!decline && copy && await changedNow(copy, copy.vehicle.review)) {
        savedOpen(copy.sessionId);
        ui.busy = "Uploading your changes…"; render();
        const file = await fileOf(copy.sessionId);
        await upload(file);
        const res = await rpc("save_design_version", { p: { designId: d.id, fileSha: file.sha, fileSize: file.size, note: note.trim() || "Changes from the review" } });
        await link(copy.sessionId, "review", { requestId: r.id, designId: d.id, seq: res.seq });
      }
      ui.busy = "Sending it back…"; render();
      await rpc("return_design_request", { p_id: r.id, p_note: note, p_decline: !!decline });
      const mailed = await notify(r.id, "returned");
      ui.busy = null;
      await load();
      say("pass", (decline ? "Declined" : "Sent back") + (mailed ? ": " + d.ownerEmail + " was emailed." : "."));
    } catch (e) { fail(e); }
  }
  function renderToReview() {
    const designs = ui.requests || [];
    if (!designs.length) return [desc("Nothing sent to you yet. Fabricators approved by a sanctioning body, and scrutineers listed in the directory, get designs to review here.")];
    const mineOf = (d) => d.requests.filter((r) => r.mine);
    const open = designs.filter((d) => mineOf(d).some((r) => r.status === "open"));
    const past = designs.filter((d) => !open.includes(d));
    const card = (d) => {
      const r = mineOf(d).find((x) => x.status === "open") || mineOf(d).slice(-1)[0];
      const copy = reviewCopy(r.id), v = latest(d);
      return h("div", { class: "reviews-card" }, [
        h("h3", {}, [d.title, " ", h("span", { class: "reviews-badge" + (r.status === "open" ? " open" : "") }, [r.kind === "logbook" ? "logbook request" : "review", r.status === "open" ? "" : " · " + r.status])]),
        desc("From " + d.ownerEmail + " · sent " + fmt(r.createdAt) + " · " + plural(d.versions.length, "version") + (r.bodyName ? " · " + scope(r) : "")),
        r.message ? desc("“" + r.message + "”") : null,
        copy ? desc("Your copy here: version " + copy.vehicle.review.seq + (changedSince(copy, copy.vehicle.review) ? ", with your changes (sent back with it)" : "")) : null,
        r.status === "open" ? h("div", { class: "reviews-actions" }, r.kind === "logbook" ? [
          h("a", { class: "btn", href: SITE + "/?site=scrutineering", target: "_blank", rel: "noopener" }, ["Issue it on the Scrutineering site"]),
          btn("Decline", () => sendBack(d, r, true), "secondary"),
        ] : [
          btn(copy ? "Open your copy" : "Open it in the editor", async () => {
            try {
              if (copy) { app.openLocal(copy.sessionId); close(); return; }
              await openVersion(v.fileSha, null, null, ["review", { requestId: r.id, designId: d.id, seq: v.seq }]);
              close();
            } catch (e) { fail(e); }
          }),
          btn("Send it back", () => sendBack(d, r, false)),
          btn("Decline", () => sendBack(d, r, true), "secondary"),
        ]) : null,
        btn(ui.show["h" + d.id] ? "Hide the history" : "History", () => { ui.show["h" + d.id] = !ui.show["h" + d.id]; render(); }, "small secondary"),
        ui.show["h" + d.id] ? history(d) : null,
      ]);
    };
    return [open.length ? open.map(card) : desc("Nothing waiting for you."), past.length ? h("h3", { class: "reviews-sub" }, ["Done"]) : null, past.map(card)];
  }

  // ---- Sign-in ----
  async function sendCode() {
    const email = ui.signIn.email.trim();
    if (!email.includes("@")) return say("fail", "Enter your email address.");
    ui.signIn.busy = true; render();
    try {
      const c = await client();
      const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      ui.signIn.sent = true; ui.message = null;
    } catch (e) { fail(e); }
    ui.signIn.busy = false; render();
  }
  async function verify() {
    try {
      const c = await client();
      const { error } = await c.auth.verifyOtp({ email: ui.signIn.email.trim(), token: ui.signIn.code.trim(), type: "email" });
      if (error) throw error;
    } catch (e) { fail(e); }
  }
  function renderSignIn() {
    if (ui.signIn.sent) return [
      desc("We sent a sign-in email to ", h("strong", {}, [ui.signIn.email]), ". Open its link on this device, or type the code it contains:"),
      field("Code", input({ value: ui.signIn.code, inputmode: "numeric", autocomplete: "one-time-code", placeholder: "123456" }, (v) => { ui.signIn.code = v; })),
      h("div", { class: "reviews-actions" }, [btn("Sign in", verify), btn("Use another email", () => { ui.signIn.sent = false; ui.signIn.code = ""; render(); }, "secondary")]),
    ];
    return [
      desc("Send your roll cage design to an approved fabricator or a scrutineer for review, or to a scrutineer for its logbook -- and keep track of every version. Fabricators and scrutineers review designs here too."),
      desc("Sign in with your email: no password, we email you a code. Your rollcages stay on this device; only what you send goes online."),
      field("Email", input({ value: ui.signIn.email, inputmode: "email", autocomplete: "email", placeholder: "you@example.com", onkeydown: (e) => { if (e.key === "Enter") sendCode(); } }, (v) => { ui.signIn.email = v; })),
      h("div", { class: "reviews-actions" }, [h("button", { type: "button", class: "btn", disabled: ui.signIn.busy, onclick: sendCode }, [ui.signIn.busy ? "Sending…" : "Email me a sign-in code"])]),
    ];
  }

  // ---- The dialog ----
  let overlay = null;
  function close() { ui.open = false; ui.form = null; render(); }
  function openDialog() {
    ui.open = true; ui.message = null; render();
    client().then(() => { if (ui.session) load(); render(); }, fail);
  }
  function render() {
    if (!ui.open) { if (overlay) { overlay.remove(); overlay = null; } return; }
    const waiting = (ui.requests || []).filter((d) => d.requests.some((r) => r.mine && r.status === "open")).length;
    const body = !sb ? [desc("Loading…")] : !ui.session ? renderSignIn() : ui.form ? [renderSendForm()] : [
      h("div", { class: "reviews-signed" }, ["Signed in as ", h("strong", {}, [me()]), " ", h("button", { type: "button", class: "btn small secondary", onclick: () => sb.auth.signOut() }, ["Sign out"])]),
      h("div", { class: "reviews-tabs", role: "tablist" }, [["mine", "My designs" + (ui.designs ? " (" + ui.designs.length + ")" : "")], ["review", "Sent to me" + (waiting ? " (" + waiting + " waiting)" : "")]].map(([id, label]) =>
        h("button", { type: "button", role: "tab", class: "reviews-tab" + (ui.tab === id ? " on" : ""), "aria-selected": String(ui.tab === id), onclick: () => { ui.tab = id; render(); } }, [label]))),
      ui.designs === null ? desc("Loading…") : ui.tab === "mine" ? renderMine() : renderToReview(),
    ];
    const dialog = h("div", { class: "load-dialog reviews-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Design reviews" }, [
      h("div", { class: "load-dialog-header" }, [h("h2", {}, ["Design reviews"]), h("button", { type: "button", class: "btn small secondary", onclick: close }, ["Close"])]),
      ui.busy ? h("p", { class: "reviews-busy" }, [ui.busy]) : null,
      ui.message ? h("p", { class: "reviews-message " + ui.message.kind, onclick: () => { ui.message = null; render(); } }, [ui.message.text]) : null,
      body,
      h("p", { class: "reviews-foot" }, ["Find a fabricator or scrutineer near you: ", h("a", { href: SITE + "/?directory", target: "_blank", rel: "noopener" }, ["the directory"]), "."]),
    ]);
    const scroll = overlay ? overlay.scrollTop : 0;
    const fresh = h("div", { class: "modal-overlay", onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [dialog]);
    if (overlay) overlay.replaceWith(fresh); else document.body.appendChild(fresh);
    overlay = fresh;
    overlay.scrollTop = scroll;
  }
  // The header's button (with what waits for this person, once signed in).
  let headerBtn = null;
  function updateButton() {
    if (!headerBtn) return;
    const waiting = (ui.requests || []).filter((d) => d.requests.some((r) => r.mine && r.status === "open")).length;
    headerBtn.textContent = "Design reviews" + (waiting ? " (" + waiting + ")" : "");
  }
  function addButton() {
    const holder = document.getElementById("headerHelpLinks");
    if (!holder || headerBtn) return;
    headerBtn = h("button", { type: "button", class: "btn small secondary", id: "designReviewsLink", onclick: openDialog }, ["Design reviews"]);
    holder.insertBefore(headerBtn, holder.firstChild);
  }
  addButton();
  // A sign-in link from the email lands here (#access_token=...): sign in and open the dialog.
  if (/access_token=|[?&]code=/.test(location.hash + location.search)) openDialog();
  // Already signed in on this device: what's waiting, on the button.
  else {
    try {
      if (Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k))) client().then(() => { if (ui.session) load(); }, () => {});
    } catch (e) { /* no storage */ }
  }
})();
