// Regenerates app/templates.js (the Rollcage library's built-in design
// templates) from the rollcage exports in ../design-samples. Every answer's
// photo is stripped, the logbook date cleared and no sanctioning body set.
// A template based on a vendor's kit can list rollcage pictures (served from
// images/templates/<id>/, used with the vendor's permission) -- they're
// loaded into the new rollcage's Pictures when starting from it.
// Run from anywhere:  node app/tools/build-templates.js
const fs = require("fs");
const path = require("path");

const SAMPLES_DIR = path.join(__dirname, "..", "..", "design-samples");
const OUT_FILE = path.join(__dirname, "..", "templates.js");

// Rollcage pictures for a template: [file in images/templates/<id>/, picture
// category, optional tagged elements ([elementId, value, extra?] -- extra
// e.g. { sill_bar: "yes" } on a door bar)].
const pics = (id, list) => list.map(([file, category, tags]) => ({
  src: "images/templates/" + id + "/" + file, category,
  ...(tags ? { elements: tags.map(([elementId, value, extra]) => ({ elementId, value, extra: extra || {} })) } : {}),
}));

// Listed in library order, grouped into the library's sections by `group`:
// "design" (Design templates), "kit" (Rollcage kits -- based on a vendor's
// kit: the card links to its product page, with a snapshot of that page as
// thumbnail) and "sample" (Race car samples -- real cars' exports). All of
// them behave as templates. `name` overrides the export's own vehicle name.
// `withPictures`: the export's own rollcage pictures (with their tags) and
// vehicle photos are extracted to images/templates/<id>/ and loaded when
// starting from it.
const TEMPLATES = [
  { group: "design", id: "half-rollcage", file: "Rollbar _ half rollcage.json" },
  // A generic design -- the sample car's own vehicle details (an Audi RS4)
  // are left out; its measurements stay.
  {
    group: "design", id: "rally-cage-double-v", file: "Rally cage 1.json", name: "FIA Article 253 App J cage",
    dropAnswers: ["vehicle_manufacturer", "vehicle_model", "vehicle_year", "vehicle_builder", "vehicle_weight"],
  },
  // The VAB's diagram (1.jpg) matches its installation photos; the
  // Fiesta's doesn't, so it only gets the photos.
  {
    group: "kit", id: "subaru-vab-custom-cages", file: "Custom Cages Subaru VAB.json",
    source: { label: "Custom Cages", url: "https://customcages.co.uk/products/subaru-impreza-vab-international-multipoint-t45-roll-cage-kit-fia-certificated", thumbnail: "images/templates/subaru-vab-custom-cages.jpg" },
    pictures: pics("subaru-vab-custom-cages", [
      // The diagram: every element of the cage.
      ["1.jpg", "overview", [
        ["main_hoop_diagonals", "253-7-2"], ["backstays", "yes"], ["backstay_diagonals", "253-22"], ["roof_bars", "253-14"],
        ["door_bars_left", "253-9-intersection-1"], ["door_bars_right", "253-9-intersection-1"],
        ["harness_bar_present", "253-26-27"], ["rear_lateral_reinforcement_present", "lower"], ["dash_bar_present", "yes"],
        ["temple_bar_present", "both"], ["windshield_reinforcement_present", "both"],
        ["gusset_design__main_hoop_diag_upper__design", "taco"], ["gusset_design__main_hoop_diag_lower__design", "taco"],
        ["gusset_design__door_front_left__design", "taco"], ["gusset_design__door_rear_left__design", "taco"],
        ["gusset_design__door_front_right__design", "taco"], ["gusset_design__door_rear_right__design", "taco"],
        ["gusset_design__a_pillar_left__design", "single_plate"], ["gusset_design__a_pillar_right__design", "single_plate"],
        ["a_pillar_reinforcement", "continuous"],
        ["gusset_design__a_pillar_side_left__design", "taco"], ["gusset_design__a_pillar_side_right__design", "taco"],
      ]],
      ["4.jpg", "overview"], ["5.jpg", "overview"], ["6.jpg", "overview"], ["7.jpg", "overview"],
      ["8.jpg", "roof_bars"],
      ["3.jpg", "door_bars_left"],
      ["2.jpg", "door_bars_right"], ["9.jpg", "door_bars_right"],
    ]),
  },
  {
    group: "kit", id: "ford-fiesta-mk6-custom-cages", file: "Custom Cages Ford Fiesta Mk6.json",
    source: { label: "Custom Cages", url: "https://customcages.co.uk/products/ford-fiesta-mk-6-junior-international-multipoint-cds-roll-cage-kit-fia-msuk-certificated", thumbnail: "images/templates/ford-fiesta-mk6-custom-cages.jpg" },
    // Each installation photo tagged with the elements it shows.
    pictures: pics("ford-fiesta-mk6-custom-cages", [
      // A-pillar / windscreen close-up.
      ["6.jpg", "overview", [
        ["a_pillar_reinforcement", "continuous"], ["windshield_reinforcement_present", "both"],
        ["gusset_design__a_pillar_side_left__design", "taco"], ["gusset_design__a_pillar_side_right__design", "taco"],
        ["gusset_design__a_pillar_left__design", "single_plate"], ["gusset_design__a_pillar_right__design", "single_plate"],
      ]],
      // Through the hatch: main hoop and the rear of the cage.
      ["4.jpg", "main_rollbar", [
        ["main_hoop_diagonals", "253-7-2"], ["harness_bar_present", "253-26-27"],
        ["gusset_design__main_hoop_diag_upper__design", "taco"], ["gusset_design__main_hoop_diag_lower__design", "taco"],
        ["backstays", "yes"], ["backstay_diagonals", "253-22"],
        ["rear_lateral_reinforcement_present", "both"], ["rear_transversal_present", "yes"],
      ]],
      // Looking back at the main hoop.
      ["7.jpg", "main_rollbar", [
        ["main_hoop_diagonals", "253-7-2"], ["harness_bar_present", "253-26-27"],
        ["gusset_design__main_hoop_diag_upper__design", "taco"], ["gusset_design__main_hoop_diag_lower__design", "taco"],
      ]],
      // Roof.
      ["8.jpg", "roof_bars", [["roof_bars", "253-14"], ["main_hoop_diagonals", "253-7-2"]]],
      // Left side, with the front end.
      ["3.jpg", "door_bars_left", [
        ["door_bars_left", "253-9-intersection-1"],
        ["gusset_design__door_front_left__design", "taco"], ["gusset_design__door_rear_left__design", "taco"],
        ["a_pillar_reinforcement", "continuous"], ["windshield_reinforcement_present", "both"], ["dash_bar_present", "yes"],
      ]],
      ["5.jpg", "door_bars_left", [
        ["door_bars_left", "253-9-intersection-1"],
        ["gusset_design__door_front_left__design", "taco"], ["gusset_design__door_rear_left__design", "taco"],
        ["main_hoop_diagonals", "253-7-2"],
      ]],
      // Right door.
      ["2.jpg", "door_bars_right", [
        ["door_bars_right", "253-9-intersection-1"],
        ["gusset_design__door_front_right__design", "taco"], ["gusset_design__door_rear_right__design", "taco"],
        ["main_hoop_diagonals", "253-7-2"],
      ]],
    ]),
  },
  {
    group: "kit", id: "subaru-gc-broken-motorsports", file: "Broken Motorsports Subaru GC.json",
    source: { label: "Broken Motorsports", url: "https://bleedingtarmac.com/products/broken-motorsports-subaru-gc-roll-cage-kit", thumbnail: "images/templates/subaru-gc-broken-motorsports.jpg" },
    // Only the kit's diagrams (3D line drawing, general arrangement sheet,
    // 4-view drawing), each tagged with the bars -- their sheet notes the
    // gussets aren't drawn.
    pictures: pics("subaru-gc-broken-motorsports", ["1.jpg", "2.jpg", "3.jpg"].map((file) => [file, "overview", [
      ["main_hoop_diagonals", "253-7-2"], ["backstays", "yes"], ["backstay_diagonals", "253-21-1"], ["roof_bars", "253-12-1"],
      ["door_bars_left", "253-9-intersection-1", { sill_bar: "yes" }], ["door_bars_right", "253-9-intersection-1", { sill_bar: "yes" }],
      ["harness_bar_present", "253-26-27"], ["dash_bar_present", "yes"], ["temple_bar_present", "both"],
      ["a_pillar_reinforcement", "two_bars"],
    ]])),
  },
  {
    group: "kit", id: "mazda-mx5-cagekits", file: "CageKits Mazda MX-5 Miata.json",
    source: { label: "CageKits", url: "https://cagekits.org/product/mx-5-miata-road-race-roll-cage-kit/", thumbnail: "images/templates/mazda-mx5-cagekits.jpg" },
    // CageKits' renders (used with permission).
    pictures: pics("mazda-mx5-cagekits", [
      ["1.jpg", "overview"], ["2.jpg", "overview"], ["3.jpg", "overview"],
      // Cage-only render: every element of the cage.
      ["4.jpg", "overview", [
        ["main_hoop_diagonals", "diag-left"], ["backstays", "yes"], ["backstay_diagonals", "253-21-1"],
        ["roof_bars", "single-front-left"],
        ["door_bars_left", "253-9-intersection-1"], ["door_bars_right", "253-9-intersection-1"],
        ["harness_bar_present", "253-26-27"], ["dash_bar_present", "yes"],
        ["temple_bar_present", "both"], ["windshield_reinforcement_present", "both"],
        ["gusset_design__door_front_left__design", "taco"], ["gusset_design__door_rear_left__design", "taco"],
        ["gusset_design__door_front_right__design", "taco"], ["gusset_design__door_rear_right__design", "taco"],
      ]],
      ["5.jpg", "roof_bars"],
    ]),
  },
  {
    group: "kit", id: "datsun-240z-cagekits", file: "CageKits Datsun 240Z NHRA.json",
    source: { label: "CageKits", url: "https://cagekits.org/product/240z-nhra-8-5-chromoly-roll-cage-kit/", thumbnail: "images/templates/datsun-240z-cagekits.jpg" },
    pictures: pics("datsun-240z-cagekits", [
      ["1.jpg", "overview"], ["3.jpg", "overview"],
      // Cage-only render: every element of the cage.
      ["4.jpg", "overview", [
        ["main_hoop_diagonals", "diag-lower-half"], ["backstays", "yes"],
        ["door_bars_left", "253-11"], ["door_bars_right", "253-11"],
        ["harness_bar_present", "253-26-27"], ["dash_bar_present", "yes"],
      ]],
      ["5.jpg", "roof_bars"],
    ]),
  },
  {
    group: "kit", id: "bmw-e92-cagekits", file: "CageKits BMW E92 roll bar.json", subtitle: "Rollbar kit from CageKits",
    source: { label: "CageKits", url: "https://cagekits.org/product/e92-bolt-in-roll-bar-kit/", thumbnail: "images/templates/bmw-e92-cagekits.jpg" },
    pictures: pics("bmw-e92-cagekits", [
      ["1.jpg", "overview"], ["2.jpg", "overview"], ["3.jpg", "overview"],
      // Roll bar-only render: every element of the roll bar.
      ["4.jpg", "overview", [
        ["main_hoop_diagonals", "253-7-1"], ["backstays", "yes"], ["backstay_diagonals", "253-21-1"],
        ["harness_bar_present", "253-26-27"],
      ]],
      ["5.jpg", "roof_bars"],
    ]),
  },
  // The Porsche replaces the former "Road racing" template. Rally cage 2.json
  // (double X) is no longer listed; it's still the base the kit samples
  // were derived from.
  { group: "sample", id: "porsche-gt3-cup", file: "Porsche GT3 Cup Car.json", withPictures: true },
  // `subtitle` replaces the card's default line (here, "Custom cage sample").
  {
    group: "sample", id: "audi-rs4-rally", file: "RS4 Rally car.json", withPictures: true,
    subtitleLink: { before: "Rollcage by ", label: "CAS Competition", url: "https://www.facebook.com/cas.competition/" },
  },
  // 9hio cages: frames from 9hio's walk-around videos as pictures (and the
  // 3/4 front shot as the vehicle photo); the card links to 9hio.
  ...[
    ["brz-rally-9hio", "9hio Subaru BRZ rally.json", [["1.jpg", "door_bars_left"], ["2.jpg", "main_rollbar"], ["3.jpg", "backstay_diagonals"], ["4.jpg", "overview"], ["5.jpg", "door_bars_right"],
      // Looking up at the 253-14 roof, the 253-22 backstay V and the main hoop X.
      ["6.jpg", "roof_bars", [["roof_bars", "253-14"], ["backstay_diagonals", "253-22"], ["main_hoop_diagonals", "253-7-2"]]]]],
    ["subaru-sti-hillclimb-9hio", "9hio Subaru STI hillclimb.json", [["1.jpg", "overview"], ["2.jpg", "door_bars_left"],
      // From the rear: the 253-14 roof, the 253-22 backstay V and the main hoop X.
      ["3.jpg", "main_rollbar", [["roof_bars", "253-14"], ["backstay_diagonals", "253-22"], ["main_hoop_diagonals", "253-7-2"]]],
      ["4.jpg", "door_bars_right"]]],
    ["bmw-road-racing-9hio", "9hio BMW road racing.json", [["1.jpg", "door_bars_left"], ["2.jpg", "overview"], ["3.jpg", "main_rollbar"], ["4.jpg", "overview"],
      // Across the cabin: the 253-31 temple bars and windshield reinforcements.
      ["5.jpg", "overview", [["temple_bar_present", "both"], ["windshield_reinforcement_present", "both"]]]]],
    // The user's own frame grabs from the video.
    ["mustang-road-racing-9hio", "9hio Ford Mustang road racing.json", [
      ["1.jpg", "door_bars_left", [["door_bars_left", "253-9-intersection-1"], ["a_pillar_reinforcement", "continuous"]]],
      ["2.jpg", "main_rollbar", [["main_hoop_diagonals", "diag-left"], ["harness_bar_present", "253-26-27"]]],
      ["3.jpg", "door_bars_right", [["door_bars_right", "253-9-intersection-1"], ["a_pillar_reinforcement", "continuous"]]],
      ["4.jpg", "backstay_diagonals", [["backstays", "yes"], ["backstay_diagonals", "253-21-1"], ["main_hoop_diagonals", "diag-left"], ["harness_bar_present", "253-26-27"]]],
    ]],
  ].map(([id, file, list]) => ({
    group: "sample", id, file,
    subtitleLink: { before: "Rollcage by ", label: "9hio", url: "https://9hio.com/" },
    pictures: pics(id, list),
    vehiclePhotos: { front: "images/templates/" + id + "/vehicle-front.jpg" },
  })),
];

