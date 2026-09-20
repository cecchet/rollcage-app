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
    activeTab: 1, // UI-only: which phase (Part 1-7) tab is currently shown -- see PHASE_LABELS
    justSaved: false, // UI-only: briefly true right after the Save button is clicked
    showGhostBars: true, // UI-only: whether bars not yet confirmed show dimmed for context, or are hidden entirely
    showDriver: true, // UI-only: whether the driver/codriver mannequins show, or are hidden to see the cage behind them
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
  function toMM(dim) {
    const inches = toInches(dim);
    return inches === null ? null : inches * 25.4;
  }
  // "D" for a gusset_dimensions row -- the biggest of the tube(s) it
  // actually joins (see gussetRowTubeRowIds in rules-data.js, handed out
  // via the element's own tubeRowIdsForRow closure), resolved to its real
  // primary/secondary diameter as entered in Part 2. Returns null when the
  // relevant tube(s) haven't been classified/sized yet, so the hint just
  // stays hidden rather than showing a bogus 0.
  function gussetRowDiameterMM(rowId) {
    if (!state.pathId || !RULES[state.vehicle.org] || !RULES[state.vehicle.org].paths[state.pathId]) return null;
    const path = RULES[state.vehicle.org].paths[state.pathId];
    const elm = path.elements.find((e) => e.id === "gusset_dimensions");
    if (!elm || !elm.tubeRowIdsForRow) return null;
    let maxMM = null;
    elm.tubeRowIdsForRow(getAnswer, rowId).forEach((tr) => {
      const spec = getAnswer("tubing_bar_classification__" + tr + "__spec").value;
      const soloId = spec === "primary" ? "primary_tubing" : spec === "secondary" ? "secondary_tubing" : null;
      if (!soloId) return;
      const mm = toMM(getAnswer(soloId).value && getAnswer(soloId).value.diameter);
      if (mm !== null && (maxMM === null || mm > maxMM)) maxMM = mm;
    });
    return maxMM;
  }
  // Every diameter hint in a gusset_dimensions row (length's 2D/4D, corner
  // cutout's 1.5D, hole diameter's D) shares ONE unit -- the row's own
  // "length" cell's unit selector -- rather than each column tracking its
  // own, so switching mm/in there updates every hint in the row at once.
  function gussetRowLengthUnit(elm, row) {
    const lengthCol = elm.columns.find((c) => c.key === "length");
    if (!lengthCol) return "mm";
    const v = getAnswer(tableCellId(elm, row, lengthCol)).value;
    return (v && v.unit) || "mm";
  }
  // Shared by every showDiameterHint column (see rules-data.js) -- renders
  // "<multiple>D = <value> <unit>" for each of col.diameterMultiples,
  // joined with " / " (e.g. length's [2, 4] -> "2D = x / 4D = y"; corner
  // cutout's [1.5] -> "1.5D = x"). Returns null when D isn't known yet, so
  // callers can skip appending anything.
  function renderDiameterHint(elm, col, row) {
    if (!col.showDiameterHint || !row) return null;
    const dMM = gussetRowDiameterMM(row.id);
    if (dMM === null) return null;
    const unit = gussetRowLengthUnit(elm, row);
    const perUnit = unit === "in" ? 1 / 25.4 : 1;
    const fmt = (n) => (unit === "in" ? n.toFixed(2) : n.toFixed(1));
    const text = (col.diameterMultiples || [1])
      .map((m) => (m === 1 ? "D" : m + "D") + " = " + fmt(m * dMM * perUnit) + " " + unit)
      .join(" / ");
    return el("div", { class: "cell-hint" }, [text]);
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
  // A row can carry its own `compare` (e.g. installation_constraints' A/B/
  // C/R1/R2 each have a different threshold), taking priority over the
  // column's -- most "number"/"length" columns only ever set compare on
  // the column since every row shares the same threshold (e.g.
  // DISTANCE_COLUMNS' <100mm), but this lets a single shared row-table
  // definition mix rows with different (or no) thresholds instead of
  // needing a separate column/element per threshold.
  // {op: "ltFractionOfRow", fraction, ofRow} is the one relative case
  // (installation_constraints' "E (<0.5 H)") -- reads another row's OWN
  // current value in the same table/column rather than a fixed number.
  // Returns true/false, or null when there's nothing to judge yet (the
  // dependency it needs isn't answered), which callers treat as "warn"
  // rather than guessing pass or fail.
  function resolveCompare(v, compare, elm, col) {
    if (!compare) return true;
    if (compare.op === "ltFractionOfRow") {
      if (!elm) return null;
      const otherAnswer = getAnswer(tableCellId(elm, { id: compare.ofRow }, col));
      const otherV = otherAnswer.value;
      const otherMM = col.type === "length" ? toMM({ val: otherV && otherV.value, unit: (otherV && otherV.unit) || "mm" })
        : (otherV === "" || otherV == null ? null : parseFloat(otherV));
      if (otherMM === null || otherMM === undefined || isNaN(otherMM)) return null;
      return v < compare.fraction * otherMM;
    }
    return compareOk(v, compare);
  }
  function tableCellStatus(col, answer, row, elm) {
    if (col.type === "boolean" || col.type === "compliance") {
      if (answer.value === "yes") return "pass";
      if (answer.value === "no") return "fail";
      return "warn";
    }
    if (col.type === "number") {
      if (answer.value === "" || answer.value == null) return "warn";
      const v = parseFloat(answer.value);
      if (isNaN(v)) return "warn";
      const ok = resolveCompare(v, row && row.compare !== undefined ? row.compare : col.compare, elm, col);
      return ok === null ? "warn" : ok ? "pass" : "fail";
    }
    if (col.type === "tubing3") {
      return tubing3Status(col, answer);
    }
    if (col.type === "area" || col.type === "length") {
      // Just needs an entry -- Part 2 captures the size, Part 4 is where
      // it's actually judged against the FIA minimum for that location --
      // UNLESS this row/column carries its own compare (installation
      // constraints), in which case it's judged right here instead.
      const v = answer.value;
      const hasValue = v && v.value !== "" && v.value != null;
      if (!hasValue) return "warn";
      const compareSpec = row && row.compare !== undefined ? row.compare : col.compare;
      if (col.type === "length" && compareSpec) {
        const mm = toMM({ val: v.value, unit: v.unit || "mm" });
        const ok = mm === null ? null : resolveCompare(mm, compareSpec, elm, col);
        return ok === null ? "warn" : ok ? "pass" : "fail";
      }
      return "pass";
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
        const s = tableCellStatus(col, cellAnswer, row, elm);
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
    // {id, extra, equals}: checks that element's answer.extra[extra] (a
    // sub-toggle like door_bars_left's "sill_bar") instead of its main
    // value -- e.g. the sill bar weld table only applies to a side that
    // actually has the sill-bar sub-toggle on, independent of which door
    // bar design that side is using.
    const v = c.extra ? (getAnswer(c.id).extra || {})[c.extra] : getAnswer(c.id).value;
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
  // Old "Part 3" (Measurements, angles & welds) split into 3 separate
  // phases -- it had grown into one long scroll mixing 3 genuinely
  // different activities (checking clearances, checking welds, checking
  // junction distances). Named constants instead of bare numbers at every
  // call site since these 3 (plus Logbook) are new/renumbered and every
  // reference has to agree.
  const INSTALLATION_PHASE = 3;
  const WELDS_PHASE = 4;
  const JUNCTIONS_PHASE = 5;
  const SEATS_PHASE = 6;
  const LOGBOOK_PHASE = 7;
  const PHASE_LABELS = {
    1: "Part 1 — Structure & design choices",
    2: "Part 2 — Tubing sizes & materials",
    [INSTALLATION_PHASE]: "Part 3 — Installation constraints",
    [WELDS_PHASE]: "Part 4 — Welds",
    [JUNCTIONS_PHASE]: "Part 5 — Junctions",
    [SEATS_PHASE]: "Part 6 — Seats, belts & routing",
    [LOGBOOK_PHASE]: "Part 7 — Logbook",
  };
  // Padding and sections 9-11 of the source document (seat mounting, belt
  // anchoring, routing of lines) are a distinct later stage of the
  // inspection -- occupant safety equipment rather than the cage structure
  // itself -- so they get their own phase instead of piling into everything
  // else.
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
    if (PHASE_4_CATEGORIES.has(elm.category)) return SEATS_PHASE;
    // gusset_dimensions carries its own "Complete weld" column now (see
    // rules-data.js) alongside its D/H/R/E dimensions, so it belongs with
    // the other weld tables even though its own category is "Gussets", not
    // "Welds" -- the 3D model's weld-view coloring/click-to-jump for
    // gussets only works while this element's own rows are on screen (see
    // GUSSET_LOCATIONS/gussetRowForFile), so it has to live in the same
    // phase that view is shown in.
    if (elm.id === "gusset_dimensions") return WELDS_PHASE;
    if (elm.category === "Welds") return WELDS_PHASE;
    if (elm.category === "Bar junction distances") return JUNCTIONS_PHASE;
    // Everything else that used to fall into the old catch-all Part 3 --
    // installation clearances, plus angle/bend/straightness/compliance
    // checks that aren't a weld or a junction distance -- lands here.
    return INSTALLATION_PHASE;
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

  // Shared by renderChecklist (which parts have content to show) and the
  // Part dropdown in the sticky 3D viewer panel (which parts to offer) --
  // one computation, so the two can never disagree about what's available.
  function computeUsedPhases(path) {
    const visible = path.elements.filter(elementVisible).filter((elm) => !RENDERED_IN_LOGBOOK_PANEL.includes(elm.id));
    const phases = { 1: [], 2: [], [INSTALLATION_PHASE]: [], [WELDS_PHASE]: [], [JUNCTIONS_PHASE]: [], [SEATS_PHASE]: [] };
    visible.forEach((elm) => phases[elementPhase(elm)].push(elm));
    const usedPhases = [1, 2, INSTALLATION_PHASE, WELDS_PHASE, JUNCTIONS_PHASE, SEATS_PHASE].filter((p) => phases[p].length);
    // Logbook isn't element-driven (renderResults reads path/answers
    // directly, gated on this phase in render()) so nothing ever populates
    // phases[LOGBOOK_PHASE] -- it's still always offered as a destination.
    usedPhases.push(LOGBOOK_PHASE);
    return { phases, usedPhases };
  }
  // Safety score / Vehicle description always trail the checklist -- Logbook
  // used to as well, but now it's its own phase (LOGBOOK_PHASE), gated the
  // same way as every other part -- see render().
  function renderChecklist(root, path) {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", {}, ["Rollcage design"]));

    const { phases, usedPhases } = computeUsedPhases(path);
    const showTabs = usedPhases.length > 1;
    if (showTabs && !usedPhases.includes(state.activeTab)) state.activeTab = usedPhases[0];
    const shownPhases = showTabs ? [state.activeTab] : usedPhases;

    if (shownPhases.includes(1)) renderPhotoAnalysis(root, path);

    // Welds/Junctions' own 3D view-mode switch lives in the sticky viewer
    // panel now (see syncPart3Controls) so it's reachable regardless of
    // scroll position -- this just keeps its own explanatory text here,
    // right at the top of the part it describes.
    if (state.activeTab === WELDS_PHASE) {
      panel.appendChild(
        el("div", { class: "element-desc" }, [
          "Double-click near a specific end/weld point of a highlighted bar (or a mounting foot) to cycle that point's own status: green = complete, red = incomplete, ghost = not yet checked. A bar with more than one weld point gets its own color, split along its own length in the same order as its table rows.",
        ])
      );
    } else if (state.activeTab === JUNCTIONS_PHASE) {
      panel.appendChild(
        el("div", { class: "element-desc" }, [
          "Bars below 100mm from their junction show green, over 100mm red, and not-yet-measured ghost. Door bars have no junction-distance data to show here.",
        ])
      );
    }

    shownPhases.forEach((p) => {
      if (!phases[p]) return; // Logbook -- rendered separately by renderResults, see render()
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
      const values = answer.value || {};
      return elm.fields.every((f) => values[f.key] !== undefined && values[f.key] !== "");
    }
    // A table's own top-level answer is never set directly (only its
    // per-cell "elm.id__row.id__col.key" sub-answers are) -- so it's
    // complete once every cell has moved off "warn" (unanswered), or the
    // distance quick-check shortcut is on, same as tableElementStatus's own
    // pass/fail/warn logic.
    if (elm.evaluationType === "table") {
      if (elm.distanceQuickCheck && getAnswer(distanceQuickCheckId(elm)).value === "yes") return true;
      return resolveRows(elm).every((row) =>
        elm.columns.every((col) => {
          if (col.optional) return true;
          return tableCellStatus(col, getAnswer(tableCellId(elm, row, col)), row, elm) !== "warn";
        })
      );
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
      const values = answer.value || {};
      return elm.fields.map((f) => f.label + ": " + values[f.key] + (f.unit ? " " + f.unit : "")).join(" · ");
    }
    if (elm.evaluationType === "numeric") {
      return answer.value + (elm.unit ? " " + elm.unit : "");
    }
    if (elm.evaluationType === "table") {
      if (elm.distanceQuickCheck && getAnswer(distanceQuickCheckId(elm)).value === "yes") return "All confirmed under 100mm";
      let pass = 0, total = 0;
      resolveRows(elm).forEach((row) => {
        elm.columns.forEach((col) => {
          if (col.optional) return;
          total++;
          if (tableCellStatus(col, getAnswer(tableCellId(elm, row, col)), row, elm) === "pass") pass++;
        });
      });
      return pass + "/" + total + " compliant";
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
  function renderTableCellInput(col, cellId, cellAnswer, row, elm) {
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
    if (col.type === "length") {
      const v = cellAnswer.value || {};
      const unit = v.unit || "mm";
      const numInput = el("input", {
        type: "number", step: "any", class: "cell-number small",
        value: v.value ?? "",
        onchange: (e) => setAnswer(cellId, { value: Object.assign({}, v, { value: e.target.value, unit }) }),
      });
      const unitSelect = el("select", {
        class: "length-unit-select",
        onchange: (e) => setAnswer(cellId, { value: Object.assign({}, v, { unit: e.target.value }) }),
      });
      [{ id: "mm", label: "mm" }, { id: "in", label: "in" }].forEach((u) => {
        const o = el("option", { value: u.id }, [u.label]);
        if (unit === u.id) o.selected = true;
        unitSelect.appendChild(o);
      });
      const children = [el("div", { class: "cell-answer-row" }, [numInput, unitSelect])];
      const hint = renderDiameterHint(elm, col, row);
      if (hint) children.push(hint);
      return el("div", {}, children);
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
      const buttons = el(
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
      const hint = renderDiameterHint(elm, col, row);
      return hint ? el("div", {}, [buttons, hint]) : buttons;
    }
    return el("input", { type: "text", class: "cell-text", value: cellAnswer.value || "", onchange: (e) => setAnswer(cellId, { value: e.target.value }) });
  }

  function renderTableElement(elm) {
    const status = tableElementStatus(elm);
    const reqBadgeClass = { required: "req", recommended: "rec", conditional: "cond", exception: "exc", informational: "info" }[elm.requirement] || "info";
    // Same as renderElementCard -- Parts 1-3 are pure capture, no
    // compliance judgment shown there (that's Part 4's job).
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
            el("span", { class: "collapsed-summary" }, [elementSummary(elm, getAnswer(elm.id))]),
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
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [el("th", {}, ["Location"])].concat(
          elm.columns.map((c) => {
            const children = [];
            if (c.diagram && window.DIAGRAMS && window.DIAGRAMS[c.diagram]) {
              children.push(el("div", { class: "col-header-diagram", html: window.DIAGRAMS[c.diagram] }));
            }
            children.push(el("span", { class: "col-header-label" }, [c.label]));
            return el("th", {}, children);
          })
        )),
      ])
    );
    const tbody = el("tbody");
    resolveRows(elm).forEach((row) => {
      const tr = el("tr", { id: "row-" + elm.id + "__" + row.id });
      tr.appendChild(el("td", { class: "row-table-label" }, [row.label]));
      elm.columns.forEach((col) => {
        const cellId = tableCellId(elm, row, col);
        const cellAnswer = getAnswer(cellId);
        const cellStatus = tableCellStatus(col, cellAnswer, row, elm);
        const td = el("td", { class: "state-" + cellStatus });
        td.appendChild(renderTableCellInput(col, cellId, cellAnswer, row, elm));
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
      "253-7-1": "green", "253-7-2": "green",
      "diag-left": "orange", "diag-right": "orange",
      "diag-horizontal": "red", "diag-lower-half": "red", "diag-v-center": "red",
    }[v] || null),
    roof_bars: (v) => ({
      "253-12-1": "green", "253-12-2": "green", "253-14": "green",
      "rb-4": "orange",
      "253-13": "red", "single-center": "red", "single-front-left": "red", "single-front-right": "red", "none": "red",
    }[v] || null),
    backstay_diagonals: (v) => ({
      "253-21-1": "green", "253-21-2": "green", "253-22": "green",
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
      if (v === "253-21-1" || v === "253-21-2") return { files: BACKSTAY_DIAG_FILES, color: CAGE_COLOR.backstayDiag };
      if (v === "253-22") return { files: ["Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl"], color: CAGE_COLOR.backstayDiag };
      return null;
    },
    diagonal_members_gf: () => null,
    diagonals_minimum: () => null,

    // All six configurations now match real geometry in the modeled car --
    // "1 horizontal bar" is physically the same bar/position as the 253-26/27
    // harness bar, so it reuses that same part.
    main_hoop_diagonals: (v) => {
      if (v === "253-7-1" || v === "253-7-2") return { files: MAIN_DIAG_FILES, color: CAGE_COLOR.mainDiag };
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
    rear_lower_x_present: (v) => (v === "253-19-1" || v === "253-19-2" ? { files: ["253-19 left.stl", "253-19 right.stl"], color: CAGE_COLOR.rearLowerX } : null),
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

  // Driver/codriver mannequin meshes -- shared with applyPart3View() below,
  // which needs to tell them apart from cage-structure bars so it can keep
  // showing them for context while still hiding untracked structure.
  const DRIVER_FILES = ["Driver seat.stl", "Driver.stl", "Driver wheel.stl"];
  const CODRIVER_FILES = ["Codriver seat.stl", "Codriver.stl", "Codriver book.stl"];

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
    // "Main diagonal 1/2-253-7.stl" and "Rear diagonal 1/2.stl" are
    // deliberately NOT listed here -- 253-7-1/-2 and 253-21-1/-2 relabel
    // them as continuous/other, so they're resolved dynamically in
    // mainDiagFileTubeRow()/backstayDiagFileTubeRow() instead.
    "Main rollbar lower half left.stl": "main_diagonals_left", "Main rollbar lower half right.stl": "main_diagonals_right",
    "Main rollbar V left.stl": "main_diagonals_left", "Main rollbar V right.stl": "main_diagonals_right",
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
    // "253-19 left/right.stl" are deliberately NOT listed here -- 253-19-1/
    // -2 relabel them as continuous/other, resolved dynamically in
    // rearLowerXFileTubeRow() instead.
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
  // Main rollbar diagonal (253-7), backstay diagonal (253-21), and rear
  // lower X (253-19) each have 2 already-separate, complete mesh files
  // forming their X -- unlike the door/roof bars, nothing here needs a
  // band-split, just knowing which file the "-1"/"-2" design pick made
  // continuous vs. the other (cut) one.
  function continuousMainDiagFile() {
    return getAnswer("main_hoop_diagonals").value === "253-7-2" ? MAIN_DIAG_TOP_LEFT_FILE : MAIN_DIAG_TOP_RIGHT_FILE;
  }
  function mainDiagFileTubeRow(file) {
    const v = getAnswer("main_hoop_diagonals").value;
    if (v === "253-7-1" || v === "253-7-2") return file === continuousMainDiagFile() ? "main_diagonal_continuous" : "main_diagonal_other";
    return file === MAIN_DIAG_TOP_RIGHT_FILE ? "main_diagonals_right" : "main_diagonals_left";
  }
  function continuousBackstayDiagFile() {
    return getAnswer("backstay_diagonals").value === "253-21-2" ? "Rear diagonal 2.stl" : "Rear diagonal 1.stl";
  }
  function otherBackstayDiagFile() {
    return continuousBackstayDiagFile() === "Rear diagonal 1.stl" ? "Rear diagonal 2.stl" : "Rear diagonal 1.stl";
  }
  function backstayDiagFileTubeRow(file) {
    const v = getAnswer("backstay_diagonals").value;
    if (v === "253-21-1" || v === "253-21-2") return file === continuousBackstayDiagFile() ? "backstay_diag_continuous" : "backstay_diag_other";
    return file === "Rear diagonal 1.stl" ? "backstay_diagonals_left" : "backstay_diagonals_right";
  }
  function continuousRearLowerXFile() {
    return getAnswer("rear_lower_x_present").value === "253-19-2" ? "253-19 right.stl" : "253-19 left.stl";
  }
  function otherRearLowerXFile() {
    return continuousRearLowerXFile() === "253-19 left.stl" ? "253-19 right.stl" : "253-19 left.stl";
  }
  function rearLowerXFileTubeRow(file) {
    const v = getAnswer("rear_lower_x_present").value;
    if (v !== "253-19-1" && v !== "253-19-2") return null;
    return file === continuousRearLowerXFile() ? "rear_lower_x_continuous" : "rear_lower_x_other";
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
  // Which of a side's 2 door-bar meshes actually spans the front_top-to-
  // bottom_rear diagonal (vs front_bottom-to-top_rear) is a fixed fact of
  // that mesh's own geometry, verified directly from real vertex
  // positions -- and it's mirrored between sides: "door bar 1" is that
  // diagonal on the left, "door bar 2" is it on the right. This is
  // independent of continuousDoorTubeFile()'s "-1"/"-2" choice (which
  // physical tube got welded continuous), not a restatement of it.
  function doorTubeRunsFrontTopToBottomRear(file, side) {
    const cap = side === "left" ? "Left" : "Right";
    const isBar1 = file === cap + " door bar 1-  253-9.stl";
    return side === "left" ? isBar1 : !isBar1;
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
    if (file === MAIN_DIAG_TOP_RIGHT_FILE || file === MAIN_DIAG_TOP_LEFT_FILE) return mainDiagFileTubeRow(file);
    if (file === "Rear diagonal 1.stl" || file === "Rear diagonal 2.stl") return backstayDiagFileTubeRow(file);
    if (file === "253-19 left.stl" || file === "253-19 right.stl") return rearLowerXFileTubeRow(file);
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
  // v is a "length" column's {value, unit} answer now (mm or in) -- convert
  // to mm before comparing against the fixed 100mm threshold.
  function distanceValueColor(v) {
    if (!v || v.value === "" || v.value === undefined || v.value === null) return null;
    const mm = toMM({ val: v.value, unit: v.unit || "mm" });
    if (mm === null) return null;
    return mm < 100 ? CAGE_COLOR.statusPass : CAGE_COLOR.statusFail;
  }
  // Diagonal 1 (top-right to bottom-left, MAIN_DIAG_TOP_RIGHT_FILE) meets
  // the LEFT foot and the RIGHT backstay; diagonal 2 (top-left to bottom-
  // right, MAIN_DIAG_TOP_LEFT_FILE) meets the RIGHT foot and the LEFT
  // backstay -- see part3RowTargetsForFile's distRowIds for these files,
  // and PILLAR_TUBE_JUNCTION_POINTS for the matching backstay side.
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
  // since they're already simple 1:1 mappings).
  function part3RowTargetsForFile(file) {
    const roofVal = getAnswer("roof_bars").value;
    // Every diagonal's own 2 far ends (at the foot / backstay junction) --
    // verified from real vertex positions: MAIN_DIAG_TOP_RIGHT_FILE spans
    // foot_left to backstay_right, MAIN_DIAG_TOP_LEFT_FILE spans
    // backstay_left to foot_right. Whichever leg ISN'T continuous also
    // gets the 2 crossing points (same positions as its own gusset row)
    // in the middle, low-to-high axis order.
    const mainDiagVal = getAnswer("main_hoop_diagonals").value;
    if (mainDiagVal === "253-7-1" || mainDiagVal === "253-7-2") {
      const continuous = continuousMainDiagFile();
      if (file === MAIN_DIAG_TOP_RIGHT_FILE) {
        // distRowIds is always just the 2 real ends -- main_diagonal_distances
        // has no concept of the cut leg's own crossing point (that's a weld-
        // only joint, not a distance-to-another-bar measurement).
        return file === continuous
          ? { rowIds: ["foot_left", "backstay_right"], weldElementId: "main_diagonal_welds", distElementId: "main_diagonal_distances", distRowIds: ["foot_left", "backstay_right"] }
          : { rowIds: ["foot_left", "top_left", "bottom_right", "backstay_right"], weldElementId: "main_diagonal_welds", distElementId: "main_diagonal_distances", distRowIds: ["foot_left", "backstay_right"] };
      }
      if (file === MAIN_DIAG_TOP_LEFT_FILE) {
        return file === continuous
          ? { rowIds: ["backstay_left", "foot_right"], weldElementId: "main_diagonal_welds", distElementId: "main_diagonal_distances", distRowIds: ["backstay_left", "foot_right"] }
          : { rowIds: ["backstay_left", "top_left", "bottom_right", "foot_right"], weldElementId: "main_diagonal_welds", distElementId: "main_diagonal_distances", distRowIds: ["backstay_left", "foot_right"] };
      }
    }
    // 253-19 left.stl spans top_left<->bottom_right, right.stl spans
    // bottom_left<->top_right (verified from real vertex positions, same
    // corner-naming convention as the door/roof/253-7 X-braced bars).
    // Whichever ISN'T the continuous leg (per the "-1"/"-2" choice) also
    // gets the 2 crossing points in the middle. The junction-distance
    // table (rear_lower_x_distances) wasn't part of this fix and still
    // uses its own older 2-row shape, so distRowIds carries its rows
    // separately from the weld table's now-6-row rowIds.
    const rearLowerXVal = getAnswer("rear_lower_x_present").value;
    if (rearLowerXVal === "253-19-1" || rearLowerXVal === "253-19-2") {
      const leftContinuous = rearLowerXVal === "253-19-1";
      const distRowIds = file === otherRearLowerXFile() ? ["top_left", "bottom_right"] : null;
      if (file === "253-19 left.stl") {
        return {
          rowIds: leftContinuous ? ["top_left", "bottom_right"] : ["top_left", "center_1", "center_2", "bottom_right"],
          weldElementId: "rear_lower_x_detail", distElementId: distRowIds ? "rear_lower_x_distances" : null, distRowIds,
        };
      }
      if (file === "253-19 right.stl") {
        return {
          rowIds: leftContinuous ? ["bottom_left", "center_1", "center_2", "top_right"] : ["bottom_left", "top_right"],
          weldElementId: "rear_lower_x_detail", distElementId: distRowIds ? "rear_lower_x_distances" : null, distRowIds,
        };
      }
    }
    // Rear diagonal 1/2.stl each own a corner-to-corner diagonal of their
    // own -- verified from real vertex positions (dominant axis is Y, left/
    // right): 1 runs top-left to bottom-right, 2 runs bottom-left to
    // top-right. Only whichever one ISN'T the continuous leg (matching
    // roof_bars' own "-1"/"-2" choice, which mirrors both the roof bars
    // and rear diagonals together) also gets the 2 crossing points, in
    // the middle, low-to-high Y order.
    if (roofVal === "253-12-1" || roofVal === "253-12-2") {
      const diag1Continuous = roofVal === "253-12-1";
      if (file === "Rear diagonal 1.stl") {
        return diag1Continuous
          ? { rowIds: ["top_rear_diag_left", "bottom_rear_diag_right"], weldElementId: "rear_diag_4_1_welds", distElementId: "rear_diag_4_1_distances" }
          : { rowIds: ["top_rear_diag_left", "diag_crossing_top", "diag_crossing_bottom", "bottom_rear_diag_right"], weldElementId: "rear_diag_4_1_welds", distElementId: "rear_diag_4_1_distances" };
      }
      if (file === "Rear diagonal 2.stl") {
        return diag1Continuous
          ? { rowIds: ["bottom_rear_diag_left", "diag_crossing_bottom", "diag_crossing_top", "top_rear_diag_right"], weldElementId: "rear_diag_4_1_welds", distElementId: "rear_diag_4_1_distances" }
          : { rowIds: ["bottom_rear_diag_left", "top_rear_diag_right"], weldElementId: "rear_diag_4_1_welds", distElementId: "rear_diag_4_1_distances" };
      }
      // Roof bar 1/2.stl -- verified from real vertex positions (dominant
      // axis is also Y): 1 runs front-left to rear-right, 2 runs rear-left
      // to front-right. Same continuous/cut split as the rear diagonals
      // above (roof_bars' "-1" keeps Roof bar 1 continuous).
      const roof1Continuous = roofVal === "253-12-1";
      if (file === "Roof bar 1.stl") {
        return roof1Continuous
          ? { rowIds: ["front_roof_left", "rear_roof_right"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID }
          : { rowIds: ["front_roof_left", "roof_crossing_front", "roof_crossing_rear", "rear_roof_right"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID };
      }
      if (file === "Roof bar 2.stl") {
        return roof1Continuous
          ? { rowIds: ["rear_roof_left", "roof_crossing_rear", "roof_crossing_front", "front_roof_right"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID }
          : { rowIds: ["rear_roof_left", "front_roof_right"], weldElementId: ROOF_4_1_WELD_ID, distElementId: ROOF_4_1_DIST_ID };
      }
    }
    if (file === "Roof bar 253-14 left.stl") return { rowIds: ["front_roof_left", "center_roof_left"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Roof bar 253-14 right.stl") return { rowIds: ["front_roof_right", "center_roof_right"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Rear diagonal 253-22 left.stl") return { rowIds: ["top_rear_left", "bottom_rear_left"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Rear diagonal 253-22 right.stl") return { rowIds: ["top_rear_right", "bottom_rear_right"], weldElementId: ROOF_4_2_WELD_ID, distElementId: ROOF_4_2_DIST_ID };
    if (file === "Sill bar Left.stl") return { rowIds: ["front_left", "rear_left"], weldElementId: "sill_bar_welds", distElementId: null };
    if (file === "Sill bar Right.stl") return { rowIds: ["front_right", "rear_right"], weldElementId: "sill_bar_welds", distElementId: null };
    // Transverse member: straight bar, Y dominant, verified low-Y=left
    // (matches "Front left lateral.stl" sitting at the low-Y end).
    if (file === "Transverse member.stl") return { rowIds: ["left", "right"], weldElementId: "transverse_member_welds", distElementId: null };
    // Dash bar spans left-to-right (Y dominant, verified) -- its own 2 ends.
    if (file === "Dash bar 253-29.stl") return { rowIds: ["left", "right"], weldElementId: "dash_bar_detail", distElementId: null };
    // 253-17: 2 weld points per tube (front, at the door bar; rear, at the
    // backstay -- X dominant, verified, consistent low-to-high order on
    // all 4 files, no left/right mirroring flip here).
    if (file === "253-17 left upper.stl") return { rowIds: ["upper_left_front", "upper_left_rear"], weldElementId: "rear_lateral_reinforcement_detail", distElementId: null };
    if (file === "253-17 right upper.stl") return { rowIds: ["upper_right_front", "upper_right_rear"], weldElementId: "rear_lateral_reinforcement_detail", distElementId: null };
    if (file === "253-17 left lower.stl") return { rowIds: ["lower_left_front", "lower_left_rear"], weldElementId: "rear_lateral_reinforcement_detail", distElementId: null };
    if (file === "253-17 right lower.stl") return { rowIds: ["lower_right_front", "lower_right_rear"], weldElementId: "rear_lateral_reinforcement_detail", distElementId: null };
    // Harness bar (253-26/27) and 253-18 both span left-to-right as a
    // single mesh (Y dominant, verified) -- fixed left/right ends, not
    // driver/codriver, since those don't move with LHD/RHD.
    if (file === "253-26,27 harness bar.stl") return { rowIds: ["left", "right"], weldElementId: "harness_bar_26_27_welds", distElementId: null };
    if (file === "253-18.stl") return { rowIds: ["left", "right"], weldElementId: "rear_transversal_detail", distElementId: null };
    // 253-31 temple bar: X dominant, low-X end is the top (verified,
    // consistent both sides). Windshield reinforcement: Y dominant, but
    // the two sides are NOT mirror-consistent (verified) -- left's low-Y
    // end is its bottom, right's low-Y end is its top.
    if (file === "253-31 temple bar left.stl") return { rowIds: ["left_top", "left_bottom"], weldElementId: "temple_bar_detail", distElementId: null };
    if (file === "253-31 temple bar right.stl") return { rowIds: ["right_top", "right_bottom"], weldElementId: "temple_bar_detail", distElementId: null };
    if (file === "253-31 windshield left.stl") return { rowIds: ["left_bottom", "left_top"], weldElementId: "windshield_reinforcement_detail", distElementId: null };
    if (file === "253-31 windshield right.stl") return { rowIds: ["right_top", "right_bottom"], weldElementId: "windshield_reinforcement_detail", distElementId: null };
    if (file === "253-15 Left.stl") return { rowIds: ["top_left", "center_top_left", "center_lower_left", "bottom_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 Right.stl") return { rowIds: ["top_right", "center_top_right", "center_lower_right", "bottom_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    // Verified from real vertex positions (Z dominant, consistent both
    // sides): the upper piece's low-Z end is the crossing/center point
    // (where it meets the lower piece), not the topmost corner.
    if (file === "253-15 left upper.stl") return { rowIds: ["center_top_left", "top_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 left lower.stl") return { rowIds: ["bottom_left", "center_lower_left"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 right upper.stl") return { rowIds: ["center_top_right", "top_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    if (file === "253-15 right lower.stl") return { rowIds: ["bottom_right", "center_lower_right"], weldElementId: WINDSHIELD_WELD_ID, distElementId: WINDSHIELD_DIST_ID };
    for (const side of ["left", "right"]) {
      const doorVal = getAnswer("door_bars_" + side).value;
      const elementId = doorWeldElementId(doorVal);
      if (!elementId) continue;
      // Each door-bar file gets just the weld rows for its OWN end(s) --
      // door_9_intersection_welds' rows are named by which corner/junction
      // they're at, not by tube identity, but each row still belongs to
      // exactly one physical tube (or one HALF of the cut tube):
      // - The continuous leg runs corner-to-corner with no crossing joint
      //   of its own, so its 2 rows are just its own 2 far ends.
      // - The cut leg's 2 halves each have their own far corner PLUS their
      //   own gusset point where they weld to the continuous leg at the
      //   crossing -- weldSpec() below band-splits it into 4 using the
      //   mesh's own auto-detected axis, same as every other multi-point
      //   bar.
      if (isDoor9Intersection(doorVal)) {
        // continuousDoorTubeFile()/otherDoorTubeFile() only say WHICH FILE
        // was fabricated as the continuous leg (a real per-car fact, the
        // "-1"/"-2" choice) -- they say nothing about which pair of
        // corners that file's own mesh actually spans. The 2 meshes per
        // side are mirror images of each other, so that's NOT the same
        // physical file on both sides: verified directly from mesh vertex
        // positions, on the left "door bar 1" is the one whose diagonal
        // runs front_top-to-bottom_rear (and "door bar 2" runs
        // front_bottom-to-top_rear); on the right it's the other way
        // around. Rows must follow the file's REAL shape, not an assumed
        // one, or a click on one corner ends up cycling a different row
        // than the one that lights up.
        const runsFrontTopToBottomRear = doorTubeRunsFrontTopToBottomRear(file, side);
        if (file === continuousDoorTubeFile(side)) {
          return runsFrontTopToBottomRear
            ? { rowIds: ["front_top_" + side, "bottom_rear_" + side], weldElementId: elementId, distElementId: null }
            : { rowIds: ["front_bottom_" + side, "top_rear_" + side], weldElementId: elementId, distElementId: null };
        }
        if (file === otherDoorTubeFile(side)) {
          // Order runs low-to-high along the mesh's own AUTO-DETECTED axis
          // (front-to-rear, the same axis weldSpec/bandSplitOrAggregate
          // already picks for every other multi-point bar), not a
          // hardcoded one -- a click's own fraction is computed the same
          // way (see cage_view.js's meshAxisBounds), so this is what
          // guarantees the segment that lights up is always the one that
          // got clicked, on either mesh shape. center_front/center_rear
          // sit in the middle either way since "front"/"rear" is
          // inherently a front-to-rear position.
          return {
            rowIds: runsFrontTopToBottomRear
              ? ["front_top_" + side, "center_front_" + side, "center_rear_" + side, "bottom_rear_" + side]
              : ["front_bottom_" + side, "center_front_" + side, "center_rear_" + side, "top_rear_" + side],
            weldElementId: elementId, distElementId: null,
          };
        }
        continue;
      }
      if (doorVal === "253-9-bent") {
        const cap = side === "left" ? "Left" : "Right";
        if (file === cap + " door bar 1-  253-9.stl") return { rowIds: ["front_top_" + side, "top_rear_" + side], weldElementId: elementId, distElementId: null };
        if (file === cap + " door bar 2-  253-9.stl") return { rowIds: ["front_bottom_" + side, "bottom_rear_" + side], weldElementId: elementId, distElementId: null };
        continue;
      }
      if (doorVal === "253-10") {
        if (file === "Door bar 253-10 upper " + side + ".stl") return { rowIds: ["center_" + side], weldElementId: elementId, distElementId: null };
        if (file === "Door bar 253-10 front " + side + ".stl") return { rowIds: ["front_top_" + side, "front_lower_" + side], weldElementId: elementId, distElementId: null };
        if (file === "Door bar 253-10 rear " + side + ".stl") return { rowIds: ["rear_top_" + side, "rear_lower_" + side], weldElementId: elementId, distElementId: null };
        continue;
      }
      if (doorSideFiles(side, doorVal).indexOf(file) !== -1) return { rowIds: doorWeldRowIds(side, doorVal), weldElementId: elementId, distElementId: null };
    }
    return null;
  }
  // Every design-alternative bar file part3RowTargetsForFile() might need
  // to check, gathered once for applyPart3View() to iterate. Includes
  // files belonging to designs OTHER than the one actually picked too (not
  // just doorSideFiles()'s active-design subset) -- setIfActive() hides
  // whichever of these aren't part of the real, current `colors`, so a
  // phantom bar from an unselected design/side never lingers as a ghost.
  const ALL_DOOR_BAR_VALS = ["253-9-intersection-1", "253-9-intersection-2", "253-9-bent", "253-10", "253-11", "nascar", "single-bar"];
  function part3CandidateFiles() {
    const files = ROOF_BAR_FILES.concat(BACKSTAY_DIAG_FILES, [
      "Roof bar 253-13 left.stl", "Roof bar 253-13 right.stl",
      "Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl",
      "Roof bar single center.stl",
      "Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl",
      MAIN_DIAG_TOP_RIGHT_FILE, MAIN_DIAG_TOP_LEFT_FILE,
      "253-19 left.stl", "253-19 right.stl",
      "Sill bar Left.stl", "Sill bar Right.stl",
      "Transverse member.stl", "Dash bar 253-29.stl",
      "253-17 left upper.stl", "253-17 right upper.stl", "253-17 left lower.stl", "253-17 right lower.stl",
      "253-26,27 harness bar.stl", "253-18.stl",
      "253-31 temple bar left.stl", "253-31 temple bar right.stl",
      "253-31 windshield left.stl", "253-31 windshield right.stl",
    ], APILLAR_FILES, APILLAR_2PIECE_FILES);
    ["left", "right"].forEach((side) => {
      ALL_DOOR_BAR_VALS.forEach((v) => {
        const result = doorBarSideRule(v, {}, side);
        if (result) files.push.apply(files, result.files);
      });
    });
    return files;
  }
  // Matches cage_view.js's own GHOST_COLOR -- used as a band segment's
  // color when that segment has no weld/distance answer yet, since a
  // band-split spec (unlike a flat color) has no separate "ghost" state of
  // its own.
  const PART3_GHOST_HEX = "#555a60";
  // A bar with more than one weld/junction point gets its own color PER
  // POINT instead of one worst-case color for the whole mesh -- cage_view.js
  // divides that mesh's own axis range (getMeshAxisBounds, the SAME
  // geometry its double-click hit-testing already uses) into rowIds.length
  // equal segments, in the same low-to-high order as rowIds, so a click
  // near one end and the color that lights up there always agree. Falls
  // back to one aggregate color if there's only one row, or if the mesh
  // hasn't finished loading yet (getMeshAxisBounds not available) --
  // rather than guessing a split without real geometry to divide.
  function bandSplitOrAggregate(file, rowIds, cellColorFn, aggregateColorFn) {
    if (!rowIds.length) return null;
    if (rowIds.length === 1) return cellColorFn(rowIds[0]);
    const bounds = window.CageView && window.CageView.getMeshAxisBounds ? window.CageView.getMeshAxisBounds(file) : null;
    if (!bounds) return aggregateColorFn();
    return { axis: bounds.axis, min: bounds.min, max: bounds.max, colors: rowIds.map((r) => cellColorFn(r) || PART3_GHOST_HEX) };
  }
  function weldSpec(file, elementId, rowIds) {
    return bandSplitOrAggregate(file, rowIds, (r) => weldCellColor(elementId, r), () => weldRowsColor(elementId, rowIds));
  }
  // Like weldSpec, but for PILLAR_TUBE_POINTS' entries, where a bar's
  // several weld points can come from DIFFERENT tables (a lateral's own
  // base-to-foot weld and its separate top-to-main-rollbar weld) rather
  // than several rows of the same one.
  function pillarTubeSpec(file) {
    const points = PILLAR_TUBE_POINTS[file];
    if (!points) return null;
    return bandSplitOrAggregate(
      file, points,
      (p) => weldCellColor(p.elementId, p.rowId),
      () => aggregateColor(points.map((p) => weldCellColor(p.elementId, p.rowId)))
    );
  }
  // Junctions-mode equivalent of pillarTubeSpec, for PILLAR_TUBE_JUNCTION_POINTS.
  function pillarTubeJunctionSpec(file) {
    const points = PILLAR_TUBE_JUNCTION_POINTS[file];
    if (!points) return null;
    return bandSplitOrAggregate(
      file, points,
      (p) => distanceValueColor(getAnswer(p.elementId + "__" + p.rowId + "__distance").value),
      () => aggregateColor(points.map((p) => distanceValueColor(getAnswer(p.elementId + "__" + p.rowId + "__distance").value)))
    );
  }
  function distanceSpec(file, elementId, rowIds) {
    return bandSplitOrAggregate(
      file, rowIds,
      (r) => distanceValueColor(getAnswer(elementId + "__" + r + "__distance").value),
      () => distanceRowsColor(elementId, rowIds)
    );
  }
  function applyPart3View(colors) {
    const mode = state.activeTab === WELDS_PHASE ? "weld" : state.activeTab === JUNCTIONS_PHASE ? "junction" : null;
    if (mode !== "weld" && mode !== "junction") return colors;
    const view = {};
    // Part 3 only tracks welds/junctions for a specific set of bars (feet,
    // roof, backstays, A-pillar, main diagonal, door bars, rear lower X) --
    // everything else defaults HIDDEN here rather than falling through to
    // the generic ghost-bar treatment, since a structural bar Part 3 has no
    // weld data for isn't "not yet checked", it's just not part of this
    // view. Occupant mannequins are the one exception: they're context, not
    // cage structure, so they keep whatever computeCageColors already gave
    // them (including "hidden" if the driver toggle is off).
    // Use the model's FULL file list, not just Object.keys(colors) -- an
    // optional bar that's simply absent from this car (e.g. 253-25 when
    // anti_intrusion_present isn't "yes") never gets an entry in `colors`
    // at all (the rule just returns null), so limiting this default to
    // colors' own keys let files like that fall through as a phantom
    // ghost instead of hidden.
    const allFiles = window.CageView && window.CageView.getAllFiles ? window.CageView.getAllFiles() : Object.keys(colors);
    allFiles.forEach((file) => {
      view[file] = DRIVER_FILES.indexOf(file) !== -1 || CODRIVER_FILES.indexOf(file) !== -1 ? colors[file] : "hidden";
    });
    // A file entirely absent from `colors` isn't part of THIS car at all --
    // e.g. a roof-bar/backstay-diagonal/windshield/door-bar file belonging
    // to a design alternative other than the one actually picked, or
    // "Main diagonal 2" when only "Main diagonal 1" is the active single-
    // diagonal leg. `colors` (built from each design choice's own current
    // value) is already the authority on what physically exists here, so
    // these get hidden outright rather than left as a phantom ghost bar --
    // "only the bars that exist in the cage should be displayed."
    function setIfActive(file, color) {
      if (colors[file] === undefined) { view[file] = "hidden"; return; }
      if (colors[file] === "hidden") return; // a different mesh variant is the active one right now
      // This file IS part of the car and IS weld/junction-tracked here, so
      // it always overrides the blanket "hidden" default above -- with its
      // real color once answered, or explicitly `undefined` (ghost, "not
      // yet checked") while it isn't, rather than staying hidden.
      view[file] = color || undefined;
    }
    if (mode === "weld") {
      FOOT_LOCATIONS.forEach(({ row, plateFile }) => {
        const color = weldCellColor("mounting_feet_table", row);
        [plateFile, footCubeFile(row), doublePlaneFile(row), rockerBaseFile(row), rockerFoldFile(row)].forEach((f) => setIfActive(f, color));
      });
      // The base-structure pillars themselves, not just their foot plates --
      // "mounting_feet_table" is the plate-to-CHASSIS weld; the pillar's own
      // tube-to-foot weld is a separate joint, tracked by its own
      // "mounting_feet_tube_welds" table (same 6 rows). Laterals and
      // backstays are already separate meshes per side; the main hoop is
      // one continuous mesh for both legs, so it gets the same low-to-high-Y
      // band split as the left/right foot meshes it's verified to align with
      // (low Y = left leg, matching "Foot main rollbar left.stl").
      // A lateral additionally carries its own top-end weld to the main
      // rollbar (lateral_main_hoop_welds) -- pillarTubeSpec band-splits
      // across PILLAR_TUBE_POINTS' entries regardless of which table(s)
      // they come from.
      Object.keys(PILLAR_TUBE_POINTS).forEach((file) => setIfActive(file, pillarTubeSpec(file)));
      // Gussets -- "Gusset dimensions" (Part 3) has its own "weld" column
      // now, keyed by the same row ids GUSSET_LOCATIONS already maps to
      // mesh files for Part 1's design table, so no separate lookup table
      // is needed here.
      GUSSET_LOCATIONS.forEach(({ row, file }) => setIfActive(file, weldCellColor("gusset_dimensions", row)));
      // setIfActive is called for EVERY candidate file, even ones with no
      // weld target (color stays null then) -- it has to run regardless so
      // its own "not part of this car" hiding check always gets a chance,
      // not just for files that happen to have weld data tracked.
      part3CandidateFiles().forEach((file) => {
        const t = part3RowTargetsForFile(file);
        if (!t || !t.weldElementId) { setIfActive(file, null); return; }
        setIfActive(file, weldSpec(file, t.weldElementId, t.rowIds));
      });
    } else {
      // Laterals/backstays -- see PILLAR_TUBE_JUNCTION_POINTS. The main
      // rollbar's own 2 feet (253-7's "lower end" junction) light up from
      // main_diagonal_distances directly; the other 4 feet have no
      // junction-distance concept of their own yet, so they stay hidden
      // rather than showing a phantom ghost.
      Object.keys(PILLAR_TUBE_JUNCTION_POINTS).forEach((file) => setIfActive(file, pillarTubeJunctionSpec(file)));
      FOOT_LOCATIONS.forEach(({ row, plateFile }) => {
        // Front/backstay feet have no junction-distance concept of their
        // own yet -- "hidden" (not null/ghost) so they don't linger as a
        // phantom "not yet checked" ghost with nothing to actually check.
        const color = row === "main_hoop_left" ? distanceValueColor(getAnswer("main_diagonal_distances__foot_left__distance").value)
          : row === "main_hoop_right" ? distanceValueColor(getAnswer("main_diagonal_distances__foot_right__distance").value)
          : "hidden";
        // Same "whichever design's mesh is actually active" fan-out as the
        // weld branch above -- a multiplane_box/double_plane/rocker foot's
        // real mesh isn't the flat plateFile at all, and setIfActive's own
        // "colors[file] === hidden" check already filters down to just the
        // one that's actually active for this foot's chosen design.
        [plateFile, footCubeFile(row), doublePlaneFile(row), rockerBaseFile(row), rockerFoldFile(row)].forEach((f) => setIfActive(f, color));
      });
      part3CandidateFiles().forEach((file) => {
        const t = part3RowTargetsForFile(file);
        setIfActive(file, t && t.distElementId ? distanceSpec(file, t.distElementId, t.distRowIds || t.rowIds) : null);
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
    if (state.activeTab === WELDS_PHASE || state.activeTab === JUNCTIONS_PHASE) return applyPart3View(colors);
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

  // Same idea as jumpToTubeRow, for Part 3's weld/junction-distance tables
  // -- a single click while already on Part 3 flashes the specific row(s)
  // that bar owns and stays put, instead of falling through to
  // jumpToSection's Part-1 switch. This matters even in weld VIEW: since
  // cage_view.js's own double-click detection is 2 single clicks within a
  // window (see pickPart's isDouble check), every double-click's first tap
  // fires this handler too -- without it, that first click used to jump
  // straight back to Part 1 before the second tap could ever land.
  // Returns true if it handled the click (so the caller skips its own
  // fallback), false if this file has no Part 3 row to jump to.
  // The base-structure pillar tubes -- see resolvePart3WeldTarget, which
  // shares this same map so a double-click/hover and a single-click jump
  // can never disagree about a pillar's own weld point(s).
  const PILLAR_TUBE_POINTS = {
    "Front left lateral.stl": [
      { elementId: "mounting_feet_tube_welds", rowId: "front_left" },
      { elementId: "lateral_main_hoop_welds", rowId: "lateral_left" },
    ],
    "Front right lateral.stl": [
      { elementId: "mounting_feet_tube_welds", rowId: "front_right" },
      { elementId: "lateral_main_hoop_welds", rowId: "lateral_right" },
    ],
    // Verified from real vertex positions: low-X end is near the main
    // rollbar (top junction), high-X end is near the backstay's own foot
    // (bottom) -- order must run low-to-high X to match.
    "Left backstay.stl": [
      { elementId: "backstay_main_hoop_welds", rowId: "backstay_left" },
      { elementId: "mounting_feet_tube_welds", rowId: "backstay_left" },
    ],
    "Right backstay.stl": [
      { elementId: "backstay_main_hoop_welds", rowId: "backstay_right" },
      { elementId: "mounting_feet_tube_welds", rowId: "backstay_right" },
    ],
    "Main rollbar.stl": [
      { elementId: "mounting_feet_tube_welds", rowId: "main_hoop_left" },
      { elementId: "mounting_feet_tube_welds", rowId: "main_hoop_right" },
    ],
  };
  // Junctions-mode equivalent of PILLAR_TUBE_POINTS above -- a bar's weld
  // points and its junction-DISTANCE points aren't necessarily the same
  // locations or count (e.g. the backstay has one weld point at each end,
  // but 2 distance checks both near its own top: one to the lateral it
  // runs alongside, one to 253-7's own upper end), so this is tracked
  // separately rather than reusing PILLAR_TUBE_POINTS. Both backstay
  // entries' 2 points sit in the same general (upper) area of the tube
  // rather than at its 2 opposite ends, unlike every other band-split bar
  // in this app -- there's no real top-vs-bottom split to verify from
  // geometry here, so the band-split still divides the mesh in two (same
  // mechanism as everywhere else) but the order between these 2 is a
  // judgment call, not a verified axis position.
  const PILLAR_TUBE_JUNCTION_POINTS = {
    "Front left lateral.stl": [{ elementId: "backstay_distance_upper_laterals", rowId: "left" }],
    "Front right lateral.stl": [{ elementId: "backstay_distance_upper_laterals", rowId: "right" }],
    // MAIN_DIAG_TOP_LEFT_FILE (backstay_left/foot_right) meets the LEFT
    // backstay; MAIN_DIAG_TOP_RIGHT_FILE (foot_left/backstay_right) meets
    // the RIGHT one (see mainDiagonalJunctionColor's own comment, same
    // cross-over).
    "Left backstay.stl": [
      { elementId: "backstay_distance_upper_laterals", rowId: "left" },
      { elementId: "main_diagonal_distances", rowId: "backstay_left" },
    ],
    "Right backstay.stl": [
      { elementId: "backstay_distance_upper_laterals", rowId: "right" },
      { elementId: "main_diagonal_distances", rowId: "backstay_right" },
    ],
  };
  // Expands every card involved BEFORE looking up its rows -- a card whose
  // element already has a definitive answer (every row set) auto-collapses
  // (see jumpToSection's own comment), which removes its row-* DOM nodes
  // entirely. Without this, a single click on a bar whose weld was already
  // answered silently found nothing to scroll to: it still returned true
  // (so the Part-1 fallback never ran), but nothing visibly happened.
  function expandThenFindRows(elementIds, lookups) {
    let changed = false;
    elementIds.forEach((id) => { if (!state.expandedIds[id]) { state.expandedIds[id] = true; changed = true; } });
    if (changed) render();
    let first = null;
    lookups.forEach((id) => {
      const rowEl = document.getElementById(id);
      if (!rowEl) return;
      if (!first) first = rowEl;
      flashRow(rowEl);
    });
    if (first) scrollBelowViewer(first, { center: true });
    return !!first;
  }
  // Returns true only when a row was actually found and jumped to -- e.g.
  // the transverse member is colored (and clickable) in the 3D model as
  // soon as its base structure implies it exists, but its OWN weld table
  // stays hidden until its separate Part 1 presence question is answered.
  // Returning false in that case lets the caller fall through to the
  // normal Part-1 jump instead of the click silently doing nothing.
  function jumpToWeldRow(file) {
    // Junctions: its own lookups first -- mounting feet, PILLAR_TUBE_POINTS,
    // and gussets have no junction-distance concept (feet/gussets aren't
    // measured against another bar; PILLAR_TUBE_JUNCTION_POINTS covers
    // laterals/backstays instead), so falling into the weld-mode branches
    // below with the wrong table would always find nothing and (before this
    // fix) silently fall through to the Part-1 jump.
    if (state.activeTab === JUNCTIONS_PHASE) {
      const junctionPoints = PILLAR_TUBE_JUNCTION_POINTS[file];
      if (junctionPoints) {
        return expandThenFindRows(junctionPoints.map((p) => p.elementId), junctionPoints.map((p) => "row-" + p.elementId + "__" + p.rowId));
      }
      const footRow = footRowForFile(file);
      const mainHoopFootRow = footRow === "main_hoop_left" ? "foot_left" : footRow === "main_hoop_right" ? "foot_right" : null;
      if (mainHoopFootRow) {
        return expandThenFindRows(["main_diagonal_distances"], ["row-main_diagonal_distances__" + mainHoopFootRow]);
      }
      const target = part3RowTargetsForFile(file);
      if (!target || !target.distElementId) return false;
      const rowIds = target.distRowIds || target.rowIds;
      return expandThenFindRows([target.distElementId], rowIds.map((rowId) => "row-" + target.distElementId + "__" + rowId));
    }
    const footRow = footRowForFile(file);
    if (footRow) {
      return expandThenFindRows(["mounting_feet_table"], ["row-mounting_feet_table__" + footRow]);
    }
    if (PILLAR_TUBE_POINTS[file]) {
      const points = PILLAR_TUBE_POINTS[file];
      return expandThenFindRows(points.map((p) => p.elementId), points.map((p) => "row-" + p.elementId + "__" + p.rowId));
    }
    const gussetRow = gussetRowForFile(file);
    if (gussetRow) {
      return expandThenFindRows(["gusset_dimensions"], ["row-gusset_dimensions__" + gussetRow]);
    }
    const target = part3RowTargetsForFile(file);
    if (!target || !target.weldElementId) return false;
    return expandThenFindRows([target.weldElementId], target.rowIds.map((rowId) => "row-" + target.weldElementId + "__" + rowId));
  }

  // Wired to CageView.onPartClick() -- lets clicking a bar in the live 3D
  // model act as the index into the checklist, instead of a separate table
  // of contents. While on Part 2, this stays on Part 2 and jumps within its
  // own tube classification table (or, for a mounting foot, its plate-size
  // row) rather than switching to Part 1. Same idea on Part 3 -- see
  // jumpToWeldRow.
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
    main_hoop_diagonals: "253-7-1",
    backstay_diagonals: "253-21-1",
    roof_bars: "253-12-1",
    door_bars_left: "253-9-intersection-1",
    door_bars_right: "253-9-intersection-1",
    a_pillar_reinforcement: "continuous",
    rear_lower_x_present: "253-19-1",
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

  // Picks which of a bar's several weld-point groups a click at this
  // position along the bar (0-1, from cage_view.js's axisFraction) meant --
  // groups are assumed to run in the same order as they appear along the
  // bar, low fraction to high. Each entry is itself a list of row ids
  // (currently always just one -- every bar's rows are independently
  // clickable). Falls back to the first/only group when there's nothing to
  // disambiguate (single click, or a foot with one weld).
  function nearestRowGroupByFraction(rowGroups, frac) {
    if (!rowGroups.length) return [];
    if (rowGroups.length === 1 || frac == null) return rowGroups[0];
    const idx = Math.min(rowGroups.length - 1, Math.max(0, Math.floor(frac * rowGroups.length)));
    return rowGroups[idx];
  }
  // "front_top_right" -> "Right front top"; a row id with no left/right
  // suffix (the 253-19 rows) is just spaced out and capitalized. Only a
  // fallback for when rowLabelFor() can't find a real table row (there
  // shouldn't normally be one) -- see its own comment.
  function humanizeRowLabel(rowId) {
    const m = rowId.match(/^(.+)_(left|right)$/);
    const words = (m ? m[1] : rowId).split("_").join(" ");
    if (!m) return words.charAt(0).toUpperCase() + words.slice(1);
    return (m[2] === "left" ? "Left " : "Right ") + words;
  }
  // The canonical row label, straight from the checklist table itself
  // (elementId's rows(), the exact same array the Part 1/2/3 table
  // renders from) -- so a hover tooltip or double-click's row name is
  // ALWAYS identical to what the table shows for that same row, never an
  // independently-worded approximation that can drift out of sync with it.
  function rowLabelFor(elementId, rowId) {
    const path = RULES[state.vehicle.org] && RULES[state.vehicle.org].paths[state.pathId];
    const elm = path && path.elements.find((e) => e.id === elementId);
    const row = elm && resolveRows(elm) && resolveRows(elm).find((r) => r.id === rowId);
    return row ? row.label : humanizeRowLabel(rowId);
  }
  // What a click at (file, frac) targets in Part 3's Weld view -- shared by
  // the double-click handler (which cycles the answer) and the hover
  // tooltip (which only names it), so a click and the tooltip shown just
  // before it can never disagree about which weld point is meant.
  // keySuffix is "__weld" (Welds view, boolean cells) or "__distance"
  // (Junctions view, length cells) -- everything else about resolving a
  // click/hover position to a row (or 2, for a shared multi-table pillar
  // tube) is identical between the 2 views, just pointed at different
  // tables/columns.
  function resolvePart3WeldTarget(file, frac) {
    if (state.activeTab === JUNCTIONS_PHASE) {
      const junctionPoints = PILLAR_TUBE_JUNCTION_POINTS[file];
      if (junctionPoints) {
        const group = nearestRowGroupByFraction(junctionPoints.map((p) => [p]), frac);
        return { label: group.map((p) => rowLabelFor(p.elementId, p.rowId)).join(" / "), keys: group.map((p) => p.elementId + "__" + p.rowId + "__distance") };
      }
      const footRow = footRowForFile(file);
      const mainHoopFootRow = footRow === "main_hoop_left" ? "foot_left" : footRow === "main_hoop_right" ? "foot_right" : null;
      if (mainHoopFootRow) {
        return { label: rowLabelFor("main_diagonal_distances", mainHoopFootRow), keys: ["main_diagonal_distances__" + mainHoopFootRow + "__distance"] };
      }
      const target = part3RowTargetsForFile(file);
      if (target && target.distElementId) {
        const rowIds = target.distRowIds || target.rowIds;
        const group = nearestRowGroupByFraction(rowIds.map((r) => [r]), frac);
        return { label: group.map((r) => rowLabelFor(target.distElementId, r)).join(" / "), keys: group.map((r) => target.distElementId + "__" + r + "__distance") };
      }
      return null;
    }
    const weldFootRow = footRowForFile(file);
    if (weldFootRow) {
      return { label: rowLabelFor("mounting_feet_table", weldFootRow), keys: ["mounting_feet_table__" + weldFootRow + "__weld"] };
    }
    // The pillar TUBES themselves -- a separate tube-to-foot weld from the
    // foot plate's own plate-to-chassis weld above (see
    // mounting_feet_tube_welds). A lateral has a SECOND weld point of its
    // own too: its top end, where it welds to the main rollbar (253-3) --
    // a different joint from its own base-to-foot weld, tracked by
    // lateral_main_hoop_welds. Laterals/backstays are one mesh per pillar;
    // the main hoop is one mesh for both legs, so a click picks whichever
    // point it landed nearest, same as any other multi-point bar.
    if (PILLAR_TUBE_POINTS[file]) {
      const points = PILLAR_TUBE_POINTS[file];
      const group = nearestRowGroupByFraction(points.map((p) => [p]), frac);
      return { label: group.map((p) => rowLabelFor(p.elementId, p.rowId)).join(" / "), keys: group.map((p) => p.elementId + "__" + p.rowId + "__weld") };
    }
    // Gussets: same "Gusset dimensions" table (Part 3) whose rows already
    // mirror GUSSET_LOCATIONS 1:1, one mesh per row, so no band-split/
    // nearest-fraction logic is needed here -- just its own "weld" cell.
    const gussetRow = gussetRowForFile(file);
    if (gussetRow) {
      return { label: rowLabelFor("gusset_dimensions", gussetRow), keys: ["gusset_dimensions__" + gussetRow + "__weld"] };
    }
    // Every other weld-tracked bar: part3RowTargetsForFile already lists
    // that file's own weld points (2 for most crossing-cut bars, more for
    // windshield/roof/253-9's cut leg) -- pick whichever one the click
    // landed nearest, not the whole bar in lockstep. Each row is its own
    // independently colored segment, so it's its own independently
    // clickable zone too.
    const target = part3RowTargetsForFile(file);
    if (target && target.weldElementId && target.rowIds.length) {
      const group = nearestRowGroupByFraction(target.rowIds.map((r) => [r]), frac);
      return { label: group.map((r) => rowLabelFor(target.weldElementId, r)).join(" / "), keys: group.map((r) => target.weldElementId + "__" + r + "__weld") };
    }
    return null;
  }
  function handleCagePartDoubleClick(file, frac) {
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
    // Welds part: double-click cycles that bar's own weld-completion
    // answer (yes -> no -> not-yet-checked) instead of anything else a
    // double-click would normally do -- scoped to the same bars
    // applyPart3View() knows how to color (see its own comment for why).
    // What exactly gets cycled is resolved by resolvePart3WeldTarget(),
    // shared with the hover tooltip below so the two can never disagree.
    if (state.activeTab === WELDS_PHASE) {
      const target = resolvePart3WeldTarget(file, frac);
      if (target) {
        const cycle = ["yes", "no", ""];
        const idx = cycle.indexOf(getAnswer(target.keys[0]).value);
        const next = cycle[(idx + 1) % cycle.length];
        target.keys.forEach((key) => setAnswer(key, { value: next }));
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
    if ((state.activeTab === WELDS_PHASE || state.activeTab === JUNCTIONS_PHASE) && jumpToWeldRow(file)) return;
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

  // The View switch lives in the STICKY 3D viewer panel (outside #app, so
  // render() never rebuilds it) rather than inside any one part's own
  // checklist -- that panel stays pinned while the checklist scrolls, so
  // it's reachable no matter how far down a long table the user has
  // scrolled. It doubles as quick navigation to the 4 parts the 3D model
  // has something to show for -- Design/Tube size jump straight to Part
  // 1/2; Welds/Junctions jump to their own parts (Installation constraints,
  // Seats/belts/routing, and Logbook have no 3D-relevant view of their own,
  // so they're not among these 4 options).
  function syncPart3Controls() {
    const el3 = document.getElementById("cageViewerPart3Controls");
    // "Hide ghost bars" has nothing left to do on Welds/Junctions -- every
    // bar NOT part of this car's actual configuration is already hidden
    // outright (see applyPart3View/setIfActive), so a ghost there always
    // means "part of the cage, just not yet checked," which is exactly the
    // information these parts exist to show. Hiding it away would just
    // hide work still to do, so the toggle (and the forced showGhostBars
    // below) don't apply here.
    const onWeldOrJunction = state.activeTab === WELDS_PHASE || state.activeTab === JUNCTIONS_PHASE;
    const ghostBtn = document.getElementById("cageViewerGhostToggle");
    if (ghostBtn) ghostBtn.style.display = onWeldOrJunction ? "none" : "";
    if (!el3) return;
    el3.innerHTML = "";
    const goToView = (tab) => { state.activeTab = tab; render(); };
    el3.appendChild(
      el("div", { class: "radio-group" }, [
        el("strong", { class: "cage-view-switch-label" }, ["View"]),
        radioOption("cageViewSwitch", "design", "Design", state.activeTab === 1, () => goToView(1)),
        radioOption("cageViewSwitch", "tubing", "Tube size", state.activeTab === 2, () => goToView(2)),
        radioOption("cageViewSwitch", "welds", "Welds", state.activeTab === WELDS_PHASE, () => goToView(WELDS_PHASE)),
        radioOption("cageViewSwitch", "junctions", "Junctions", state.activeTab === JUNCTIONS_PHASE, () => goToView(JUNCTIONS_PHASE)),
      ])
    );
  }
  // Names whichever weld point a double-click at this position would
  // target, so the several points on one bar can be told apart before
  // clicking -- reuses resolvePart3WeldTarget(), the exact same resolution
  // the click itself uses, so the tooltip is never wrong about what a
  // click would do.
  function handleCagePartHover(file, frac, clientX, clientY) {
    const tooltip = document.getElementById("cageViewerTooltip");
    if (!tooltip) return;
    const target = file && (state.activeTab === WELDS_PHASE || state.activeTab === JUNCTIONS_PHASE) ? resolvePart3WeldTarget(file, frac) : null;
    if (!target) { tooltip.hidden = true; return; }
    const container = document.getElementById("cageViewerContainer");
    const rect = container.getBoundingClientRect();
    tooltip.textContent = target.label;
    tooltip.style.left = (clientX - rect.left) + "px";
    tooltip.style.top = (clientY - rect.top) + "px";
    tooltip.hidden = false;
  }
  // Top-level Part switcher -- lives above the 3D model in the sticky
  // viewer panel (outside #app, so it survives render()'s teardown)
  // instead of inside the scrolling checklist, so it's reachable no matter
  // how far down the page the user has scrolled. A dropdown rather than
  // the radio-group the View switch below uses -- this list can grow (it's
  // already 7 entries) where View is a fixed, small set.
  function syncPartDropdown() {
    const holder = document.getElementById("cageViewerPartDropdown");
    if (!holder) return;
    holder.innerHTML = "";
    if (!state.pathId || !RULES[state.vehicle.org] || !RULES[state.vehicle.org].paths[state.pathId]) return;
    const path = RULES[state.vehicle.org].paths[state.pathId];
    const { usedPhases } = computeUsedPhases(path);
    if (usedPhases.length <= 1) return;
    const select = el("select", {
      class: "part-switch-select",
      onchange: (e) => { state.activeTab = Number(e.target.value); render(); },
    });
    usedPhases.forEach((p) => {
      const opt = el("option", { value: String(p) }, [PHASE_LABELS[p]]);
      if (state.activeTab === p) opt.selected = true;
      select.appendChild(opt);
    });
    holder.appendChild(select);
  }
  function syncCageView() {
    syncPartDropdown();
    syncPart3Controls();
    if (window.CageView) {
      const colors = computeCageColors();
      window.CageView.applyState(colors, (state.activeTab === WELDS_PHASE || state.activeTab === JUNCTIONS_PHASE) ? true : state.showGhostBars);
      window.CageView.onPartClick(handleCagePartClick);
      window.CageView.onPartDoubleClick(handleCagePartDoubleClick);
      window.CageView.onPartHover(handleCagePartHover);
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
    // Safety score always trails the checklist regardless of which part is
    // shown; Logbook (verdict for the selected sanctioning body, merged
    // with its paperwork fields) is its own part now -- only shown while
    // that part is the one selected, same as every other part's content.
    renderSafetyScore(root, path);
    if (state.activeTab === LOGBOOK_PHASE) renderResults(root, path);
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
