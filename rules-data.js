// Rollcage compliance rules data.
// Loaded as a plain <script> (not fetch) so the app works from a plain
// file:// double-click with no local server required.
//
// Architecture: the "New Construction" path for every sanctioning body
// (NASA, ARA, CARS/CRC) follows the structure and field-for-field layout of
// the user's own "Logbook Inspection Report" reference document (FIA
// 2020/2025 Appendix J Article 253, (c) Emmanuel Cecchet / Frog Racing),
// which itself organizes the shared FIA 253 Chapter 8 base document into 13
// sections covering every tube, weld, gusset, mounting foot, seat mount,
// and belt anchor -- sanctioning-body-agnostic. FIA_253_DOCUMENT_BASE below
// defines that structure ONCE (sections 1-6, where org rules vary in
// tubing/mounting/padding specifics), FIA_253_COMMON_TAIL defines the
// remainder (sections 7-13, which the source document does not vary by
// org), and each org is expressed as a small set of patches on top of the
// base (per patchElements/insertElements below) rather than three
// separately maintained copies. Grandfathered paths are NOT derived from
// this base -- they're each org's own distinct, already-working
// presence/absence checklist for existing logbooks, out of scope for this
// document (which is new-construction only), and stay fully org-specific
// further down in this file (untouched by this section).
//
// Sources actually read for this data:
//  - NASA Rally Sport GRR Section 3 (v16.0), sections 3.7 and 3.8
//  - NASA Rally Sport GRR Appendix B (grandfathering requirements, current
//    text + the 2014 attachment it includes for reference)
//  - American Rally Association Rally Technical Rules, 2026 Edition
//    (through Bulletin 2026-8), section 2.2.2 (Roll Over Protection) and
//    2.2.3 (Protective Padding)
//  - 2020 FIA Appendix J Article 253 Chapter 8 (WMSC 09.10.2020) -- NRS GRR
//    3.7.2, ARA RTR 2.2.2(c)(2), and CARS NRR 12.3.2.3 all require new
//    construction to comply with this document directly
//  - "Logbook Inspection Report" (Emmanuel Cecchet / Frog Racing, 2026),
//    the structural template for sections 1-13 below, including the exact
//    dimensional figures quoted in sections 7-13 (installation
//    constraints, seat mounts, belts, routing, towing eye, tube bending)
//
// Diagrams referenced by `diagram` keys are original schematic icons drawn
// for this app (see diagrams.js) -- not extracted from the source PDFs,
// which both explicitly prohibit reproduction of their content.