// Writes an export's data-URL image to images/templates/<id>/<name>.<ext>
// and returns its src (relative to the app).
function writeImage(id, name, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  const dir = path.join(__dirname, "..", "images", "templates", id);
  fs.mkdirSync(dir, { recursive: true });
  const file = name + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
  fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
  return "images/templates/" + id + "/" + file;
}
// An export's rollcage pictures (photo, tags, "Selected parts" snapshot)
// and 3/4 front/rear vehicle photos, as template pictures.
function exportPictures(t, d) {
  const images = d.images || {};
  const pictures = (d.pictures || []).map((p, i) => {
    const rec = images[p.id] || {};
    const src = writeImage(t.id, String(i + 1), rec.photo);
    if (!src) return null;
    const screenshot = p.hasScreenshot ? writeImage(t.id, (i + 1) + "-parts", rec.screenshot) : null;
    return {
      src, category: p.category || "overview",
      elements: p.elements || [], aiSuggestions: p.aiSuggestions || [],
      ...(screenshot ? { screenshot } : {}),
    };
  }).filter(Boolean);
  const vehiclePhotos = {};
  ["front", "rear"].forEach((slot) => {
    const ref = d.vehiclePhotos && d.vehiclePhotos[slot];
    const src = ref && writeImage(t.id, "vehicle-" + slot, (images[ref.id] || {}).photo);
    if (src) vehiclePhotos[slot] = src;
  });
  return { pictures, vehiclePhotos };
}
// Identifies one real car or person (VIN, owner / builder / inspector
// contacts, inspection and logbook details) -- never part of a template.
const DROPPED_ANSWERS = /^vehicle_(vin|owner_|builder_|inspector_|inspection_|logbook_|description_notes)/;

