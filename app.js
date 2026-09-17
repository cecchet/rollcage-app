// Rollcage pre-screening checklist app. Vanilla JS, no build step, no server
// required — everything (including rules-data.js) loads via plain <script>
// tags so the app works from a double-clicked index.html.

(function () {
  "use strict";

  const STORAGE_KEY = "rollcage_inspections_v1";
  const RULES = window.RULES_DATA;
  // Photo uploads are disabled everywhere for now, to be reintroduced later
  // where actually needed -- flip this back on rather than re-deriving the
  // removed rendering.
  const PHOTOS_ENABLED = false;

  const state = {
    sessionId: null,
    vehicle: { name: "", org: "nasa", logbookStatus: "new", logbookDate: "" },
    pathId: null,
    answers: {}, // elementId -> { value, note, photos: [{name, dataUrl}] }
    resultsExpanded: false, // UI-only: results panel starts collapsed so the input form gets the screen
    vehicleExpanded: false, // UI-only: Vehicle description panel starts collapsed
    expandedIds: {}, // UI-only: elementId -> true once a completed question has been manually re-opened
    activeTab: 1, // UI-only: which phase (Part 1/2/3) tab is currently shown
    justSaved: false, // UI-only: briefly true right after the Save button is clicked
    showGhostBars: true, // UI-only: whether bars not yet confirmed show dimmed for context, or are hidden entirely
    showDriver: true, // UI-only: whether the driver/codriver mannequins show, or are hidden to see the cage behind them
    part3ViewMode: null, // UI-only: null | "weld" | "junction" -- see applyPart3View()
    aiAnalysis: { status: "idle", suggestions: [], error: null, accepted: {} }, // UI-only, never persisted -- see renderPhotoAnalysis()
  };

  function uid() {
    return "insp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveCurrent() {
    if (!state.sessionId) return;
    const all = loadAll();
    all[state.sessionId] = {
      sessionId: state.sessionId,
      vehicle: state.vehicle,
      pathId: state.pathId,
      answers: state.answers,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function startNew() {
    state.sessionId = uid();
    state.vehicle = { name: "", org: "nasa", logbookStatus: "new", logbookDate: "" };
    state.pathId = suggestPath(state.vehicle);
    state.answers = {};
    render();
  }

  function loadSession(id) {
    const all = loadAll();
    const s = all[id];
    if (!s) return;
    state.sessionId = s.sessionId;
    state.vehicle = s.vehicle;
    state.pathId = s.pathId;
    state.answers = s.answers || {};
    render();
  }

  function suggestPath(vehicle) {
    if (vehicle.logbookStatus === "new") return "new_construction";
    if (!vehicle.logbookDate) return null;
    const orgRules = RULES[vehicle.org];
    if (!orgRules) return null;
    const cutoff = new Date(orgRules.logbookCutoffDate);
    const issued = new Date(vehicle.logbookDate);
    return issued >= cutoff ? "new_construction" : "grandfathered";
  }

  function getAnswer(id) {
    return state.answers[id] || { value: "", note: "", photos: [], extra: {} };
  }

  function setAnswer(id, patch) {
    state.answers[id] = Object.assign({}, getAnswer(id), patch);
    saveCurrent();
    render();
  }

  // ---- Scoring -------------------------------------------------------

  function compareOk(v, compare) {
    if (!compare) return true;
    switch (compare.op) {
      case "lt": return v < compare.value;
      case "lte": return v <= compare.value;
      case "gt": return v > compare.value;
      case "gte": return v >= compare.value;
      case "between": return v >= compare.min && v <= compare.max;
      default: return true;
    }
  }

  // Status for one entry of elm.extraFields -- "numeric" (default) compares
  // against f.compare like the standalone numeric type; "boolean" is a
  // plain yes/no. Each field can carry its own `requirement` (e.g. a
  // "recommended" field merged onto an otherwise "required" card); falls
  // back to the parent element's requirement if not given.
  // Whether one elm.extraFields entry applies given the parent element's
  // own current answer.value (e.g. a "Sill bar" sub-field merged onto a
  // door-bar-design choice, only relevant for some of that choice's
  // options).
  function extraFieldApplies(f, parentValue) {
    if (!f.showIf) return true;
    if (f.showIf.equals !== undefined) return parentValue === f.showIf.equals;
    if (f.showIf.in) return f.showIf.in.includes(parentValue);
    return true;
  }

  function extraFieldStatus(f, raw, parentRequirement) {
    const requirement = f.requirement || parentRequirement;
    if (f.type === "boolean") {
      if (raw !== "yes" && raw !== "no") return requirement === "recommended" ? "neutral" : "warn";
      if (raw === "no") return requirement === "recommended" ? "warn" : "fail";
      return "pass";
    }
    if (raw === "" || raw == null) return requirement === "recommended" ? "neutral" : "warn";
    const v = parseFloat(raw);
    if (isNaN(v)) return "warn";
    return compareOk(v, f.compare) ? "pass" : requirement === "recommended" ? "warn" : "fail";
  }

  function elementStatus(el, answer) {
    // returns one of: pass, fail, warn (unsure/incomplete), neutral (not applicable / informational-only)
    if (el.requirement === "informational") {
      return "neutral";
    }
    if (el.extraFields) {
      const core = Object.assign({}, el);
      delete core.extraFields;
      let worst = elementStatus(core, answer);
      const extra = answer.extra || {};
      el.extraFields.forEach((f) => {
        if (!extraFieldApplies(f, answer.value)) return;
        const s = extraFieldStatus(f, extra[f.key], el.requirement);
        if (s === "fail") worst = "fail";
        else if (s === "warn" && worst !== "fail") worst = "warn";
        else if (s === "neutral" && worst === "pass") worst = "neutral";
      });
      return worst;
    }
    if (el.evaluationType === "choice") {
      if (!answer.value) return el.requirement === "recommended" ? "neutral" : "warn";
      const opt = el.options.find((o) => o.id === answer.value);
      if (!opt) return "warn";
      if (opt.outcome === "exempt") return "pass";
      if (opt.outcome === "fail") return el.requirement === "recommended" ? "warn" : "fail";
      return "pass";
    }
    if (el.evaluationType === "tubing3solo") {
      return tubing3Status(el, answer);
    }
    if (el.evaluationType === "plateSolo") {
      return plateSoloStatus(answer);
    }
    if (el.evaluationType === "gussetSolo") {
      return gussetSoloStatus(answer);
    }
    if (el.evaluationType === "numeric" && el.fields) {
      const values = answer.value || {};
      let worst = "pass";
      el.fields.forEach((f) => {
        const raw = values[f.key];
        let s;
        if (raw === "" || raw == null) s = el.requirement === "recommended" ? "neutral" : "warn";
        else {
          const v = parseFloat(raw);
          if (isNaN(v)) s = "warn";
          else s = compareOk(v, f.compare) ? "pass" : el.requirement === "recommended" ? "warn" : "fail";
        }
        if (s === "fail") worst = "fail";
        else if (s === "warn" && worst !== "fail") worst = "warn";
        else if (s === "neutral" && worst === "pass") worst = "neutral";
      });
      return worst;
    }
    if (el.evaluationType === "numeric") {
      if (answer.value === "" || answer.value == null) return el.requirement === "recommended" ? "neutral" : "warn";
      const v = parseFloat(answer.value);
      if (isNaN(v)) return "warn";
      if (!compareOk(v, el.compare)) return el.requirement === "recommended" ? "warn" : "fail";
      return "pass";
    }
    if (el.evaluationType === "table") {
      return tableElementStatus(el);
    }
    // boolean / attestation share yes/no/unsure
    if (answer.value === "yes") return "pass";
    if (answer.value === "no") return el.requirement === "recommended" ? "warn" : "fail";
    if (answer.value === "unsure") return "warn";
    return el.requirement === "recommended" ? "neutral" : "warn";
  }

  // ---- Tubing (material / diameter / thickness) -----------------------
  // Diameter/thickness are entered via a dropdown of common preset sizes
  // (mixed inch and mm, since FIA-homologated T45 cages are metric) plus an
  // "Other" option that reveals a free numeric entry + unit picker, for
  // anything bigger or smaller than the expected set. Everything is
  // compared in inches internally regardless of which unit was entered.
  const DIAMETER_PRESETS = [
    { val: 1.5, unit: "in" }, { val: 1.75, unit: "in" }, { val: 2.0, unit: "in" },
    { val: 38, unit: "mm" }, { val: 40, unit: "mm" }, { val: 45, unit: "mm" }, { val: 50, unit: "mm" },
  ];
  const THICKNESS_PRESETS = [
    { val: 0.065, unit: "in" }, { val: 0.083, unit: "in" }, { val: 0.095, unit: "in" }, { val: 0.12, unit: "in" },
    { val: 2.0, unit: "mm" }, { val: 2.5, unit: "mm" }, { val: 3.0, unit: "mm" },
  ];
  function dimLabel(d) { return d.val + (d.unit === "mm" ? "mm" : '"'); }
  function toInches(dim) {
    if (!dim || dim.val === "" || dim.val == null) return null;
    const v = parseFloat(dim.val);
    if (isNaN(v)) return null;
    return dim.unit === "mm" ? v / 25.4 : v;
  }

  // Legacy single-dropdown tubing sub-item (still used by untouched
  // grandfathered paths).
  function tubingStatus(sub, answer) {
    if (sub.requirements) return tubing3Status(sub, answer);
    if (!answer.value) return "warn";
    const opt = sub.options.find((o) => o.id === answer.value);
    if (!opt) return "warn";
    return opt.outcome === "fail" ? "fail" : "pass";
  }

  // New 3-field tubing sub-item: material + diameter + thickness, checked
  // against whichever material's minimums were matched. Material "other"
  // (a spec we don't have a rule for) is left as "warn" for the inspector
  // to judge manually via the notes field, rather than auto-failing it.
  function tubing3Status(sub, answer) {
    const v = answer.value;
    if (!v || !v.material) return "warn";
    if (v.material === "other") return "warn";
    const req = sub.requirements.find((r) => r.material === v.material);
    if (!req) return "warn";
    if (req.manualOnly) return "warn";
    const diamIn = toInches(v.diameter);
    const thickIn = toInches(v.thickness);
    if (diamIn == null || thickIn == null) return "warn";
    // A material can have more than one acceptable (diameter, thickness)
    // floor -- e.g. NASA's CDS/DOM allows EITHER 1.75x0.095 OR 2.00x0.083 --
    // so pass if the entered size clears any one combo.
    return req.combos.some((c) => diamIn >= c.minDiameterIn && thickIn >= c.minThicknessIn) ? "pass" : "fail";
  }

  // Mounting foot plates: material (free text, no rule tied to it) +
  // thickness only (no diameter -- a flat plate, not a tube). FIA's rule is
  // a flat 3mm minimum regardless of material.
  const PLATE_MIN_THICKNESS_IN = 3 / 25.4;
  function plateSoloStatus(answer) {
    const v = answer.value;
    if (!v || !v.thickness) return "warn";
    const thickIn = toInches(v.thickness);
    if (thickIn == null) return "warn";
    return thickIn >= PLATE_MIN_THICKNESS_IN ? "pass" : "fail";
  }
  // Gusset material/thickness: pure capture like the rest of Part 2 -- no
  // minimum enforced here (unlike mounting feet's flat 3mm FIA rule), since
  // the actual per-junction minimum varies and is judged in Part 4 instead.
  function gussetSoloStatus(answer) {
    const v = answer.value;
    return v && v.material && dimHasValue(v.thickness) ? "pass" : "warn";
  }

  // ---- Table elements (named rows x columns, e.g. weld locations, gusset
  // specs, mounting feet) -- one shared answer id per cell:
  // elm.id + "__" + row.id + "__" + col.key.
  function tableCellId(elm, row, col) { return elm.id + "__" + row.id + "__" + col.key; }
  // elm.rows is normally a static array, but some tables (e.g. the tube
  // classification table's door-bar rows) need a different row set
  // depending on another answer -- those declare rows as a function taking
  // getAnswer instead, resolved fresh on every render/status computation.
  function resolveRows(elm) { return typeof elm.rows === "function" ? elm.rows(getAnswer) : elm.rows; }
  function tableCellStatus(col, answer) {
    if (col.type === "boolean" || col.type === "compliance") {
      if (answer.value === "yes") return "pass";
      if (answer.value === "no") return "fail";
      return "warn";
    }
    if (col.type === "number") {
      if (answer.value === "" || answer.value == null) return "warn";
      const v = parseFloat(answer.value);
      if (isNaN(v)) return "warn";
      return compareOk(v, col.compare) ? "pass" : "fail";
    }
    if (col.type === "tubing3") {
      return tubing3Status(col, answer);
    }
    if (col.type === "area") {
      // Just needs an entry -- Part 2 captures the size, Part 4 is where
      // it's actually judged against the FIA minimum for that location.
      const v = answer.value;
      return v && v.value !== "" && v.value != null ? "pass" : "warn";
    }
    // text/select: just needs an entry, no automatic pass/fail judgement
    return answer.value ? "pass" : "warn";
  }
  // A distance-from-junction table can carry a "quick check" shortcut (see
  // renderTableElement) -- confirming every row is under the standard
  // 100mm threshold at a glance, without recording each junction's own
  // measurement. Answered "yes" there short-circuits the table to pass
  // regardless of what (if anything) is filled in below it.
  function distanceQuickCheckId(elm) { return elm.id + "__quick"; }
  function tableElementStatus(elm) {
    if (elm.distanceQuickCheck && getAnswer(distanceQuickCheckId(elm)).value === "yes") return "pass";
    let worst = "pass";
    resolveRows(elm).forEach((row) => {
      elm.columns.forEach((col) => {
        if (col.optional) return;
        const cellAnswer = getAnswer(tableCellId(elm, row, col));
        const s = tableCellStatus(col, cellAnswer);
        if (s === "fail") worst = "fail";
        else if (s === "warn" && worst !== "fail") worst = "warn";
      });
    });
    return worst;
  }

  // Whether an element applies given the answers so far -- used to skip
  // alternate-design subsections that don't match what was picked upstream
  // (e.g. only show the 253-14/253-22 detail section if that roof-bar
  // design was actually selected), rather than showing every design's full
  // detail unconditionally and scoring the ones not chosen as "incomplete".
  // A showIf condition is either {id, equals} / {id, in: [...]} (checked
  // against that field's own answer), or {any: [cond, cond, ...]} for OR
  // logic across different fields (e.g. "this main rollbar sub-question
  // applies if EITHER the base structure was identified as 253-1/2/3, OR
  // the separate 'main rollbar present' question was answered yes").
  function showIfCondMet(c) {
    if (c.any) return c.any.some(showIfCondMet);
    const v = getAnswer(c.id).value;
    if (c.equals !== undefined) return v === c.equals;
    if (c.notEquals !== undefined) return v !== c.notEquals;
    if (c.in) return c.in.includes(v);
    return true;
  }
  function elementVisible(elm) {
    if (!elm.showIf) return true;
    const conds = Array.isArray(elm.showIf) ? elm.showIf : [elm.showIf];
    return conds.every(showIfCondMet);
  }

  function computeResults(path) {
    const routeAnswer = getAnswer("homologation_route");
    const visibleElements = path.elements.filter(elementVisible);
    const exempt = visibleElements.some(
      (el) => el.isRoutingQuestion && getAnswer(el.id).value &&
        el.options.find((o) => o.id === getAnswer(el.id).value && o.outcome === "exempt")
    );

    const rows = visibleElements.map((el) => {
      const answer = getAnswer(el.id);
      const status = el.isRoutingQuestion ? (answer.value ? "pass" : "warn") : elementStatus(el, answer);
      return { el, answer, status };
    });

    let requiredTotal = 0;
    let requiredSatisfied = 0;
    const failures = [];
    const unresolved = [];
    const advisories = [];

    rows.forEach(({ el, status }) => {
      if (el.isRoutingQuestion) return;
      const counts = el.requirement === "required" || el.requirement === "conditional" || el.requirement === "exception";
      if (counts) {
        requiredTotal++;
        if (status === "pass") requiredSatisfied++;
        if (status === "fail") failures.push(el);
        if (status === "warn") unresolved.push(el);
      } else if (el.requirement === "recommended" && status === "warn") {
        advisories.push(el);
      }

      if (el.tubing && el.tubing.length) {
        el.tubing.forEach((sub, idx) => {
          const subId = el.id + "__tubing_" + idx;
          const subAnswer = getAnswer(subId);
          const subStatus = tubingStatus(sub, subAnswer);
          const pseudoEl = {
            name: el.name + " — " + sub.label,
            reference: sub.reference,
            hardFailMessage: "Tubing does not meet the minimum " + sub.classification + " spec.",
          };
          requiredTotal++;
          if (subStatus === "pass") requiredSatisfied++;
          if (subStatus === "fail") failures.push(pseudoEl);
          if (subStatus === "warn") unresolved.push(pseudoEl);
        });
      }
    });

    let verdict;
    if (exempt) {
      verdict = { level: "warn", exempt: true, label: "HOMOLOGATED ROUTE — verify against FIA/ASN papers directly", detail: "This checklist does not apply to an exact-match homologated cage." };
    } else if (failures.length > 0) {
      verdict = { level: "fail", label: "NOT COMPLIANT — required element(s) missing or failing", detail: failures.length + " required item(s) failed." };
    } else if (unresolved.length > 0) {
      verdict = { level: "warn", label: "INCOMPLETE — needs verification before a call can be made", detail: unresolved.length + " required item(s) not yet answered or unsure." };
    } else {
      verdict = { level: "pass", label: "MEETS MINIMUM REQUIREMENTS (as entered)", detail: "All required items satisfied based on your answers." };
    }

    return {
      rows,
      requiredTotal,
      requiredSatisfied,
      failures,
      unresolved,
      advisories,
      verdict,
      scorePct: requiredTotal ? Math.round((requiredSatisfied / requiredTotal) * 100) : 0,
    };
  }

  // ---- Rendering -------------------------------------------------------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), attrs[k]);
        else if (typeof attrs[k] === "boolean") {
          // Boolean HTML attributes (disabled, etc.) are presence-based --
          // setAttribute(k, false) would still add the attribute as the
          // string "false" and disable the element regardless.
          if (attrs[k]) node.setAttribute(k, "");
          else node.removeAttribute(k);
        } else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Downscales an image file to at most maxDim on its longest side and
  // re-encodes as JPEG, returning {mimeType, data (base64, no data: URI
  // prefix)} -- used for the AI photo-analysis upload (renderPhotoAnalysis)
  // rather than fileToDataUrl above, since a phone photo straight off a
  // camera can be several MB (several photos of the same cage easily blow
  // past a serverless function's request-body size limit, and cost more
  // in vision-API tokens for no real accuracy benefit at full resolution).
  function resizeImageToBase64(file, maxDim) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ mimeType: "image/jpeg", data: dataUrl.split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load " + file.name)); };
      img.src = url;
    });
  }

  let saveFlashTimeout = null;
  function saveWithFlash() {
    saveCurrent();
    state.justSaved = true;
    render();
    clearTimeout(saveFlashTimeout);
    saveFlashTimeout = setTimeout(() => { state.justSaved = false; render(); }, 1200);
  }

  function exportSessionToFile() {
    const data = { sessionId: state.sessionId, vehicle: state.vehicle, pathId: state.pathId, answers: state.answers };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (state.vehicle.name || "rollcage") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Always lands as a new, separate saved rollcage (a fresh sessionId)
  // rather than silently overwriting whatever's currently open or
  // colliding with an existing save that happens to reuse an old id.
  function importSessionFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alert("That file isn't a valid rollcage export (not JSON).");
        return;
      }
      if (!data || typeof data !== "object" || !data.vehicle || !data.answers) {
        alert("That file isn't a valid rollcage export.");
        return;
      }
      state.sessionId = uid();
      state.vehicle = data.vehicle;
      state.pathId = data.pathId || null;
      state.answers = data.answers || {};
      saveCurrent();
      render();
    };
    reader.readAsText(file);
  }

  function renderSessionBar(root) {
    const all = loadAll();
    const select = el("select", {
      onchange: (e) => {
        if (e.target.value === "__new__") startNew();
        else loadSession(e.target.value);
      },
    });
    select.appendChild(el("option", { value: "__new__" }, ["New rollcage..."]));
    Object.values(all)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .forEach((s) => {
        const label = (s.vehicle.name || "Unnamed vehicle") + " — " + new Date(s.updatedAt).toLocaleString();
        const opt = el("option", { value: s.sessionId }, [label]);
        if (s.sessionId === state.sessionId) opt.selected = true;
        select.appendChild(opt);
      });

    const importInput = el("input", {
      type: "file",
      accept: "application/json",
      class: "visually-hidden",
      onchange: (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importSessionFromFile(file);
        e.target.value = "";
      },
    });

    const nameInput = el("input", {
      type: "text",
      class: "session-bar-name-input",
      placeholder: "Name this rollcage...",
      value: state.vehicle.name,
      oninput: (e) => {
        state.vehicle.name = e.target.value;
        saveCurrent();
      },
    });

    root.appendChild(
      el("div", { class: "panel session-bar" }, [
        el("div", { class: "session-bar-group" }, [
          el("div", {}, ["Saved Rollcages (this browser only): "]),
          select,
        ]),
        el("div", { class: "session-bar-group" }, [
          el("label", { for: "rollcageNameInput" }, ["Rollcage name: "]),
          Object.assign(nameInput, { id: "rollcageNameInput" }),
        ]),
        el("div", { class: "session-bar-group" }, [
          el("button", { class: "btn small secondary", onclick: saveWithFlash }, [state.justSaved ? "Saved ✓" : "Save"]),
          el("button", { class: "btn small secondary", onclick: exportSessionToFile }, ["Export to file"]),
          el("button", { class: "btn small secondary", onclick: () => importInput.click() }, ["Import from file"]),
          importInput,
          el(
            "button",
            {
              class: "btn small secondary",
              onclick: () => {
                const all2 = loadAll();
                delete all2[state.sessionId];
                localStorage.setItem(STORAGE_KEY, JSON.stringify(all2));
                startNew();
              },
            },
            ["Delete this rollcage"]
          ),
        ]),
      ])
    );
  }

  function collapsiblePanelHeader(title, isExpanded, onToggle) {
    return el("div", { class: "results-header" }, [
      el("h2", {}, [title]),
      el("button", { class: "btn secondary", onclick: onToggle }, [isExpanded ? "Hide ▴" : "Show ▾"]),
    ]);
  }

  function textAnswerField(label, id, placeholder) {
    const answer = getAnswer(id);
    return el("div", { class: "field" }, [
      el("label", {}, [label]),
      el("input", {
        type: "text",
        value: answer.value || "",
        placeholder: placeholder || "",
        onchange: (e) => setAnswer(id, { value: e.target.value }),
      }),
    ]);
  }

  // A small 2-3-option radio field wired to a checklist answer (getAnswer/
  // setAnswer), same access pattern as textAnswerField -- unlike
  // state.vehicle.* fields (name/org/logbookStatus), which drive app
  // routing logic directly, this is for vehicle facts other parts of the
  // app (e.g. renderSafetyScore's driver-side callout) just read back.
  function answerRadioField(label, id, options) {
    const answer = getAnswer(id);
    return el("div", { class: "field" }, [
      el("label", {}, [label]),
      el(
        "div",
        { class: "radio-group" },
        options.map(([val, optLabel]) => radioOption(id, val, optLabel, answer.value === val, (v) => setAnswer(id, { value: v })))
      ),
    ]);
  }

  function renderVehicleDescription(root) {
    const vehiclePanel = el("div", { class: "panel" });
    vehiclePanel.appendChild(
      collapsiblePanelHeader("Vehicle description", state.vehicleExpanded, () => {
        state.vehicleExpanded = !state.vehicleExpanded;
        render();
      })
    );

    if (state.vehicleExpanded) {
      const nameField = el("div", { class: "field" }, [
        el("label", {}, ["Vehicle / entry name"]),
        el("input", {
          type: "text",
          value: state.vehicle.name,
          oninput: (e) => {
            state.vehicle.name = e.target.value;
            saveCurrent();
          },
        }),
      ]);
      vehiclePanel.appendChild(nameField);
      vehiclePanel.appendChild(
        el("div", { class: "field-row" }, [
          textAnswerField("Manufacturer", "vehicle_manufacturer"),
          textAnswerField("Model", "vehicle_model"),
          textAnswerField("Year", "vehicle_year"),
        ])
      );
      vehiclePanel.appendChild(
        el("div", { class: "field-row" }, [
          textAnswerField("VIN", "vehicle_vin"),
          textAnswerField("Rollcage builder (name & address)", "vehicle_builder"),
          textAnswerField("Build date", "vehicle_build_date"),
        ])
      );
      vehiclePanel.appendChild(
        el("div", { class: "field-row" }, [
          // Some sanctioning bodies' minimum tubing spec varies by vehicle
          // weight class -- captured here for that, even though the actual
          // weight-based tubing rule isn't implemented yet.
          textAnswerField("Vehicle weight", "vehicle_weight", "e.g. 1200 kg or 2650 lb"),
        ])
      );
      vehiclePanel.appendChild(
        el("div", { class: "field-row" }, [
          answerRadioField("Drive configuration", "vehicle_drive_side", [
            ["lhd", "Left-hand drive"],
            ["rhd", "Right-hand drive"],
          ]),
          // Which side actually needs the strongest protection depends on
          // whether the driver is ever alone in the car -- see
          // renderSafetyScore's "driver side" callout, which only applies
          // when running solo.
          answerRadioField("Occupants", "vehicle_codriver", [
            ["no", "Driver only"],
            ["yes", "Driver + Codriver"],
          ]),
        ])
      );
    }
    root.appendChild(vehiclePanel);
  }

  // Logbook paperwork fields (status/date, certificate #, sanctioning body,
  // logbook number, compliance path, homologation route, notes) -- appended
  // into an existing panel element. Shared by the bootstrap screen (no
  // pathId chosen yet, so no verdict to show) and the merged Logbook section
  // (renderResults) once a path is active.
  function appendLogbookFields(logbookPanel) {
    const statusField = el("div", { class: "field" }, [
      el("label", {}, ["Logbook status"]),
      el("div", { class: "radio-group" }, [
        radioOption("logbookStatus", "new", "New build (logbook not yet issued)", state.vehicle.logbookStatus === "new", (v) => {
          state.vehicle.logbookStatus = v;
          state.vehicle.logbookDate = "";
          state.pathId = suggestPath(state.vehicle);
          saveCurrent();
          render();
        }),
        radioOption("logbookStatus", "existing", "Existing logbook", state.vehicle.logbookStatus === "existing", (v) => {
          state.vehicle.logbookStatus = v;
          state.pathId = suggestPath(state.vehicle);
          saveCurrent();
          render();
        }),
      ]),
    ]);

    const dateField = el("div", { class: "field" }, [
      el("label", {}, ["Logbook issue date"]),
      el("input", {
        type: "date",
        value: state.vehicle.logbookDate || "",
        disabled: state.vehicle.logbookStatus !== "existing",
        oninput: (e) => {
          state.vehicle.logbookDate = e.target.value;
          state.pathId = suggestPath(state.vehicle);
          saveCurrent();
          render();
        },
      }),
    ]);

    logbookPanel.appendChild(el("div", { class: "field-row" }, [statusField, dateField]));

    const orgRules = RULES[state.vehicle.org];
    const suggested = suggestPath(state.vehicle);
    const activePath = state.pathId && orgRules.paths[state.pathId];
    const routeElm = activePath && activePath.elements.find((e) => e.id === "homologation_route");
    const routeAnswer = getAnswer("homologation_route");

    const certAnswer = getAnswer("vehicle_certificate_number");
    const certField = el("div", { class: "field" }, [
      el("label", {}, ["Certificate #, ASN (if applicable)"]),
      el("input", {
        type: "text",
        value: certAnswer.value || "",
        disabled: routeAnswer.value !== "homologated",
        onchange: (e) => setAnswer("vehicle_certificate_number", { value: e.target.value }),
      }),
    ]);

    const orgSelect = el("select", {
      onchange: (e) => {
        state.vehicle.org = e.target.value;
        // Answers are intentionally kept, not reset: element/option ids are
        // shared with the FIA 253 base across orgs, so existing answers
        // re-validate against the new org's rules automatically (a choice
        // that was a pass under one org but is disallowed under another
        // will now show as a fail/needs-review, via elementStatus/
        // tubingStatus's existing "unrecognized value" handling).
        if (!RULES[state.vehicle.org].paths[state.pathId]) {
          state.pathId = suggestPath(state.vehicle);
        }
        setAnswer("vehicle_logbook_body", { value: e.target.value });
        saveCurrent();
        render();
      },
    });
    Object.keys(RULES).forEach((orgKey) => {
      const opt = el("option", { value: orgKey }, [RULES[orgKey].orgFullName]);
      if (state.vehicle.org === orgKey) opt.selected = true;
      orgSelect.appendChild(opt);
    });
    const orgField = el("div", { class: "field" }, [el("label", {}, ["Logbook sanctioning body"]), orgSelect]);

    const logbookNumberAnswer = getAnswer("vehicle_logbook_number");
    const logbookNumberField = el("div", { class: "field" }, [
      el("label", {}, ["Logbook number"]),
      el("input", {
        type: "text",
        value: logbookNumberAnswer.value || "",
        onchange: (e) => setAnswer("vehicle_logbook_number", { value: e.target.value }),
      }),
    ]);

    logbookPanel.appendChild(el("div", { class: "field-row" }, [certField, orgField, logbookNumberField]));

    const pathField = el("div", { class: "field" }, [
      el("label", {}, ["Compliance path to check against"]),
      el("div", { class: "radio-group" }, [
        radioOption("pathId", "new_construction", orgRules.paths.new_construction.label, state.pathId === "new_construction", (v) => {
          state.pathId = v;
          saveCurrent();
          render();
        }),
        radioOption("pathId", "grandfathered", orgRules.paths.grandfathered.label, state.pathId === "grandfathered", (v) => {
          state.pathId = v;
          saveCurrent();
          render();
        }),
      ]),
      suggested
        ? el("div", { class: "path-suggestion" }, ["Suggested based on logbook date/status: " + orgRules.paths[suggested].label])
        : el("div", { class: "path-suggestion" }, ["Enter a logbook date, or choose 'new build', to get a suggestion."]),
    ]);
    logbookPanel.appendChild(pathField);

    if (routeElm) {
      const routeField = el("div", { class: "field" });
      routeField.appendChild(el("label", {}, [routeElm.name]));
      if (routeElm.description) routeField.appendChild(el("div", { class: "element-desc" }, [routeElm.description]));
      const group = el("div", { class: "choice-radio-group" });
      routeElm.options.forEach((opt) => {
        const inputId = "homologation_route_" + opt.id;
        const radio = el("input", {
          type: "radio",
          name: "homologation_route",
          id: inputId,
          onchange: () => setAnswer("homologation_route", { value: opt.id }),
        });
        radio.checked = routeAnswer.value === opt.id;
        group.appendChild(
          el(
            "label",
            { class: "choice-option" + (routeAnswer.value === opt.id ? " selected" : ""), for: inputId },
            [radio, el("div", { class: "choice-label" }, [opt.label])]
          )
        );
      });
      routeField.appendChild(group);
      const chosenOpt = routeElm.options.find((o) => o.id === routeAnswer.value);
      if (chosenOpt && chosenOpt.note) {
        routeField.appendChild(el("div", { class: "visual-flag" }, [chosenOpt.note]));
      }
      logbookPanel.appendChild(routeField);
    }

    const notesAnswer = getAnswer("vehicle_description_notes");
    const notesInput = el("textarea", {
      class: "note-input",
      placeholder: "Notes for this vehicle (e.g. anything unusual about the identification info above)...",
      onchange: (e) => setAnswer("vehicle_description_notes", { value: e.target.value }),
    });
    notesInput.value = notesAnswer.value || "";
    logbookPanel.appendChild(el("div", { class: "field" }, [el("label", {}, ["Notes"]), notesInput]));
  }

  function radioOption(name, value, label, checked, onChange) {
    const input = el("input", {
      type: "radio",
      name,
      value,
      onchange: (e) => onChange(e.target.value),
    });
    input.checked = checked;
    return el("label", {}, [input, label]);
  }

  // Rendered inline in the Logbook panel instead (appendLogbookFields) --
  // not part of the per-category checklist body below.
  const RENDERED_IN_LOGBOOK_PANEL = ["homologation_route", "vehicle_description_notes"];

  // ---- Phase grouping ---------------------------------------------------
  // Mirrors how an inspector actually works through a physical car: first
  // settle which bars/design exist at all (these are also exactly the
  // choices that drive the live 3D model), then measure every tube's
  // material/diameter/thickness in one pass with the sizing tool, then
  // finish everything else -- angles, distances, welds, gussets -- one
  // element at a time. A given document section (e.g. "7. Optional bars")
  // can and does have elements in more than one phase; its category
  // heading then simply reappears in each phase it has content in.
  const PHASE_1_DESIGN_CHOICE_IDS = new Set([
    "main_structure_layout",
    "main_rollbar_present",
    "lateral_rollbars_other",
    "transverse_member_253_3",
    "transverse_members_253_1",
    "main_hoop_diagonals",
    "backstays",
    "backstay_diagonals",
    "roof_bars",
    "roof_corner_gussets",
    "door_bars_left",
    "door_bars_right",
    "a_pillar_reinforcement",
    "harness_bar_present",
    "rear_lateral_reinforcement_present",
    "rear_transversal_present",
    "rear_lower_x_present",
    "anti_intrusion_present",
    "dash_bar_present",
    "lower_main_hoop_bar_present",
    "temple_bar_present",
    "windshield_reinforcement_present",
    "mounting_feet_design",
    "gusset_design",
  ]);
  const PHASE_LABELS = {
    1: "Part 1 — Structure & design choices",
    2: "Part 2 — Tubing sizes & materials",
    3: "Part 3 — Measurements, angles & welds",
    4: "Part 4 — Seats, belts & routing",
  };
  // Padding and sections 9-11 of the source document (seat mounting, belt
  // anchoring, routing of lines) are a distinct later stage of the
  // inspection -- occupant safety equipment rather than the cage structure
  // itself -- so they get their own phase instead of piling into Part 3.
  const PHASE_4_CATEGORIES = new Set(["Padding", "9. Seat mounting points", "10. Belt anchoring points", "11. Routing of lines"]);
  function isTubingSizingTable(elm) {
    if (elm.evaluationType === "tubing3solo") return true;
    if (elm.evaluationType === "plateSolo") return true;
    if (elm.evaluationType === "gussetSolo") return true;
    if (elm.id === "tubing_bar_classification") return true;
    if (elm.id === "mounting_feet_size") return true;
    if (elm.evaluationType !== "table" || !elm.columns) return false;
    const hasTubing3 = elm.columns.some((c) => c.type === "tubing3");
    const isGusset = elm.columns.some((c) => c.key === "corner_cutout"); // a gusset-dimensions table (length/corner-cutout/hole), not a tubing size table
    return hasTubing3 && !isGusset;
  }
  function elementPhase(elm) {
    if (PHASE_1_DESIGN_CHOICE_IDS.has(elm.id)) return 1;
    if (isTubingSizingTable(elm)) return 2;
    if (PHASE_4_CATEGORIES.has(elm.category)) return 4;
    return 3;
  }

  // ---- AI photo analysis (Part 1 pre-fill) -------------------------------
  // Experimental: upload photos of an installed cage (or a blueprint) and
  // have a vision model suggest which Part 1 design choices match, via a
  // small Vercel serverless function (api/analyze-cage.js) that proxies to
  // Gemini -- the API key never reaches the browser. Suggestions are never
  // applied automatically; the user reviews and accepts each one.
  //
  // Only "choice"/"boolean" Part 1 elements are offered -- gusset/mounting-
  // foot design (roof_corner_gussets, mounting_feet_design, gusset_design)
  // are per-location tables, much harder to identify reliably from photos,
  // and out of scope for now ("select the bars", not the gussets).
  const AI_SKIP_TABLE_IDS = new Set(["roof_corner_gussets", "mounting_feet_design", "gusset_design"]);
  function buildAiElementCatalog(path) {
    return path.elements
      .filter((elm) => PHASE_1_DESIGN_CHOICE_IDS.has(elm.id) && !AI_SKIP_TABLE_IDS.has(elm.id) && elementVisible(elm))
      .map((elm) => {
        const entry = { id: elm.id, name: elm.name, description: elm.description || "" };
        if (elm.evaluationType === "boolean") entry.boolean = true;
        else if (elm.evaluationType === "choice" && elm.options) entry.options = elm.options.map((o) => ({ id: o.id, label: o.label }));
        return entry;
      })
      .filter((entry) => entry.boolean || (entry.options && entry.options.length));
  }

  async function analyzeCagePhotos(files, path) {
    state.aiAnalysis = { status: "loading", suggestions: [], error: null, accepted: {} };
    render();
    try {
      const images = await Promise.all([...files].map((f) => resizeImageToBase64(f, 1280)));
      const elements = buildAiElementCatalog(path);
      const resp = await fetch("api/analyze-cage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, elements }),
      });
      let json = null;
      try { json = await resp.json(); } catch (e) { /* handled below via !resp.ok / missing json */ }
      if (!resp.ok) {
        state.aiAnalysis = { status: "error", suggestions: [], error: (json && json.error) || ("HTTP " + resp.status), accepted: {} };
      } else {
        const suggestions = (json && Array.isArray(json.suggestions)) ? json.suggestions : [];
        state.aiAnalysis = { status: "done", suggestions, error: null, accepted: {} };
      }
    } catch (e) {
      state.aiAnalysis = { status: "error", suggestions: [], error: e.message, accepted: {} };
    }
    render();
  }

  function renderPhotoAnalysis(root, path) {
    const panel = el("div", { class: "panel ai-analysis-panel" });
    panel.appendChild(el("h2", {}, ["Analyze photos (AI, experimental)"]));
    panel.appendChild(
      el("div", { class: "element-desc" }, [
        "Upload one or more photos of the installed cage (or a blueprint/diagram) -- multiple angles of the same cage help capture more of the design. A vision model will suggest which options below match; nothing is applied until you review and accept each suggestion.",
      ])
    );

    const ai = state.aiAnalysis;
    const fileInput = el("input", {
      type: "file",
      accept: "image/*",
      multiple: true,
      disabled: ai.status === "loading",
      onchange: (e) => {
        if (e.target.files && e.target.files.length) analyzeCagePhotos(e.target.files, path);
      },
    });
    panel.appendChild(el("div", { class: "field" }, [fileInput]));

    if (ai.status === "loading") {
      panel.appendChild(el("div", { class: "ai-status" }, ["Analyzing photos... this can take a little while."]));
    } else if (ai.status === "error") {
      panel.appendChild(el("div", { class: "ai-status ai-error" }, ["Analysis failed: " + ai.error]));
    } else if (ai.status === "done") {
      if (!ai.suggestions.length) {
        panel.appendChild(el("div", { class: "ai-status" }, ["No confident suggestions from these photos -- try clearer or additional angles."]));
      } else {
        const elementsById = {};
        path.elements.forEach((elm) => { elementsById[elm.id] = elm; });
        const list = el("div", { class: "ai-suggestion-list" });
        ai.suggestions.forEach((s) => {
          const elm = elementsById[s.elementId];
          if (!elm) return;
          const optLabel = elm.evaluationType === "boolean"
            ? (s.value === "yes" ? "Yes / Present" : "No / Absent")
            : (((elm.options || []).find((o) => o.id === s.value) || {}).label || s.value);
          const checkbox = el("input", {
            type: "checkbox",
            checked: !!ai.accepted[s.elementId],
            // Re-renders so the 3D preview highlight (see computeCageColors)
            // reflects the current check state immediately.
            onchange: (e) => { state.aiAnalysis.accepted[s.elementId] = e.target.checked; render(); },
          });
          list.appendChild(
            el("label", { class: "ai-suggestion-row" }, [
              checkbox,
              el("div", { class: "ai-suggestion-text" }, [
                el("div", {}, [el("strong", {}, [elm.name]), ": " + optLabel + " (" + s.confidence + " confidence)"]),
                el("div", { class: "visual-flag" }, [s.rationale]),
              ]),
            ])
          );
        });
        panel.appendChild(list);
        panel.appendChild(
          el("div", { class: "toolbar" }, [
            el(
              "button",
              {
                class: "btn secondary",
                onclick: () => {
                  ai.suggestions.forEach((s) => { state.aiAnalysis.accepted[s.elementId] = true; });
                  render();
                },
              },
              ["Select all"]
            ),
            el(
              "button",
              {
                class: "btn",
                onclick: () => {
                  ai.suggestions.forEach((s) => {
                    if (state.aiAnalysis.accepted[s.elementId]) setAnswer(s.elementId, { value: s.value });
                  });
                  state.aiAnalysis = { status: "idle", suggestions: [], error: null, accepted: {} };
                  render();
                },
              },
              ["Apply accepted suggestions"]
            ),
          ])
        );
      }
    }

    root.appendChild(panel);
  }

  // Safety score / Logbook / Vehicle description always trail the checklist
  // now (no more "Part 4" tab to move them behind) -- see render().
  function renderChecklist(root, path) {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", {}, ["Rollcage design"]));

    const visible = path.elements.filter(elementVisible).filter((elm) => !RENDERED_IN_LOGBOOK_PANEL.includes(elm.id));
    const phases = { 1: [], 2: [], 3: [], 4: [] };
    visible.forEach((elm) => phases[elementPhase(elm)].push(elm));
    const usedPhases = [1, 2, 3, 4].filter((p) => phases[p].length);
    const showTabs = usedPhases.length > 1;
    if (showTabs && !usedPhases.includes(state.activeTab)) state.activeTab = usedPhases[0];
    const shownPhases = showTabs ? [state.activeTab] : usedPhases;

    if (shownPhases.includes(1)) renderPhotoAnalysis(root, path);

    if (showTabs) {
      panel.appendChild(
        el(
          "div",
          { class: "phase-tabs" },
          usedPhases.map((p) =>
            el(
              "button",
              {
                class: "phase-tab" + (state.activeTab === p ? " active" : ""),
                onclick: () => { state.activeTab = p; render(); },
              },
              [PHASE_LABELS[p]]
            )
          )
        )
      );
    }

    // Part 3's own 3D view-mode toggle -- mirrors Part 2's tubing-spec
    // double-click view (see applyTubingClassificationView), but as an
    // explicit toggle rather than automatic-while-on-this-tab, since Part 3
    // has two different views (welds, junction distances) plus its normal
    // view, not just one. See applyPart3View() for exactly which bars each
    // view can currently highlight.
    if (state.activeTab === 3) {
      panel.appendChild(
        el("div", { class: "phase-tabs part3-view-tabs" }, [
          el(
            "button",
            {
              class: "phase-tab" + (state.part3ViewMode === "weld" ? " active" : ""),
              onclick: () => { state.part3ViewMode = state.part3ViewMode === "weld" ? null : "weld"; render(); },
            },
            ["Weld view"]
          ),
          el(
            "button",
            {
              class: "phase-tab" + (state.part3ViewMode === "junction" ? " active" : ""),
              onclick: () => { state.part3ViewMode = state.part3ViewMode === "junction" ? null : "junction"; render(); },
            },
            ["Bar junctions view"]
          ),
        ])
      );
      if (state.part3ViewMode) {
        panel.appendChild(
          el("div", { class: "element-desc" }, [
            state.part3ViewMode === "weld"
              ? "Double-click a highlighted bar in the 3D model to cycle its weld status: green = complete, red = incomplete, ghost = not yet checked. Some bars combine several weld points into one color (worst case wins) where the exact tube-to-weld-point geometry isn't verified -- door bars, and one leg of a 253-12 roof/253-21 rear diagonal."
              : "Bars below 100mm from their junction show green, over 100mm red, and not-yet-measured ghost. Door bars have no junction-distance data to show here.",
          ])
        );
      }
    }

    shownPhases.forEach((p) => {
      const byCategory = {};
      phases[p].forEach((elm) => {
        byCategory[elm.category] = byCategory[elm.category] || [];
        byCategory[elm.category].push(elm);
      });
      Object.keys(byCategory).forEach((cat) => {
        // "Cage Design" is skipped here -- it would just repeat the "Rollcage
        // design" panel heading right above it.
        if (cat !== "Cage Design") panel.appendChild(el("div", { class: "category-heading" }, [cat]));
        byCategory[cat].forEach((elm) => panel.appendChild(elm.evaluationType === "table" ? renderTableElement(elm) : renderElementCard(elm)));
      });
    });

    root.appendChild(panel);
  }

  // Whether elm has a definitive answer already -- used to auto-collapse a
  // completed question's card so answered items take up less room. Text/
  // longtext (identification fields, shared notes) are excluded: there's no
  // useful "collapsed" summary for those and they aren't the kind of
  // question this is for.
  // A dim field ({val, unit}) picking "Other" starts as {val:"", unit:"in"}
  // (see renderDimField) so its own custom-value input can appear -- that's
  // a truthy object but not actually filled in yet, so completeness checks
  // need this instead of just truthiness, or the card auto-collapses the
  // instant "Other" is picked, before there's anywhere left to type into.
  function dimHasValue(dim) { return !!dim && dim.val !== "" && dim.val !== undefined && dim.val !== null; }
  function isElementComplete(elm) {
    if (elm.evaluationType === "text" || elm.evaluationType === "longtext") return false;
    const answer = getAnswer(elm.id);
    if (elm.evaluationType === "numeric" && elm.fields) {
      const extra = answer.extra || {};
      return elm.fields.every((f) => extra[f.key] !== undefined && extra[f.key] !== "");
    }
    if (elm.evaluationType === "tubing3solo") {
      const v = answer.value;
      return !!(v && v.material && dimHasValue(v.diameter) && dimHasValue(v.thickness));
    }
    if (elm.evaluationType === "plateSolo" || elm.evaluationType === "gussetSolo") {
      const v = answer.value;
      return !!(v && v.material && dimHasValue(v.thickness));
    }
    const hasValue = answer.value !== undefined && answer.value !== null && answer.value !== "";
    if (!hasValue) return false;
    // A merged-in extra field (e.g. door bar design's "Sill bar" toggle)
    // has to be answered too, not just the main choice -- otherwise the
    // card auto-collapses the moment a design is picked and the user has
    // to reopen it to reach the sill-bar question.
    if (elm.extraFields) {
      const extra = answer.extra || {};
      return elm.extraFields.every((f) => {
        if (!extraFieldApplies(f, answer.value)) return true;
        return extra[f.key] !== undefined && extra[f.key] !== null && extra[f.key] !== "";
      });
    }
    return true;
  }

  // Short one-line summary shown on a collapsed card in place of its full
  // question body.
  function elementSummary(elm, answer) {
    if (elm.evaluationType === "choice") {
      const opt = (elm.options || []).find((o) => o.id === answer.value);
      return opt ? opt.label : String(answer.value);
    }
    if (elm.evaluationType === "boolean") {
      return answer.value === "yes" ? "Yes" : "No";
    }
    if (elm.evaluationType === "numeric" && elm.fields) {
      const extra = answer.extra || {};
      return elm.fields.map((f) => f.label + ": " + extra[f.key] + (f.unit ? " " + f.unit : "")).join(" · ");
    }
    if (elm.evaluationType === "numeric") {
      return answer.value + (elm.unit ? " " + elm.unit : "");
    }
    if (elm.evaluationType === "tubing3solo") {
      const v = answer.value || {};
      const req = (elm.requirements || []).find((r) => r.material === v.material);
      const matLabel = req ? req.label : v.material;
      const dim = (d) => (d ? d.val + (d.unit === "mm" ? "mm" : '"') : "");
      return matLabel + ", " + dim(v.diameter) + " x " + dim(v.thickness);
    }
    if (elm.evaluationType === "plateSolo" || elm.evaluationType === "gussetSolo") {
      const v = answer.value || {};
      const dim = (d) => (d ? d.val + (d.unit === "mm" ? "mm" : '"') : "");
      return (v.material || "") + ", " + dim(v.thickness);
    }
    return String(answer.value);
  }

  function renderElementCard(elm) {
    const answer = getAnswer(elm.id);
    const status = elementStatus(elm, answer);
    const reqBadgeClass = { required: "req", recommended: "rec", conditional: "cond", exception: "exc", informational: "info" }[elm.requirement] || "info";
    // Parts 1-3 are pure capture now (geometry, then tubing sizes/materials,
    // then measurements/angles/welds) -- required/recommended is a
    // compliance judgment, made against all that captured data in Part 4
    // instead, so the badge doesn't belong on any of these cards.
    const showReqBadge = false;

    if (isElementComplete(elm) && !state.expandedIds[elm.id]) {
      const card = el("div", { class: "element-card collapsed-card state-" + status, id: "section-" + elm.id });
      card.appendChild(
        el(
          "div",
          {
            class: "element-head collapsed-head",
            onclick: () => { state.expandedIds[elm.id] = true; render(); },
          },
          [
            el("span", { class: "element-name" }, [elm.name]),
            el("span", { class: "collapsed-summary" }, [elementSummary(elm, answer)]),
            showReqBadge ? el("span", { class: "badge " + reqBadgeClass }, [elm.requirement]) : null,
          ]
        )
      );
      return card;
    }

    const card = el("div", { class: "element-card state-" + status, id: "section-" + elm.id });

    const headChildren = [
      el("span", { class: "element-name" }, [elm.name]),
      showReqBadge ? el("span", { class: "badge " + reqBadgeClass }, [elm.requirement]) : null,
    ];
    if (isElementComplete(elm)) {
      headChildren.push(
        el("button", { class: "btn small secondary collapse-btn", onclick: () => { state.expandedIds[elm.id] = false; render(); } }, ["Collapse"])
      );
    }
    card.appendChild(el("div", { class: "element-head" }, headChildren));
    card.appendChild(el("div", { class: "element-ref" }, [elm.reference]));
    card.appendChild(el("div", { class: "element-desc" }, [elm.description]));

    if (elm.diagram && window.DIAGRAMS && window.DIAGRAMS[elm.diagram]) {
      card.appendChild(el("div", { class: "element-diagram", html: window.DIAGRAMS[elm.diagram] }));
    }

    if (elm.evaluationType === "choice") {
      const group = el("div", { class: "choice-radio-group" });
      elm.options.forEach((opt) => {
        const inputId = elm.id + "_" + opt.id;
        const radio = el("input", {
          type: "radio",
          name: elm.id,
          id: inputId,
          onchange: () => {
            // 253-1/253-2/253-3 all structurally guarantee a main rollbar
            // and 2 backstays by definition -- pre-select those (still
            // shown/editable) rather than hiding them outright.
            if (elm.id === "main_structure_layout" && ["253-1", "253-2", "253-3"].includes(opt.id)) {
              setAnswer("main_rollbar_present", { value: "yes" });
              setAnswer("backstays", { value: "yes" });
              // Clear any stale "Lateral rollbars" answer from a previous
              // visit to the "Other design" branch -- otherwise a leftover
              // "none" here would keep wrongly hiding roof/door/dash bars
              // (their showIf checks this field's raw answer, which
              // doesn't itself know the question is no longer relevant).
              setAnswer("lateral_rollbars_other", { value: "" });
            }
            // 253-22 (V backstay diagonal) is mandatory with a 253-14 roof
            // bar -- pre-select it (still shown/editable) if the user
            // hasn't already chosen a roof bar design themselves.
            if (elm.id === "backstay_diagonals" && opt.id === "253-22" && !getAnswer("roof_bars").value) {
              setAnswer("roof_bars", { value: "253-14" });
            }
            setAnswer(elm.id, { value: opt.id });
          },
        });
        radio.checked = answer.value === opt.id;
        const diagramHtml = opt.diagram && window.DIAGRAMS && window.DIAGRAMS[opt.diagram] ? window.DIAGRAMS[opt.diagram] : null;
        const legend = opt.diagram && window.DIAGRAM_LEGENDS && window.DIAGRAM_LEGENDS[opt.diagram];
        const legendEl = legend
          ? el(
              "div",
              { class: "diagram-legend" },
              legend.map((item) => el("div", { style: "color:" + item.color }, [item.label]))
            )
          : null;
        const optionLabel = el(
          "label",
          { class: "choice-option" + (answer.value === opt.id ? " selected" : ""), for: inputId },
          [
            radio,
            diagramHtml ? el("div", { class: "choice-diagram", html: diagramHtml }) : null,
            legendEl,
            el("div", { class: "choice-label" }, [opt.label]),
          ]
        );
        group.appendChild(optionLabel);
      });
      card.appendChild(group);
      const chosenOpt = elm.options.find((o) => o.id === answer.value);
      if (chosenOpt && chosenOpt.note) {
        card.appendChild(el("div", { class: "visual-flag" }, [chosenOpt.note]));
      }
    } else if (elm.evaluationType === "tubing3solo") {
      card.appendChild(renderTubing3Fields(elm, elm.id, answer));
    } else if (elm.evaluationType === "plateSolo" || elm.evaluationType === "gussetSolo") {
      card.appendChild(renderPlateSoloFields(elm.id, answer));
    } else if (elm.evaluationType === "numeric" && elm.fields) {
      const values = answer.value || {};
      elm.fields.forEach((f) => {
        const input = el("input", {
          type: "number",
          step: "any",
          class: "numeric-input",
          value: values[f.key] || "",
          onchange: (e) => {
            const next = Object.assign({}, getAnswer(elm.id).value || {}, { [f.key]: e.target.value });
            setAnswer(elm.id, { value: next });
          },
        });
        card.appendChild(
          el("div", { class: "numeric-row" }, [
            el("span", { class: "numeric-field-label" }, [f.label]),
            input,
            el("span", { class: "unit-label" }, [f.unit || ""]),
          ])
        );
      });
    } else if (elm.evaluationType === "numeric") {
      const input = el("input", {
        type: "number",
        step: "any",
        class: "numeric-input",
        value: answer.value || "",
        onchange: (e) => setAnswer(elm.id, { value: e.target.value }),
      });
      card.appendChild(el("div", { class: "numeric-row" }, [input, el("span", { class: "unit-label" }, [elm.unit || ""])]));
      if (elm.warnCompare && elm.warnMessage && answer.value !== "" && answer.value !== undefined && compareOk(parseFloat(answer.value), elm.warnCompare)) {
        card.appendChild(el("div", { class: "numeric-warning" }, [elm.warnMessage]));
      }
    } else if (elm.evaluationType === "text") {
      const input = el("input", {
        type: "text",
        class: "text-input",
        value: answer.value || "",
        onchange: (e) => setAnswer(elm.id, { value: e.target.value }),
      });
      card.appendChild(input);
    } else if (elm.evaluationType === "longtext") {
      const input = el("textarea", {
        class: "note-input",
        placeholder: elm.placeholder || "Notes...",
        onchange: (e) => setAnswer(elm.id, { value: e.target.value }),
      });
      input.value = answer.value || "";
      card.appendChild(input);
    } else {
      // A plain fact/compliance question (e.g. "is the cage within the
      // suspension points?") reads oddly as "Yes / Present" -- yesNoLabels
      // lets a specific element override the default presence-style
      // wording with plain "Yes"/"No" (or any other 2-label pair).
      const opts = elm.yesNoLabels ? [["yes", elm.yesNoLabels[0]], ["no", elm.yesNoLabels[1]]] : [["yes", "Yes / Present"], ["no", "No / Absent"]];
      const row = el(
        "div",
        { class: "answer-row" },
        opts.map(([val, label]) =>
          el(
            "button",
            {
              class: "answer-btn " + (answer.value === val ? "active " + val : ""),
              onclick: () => setAnswer(elm.id, { value: val }),
            },
            [label]
          )
        )
      );
      card.appendChild(row);
    }

    if (elm.extraFields) {
      const extra = answer.extra || {};
      elm.extraFields.forEach((f) => {
        if (!extraFieldApplies(f, answer.value)) return;
        if (f.type === "boolean") {
          const setVal = (val) => {
            const next = Object.assign({}, getAnswer(elm.id).extra || {}, { [f.key]: val });
            setAnswer(elm.id, { extra: next });
          };
          // A diagram-carrying boolean renders as a single checkbox tile
          // matching the main choice options' look (icon + top-left
          // indicator) instead of a plain Yes/No pair -- checked toggles
          // straight between "yes"/"no" (there's no third "unanswered"
          // state once ticked, same as any other checkbox).
          if (f.diagram) {
            const checked = extra[f.key] === "yes";
            const diagramHtml = window.DIAGRAMS && window.DIAGRAMS[f.diagram];
            const checkbox = el("input", {
              type: "checkbox",
              onchange: (e) => setVal(e.target.checked ? "yes" : "no"),
            });
            checkbox.checked = checked;
            card.appendChild(
              el("div", { class: "choice-radio-group" }, [
                el("label", { class: "choice-option" + (checked ? " selected" : "") }, [
                  checkbox,
                  diagramHtml ? el("div", { class: "choice-diagram", html: diagramHtml }) : null,
                  el("div", { class: "choice-label" }, [f.label]),
                ]),
              ])
            );
            return;
          }
          card.appendChild(
            el("div", { class: "extra-field-row" }, [
              el("span", { class: "numeric-field-label" }, [f.label]),
              el("div", { class: "answer-row" }, [
                el("button", { class: "answer-btn " + (extra[f.key] === "yes" ? "active yes" : ""), onclick: () => setVal("yes") }, ["Yes"]),
                el("button", { class: "answer-btn " + (extra[f.key] === "no" ? "active no" : ""), onclick: () => setVal("no") }, ["No"]),
              ]),
            ])
          );
          return;
        }
        const input = el("input", {
          type: "number",
          step: "any",
          class: "numeric-input",
          value: extra[f.key] || "",
          onchange: (e) => {
            const next = Object.assign({}, getAnswer(elm.id).extra || {}, { [f.key]: e.target.value });
            setAnswer(elm.id, { extra: next });
          },
        });
        card.appendChild(
          el("div", { class: "numeric-row" }, [
            el("span", { class: "numeric-field-label" }, [f.label]),
            input,
            el("span", { class: "unit-label" }, [f.unit || ""]),
          ])
        );
      });
    }


    if (elm.tubing && elm.tubing.length) {
      const tubingWrap = el("div", { class: "tubing-block" });
      elm.tubing.forEach((sub, idx) => {
        const subId = elm.id + "__tubing_" + idx;
        const subAnswer = getAnswer(subId);
        const subStatus = tubingStatus(sub, subAnswer);
        const subField = el("div", { class: "tubing-field state-" + subStatus });
        subField.appendChild(
          el("div", { class: "tubing-label" }, [sub.label + " — " + sub.classification, el("span", { class: "element-ref" }, [" (" + sub.reference + ")"])])
        );
        subField.appendChild(sub.requirements ? renderTubing3Fields(sub, subId, subAnswer) : renderTubingLegacySelect(sub, subId, subAnswer));
        tubingWrap.appendChild(subField);
      });
      card.appendChild(tubingWrap);
    }

    // Notes -- skipped for pure identification fields (text) and the
    // shared section-level notes field itself (longtext), which don't
    // need their own separate per-field note. Also skipped for every Part 1
    // design-choice card: those are quick yes/no/which-design picks meant to
    // drive the live 3D model, not a place to record observations.
    if (
      elm.evaluationType !== "text" &&
      elm.evaluationType !== "longtext" &&
      !elm.noCapture &&
      !elm.hideNotes &&
      !PHASE_1_DESIGN_CHOICE_IDS.has(elm.id)
    ) {
      const noteInput = el("textarea", {
        class: "note-input",
        placeholder: "Notes (e.g. measured value, what you observed)...",
        oninput: (e) => {
          answer.note = e.target.value;
          state.answers[elm.id] = answer;
          // debounce save on blur instead of every keystroke render
        },
        onblur: () => setAnswer(elm.id, { note: answer.note }),
      });
      noteInput.value = answer.note || "";
      card.appendChild(noteInput);
    }

    // Photos -- not applicable to pure identification fields (vehicle
    // description: manufacturer, VIN, etc.) since there's nothing to
    // visually verify there. `sectionPhotos` is the one exception: a
    // shared section-level notes (longtext) field that also collects
    // photos on behalf of the whole section, instead of every element in
    // it carrying its own upload.
    if (PHOTOS_ENABLED && ((elm.evaluationType !== "text" && elm.evaluationType !== "longtext" && !elm.noCapture && !elm.hidePhotos) || elm.sectionPhotos)) {
      const photoRow = el(
        "div",
        { class: "photo-row" },
        (answer.photos || []).map((p, idx) =>
          el("div", { class: "photo-thumb" }, [
            el("img", { src: p.dataUrl, alt: p.name }),
            el(
              "button",
              {
                onclick: () => {
                  const photos = (answer.photos || []).slice();
                  photos.splice(idx, 1);
                  setAnswer(elm.id, { photos });
                },
              },
              ["x"]
            ),
          ])
        )
      );
      card.appendChild(photoRow);

      const fileInput = el("input", {
        type: "file",
        accept: "image/*",
        multiple: "multiple",
        onchange: async (e) => {
          const files = Array.from(e.target.files || []);
          const newPhotos = [];
          for (const f of files) {
            const dataUrl = await fileToDataUrl(f);
            newPhotos.push({ name: f.name, dataUrl });
          }
          setAnswer(elm.id, { photos: (answer.photos || []).concat(newPhotos) });
        },
      });
      card.appendChild(fileInput);
    }

    return card;
  }

  function renderTubingLegacySelect(sub, subId, subAnswer) {
    const select = el("select", { onchange: (e) => setAnswer(subId, { value: e.target.value }) });
    select.appendChild(el("option", { value: "" }, ["-- select tubing --"]));
    sub.options.forEach((opt) => {
      const o = el("option", { value: opt.id }, [opt.label]);
      if (subAnswer.value === opt.id) o.selected = true;
      select.appendChild(o);
    });
    return select;
  }

  function renderDimField(labelText, presets, current, onChange) {
    const isPreset = current && presets.some((p) => p.val === current.val && p.unit === current.unit);
    const isOther = !!current && !isPreset;
    const select = el("select", {
      onchange: (e) => {
        if (e.target.value === "other") { onChange({ val: "", unit: "in" }); return; }
        const [val, unit] = e.target.value.split("|");
        onChange({ val: parseFloat(val), unit });
      },
    });
    select.appendChild(el("option", { value: "" }, ["-- select --"]));
    presets.forEach((p) => {
      const key = p.val + "|" + p.unit;
      const o = el("option", { value: key }, [dimLabel(p)]);
      if (current && current.val === p.val && current.unit === p.unit) o.selected = true;
      select.appendChild(o);
    });
    const otherOpt = el("option", { value: "other" }, ["Other"]);
    if (isOther) otherOpt.selected = true;
    select.appendChild(otherOpt);

    const children = [el("label", {}, [labelText]), select];
    if (isOther) {
      const numInput = el("input", {
        type: "number", step: "any", class: "dim-other-value",
        value: current.val === "" || current.val == null ? "" : current.val,
        onchange: (e) => onChange({ val: e.target.value, unit: current.unit || "in" }),
      });
      const unitSelect = el("select", { onchange: (e) => onChange({ val: current.val, unit: e.target.value }) });
      ["in", "mm"].forEach((u) => {
        const o = el("option", { value: u }, [u]);
        if ((current.unit || "in") === u) o.selected = true;
        unitSelect.appendChild(o);
      });
      children.push(numInput, unitSelect);
    }
    return el("div", { class: "tubing3-field" }, children);
  }

  function renderTubing3Fields(sub, subId, subAnswer) {
    const v = subAnswer.value || {};
    const wrap = el("div", { class: "tubing3-fields" });

    const matSelect = el("select", {
      onchange: (e) => setAnswer(subId, { value: Object.assign({}, v, { material: e.target.value }) }),
    });
    matSelect.appendChild(el("option", { value: "" }, ["-- material --"]));
    sub.requirements.forEach((r) => {
      const o = el("option", { value: r.material }, [r.label]);
      if (v.material === r.material) o.selected = true;
      matSelect.appendChild(o);
    });
    const otherMatOpt = el("option", { value: "other" }, ["Other"]);
    if (v.material === "other") otherMatOpt.selected = true;
    matSelect.appendChild(otherMatOpt);
    wrap.appendChild(el("div", { class: "tubing3-field" }, [el("label", {}, ["Material"]), matSelect]));

    wrap.appendChild(renderDimField("Diameter", DIAMETER_PRESETS, v.diameter, (dim) => setAnswer(subId, { value: Object.assign({}, v, { diameter: dim }) })));
    wrap.appendChild(renderDimField("Thickness", THICKNESS_PRESETS, v.thickness, (dim) => setAnswer(subId, { value: Object.assign({}, v, { thickness: dim }) })));

    return wrap;
  }

  // Mounting foot plates: material (free text -- no material-specific rule,
  // unlike tubes) + thickness only (reusing the same preset-dropdown +
  // "Other" mechanism as tube thickness, which already includes 3mm/0.12"
  // -- right at the FIA minimum for plates).
  function renderPlateSoloFields(subId, subAnswer) {
    const v = subAnswer.value || {};
    const wrap = el("div", { class: "tubing3-fields" });
    const matInput = el("input", {
      type: "text", value: v.material || "", placeholder: "e.g. Mild steel",
      onchange: (e) => setAnswer(subId, { value: Object.assign({}, v, { material: e.target.value }) }),
    });
    wrap.appendChild(el("div", { class: "tubing3-field" }, [el("label", {}, ["Material"]), matInput]));
    wrap.appendChild(renderDimField("Thickness", THICKNESS_PRESETS, v.thickness, (dim) => setAnswer(subId, { value: Object.assign({}, v, { thickness: dim }) })));
    return wrap;
  }

  // ---- Table elements (named rows x columns) --------------------------
  function renderTableCellInput(col, cellId, cellAnswer, row) {
    if (col.type === "boolean") {
      return el("div", { class: "cell-answer-row" }, [
        el("button", { class: "answer-btn small " + (cellAnswer.value === "yes" ? "active yes" : ""), onclick: () => setAnswer(cellId, { value: "yes" }) }, ["Yes"]),
        el("button", { class: "answer-btn small " + (cellAnswer.value === "no" ? "active no" : ""), onclick: () => setAnswer(cellId, { value: "no" }) }, ["No"]),
      ]);
    }
    // Same yes/no value convention as "boolean" (so tableCellStatus treats
    // "no" as an actual fail, not just a data-capture choice), but labeled
    // as a compliance judgment rather than a presence/absence fact.
    if (col.type === "compliance") {
      return el("div", { class: "cell-answer-row" }, [
        el("button", { class: "answer-btn small " + (cellAnswer.value === "yes" ? "active yes" : ""), onclick: () => setAnswer(cellId, { value: "yes" }) }, ["Compliant"]),
        el("button", { class: "answer-btn small " + (cellAnswer.value === "no" ? "active no" : ""), onclick: () => setAnswer(cellId, { value: "no" }) }, ["Not compliant"]),
      ]);
    }
    if (col.type === "number") {
      return el("input", { type: "number", step: "any", class: "cell-number", value: cellAnswer.value || "", onchange: (e) => setAnswer(cellId, { value: e.target.value }) });
    }
    if (col.type === "select") {
      const select = el("select", { onchange: (e) => setAnswer(cellId, { value: e.target.value }) });
      select.appendChild(el("option", { value: "" }, ["--"]));
      (col.options || []).forEach((opt) => {
        const o = el("option", { value: opt.id }, [opt.label]);
        if (cellAnswer.value === opt.id) o.selected = true;
        select.appendChild(o);
      });
      return select;
    }
    if (col.type === "tubing3") {
      return renderTubing3Fields(col, cellId, cellAnswer);
    }
    if (col.type === "area") {
      const v = cellAnswer.value || {};
      const mode = v.mode === "xy" ? "xy" : "direct";
      const unit = v.unit || "cm2";
      const unitSelect = el("select", {
        onchange: (e) => setAnswer(cellId, { value: Object.assign({}, v, { unit: e.target.value }) }),
      });
      [{ id: "cm2", label: "cm²" }, { id: "in2", label: "in²" }].forEach((u) => {
        const o = el("option", { value: u.id }, [u.label]);
        if (unit === u.id) o.selected = true;
        unitSelect.appendChild(o);
      });
      const modeToggle = el("div", { class: "cell-answer-row area-mode-toggle" }, [
        el("button", {
          class: "answer-btn small" + (mode === "direct" ? " active info" : ""),
          onclick: () => setAnswer(cellId, { value: Object.assign({}, v, { mode: "direct" }) }),
        }, ["Area"]),
        el("button", {
          class: "answer-btn small" + (mode === "xy" ? " active info" : ""),
          onclick: () => setAnswer(cellId, { value: Object.assign({}, v, { mode: "xy" }) }),
        }, ["X × Y"]),
      ]);
      if (mode === "xy") {
        // X/Y are in the same unit as the area itself (cm or in, matching
        // cm2/in2) -- area is recomputed and written into the same
        // `value`/`unit` fields the direct-entry mode uses, so everything
        // downstream (status, Part 4 compliance) reads area answers the
        // same way regardless of how the plate's size was captured.
        const lengthUnit = unit === "in2" ? "in" : "cm";
        function recompute(nx, ny) {
          const fx = parseFloat(nx), fy = parseFloat(ny);
          const area = nx !== "" && ny !== "" && !isNaN(fx) && !isNaN(fy) ? String(fx * fy) : "";
          setAnswer(cellId, { value: Object.assign({}, v, { x: nx, y: ny, value: area }) });
        }
        const xInput = el("input", {
          type: "number", step: "any", class: "cell-number small", placeholder: "X", value: v.x ?? "",
          onchange: (e) => recompute(e.target.value, v.y ?? ""),
        });
        const yInput = el("input", {
          type: "number", step: "any", class: "cell-number small", placeholder: "Y", value: v.y ?? "",
          onchange: (e) => recompute(v.x ?? "", e.target.value),
        });
        const area = parseFloat(v.value);
        const computed = el("span", { class: "area-computed" }, [
          !isNaN(area) && v.value !== "" ? "= " + area.toFixed(1) + " " + (unit === "in2" ? "in²" : "cm²") : "",
        ]);
        return el("div", { class: "cell-answer-row area-cell" }, [
          modeToggle,
          xInput, el("span", { class: "area-xy-sep" }, [lengthUnit + " ×"]), yInput, el("span", { class: "area-xy-sep" }, [lengthUnit]),
          unitSelect, computed,
        ]);
      }
      const numInput = el("input", {
        type: "number", step: "any", class: "cell-number", value: v.value ?? "",
        onchange: (e) => setAnswer(cellId, { value: Object.assign({}, v, { value: e.target.value }) }),
      });
      return el("div", { class: "cell-answer-row area-cell" }, [modeToggle, numInput, unitSelect]);
    }
    if (col.type === "radio") {
      // A row can restrict which of the column's options actually apply to
      // it (e.g. A-pillar/253-15 gussets can only ever be a taco, never a
      // single plate) via row.restrictOptionIds -- the "clear" option (id
      // "") is always kept regardless, so there's still a way to unanswer
      // the row.
      const options = row && row.restrictOptionIds
        ? (col.options || []).filter((o) => o.id === "" || row.restrictOptionIds.includes(o.id))
        : (col.options || []);
      return el(
        "div",
        { class: "cell-answer-row" },
        options.map((opt) => {
          const active = cellAnswer.value === opt.id;
          const color = RADIO_OPTION_COLOR[opt.id];
          return el(
            "button",
            {
              class: "answer-btn small" + (active && !color ? " active info" : ""),
              style: active && color ? "background:" + color + "22;border-color:" + color + ";color:" + color : "",
              onclick: () => setAnswer(cellId, { value: opt.id }),
            },
            [opt.label]
          );
        })
      );
    }
    return el("input", { type: "text", class: "cell-text", value: cellAnswer.value || "", onchange: (e) => setAnswer(cellId, { value: e.target.value }) });
  }

  function renderTableElement(elm) {
    const status = tableElementStatus(elm);
    const card = el("div", { class: "element-card state-" + status, id: "section-" + elm.id });
    const reqBadgeClass = { required: "req", recommended: "rec", conditional: "cond", exception: "exc", informational: "info" }[elm.requirement] || "info";
    // Same as renderElementCard -- Parts 1-3 are pure capture, no
    // compliance judgment shown there (that's Part 4's job).
    const showReqBadge = false;
    card.appendChild(
      el("div", { class: "element-head" }, [
        el("span", { class: "element-name" }, [elm.name]),
        showReqBadge ? el("span", { class: "badge " + reqBadgeClass }, [elm.requirement]) : null,
      ])
    );
    card.appendChild(el("div", { class: "element-ref" }, [elm.reference]));
    if (elm.description) card.appendChild(el("div", { class: "element-desc" }, [elm.description]));
    if (elm.diagram && window.DIAGRAMS && window.DIAGRAMS[elm.diagram]) {
      card.appendChild(el("div", { class: "element-diagram", html: window.DIAGRAMS[elm.diagram] }));
    }

    let quickChecked = false;
    if (elm.distanceQuickCheck) {
      const quickId = distanceQuickCheckId(elm);
      const quickAnswer = getAnswer(quickId);
      quickChecked = quickAnswer.value === "yes";
      card.appendChild(
        el("div", { class: "quick-check-row" }, [
          el("label", { class: "quick-check-label" }, [
            el("input", {
              type: "checkbox",
              checked: quickChecked,
              onchange: (e) => setAnswer(quickId, { value: e.target.checked ? "yes" : "" }),
            }),
            "All junctions below confirmed under 100mm (skip entering each one individually)",
          ]),
        ])
      );
    }

    const table = el("table", { class: "row-table" + (quickChecked ? " row-table-skipped" : "") });
    table.appendChild(el("thead", {}, [el("tr", {}, [el("th", {}, ["Location"])].concat(elm.columns.map((c) => el("th", {}, [c.label]))))]));
    const tbody = el("tbody");
    resolveRows(elm).forEach((row) => {
      const tr = el("tr", { id: "row-" + elm.id + "__" + row.id });
      tr.appendChild(el("td", { class: "row-table-label" }, [row.label]));
      elm.columns.forEach((col) => {
        const cellId = tableCellId(elm, row, col);
        const cellAnswer = getAnswer(cellId);
        const cellStatus = tableCellStatus(col, cellAnswer);
        const td = el("td", { class: "state-" + cellStatus });
        td.appendChild(renderTableCellInput(col, cellId, cellAnswer, row));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(el("div", { class: "row-table-wrap" }, [table]));
    return card;
  }

  // ---- Safety score (qualitative, provisional) ---------------------------
  // A separate, sanctioning-body-independent "how good is this design"
  // rating -- explicitly a work in progress per the user's own framing ("we
  // will refine further once we have angle and tube specs"), so only the
  // elements/values rated below appear in the list; everything else is
  // intentionally left out rather than guessed at. The eventual 0-100
  // aggregate score still isn't designed (needs those angle/tube-spec
  // rules first), so for now this is just the per-element green/orange/red
  // list itself.
  function doorBarSafetyTier(v) {
    if (v === "253-9-intersection-1" || v === "253-9-intersection-2" || v === "253-9-bent") return "green";
    if (v === "253-10" || v === "253-11" || v === "nascar") return "orange";
    if (v === "single-bar" || v === "none") return "red";
    return null;
  }
  // Optional bars: any real design present is a bonus (green) no matter how
  // simple -- unlike a required element, a single-tube optional bar isn't a
  // compromise, it's just less bar than a fancier one would be. Absence
  // isn't a deficiency either (that's the normal baseline for something
  // optional), so it's left unrated rather than marked down for it.
  function optionalBarSafetyTier(v) {
    if (!v || v === "no" || v === "none") return null;
    return "green";
  }
  const SAFETY_TIER_RULES = {
    main_rollbar_present: (v) => (v === "yes" ? "green" : v === "no" ? "red" : null),
    main_hoop_diagonals: (v) => ({
      "253-7": "green",
      "diag-left": "orange", "diag-right": "orange",
      "diag-horizontal": "red", "diag-lower-half": "red", "diag-v-center": "red",
    }[v] || null),
    roof_bars: (v) => ({
      "253-12-1": "green", "253-12-2": "green", "253-14": "green",
      "rb-4": "orange",
      "253-13": "red", "single-center": "red", "single-front-left": "red", "single-front-right": "red", "none": "red",
    }[v] || null),
    backstay_diagonals: (v) => ({
      "253-21": "green", "253-22": "green",
      "253-20": "orange", "253-20-right": "orange",
      "none": "red",
    }[v] || null),
    door_bars_left: doorBarSafetyTier,
    door_bars_right: doorBarSafetyTier,
    harness_bar_present: optionalBarSafetyTier,
    rear_lateral_reinforcement_present: optionalBarSafetyTier,
    rear_transversal_present: optionalBarSafetyTier,
    rear_lower_x_present: optionalBarSafetyTier,
    anti_intrusion_present: optionalBarSafetyTier,
    dash_bar_present: optionalBarSafetyTier,
    lower_main_hoop_bar_present: optionalBarSafetyTier,
    temple_bar_present: optionalBarSafetyTier,
    windshield_reinforcement_present: optionalBarSafetyTier,
  };

  function renderSafetyScore(root, path) {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", {}, ["Safety score"]));
    panel.appendChild(
      el("div", { class: "safety-score-placeholder" }, [
        "First-pass, provisional ratings below (green/orange/red) per a set of safety rules of thumb -- independent of any specific sanctioning body's requirements, and not yet a single 0-100 score (that needs angle and tube-spec rules first). Not every element is rated yet.",
      ])
    );

    // Without a codriver, the driver is the only occupant, so whichever
    // side they actually sit on (derived from drive configuration -- LHD
    // sits left, RHD sits right) is the one side where a weak rating
    // actually matters for driver protection; with a codriver, both sides
    // protect someone, so no side gets singled out.
    const driveSide = getAnswer("vehicle_drive_side").value;
    const hasCodriver = getAnswer("vehicle_codriver").value;
    const driverSide = hasCodriver === "no" && driveSide ? (driveSide === "lhd" ? "left" : "right") : null;
    function sideOf(id) {
      if (id.endsWith("_left")) return "left";
      if (id.endsWith("_right")) return "right";
      return null;
    }
    function driverSideSuffix(id) {
      return driverSide && sideOf(id) === driverSide ? " (driver side)" : "";
    }
    if (driverSide) {
      panel.appendChild(
        el("div", { class: "safety-score-placeholder" }, [
          "Running solo (no codriver) with " + (driveSide === "lhd" ? "left-hand drive" : "right-hand drive") +
            " -- the driver sits on the " + driverSide + ", so items marked \"(driver side)\" below matter most for driver protection.",
        ])
      );
    }

    const list = el("div", { class: "safety-tier-list" });
    function addRow(id, label, tier, valueText) {
      if (!tier) return; // unrated (unanswered, or no rule yet) -- omit rather than show a meaningless row
      list.appendChild(
        el("div", { class: "safety-tier-row tier-" + tier }, [
          el("span", { class: "safety-tier-dot" }),
          el("span", { class: "safety-tier-label" }, [label + driverSideSuffix(id)]),
          el("span", { class: "safety-tier-value" }, [valueText]),
        ])
      );
    }

    Object.keys(SAFETY_TIER_RULES).forEach((elmId) => {
      const elm = path.elements.find((e) => e.id === elmId);
      if (!elm || !elementVisible(elm)) return;
      const answer = getAnswer(elmId);
      const tier = SAFETY_TIER_RULES[elmId](answer.value);
      addRow(elmId, elm.name, tier, answer.value ? elementSummary(elm, answer) : "Not yet answered");
    });

    // A-pillar (253-15) lateral gusset -- missing is a known, specific gap
    // (orange), not as severe as a genuinely absent required bar.
    const gussetDesignElm = path.elements.find((e) => e.id === "gusset_design");
    if (gussetDesignElm) {
      const gussetOptions = (gussetDesignElm.columns.find((c) => c.key === "design") || {}).options || [];
      const rowsById = new Map(resolveRows(gussetDesignElm).map((r) => [r.id, r]));
      [["a_pillar_left", "Lateral to A-pillar gusset — left"], ["a_pillar_right", "Lateral to A-pillar gusset — right"]].forEach(([row, label]) => {
        if (!rowsById.has(row)) return;
        const design = getAnswer("gusset_design__" + row + "__design").value;
        const optLabel = (gussetOptions.find((o) => o.id === design) || {}).label;
        addRow(row, label, design ? "green" : "orange", design ? optLabel || design : "Missing");
      });
    }

    // Front/main-hoop mounting feet: a plain single-plane plate (253-50/51/
    // 52) is the weakest of the real options there. Backstay feet aren't
    // rated yet -- no rule of thumb given for those.
    const feetElm = path.elements.find((e) => e.id === "mounting_feet_design");
    const feetOptions = feetElm ? ((feetElm.columns.find((c) => c.key === "design") || {}).options || []) : [];
    const FOOT_ROW_LABELS = {
      front_left: "Mounting foot — front left", front_right: "Mounting foot — front right",
      main_hoop_left: "Mounting foot — main hoop left", main_hoop_right: "Mounting foot — main hoop right",
    };
    FOOT_LOCATIONS.forEach(({ row }) => {
      if (!FRONT_FOOT_ROWS.has(row)) return;
      const design = getAnswer("mounting_feet_design__" + row + "__design").value;
      if (!design) return;
      const optLabel = (feetOptions.find((o) => o.id === design) || {}).label || design;
      addRow(row, FOOT_ROW_LABELS[row], design === "single_plane" ? "red" : "green", optLabel);
    });

    panel.appendChild(list);
    root.appendChild(panel);
  }

  function renderResults(root, path) {
    const results = computeResults(path);

    if (!state.resultsExpanded) {
      const collapsed = el("div", { class: "panel results-panel results-panel-collapsed" }, [
        el("h2", {}, ["Logbook"]),
        el("div", { class: "verdict compact " + results.verdict.level }, [results.verdict.label]),
        el("div", { class: "results-summary" }, [
          results.requiredSatisfied + " / " + results.requiredTotal + " required items (" + results.scorePct + "%)",
        ]),
        el(
          "button",
          { class: "btn secondary", onclick: () => { state.resultsExpanded = true; render(); } },
          ["Show details ▾"]
        ),
      ]);
      root.appendChild(collapsed);
      return;
    }

    const panel = el("div", { class: "panel results-panel" });

    panel.appendChild(
      el("div", { class: "results-header" }, [
        el("h2", {}, ["Logbook"]),
        el(
          "button",
          { class: "btn secondary", onclick: () => { state.resultsExpanded = false; render(); } },
          ["Hide details ▴"]
        ),
      ])
    );
    panel.appendChild(el("div", { class: "verdict " + results.verdict.level }, [results.verdict.label]));
    panel.appendChild(el("div", {}, [results.verdict.detail]));

    panel.appendChild(
      el("div", { class: "score-bar-outer" }, [
        el("div", { class: "score-bar-inner", style: "width:" + results.scorePct + "%" }),
      ])
    );
    panel.appendChild(el("div", {}, [results.requiredSatisfied + " / " + results.requiredTotal + " required items satisfied (" + results.scorePct + "%)"]));

    if (!results.verdict.exempt && results.failures.length) {
      panel.appendChild(el("h2", {}, ["Failing required items"]));
      panel.appendChild(
        el(
          "ul",
          { class: "issue-list" },
          results.failures.map((f) => el("li", {}, [f.name + " — " + (f.hardFailMessage || "") + " (" + f.reference + ")"]))
        )
      );
    }
    if (!results.verdict.exempt && results.unresolved.length) {
      panel.appendChild(el("h2", {}, ["Needs verification"]));
      panel.appendChild(
        el(
          "ul",
          { class: "issue-list" },
          results.unresolved.map((f) => el("li", {}, [f.name + " (" + f.reference + ")"]))
        )
      );
    }
    if (!results.verdict.exempt && results.advisories.length) {
      panel.appendChild(el("h2", {}, ["Advisory (recommended, not required)"]));
      panel.appendChild(
        el(
          "ul",
          { class: "issue-list" },
          results.advisories.map((f) => el("li", {}, [f.name + " (" + f.reference + ")"]))
        )
      );
    }

    panel.appendChild(
      el("div", { class: "toolbar" }, [
        el("button", { class: "btn secondary", onclick: () => window.print() }, ["Print / Save as PDF"]),
        el(
          "button",
          {
            class: "btn secondary",
            onclick: () => {
              const blob = new Blob([JSON.stringify({ vehicle: state.vehicle, pathId: state.pathId, answers: state.answers, results }, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = (state.vehicle.name || "inspection") + ".json";
              a.click();
              URL.revokeObjectURL(url);
            },
          },
          ["Export JSON"]
        ),
      ])
    );

    panel.appendChild(el("div", { class: "category-heading" }, ["Logbook details"]));
    appendLogbookFields(panel);

    root.appendChild(panel);
  }

  // ---- Live 3D cage view wiring -------------------------------------------
  // Maps checklist answers to STL part files + category colors for
  // window.CageView (cage_view.js). Only items that correspond to real
  // geometry in the one modeled car light anything up; everything else
  // (tubing spec, weld quality, padding, gussets, ...) has no 3D part and is
  // simply left out of this table.
  const CAGE_COLOR = {
    main: "#e0483e", side: "#d4a017", member: "#3b6fd6", backstay: "#2f9e57", foot: "#9b3fd1",
    roofBar: "#ff7f0e", backstayDiag: "#17becf", mainDiag: "#e377c2", doorBar: "#bcbd22",
    aPillar: "#ffdd00", sill: "#8c564b", harnessBar: "#c9a227",
    rearLateral: "#4dd0e1", rearTransversal: "#ff5252", dashBar: "#7986cb",
    rearLowerX: "#b565d8", antiIntrusion: "#ff9e4a", templeBar: "#5ec9a3", windshieldReinforcement: "#ef6ba0",
    lowerMainHoopBar: "#8ecae6",
    // Bright, unmistakably-different-from-anything-else highlight for a
    // checked (not yet applied) AI suggestion -- see computeCageColors'
    // AI-preview overlay and renderPhotoAnalysis.
    aiPreview: "#39ff14",
    // Driver/Codriver mannequins -- seat shell and body render dim/ghosted
    // (not a compliance item themselves, and shouldn't visually compete
    // with actual cage tubes), while whatever they're holding (steering
    // wheel / book) gets a bright highlight so it reads as the thing that
    // has to swap sides for a right-hand-drive car.
    occupantGhost: "#555a60",
    occupantProp: "#39c463",
    // Taco and single-plate gussets reuse the same modeled geometry (per the
    // source model), distinguished only by color until a distinct
    // single-plate mesh exists -- deliberately a warm/cool complementary
    // pair (not 2 shades of the same hue) so they read apart at a glance.
    gussetTaco: "#f97316", gussetSinglePlate: "#2563eb",
    tubingPrimary: "#3b82f6", tubingSecondary: "#f59e0b", tubingUnclassified: "#9ca3af",
    // Part 3's Weld view / Bar junctions view (see applyPart3View()) --
    // green/red match the same pass/fail meaning as the checklist's own
    // Compliant/Not-compliant styling, not a structural category color.
    statusPass: "#2ecc71", statusFail: "#e74c3c",
  };
  // Ties the Tube classification table's Primary/Secondary buttons to the
  // exact same colors the Part 2 3D view paints those bars -- so the
  // checklist itself becomes the color legend, not just the section nav.
  const RADIO_OPTION_COLOR = {
    primary: CAGE_COLOR.tubingPrimary, secondary: CAGE_COLOR.tubingSecondary,
    taco: CAGE_COLOR.gussetTaco, single_plate: CAGE_COLOR.gussetSinglePlate,
  };
  const FEET_FILES = [
    "Foot front left.stl", "Foot front right.stl",
    "Foot main rollbar left.stl", "Foot main rollbar right.stl",
    "Foot rear left.stl", "Foot rear right.stl",
  ];
  // Mirrors cage_view.js's own FOOT_LOCATIONS/footCubeFile() -- each foot's
  // row in the "Mounting feet design" table (rules-data.js) drives which of
  // its two candidate meshes (the real flat-plate STL, or the procedural
  // cube standing in for 253-54 until real geometry exists) actually shows.
  const FOOT_LOCATIONS = [
    { row: "front_left", plateFile: "Foot front left.stl" },
    { row: "front_right", plateFile: "Foot front right.stl" },
    { row: "main_hoop_left", plateFile: "Foot main rollbar left.stl" },
    { row: "main_hoop_right", plateFile: "Foot main rollbar right.stl" },
    { row: "backstay_left", plateFile: "Foot rear left.stl" },
    { row: "backstay_right", plateFile: "Foot rear right.stl" },
  ];
  function footCubeFile(row) { return "Foot cube " + row + ".virtual"; }
  function doublePlaneFile(row) { return "Foot double-plane " + row + ".virtual"; }
  function rockerBaseFile(row) { return "Foot rocker base " + row + ".virtual"; }
  function rockerFoldFile(row) { return "Foot rocker fold " + row + ".virtual"; }
  // Mirrors cage_view.js's own GUSSET_LOCATIONS -- each row in the "Gusset
  // design" table (rules-data.js) drives whether its matching gusset mesh
  // shows at all (both Taco and Single plate reuse the same modeled
  // geometry for now, per the source model -- see gussetDesignColor()).
  const GUSSET_LOCATIONS = [
    { row: "main_hoop_diag_left", file: "253-7 gusset left.stl" },
    { row: "main_hoop_diag_right", file: "253-7 gusset right.stl" },
    { row: "main_hoop_diag_upper", file: "253-7 gusset upper.stl" },
    { row: "main_hoop_diag_lower", file: "253-7 gusset lower.stl" },
    { row: "roof_left", file: "Roof bars gusset left.stl" },
    { row: "roof_right", file: "Roof bars gusset right.stl" },
    { row: "roof_front", file: "Roof bars gusset front.stl" },
    { row: "roof_rear", file: "Roof bars gusset rear.stl" },
    { row: "backstay_diag_left", file: "Rear backstay gusset left.stl" },
    { row: "backstay_diag_right", file: "Rear backstay gusset right.stl" },
    { row: "backstay_diag_upper", file: "Rear backstay gusset upper.stl" },
    { row: "backstay_diag_lower", file: "Rear backstay gusset lower.stl" },
    { row: "door_front_left", file: "Door bar gusset front left.stl" },
    { row: "door_front_right", file: "Door bar gusset front right.stl" },
    { row: "door_rear_left", file: "Door bar gusset rear left.stl" },
    { row: "door_rear_right", file: "Door bar gusset rear right.stl" },
    { row: "a_pillar_left", file: "A-pillar gusset left.stl" },
    { row: "a_pillar_right", file: "A-pillar gusset right.stl" },
    { row: "a_pillar_side_left", file: "253-15 side gusset left.stl" },
    { row: "a_pillar_side_right", file: "253-15 side gusset right.stl" },
    { row: "a_pillar_2pc_left_upper_front", file: "253-15 gusset left upper front.stl" },
    { row: "a_pillar_2pc_left_upper_rear", file: "253-15 gusset left upper rear.stl" },
    { row: "a_pillar_2pc_left_lower_front", file: "253-15 gusset left lower front.stl" },
    { row: "a_pillar_2pc_left_lower_rear", file: "253-15 gusset left lower rear.stl" },
    { row: "a_pillar_2pc_right_upper_front", file: "253-15 gusset right upper front.stl" },
    { row: "a_pillar_2pc_right_upper_rear", file: "253-15 gusset right upper rear.stl" },
    { row: "a_pillar_2pc_right_lower_front", file: "253-15 gusset right lower front.stl" },
    { row: "a_pillar_2pc_right_lower_rear", file: "253-15 gusset right lower rear.stl" },
  ];
  // Roof corner gussets -- see roof_corner_gussets in rules-data.js. Kept
  // separate from GUSSET_LOCATIONS/gusset_design since these are independent
  // presence toggles, not rows in the shared required-gusset design table.
  const ROOF_CORNER_GUSSET_LOCATIONS = [
    { row: "front_left", file: "Roof corner gusset front left.stl" },
    { row: "front_right", file: "Roof corner gusset front right.stl" },
    { row: "rear_left", file: "Roof corner gusset rear left.stl" },
    { row: "rear_right", file: "Roof corner gusset rear right.stl" },
  ];
  // Reverse lookups for double-click (see handleCagePartDoubleClick) -- a
  // gusset file always belongs to exactly one row, so this is unambiguous
  // the same way the simple bar toggles are.
  const GUSSET_FILE_TO_ROW = new Map(GUSSET_LOCATIONS.map((l) => [l.file, l.row]));
  const ROOF_CORNER_GUSSET_FILE_TO_ROW = new Map(ROOF_CORNER_GUSSET_LOCATIONS.map((l) => [l.file, l.row]));
  // Verified against each file's own geometry (top/bottom Y at Z=99.89/Z=0,
  // cross-checked against "Foot main rollbar left/right.stl": low Y = left,
  // high Y = right in this model): diagonal 1 runs top-right to
  // bottom-left, diagonal 2 runs top-left to bottom-right.
  const MAIN_DIAG_TOP_RIGHT_FILE = "Main diagonal  1-  253-7.stl";
  const MAIN_DIAG_TOP_LEFT_FILE = "Main diagonal  2-  253-7.stl";
  const MAIN_DIAG_FILES = [MAIN_DIAG_TOP_RIGHT_FILE, MAIN_DIAG_TOP_LEFT_FILE];
  const BACKSTAY_DIAG_FILES = ["Rear diagonal 1.stl", "Rear diagonal 2.stl"];
  const DOOR_BAR_FILES = [
    "Left door bar 1-  253-9.stl", "Left door bar 2-  253-9.stl",
    "Right door bar 1-  253-9.stl", "Right door bar 2-  253-9.stl",
  ];
  const NASCAR_VERTICAL_FILES = ["Nascar left 1.stl", "Nascar left 2.stl", "Nascar right 1.stl", "Nascar right 2.stl"];
  const APILLAR_FILES = ["253-15 Left.stl", "253-15 Right.stl"];
  // The 2-bar build of 253-15 (where it's split to meet the door bar) --
  // real tube geometry extracted from the same 3mf, swapped in for
  // APILLAR_FILES instead of overlaid alongside it.
  const APILLAR_2PIECE_FILES = ["253-15 left lower.stl", "253-15 left upper.stl", "253-15 right lower.stl", "253-15 right upper.stl"];
  const APILLAR_2PC_GUSSET_FILES = [
    "253-15 gusset left upper front.stl", "253-15 gusset left upper rear.stl",
    "253-15 gusset left lower front.stl", "253-15 gusset left lower rear.stl",
    "253-15 gusset right upper front.stl", "253-15 gusset right upper rear.stl",
    "253-15 gusset right lower front.stl", "253-15 gusset right lower rear.stl",
  ];
  const APILLAR_SIDE_GUSSET_FILES = ["253-15 side gusset left.stl", "253-15 side gusset right.stl"];
  const BACKSTAY_FILES = ["Left backstay.stl", "Right backstay.stl"];
  const ROOF_BAR_FILES = ["Roof bar 1.stl", "Roof bar 2.stl"];

  // Both 253-9 variants (intersection vs. bent bars) are the same X shape
  // in the modeled car -- they only differ in fabrication, not silhouette;
  // the 2 "intersection" variants (which physical tube is continuous) are
  // the same shape too. 253-11 reuses the sill bar plus whichever 253-9
  // diagonal leg lands at the bottom in the front on each side (verified
  // via geometry: "Left door bar 2" and "Right door bar 1" are the
  // bottom-front legs). The merged "Sill bar" sub-toggle
  // (answer.extra.sill_bar) adds the sill bar on top of whichever design is
  // chosen, except 253-11 which already includes it. "nascar" reuses
  // 253-10's top rail (the only part of 253-10 with a simple flat
  // horizontal shape) plus 2 new vertical bars and the sill bar, forming
  // the ladder-style NASCAR door bar grid -- always includes the sill bar,
  // unlike the other designs where it's optional. Left and right are
  // resolved independently since the design can now differ side to side.
  function doorBarSideRule(v, answer, side) {
    const cap = side === "left" ? "Left" : "Right";
    const sillFile = cap === "Left" ? "Sill bar Left.stl" : "Sill bar Right.stl";
    const bottomFrontLegFile = side === "left" ? "Left door bar 2-  253-9.stl" : "Right door bar 1-  253-9.stl";
    let files = [];
    if (v === "253-9-intersection-1" || v === "253-9-intersection-2" || v === "253-9-bent") {
      files = [cap + " door bar 1-  253-9.stl", cap + " door bar 2-  253-9.stl"];
    } else if (v === "253-10") {
      files = ["Door bar 253-10 upper " + side + ".stl", "Door bar 253-10 front " + side + ".stl", "Door bar 253-10 rear " + side + ".stl"];
    } else if (v === "253-11") {
      files = [sillFile, bottomFrontLegFile];
    } else if (v === "nascar") {
      files = ["Door bar 253-10 upper " + side + ".stl", "Nascar " + side + " 1.stl", "Nascar " + side + " 2.stl", sillFile];
    } else if (v === "single-bar") {
      // Captured for identification -- reuses the same bottom-front leg as
      // 253-11 but without the sill bar that design already includes.
      files = [bottomFrontLegFile];
    }
    const extra = (answer && answer.extra) || {};
    if (extra.sill_bar === "yes" && v !== "253-11" && v !== "nascar") files = files.concat([sillFile]);
    if (!files.length) return null;
    return { files, color: CAGE_COLOR.doorBar };
  }

  // "main_structure_layout" (253-1/253-2/253-3): per your note, all three
  // base structures are literally the same physical bars in this one
  // modeled car -- they're told apart only by which role each bar is
  // labeled/colored as, not by different geometry. 253-3 is the real,
  // verified mapping (this car IS a 253-3 layout); 253-1 and 253-2 reuse it
  // as a placeholder until we tune their coloring together.
  const BASE_STRUCTURE_MAPS = {
    "253-3": {
      "Main rollbar.stl": CAGE_COLOR.main,
      "Front left lateral.stl": CAGE_COLOR.side,
      "Front right lateral.stl": CAGE_COLOR.side,
      "Transverse member.stl": CAGE_COLOR.member,
      "Left backstay.stl": CAGE_COLOR.backstay,
      "Right backstay.stl": CAGE_COLOR.backstay,
    },
    "253-1": {
      // Front left/right lateral + transverse member together form the
      // "front rollbar" hoop (two pillars + top crossbar, same relationship
      // as the main rollbar's own legs+top) -- all gold, including the
      // transverse member, which is no longer a separate blue "member" here.
      // Each front lateral's OWN mesh already reaches all the way back to
      // the main rollbar at roof height (confirmed by its geometry: past
      // roughly x=145 its z stays pinned at ~104-110, a near-level run,
      // versus the pillar below that where z spans the full 0-100 height) --
      // that reach-back run is what stands in for 253-1's required "2
      // longitudinal members" (blue), not the separate Roof bar 1/2 parts
      // (253-12 reinforcement), which stay hidden here like every other
      // config.
      "Main rollbar.stl": CAGE_COLOR.main,
      "Front left lateral.stl": { axis: "x", min: 145, max: 999, inside: CAGE_COLOR.member, outside: CAGE_COLOR.side },
      "Front right lateral.stl": { axis: "x", min: 145, max: 999, inside: CAGE_COLOR.member, outside: CAGE_COLOR.side },
      "Transverse member.stl": CAGE_COLOR.side,
      "Left backstay.stl": CAGE_COLOR.backstay,
      "Right backstay.stl": CAGE_COLOR.backstay,
    },
    "253-2": {
      // No main rollbar in this layout -- two full lateral rollbars instead.
      // The physical "main rollbar" bar becomes (a) the rear leg of each
      // full lateral (still the lateral gold, below the bend) and (b) the
      // roof crossing between them, which reads the same as a transverse
      // member (blue, above the bend) -- so it's colored in two zones
      // rather than as a single "main rollbar" bar.
      "Main rollbar.stl": { axis: "y", min: 108, max: 204, inside: CAGE_COLOR.member, outside: CAGE_COLOR.side },
      "Front left lateral.stl": CAGE_COLOR.side,
      "Front right lateral.stl": CAGE_COLOR.side,
      "Transverse member.stl": CAGE_COLOR.member,
      "Left backstay.stl": CAGE_COLOR.backstay,
      "Right backstay.stl": CAGE_COLOR.backstay,
    },
  };
  function baseStructureColors(value) {
    if (!value || !BASE_STRUCTURE_MAPS[value]) return null;
    // Feet are NOT colored here anymore -- they stay ghosted until each
    // foot's own design is actually answered (see FOOT_LOCATIONS /
    // mountingFeetColors() below), rather than lighting up purple the
    // moment a base structure is picked, before anything about the feet
    // themselves has been captured.
    return Object.assign({}, BASE_STRUCTURE_MAPS[value]);
  }

  // Shared by any left/right/both/none-style element (253-31 temple bar and
  // windshield reinforcement below) whose 2 files are simply "the left
  // part" and "the right part".
  function sideFilesRule(v, leftFile, rightFile, color) {
    const files = [];
    if (v === "left" || v === "both") files.push(leftFile);
    if (v === "right" || v === "both") files.push(rightFile);
    if (!files.length) return null;
    return { files, color };
  }

  // itemId -> function(answerValue) => { files, color } | null
  //
  // Roof bars, door bars, sill bar, and backstay (rear) diagonals are
  // disabled below while 253-1/253-2/253-3 base-structure coloring is still
  // being tuned -- Roof bar 1/2 in particular get reused as 253-1's
  // "longitudinal members", which would conflict with the roof-bars item
  // separately trying to color them as 253-12 reinforcement. Re-enable once
  // the base-structure mappings are finalized.
  const ITEM_PART_RULES = {
    main_rollbar_present: (v) => (v === "yes" ? { files: ["Main rollbar.stl"], color: CAGE_COLOR.main } : null),
    backstays: (v) => (v === "yes" ? { files: BACKSTAY_FILES, color: CAGE_COLOR.backstay } : null),
    backstays_gf: (v) => (v === "yes" ? { files: BACKSTAY_FILES, color: CAGE_COLOR.backstay } : null),

    mounting_feet_count: (v) => (v === "yes" ? { files: FEET_FILES, color: CAGE_COLOR.foot } : null),
    mounting_feet_gf: (v) => (v === "yes" ? { files: FEET_FILES, color: CAGE_COLOR.foot } : null),

    // 253-12 (either build variant -- see roofBarFileTubeRow) uses the
    // original generic roof-bar parts; 253-14 and 253-13 (captured for
    // identification even though it's a known-deficient design) each have
    // their own dedicated geometry (extracted from "all options
    // rollcage.3mf").
    roof_bars: (v) => {
      if (v === "253-12-1" || v === "253-12-2") return { files: ROOF_BAR_FILES, color: CAGE_COLOR.roofBar };
      if (v === "253-14") return { files: ["Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl"], color: CAGE_COLOR.roofBar };
      if (v === "253-13") return { files: ["Roof bar 253-13 left.stl", "Roof bar 253-13 right.stl"], color: CAGE_COLOR.roofBar };
      if (v === "single-center") return { files: ["Roof bar single center.stl"], color: CAGE_COLOR.roofBar };
      // Reuse the individual 253-12 diagonal legs (verified via geometry:
      // "Roof bar 1" runs front-left to rear-right, "Roof bar 2" runs
      // front-right to rear-left) rather than modeling a new bar.
      if (v === "single-front-left") return { files: ["Roof bar 1.stl"], color: CAGE_COLOR.roofBar };
      if (v === "single-front-right") return { files: ["Roof bar 2.stl"], color: CAGE_COLOR.roofBar };
      return null;
    },
    roof_bars_gf: () => null,
    roof_bar_or_windshield_gusset: () => null,

    // "Rear diagonal 1/2.stl" are each a full corner-to-corner diagonal on
    // their own (verified via geometry: 1 runs top-left to bottom-right, 2
    // runs top-right to bottom-left) -- 253-20 uses just one of them,
    // 253-21 (X) uses both together.
    backstay_diagonals: (v) => {
      if (v === "253-20") return { files: ["Rear diagonal 1.stl"], color: CAGE_COLOR.backstayDiag };
      if (v === "253-20-right") return { files: ["Rear diagonal 2.stl"], color: CAGE_COLOR.backstayDiag };
      if (v === "253-21") return { files: BACKSTAY_DIAG_FILES, color: CAGE_COLOR.backstayDiag };
      if (v === "253-22") return { files: ["Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl"], color: CAGE_COLOR.backstayDiag };
      return null;
    },
    diagonal_members_gf: () => null,
    diagonals_minimum: () => null,

    // All six configurations now match real geometry in the modeled car --
    // "1 horizontal bar" is physically the same bar/position as the 253-26/27
    // harness bar, so it reuses that same part.
    main_hoop_diagonals: (v) => {
      if (v === "253-7") return { files: MAIN_DIAG_FILES, color: CAGE_COLOR.mainDiag };
      if (v === "diag-left") return { files: [MAIN_DIAG_TOP_LEFT_FILE], color: CAGE_COLOR.mainDiag };
      if (v === "diag-right") return { files: [MAIN_DIAG_TOP_RIGHT_FILE], color: CAGE_COLOR.mainDiag };
      if (v === "diag-horizontal") return { files: ["253-26,27 harness bar.stl"], color: CAGE_COLOR.mainDiag };
      if (v === "diag-lower-half") return { files: ["Main rollbar lower half left.stl", "Main rollbar lower half right.stl"], color: CAGE_COLOR.mainDiag };
      if (v === "diag-v-center") return { files: ["Main rollbar V left.stl", "Main rollbar V right.stl"], color: CAGE_COLOR.mainDiag };
      return null;
    },
    main_hoop_corner_diagonals: () => null,

    door_bars_left: (v, answer) => doorBarSideRule(v, answer, "left"),
    door_bars_right: (v, answer) => doorBarSideRule(v, answer, "right"),
    door_bars_present_gf: () => null,
    door_bars_present: () => null,

    // 2 mutually exclusive designs -- see rules-data.js.
    harness_bar_present: (v) => {
      if (v === "253-26-27") return { files: ["253-26,27 harness bar.stl"], color: CAGE_COLOR.harnessBar };
      if (v === "253-28-66") return { files: ["253-28,66 rear harness bar.stl"], color: CAGE_COLOR.harnessBar };
      return null;
    },
    lower_main_hoop_bar_present: (v) => (v === "yes" ? { files: ["253-30 lower main hoop bar.stl"], color: CAGE_COLOR.lowerMainHoopBar } : null),
    // "253-17 left/right.stl" (a single bar per side) no longer exist in the
    // source model -- replaced by dedicated upper/lower parts matching this
    // item's own upper/lower/both front-junction choice.
    rear_lateral_reinforcement_present: (v) => {
      let files = [];
      if (v === "upper" || v === "both") files = files.concat(["253-17 left upper.stl", "253-17 right upper.stl"]);
      if (v === "lower" || v === "both") files = files.concat(["253-17 left lower.stl", "253-17 right lower.stl"]);
      if (!files.length) return null;
      return { files, color: CAGE_COLOR.rearLateral };
    },
    rear_transversal_present: (v) => (v === "yes" ? { files: ["253-18.stl"], color: CAGE_COLOR.rearTransversal } : null),
    dash_bar_present: (v) => (v === "yes" ? { files: ["Dash bar 253-29.stl"], color: CAGE_COLOR.dashBar } : null),
    rear_lower_x_present: (v) => (v === "yes" ? { files: ["253-19 left.stl", "253-19 right.stl"], color: CAGE_COLOR.rearLowerX } : null),
    anti_intrusion_present: (v) =>
      v === "yes"
        ? { files: ["253-25 upper left.stl", "253-25 upper right.stl", "253-25 lower left.stl", "253-25 lower right.stl"], color: CAGE_COLOR.antiIntrusion }
        : null,
    // Left/right/both/none (not a plain yes/no) -- see rules-data.js.
    temple_bar_present: (v) => sideFilesRule(v, "253-31 temple bar left.stl", "253-31 temple bar right.stl", CAGE_COLOR.templeBar),
    windshield_reinforcement_present: (v) =>
      sideFilesRule(v, "253-31 windshield left.stl", "253-31 windshield right.stl", CAGE_COLOR.windshieldReinforcement),

    // a_pillar_reinforcement itself is handled separately, below the main
    // per-element loop -- continuous vs 2-bar are mutually exclusive
    // alternate geometries (like the gusset design swap), not an
    // independently-claimable part, and it needs to default to previewing
    // the continuous build before anything is answered.
    a_pillar_reinforcement_grandfathered: (v) => (v === "yes" ? { files: APILLAR_FILES, color: CAGE_COLOR.aPillar } : null),
    windscreen_support_each_side: (v) => (v === "yes" ? { files: APILLAR_FILES, color: CAGE_COLOR.aPillar } : null),

    sill_bar: () => null,
    sill_and_extra_door_bar: () => null,
    sill_bar_note: () => null,
  };

  // Ghost (unconfirmed) bars don't get a real owner from the pass in
  // computeCageColors() below -- nothing claims files for a value that
  // hasn't been picked yet, or for an option that isn't the one currently
  // picked. But a ghost bar should still be clickable to jump to whichever
  // section would eventually confirm it, so this probes an ITEM_PART_RULES
  // entry with every value it could ever take (every option for a
  // "choice" element, "yes" for a boolean one) and unions the files that
  // come back, regardless of what's actually answered right now.
  function possibleFilesForElement(elm, rule) {
    const files = new Set();
    const tryValue = (v, extra) => {
      const result = rule(v, { value: v, extra: extra || {} });
      if (result && result.files) result.files.forEach((f) => files.add(f));
    };
    if (elm.evaluationType === "choice" && elm.options) {
      elm.options.forEach((opt) => {
        tryValue(opt.id, {});
        tryValue(opt.id, { sill_bar: "yes" });
      });
    } else {
      tryValue("yes", {});
    }
    return [...files];
  }

  // a_pillar_reinforcement's alternate-geometry files (continuous tube vs
  // 2-bar tube+gussets vs side gusset) used to default here to fully hidden
  // -- now handled by the dedicated block below computeCageColors()'s main
  // loop instead, which defaults to previewing the continuous build ghosted
  // rather than hiding everything until answered.
  const HIDDEN_WHILE_TUNING_FILES = [];

  // Maps each STL file to the row id it represents in the "Tube
  // classification" table (tubing_bar_classification), for the Part 2
  // (Tubing sizes & materials) 3D view: every file present in the normal
  // colors map gets recolored by its row's primary/secondary answer instead
  // of its usual structural color, and every file with no row here (mounting
  // feet -- not a tube) or with no row answer yet is hidden/neutral. Rows are
  // split left/right wherever the underlying part naturally comes as a pair,
  // so the inspector has to check both sides rather than one answer silently
  // covering a bar it was never actually looked at. A file maps to exactly
  // one row regardless of which design variant produced it, since each STL
  // is one physical tube -- except the 2 harness bar files (resolved
  // dynamically in harnessBarTubeRow(), since "253-26,27 harness bar.stl"
  // is also reused by main_hoop_diagonals' "1 horizontal bar" option).
  const FILE_TO_TUBE_ROW = {
    "Main rollbar.stl": "main_rollbar",
    "Front left lateral.stl": "front_laterals_left", "Front right lateral.stl": "front_laterals_right",
    "Transverse member.stl": "transverse_member",
    "Left backstay.stl": "backstays_left", "Right backstay.stl": "backstays_right",
    // "Main diagonal 1" is the TOP-RIGHT-originating leg (used alone for the
    // "diag-right" single-diagonal option), "Main diagonal 2" TOP-LEFT (used
    // alone for "diag-left") -- see MAIN_DIAG_TOP_RIGHT/LEFT_FILE above.
    "Main diagonal  1-  253-7.stl": "main_diagonals_right", "Main diagonal  2-  253-7.stl": "main_diagonals_left",
    "Main rollbar lower half left.stl": "main_diagonals_left", "Main rollbar lower half right.stl": "main_diagonals_right",
    "Main rollbar V left.stl": "main_diagonals_left", "Main rollbar V right.stl": "main_diagonals_right",
    // "253-20" (no suffix) is the left-side single diagonal, "253-20-right"
    // the right-side one -- see the backstay_diagonals rule above.
    "Rear diagonal 1.stl": "backstay_diagonals_left", "Rear diagonal 2.stl": "backstay_diagonals_right",
    "Rear diagonal 253-22 left.stl": "backstay_diagonals_left", "Rear diagonal 253-22 right.stl": "backstay_diagonals_right",
    // "Roof bar 1/2.stl", "Roof bar 253-1x left/right.stl", and "Roof bar
    // single center.stl" are deliberately NOT listed here -- roof_bars'
    // rows/mapping vary by which roof design is selected (253-12 splits
    // "Roof bar 2" into front/rear half-tubes), so they're resolved
    // dynamically in roofBarFileTubeRow() instead.
    // "Left/Right door bar 1/2-253-9.stl" and "Door bar 253-10 upper
    // left/right.stl" are deliberately NOT listed here -- they're shared
    // across 253-9-bent/253-9-intersection/253-11/nascar, each of which
    // classifies them under different rows, so they're resolved dynamically
    // in doorBarFileTubeRow() instead.
    "Door bar 253-10 front left.stl": "d10_left_front", "Door bar 253-10 front right.stl": "d10_right_front",
    "Door bar 253-10 rear left.stl": "d10_left_rear", "Door bar 253-10 rear right.stl": "d10_right_rear",
    "Sill bar Left.stl": "sill_bar_left", "Sill bar Right.stl": "sill_bar_right",
    "253-15 Left.stl": "a_pillar_left", "253-15 Right.stl": "a_pillar_right",
    "253-15 left lower.stl": "a_pillar_left", "253-15 left upper.stl": "a_pillar_left",
    "253-15 right lower.stl": "a_pillar_right", "253-15 right upper.stl": "a_pillar_right",
    "253-17 left upper.stl": "rear_lateral_left", "253-17 right upper.stl": "rear_lateral_right",
    "253-17 left lower.stl": "rear_lateral_left", "253-17 right lower.stl": "rear_lateral_right",
    "253-18.stl": "rear_transversal",
    "253-19 left.stl": "rear_lower_x_driver_top", "253-19 right.stl": "rear_lower_x_codriver_top",
    "253-25 upper left.stl": "anti_intrusion_left_upper", "253-25 lower left.stl": "anti_intrusion_left_lower",
    "253-25 upper right.stl": "anti_intrusion_right_upper", "253-25 lower right.stl": "anti_intrusion_right_lower",
    "Dash bar 253-29.stl": "dash_bar",
    "253-30 lower main hoop bar.stl": "lower_main_hoop_bar",
    "253-31 temple bar left.stl": "temple_bar_left", "253-31 temple bar right.stl": "temple_bar_right",
    "253-31 windshield left.stl": "windshield_reinforcement_left", "253-31 windshield right.stl": "windshield_reinforcement_right",
  };
  function harnessBarTubeRow() {
    if (getAnswer("main_hoop_diagonals").value === "diag-horizontal") return "main_diagonals_left";
    const v = getAnswer("harness_bar_present").value;
    if (v && v !== "none") return "harness_bar";
    return null;
  }
  // "Left/Right door bar 1/2-253-9.stl" are the same 4 meshes across
  // 253-9-bent, 253-9-intersection, and 253-11 (see doorBarSideRule()
  // above), but the Tube classification table's door-bar rows are
  // different tube pieces for each of those designs (see
  // doorBarTubeRowsForSide() in rules-data.js) -- so which row a given mesh
  // belongs to depends on which
  // design is currently selected.
  function isDoor9Intersection(v) { return v === "253-9-intersection-1" || v === "253-9-intersection-2"; }
  // Which of the 2 physical tubes per side is actually fabricated as the
  // continuous leg (vs. cut into 2 half-tubes) isn't fixed by the FIA rule
  // and can differ car to car -- and, per the source model, isn't even
  // consistent left-to-right. This is now its own design pick in Part 1
  // (see DOOR_BAR_DESIGN_OPTIONS in rules-data.js: "-1" keeps tube 1 as the
  // continuous leg, "-2" swaps it to tube 2) rather than inferred.
  function continuousDoorTubeFile(side) {
    const cap = side === "left" ? "Left" : "Right";
    const doorVal = getAnswer("door_bars_" + side).value;
    return doorVal === "253-9-intersection-2" ? cap + " door bar 2-  253-9.stl" : cap + " door bar 1-  253-9.stl";
  }
  function otherDoorTubeFile(side) {
    const cap = side === "left" ? "Left" : "Right";
    const continuous = continuousDoorTubeFile(side);
    return continuous === cap + " door bar 1-  253-9.stl" ? cap + " door bar 2-  253-9.stl" : cap + " door bar 1-  253-9.stl";
  }
  function doorBarFileTubeRow(file) {
    const side = file.indexOf("Left") === 0 || file.indexOf("Nascar left") === 0 || file.indexOf("Door bar 253-10 upper left") === 0
      ? "left"
      : "right";
    const doorVal = getAnswer("door_bars_" + side).value;
    if (doorVal === "253-9-bent") {
      if (file === (side === "left" ? "Left" : "Right") + " door bar 1-  253-9.stl") return "d9bent_" + side + "_upper";
      if (file === (side === "left" ? "Left" : "Right") + " door bar 2-  253-9.stl") return "d9bent_" + side + "_lower";
    }
    if (doorVal === "253-9-intersection-1" || doorVal === "253-9-intersection-2") {
      // The continuous leg is NOT mapped here -- it's handled by
      // tubeRowSplitBand() below instead, which colors each half of that
      // single mesh separately rather than forcing one color over the
      // whole thing.
      if (file === continuousDoorTubeFile(side)) return "d9x_" + side + "_continuous";
    }
    if (doorVal === "253-10") {
      if (file === "Door bar 253-10 upper " + side + ".stl") return "d10_" + side + "_upper";
    }
    if (doorVal === "253-11") {
      if (file === (side === "left" ? "Left door bar 2-  253-9.stl" : "Right door bar 1-  253-9.stl")) return "d11_" + side;
    }
    if (doorVal === "nascar") {
      // Reuses 253-10's own top-rail parts (see doorBarSideRule() above) --
      // same meshes, different row identity while nascar is selected.
      if (file === "Door bar 253-10 upper " + side + ".stl") return "nascar_" + side + "_upper";
      if (file === "Nascar " + side + " 1.stl") return "nascar_" + side + "_vertical1";
      if (file === "Nascar " + side + " 2.stl") return "nascar_" + side + "_vertical2";
    }
    if (doorVal === "single-bar") {
      if (file === (side === "left" ? "Left door bar 2-  253-9.stl" : "Right door bar 1-  253-9.stl")) return "singlebar_" + side;
    }
    return null;
  }
  const ROOF_BAR_DYNAMIC_FILES = [
    "Roof bar 1.stl", "Roof bar 2.stl",
    "Roof bar 253-13 left.stl", "Roof bar 253-13 right.stl",
    "Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl",
    "Roof bar single center.stl",
  ];
  // "Roof bar 1"/"2" together form ONE shared X spanning the whole roof
  // (corner-to-corner each, not two independent per-side X's like doors --
  // see the diagram note on roof_bars' rule above), so for 253-12 there are
  // only 2 real tube pieces total, fabricated the same "1 continuous + 2
  // half bars" way as 253-9: for "-1" (the default/verified build), "Roof
  // bar 1" is the continuous leg and "Roof bar 2" is NOT mapped here -- see
  // tubeRowSplitBand() below, which splits it into front/rear halves. "-2"
  // mirrors which leg is continuous, but "Roof bar 1" has no verified
  // front/rear split threshold of its own, so it's a single "r12_other" row
  // (not band-split) in that variant instead.
  function roofBarFileTubeRow(file) {
    const roofVal = getAnswer("roof_bars").value;
    if (roofVal === "253-12-1" && file === "Roof bar 1.stl") return "r12_continuous";
    if (roofVal === "253-12-2" && file === "Roof bar 2.stl") return "r12_continuous";
    if (roofVal === "253-12-2" && file === "Roof bar 1.stl") return "r12_other";
    if (roofVal === "253-13" || roofVal === "253-14") {
      if (file === "Roof bar 253-13 left.stl" || file === "Roof bar 253-14 left.stl") return "roof_bars_left";
      if (file === "Roof bar 253-13 right.stl" || file === "Roof bar 253-14 right.stl") return "roof_bars_right";
    }
    if (roofVal === "single-center" && file === "Roof bar single center.stl") return "roof_bars_center";
    if (roofVal === "single-front-left" && file === "Roof bar 1.stl") return "roof_bars_left";
    if (roofVal === "single-front-right" && file === "Roof bar 2.stl") return "roof_bars_right";
    return null;
  }
  // Files that are a single mesh fabricated as one piece, but conceptually
  // split into two independently-classified tube halves (the "1 continuous
  // + 2 half bars" convention) -- these get a band-split color instead of
  // one flat color, keyed by axis threshold measured directly off each
  // mesh's own geometry (the two halves meet roughly at its midpoint).
  function tubeRowSplitBand(file) {
    // Z thresholds were measured off "door bar 2"'s own geometry -- kept
    // as-is regardless of which physical tube ends up as the "other"
    // (half-tube) one, since both tubes in the crossing are similarly
    // sized/shaped.
    if (isDoor9Intersection(getAnswer("door_bars_left").value) && file === otherDoorTubeFile("left")) {
      return { axis: "z", min: 29.655, max: 999, insideRow: "d9x_left_upper_half", outsideRow: "d9x_left_lower_half" };
    }
    if (isDoor9Intersection(getAnswer("door_bars_right").value) && file === otherDoorTubeFile("right")) {
      return { axis: "z", min: 29.085, max: 999, insideRow: "d9x_right_upper_half", outsideRow: "d9x_right_lower_half" };
    }
    if (getAnswer("roof_bars").value === "253-12-1" && file === "Roof bar 2.stl") {
      return { axis: "x", min: 179.52, max: 999, insideRow: "r12_rear_half", outsideRow: "r12_front_half" };
    }
    return null;
  }
  const DOOR_BAR_DYNAMIC_FILES = DOOR_BAR_FILES.concat(
    ["Door bar 253-10 upper left.stl", "Door bar 253-10 upper right.stl"],
    NASCAR_VERTICAL_FILES
  );
  function fileTubeRow(file) {
    if (file === "253-26,27 harness bar.stl" || file === "253-28,66 rear harness bar.stl") return harnessBarTubeRow();
    if (DOOR_BAR_DYNAMIC_FILES.indexOf(file) !== -1) return doorBarFileTubeRow(file);
    if (ROOF_BAR_DYNAMIC_FILES.indexOf(file) !== -1) return roofBarFileTubeRow(file);
    return FILE_TO_TUBE_ROW[file] || null;
  }
  function specColor(row) {
    const spec = getAnswer("tubing_bar_classification__" + row + "__spec").value;
    return spec === "primary" ? CAGE_COLOR.tubingPrimary : spec === "secondary" ? CAGE_COLOR.tubingSecondary : CAGE_COLOR.tubingUnclassified;
  }
  // Mounting feet aren't tubes, so they don't get a primary/secondary spec
  // color -- instead they reflect whether that foot's own "Mounting plate
  // size" cell (this same Part 2 tab) has been filled in yet, reusing the
  // same "answered vs not" muted-gray convention specColor uses for
  // unclassified tubes.
  function footSizeColor(row) {
    const v = getAnswer("mounting_feet_size__" + row + "__size").value;
    return v && v.value !== "" && v.value != null ? CAGE_COLOR.foot : CAGE_COLOR.tubingUnclassified;
  }
  // Recolors an already-computed "presence" colors map for the Part 2 view:
  // every present file is reclassified as primary/secondary/unclassified by
  // row; a present mounting-foot part instead reflects its own plate-size
  // entry (see footSizeColor); anything else not present is fully hidden
  // instead of shown in its normal structural color.
  function applyTubingClassificationView(colors) {
    const view = {};
    Object.keys(colors).forEach((file) => {
      if (colors[file] === "hidden") { view[file] = "hidden"; return; }
      const band = tubeRowSplitBand(file);
      if (band) {
        view[file] = { axis: band.axis, min: band.min, max: band.max, inside: specColor(band.insideRow), outside: specColor(band.outsideRow) };
        return;
      }
      const row = fileTubeRow(file);
      if (row) { view[file] = specColor(row); return; }
      const footRow = footRowForFile(file);
      if (footRow) { view[file] = footSizeColor(footRow); return; }
      view[file] = "hidden";
    });
    return view;
  }

  // ---- Part 3 Weld view / Bar junctions view ----------------------------
  // Highlights, in the live 3D model, whichever bars currently have a
  // weld-completion answer (Weld view) or a junction-distance answer (Bar
  // junctions view). Mounting feet, the main-rollbar diagonals, and the
  // backstays map 1:1 to their own table row. Everything else -- roof
  // bars/rear diagonal, windshield support bar, door bars -- has a table
  // whose rows are named by which corner/section of a shared tube each weld
  // belongs to; part3RowTargetsForFile() below resolves each such file to
  // its table + the row ids that apply to it, so this stays one shared
  // aggregation instead of a bespoke branch per bar.
  function weldCellColor(elementId, rowId) {
    const v = getAnswer(elementId + "__" + rowId + "__weld").value;
    if (v === "yes") return CAGE_COLOR.statusPass;
    if (v === "no") return CAGE_COLOR.statusFail;
    return null;
  }
  function distanceValueColor(v) {
    if (v === "" || v === undefined || v === null) return null;
    const num = parseFloat(v);
    if (isNaN(num)) return null;
    return num < 100 ? CAGE_COLOR.statusPass : CAGE_COLOR.statusFail;
  }
  // Diagonal 1 (top-right to bottom-left, see MAIN_DIAG_TOP_RIGHT/LEFT_FILE
  // above) meets the LEFT foot and the RIGHT backstay; diagonal 2 (top-left
  // to bottom-right) meets the RIGHT foot and the LEFT backstay.
  function mainDiagonalJunctionColor(file) {
    const values = getAnswer("main_diagonal_distances").value || {};
    const keys = file === MAIN_DIAG_TOP_RIGHT_FILE ? ["dist_left_foot", "dist_right_backstay"]
      : file === MAIN_DIAG_TOP_LEFT_FILE ? ["dist_right_foot", "dist_left_backstay"]
      : null;
    if (!keys) return null;
    const colors = keys.map((k) => distanceValueColor(values[k]));
    if (colors.includes(CAGE_COLOR.statusFail)) return CAGE_COLOR.statusFail;
    if (colors.every(Boolean)) return CAGE_COLOR.statusPass;
    return null;
  }
  // Folds several rows' weld/distance answers down to one worst-case color
  // for a single mesh: red if any row is failing, green only once every row
  // is confirmed passing, ghost (null) otherwise -- used any time one
  // physical tube's status is really the combination of several rows in a
  // checklist table rather than a 1:1 row.
  function aggregateColor(colorList) {
    if (colorList.indexOf(CAGE_COLOR.statusFail) !== -1) return CAGE_COLOR.statusFail;
    if (colorList.length && colorList.every(Boolean)) return CAGE_COLOR.statusPass;
    return null;
  }
  function weldRowsColor(elementId, rowIds) {
    return aggregateColor(rowIds.map((r) => weldCellColor(elementId, r)));
  }
  function distanceRowsColor(elementId, rowIds) {
    return aggregateColor(rowIds.map((r) => distanceValueColor(getAnswer(elementId + "__" + r + "__distance").value)));
  }
  const ROOF_4_1_WELD_ID = "roof_4_1_measurements_welds";
  const ROOF_4_1_DIST_ID = "roof_4_1_distances";
  // The rear-diagonal (253-21) half of this shared 8-row table has no
  // verified per-tube geometry -- "Rear diagonal 1/2.stl" cross in a true X
  // (verified: 1 runs top-left to bottom-right, 2 top-right to
  // bottom-left), and it isn't confirmed whether "top_rear_diag_left"/
  // "bottom_rear_diag_left" name one tube's 2 ends or 2 different tubes'
  // same-side corner -- so both files just share one aggregate of all 4
  // diag rows instead of guessing a split.
  const ROOF_4_1_DIAG_ROWS = ["top_rear_diag_left", "bottom_rear_diag_left", "top_rear_diag_right", "bottom_rear_diag_right"];
  const ROOF_4_2_WELD_ID = "roof_4_2_measurements_welds";
  const ROOF_4_2_DIST_ID = "roof_4_2_distances";
  const WINDSHIELD_WELD_ID = "windshield_welds";
  const WINDSHIELD_DIST_ID = "windshield_distances";
  function doorWeldElementId(doorVal) {
    if (isDoor9Intersection(doorVal)) return "door_9_intersection_welds";
    if (doorVal === "253-9-bent") return "door_9_2bar_welds";
    if (doorVal === "253-10") return "door_10_welds";
    if (doorVal === "253-11") return "door_11_welds";
    return null;
  }
  function doorWeldRowIds(side, doorVal) {
    if (isDoor9Intersection(doorVal)) return ["front_top_" + side, "front_bottom_" + side, "center_front_" + side, "center_rear_" + side, "top_rear_" + side, "bottom_rear_" + side];
    if (doorVal === "253-9-bent") return ["front_top_" + side, "front_bottom_" + side, "top_rear_" + side, "bottom_rear_" + side];
    if (doorVal === "253-10") return ["front_top_" + side, "front_lower_" + side, "center_" + side, "rear_top_" + side, "rear_lower_" + side];
    if (doorVal === "253-11") return ["front_top_" + side, "front_lower_" + side, "rear_top_" + side, "rear_lower_" + side];
    return [];
  }
  // Every physical mesh belonging to a door-bar side -- unlike the roof/
  // windshield tables, a door-bar table's rows aren't verified against
  // which exact tube each weld point sits on, so every mesh on that side
  // (continuous tube + split tube, or upper/front/rear for 253-10) shares
  // one worst-case aggregate of the whole side's rows instead.
  function doorSideFiles(side, doorVal) {
    if (isDoor9Intersection(doorVal)) return [continuousDoorTubeFile(side), otherDoorTubeFile(side)];
    if (doorVal === "253-9-bent") { const cap = side === "left" ? "Left" : "Right"; return [cap + " door bar 1-  253-9.stl", cap + " door bar 2-  253-9.stl"]; }
    if (doorVal === "253-10") return ["Door bar 253-10 upper " + side + ".stl", "Door bar 253-10 front " + side + ".stl", "Door bar 253-10 rear " + side + ".stl"];
    if (doorVal === "253-11") return [side === "left" ? "Left door bar 2-  253-9.stl" : "Right door bar 1-  253-9.stl"];
    return [];
  }
  // Resolves one mesh file to the table (weld + distance element id) and
  // row ids that apply to it, for every bar beyond mounting feet/main
  // diagonals/backstays (which stay handled directly in applyPart3View,
  // since they're already simple 1:1 mappings). Roof bar 2 under "253-12-1"
  // is deliberately NOT resolved here for weld/distance coloring -- it's a
  // true band-split (see the verified x=179.52 threshold already used by
  // tubeRowSplitBand), handled separately in applyPart3View -- but IS
  // resolved here for double-click cycling, which (like the Part 2 tubing
  // view) just cycles both halves' rows together in lockstep.
  function part3RowTargetsForFile(file) {
    const roofVal = getAnswer("roof_bars").value;
    if (file === "Rear diagonal 1.stl" || file === "Rear diagonal 2.stl") {
      if (roofVal === "253-12-1" || roofVal === "253-12-2") return { rowIds: ROOF_4_1_DIAG_ROWS, weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID };
      return null;
    }
    if (file === "Roof bar 1.stl" && (roofVal === "253-12-1" || roofVal === "253-12-2")) {
      return { rowIds: ["front_roof_left", "rear_roof_right"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID };
    }
    if (file === "Roof bar 2.stl" && (roofVal === "253-12-1" || roofVal === "253-12-2")) {
      return { rowIds: ["front_roof_right", "rear_roof_left"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID };
    }
    if (file === "Roof bar 253-14 left.stl") return { rowIds: ["front_roof_left", "center_roof_left"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Roof bar 253-14 right.stl") return { rowIds: ["front_roof_right", "center_roof_right"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Rear diagonal 253-22 left.stl") return { rowIds: ["top_rear_left", "bottom_rear_left"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Rear diagonal 253-22 right.stl") return { rowIds: ["top_rear_right", "bottom_rear_right"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "253-15 Left.stl") return { rowIds: ["top_left", "center_top_left", "center_lower_left", "bottom_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 Right.stl") return { rowIds: ["top_right", "center_top_right", "center_lower_right", "bottom_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 left upper.stl") return { rowIds: ["top_left", "center_top_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 left lower.stl") return { rowIds: ["center_lower_left", "bottom_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 right upper.stl") return { rowIds: ["top_right", "center_top_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 right lower.stl") return { rowIds: ["center_lower_right", "bottom_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    for (const side of ["left", "right"]) {
      const doorVal = getAnswer("door_bars_" + side).value;
      const elementId = doorWeldElementId(doorVal);
      if (!elementId) continue;
      if (doorSideFiles(side, doorVal).indexOf(file) !== -1) return { rowIds: doorWeldRowIds(side, doorVal), weldElementId: elementId, distElementId: null };
    }
    return null;
  }
  // Files part3RowTargetsForFile() can ever resolve, gathered once for
  // applyPart3View() to iterate -- door-bar file identity depends on the
  // currently-selected design per side, so this recomputes on every call
  // rather than being a fixed list.
  function part3CandidateFiles() {
    const files = ROOF_BAR_FILES.concat(BACKSTAY_DIAG_FILES, [
      "Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl",
      "Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl",
    ], APILLAR_FILES, APILLAR_2PIECE_FILES);
    ["left", "right"].forEach((side) => { files.push.apply(files, doorSideFiles(side, getAnswer("door_bars_" + side).value)); });
    return files;
  }
  // Matches cage_view.js's own GHOST_COLOR -- used as a band half's color
  // when that half has no weld/distance answer yet, since a band-split spec
  // (unlike a flat color) has no separate "ghost" state of its own.
  const PART3_GHOST_HEX = "#555a60";
  function applyPart3View(colors) {
    const mode = state.part3ViewMode;
    if (mode !== "weld" && mode !== "junction") return colors;
    const view = {};
    // Keep "hidden" files hidden (a mesh variant genuinely not active right
    // now, e.g. a foot design's cube/rocker alternative) -- everything else
    // defaults to ghost (absent from `view`) unless overridden below, even
    // if it was ghost for a totally different reason in the normal view
    // (e.g. a mounting foot whose own design hasn't been picked in Part 1
    // yet still has its own independent weld answer worth showing here).
    Object.keys(colors).forEach((file) => { if (colors[file] === "hidden") view[file] = "hidden"; });
    function setIfActive(file, color) {
      if (colors[file] === "hidden") return; // a different mesh variant is the active one right now
      if (color) view[file] = color;
    }
    if (mode === "weld") {
      FOOT_LOCATIONS.forEach(({ row, plateFile }) => {
        const color = weldCellColor("mounting_feet_table", row);
        [plateFile, footCubeFile(row), doublePlaneFile(row), rockerBaseFile(row), rockerFoldFile(row)].forEach((f) => setIfActive(f, color));
      });
      if (getAnswer("roof_bars").value === "253-12-1" && colors["Roof bar 2.stl"] !== "hidden") {
        view["Roof bar 2.stl"] = { axis: "x", min: 179.52, max: 999, inside: weldRowsColor(ROOF_4_1_WELD_ID, ["rear_roof_left"]) || PART3_GHOST_HEX, outside: weldRowsColor(ROOF_4_1_WELD_ID, ["front_roof_right"]) || PART3_GHOST_HEX };
      }
      part3CandidateFiles().forEach((file) => {
        if (file === "Roof bar 2.stl" && getAnswer("roof_bars").value === "253-12-1") return; // handled above as a band split
        const t = part3RowTargetsForFile(file);
        if (t) setIfActive(file, weldRowsColor(t.weldElementId, t.rowIds));
      });
    } else {
      const backstayColor = distanceValueColor(getAnswer("backstay_distance_upper_laterals").value);
      setIfActive("Left backstay.stl", backstayColor);
      setIfActive("Right backstay.stl", backstayColor);
      setIfActive(MAIN_DIAG_TOP_RIGHT_FILE, mainDiagonalJunctionColor(MAIN_DIAG_TOP_RIGHT_FILE));
      setIfActive(MAIN_DIAG_TOP_LEFT_FILE, mainDiagonalJunctionColor(MAIN_DIAG_TOP_LEFT_FILE));
      if (getAnswer("roof_bars").value === "253-12-1" && colors["Roof bar 2.stl"] !== "hidden") {
        view["Roof bar 2.stl"] = { axis: "x", min: 179.52, max: 999, inside: distanceRowsColor(ROOF_4_1_DIST_ID, ["rear_roof_left"]) || PART3_GHOST_HEX, outside: distanceRowsColor(ROOF_4_1_DIST_ID, ["front_roof_right"]) || PART3_GHOST_HEX };
      }
      part3CandidateFiles().forEach((file) => {
        if (file === "Roof bar 2.stl" && getAnswer("roof_bars").value === "253-12-1") return; // handled above as a band split
        const t = part3RowTargetsForFile(file);
        if (t && t.distElementId) setIfActive(file, distanceRowsColor(t.distElementId, t.rowIds));
      });
    }
    return view;
  }

  // Which design-choice element is currently responsible for a given file's
  // color -- rebuilt every computeCageColors() call alongside the colors
  // themselves, and used by handleCagePartClick() to jump the checklist to
  // the right section when a bar in the 3D model is clicked. Keyed the same
  // as `colors`; a file with no owner here (fully hidden, or never claimed
  // by any element) just doesn't jump anywhere when clicked.
  let CAGE_FILE_OWNER = {};

  function computeCageColors() {
    const colors = {};
    const owner = {};
    HIDDEN_WHILE_TUNING_FILES.forEach((f) => { colors[f] = "hidden"; });

    // Driver/Codriver mannequins -- not tied to any checklist answer, so
    // resolved independently of everything below. The driver is always
    // shown (unless the "Hide driver" toggle is off); the codriver only
    // shows when actually running with one -- see vehicle_codriver in
    // Vehicle description. Seat shell and body render dim/ghosted (context,
    // not a compliance item); the held prop (steering wheel / book) gets a
    // bright highlight since it's the thing that has to swap sides for a
    // right-hand-drive car.
    const DRIVER_FILES = ["Driver seat.stl", "Driver.stl", "Driver wheel.stl"];
    const CODRIVER_FILES = ["Codriver seat.stl", "Codriver.stl", "Codriver book.stl"];
    if (!state.showDriver) {
      DRIVER_FILES.concat(CODRIVER_FILES).forEach((f) => { colors[f] = "hidden"; });
    } else {
      colors["Driver seat.stl"] = CAGE_COLOR.occupantGhost;
      colors["Driver.stl"] = CAGE_COLOR.occupantGhost;
      colors["Driver wheel.stl"] = CAGE_COLOR.occupantProp;
      const hasCodriver = getAnswer("vehicle_codriver").value === "yes";
      colors["Codriver seat.stl"] = hasCodriver ? CAGE_COLOR.occupantGhost : "hidden";
      colors["Codriver.stl"] = hasCodriver ? CAGE_COLOR.occupantGhost : "hidden";
      colors["Codriver book.stl"] = hasCodriver ? CAGE_COLOR.occupantProp : "hidden";
    }

    if (!state.pathId || !RULES[state.vehicle.org] || !RULES[state.vehicle.org].paths[state.pathId]) {
      CAGE_FILE_OWNER = owner;
      return colors;
    }
    const path = RULES[state.vehicle.org].paths[state.pathId];
    path.elements.forEach((elm) => {
      const answer = getAnswer(elm.id);
      const value = answer && answer.value;
      if (!value) return;
      const claim = (map) => Object.keys(map).forEach((f) => { owner[f] = elm.id; });

      if (elm.id === "main_structure_layout") {
        const map = baseStructureColors(value);
        if (map) { Object.assign(colors, map); claim(map); }
        return;
      }
      if (elm.id === "main_structure_present" || elm.id === "base_structure_present") {
        if (value === "yes") { const map = baseStructureColors("253-3"); Object.assign(colors, map); claim(map); }
        return;
      }
      // "Other design" (main_structure_layout === "none") builds its base
      // structure up from separate lateral/transverse answers instead of
      // the single 253-1/253-2/253-3 choice -- reusing the exact same
      // parts/band-split as the identified 253-1 structure once transverse
      // members are also confirmed present.
      if (elm.id === "lateral_rollbars_other") {
        if (value === "253-3") {
          // Full-length half rollbar, same as the identified 253-3 structure.
          colors["Front left lateral.stl"] = CAGE_COLOR.side;
          colors["Front right lateral.stl"] = CAGE_COLOR.side;
          claim({ "Front left lateral.stl": 1, "Front right lateral.stl": 1 });
        } else if (value === "253-1") {
          // Stops at the windshield top by itself -- the reach-back zone
          // above that (x>145) only becomes a real bar once transverse
          // members are added, so it's shown muted (not the same gold as
          // the confirmed pillar) until then, rather than looking
          // identical to 253-3's full-length bar.
          const transVal = getAnswer("transverse_members_253_1").value;
          const reachBackColor = transVal === "3-bars" || transVal === "halo" ? CAGE_COLOR.member : "#555a60";
          colors["Front left lateral.stl"] = { axis: "x", min: 145, max: 999, inside: reachBackColor, outside: CAGE_COLOR.side };
          colors["Front right lateral.stl"] = { axis: "x", min: 145, max: 999, inside: reachBackColor, outside: CAGE_COLOR.side };
          claim({ "Front left lateral.stl": 1, "Front right lateral.stl": 1 });
        }
        return;
      }
      if (elm.id === "transverse_member_253_3") {
        if (value === "yes") { colors["Transverse member.stl"] = CAGE_COLOR.member; owner["Transverse member.stl"] = elm.id; }
        return;
      }
      if (elm.id === "transverse_members_253_1") {
        if (value === "3-bars" || value === "halo") { colors["Transverse member.stl"] = CAGE_COLOR.member; owner["Transverse member.stl"] = elm.id; }
        return;
      }

      const rule = ITEM_PART_RULES[elm.id];
      if (!rule) return;
      const result = rule(value, answer);
      if (!result) return;
      result.files.forEach((f) => { colors[f] = result.color; owner[f] = elm.id; });
    });
    // Mounting feet aren't gated by a single per-element value the main
    // loop above can see (their answers live per-cell under
    // "mounting_feet_design__<row>__design"), so each foot is resolved
    // separately here. Once a design is picked: "multiplane_box" (253-54)
    // swaps the flat plate for the placeholder cube; "double_plane" (253-53)
    // keeps the flat plate AND adds the rotated duplicate plate;
    // "multiplane_rocker" (253-55/56) is a second 253-53 step on top, so it
    // shows all four (real plate + fold + rocker base + rocker fold); every
    // other design just shows the flat plate alone -- unused parts stay
    // hidden either way. Before anything is answered, this previews 253-50
    // (the plain single-plane plate, the simplest/most common design)
    // ghosted -- hiding the other designs' extra geometry so only the one
    // real plate mesh ghosts, rather than every possible design's parts
    // (box/double-plane/rocker) all overlapping as ghosts at once.
    FOOT_LOCATIONS.forEach(({ row, plateFile }) => {
      const cubeFile = footCubeFile(row);
      const doubleFile = doublePlaneFile(row);
      const rockerBase = rockerBaseFile(row);
      const rockerFold = rockerFoldFile(row);
      const design = getAnswer("mounting_feet_design__" + row + "__design").value;
      if (!design) {
        colors[cubeFile] = "hidden";
        colors[doubleFile] = "hidden";
        colors[rockerBase] = "hidden";
        colors[rockerFold] = "hidden";
        return;
      }
      if (design === "multiplane_box") {
        colors[plateFile] = "hidden";
        colors[doubleFile] = "hidden";
        colors[rockerBase] = "hidden";
        colors[rockerFold] = "hidden";
        colors[cubeFile] = CAGE_COLOR.foot;
        owner[cubeFile] = "mounting_feet_design";
      } else if (design === "double_plane" || design === "multiplane_rocker") {
        colors[cubeFile] = "hidden";
        colors[plateFile] = CAGE_COLOR.foot;
        colors[doubleFile] = CAGE_COLOR.foot;
        owner[plateFile] = "mounting_feet_design";
        owner[doubleFile] = "mounting_feet_design";
        if (design === "multiplane_rocker") {
          colors[rockerBase] = CAGE_COLOR.foot;
          colors[rockerFold] = CAGE_COLOR.foot;
          owner[rockerBase] = "mounting_feet_design";
          owner[rockerFold] = "mounting_feet_design";
        } else {
          colors[rockerBase] = "hidden";
          colors[rockerFold] = "hidden";
        }
      } else {
        colors[cubeFile] = "hidden";
        colors[doubleFile] = "hidden";
        colors[rockerBase] = "hidden";
        colors[rockerFold] = "hidden";
        colors[plateFile] = CAGE_COLOR.foot;
        owner[plateFile] = "mounting_feet_design";
      }
    });

    // A-pillar (253-15) tube: continuous vs 2-bar are mutually exclusive
    // alternate geometries (real tube + their own gusset sets), not
    // independently-claimable parts, so they're resolved here rather than
    // through ITEM_PART_RULES. Before anything is answered, this previews
    // the continuous (single-bar) build ghosted -- the common/simpler case
    // -- rather than hiding the whole area until a choice is made; once
    // answered, the chosen build's real geometry lights up and the other
    // build's tube + gussets are explicitly hidden (not just left to
    // default-ghost, which would otherwise clutter both builds together).
    const aPillarValue = getAnswer("a_pillar_reinforcement").value;
    const aPillarPreview = aPillarValue || "continuous";
    if (aPillarPreview === "continuous") {
      APILLAR_2PIECE_FILES.forEach((f) => { colors[f] = "hidden"; });
      APILLAR_2PC_GUSSET_FILES.forEach((f) => { colors[f] = "hidden"; });
      if (aPillarValue === "continuous") {
        APILLAR_FILES.forEach((f) => { colors[f] = CAGE_COLOR.aPillar; owner[f] = "a_pillar_reinforcement"; });
      }
    } else {
      APILLAR_FILES.forEach((f) => { colors[f] = "hidden"; });
      APILLAR_SIDE_GUSSET_FILES.forEach((f) => { colors[f] = "hidden"; });
      if (aPillarValue === "two_bars") {
        APILLAR_2PIECE_FILES.forEach((f) => { colors[f] = CAGE_COLOR.aPillar; owner[f] = "a_pillar_reinforcement"; });
      }
    }

    // Gusset design: "Gusset design" table (rules-data.js) drives whether
    // each gusset shows at all -- Taco and Single plate both use the same
    // modeled shape for now (see CAGE_COLOR comment), so the only thing the
    // design choice changes here is the color tint, not which file shows.
    //
    // gussetJunctionRows() is dynamic -- rows can disappear when an upstream
    // answer changes (e.g. switching roof_bars away from 253-12, or 253-15
    // from "2 bars" back to "1 continuous bar"). A row's allowed options can
    // also narrow (restrictOptionIds) after an answer was already stored
    // under a since-removed option (e.g. an A-pillar/253-15 gusset saved as
    // "single_plate" back when that was still offered, now taco-only). In
    // both cases the raw stored answer alone doesn't reflect reality
    // anymore, so every lookup here is checked against the row's current
    // definition -- a row that's gone, or a value no longer in its current
    // restrictOptionIds, reads as ghost/unanswered rather than keeping its
    // stale color forever.
    const gussetDesignElm = path.elements.find((e) => e.id === "gusset_design");
    const gussetRowsById = gussetDesignElm ? new Map(resolveRows(gussetDesignElm).map((r) => [r.id, r])) : null;
    function gussetDesignColor(row) {
      if (gussetRowsById && !gussetRowsById.has(row)) return null;
      const rowDef = gussetRowsById && gussetRowsById.get(row);
      const design = getAnswer("gusset_design__" + row + "__design").value;
      if (rowDef && rowDef.restrictOptionIds && design && rowDef.restrictOptionIds.indexOf(design) === -1) return null;
      if (design === "taco") return CAGE_COLOR.gussetTaco;
      if (design === "single_plate") return CAGE_COLOR.gussetSinglePlate;
      return null;
    }
    GUSSET_LOCATIONS.forEach(({ row, file }) => {
      const color = gussetDesignColor(row);
      if (!color) return;
      colors[file] = color;
      owner[file] = "gusset_design";
    });

    // Roof corner gussets: independent presence toggles (not routed through
    // the shared "Gusset design" table above, since these are optional
    // supplementary plates rather than a required junction with a design
    // choice) -- see ROOF_CORNER_GUSSET_LOCATIONS.
    ROOF_CORNER_GUSSET_LOCATIONS.forEach(({ row, file }) => {
      if (getAnswer("roof_corner_gussets__" + row + "__present").value === "yes") {
        colors[file] = CAGE_COLOR.gussetSinglePlate;
        owner[file] = "roof_corner_gussets";
      }
    });

    // Fallback ownership so ghost (unconfirmed) bars are clickable too --
    // see possibleFilesForElement()'s comment. Only fills in files nothing
    // above already claimed, so it never overrides a real, confirmed owner.
    function claimUnowned(files, elmId) { files.forEach((f) => { if (!owner[f]) owner[f] = elmId; }); }
    claimUnowned(["Front left lateral.stl", "Front right lateral.stl", "Main rollbar.stl"], "main_structure_layout");
    claimUnowned(["Transverse member.stl"], getAnswer("main_structure_layout").value === "253-1" ? "transverse_members_253_1" : "transverse_member_253_3");
    claimUnowned(APILLAR_FILES.concat(APILLAR_2PIECE_FILES), "a_pillar_reinforcement");
    // "253-26,27 harness bar.stl" is also reused by main_hoop_diagonals'
    // "1 horizontal bar" option (same physical tube) -- claimed explicitly
    // here, before the generic per-element loop below, so a ghost click on
    // it jumps to the harness bar's own section (its primary identity)
    // rather than main_hoop_diagonals, which would otherwise win the claim
    // purely because it happens to appear earlier in path.elements.
    claimUnowned(["253-26,27 harness bar.stl"], "harness_bar_present");
    FOOT_LOCATIONS.forEach(({ plateFile }) => claimUnowned([plateFile], "mounting_feet_design"));
    GUSSET_LOCATIONS.forEach(({ row, file }) => {
      if (gussetRowsById && !gussetRowsById.has(row)) return; // not a currently real/visible row
      claimUnowned([file], "gusset_design");
    });
    ROOF_CORNER_GUSSET_LOCATIONS.forEach(({ file }) => claimUnowned([file], "roof_corner_gussets"));
    path.elements.forEach((elm) => {
      const rule = ITEM_PART_RULES[elm.id];
      if (!rule) return;
      claimUnowned(possibleFilesForElement(elm, rule), elm.id);
    });

    // AI photo-analysis suggestion preview: while a suggestion's checkbox
    // is checked (not yet applied -- see renderPhotoAnalysis), highlight
    // the bar(s) it refers to so it's obvious which bar a suggestion means
    // before accepting it. Overrides whatever color that file would
    // otherwise have, since this is a transient preview, not a real answer.
    if (state.aiAnalysis.status === "done") {
      state.aiAnalysis.suggestions.forEach((s) => {
        if (!state.aiAnalysis.accepted[s.elementId]) return;
        let files;
        if (s.elementId === "main_structure_layout") {
          const map = baseStructureColors(s.value);
          files = map ? Object.keys(map) : [];
        } else if (s.elementId === "a_pillar_reinforcement") {
          files = s.value === "continuous" ? APILLAR_FILES : s.value === "two_bars" ? APILLAR_2PIECE_FILES : [];
        } else {
          const rule = ITEM_PART_RULES[s.elementId];
          const result = rule ? rule(s.value, { value: s.value }) : null;
          files = result ? result.files : [];
        }
        files.forEach((f) => { colors[f] = CAGE_COLOR.aiPreview; });
      });
    }

    CAGE_FILE_OWNER = owner;
    if (state.activeTab === 2) return applyTubingClassificationView(colors);
    if (state.activeTab === 3) return applyPart3View(colors);
    return colors;
  }

  // The live cage model panel is position:sticky at the top of the page
  // (see style.css) so it visually sits on top of whatever content scrolls
  // to y=0 -- plain scrollIntoView({block:"start"|"center"}) doesn't know
  // about that overlay and can land a target right underneath it. Scroll
  // manually instead, offset by the panel's current on-screen height (which
  // varies: collapsed via "Hide", or the row not existing on a path with no
  // 3D model).
  function scrollBelowViewer(target, opts) {
    const center = opts && opts.center;
    const panelEl = document.querySelector(".cage-viewer-row");
    const stickyHeight = panelEl ? panelEl.getBoundingClientRect().height : 0;
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const top = center
      ? window.pageYOffset + rect.top - stickyHeight - Math.max(margin, (window.innerHeight - stickyHeight - rect.height) / 2)
      : window.pageYOffset + rect.top - stickyHeight - margin;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // Briefly outlines an element so a click lands somewhere obvious even
  // when it's not obvious from the scroll alone that anything changed.
  function flashEl(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so re-clicking the same bar restarts the animation
    el.classList.add(cls);
  }
  function flashRow(rowEl) { flashEl(rowEl, "row-flash"); }
  function flashCard(cardEl) { flashEl(cardEl, "card-flash"); }

  // Jumps the checklist to a design-choice card: switches to Part 1 (every
  // clickable bar's owner lives there), expands it if it had been
  // auto-collapsed, scrolls it into view below the sticky model panel, and
  // flashes it the same way a clicked table row flashes.
  function jumpToSection(elmId) {
    state.activeTab = 1;
    state.expandedIds[elmId] = true;
    render();
    const target = document.getElementById("section-" + elmId);
    if (!target) return;
    scrollBelowViewer(target);
    flashCard(target);
  }

  // Part 2's single shared "Tube classification" table has one row per bar
  // (see doorBarTubeRows()/roofBarTubeRows() and FILE_TO_TUBE_ROW), so
  // clicking a bar while already on Part 2 scrolls to and flashes that row
  // instead of switching to Part 1's design-choice card -- a band-split
  // file (see tubeRowSplitBand) covers 2 rows on one mesh, so both flash.
  function jumpToTubeRow(file) {
    const band = tubeRowSplitBand(file);
    const row = fileTubeRow(file);
    const rowIds = band ? [band.insideRow, band.outsideRow] : row ? [row] : [];
    if (!rowIds.length) return;
    let first = null;
    rowIds.forEach((rowId) => {
      const rowEl = document.getElementById("row-tubing_bar_classification__" + rowId);
      if (!rowEl) return;
      if (!first) first = rowEl;
      flashRow(rowEl);
    });
    if (first) scrollBelowViewer(first, { center: true });
  }

  // "Mounting feet design" is a table (one row per foot), same situation as
  // Part 2's tube classification table -- so a clicked foot's plate/cube/
  // double-plane mesh flashes its own row instead of just expanding the
  // (already-always-expanded) table card the way jumpToSection would.
  function footRowForFile(file) {
    const loc = FOOT_LOCATIONS.find((l) => file === l.plateFile || file === footCubeFile(l.row) ||
      file === doublePlaneFile(l.row) || file === rockerBaseFile(l.row) || file === rockerFoldFile(l.row));
    return loc ? loc.row : null;
  }
  function jumpToFootRow(row) {
    state.activeTab = 1;
    render();
    const rowEl = document.getElementById("row-mounting_feet_design__" + row);
    if (!rowEl) return;
    scrollBelowViewer(rowEl, { center: true });
    flashRow(rowEl);
  }
  // Same idea as jumpToFootRow, but for Part 2's own "Mounting plate size"
  // table -- stays on Part 2 (that table is already on screen) instead of
  // switching to Part 1's design table.
  function jumpToFootSizeRow(row) {
    const rowEl = document.getElementById("row-mounting_feet_size__" + row);
    if (!rowEl) return;
    scrollBelowViewer(rowEl, { center: true });
    flashRow(rowEl);
  }
  // Same idea as footRowForFile/jumpToFootRow, for the "Gusset design" table.
  function gussetRowForFile(file) {
    const loc = GUSSET_LOCATIONS.find((l) => file === l.file);
    return loc ? loc.row : null;
  }
  function jumpToGussetRow(row) {
    state.activeTab = 1;
    render();
    const rowEl = document.getElementById("row-gusset_design__" + row);
    if (!rowEl) return;
    scrollBelowViewer(rowEl, { center: true });
    flashRow(rowEl);
  }

  // Wired to CageView.onPartClick() -- lets clicking a bar in the live 3D
  // model act as the index into the checklist, instead of a separate table
  // of contents. While on Part 2, this stays on Part 2 and jumps within its
  // own tube classification table (or, for a mounting foot, its plate-size
  // row) rather than switching to Part 1.
  // Double-clicking a bar in the 3D model toggles it on/off directly for
  // "unambiguous" parts (one ghost mesh maps to exactly one answer), or --
  // for parts shared across multiple design choices (door bars, A-pillar
  // continuous vs 2-bar, base structure, roof bars, main hoop/backstay
  // diagonals) -- fills in the single most common design (only if the
  // element is still unanswered, never overwriting an existing choice) and
  // jumps to that section the same way a single click does, so an
  // unusual/non-default design is still one click away to correct.
  //
  // toggleComponent implements the shared "does this side/half currently
  // apply" logic behind every left/right or upper/lower choice (temple bar,
  // windshield reinforcement, 253-17 rear lateral): given the element's
  // current value and the component just double-clicked, decide the new
  // value by adding or removing just that component.
  function toggleComponent(current, thisComp, otherComp, bothValue, noneValue) {
    const hasThis = current === thisComp || current === bothValue;
    const hasOther = current === otherComp || current === bothValue;
    if (hasThis) return hasOther ? otherComp : noneValue;
    return hasOther ? bothValue : thisComp;
  }

  const DOUBLE_CLICK_TOGGLE_MAP = {
    "Dash bar 253-29.stl": { elementId: "dash_bar_present", kind: "boolean" },
    "253-18.stl": { elementId: "rear_transversal_present", kind: "boolean" },
    "253-19 left.stl": { elementId: "rear_lower_x_present", kind: "boolean" },
    "253-19 right.stl": { elementId: "rear_lower_x_present", kind: "boolean" },
    "253-25 upper left.stl": { elementId: "anti_intrusion_present", kind: "boolean" },
    "253-25 lower left.stl": { elementId: "anti_intrusion_present", kind: "boolean" },
    "253-25 upper right.stl": { elementId: "anti_intrusion_present", kind: "boolean" },
    "253-25 lower right.stl": { elementId: "anti_intrusion_present", kind: "boolean" },
    "253-30 lower main hoop bar.stl": { elementId: "lower_main_hoop_bar_present", kind: "boolean" },
    "253-31 temple bar left.stl": { elementId: "temple_bar_present", kind: "side", side: "left", other: "right" },
    "253-31 temple bar right.stl": { elementId: "temple_bar_present", kind: "side", side: "right", other: "left" },
    "253-31 windshield left.stl": { elementId: "windshield_reinforcement_present", kind: "side", side: "left", other: "right" },
    "253-31 windshield right.stl": { elementId: "windshield_reinforcement_present", kind: "side", side: "right", other: "left" },
    "253-26,27 harness bar.stl": { elementId: "harness_bar_present", kind: "exclusive", value: "253-26-27" },
    "253-28,66 rear harness bar.stl": { elementId: "harness_bar_present", kind: "exclusive", value: "253-28-66" },
    "253-17 left upper.stl": { elementId: "rear_lateral_reinforcement_present", kind: "side", side: "upper", other: "lower" },
    "253-17 right upper.stl": { elementId: "rear_lateral_reinforcement_present", kind: "side", side: "upper", other: "lower" },
    "253-17 left lower.stl": { elementId: "rear_lateral_reinforcement_present", kind: "side", side: "lower", other: "upper" },
    "253-17 right lower.stl": { elementId: "rear_lateral_reinforcement_present", kind: "side", side: "lower", other: "upper" },
  };

  // Most common design per ambiguous (shared-geometry) element -- filled in
  // only when that element has no answer yet.
  const AMBIGUOUS_ELEMENT_DEFAULTS = {
    main_structure_layout: "253-3",
    main_hoop_diagonals: "253-7",
    backstay_diagonals: "253-21",
    roof_bars: "253-12-1",
    door_bars_left: "253-9-intersection-1",
    door_bars_right: "253-9-intersection-1",
    a_pillar_reinforcement: "continuous",
  };

  // A gusset row's own design choice can be restricted to just one shape
  // (restrictOptionIds, e.g. lateral-to-A-pillar gussets are single-plate
  // only) -- double-click should fill in whichever shape is actually
  // allowed there rather than always defaulting to the same one.
  function defaultGussetDesignFor(rowDef) {
    if (rowDef && rowDef.restrictOptionIds && rowDef.restrictOptionIds.length === 1) return rowDef.restrictOptionIds[0];
    return "single_plate";
  }

  // Mounting foot double-click cycles through plate designs (see
  // MOUNTING_FOOT_DESIGN_OPTIONS) rather than a single toggle, since there
  // are several real options per foot. Front/main-hoop feet sit upright on
  // the floor (single-plane 253-50/51/52 is their simplest, most common
  // design); the backstay feet meet the floor at the backstay's own lean
  // (hingeFace:"tilted" in FOOT_LOCATIONS), which is what 253-57's flat-or-
  // curved plate is specifically for -- 253-50 and 253-55/56 aren't really
  // applicable there, so the rear cycle skips them.
  const FRONT_FOOT_ROWS = new Set(["front_left", "front_right", "main_hoop_left", "main_hoop_right"]);
  const FRONT_FOOT_DESIGN_CYCLE = ["single_plane", "double_plane", "multiplane_box", "multiplane_rocker", ""];
  const REAR_FOOT_DESIGN_CYCLE = ["flat_curved", "double_plane", "multiplane_box", ""];

  const TUBE_SPEC_CYCLE = ["primary", "secondary", ""];

  function handleCagePartDoubleClick(file) {
    // Part 2 (Tubing sizes & materials): double-click cycles that bar's own
    // primary/secondary tubing spec instead of anything Part-1-related --
    // matches how a single click already jumps to the tube-classification
    // row instead of the design-choice section while this tab is active.
    // A band-split file (one mesh, two classification rows -- see
    // tubeRowSplitBand) cycles both rows together, in lockstep.
    if (state.activeTab === 2) {
      const band = tubeRowSplitBand(file);
      const row = fileTubeRow(file);
      const rowIds = band ? [band.insideRow, band.outsideRow] : row ? [row] : [];
      if (!rowIds.length) return;
      const current = getAnswer("tubing_bar_classification__" + rowIds[0] + "__spec").value;
      const next = TUBE_SPEC_CYCLE[(TUBE_SPEC_CYCLE.indexOf(current) + 1) % TUBE_SPEC_CYCLE.length];
      rowIds.forEach((rowId) => setAnswer("tubing_bar_classification__" + rowId + "__spec", { value: next }));
      return;
    }
    // Part 3 Weld view: double-click cycles that bar's own weld-completion
    // answer (yes -> no -> not-yet-checked) instead of anything else a
    // double-click would normally do -- scoped to the same bars
    // applyPart3View() knows how to color (see its own comment for why).
    if (state.activeTab === 3 && state.part3ViewMode === "weld") {
      const weldFootRow = footRowForFile(file);
      const cycle = ["yes", "no", ""];
      if (weldFootRow) {
        const key = "mounting_feet_table__" + weldFootRow + "__weld";
        const idx = cycle.indexOf(getAnswer(key).value);
        setAnswer(key, { value: cycle[(idx + 1) % cycle.length] });
        return;
      }
      // Roof bar 2 under "253-12-1" is a band-split mesh (2 rows, no
      // dedicated resolver entry -- see part3RowTargetsForFile) -- cycles
      // both halves' rows together in lockstep, same as Part 2's tubing
      // view already does for its own band-split files.
      const target = (file === "Roof bar 2.stl" && getAnswer("roof_bars").value === "253-12-1")
        ? { rowIds: ["front_roof_right", "rear_roof_left"], weldElementId: ROOF_4_1_WELD_ID }
        : part3RowTargetsForFile(file);
      if (target && target.rowIds.length) {
        const keys = target.rowIds.map((r) => target.weldElementId + "__" + r + "__weld");
        const idx = cycle.indexOf(getAnswer(keys[0]).value);
        const next = cycle[(idx + 1) % cycle.length];
        keys.forEach((key) => setAnswer(key, { value: next }));
      }
      return;
    }
    const footRow = footRowForFile(file);
    if (footRow) {
      const cycle = FRONT_FOOT_ROWS.has(footRow) ? FRONT_FOOT_DESIGN_CYCLE : REAR_FOOT_DESIGN_CYCLE;
      const key = "mounting_feet_design__" + footRow + "__design";
      const idx = cycle.indexOf(getAnswer(key).value);
      setAnswer(key, { value: cycle[(idx + 1) % cycle.length] });
      return;
    }
    const gussetRow = GUSSET_FILE_TO_ROW.get(file);
    if (gussetRow) {
      const path = RULES[state.vehicle.org].paths[state.pathId];
      const gussetDesignElm = path.elements.find((e) => e.id === "gusset_design");
      const rowDef = gussetDesignElm && resolveRows(gussetDesignElm).find((r) => r.id === gussetRow);
      if (!rowDef) return; // not a currently valid/visible gusset row
      const key = "gusset_design__" + gussetRow + "__design";
      const current = getAnswer(key).value;
      setAnswer(key, { value: current ? "" : defaultGussetDesignFor(rowDef) });
      return;
    }
    const roofCornerRow = ROOF_CORNER_GUSSET_FILE_TO_ROW.get(file);
    if (roofCornerRow) {
      const key = "roof_corner_gussets__" + roofCornerRow + "__present";
      setAnswer(key, { value: getAnswer(key).value === "yes" ? "no" : "yes" });
      return;
    }

    const toggle = DOUBLE_CLICK_TOGGLE_MAP[file];
    if (toggle) {
      const current = getAnswer(toggle.elementId).value;
      let next;
      if (toggle.kind === "boolean") next = current === "yes" ? "no" : "yes";
      else if (toggle.kind === "side") next = toggleComponent(current, toggle.side, toggle.other, "both", "none");
      else if (toggle.kind === "exclusive") next = current === toggle.value ? "none" : toggle.value;
      if (next !== undefined) setAnswer(toggle.elementId, { value: next });
      return;
    }

    const elmId = CAGE_FILE_OWNER[file];
    if (!elmId) return;
    const defaultValue = AMBIGUOUS_ELEMENT_DEFAULTS[elmId];
    if (defaultValue && !getAnswer(elmId).value) setAnswer(elmId, { value: defaultValue });
    jumpToSection(elmId);
  }

  function handleCagePartClick(file) {
    if (state.activeTab === 2) {
      const footRow = footRowForFile(file);
      if (footRow) { jumpToFootSizeRow(footRow); return; }
      jumpToTubeRow(file);
      return;
    }
    const footRow = footRowForFile(file);
    if (footRow) {
      jumpToFootRow(footRow);
      return;
    }
    const gussetRow = gussetRowForFile(file);
    if (gussetRow) {
      jumpToGussetRow(gussetRow);
      return;
    }
    const elmId = CAGE_FILE_OWNER[file];
    if (elmId) jumpToSection(elmId);
  }

  function syncCageView() {
    if (window.CageView) {
      const colors = computeCageColors();
      window.CageView.applyState(colors, state.showGhostBars);
      window.CageView.onPartClick(handleCagePartClick);
      window.CageView.onPartDoubleClick(handleCagePartDoubleClick);
      window.CageView.setDriverMirrored(getAnswer("vehicle_drive_side").value === "rhd");
    }
  }

  function render() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    renderSessionBar(root);

    renderVehicleDescription(root);

    if (!state.pathId) {
      const logbookPanel = el("div", { class: "panel" });
      logbookPanel.appendChild(el("h2", {}, ["Logbook"]));
      logbookPanel.appendChild(
        el("div", {}, ["Select logbook status / date below (or choose a path directly) to load the checklist."])
      );
      appendLogbookFields(logbookPanel);
      root.appendChild(logbookPanel);
      syncCageView();
      return;
    }

    const path = RULES[state.vehicle.org].paths[state.pathId];
    renderChecklist(root, path);
    // Safety score, then Logbook (verdict for the selected sanctioning body,
    // merged with its paperwork fields) -- always trailing the checklist
    // now, no tab to move them behind.
    renderSafetyScore(root, path);
    renderResults(root, path);
    syncCageView();
  }

  // ---- Boot -------------------------------------------------------

  function boot() {
    const all = loadAll();
    const ids = Object.keys(all);
    if (ids.length) {
      const latest = Object.values(all).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      loadSession(latest.sessionId);
    } else {
      startNew();
    }
    const ghostBtn = document.getElementById("cageViewerGhostToggle");
    if (ghostBtn) {
      ghostBtn.addEventListener("click", () => {
        state.showGhostBars = !state.showGhostBars;
        ghostBtn.textContent = state.showGhostBars ? "Hide ghost bars" : "Show ghost bars";
        syncCageView();
      });
    }
    const driverBtn = document.getElementById("cageViewerDriverToggle");
    if (driverBtn) {
      driverBtn.addEventListener("click", () => {
        state.showDriver = !state.showDriver;
        driverBtn.textContent = state.showDriver ? "Hide driver" : "Show driver";
        syncCageView();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