(function () {
  "use strict";

  // ---- Tubing requirement tables (org-specific; FIA's base document
  // leaves acceptable materials/sizing to each ASN/sanctioning body) ----
  // Each entry is a material a 3-field tubing control (material + diameter
  // + thickness, see app.js's renderTubing3Fields/tubing3Status) will
  // accept, with one or more (diameter, thickness) floors -- some material
  // specs allow either of two combos (e.g. NASA's CDS/DOM: 1.75x0.095 OR
  // 2.00x0.083). A `manualOnly: true` entry (e.g. T45, most common on
  // FIA-homologated cages) is listed for identification but has no combos
  // here we're confident enough in to auto-pass/fail -- it's always left
  // for the inspector to judge manually via notes, same as "Other". An
  // "Other" material is also always offered by the renderer on top of
  // whatever's listed here, for anything bigger or smaller than the
  // expected set -- entering numbers under "Other" still gets checked
  // numerically if it can be matched to a listed material, but is
  // otherwise left for the inspector to judge manually via notes, not
  // auto-failed.

  // NASA -- per NRS GRR 3.7.3 acceptable-materials table.
  const TUBING_REF = "NRS GRR 3.7.3 acceptable-materials table";
  const NASA_PRIMARY_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.75, minThicknessIn: 0.095 }, { minDiameterIn: 2.0, minThicknessIn: 0.083 }] },
    { material: "docol_r8", label: "Docol R8 (CHS)", combos: [{ minDiameterIn: 1.75, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  const NASA_SECONDARY_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.095 }, { minDiameterIn: 1.6, minThicknessIn: 0.083 }] },
    { material: "docol_r8", label: "Docol R8 (CHS)", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];

  // ARA -- per ARA RTR 2.2.2(c)(2)(c)/(d). Unlike NASA, ARA's Docol R8
  // allowance has an extra middle tier for diagonal/reinforcement members
  // (253-7, additional door bars, 253-12/13/14, 253-15) distinct from both
  // the primary-element spec and the generic "all other parts" spec.
  const ARA_REF = "ARA RTR 2.2.2(c)(2)(c)/(d)";
  const ARA_PRIMARY_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.75, minThicknessIn: 0.095 }, { minDiameterIn: 2.0, minThicknessIn: 0.083 }] },
    { material: "docol_r8", label: "Docol R8", combos: [{ minDiameterIn: 1.75, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  const ARA_SECONDARY_STD_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.095 }, { minDiameterIn: 1.6, minThicknessIn: 0.083 }] },
    { material: "docol_r8", label: "Docol R8 (\"all other parts\" spec)", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.065 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  const ARA_SECONDARY_REINF_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.095 }, { minDiameterIn: 1.6, minThicknessIn: 0.083 }] },
    { material: "docol_r8", label: "Docol R8 (diagonal/reinforcement spec)", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  // Used by ARA's grandfathered path only (untouched further down).
  const ARA_ADDON_TUBING = [
    { id: "1.5x0.095_min", label: "1.5\" x 0.095\" (minimum stated for added elements)", outcome: "pass" },
    { id: "smaller_or_unknown", label: "Smaller than minimum, or material/size not confirmed", outcome: "fail" },
  ];

  // CARS/CRC -- per CARS NRR 12.3.2.4 (CDS is the FIA-253 base spec; DOM is
  // CARS's stated alternate -- unlike ARA/NASA, the CARS text sourced here
  // does not mention a Docol R8 alternate, so none is offered).
  const CARS_REF = "CARS NRR 12.3.2.4";
  const CARS_PRIMARY_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.75, minThicknessIn: 0.095 }, { minDiameterIn: 2.0, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  const CARS_SECONDARY_REQ = [
    { material: "cds_dom", label: "DOM", combos: [{ minDiameterIn: 1.5, minThicknessIn: 0.095 }, { minDiameterIn: 1.6, minThicknessIn: 0.083 }] },
    { material: "t45", label: "T45", manualOnly: true },
  ];
  // 2000-2008 grandfathered era table (Appendix 29.1.13), used by CARS's
  // grandfathered path only (untouched further down, kept in its original
  // single-dropdown shape since that path isn't part of this rebuild).
  const CARS_GF_PRIMARY_TUBING = [
    { id: "1.75x0.095_or_1.98x0.08", label: "1.75\" x 0.095\" or 1.98\" x 0.08\" CDS/DOM (FIA-sanctioned event spec)", outcome: "pass" },
    { id: "flat_1.75x0.12", label: "1.75\" x 0.12\" CDS/DOM used throughout the cage (non-FIA-sanctioned event flat spec)", outcome: "pass" },
    { id: "smaller_or_unknown", label: "Smaller than minimum, or material/size not confirmed", outcome: "fail" },
  ];
  const CARS_GF_SECONDARY_TUBING = [
    { id: "1.5x0.095_or_1.58x0.08", label: "1.5\" x 0.095\" or 1.58\" x 0.08\" CDS/DOM (FIA-sanctioned event spec)", outcome: "pass" },
    { id: "flat_1.75x0.12", label: "1.75\" x 0.12\" CDS/DOM used throughout the cage (non-FIA-sanctioned event flat spec)", outcome: "pass" },
    { id: "smaller_or_unknown", label: "Smaller than minimum, or material/size not confirmed", outcome: "fail" },
  ];

  // ---- Shared column sets for table elements ---------------------------
  const WELD_COLUMNS = [{ key: "weld", label: "Complete weld", type: "boolean" }];
  const WELD_WITH_DIST_COLUMNS = [
    { key: "distance", label: "Distance from junction (<100mm/3.94in)", type: "number", compare: { op: "lt", value: 100 } },
    { key: "weld", label: "Complete weld", type: "boolean" },
  ];
  function gussetColumns(reqBundle) {
    return [
      { key: "tube", label: "Tube (material/diameter/thickness)", type: "tubing3", requirements: reqBundle },
      { key: "thickness", label: "Gusset thickness (mm, >=1)", type: "number", compare: { op: "gte", value: 1 } },
      { key: "length", label: "Length E (2D<E<4D)", type: "text" },
      { key: "corner_cutout", label: "Corner cutout (R<1.5D)", type: "boolean" },
      { key: "hole", label: "Hole diameter (<D)", type: "boolean" },
    ];
  }
  // ---- Merge helpers -------------------------------------------------
  // Applies a per-org patch object to the shared FIA base element list.
  // A patch may set/override any plain field, patch individual options by
  // id (optionOverrides), append new options (addOptions), patch table
  // columns by key (columnOverrides), or fully replace the tubing
  // sub-fields (tubing is always org-specific, never shared).
  function patchElements(base, patches) {
    return base.map((el) => {
      const p = patches[el.id];
      if (!p) return el;
      const out = Object.assign({}, el, p);
      if (p.optionOverrides) {
        out.options = el.options.map((o) => (p.optionOverrides[o.id] ? Object.assign({}, o, p.optionOverrides[o.id]) : o));
        delete out.optionOverrides;
      }
      if (p.addOptions) {
        out.options = out.options.concat(p.addOptions);
        delete out.addOptions;
      }
      if (p.columnOverrides) {
        out.columns = el.columns.map((c) => (p.columnOverrides[c.key] ? Object.assign({}, c, p.columnOverrides[c.key]) : c));
        delete out.columnOverrides;
      }
      return out;
    });
  }

  // Inserts org-specific elements that have no FIA-base counterpart right
  // after a named base element, preserving the base's category grouping.
  function insertElements(list, insertions) {
    const out = list.slice();
    insertions.forEach(({ after, element }) => {
      const idx = out.findIndex((e) => e.id === after);
      out.splice(idx + 1, 0, element);
    });
    return out;
  }

  // =====================================================================
  // Section 1. Vehicle description -- pure identification fields, not
  // scored (requirement: "informational" -> elementStatus returns
  // "neutral" immediately).
  // =====================================================================
  const SECTION_1_VEHICLE = [
    {
      id: "vehicle_description_notes",
      name: "Notes",
      category: "Logbook",
      requirement: "informational",
      reference: "",
      description: "",
      placeholder: "Notes for this vehicle (e.g. anything unusual about the identification info above)...",
      evaluationType: "longtext",
      visuallyVerifiable: false,
      hardFail: false,
    },
  ];

  // =====================================================================
  // Section 2. Base structure
  // =====================================================================

  // -- Cage Design --
  const SECTION_2_1_ANGLES = [
    {
      id: "main_structure_layout",
      name: "Base structure layout",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "One of three base structures: 253-1 (main rollbar + front rollbar + 2 longitudinal members + 2 backstays + 6 mounting feet), 253-2 (two full lateral rollbars + 2 transverse members + 2 backstays + 6 feet), or 253-3 (main rollbar + 2 lateral half rollbars + 1 transverse member + 2 backstays + 6 feet -- most common).",
      evaluationType: "choice",
      noCapture: true,
      options: [
        { id: "253-1", label: "253-1: Main rollbar + front rollbar", diagram: "253-1", outcome: "pass" },
        { id: "253-2", label: "253-2: Two lateral rollbars", diagram: "253-2", outcome: "pass" },
        { id: "253-3", label: "253-3: Main rollbar + two lateral half rollbars", diagram: "253-3", outcome: "pass" },
        { id: "none", label: "Other design", outcome: "fail" },
      ],
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No recognized base structure layout present.",
    },
    {
      id: "main_hoop_lean_angle",
      name: "Main hoop leaning angle",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "The design of the main rollbar has to be as straight as possible but it can lean up to 10 degrees of the vertical in any direction.",
      diagram: "lean-angle",
      evaluationType: "numeric",
      unit: "degrees",
      compare: { op: "lte", value: 10 },
      visuallyVerifiable: false,
      hardFail: true,
      hardFailMessage: "Main hoop leans more than 10 degrees from vertical.",
    },
    {
      id: "main_hoop_bend_count",
      name: "Number of bends in the vertical part of the main rollbar",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "The near-vertical part of the main rollbar (or the rear pillar of the lateral rollbar) must be as close as possible to the inner side panels of the bodyshell and must have no more than one bend.",
      evaluationType: "numeric",
      unit: "bends (max 1)",
      compare: { op: "lte", value: 1 },
      diagram: "main-hoop-bend",
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "More than one bend in the vertical part of the main rollbar.",
    },
    {
      id: "main_hoop_single_plane",
      name: "Main rollbar tube axis within one single plane",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "",
      evaluationType: "boolean",
      strictYesNo: true,
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "bend_radius_compliance",
      name: "Compliance of bend radius and stretch",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "See section 13. Tube bending cheat sheet",
      description: "Cage tubing can only be bent using a cold process. The diameter of the thinner part of the bend must be at least 90% of the tubing size, and the bend radius must be at least 3x the tube diameter.",
      evaluationType: "boolean",
      strictYesNo: true,
      visuallyVerifiable: false,
      diagram: "bend-radius",
      hardFail: true,
    },
    {
      id: "front_rollbar_angle",
      name: "Front rollbar angle",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "The lower part of the front pillar must be near-vertical, with no bends below where it ceases to follow the windscreen pillar, and a maximum angle of 10 degrees to the vertical towards the rear.",
      evaluationType: "numeric",
      fields: [
        { key: "bend_count", label: "Number of bends below where it ceases to follow the windscreen pillar", unit: "bends", compare: { op: "lte", value: 0 } },
        { key: "angle", label: "Angle", unit: "degrees rearward", compare: { op: "between", min: 0, max: 10 } },
      ],
      diagram: "front-rollbar-bend",
      visuallyVerifiable: false,
      hardFail: true,
    },
    {
      id: "front_feet_forward_of_rollbar",
      name: "Front mounting feet forward of foremost rollbar",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "At the front mounting foot, the tube must not be rearward of the foremost point of the rollbar (excluding anti-intrusion bars).",
      evaluationType: "boolean",
      strictYesNo: true,
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "backstay_distance_upper_laterals",
      name: "Rear backstays distance from upper laterals",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "Rear backstays must attach less than 100mm from the upper laterals.",
      evaluationType: "numeric",
      unit: "mm",
      compare: { op: "lt", value: 100 },
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "main_rollbar_present",
      name: "Main rollbar present",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "",
      // 253-1/253-2/253-3 all include a main rollbar by definition, so
      // picking one of those pre-selects "yes" here automatically (see the
      // main_structure_layout choice handler) -- still shown and editable
      // in case that's ever not actually true.
      evaluationType: "boolean",
      strictYesNo: true,
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No main rollbar present.",
    },
    {
      id: "main_hoop_diagonals",
      name: "Main rollbar diagonal configuration",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.1(a)",
      description: "New rally construction requires two diagonal members on the main rollbar in an X per Drawing 253-7 (members must be straight; removable joints allowed). Other configurations are captured here for identification -- e.g. a single diagonal may be permitted for road racing, and older configurations may be eligible for grandfathering.",
      // Only relevant when there's actually a main rollbar to put a
      // diagonal on: either the base structure was identified as one of
      // 253-1/253-2/253-3 (which always include one), or -- for an
      // unidentified/other structure -- "Main rollbar present" was
      // answered yes.
      showIf: { any: [
        { id: "main_rollbar_present", equals: "yes" },
        { id: "main_structure_layout", in: ["253-1", "253-2", "253-3"] },
      ] },
      evaluationType: "choice",
      options: [
        { id: "253-7", label: "253-7: Two diagonals (X)", diagram: "253-7", outcome: "pass" },
        { id: "diag-left", label: "1 diagonal, top on left side", diagram: "diag-left", note: "A single diagonal does not satisfy FIA 253-7 for new rally construction. May be permitted for road racing, or eligible for grandfathering -- confirm with the applicable sanctioning body.", outcome: "fail" },
        { id: "diag-right", label: "1 diagonal, top on right side", diagram: "diag-right", note: "A single diagonal does not satisfy FIA 253-7 for new rally construction. May be permitted for road racing, or eligible for grandfathering -- confirm with the applicable sanctioning body.", outcome: "fail" },
        { id: "diag-horizontal", label: "1 horizontal bar", diagram: "diag-horizontal", note: "An older configuration -- does not satisfy FIA 253-7 for new rally construction. Flag for grandfathering review.", outcome: "fail" },
        { id: "diag-lower-half", label: "2 lower half bars", diagram: "diag-lower-half", note: "An older configuration -- does not satisfy FIA 253-7 for new rally construction. Flag for grandfathering review.", outcome: "fail" },
        { id: "diag-v-center", label: "V bar in the center", diagram: "diag-v-center", note: "An older configuration -- does not satisfy FIA 253-7 for new rally construction. Flag for grandfathering review.", outcome: "fail" },
      ],
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "253-7 X-diagonal missing on the main rollbar.",
    },
    {
      id: "lateral_rollbars_other",
      name: "Lateral rollbars",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "",
      showIf: { id: "main_structure_layout", equals: "none" },
      evaluationType: "choice",
      options: [
        { id: "253-1", label: "253-1 style: laterals stop at the top of the windshield (no windshield transverse bar at the top)", outcome: "pass" },
        { id: "253-3", label: "253-3 style: laterals go all the way to the main rollbar", outcome: "pass" },
        { id: "none", label: "None (half rollcage)", outcome: "fail" },
      ],
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No lateral rollbars present.",
    },
    {
      id: "transverse_member_253_3",
      name: "Transverse member",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "Same transverse member as a 253-3 structure.",
      showIf: { id: "lateral_rollbars_other", equals: "253-3" },
      evaluationType: "boolean",
      strictYesNo: true,
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No transverse member present.",
    },
    {
      id: "transverse_members_253_1",
      name: "Transverse members",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "",
      showIf: { id: "lateral_rollbars_other", equals: "253-1" },
      evaluationType: "choice",
      options: [
        { id: "3-bars", label: "3 bars (the 2 transverses of 253-1 + the transverse of 253-3)", outcome: "pass" },
        { id: "halo", label: "Halo loop (same 3 bars for the 3D model, but implemented as a single long bar)", outcome: "pass" },
      ],
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No transverse members present.",
    },
    {
      id: "backstays",
      name: "Backstays present",
      category: "Base structure layout",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "Two backstays attached at roof level near the top outer bends of the main/lateral rollbar, running rearward, straight, and as close as possible to the inner side panels.",
      // 253-1/253-2/253-3 all include 2 backstays by definition, so picking
      // one of those pre-selects "yes" here automatically (see the
      // main_structure_layout choice handler) -- still shown and editable.
      evaluationType: "boolean",
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "Backstays missing.",
    },
    {
      id: "backstay_diagonals",
      name: "Backstay diagonal design",
      category: "Base structure layout",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.1(b) and 8.3.2.2.1",
      description: "253-20 is the compulsory baseline. 253-21 (X-config) pairs with a 253-12 roof bar; 253-22 pairs with a 253-14 roof bar.",
      evaluationType: "choice",
      options: [
        { id: "253-20", label: "253-20: Single diagonal, top left", diagram: "253-20", outcome: "pass" },
        { id: "253-20-right", label: "253-20: Single diagonal, top right", diagram: "253-20-right", outcome: "pass" },
        { id: "253-21", label: "253-21: X-configuration", diagram: "253-21", outcome: "pass" },
        { id: "253-22", label: "253-22: V (mandatory with roof bar 253-14)", diagram: "253-22", outcome: "pass" },
        { id: "none", label: "None present", outcome: "fail" },
      ],
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No backstay diagonal present, or 253-14/253-22 pairing rule violated.",
    },
    {
      id: "backstay_angle",
      name: "Backstay angle",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "At least 30 degrees from vertical.",
      evaluationType: "numeric",
      unit: "degrees from vertical",
      compare: { op: "gte", value: 30 },
      diagram: "backstay-angle",
      visuallyVerifiable: false,
      hardFail: true,
      hardFailMessage: "Backstay angle from vertical is under 30 degrees.",
    },
    {
      id: "cage_within_suspension_points",
      name: "Cage within suspension mounting points",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "",
      description: "",
      evaluationType: "boolean",
      strictYesNo: true,
      visuallyVerifiable: true,
      diagram: "suspension-containment",
      hardFail: true,
    },
    {
      id: "a_pillar_dimension_a",
      name: "Dimension A (front rollbar pillar length)",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.4",
      description: "Requires 253-15 windscreen pillar reinforcement if dimension A exceeds 200mm (which is the case for essentially all cars) -- mandatory regardless of dimension A for an ARA logbook.",
      evaluationType: "numeric",
      unit: "mm",
      compare: { op: "gte", value: 0 },
      visuallyVerifiable: false,
      hardFail: false,
    },
  ];

  // -- 2.2. Mounting feet --
  const MOUNTING_FEET_ROWS = [
    { id: "front_left", label: "Front left (min 120cm²/18.6in²)" },
    { id: "front_right", label: "Front right (min 120cm²/18.6in²)" },
    { id: "main_hoop_left", label: "Main hoop left (min 120cm²/18.6in²)" },
    { id: "main_hoop_right", label: "Main hoop right (min 120cm²/18.6in²)" },
    { id: "backstay_left", label: "Backstay left (min 60cm²/9.3in²)" },
    { id: "backstay_right", label: "Backstay right (min 60cm²/9.3in²)" },
  ];
  const SECTION_2_2_FEET = [
    {
      id: "mounting_feet_table",
      name: "Mounting feet welds",
      category: "2.2. Mounting feet",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.6",
      description: "Minimum one mounting point per front-rollbar pillar, per lateral/half-lateral-rollbar pillar, per main-rollbar pillar, and per backstay (six total for the common 253-3 layout). Location is given from the driver's perspective (left is driver side in a LHD car). Design, bolted/welded, and plate size are captured in Part 1/Part 2.",
      evaluationType: "table",
      rows: MOUNTING_FEET_ROWS,
      columns: [
        { key: "welds", label: "Welds complete", type: "boolean" },
      ],
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "Fewer than the minimum mounting points, or feet not adequately reinforced.",
    },
  ];

  // -- 2.3. Tubing --
  // Door bar rows for the Tube classification table below vary by which
  // 253-9/10/11 design is currently selected -- each design is fabricated
  // from a different number/shape of tube pieces per side, and each piece
  // needs its own material/diameter/thickness verified independently (e.g.
  // 253-9's "2 bend bars" is 2 whole tubes per side, but "1 continuous + 2
  // half bars" is 3 pieces per side -- a continuous tube plus two half
  // tubes welded to it at the intersection). ids are prefixed per design so
  // switching designs never lets a stale answer from a different design's
  // tube silently carry over onto a same-named row.
  function doorBarTubeRowsForSide(doorVal, side) {
    const cap = side === "left" ? "Left" : "Right";
    if (doorVal === "253-9-bent") {
      return [
        { id: "d9bent_" + side + "_upper", label: "253-9: Door bar -- " + cap + " upper (bend bar)" },
        { id: "d9bent_" + side + "_lower", label: "253-9: Door bar -- " + cap + " lower (bend bar)" },
      ];
    }
    if (isDoor9Intersection(doorVal)) {
      return [
        { id: "d9x_" + side + "_continuous", label: "253-9: Door bar -- " + cap + " continuous bar" },
        { id: "d9x_" + side + "_upper_half", label: "253-9: Door bar -- " + cap + " upper half bar" },
        { id: "d9x_" + side + "_lower_half", label: "253-9: Door bar -- " + cap + " lower half bar" },
      ];
    }
    if (doorVal === "253-10") {
      return [
        { id: "d10_" + side + "_upper", label: "253-10: Door bar -- " + cap + " upper (top rail)" },
        { id: "d10_" + side + "_front", label: "253-10: Door bar -- " + cap + " front (V leg)" },
        { id: "d10_" + side + "_rear", label: "253-10: Door bar -- " + cap + " rear (V leg)" },
      ];
    }
    if (doorVal === "253-11") {
      return [{ id: "d11_" + side, label: "253-11: Door bar -- " + cap }];
    }
    if (doorVal === "nascar") {
      // Reuses 253-10's top rail (1 tube per side) plus 2 new vertical bars
      // per side -- sill bar is tracked separately (its own row below), as
      // it is for every other design.
      return [
        { id: "nascar_" + side + "_upper", label: "Door bar -- " + cap + " upper (top rail)" },
        { id: "nascar_" + side + "_vertical1", label: "Door bar -- " + cap + " vertical 1" },
        { id: "nascar_" + side + "_vertical2", label: "Door bar -- " + cap + " vertical 2" },
      ];
    }
    if (doorVal === "single-bar") {
      return [{ id: "singlebar_" + side, label: "Door bar -- " + cap }];
    }
    return []; // "none" or unanswered -- nothing to classify yet
  }

  // Roof bar rows vary the same way, but 253-12 is ONE shared X spanning the
  // whole roof (its two diagonal legs each run corner-to-corner, not two
  // independent per-side X's the way doors have) -- so there are only 2
  // physical tube pieces total, fabricated the same "1 continuous + 2 half
  // bars" way as 253-9: 1 continuous leg + the other leg cut into front/rear
  // half-tubes at the crossing point. 253-13/253-14 and the single-bar
  // designs keep the existing left/right/center split -- no fabrication
  // ambiguity has been raised for those.
  function roofBarTubeRows(roofVal) {
    if (roofVal === "253-12") {
      return [
        { id: "r12_continuous", label: "253-12: Roof bar -- Continuous bar" },
        { id: "r12_front_half", label: "253-12: Roof bar -- Front half bar" },
        { id: "r12_rear_half", label: "253-12: Roof bar -- Rear half bar" },
      ];
    }
    if (roofVal === "253-13" || roofVal === "253-14") {
      return [
        { id: "roof_bars_left", label: roofVal + ": Roof bar -- Left" },
        { id: "roof_bars_right", label: roofVal + ": Roof bar -- Right" },
      ];
    }
    if (roofVal === "single-center") {
      return [{ id: "roof_bars_center", label: "Roof bar -- Center" }];
    }
    if (roofVal === "single-front-left") {
      return [{ id: "roof_bars_left", label: "Roof bar -- Left" }];
    }
    if (roofVal === "single-front-right") {
      return [{ id: "roof_bars_right", label: "Roof bar -- Right" }];
    }
    return []; // "none" or unanswered -- nothing to classify yet
  }

  // Front mounting feet only exist where there's actual front structure to
  // plant them on -- a true half rollcage (main_structure_layout "none" and
  // lateral_rollbars_other explicitly "none") has nothing in front of the
  // main rollbar at all, so it's 4 feet instead of the usual 6. Any
  // identified structure (253-1/2/3) or an "Other design" that DID pick a
  // lateral rollbar answer still gets the front pair.
  function mountingFeetDesignRows(getAnswer) {
    const rows = [];
    if (getAnswer("lateral_rollbars_other").value !== "none") {
      rows.push({ id: "front_left", label: "Front left" }, { id: "front_right", label: "Front right" });
    }
    rows.push(
      { id: "main_hoop_left", label: "Main hoop left" },
      { id: "main_hoop_right", label: "Main hoop right" },
      { id: "backstay_left", label: "Backstay left" },
      { id: "backstay_right", label: "Backstay right" }
    );
    return rows;
  }
  const MOUNTING_FOOT_DESIGN_OPTIONS = [
    { id: "single_plane", label: "253-50/51/52: Single plane plate" },
    { id: "double_plane", label: "253-53: Double plane plate" },
    { id: "multiplane_box", label: "253-54: Multiplane box" },
    { id: "multiplane_rocker", label: "253-55/56: Multiplane rocker plate" },
    { id: "flat_curved", label: "253-57: Flat or curved plate" },
  ];

  const GUSSET_DESIGN_OPTIONS = [
    { id: "", label: "None" },
    { id: "taco", label: "Taco" },
    { id: "single_plate", label: "Single plate" },
  ];

  // Gusset junctions -- only the ones that actually exist given what was
  // picked upstream (e.g. no door-bar gussets on a car with no door bars).
  // main_hoop_diagonals has no "none" option -- every choice there is some
  // form of diagonal meeting the hoop, so it's gated on an answer existing
  // at all rather than a specific non-empty value like the others.
  function gussetJunctionRows(getAnswer) {
    const rows = [];
    // 253-7's X-crossing has 4 possible gusset positions (left/right/
    // upper/lower) -- most cars only gusset one opposite pair, but some use
    // all 4, so all 4 are offered as independent rows rather than assuming
    // which pair applies.
    if (getAnswer("main_hoop_diagonals").value) {
      rows.push(
        { id: "main_hoop_diag_left", label: "253-7: Main rollbar diagonal - left" },
        { id: "main_hoop_diag_right", label: "253-7: Main rollbar diagonal - right" },
        { id: "main_hoop_diag_upper", label: "253-7: Main rollbar diagonal - upper" },
        { id: "main_hoop_diag_lower", label: "253-7: Main rollbar diagonal - lower" }
      );
    }
    // Only the 253-21 X-configuration backstay diagonal needs its own
    // gusset (at the diagonal brace's own crossing/junction, not the
    // backstay tubes themselves) -- the 253-20 (single diagonal) and
    // 253-22 (V) designs don't. Same 4-position pattern as 253-7.
    if (getAnswer("backstay_diagonals").value === "253-21") {
      rows.push(
        { id: "backstay_diag_left", label: "253-21: Backstay diagonal - left" },
        { id: "backstay_diag_right", label: "253-21: Backstay diagonal - right" },
        { id: "backstay_diag_upper", label: "253-21: Backstay diagonal - upper" },
        { id: "backstay_diag_lower", label: "253-21: Backstay diagonal - lower" }
      );
    }
    // Same 4-position pattern as 253-7, just left/right/front/rear instead
    // of left/right/upper/lower. Only the 253-12 roof bar design needs this
    // gusset -- 253-14, 253-13, and the single-bar variants don't.
    if (getAnswer("roof_bars").value === "253-12") {
      rows.push(
        { id: "roof_left", label: "253-12: Roof bar junction - left" },
        { id: "roof_right", label: "253-12: Roof bar junction - right" },
        { id: "roof_front", label: "253-12: Roof bar junction - front" },
        { id: "roof_rear", label: "253-12: Roof bar junction - rear" }
      );
    }
    // Only the 253-9 (X-bar) designs need this gusset -- 253-10, 253-11,
    // NASCAR, and the single-bar variant don't. Left and right are gated
    // independently since the design can now differ side to side.
    function isDoor9(v) { return v === "253-9-intersection-1" || v === "253-9-intersection-2" || v === "253-9-bent"; }
    // Front and rear door-bar junctions are gusseted separately (2 per
    // side) -- even for a 253-9 "2 bend bars" design, which might really
    // only need one combined gusset in practice; captured as 2 separate
    // rows for now regardless, since that design-specific exception needs
    // its own rule to be worked out later.
    if (isDoor9(getAnswer("door_bars_left").value)) {
      rows.push(
        { id: "door_front_left", label: "253-9: Door bar junction - front left" },
        { id: "door_rear_left", label: "253-9: Door bar junction - rear left" }
      );
    }
    if (isDoor9(getAnswer("door_bars_right").value)) {
      rows.push(
        { id: "door_front_right", label: "253-9: Door bar junction - front right" },
        { id: "door_rear_right", label: "253-9: Door bar junction - rear right" }
      );
    }
    // Lateral-to-A-pillar gusset -- where the front lateral joins the top of
    // the A-pillar (253-15) bar, one per side. This is a lateral/A-pillar
    // junction gusset, not a property of 253-15 itself. Always a single
    // plate.
    const aPillarValue = getAnswer("a_pillar_reinforcement").value;
    if (aPillarValue) {
      rows.push(
        { id: "a_pillar_left", label: "Lateral to A-pillar gusset - left", restrictOptionIds: ["single_plate"] },
        { id: "a_pillar_right", label: "Lateral to A-pillar gusset - right", restrictOptionIds: ["single_plate"] }
      );
    }
    // The 2 side gussets only apply to the single-continuous-bar build of
    // 253-15 -- the 2-bar build (where it's split to meet the door bar) gets
    // its own 4-gusset-per-side set instead (below). Always a taco.
    if (aPillarValue === "continuous") {
      rows.push(
        { id: "a_pillar_side_left", label: "253-15: Windshield pillar reinforcement side gusset - left", restrictOptionIds: ["taco"] },
        { id: "a_pillar_side_right", label: "253-15: Windshield pillar reinforcement side gusset - right", restrictOptionIds: ["taco"] }
      );
    }
    // 2-bar build of 253-15 -- 4 gussets per side (upper/lower x front/rear)
    // at the junctions where the split bar meets the door bar. Always a taco.
    if (aPillarValue === "two_bars") {
      rows.push(
        { id: "a_pillar_2pc_left_upper_front", label: "253-15: Windshield pillar reinforcement 2-piece gusset - left upper front", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_left_upper_rear", label: "253-15: Windshield pillar reinforcement 2-piece gusset - left upper rear", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_left_lower_front", label: "253-15: Windshield pillar reinforcement 2-piece gusset - left lower front", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_left_lower_rear", label: "253-15: Windshield pillar reinforcement 2-piece gusset - left lower rear", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_right_upper_front", label: "253-15: Windshield pillar reinforcement 2-piece gusset - right upper front", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_right_upper_rear", label: "253-15: Windshield pillar reinforcement 2-piece gusset - right upper rear", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_right_lower_front", label: "253-15: Windshield pillar reinforcement 2-piece gusset - right lower front", restrictOptionIds: ["taco"] },
        { id: "a_pillar_2pc_right_lower_rear", label: "253-15: Windshield pillar reinforcement 2-piece gusset - right lower rear", restrictOptionIds: ["taco"] }
      );
    }
    if (getAnswer("windshield_reinforcement_present").value === "yes") {
      rows.push({ id: "windshield_left", label: "Windshield bar junction - left" }, { id: "windshield_right", label: "Windshield bar junction - right" });
    }
    if (getAnswer("rear_lower_x_present").value === "yes") {
      rows.push({ id: "rear_lower_x_left", label: "253-19: Rear lower X junction - left" }, { id: "rear_lower_x_right", label: "253-19: Rear lower X junction - right" });
    }
    return rows;
  }

  const SECTION_2_3_TUBING = [
    {
      id: "primary_tubing",
      name: "Primary tubing",
      category: "Tubing",
      requirement: "required",
      reference: TUBING_REF,
      description: "Material / diameter / thickness used for the main structure -- main rollbar, laterals, transverse member(s), backstays, and main rollbar diagonals (253-7). Usually 1.75\".",
      evaluationType: "tubing3solo",
      requirements: NASA_PRIMARY_REQ,
      visuallyVerifiable: false,
      hardFail: true,
      hideNotes: true,
      hideVisualFlag: true,
    },
    {
      id: "secondary_tubing",
      name: "Secondary tubing",
      category: "Tubing",
      requirement: "required",
      reference: TUBING_REF,
      description: "Material / diameter / thickness used for the optional/secondary bars -- roof bars, door bars, sill bar, A-pillar reinforcement, harness bar, rear reinforcements, dash bar. Usually 1.50\".",
      evaluationType: "tubing3solo",
      requirements: NASA_SECONDARY_REQ,
      visuallyVerifiable: false,
      hardFail: true,
      hideNotes: true,
      hideVisualFlag: true,
    },
    {
      id: "tubing_bar_classification",
      name: "Tube specifications",
      category: "Tubing",
      requirement: "required",
      reference: "",
      description: "For each bar visible in the 3D model, indicate whether it uses the primary or secondary tubing spec above. Left/right are listed separately so both bars get checked, not just one per pair. Door bar rows also split into each individual tube or half-tube piece for whichever design is currently selected.",
      evaluationType: "table",
      // A function instead of a plain array: the door-bar rows depend on
      // which 253-9/10/11 design is currently selected (see
      // doorBarTubeRows() above) -- app.js's resolveRows() calls this with
      // its own getAnswer whenever it needs the current row list.
      rows: (getAnswer) => [
        { id: "main_rollbar", label: "Main rollbar" },
        { id: "front_laterals_left", label: "Front / lateral rollbar -- Left" },
        { id: "front_laterals_right", label: "Front / lateral rollbar -- Right" },
        { id: "transverse_member", label: "Transverse member(s)" },
        { id: "backstays_left", label: "Backstay -- Left" },
        { id: "backstays_right", label: "Backstay -- Right" },
        { id: "backstay_diagonals_left", label: "Backstay diagonal -- Left" },
        { id: "backstay_diagonals_right", label: "Backstay diagonal -- Right" },
        { id: "main_diagonals_left", label: "253-7: Main rollbar diagonal -- Left" },
        { id: "main_diagonals_right", label: "253-7: Main rollbar diagonal -- Right" },
        ...roofBarTubeRows(getAnswer("roof_bars").value),
        ...doorBarTubeRowsForSide(getAnswer("door_bars_left").value, "left"),
        ...doorBarTubeRowsForSide(getAnswer("door_bars_right").value, "right"),
        { id: "sill_bar_left", label: "Sill bar -- Left" },
        { id: "sill_bar_right", label: "Sill bar -- Right" },
        { id: "a_pillar_left", label: "253-15: A-pillar reinforcement -- Left" },
        { id: "a_pillar_right", label: "253-15: A-pillar reinforcement -- Right" },
        { id: "harness_bar", label: "Harness bar" },
        { id: "rear_lateral_left", label: "253-17: Rear lateral reinforcement -- Left" },
        { id: "rear_lateral_right", label: "253-17: Rear lateral reinforcement -- Right" },
        { id: "rear_transversal", label: "253-18: Rear transversal reinforcement" },
        { id: "rear_lower_x_driver_top", label: "253-19: Rear lower X -- Driver top to codriver bottom" },
        { id: "rear_lower_x_codriver_top", label: "253-19: Rear lower X -- Codriver top to driver bottom" },
        { id: "anti_intrusion_left_upper", label: "253-25: Anti-intrusion -- Left upper" },
        { id: "anti_intrusion_left_lower", label: "253-25: Anti-intrusion -- Left lower" },
        { id: "anti_intrusion_right_upper", label: "253-25: Anti-intrusion -- Right upper" },
        { id: "anti_intrusion_right_lower", label: "253-25: Anti-intrusion -- Right lower" },
        { id: "dash_bar", label: "253-29: Dash bar" },
        { id: "temple_bar_left", label: "253-31: Temple bar -- Left" },
        { id: "temple_bar_right", label: "253-31: Temple bar -- Right" },
        { id: "windshield_reinforcement_left", label: "253-31: Windshield reinforcement -- Left" },
        { id: "windshield_reinforcement_right", label: "253-31: Windshield reinforcement -- Right" },
      ],
      columns: [
        { key: "spec", label: "Tubing spec", type: "radio", options: [{ id: "primary", label: "Primary" }, { id: "secondary", label: "Secondary" }] },
      ],
      visuallyVerifiable: false,
      hardFail: false,
    },
  ];

  // -- Mounting feet (sizing) -- design/bolted-or-welded live in Part 1
  // (mounting_feet_design); this is just the physical measurements, same
  // capture-only spirit as the rest of Part 2.
  const SECTION_2_4_MOUNTING_FEET = [
    {
      id: "mounting_feet_material",
      name: "Mounting feet material and thickness",
      category: "Mounting feet",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.6",
      description: "Assumes all mounting feet use the same plate material and thickness. FIA minimum thickness is 3mm/0.118\".",
      evaluationType: "plateSolo",
      visuallyVerifiable: false,
      hardFail: true,
    },
    {
      id: "mounting_feet_size",
      name: "Mounting plate size",
      category: "Mounting feet",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.6",
      description: "Minimum 120cm²/18.6in² per front or main-hoop foot, 60cm²/9.3in² per backstay foot.",
      evaluationType: "table",
      rows: (getAnswer) => mountingFeetDesignRows(getAnswer),
      columns: [{ key: "size", label: "Plate size", type: "area" }],
      visuallyVerifiable: false,
      hardFail: true,
    },
  ];

  const SECTION_2_BASE_STRUCTURE = [].concat(SECTION_2_1_ANGLES, SECTION_2_2_FEET, SECTION_2_3_TUBING, SECTION_2_4_MOUNTING_FEET, [
    {
      id: "main_structure_construction",
      name: "Main structure construction quality",
      category: "Cage Design",
      hideNotes: true,
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.1",
      description: "Rollbars formed in one piece without joints, smooth and even (no ripples/cracks), cold-bent.",
      evaluationType: "boolean",
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "cage_design_notes",
      name: "Notes",
      category: "Cage Design",
      requirement: "informational",
      reference: "",
      description: "",
      placeholder: "Notes for this section (e.g. anything unusual about the base structure, angles, or measurements above)...",
      evaluationType: "longtext",
      visuallyVerifiable: false,
      hardFail: false,
    },
  ]);

  // =====================================================================
  // Section 3. Main rollbar diagonals (253-7)
  // =====================================================================
  const SECTION_3_MAIN_DIAGONALS = [
    {
      id: "main_diagonal_distances",
      name: "Main rollbar diagonal (253-7) junction distances",
      category: "Cage Design",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.1(a)",
      description: "Lower ends must join the main rollbar within 100mm of the mounting feet; upper ends must be within 100mm of the backstay junctions.",
      evaluationType: "numeric",
      fields: [
        { key: "dist_left_foot", label: "Distance to left foot", unit: "mm", compare: { op: "lt", value: 100 } },
        { key: "dist_right_foot", label: "Distance to right foot", unit: "mm", compare: { op: "lt", value: 100 } },
        { key: "dist_left_backstay", label: "Distance to left backstay", unit: "mm", compare: { op: "lt", value: 100 } },
        { key: "dist_right_backstay", label: "Distance to right backstay", unit: "mm", compare: { op: "lt", value: 100 } },
      ],
      hideNotes: true,
      hidePhotos: true,
      visuallyVerifiable: false,
      hardFail: true,
      hardFailMessage: "253-7 diagonal end(s) more than 100mm from the mounting foot or backstay junction.",
    },
    {
      id: "main_diagonal_gussets",
      name: "Main rollbar diagonal gussets",
      category: "Cage Design",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.5",
      description: "D = outer diameter of the biggest tube joined.",
      evaluationType: "table",
      rows: [{ id: "top_left", label: "Top or Left" }, { id: "bottom_right", label: "Bottom or Right" }],
      columns: gussetColumns(NASA_SECONDARY_REQ),
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "main_diagonal_notes",
      name: "Notes",
      category: "Cage Design",
      requirement: "informational",
      reference: "",
      description: "",
      placeholder: "Notes for this section (e.g. anything unusual about the 253-7 diagonals, distances, tubing, or gussets above)...",
      evaluationType: "longtext",
      sectionPhotos: true,
      visuallyVerifiable: false,
      hardFail: false,
    },
  ];

  // =====================================================================
  // Section 4. Roof bars and rear diagonals
  // =====================================================================
  const ROOF_BAR_DESIGN_CHOICE = {
    id: "roof_bars",
    name: "Roof bar design",
    category: "Other structural elements",
    requirement: "required",
    reference: "2020 FIA 253 Ch.8.3.2.1.3",
    description: "Constructions with a 253-13 design (no front roof corner support) should be strongly discouraged -- known to be deficient. Pick 253-12 or 253-14.",
    // Doesn't apply to a half rollcage with no lateral rollbars to tie the
    // roof bars into.
    showIf: { id: "lateral_rollbars_other", notEquals: "none" },
    evaluationType: "choice",
    options: [
      { id: "253-12", label: "253-12", diagram: "253-12", outcome: "pass" },
      { id: "253-14", label: "253-14", diagram: "253-14", outcome: "pass" },
      { id: "253-13", label: "253-13", diagram: "253-13", note: "No front roof corner support -- known to be deficient and does not satisfy FIA 253 for new construction. Captured for identification; legality/safety to be assessed separately.", outcome: "fail" },
      { id: "single-center", label: "Single bar center", diagram: "roof-single-center", note: "A single center roof bar does not satisfy FIA 253-12/253-14 for new construction. Captured for identification; legality/safety to be assessed separately.", outcome: "fail" },
      { id: "single-front-left", label: "Single bar front left", diagram: "roof-single-front-left", note: "A single roof bar to one front corner does not satisfy FIA 253-12/253-14 for new construction. Captured for identification; legality/safety to be assessed separately.", outcome: "fail" },
      { id: "single-front-right", label: "Single bar front right", diagram: "roof-single-front-right", note: "A single roof bar to one front corner does not satisfy FIA 253-12/253-14 for new construction. Captured for identification; legality/safety to be assessed separately.", outcome: "fail" },
      { id: "none", label: "None present", outcome: "fail" },
    ],
    tubing: null,
    visuallyVerifiable: true,
    hardFail: true,
    hardFailMessage: "No roof reinforcement present.",
  };
  const ROOF_4_1_WELD_ROWS = [
    { id: "front_roof_left", label: "1. Front roof left" }, { id: "rear_roof_left", label: "2. Rear roof left" },
    { id: "top_rear_diag_left", label: "3. Top rear diagonal left" }, { id: "bottom_rear_diag_left", label: "4. Bottom rear diagonal left" },
    { id: "front_roof_right", label: "5. Front roof right" }, { id: "rear_roof_right", label: "6. Rear roof right" },
    { id: "top_rear_diag_right", label: "7. Top rear diagonal right" }, { id: "bottom_rear_diag_right", label: "8. Bottom rear diagonal right" },
  ];
  const SECTION_4_1 = [
    Object.assign({}, ROOF_BAR_DESIGN_CHOICE),
    // Optional corner-brace gussets, independent of which roof bar design is
    // picked above -- historically used on cars with no roof bars or a
    // single diagonal roof bar in place of full triangulation, gusseted in
    // the corner(s) opposite the bar. Always offered (not gated on roof_bars)
    // since a corner could in principle be gusseted alongside a full
    // 253-12/253-14 design too. Some grandfathering rules require the
    // opposite-corner gusset for a single-diagonal-bar roof to be accepted,
    // which would make this pass/fail under that specific rule -- captured
    // here for identification only for now, since evaluating that requires
    // knowing which grandfathered logbook rule is actually in effect (not
    // modeled per-org yet).
    {
      id: "roof_corner_gussets",
      name: "Roof corner gussets",
      category: "Other structural elements",
      requirement: "recommended",
      reference: "",
      description: "Optional corner-brace gussets, historically used on cars with no roof bars or a single diagonal roof bar in place of full triangulation. Some grandfathering rules require the gusset in the corner opposite a single diagonal roof bar for that design to be accepted.",
      evaluationType: "table",
      rows: [
        { id: "front_left", label: "Front left" },
        { id: "front_right", label: "Front right" },
        { id: "rear_left", label: "Rear left" },
        { id: "rear_right", label: "Rear right" },
      ],
      columns: [{ key: "present", label: "Present", type: "boolean" }],
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "roof_4_1_measurements_welds",
      name: "253-12/253-21: Measurements and welds",
      category: "4.1. Roof bars & rear diagonals -- 253-12/253-21 design",
      requirement: "required",
      reference: "",
      description: "",
      showIf: { id: "roof_bars", equals: "253-12" },
      evaluationType: "table",
      rows: ROOF_4_1_WELD_ROWS,
      columns: WELD_WITH_DIST_COLUMNS,
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "roof_4_1_gussets_mandatory",
      name: "253-12/253-21: Mandatory gussets",
      category: "4.1. Roof bars & rear diagonals -- 253-12/253-21 design",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.5",
      description: "",
      showIf: { id: "roof_bars", equals: "253-12" },
      evaluationType: "table",
      rows: [{ id: "front_left", label: "Front or Left" }, { id: "rear_right", label: "Rear or Right" }],
      columns: gussetColumns(NASA_SECONDARY_REQ),
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "roof_4_1_gussets_optional",
      name: "253-12/253-21: Optional gussets",
      category: "4.1. Roof bars & rear diagonals -- 253-12/253-21 design",
      requirement: "recommended",
      reference: "",
      description: "",
      showIf: { id: "roof_bars", equals: "253-12" },
      evaluationType: "table",
      rows: [{ id: "top_left", label: "Top or Left" }, { id: "bottom_right", label: "Bottom or Right" }],
      columns: gussetColumns(NASA_SECONDARY_REQ),
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "roof_4_2_measurements_welds",
      name: "253-14/253-22: Measurements and welds",
      category: "4.2. Roof bars & rear diagonals -- 253-14/253-22 design",
      requirement: "required",
      reference: "",
      description: "",
      showIf: { id: "roof_bars", equals: "253-14" },
      evaluationType: "table",
      rows: [
        { id: "front_roof_left", label: "1. Front roof left" }, { id: "front_roof_right", label: "2. Front roof right" },
        { id: "center_roof_left", label: "3. Center roof left" }, { id: "center_roof_right", label: "4. Center roof right" },
        { id: "top_rear_left", label: "5. Top rear left" }, { id: "top_rear_right", label: "6. Top rear right" },
        { id: "bottom_rear_left", label: "7. Bottom rear left" }, { id: "bottom_rear_right", label: "8. Bottom rear right" },
      ],
      columns: WELD_WITH_DIST_COLUMNS,
      visuallyVerifiable: true,
      hardFail: true,
    },
  ];

  // =====================================================================
  // Section 5. Door bars
  // =====================================================================
  // Left and right are independent choices -- a road-racing car isn't
  // guaranteed a symmetric design the way an oval-track car usually is, and
  // since we don't know if the car is LHD or RHD, sides are labeled
  // "Left"/"Right" rather than "driver"/"codriver" throughout this section.
  //
  // 253-9's "intersection" design (1 continuous bar + 2 half bars) has 2
  // physical tubes per side, and which one is fabricated as the continuous
  // one isn't fixed by the rule -- so it's offered as 2 separate design
  // options (mirror images of each other) rather than a hidden assumption.
  function isDoor9Intersection(v) { return v === "253-9-intersection-1" || v === "253-9-intersection-2"; }
  const DOOR_BAR_DESIGN_OPTIONS = [
    { id: "253-9-intersection-1", label: "253-9: 1 continuous bar + 2 half bars", diagram: "253-9-intersection", outcome: "pass" },
    { id: "253-9-intersection-2", label: "253-9: 1 continuous bar + 2 half bars (other tube continuous)", diagram: "253-9-intersection-2", outcome: "pass" },
    { id: "253-9-bent", label: "253-9: 2 bend bars", diagram: "253-9", outcome: "pass" },
    { id: "253-10", label: "253-10: Triangle design", diagram: "253-10", outcome: "pass" },
    { id: "253-11", label: "253-11: Double bars", diagram: "253-11", outcome: "pass" },
    { id: "nascar", label: "NASCAR door bars", diagram: "stock-car", note: "Requires prior scrutineer approval. Additional geometry/detail sections to follow.", outcome: "pass" },
    { id: "single-bar", label: "Single bar", diagram: "single-bar", note: "A single door bar does not satisfy FIA 253-9/253-10/253-11 for new construction. Captured for identification; legality/safety to be assessed separately.", outcome: "fail" },
    { id: "none", label: "None present", outcome: "fail" },
  ];
  function doorBarDesignElement(side) {
    const cap = side === "left" ? "Left" : "Right";
    return {
      id: "door_bars_" + side,
      name: cap + " door bar design",
      category: "Other structural elements",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.2",
      description: "One of 3 designs. Upper attachment point must not be higher than half the door-opening height. Left and right can differ (e.g. on a road-racing car) -- check your sanctioning body's own symmetry requirement if running with a co-driver.",
      // Doesn't apply to a half rollcage with no lateral rollbars to attach
      // door bars to. Only actually excludes anything once "Lateral
      // rollbars" is explicitly answered "none" -- unanswered (an identified
      // 253-1/2/3 structure never asks that question) leaves this visible.
      showIf: { id: "lateral_rollbars_other", notEquals: "none" },
      evaluationType: "choice",
      options: DOOR_BAR_DESIGN_OPTIONS,
      // Merged in rather than a separate element/card -- only relevant (shown)
      // for the 253-9 variants, 253-10, and the single-bar identification
      // option, since 253-11 and nascar already include a sill-like bar as
      // part of their own design.
      extraFields: [
        {
          key: "sill_bar",
          label: "Sill bar",
          type: "boolean",
          diagram: "sill-bar-toggle",
          requirement: "recommended",
          showIf: { in: ["253-9-intersection-1", "253-9-intersection-2", "253-9-bent", "253-10", "single-bar"] },
        },
      ],
      tubing: null,
      noCapture: true,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "No " + side + " door bar present.",
    };
  }
  // sides: which of "left"/"right" currently apply to this design, so a
  // table only shows the rows for the side(s) actually using it (a
  // road-racing car can have this design on only one side).
  function doorBarWeldRows(withCenter, sides) {
    const cap = (side) => (side === "left" ? "Left" : "Right");
    const rows = [];
    sides.forEach((side) => {
      rows.push({ id: "front_top_" + side, label: cap(side) + " front top" }, { id: "front_bottom_" + side, label: cap(side) + " front bottom" });
      if (withCenter) rows.push({ id: "center_front_" + side, label: cap(side) + " center front" }, { id: "center_rear_" + side, label: cap(side) + " center rear" });
      rows.push({ id: "top_rear_" + side, label: cap(side) + " top rear" }, { id: "bottom_rear_" + side, label: cap(side) + " bottom rear" });
    });
    return rows.map((r, i) => Object.assign({}, r, { label: (i + 1) + ". " + r.label }));
  }
  const DOOR_9X_SHOWIF = { any: [
    { id: "door_bars_left", in: ["253-9-intersection-1", "253-9-intersection-2"] },
    { id: "door_bars_right", in: ["253-9-intersection-1", "253-9-intersection-2"] },
  ] };
  function door9xSides(getAnswer) { return ["left", "right"].filter((s) => isDoor9Intersection(getAnswer("door_bars_" + s).value)); }
  const DOOR_9BENT_SHOWIF = { any: [{ id: "door_bars_left", equals: "253-9-bent" }, { id: "door_bars_right", equals: "253-9-bent" }] };
  function door9bentSides(getAnswer) { return ["left", "right"].filter((s) => getAnswer("door_bars_" + s).value === "253-9-bent"); }
  const SECTION_5_1 = [
    doorBarDesignElement("left"),
    doorBarDesignElement("right"),
    {
      id: "door_9_intersection_welds",
      name: "Welds -- intersection configuration",
      category: "5.1. Door bars -- 253-9 (X bar design)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_9X_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => doorBarWeldRows(true, door9xSides(getAnswer)),
      columns: WELD_COLUMNS,
      visuallyVerifiable: true, hardFail: true,
    },
    {
      id: "door_9_intersection_gussets",
      name: "Gussets (mandatory) -- intersection configuration",
      category: "5.1. Door bars -- 253-9 (X bar design)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_9X_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => {
        const rows = [];
        door9xSides(getAnswer).forEach((side) => {
          const cap = side === "left" ? "Left" : "Right";
          rows.push({ id: side + "_gusset_1", label: cap + ": Top or Left" }, { id: side + "_gusset_2", label: cap + ": Bottom or Right" });
        });
        return rows;
      },
      columns: gussetColumns(NASA_PRIMARY_REQ),
      visuallyVerifiable: true, hardFail: true,
    },
    {
      id: "door_9_2bar_dims",
      name: "Dimensions -- 2-bar configurations",
      category: "5.1. Door bars -- 253-9 (X bar design)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_9BENT_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => {
        const rows = [];
        door9bentSides(getAnswer).forEach((side) => {
          const cap = side === "left" ? "Left" : "Right";
          rows.push(
            { id: side + "_front_dim", label: cap + " front dimension before gusset (min 300mm)" },
            { id: side + "_rear_dim", label: cap + " rear dimension before gusset (min 200mm)" },
            { id: side + "_space", label: cap + " space between bars (< diameter of larger bar)" }
          );
        });
        return rows;
      },
      columns: [{ key: "value", label: "Value (mm)", type: "number" }],
      visuallyVerifiable: false, hardFail: true,
    },
    {
      id: "door_9_2bar_welds",
      name: "Welds -- 2-bar configurations",
      category: "5.1. Door bars -- 253-9 (X bar design)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_9BENT_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => doorBarWeldRows(false, door9bentSides(getAnswer)),
      columns: WELD_COLUMNS,
      visuallyVerifiable: true, hardFail: true,
    },
  ];
  const DOOR_10_SHOWIF = { any: [{ id: "door_bars_left", equals: "253-10" }, { id: "door_bars_right", equals: "253-10" }] };
  function door10Sides(getAnswer) { return ["left", "right"].filter((s) => getAnswer("door_bars_" + s).value === "253-10"); }
  const SECTION_5_2 = [
    {
      id: "door_10_welds",
      name: "253-10: Welds",
      category: "5.2. Door bars -- 253-10 (triangle design)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_10_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => {
        const rows = [];
        door10Sides(getAnswer).forEach((side) => {
          const cap = side === "left" ? "Left" : "Right";
          rows.push(
            { id: "front_top_" + side, label: cap + " front top" }, { id: "front_lower_" + side, label: cap + " front lower" }, { id: "center_" + side, label: cap + " center" },
            { id: "rear_top_" + side, label: cap + " rear top" }, { id: "rear_lower_" + side, label: cap + " rear lower" }
          );
        });
        return rows.map((r, i) => Object.assign({}, r, { label: (i + 1) + ". " + r.label }));
      },
      columns: WELD_COLUMNS,
      visuallyVerifiable: true, hardFail: true,
    },
    {
      id: "door_10_rocker_plate",
      name: "253-10: Rocker plate",
      category: "5.2. Door bars -- 253-10 (triangle design)",
      requirement: "conditional", reference: "", description: "If no sill bar is used with this configuration, the bottom of the V must be secured to the chassis with a plate similar to a rear backstay mounting foot.",
      showIf: DOOR_10_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => door10Sides(getAnswer).map((side) => ({ id: side, label: side === "left" ? "Left" : "Right" })),
      columns: [{ key: "plate_design", label: "Plate design (253-53 to 253-57)", type: "text" }, { key: "size", label: "Size (cm², >=60)", type: "number", compare: { op: "gte", value: 60 } }, { key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
  ];
  const DOOR_11_SHOWIF = { any: [{ id: "door_bars_left", equals: "253-11" }, { id: "door_bars_right", equals: "253-11" }] };
  const SECTION_5_3 = [
    {
      id: "door_11_welds",
      name: "253-11: Welds",
      category: "5.3. Door bars -- 253-11 (double bars)",
      requirement: "required", reference: "", description: "",
      showIf: DOOR_11_SHOWIF,
      evaluationType: "table",
      rows: (getAnswer) => {
        const rows = [];
        ["left", "right"].filter((s) => getAnswer("door_bars_" + s).value === "253-11").forEach((side) => {
          const cap = side === "left" ? "Left" : "Right";
          rows.push(
            { id: "front_top_" + side, label: cap + " front top" }, { id: "front_lower_" + side, label: cap + " front lower" },
            { id: "rear_top_" + side, label: cap + " rear top" }, { id: "rear_lower_" + side, label: cap + " rear lower" }
          );
        });
        return rows.map((r, i) => Object.assign({}, r, { label: (i + 1) + ". " + r.label }));
      },
      columns: WELD_COLUMNS,
      visuallyVerifiable: true, hardFail: true,
    },
  ];

  // =====================================================================
  // Section 6. Windshield support bar (253-15)
  // =====================================================================
  const SECTION_6_WINDSHIELD = [
    {
      id: "a_pillar_reinforcement",
      name: "Windscreen pillar (A-pillar) reinforcement 253-15",
      category: "Other structural elements",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.4",
      description: "Required on each side of the front rollbar when dimension A exceeds 200mm. May be bent only if straight in side view with the bend under 20 degrees. Built as either a single continuous bar, or as 2 bars where it intersects the door bar.",
      evaluationType: "choice",
      options: [
        { id: "continuous", label: "1 continuous bar", outcome: "pass" },
        { id: "two_bars", label: "2 bars", outcome: "pass" },
      ],
      diagram: "253-15",
      tubing: null,
      visuallyVerifiable: true,
      hardFail: true,
      hardFailMessage: "A-pillar reinforcement missing where dimension A exceeds 200mm.",
    },
    {
      id: "windshield_measurements",
      name: "Measurements",
      category: "6. Windshield support bar (253-15)",
      requirement: "required",
      reference: "",
      description: "",
      evaluationType: "table",
      rows: [{ id: "driver", label: "Driver" }, { id: "codriver", label: "Codriver" }],
      columns: [
        { key: "sections", label: "# sections", type: "select", options: [{ id: "1", label: "1" }, { id: "2", label: "2" }] },
        { key: "straight", label: "Straight in side view", type: "boolean" },
        { key: "bend_angle", label: "Bend angle (<20 degrees)", type: "number", compare: { op: "lt", value: 20 } },
      ],
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "windshield_welds",
      name: "Welds",
      category: "6. Windshield support bar (253-15)",
      requirement: "required",
      reference: "",
      description: "",
      evaluationType: "table",
      rows: [
        { id: "top_left", label: "1. Top left" }, { id: "center_top_left", label: "2. Center top left (*)" }, { id: "center_lower_left", label: "3. Center lower left (*)" }, { id: "bottom_left", label: "4. Bottom left" },
        { id: "top_right", label: "5. Top right" }, { id: "center_top_right", label: "6. Center top right (*)" }, { id: "center_lower_right", label: "7. Center lower right (*)" }, { id: "bottom_right", label: "8. Bottom right" },
      ],
      columns: WELD_WITH_DIST_COLUMNS,
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "windshield_gussets",
      name: "Gussets (mandatory)",
      category: "6. Windshield support bar (253-15)",
      requirement: "required",
      reference: "",
      description: "Gusset 1 has no intersection; gusset 2/3 apply where the bar meets another member.",
      evaluationType: "table",
      rows: [
        { id: "driver_top_left_1", label: "Driver: Top or Left (gusset 1)" }, { id: "codriver_top_left_1", label: "Codriver: Top or Left (gusset 1)" },
        { id: "driver_top_left_23", label: "Driver: Top or Left (gusset 2/3)" }, { id: "driver_bottom_right_23", label: "Driver: Bottom or Right (gusset 2/3)" },
        { id: "codriver_top_left_23", label: "Codriver: Top or Left (gusset 2/3)" }, { id: "codriver_bottom_right_23", label: "Codriver: Bottom or Right (gusset 2/3)" },
      ],
      columns: gussetColumns(NASA_SECONDARY_REQ),
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "gusset_placement",
      name: "General gusset placement",
      category: "6. Windshield support bar (253-15)",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1.5",
      description: "Minimum 2 gussets required at: main-rollbar diagonal junctions, roof-reinforcement junctions (253-12 design only), door-bar junctions (253-9 design only), and door-bar-to-windscreen-pillar-reinforcement junctions.",
      evaluationType: "boolean",
      visuallyVerifiable: true,
      hardFail: false,
    },
  ];

  // Shared by the 253-31 temple bar / windshield reinforcement detail
  // tables below: only lists the side(s) actually selected in the
  // corresponding "present" choice (left/right/both), so an unconfirmed
  // side never gets a weld row to fill in.
  function sideRows(v) {
    if (v === "left") return [{ id: "left", label: "Left" }];
    if (v === "right") return [{ id: "right", label: "Right" }];
    return [{ id: "left", label: "Left" }, { id: "right", label: "Right" }];
  }

  // =====================================================================
  // Section 7-13. Common tail -- identical across all sanctioning bodies
  // per the source document (not org-patched).
  // =====================================================================
  const FIA_253_COMMON_TAIL = [
    // -- 7. Optional bars --
    {
      id: "harness_bar_present",
      name: "Harness bar present",
      category: "Optional bars",
      requirement: "recommended", reference: "2024 Annexe J / Appendix J Article 253", description: "Optional bar to anchor shoulder harnesses.",
      evaluationType: "boolean", strictYesNo: true, visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "harness_bar_253_66",
      name: "Harness bar (253-66) welds",
      category: "Optional bars",
      requirement: "recommended", reference: "2024 Annexe J / Appendix J Article 253", description: "",
      showIf: { id: "harness_bar_present", equals: "yes" },
      evaluationType: "table", rows: [{ id: "bar", label: "253-66" }], columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "harness_bar_legacy_200",
      name: "Legacy harness bar (diagram 200, e.g. FFSA) welds",
      category: "Optional bars",
      requirement: "recommended", reference: "03-ART 253 Equipement de Securite Gr. N-A-R-GT-F2000 2020", description: "Traditional harness bar secured to the main hoop. May be at a different height for driver/codriver. Minimum diameter x thickness is 38 x 2.5mm.",
      showIf: { id: "harness_bar_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "driver", label: "200 - Driver" }, { id: "codriver", label: "200 - Codriver" }],
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_lateral_reinforcement_present",
      name: "Rear lateral reinforcement (253-17)",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "Connects at the front to the upper door bar, the lower door bar, or both (2 bars added). Design must be identical on both sides when running with a co-driver.",
      evaluationType: "choice",
      options: [
        { id: "upper", label: "Upper bar (to upper door bar)", diagram: "253-17-upper", outcome: "pass" },
        { id: "lower", label: "Lower bar (to lower door bar)", diagram: "253-17-lower", outcome: "pass" },
        { id: "both", label: "Both bars", diagram: "253-17-both", outcome: "pass" },
        { id: "none", label: "None present", diagram: "253-17-none", outcome: "fail" },
      ],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_lateral_reinforcement_detail",
      name: "253-17 welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "rear_lateral_reinforcement_present", notEquals: "none" },
      evaluationType: "table",
      rows: [{ id: "driver", label: "Driver" }, { id: "codriver", label: "Codriver" }],
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_transversal_present",
      name: "Rear transversal reinforcement (253-18) present",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      evaluationType: "boolean", strictYesNo: true, visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_transversal_detail",
      name: "253-18 / 253-18B welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "rear_transversal_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "253-18", label: "253-18" }, { id: "253-18b", label: "253-18B" }],
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_lower_x_present",
      name: "Rear lower X (253-19) present",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      evaluationType: "boolean", strictYesNo: true, visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_lower_x_detail",
      name: "253-19 sections and welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "rear_lower_x_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "driver_top_codriver_bottom", label: "Driver top to codriver bottom" }, { id: "codriver_top_driver_bottom", label: "Codriver top to driver bottom" }],
      columns: [{ key: "sections", label: "# sections", type: "select", options: [{ id: "1", label: "1" }, { id: "2", label: "2" }] }, { key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "rear_lower_x_gussets",
      name: "253-19 gussets",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "rear_lower_x_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "top_left", label: "Top or Left" }, { id: "bottom_right", label: "Bottom or Right" }],
      columns: gussetColumns(NASA_SECONDARY_REQ),
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "anti_intrusion_present",
      name: "Anti-intrusion bars (253-25) present",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "The extensions must be connected to the front suspension top mounting points.",
      evaluationType: "boolean", strictYesNo: true, visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "anti_intrusion_detail",
      name: "253-25 welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "anti_intrusion_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "driver_top", label: "Driver Top" }, { id: "driver_bottom", label: "Driver Bottom" }, { id: "codriver_top", label: "Codriver Top" }, { id: "codriver_bottom", label: "Codriver Bottom" }],
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "anti_intrusion_plates",
      name: "253-25 plates",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "anti_intrusion_present", equals: "yes" },
      evaluationType: "table",
      rows: [{ id: "driver", label: "Driver" }, { id: "codriver", label: "Codriver" }],
      columns: [{ key: "size", label: "Size (cm², >=120 front/60 rear)", type: "number", compare: { op: "gte", value: 60 } }, { key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "dash_bar_present",
      name: "Dash bar (253-29) present",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "Optional in case the stock dash bar of the car is not retained.",
      // Doesn't apply to a half rollcage with no lateral rollbars to tie
      // the dash bar into.
      showIf: { id: "lateral_rollbars_other", notEquals: "none" },
      evaluationType: "boolean", strictYesNo: true, visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "dash_bar_detail",
      name: "253-29 welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "dash_bar_present", equals: "yes" },
      evaluationType: "table", rows: [{ id: "bar", label: "253-29" }], columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    // 253-31 has 2 physically distinct components (real geometry for both):
    // a temple bar (near the main hoop/roof junction) and a windshield
    // reinforcement (near the A-pillar/windshield junction) -- tracked as
    // separate elements now that each has its own identity, replacing the
    // single generic 253-31/32/33 tube-or-gusset choice that stood in for
    // all of them before any of this had geometry. Left/right/both/none
    // rather than a plain yes/no -- a car isn't guaranteed to have
    // identical reinforcement on both sides (same reasoning as the door
    // bars and 253-17 rear lateral above); see sideRows() near the top of
    // this file for the shared detail-table row logic.
    {
      id: "temple_bar_present",
      name: "Temple bar (253-31) present",
      category: "Optional bars",
      requirement: "recommended",
      reference: "",
      description: "Reinforcement tube or bent-sheet-metal U-shape per Article 253-8.2.14, thickness >=1.0mm, near the main hoop/roof junction. Ends must not extend past halfway along the members it's attached to.",
      evaluationType: "choice",
      options: [
        { id: "left", label: "Left only", outcome: "pass" },
        { id: "right", label: "Right only", outcome: "pass" },
        { id: "both", label: "Both sides", outcome: "pass" },
        { id: "none", label: "None present", outcome: "fail" },
      ],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "temple_bar_detail",
      name: "Temple bar (253-31) welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "temple_bar_present", notEquals: "none" },
      evaluationType: "table",
      rows: (getAnswer) => sideRows(getAnswer("temple_bar_present").value),
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "windshield_reinforcement_present",
      name: "Windshield reinforcement (253-31) present",
      category: "Optional bars",
      requirement: "recommended",
      reference: "",
      description: "Reinforcement tube or bent-sheet-metal U-shape per Article 253-8.2.14, thickness >=1.0mm, near the A-pillar/windshield junction. Ends must not extend past halfway along the members it's attached to.",
      evaluationType: "choice",
      options: [
        { id: "left", label: "Left only", outcome: "pass" },
        { id: "right", label: "Right only", outcome: "pass" },
        { id: "both", label: "Both sides", outcome: "pass" },
        { id: "none", label: "None present", outcome: "fail" },
      ],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "windshield_reinforcement_detail",
      name: "Windshield reinforcement (253-31) welds",
      category: "Optional bars",
      requirement: "recommended", reference: "", description: "",
      showIf: { id: "windshield_reinforcement_present", notEquals: "none" },
      evaluationType: "table",
      rows: (getAnswer) => sideRows(getAnswer("windshield_reinforcement_present").value),
      columns: [{ key: "welds", label: "Welds complete", type: "boolean" }],
      visuallyVerifiable: true, hardFail: false,
    },

    // -- Mounting feet design (which of the 5 FIA foot-plate designs is
    // used at each foot) -- a design-choice fact, not a measurement, so it
    // lives here in Part 1 rather than alongside the Part 3 measurement
    // table (mounting_feet_table) size/weld columns, which now only ask
    // for the things that table doesn't cover.
    {
      id: "mounting_feet_design",
      name: "Mounting feet design",
      category: "Mounting feet",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.6",
      description: "One of 5 plate designs per foot: 253-50/51/52 (single plane plate), 253-53 (double plane plate), 253-54 (multiplane box), 253-55/56 (multiplane rocker plate), or 253-57 (flat or curved plate -- technically for the rear backstays only, but captured here for identification either way). Plate size and weld completion are captured in Part 3.",
      evaluationType: "table",
      rows: (getAnswer) => mountingFeetDesignRows(getAnswer),
      columns: [
        { key: "design", label: "Design", type: "select", options: MOUNTING_FOOT_DESIGN_OPTIONS },
        { key: "mount_type", label: "Bolted/Welded", type: "radio", options: [{ id: "bolted", label: "Bolted" }, { id: "welded", label: "Welded" }] },
      ],
      visuallyVerifiable: true,
      hardFail: true,
    },

    // -- Gussets: which junctions actually have one, and which of the 2
    // ways to build it, is a design-choice fact (Part 1, same reasoning as
    // mounting feet design above); material and thickness are captured with
    // everything else in Part 2 (gussetSolo, same one-material-for-all-
    // gussets assumption mounting feet uses); the actual per-gusset
    // dimensions are measurements, captured in Part 3.
    {
      id: "gusset_design",
      name: "Gusset design",
      category: "Gussets",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1",
      description: "Minimum 2 gussets required at main-rollbar diagonal junctions, roof-bar junctions, door-bar junctions, and (where present) windshield-bar and rear-lower-X junctions. Each is built either as a taco (a sleeve wrapped around the two tubes) or a single flat plate spanning them. Material/thickness and dimensions are captured in Part 2 and Part 3.",
      evaluationType: "table",
      rows: (getAnswer) => gussetJunctionRows(getAnswer),
      columns: [{ key: "design", label: "Design", type: "radio", options: GUSSET_DESIGN_OPTIONS }],
      visuallyVerifiable: true,
      hardFail: true,
    },
    {
      id: "gusset_material",
      name: "Gusset material and thickness",
      category: "Gussets",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1",
      description: "Assumes all gussets use the same plate material and thickness. Per-gusset dimensions (length, corner cutout, hole diameter) are captured in Part 3.",
      evaluationType: "gussetSolo",
      visuallyVerifiable: false,
      hardFail: true,
    },
    {
      id: "gusset_dimensions",
      name: "Gusset dimensions",
      category: "Gussets",
      requirement: "required",
      reference: "2020 FIA 253 Ch.8.3.2.1",
      description: "One row per gusset location confirmed present in Part 1.",
      evaluationType: "table",
      rows: (getAnswer) => gussetJunctionRows(getAnswer),
      columns: [
        { key: "length", label: "Gusset length (mm)", type: "number" },
        { key: "corner_cutout", label: "Corner cutout for weld inspection", type: "boolean" },
        { key: "hole_diameter", label: "Hole diameter (mm, if any)", type: "number", optional: true },
      ],
      visuallyVerifiable: false,
      hardFail: true,
    },

    // -- 8. Installation constraints --
    {
      id: "installation_constraints",
      name: "Installation constraints",
      category: "8. Installation constraints",
      requirement: "required",
      reference: "",
      description: "Dimensional limits controlling cockpit encroachment and windshield projection.",
      evaluationType: "table",
      rows: [
        { id: "a", label: "A (>300mm/11.8in)" }, { id: "b", label: "B (<250mm/9.85in)" }, { id: "c", label: "C (<300mm/11.8in)" },
        { id: "h", label: "H (door opening height)" }, { id: "e", label: "E (<0.5 H)" },
        { id: "r1", label: "R1 (top projection through windshield <100mm)" }, { id: "r2", label: "R2 (side projection through windshield <70mm)" },
      ],
      columns: [{ key: "value", label: "Value (mm)", type: "number" }],
      visuallyVerifiable: false,
      hardFail: true,
    },

    // -- 9. Seat mounting points --
    {
      id: "seat_mount_stock_shell",
      name: "Seat mounting points -- stock or shell mount",
      category: "9. Seat mounting points",
      requirement: "conditional",
      reference: "",
      description: "Stock mounting points of the original seat on the chassis, or directly on the chassis shell (253-65), 4 points, 40cm2 backing plate min for each.",
      evaluationType: "table",
      rows: [
        { id: "driver_left_front", label: "Driver left front" }, { id: "driver_right_front", label: "Driver right front" },
        { id: "driver_left_rear", label: "Driver left rear" }, { id: "driver_right_rear", label: "Driver right rear" },
        { id: "codriver_left_front", label: "Codriver left front" }, { id: "codriver_right_front", label: "Codriver right front" },
        { id: "codriver_left_rear", label: "Codriver left rear" }, { id: "codriver_right_rear", label: "Codriver right rear" },
      ],
      columns: [{ key: "anchoring", label: "Anchoring point (stock, or plate >=40cm2 and >=3mm)", type: "text" }],
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "seat_mount_bar",
      name: "Seat mounting points -- bar mount",
      category: "9. Seat mounting points",
      requirement: "conditional",
      reference: "",
      description: "Traverse crossmember (253-65B), square tubing min 35x2.5mm (1.38x0.098in).",
      evaluationType: "table",
      rows: [
        { id: "driver_left_front", label: "Driver left front" }, { id: "driver_right_front", label: "Driver right front" },
        { id: "driver_left_rear", label: "Driver left rear" }, { id: "driver_right_rear", label: "Driver right rear" },
        { id: "codriver_left_front", label: "Codriver left front" }, { id: "codriver_right_front", label: "Codriver right front" },
        { id: "codriver_left_rear", label: "Codriver left rear" }, { id: "codriver_right_rear", label: "Codriver right rear" },
      ],
      columns: [
        { key: "end_plate", label: "End plate size (>=40cm2) and thickness (>=3mm)", type: "text" },
        { key: "square_tube", label: "Square tubing edge (>=38mm) and thickness (>=2.5mm)", type: "text" },
      ],
      visuallyVerifiable: true,
      hardFail: false,
    },
    {
      id: "seat_angle_location",
      name: "Seat angle and location",
      category: "9. Seat mounting points",
      requirement: "recommended",
      reference: "",
      description: "Most Model 20 HANS devices used in saloon cars need a backrest angle of about 20 degrees from vertical. Minimum 90mm between the inside of the seat backrest and the rollbar.",
      evaluationType: "table",
      rows: [{ id: "driver", label: "Driver" }, { id: "codriver", label: "Codriver" }],
      columns: [
        { key: "backrest_angle", label: "Backrest angle with vertical (deg)", type: "number" },
        { key: "backrest_distance", label: "Backrest distance from rollbar (mm, >=90)", type: "number", compare: { op: "gte", value: 90 } },
      ],
      visuallyVerifiable: false,
      hardFail: false,
    },

    // -- 10. Belt anchoring points --
    {
      id: "belt_shoulder",
      name: "Shoulder belts",
      category: "10. Belt anchoring points",
      requirement: "required",
      reference: "",
      description: "Anchoring point can be S (stock), HB (harness bar), or N (new point, mounted on the shell as near as possible to the centerline of the rear wheels -- indicate plate size >=40cm2 and thickness >=3mm).",
      evaluationType: "table",
      rows: [
        { id: "driver_left", label: "Driver left" }, { id: "driver_right", label: "Driver right" },
        { id: "codriver_left", label: "Codriver left" }, { id: "codriver_right", label: "Codriver right" },
      ],
      columns: [
        { key: "anchoring", label: "Anchoring point (S/HB/N)", type: "select", options: [{ id: "S", label: "S (stock)" }, { id: "HB", label: "HB (harness bar)" }, { id: "N", label: "N (new point)" }] },
        { key: "pivot_distance", label: "Pivot point distance (mm, >90)", type: "number", compare: { op: "gt", value: 90 } },
        { key: "belt_angle", label: "Belt angle (253-61c: 0-20 deg, or 253-61d: 10-25 deg)", type: "number" },
      ],
      visuallyVerifiable: false,
      hardFail: true,
    },
    {
      id: "belt_lap",
      name: "Lap belts",
      category: "10. Belt anchoring points",
      requirement: "required",
      reference: "",
      description: "Can re-use stock mounting points if they don't interfere with the cage. New points must be on the chassis shell (plate >=40cm2, thickness >=3mm), not rollcage bars.",
      evaluationType: "table",
      rows: [
        { id: "driver_left", label: "Driver left" }, { id: "driver_right", label: "Driver right" },
        { id: "codriver_left", label: "Codriver left" }, { id: "codriver_right", label: "Codriver right" },
      ],
      columns: [
        { key: "anchoring", label: "Anchoring point (stock, or plate >=40cm2/>=3mm)", type: "text" },
        { key: "belt_angle", label: "Belt angle (20-70 deg)", type: "number", compare: { op: "between", min: 20, max: 70 } },
      ],
      visuallyVerifiable: false,
      hardFail: true,
    },
    {
      id: "belt_anti_submarine_points",
      name: "Anti-submarine belt point count",
      category: "10. Belt anchoring points",
      requirement: "required",
      reference: "",
      description: "Anti-submarine belts can be mounted on a dedicated bar (min 38x2.5mm or 40x2mm) or a new anchoring point with a reinforcement plate (min 40cm2, min 3mm).",
      evaluationType: "choice",
      options: [
        { id: "five", label: "5-point belt (single anti-submarine belt, 20-25 deg)", outcome: "pass" },
        { id: "six", label: "6-point belt", outcome: "pass" },
        { id: "seven", label: "7-point belt", outcome: "pass" },
      ],
      visuallyVerifiable: true, hardFail: false,
    },
    {
      id: "belt_five_point",
      name: "5-point belt anchoring",
      category: "10. Belt anchoring points",
      requirement: "required", reference: "", description: "",
      showIf: { id: "belt_anti_submarine_points", equals: "five" },
      evaluationType: "table",
      rows: [{ id: "driver", label: "Driver" }, { id: "codriver", label: "Codriver" }],
      columns: [{ key: "anchoring", label: "Anchoring point (bar >=38x2.5mm or 40x2mm, or plate >=40cm2/>=3mm)", type: "text" }, { key: "belt_angle", label: "Belt angle (+20 to +25 deg)", type: "number", compare: { op: "between", min: 20, max: 25 } }],
      visuallyVerifiable: false, hardFail: true,
    },
    {
      id: "belt_six_point",
      name: "6-point belt anchoring",
      category: "10. Belt anchoring points",
      requirement: "required", reference: "", description: "",
      showIf: [{ id: "belt_anti_submarine_points", in: ["six", "seven"] }],
      evaluationType: "table",
      rows: [{ id: "driver_left", label: "Driver left" }, { id: "driver_right", label: "Driver right" }, { id: "codriver_left", label: "Codriver left" }, { id: "codriver_right", label: "Codriver right" }],
      columns: [
        { key: "anchoring", label: "Anchoring point (bar spec or plate >=40cm2/>=3mm)", type: "text" },
        { key: "spacing", label: "Space between anchoring points (in, 4-6)", type: "number", compare: { op: "between", min: 4, max: 6 } },
        { key: "belt_angle", label: "Belt angle (0 to -20 deg)", type: "number" },
      ],
      visuallyVerifiable: false, hardFail: true,
    },
    {
      id: "belt_seven_point",
      name: "7th point belt anchoring",
      category: "10. Belt anchoring points",
      requirement: "required", reference: "", description: "Fill up the 6-point belt information first, then add the 7th point here.",
      showIf: { id: "belt_anti_submarine_points", equals: "seven" },
      evaluationType: "table",
      rows: [{ id: "driver_7th", label: "Driver 7th" }, { id: "codriver_7th", label: "Codriver 7th" }],
      columns: [{ key: "anchoring", label: "Anchoring point (bar spec or plate >=40cm2/>=3mm)", type: "text" }, { key: "belt_angle", label: "Belt angle (+20 to +25 deg)", type: "number", compare: { op: "between", min: 20, max: 25 } }],
      visuallyVerifiable: false, hardFail: true,
    },

    // -- 11. Routing of lines --
    {
      id: "routing_of_lines",
      name: "Routing of lines",
      category: "11. Routing of lines",
      requirement: "required",
      reference: "FIA Article 253",
      description: "Inside the cockpit, the passage of electric cables, fluid lines (except windscreen washer fluid), and fire-suppression-system lines between the bodyshell's side members and the safety cage is forbidden.",
      evaluationType: "table",
      rows: [
        { id: "fuel", label: "Fuel lines" }, { id: "brake", label: "Brake lines" },
        { id: "fire_suppression", label: "Fire suppression system lines" }, { id: "electric", label: "Electric cables" },
      ],
      columns: [{ key: "location", label: "Location / routing", type: "text" }],
      visuallyVerifiable: true,
      hardFail: true,
    },

    // -- 12. Towing eye --
    {
      id: "towing_eye",
      name: "Towing eye",
      category: "12. Towing eye",
      requirement: "required",
      reference: "FIA Article 10",
      description: "No constraints on the shape, strength, or location of the towing eyes beyond being present front and rear.",
      evaluationType: "table",
      rows: [{ id: "front", label: "Front" }, { id: "rear", label: "Rear" }],
      columns: [{ key: "color", label: "Color", type: "text" }],
      visuallyVerifiable: true,
      hardFail: true,
    },

    // -- 13. Tube bending cheat sheet -- reference only, not scored.
    {
      id: "tube_bending_cheat_sheet",
      name: "Tube bending cheat sheet (reference)",
      category: "13. Tube bending cheat sheet",
      requirement: "informational",
      reference: "",
      description: "Cage tubing can only be bent using a cold process. The diameter of the thinner part of the bend must be at least 90% of the tubing size; minimum bend radius is 3x the tube diameter. Example: 1.50in tube -> max stretch 1.35in, min radius 4.50in. 1.75in tube -> max stretch 1.575in, min radius 5.25in.",
      evaluationType: "boolean",
      strictYesNo: true,
      visuallyVerifiable: false,
      diagram: "bend-radius",
      hardFail: false,
    },
  ];

  const FIA_253_DOCUMENT_BASE = [
    { id: "homologation_route", name: "Construction route", category: "Logbook", requirement: "required", reference: "2020 FIA 253 Ch.8", description: "Is this cage FIA/ASN homologated (exact, unmodified match to homologation papers), or a custom build to 2020 FIA Appendix J Article 253 Chapter 8?", evaluationType: "choice", isRoutingQuestion: true, options: [
      { id: "homologated", label: "FIA/ASN homologated", note: "Rest of this checklist does not apply; verify against homologation papers instead.", outcome: "exempt" },
      { id: "fabricated", label: "FIA 253 Ch.8 custom build", note: "Continue through the checklist below.", outcome: "pass" },
    ], visuallyVerifiable: false, hardFail: true, hardFailMessage: "No construction route selected or homologation papers not available for a claimed-homologated cage." },
  ]
    .concat(SECTION_1_VEHICLE)
    .concat(SECTION_2_BASE_STRUCTURE)
    .concat(SECTION_3_MAIN_DIAGONALS)
    .concat(SECTION_4_1)
    .concat(SECTION_5_1, SECTION_5_2, SECTION_5_3)
    .concat(SECTION_6_WINDSHIELD)
    .concat([
      {
        id: "padding_helmet",
        name: "Helmet-contact padding",
        category: "Padding",
        requirement: "required",
        reference: "2020 FIA 253 Ch.8.3.5",
        description: "Padding to FIA 8857-2001 type A or SFI 45.1 wherever an occupant's crash helmet could contact the cage.",
        evaluationType: "boolean",
        visuallyVerifiable: true,
        hardFail: true,
        hardFailMessage: "No certified padding at helmet-contact locations.",
      },
      {
        id: "padding_body",
        name: "Body-contact padding",
        category: "Padding",
        requirement: "recommended",
        reference: "2020 FIA 253 Ch.8.3.5",
        description: "Padding recommended anywhere an occupant's body (especially lower legs) could contact the cage.",
        evaluationType: "boolean",
        visuallyVerifiable: true,
        hardFail: false,
      },
    ]);

  // ---- NASA Rally Sport variances on the FIA base ----
  const NASA_NEW_CONSTRUCTION_ELEMENTS = insertElements(
    patchElements(FIA_253_DOCUMENT_BASE, {
      homologation_route: {
        reference: "NRS GRR 3.7.2",
      },
      roof_bars: {
        reference: "2020 FIA 253 Ch.8.3.2.1.3; NRS GRR 3.7.2(2) excludes 253-13",
        description: "253-13 (no front roof corner support) is NOT permitted for NASA new construction per NRS GRR 3.7.2(2). Pick 253-12 or 253-14 (or the NASA-specific RB-4 option).",
        addOptions: [{ id: "rb-4", label: "RB-4: Single diagonal + roof gussets (NASA option)", diagram: "rb-4", outcome: "pass" }],
        hardFailMessage: "No roof bar present (253-13 is disallowed for NASA new construction).",
      },
      padding_helmet: { reference: "NRS GRR 3.8.1" },
      padding_body: { reference: "NRS GRR 3.8.2" },
    }),
    []
  ).concat(FIA_253_COMMON_TAIL);

  // ---- ARA (American Rally Association) variances on the FIA base ----
  const ARA_NEW_CONSTRUCTION_ELEMENTS = insertElements(
    patchElements(FIA_253_DOCUMENT_BASE, {
      homologation_route: {
        reference: "ARA RTR 2.2.2(c)(2)",
        optionOverrides: {
          homologated: { note: "Rest of this checklist does not apply; verify against homologation papers instead. ARA's no-bolt-together rule (RTR 2.2.2(c)(4)) still applies regardless of homologation status." },
        },
      },
      primary_tubing: { reference: ARA_REF, requirements: ARA_PRIMARY_REQ },
      secondary_tubing: { reference: ARA_REF, requirements: ARA_SECONDARY_STD_REQ },
      main_diagonal_gussets: { columnOverrides: { tube: { requirements: ARA_SECONDARY_REINF_REQ } } },
      roof_4_1_gussets_mandatory: { columnOverrides: { tube: { requirements: ARA_SECONDARY_REINF_REQ } } },
      roof_4_1_gussets_optional: { columnOverrides: { tube: { requirements: ARA_SECONDARY_REINF_REQ } } },
      door_9_intersection_gussets: { columnOverrides: { tube: { requirements: ARA_PRIMARY_REQ } } },
      a_pillar_reinforcement: {
        reference: "ARA RTR 2.2.2(c)(2)(a); 2020 FIA 253 Ch.8.3.2.1.4",
        description: "ARA is explicit: new cages without windscreen supports will NOT be accepted for logbooking whenever dimension A exceeds 200mm -- which is the case for essentially all cars.",
      },
      windshield_gussets: { columnOverrides: { tube: { requirements: ARA_SECONDARY_REINF_REQ } } },
      gusset_placement: { description: "Minimum 2 gussets required at: main-rollbar diagonal junctions, roof-reinforcement junctions (253-12 design only), door-bar junctions (253-9 design only), and door-bar-to-windscreen-pillar-reinforcement junctions. Unlike NASA, ARA's RTR does not separately mandate a weld-inspection corner cut on every gusset." },
      padding_helmet: {
        reference: "ARA RTR 2.2.3",
        description: "All tubing forward of and including the main hoop in the roofline must be padded. Any other tubing which may contact the helmet while seated must also be padded.",
        hardFailMessage: "Roofline tubing forward of/including the main hoop is not padded, or another helmet-contact tube lacks padding.",
      },
      padding_body: { reference: "ARA RTR 2.2.3 (heading covers padding generally; body-contact specificity not separately confirmed in the sourced text)" },
    }),
    []
  ).concat(FIA_253_COMMON_TAIL);

  // ---- CARS/CRC (Canadian Association of Rallysport) variances on the FIA base ----
  const CARS_NEW_CONSTRUCTION_ELEMENTS = insertElements(
    patchElements(FIA_253_DOCUMENT_BASE, {
      homologation_route: { reference: "CARS NRR 12.3.2.3" },
      primary_tubing: { reference: CARS_REF, requirements: CARS_PRIMARY_REQ },
      secondary_tubing: { reference: CARS_REF, requirements: CARS_SECONDARY_REQ },
      main_diagonal_gussets: { columnOverrides: { tube: { requirements: CARS_SECONDARY_REQ } } },
      roof_4_1_gussets_mandatory: { columnOverrides: { tube: { requirements: CARS_SECONDARY_REQ } } },
      roof_4_1_gussets_optional: { columnOverrides: { tube: { requirements: CARS_SECONDARY_REQ } } },
      door_9_intersection_gussets: { columnOverrides: { tube: { requirements: CARS_PRIMARY_REQ } } },
      windshield_gussets: { columnOverrides: { tube: { requirements: CARS_SECONDARY_REQ } } },
      gusset_placement: { description: "Minimum 2 gussets required at: main-rollbar diagonal junctions, roof-reinforcement junctions (253-12 design only), door-bar junctions (253-9 design only), and door-bar-to-windscreen-pillar-reinforcement junctions. The CARS text sourced here does not separately mandate a weld-inspection corner cut." },
      padding_helmet: { reference: "CARS NRR 12.3.2.6", description: "Padding to FIA 8857-2001 type A or SFI 45.1 wherever an occupant's crash helmet could contact the cage." },
      padding_body: {
        requirement: "required",
        reference: "CARS NRR 12.3.2.6",
        description: "Unlike NASA and ARA, CARS states body-contact padding as a requirement, not just a recommendation: where an occupant's body could contact the safety cage, flame-retardant padding must be provided.",
        hardFail: true,
        hardFailMessage: "No flame-retardant padding at locations where an occupant's body could contact the cage.",
      },
    }),
    [
      {
        after: "tubing_bar_classification",
        element: {
          id: "tube_sample_documentation",
          name: "Material certificate and tube sample",
          category: "2.4. Welds",
          requirement: "required",
          reference: "CARS NRR 12.3.2.5",
          description: "A material certificate or original sales receipt detailing the tubing material must be presented. For every tube size used in the cage, an unpainted sample section 45cm long and bent 60 degrees must be presented as part of the initial log book inspection.",
          evaluationType: "attestation",
          visuallyVerifiable: false,
          hardFail: true,
          hardFailMessage: "Material certificate/receipt and/or the required tube sample section(s) are not available for initial inspection.",
        },
      },
    ]
  ).concat(FIA_253_COMMON_TAIL);

    const ARA_RULES = {
    org: "ARA",
    orgFullName: "American Rally Association",
    sourceDocuments: [
      { title: "American Rally Association Rally Technical Rules (RTR), 2026 Edition, through Bulletin 2026-8", relevantSections: "2.2.2 Roll Over Protection, 2.2.3 Protective Padding" },
      { title: "2020 FIA Appendix J Article 253, Chapter 8 (WMSC 09.10.2020)", relevantSections: "8.1-8.4 -- the document ARA RTR 2.2.2(c)(2) requires new-construction cages to comply with" },
    ],
    lastReviewed: "2026-08-04",
    logbookCutoffDate: "2009-01-01",
    cutoffNote: "Per ARA RTR 2.2.2(c)(2): logbooks issued after January 1, 2009 must be built to FIA Article 253 specifications (or be FIA homologated). Vehicles already log-booked to the older 2006 Rally America roll cage specifications remain valid subject to the additional requirements in RTR 2.2.2(c)(3).",
    notCoveredNote: "ARA's own RTR text is much shorter than NASA's -- it mostly points straight at the FIA document rather than re-describing configuration options. Unlike NASA, ARA's RTR does not restate the FIA mounting-plate area/thickness table, nor mandate a gusset weld-inspection corner cut. Those items are cited to the base FIA document only, not to an ARA-specific rule. ARA also does not offer NASA's non-FIA MRC-4 (halo hoop) or RB-4 (roof) options, and does not have a NASA-style scrutineer-preapproved stock-car door bar allowance.",
    paths: {
      new_construction: {
        label: "New Construction",
        appliesWhen: "Logbook to be issued on or after 2009-01-01",
        reference: "ARA RTR 2.2.2(c)(2)",
        note: "A cage that is FIA/ASN homologated and unmodified from its homologation, with original certification documentation, is exempt from the remainder of this checklist -- it must instead match its FIA homologation papers exactly. Note that ARA RTR 2.2.2(c)(4) states no bolt-together cages are allowed \"regardless of homologation status\" -- unlike NASA, this specific rule is not waived even on the homologated route, so it's worth confirming separately if you pick that route.",
        elements: ARA_NEW_CONSTRUCTION_ELEMENTS,
      },
      grandfathered: {
        label: "Existing Logbook (2006 Rally America Spec)",
        appliesWhen: "Logbook issued before 2009-01-01, roll cage built to 2006 Rally America roll cage specifications",
        reference: "ARA RTR 2.2.2(c)(3)",
        note: "ARA's grandfathering provision is narrower than NASA's: it applies specifically to vehicles with roll cages built to the 2006 Rally America roll cage specifications, which remain valid for competition \"until further notice\" subject to four additional requirements below. ARA's RTR does not otherwise describe the 2006 Rally America spec itself, so the base structure is checked only for presence here, not against a specific rule text.",
        elements: [
          {
            id: "base_structure_2006_ra",
            name: "2006 Rally America-spec structure present",
            category: "structure",
            requirement: "required",
            reference: "ARA RTR 2.2.2(c)(3) (base structure per the 2006 Rally America roll cage specifications, not reproduced here)",
            description: "A recognizable rollcage structure built to the 2006 Rally America roll cage specifications is present. This checklist doesn't have that 2006 document's own text -- confirm the base structure's validity with an ARA scrutineer directly.",
            evaluationType: "attestation",
            visuallyVerifiable: false,
            hardFail: true,
            hardFailMessage: "No identifiable 2006 Rally America-spec rollcage structure, or its validity hasn't been confirmed with a scrutineer.",
          },
          {
            id: "sill_and_extra_door_bar",
            name: "Sill bar + extra door bar (each side)",
            category: "structure",
            requirement: "required",
            reference: "ARA RTR 2.2.2(c)(3)(i)",
            description: "A sill bar and at least one additional door bar is required on each side.",
            evaluationType: "boolean",
            diagram: "sillbar",
            tubing: [{ classification: "minimum", label: "Sill bar / extra door bar tubing", reference: "ARA RTR 2.2.2(c)(3)(iv)", options: ARA_ADDON_TUBING }],
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Missing sill bar or additional door bar on one or both sides.",
          },
          {
            id: "main_hoop_corner_diagonals",
            name: "Diagonals to top corners of main hoop",
            category: "structure",
            requirement: "required",
            reference: "ARA RTR 2.2.2(c)(3)(ii)",
            description: "Diagonals to each corner of the top of the main hoop are required, whether located in the plane of the main hoop or the rear backstays.",
            evaluationType: "boolean",
            diagram: "253-7",
            tubing: [{ classification: "minimum", label: "Diagonal tubing", reference: "ARA RTR 2.2.2(c)(3)(iv)", options: ARA_ADDON_TUBING }],
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Missing diagonal bracing to one or both top corners of the main hoop.",
          },
          {
            id: "windscreen_support_each_side",
            name: "Windscreen support (each side)",
            category: "structure",
            requirement: "required",
            reference: "ARA RTR 2.2.2(c)(3)(iii)",
            description: "A windscreen support is required on each side, running from the front cage foot (within 4 inches of it) to within 6 inches of the transverse windshield bar.",
            evaluationType: "boolean",
            diagram: "253-15",
            tubing: [{ classification: "minimum", label: "Windscreen support tubing", reference: "ARA RTR 2.2.2(c)(3)(iv)", options: ARA_ADDON_TUBING }],
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Windscreen support missing on one or both sides, or doesn't meet the specified span.",
          },
          {
            id: "mounting_method",
            name: "Mounting method",
            category: "mounting",
            requirement: "required",
            reference: "ARA RTR 2.2.2(c)(4)",
            description: "All roll cages must be fully welded at all joints. Cages with bolt-together design members are not allowed, regardless of homologation status -- this applies to every ARA car, including this grandfathered path.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Bolt-together cage construction found -- not allowed under ARA rules regardless of vintage or homologation status.",
          },
          {
            id: "padding_helmet_grandfathered",
            name: "Helmet-contact padding",
            category: "padding",
            requirement: "required",
            reference: "ARA RTR 2.2.3",
            description: "All tubing forward of and including the main hoop in the roofline must be padded. Any other tubing which may contact the helmet while seated must also be padded. Must comply with FIA 8857-2001 type A or SFI 45.1 specification.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Roofline tubing forward of/including the main hoop is not padded, or another helmet-contact tube lacks padding.",
          },
        ],
      },
    },
  };

  const CARS_RULES = {
    org: "CARS",
    orgFullName: "Canadian Association of Rallysport (CRC)",
    sourceDocuments: [
      { title: "2026-03 CARS Rule Book, Technical Rules Section 12", relevantSections: "12.3.2 Roll Over Protection, 12.3.2.6 Protective Padding" },
      { title: "CARS Appendix: Rollcages January 1, 2000 to December 31, 2008 (grandfathering reference)", relevantSections: "Full document" },
      { title: "CARS Appendix: Rollcages up to January 1, 2000 (grandfathering reference, not separately modeled here)", relevantSections: "Noted for awareness only" },
      { title: "2020 FIA Appendix J Article 253, Chapter 8 (WMSC 09.10.2020)", relevantSections: "8.1-8.4 -- the document CARS NRR 12.3.2 requires new-construction cages to comply with" },
    ],
    lastReviewed: "2026-08-04",
    logbookCutoffDate: "2009-01-01",
    cutoffNote: "Per CARS NRR 12.3.2.3: log books issued after January 1, 2009 must be fitted with a safety cage built to FIA Article 253 specifications or FIA homologated. The grandfathered path here covers CARS's own 2000-2008 appendix; cars log-booked before January 1, 2000 follow an even older, distinctly different standard not fully modeled in this checklist (see the grandfathered path's note).",
    notCoveredNote: "CARS's own rule text (as sourced here) does not mention a Docol R8 tubing alternate the way ARA and NASA do, and does not restate an FIA-253-style blanket ban on bolted/dismountable joints for new construction -- so neither is asserted here for CARS. It does add two things neither ARA nor NASA state: body-contact padding is worded as mandatory (\"must be provided\"), not just recommended, and initial log book inspection requires a physical tube sample (per tube size used, 45cm long, bent 60 degrees) plus a material certificate or purchase receipt.",
    paths: {
      new_construction: {
        label: "New Construction",
        appliesWhen: "Logbook to be issued on or after 2009-01-01",
        reference: "CARS NRR 12.3.2.3",
        note: "A cage that is FIA/ASN homologated and unmodified from its homologation is exempt from the remainder of this checklist -- it must instead match its FIA homologation papers exactly.",
        elements: CARS_NEW_CONSTRUCTION_ELEMENTS,
      },
      grandfathered: {
        label: "Existing Logbook (2000-2008 Appendix)",
        appliesWhen: "Logbook issued before 2009-01-01",
        reference: "CARS Appendix: Rollcages January 1, 2000 to December 31, 2008",
        note: "This checklist models CARS's 2000-2008 grandfathering appendix, which is a complete standalone specification (not a short add-on list like ARA's). Cars log-booked before January 1, 2000 follow an even older, materially different standard (weight-based single tubing size, main hoop + front hoop + backstays + a required lower sill bar, no stated door-bar or diagonal-member requirement) that is not modeled here -- consult a CARS scrutineer directly for those. Both eras also allow an alternate-material/alternate-design path via a certified engineering stress test (1.5g lateral, 5.5g fore-aft, 7.5g vertical), not modeled as a checklist item here.",
        elements: [
          {
            id: "base_structure_present",
            name: "Base structure present",
            category: "structure",
            requirement: "required",
            reference: "Appendix 29.1.4-29.1.5",
            description: "A structural framework of main rollbar + front rollbar (or main rollbar + two lateral rollbars), their connecting members, diagonal members, backstays, and mounting points. Rollbars must be one continuous piece per hoop, smooth and even, cold-bent with a centerline bend radius at least 3x the tube diameter.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No identifiable rollcage base structure.",
          },
          {
            id: "backstays_gf",
            name: "Backstays",
            category: "structure",
            requirement: "required",
            reference: "Appendix 29.1.10",
            description: "Compulsory. Attached near the roofline and top outer bends of the main rollbar, at least 30 degrees from vertical, running rearward, straight, close to the interior side panels. Mountings reinforced by plates of at least 60cm2 each (or a single bolt in double shear with a welded sleeve).",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Backstays missing, under 30 degrees from vertical, or mounting reinforcement plates undersized.",
          },
          {
            id: "diagonal_members_gf",
            name: "Diagonal members",
            category: "structure",
            requirement: "required",
            reference: "Appendix 29.1.11",
            description: "Graduated requirement within this era: at least one diagonal is the baseline minimum for all cars in this era; two diagonals (in the main hoop or the backstays) are mandatory for logbooks issued after January 1, 2002; and for logbooks issued after January 1, 2007, both diagonals must specifically be in the main hoop. Where two members meet, the connection must be gusseted.",
            evaluationType: "choice",
            options: [
              { id: "two_main_hoop", label: "Two diagonals, both in the main hoop (meets the post-2007 standard)", outcome: "pass" },
              { id: "two_either_plane", label: "Two diagonals, in main hoop and/or backstays (meets the post-2002 standard)", outcome: "pass" },
              { id: "one_diagonal", label: "One diagonal only (era baseline minimum)", outcome: "pass" },
              { id: "none", label: "No diagonal present", outcome: "fail" },
            ],
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No diagonal member present, or the count/location doesn't meet the standard applicable to this logbook's issue date.",
          },
          {
            id: "roof_bars_gf",
            name: "Roof reinforcement bar(s)",
            category: "structure",
            requirement: "required",
            reference: "Appendix 29.1.12",
            description: "Effective January 1, 2007, all vehicles in this era must have at least one roof reinforcement bar. Vehicles with logbooks issued after January 1, 2007 must have two roof reinforcement bars.",
            evaluationType: "choice",
            options: [
              { id: "two_bars", label: "Two roof reinforcement bars (meets the post-2007-logbook standard)", outcome: "pass" },
              { id: "one_bar", label: "One roof reinforcement bar", outcome: "pass" },
              { id: "none", label: "No roof reinforcement bar present", outcome: "fail" },
            ],
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No roof reinforcement bar present (required for all cars in this era effective Jan 1, 2007).",
          },
          {
            id: "door_bars_present_gf",
            name: "Door bars",
            category: "structure",
            requirement: "required",
            reference: "Appendix 29.1.9",
            description: "One or more longitudinal members fitted at each side of the vehicle. May be removable. Upper attachment point must not be higher than half the door-opening height.",
            evaluationType: "boolean",
            diagram: "253-9",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No door bars present.",
          },
          {
            id: "mounting_feet_gf",
            name: "Mounting feet",
            category: "mounting",
            requirement: "required",
            reference: "Appendix 29.1.14",
            description: "Minimum one mounting point per leg of the main/lateral rollbar, per front-rollbar leg, and per backstay. Each foot: reinforcement plate at least 3mm thick, at least 3 bolts, at least 120cm2 area, welded to the bodyshell.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "Fewer than the minimum mounting points, or plates don't meet the size/thickness/bolt requirements.",
          },
          {
            id: "gusset_bends_joints_gf",
            name: "Gussets at bends and joints",
            category: "gussets",
            requirement: "required",
            reference: "Appendix 29.1.15",
            description: "Gussets or corner braces required joining the front continuous tubing (front rollbar or lateral rollbar) and any brace tubing. Gusset thickness must equal the cage tube wall thickness, minimum 5cm long where contacting the tube, welded along the full length, corners relieved for weld inspection.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: false,
          },
          {
            id: "door_aperture_gf",
            name: "Minimum door aperture",
            category: "structure",
            requirement: "conditional",
            reference: "Appendix 29.1.17",
            description: "For logbooks issued after January 1, 2002: the cage's presence in the door aperture must meet dimensional limits (A >= 300mm, B <= 250mm, C <= 300mm, D <= 100mm from the upper windscreen corner, E <= half the door aperture height). Requires direct measurement, not a photo estimate.",
            evaluationType: "attestation",
            visuallyVerifiable: false,
            hardFail: false,
          },
          {
            id: "windscreen_aperture_gf",
            name: "Minimum windscreen aperture",
            category: "structure",
            requirement: "conditional",
            reference: "Appendix 29.1.18",
            description: "For logbooks issued after January 1, 2003: in frontal projection, reinforcements of bends/junctions at the upper corners of the front roll-cage must be visible only through the windscreen area (per the referenced drawing).",
            evaluationType: "attestation",
            visuallyVerifiable: false,
            hardFail: false,
          },
          {
            id: "tubing_gf",
            name: "Tubing material and size",
            category: "material",
            requirement: "required",
            reference: "Appendix 29.1.13",
            description: "Highly recommended for all events, but required for FIA-sanctioned championship events: CDS or DOM unalloyed carbon steel per the primary/secondary table below. For all other CARS classes and events, a simpler flat spec (1.75in x 0.12in for every part of the cage) is also acceptable.",
            evaluationType: "boolean",
            tubing: [
              { classification: "primary", label: "Main rollbar / lateral rollbar tubing", reference: "Appendix 29.1.13", options: CARS_GF_PRIMARY_TUBING },
              { classification: "secondary", label: "Lateral half-rollbars and other cage parts", reference: "Appendix 29.1.13", options: CARS_GF_SECONDARY_TUBING },
            ],
            visuallyVerifiable: false,
            hardFail: false,
          },
          {
            id: "padding_helmet_gf",
            name: "Helmet-contact padding",
            category: "padding",
            requirement: "required",
            reference: "Appendix 29.1.8",
            description: "Padding to FIA 8857-2001 type A wherever an occupant's crash helmet could contact the cage.",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No certified padding at helmet-contact locations.",
          },
          {
            id: "padding_body_gf",
            name: "Body-contact padding",
            category: "padding",
            requirement: "required",
            reference: "Appendix 29.1.8",
            description: "Flame-retardant padding must be provided wherever an occupant's body could come into contact with the safety cage (stated as mandatory in this appendix, not merely recommended).",
            evaluationType: "boolean",
            visuallyVerifiable: true,
            hardFail: true,
            hardFailMessage: "No flame-retardant padding at locations where an occupant's body could contact the cage.",
          },
        ],
      },
    },
  };

  window.RULES_DATA = {
    nasa: {
      org: "NASA",
      orgFullName: "NASA Rally Sport",
      sourceDocuments: [
        { title: "NASA Rally Sport General Regulations for Rallies, Section 3: Technical Regulations for Cars", version: "16.0", relevantSections: "3.7 Roll Cage / Rollover Protection, 3.8 Roll Cage Protective Padding" },
        { title: "NASA Rally Sport GRR Appendix B: Roll Cage Grandfathering Requirements", relevantSections: "Full document (current rules + 2014 attachment for element definitions)" },
        { title: "2020 FIA Appendix J Article 253, Chapter 8 (WMSC 09.10.2020)", relevantSections: "8.1-8.4 -- the document NRS GRR 3.7.2 requires new-construction cages to comply with" },
      ],
      lastReviewed: "2026-08-04",
      logbookCutoffDate: "2025-01-01",
      cutoffNote: "Per NRS GRR 3.7.2/3.7.5: logbooks issued on or after Jan 1, 2025 must meet the 'new construction' path. Logbooks issued before Dec 31, 2024 may use the 'grandfathered' path, but at minimum must satisfy the current GRR Appendix B conditions regardless of which of the six acceptable-existing-logbook categories applies.",
      notCoveredNote: "This checklist covers what's explicitly stated across the three source documents above. Detailed FIA figures not central to a pass/fail call (exact dismountable-joint hardware figures 253-37 to 253-47, seat/harness mounting figures, tow points, etc.) are not reproduced here -- consult the FIA document directly for those.",
      paths: {
        new_construction: {
          label: "New Construction",
          appliesWhen: "Logbook to be issued on or after 2025-01-01",
          reference: "NRS GRR 3.7.2",
          note: "A cage that is FIA/ASN homologated and unmodified from its homologation is exempt from the remainder of this checklist (NRS GRR 3.7.2(1)) -- it must instead match its FIA homologation papers exactly. The checklist below applies to the second path: fabricated to 2020 FIA Appendix J Article 253 Chapter 8 using NASA-acceptable materials (NRS GRR 3.7.2(2)).",
          elements: NASA_NEW_CONSTRUCTION_ELEMENTS,
        },
        grandfathered: {
          label: "Grandfathered / Existing Logbook",
          appliesWhen: "Logbook issued before 2024-12-31",
          reference: "NRS GRR 3.7.5 and current GRR Appendix B",
          note: "NRS GRR 3.7.5 lists six acceptable categories for an existing logbook (FIA-homologated, built to the FIA 253 Ch.8 edition current when the logbook was issued, modified to current new-construction standards, built to the full 2014 Appendix B, logbooked under a since-lapsed sanctioning body meeting current grandfathering conditions, or accepted under alternate technical regulations per GRR 3.11.5). Regardless of category, current GRR Appendix B states the cage must AT MINIMUM satisfy the conditions below. Per-element tubing sizing for older/varied construction standards isn't tabulated here -- consult the FIA Chapter 8 edition current when the logbook was issued, or the 2014 Appendix B attachment, for that car's specific era.",
          elements: [
            {
              id: "prior_compliance",
              name: "Prior compliance evidence",
              category: "documentation",
              requirement: "required",
              reference: "Appendix B condition 1",
              description: "Vehicle was compliant with its original ruleset at some point, typically evidenced by having run at least one event under the original sanctioning organization (applies to cars from orgs that no longer maintain a stage rally ruleset, e.g. SCCA Pro Rally, Rally America).",
              evaluationType: "attestation",
              visuallyVerifiable: false,
              hardFail: false,
            },
            {
              id: "main_structure_present",
              name: "Main structure present",
              category: "structure",
              requirement: "required",
              reference: "Foundational -- Appendix B Element 1 definitions (2014 attachment, reference only)",
              description: "A recognizable main rollcage structure is present (main rollbar + lateral or lateral-half rollbars + backstays, or the 2014 attachment's MRC-4 halo-hoop variant). Grandfathering rules describe minimum add-ons to an existing structure; they presuppose a base structure exists.",
              evaluationType: "boolean",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "No identifiable rollcage main structure.",
            },
            {
              id: "diagonals_minimum",
              name: "Minimum diagonals",
              category: "structure",
              requirement: "required",
              reference: "Appendix B condition 2",
              description: "At least one diagonal in the plane of the main hoop (or rear legs of the lateral rollbars) AND at least one diagonal in the plane of the rear backstays. Must comply with the 2014 attachment's Elements 3/4 detail (253-5/253-6/253-7 for the main hoop; 253-20/253-21/253-22 for backstays), or with 2020 FIA App J 253 Ch.8 main-rollbar/backstay diagonal rules (253-7 and 253-20/253-21/253-22).",
              evaluationType: "boolean",
              diagram: "253-7",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "Missing a main-hoop-plane diagonal, a backstay-plane diagonal, or both.",
            },
            {
              id: "door_bars_present",
              name: "Door bars",
              category: "structure",
              requirement: "required",
              reference: "Appendix B condition 3 (Element 7)",
              description: "Door bars (any Element 7 configuration -- 253-9, 253-10, or 253-11 style) must be present on all grandfathered cars.",
              evaluationType: "boolean",
              diagram: "253-9",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "No door bars present.",
            },
            {
              id: "roof_bar_or_windshield_gusset",
              name: "Roof bars, or windshield-bar gusset if absent",
              category: "structure",
              requirement: "conditional",
              reference: "Appendix B condition 4",
              description: "If the car does NOT have roof bars (Element 2), it must instead have at least one gusset per side at the intersection of the windshield bar and the side half-laterals (gusset may sit in front of or behind the windshield tube).",
              evaluationType: "choice",
              options: [
                { id: "has_roof_bars", label: "Roof bars (Element 2) present -- condition satisfied", diagram: "253-12", outcome: "pass" },
                { id: "no_roof_bars_gusseted", label: "No roof bars, but windshield-bar gusset present each side", diagram: "gusset", outcome: "pass" },
                { id: "no_roof_bars_no_gusset", label: "No roof bars and no windshield-bar gusset", outcome: "fail" },
              ],
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "No roof bars and no windshield-bar gusset at the side-half-lateral intersections.",
            },
            {
              id: "a_pillar_reinforcement_grandfathered",
              name: "A-pillar reinforcement",
              category: "structure",
              requirement: "required",
              reference: "Appendix B conditions 5 & 7 (Element 6)",
              description: "A-pillar reinforcement (Element 6) is required on all cars as of January 1, 2025, including cars previously grandfathered/homologated without it.",
              evaluationType: "boolean",
              diagram: "253-15",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "A-pillar reinforcement missing (required for all cars since Jan 1, 2025).",
            },
            {
              id: "no_bolt_together",
              name: "No bolt-together cage",
              category: "mounting",
              requirement: "required",
              reference: "Appendix B condition 6",
              description: "Bolt-together cages, and cages that were previously welded-then-converted to bolt-together, are no longer accepted as of December 31, 2024.",
              evaluationType: "boolean",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "Cage uses bolt-together construction -- no longer accepted since Dec 31, 2024.",
            },
            {
              id: "tubing_size_scca_exception",
              name: "Tubing size (SCCA exception)",
              category: "material",
              requirement: "exception",
              reference: "Appendix B condition 8",
              description: "Roll cage tubing sizes previously accepted under SCCA Pro Rally rules remain acceptable ONLY for cars with an SCCA logbook issued before January 1, 2005. Otherwise the tubing must meet the NRS GRR 3.7.3 material/size table (see the new-construction checklist for the per-element primary/secondary breakdown of that table).",
              evaluationType: "choice",
              options: [
                { id: "scca_pre_2005", label: "SCCA logbook issued before Jan 1, 2005 -- SCCA sizing accepted", outcome: "pass" },
                { id: "meets_nrs_table", label: "Meets current NRS GRR 3.7.3 material/size table", outcome: "pass" },
                { id: "neither", label: "Neither -- tubing size/material not verified", outcome: "fail" },
              ],
              visuallyVerifiable: false,
              hardFail: true,
              hardFailMessage: "Tubing size does not meet the current NRS material table and no qualifying pre-2005 SCCA logbook exception applies.",
            },
            {
              id: "padding_helmet_grandfathered",
              name: "Helmet-contact padding",
              category: "padding",
              requirement: "required",
              reference: "Appendix B 5.2",
              description: "Padding to FIA 8857-2001 type A or B, or SFI 45.1, wherever an occupant's helmet could contact the cage.",
              evaluationType: "boolean",
              visuallyVerifiable: true,
              hardFail: true,
              hardFailMessage: "No certified padding at helmet-contact locations.",
            },
            {
              id: "padding_body_grandfathered",
              name: "Body-contact padding",
              category: "padding",
              requirement: "recommended",
              reference: "Appendix B 5.3",
              description: "Padding recommended anywhere an occupant's body (especially lower legs) could contact the cage.",
              evaluationType: "boolean",
              visuallyVerifiable: true,
              hardFail: false,
            },
            {
              id: "sill_bar_note",
              name: "Sill bar",
              category: "structure",
              requirement: "informational",
              reference: "2014 Appendix B Element 5 (attachment, for reference)",
              description: "The 2014 Appendix B attachment lists sill bars as required (Element 5), and is one of the six acceptable existing-logbook categories if a car was fully built/logbooked to that 2014 document. The current Appendix B's universal minimum (conditions 1-8) does not separately re-list the sill bar as mandatory for every grandfathered car outside that specific pathway. Flagged here for awareness rather than as a scored requirement.",
              evaluationType: "boolean",
              diagram: "sillbar",
              visuallyVerifiable: true,
              hardFail: false,
            },
          ],
        },
      },
    },
    ara: ARA_RULES,
    cars: CARS_RULES,
  };
})();