const out = TEMPLATES.map((t) => {
  const d = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, t.file), "utf8"));
  if (t.withPictures) {
    const fromExport = exportPictures(t, d);
    t.pictures = fromExport.pictures;
    if (Object.keys(fromExport.vehiclePhotos).length) t.vehiclePhotos = fromExport.vehiclePhotos;
  }
  // The library card shows a small copy of the front photo (made once,
  // 320px wide, as <id>/vehicle-front-card.jpg) rather than the full one.
  const cardPhoto = "images/templates/" + t.id + "/vehicle-front-card.jpg";
  if (t.vehiclePhotos && t.vehiclePhotos.front && fs.existsSync(path.join(__dirname, "..", cardPhoto))) t.cardPhoto = cardPhoto;
  (t.pictures || []).forEach((p) => {
    if (!fs.existsSync(path.join(__dirname, "..", p.src))) throw new Error("Missing template picture " + p.src);
  });
  const answers = {};
  Object.entries(d.answers || {}).forEach(([k, v]) => { if (!DROPPED_ANSWERS.test(k) && !(t.dropAnswers || []).includes(k)) answers[k] = { ...v, photos: [] }; });
  return {
    templateId: t.id,
    group: t.group || "design",
    // No sanctioning body by default -- picked in Part 6, like a new cage.
    vehicle: { ...d.vehicle, name: t.name || d.vehicle.name, org: "none", logbookDate: "" },
    pathId: d.pathId || "new_construction",
    answers,
    ...(t.source ? { source: t.source } : {}),
    ...(t.pictures ? { pictures: t.pictures } : {}),
    ...(t.vehiclePhotos ? { vehiclePhotos: t.vehiclePhotos } : {}),
    ...(t.subtitle ? { subtitle: t.subtitle } : {}),
    ...(t.subtitleLink ? { subtitleLink: t.subtitleLink } : {}),
    ...(t.cardPhoto ? { cardPhoto: t.cardPhoto } : {}),
  };
});

const header = `// Built-in design templates listed in the Rollcage library (see
// renderLibrary) -- GENERATED by tools/build-templates.js from the
// design-samples/*.json exports, with every answer's photo stripped (no
// vehicle photos or homologation paperwork). A vendor-kit template may list
// rollcage pictures, loaded when starting from it. Starting from one opens
// an unsaved copy under a fresh sessionId; the template itself is never
// modified. Don't edit by hand -- re-run the script instead.
`;
fs.writeFileSync(OUT_FILE, header + "window.ROLLCAGE_TEMPLATES = " + JSON.stringify(out) + ";\n");
console.log("Wrote " + out.length + " templates: " + out.map((t) => t.vehicle.name + (t.pictures ? " (" + t.pictures.length + " pictures)" : "")).join(", "));
