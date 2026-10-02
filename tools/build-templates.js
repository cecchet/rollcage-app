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

// Rollcage pictures for a template: [file in images/templates/<id>/, picture category].
const pics = (id, list) => list.map(([file, category]) => ({ src: "images/templates/" + id + "/" + file, category }));

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
  { group: "design", id: "rally-cage-double-v", file: "Rally cage 1.json", name: "Rally cage double V" },
  // Custom Cages' own diagrams don't match their installed cages, so only
  // the installation photos are used as pictures.
  {
    group: "kit", id: "subaru-vab-custom-cages", file: "Custom Cages Subaru VAB.json",
    source: { label: "Custom Cages", url: "https://customcages.co.uk/products/subaru-impreza-vab-international-multipoint-t45-roll-cage-kit-fia-certificated", thumbnail: "images/templates/subaru-vab-custom-cages.jpg" },
    pictures: pics("subaru-vab-custom-cages", [
      ["4.jpg", "overview"], ["5.jpg", "overview"], ["6.jpg", "overview"], ["7.jpg", "overview"],
      ["8.jpg", "roof_bars"],
      ["3.jpg", "door_bars_left"],
      ["2.jpg", "door_bars_right"], ["9.jpg", "door_bars_right"],
    ]),
  },
  {
    group: "kit", id: "ford-fiesta-mk6-custom-cages", file: "Custom Cages Ford Fiesta Mk6.json",
    source: { label: "Custom Cages", url: "https://customcages.co.uk/products/ford-fiesta-mk-6-junior-international-multipoint-cds-roll-cage-kit-fia-msuk-certificated", thumbnail: "images/templates/ford-fiesta-mk6-custom-cages.jpg" },
    pictures: pics("ford-fiesta-mk6-custom-cages", [
      ["6.jpg", "overview"],
      ["4.jpg", "main_rollbar"], ["7.jpg", "main_rollbar"],
      ["8.jpg", "roof_bars"],
      ["3.jpg", "door_bars_left"], ["5.jpg", "door_bars_left"],
      ["2.jpg", "door_bars_right"],
    ]),
  },
  {
    group: "kit", id: "subaru-gc-broken-motorsports", file: "Broken Motorsports Subaru GC.json",
    source: { label: "Broken Motorsports", url: "https://bleedingtarmac.com/products/broken-motorsports-subaru-gc-roll-cage-kit", thumbnail: "images/templates/subaru-gc-broken-motorsports.jpg" },
    // Only the kit's diagrams (3D line drawing, general arrangement sheet,
    // 4-view drawing).
    pictures: pics("subaru-gc-broken-motorsports", [["1.jpg", "overview"], ["2.jpg", "overview"], ["3.jpg", "overview"]]),
  },
  {
    group: "kit", id: "mazda-mx5-cagekits", file: "CageKits Mazda MX-5 Miata.json",
    source: { label: "CageKits", url: "https://cagekits.org/product/mx-5-miata-road-race-roll-cage-kit/", thumbnail: "images/templates/mazda-mx5-cagekits.jpg" },
    // CageKits' renders (used with permission).
    pictures: pics("mazda-mx5-cagekits", [
      ["1.jpg", "overview"], ["2.jpg", "overview"], ["3.jpg", "overview"], ["4.jpg", "overview"],
      ["5.jpg", "roof_bars"],
    ]),
  },
  {
    group: "kit", id: "datsun-240z-cagekits", file: "CageKits Datsun 240Z NHRA.json",
    source: { label: "CageKits", url: "https://cagekits.org/product/240z-nhra-8-5-chromoly-roll-cage-kit/", thumbnail: "images/templates/datsun-240z-cagekits.jpg" },
    pictures: pics("datsun-240z-cagekits", [
      ["1.jpg", "overview"], ["3.jpg", "overview"], ["4.jpg", "overview"],
      ["5.jpg", "roof_bars"],
    ]),
  },
  // The Porsche replaces the former "Road racing" template. Rally cage 2.json
  // (double X) is no longer listed; it's still the base the kit samples
  // were derived from.
  { group: "sample", id: "porsche-gt3-cup", file: "Porsche GT3 Cup Car.json", withPictures: true },
  { group: "sample", id: "audi-rs4-rally", file: "RS4 Rally car.json", withPictures: true },
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
  (t.pictures || []).forEach((p) => {
    if (!fs.existsSync(path.join(__dirname, "..", p.src))) throw new Error("Missing template picture " + p.src);
  });
  const answers = {};
  Object.entries(d.answers || {}).forEach(([k, v]) => { if (!DROPPED_ANSWERS.test(k)) answers[k] = { ...v, photos: [] }; });
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
