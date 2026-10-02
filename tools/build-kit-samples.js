// Builds the design-samples/*.json files for the "Rollcage kits" templates
// (Custom Cages, Broken Motorsports, CageKits) from a base sample --
// "Rally cage 2.json" for full cages, "Rollbar _ half rollcage.json" for a
// roll bar: every kit starts from that sample's answers (feet, gussets,
// welds, distances...), overrides its own design answers below, and drops
// every personal / logbook field. Run it after editing a kit, then
// tools/build-templates.js to regenerate templates.js:
//   node app/tools/build-kit-samples.js && node app/tools/build-templates.js
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "..", "design-samples") + path.sep;
const loadSample = (file) => JSON.parse(fs.readFileSync(dir + file, "utf8"));
const CAGE_BASE = "Rally cage 2.json";
const ROLLBAR_BASE = "Rollbar _ half rollcage.json";
const PERSONAL = /^vehicle_(owner|builder_|inspector|inspection|logbook|description_notes)/;

// baseAnswer(key, answer), if given, rewrites each of the base's answers
// (returning undefined drops it) before the overrides apply.
function make(file, name, overrides, baseFile, baseAnswer) {
  const base = loadSample(baseFile || CAGE_BASE);
  const answers = {};
  Object.entries(base.answers).forEach(([k, v]) => {
    if (PERSONAL.test(k) || k === "vehicle_logbook_body") return;
    const copy = JSON.parse(JSON.stringify(v));
    const kept = baseAnswer ? baseAnswer(k, copy) : copy;
    if (kept !== undefined) answers[k] = kept;
  });
  Object.entries(overrides).forEach(([k, v]) => {
    if (v === undefined) delete answers[k];
    else answers[k] = Object.assign({ note: "", photos: [], extra: {} }, answers[k] || {}, v);
  });
  const out = { sessionId: "template-" + file.replace(/\W+/g, "-").toLowerCase(), vehicle: { name, org: "none", logbookStatus: "new", logbookDate: "" }, pathId: base.pathId, answers };
  fs.writeFileSync(dir + file, JSON.stringify(out, null, 2));
  console.log("wrote", file, Object.keys(answers).length, "answers");
}

const common = {
  // Not on either kit
  anti_intrusion_present: { value: "no" },
  temple_bar_present: { value: "none" },
  windshield_reinforcement_present: { value: "none" },
  rear_lateral_reinforcement_present: { value: "none" },
  rear_transversal_present: { value: "no" },
  rear_lower_x_present: { value: "none" },
  lower_main_hoop_bar_present: { value: "no" },
  door_bars_left: { value: "253-9-intersection-1", extra: { sill_bar: "no" } },
  door_bars_right: { value: "253-9-intersection-1", extra: { sill_bar: "no" } },
  harness_bar_present: { value: "253-26-27" },
  dash_bar_present: { value: "yes" },
  roof_bars: { value: "253-12-1" },
  main_hoop_diagonals: { value: "253-7-2" },
  backstays: { value: "yes" },
};

// customcages.co.uk -- Subaru Impreza VAB "International" multipoint T45
// kit, FIA certificated: X door bars with gusset plates, X roof, X main
// hoop, harness bar, front and rear strut-top tie-ins (not modelled).
make("Custom Cages Subaru VAB.json", "Subaru Impreza VAB -- Custom Cages FIA T45", Object.assign({}, common, {
  // 253-14 roof with its mandatory 253-22 backstay V, 253-17 (lower bar
  // only), 253-31 temple bars and windshield reinforcements on both sides.
  roof_bars: { value: "253-14" },
  backstay_diagonals: { value: "253-22" },
  rear_lateral_reinforcement_present: { value: "lower" },
  temple_bar_present: { value: "both" },
  windshield_reinforcement_present: { value: "both" },
  // 253-15 as 1 continuous bar, with its side taco gussets.
  a_pillar_reinforcement: { value: "continuous" },
  gusset_design__a_pillar_side_left__design: { value: "taco" },
  gusset_design__a_pillar_side_right__design: { value: "taco" },
  primary_tubing: { value: { material: "t45", diameter: { val: 45, unit: "mm" }, thickness: { val: 2.5, unit: "mm" } } },
  secondary_tubing: { value: { material: "t45", diameter: { val: 38, unit: "mm" }, thickness: { val: 2.5, unit: "mm" } } },
  vehicle_manufacturer: { value: "Subaru" },
  vehicle_model: { value: "Impreza WRX STI (VAB)" },
  vehicle_year: { value: "2015" },
  vehicle_weight: { value: { value: "1540", unit: "kg" } }, // Impreza WRX STI (VAB), approx. stock curb weight
  vehicle_builder: { value: "Custom Cages (kit)" },
}));

// bleedingtarmac.com -- Broken Motorsports Subaru GC "Rally X" kit (USA
// rally): X roof, X between the backstays, X main hoop, X door bars,
// front strut tower tie-ins (not modelled), DOM tube.
// customcages.co.uk -- Ford Fiesta Mk6 "Junior International" multipoint
// CDS kit, FIA / MSUK certificated: X roof with a centre gusset, X main
// hoop, X door bars, harness bar (optional tube), dash bar, front strut-top
// tie-ins (not modelled). UK car, so right-hand drive.
make("Custom Cages Ford Fiesta Mk6.json", "Ford Fiesta Mk6 -- Custom Cages FIA/MSUK CDS", Object.assign({}, common, {
  // 253-14 roof with its 253-22 backstay V, 253-17 (both bars), 253-18
  // rear transversal, 253-31 windshield reinforcement plates both sides,
  // 253-15 single bar with its two side gussets.
  roof_bars: { value: "253-14" },
  backstay_diagonals: { value: "253-22" },
  rear_lateral_reinforcement_present: { value: "both" },
  rear_transversal_present: { value: "yes" },
  windshield_reinforcement_present: { value: "both" },
  a_pillar_reinforcement: { value: "continuous" },
  gusset_design__a_pillar_side_left__design: { value: "taco" },
  gusset_design__a_pillar_side_right__design: { value: "taco" },
  // A 253-14 roof has no junction gussets -- drop the base sample's 253-12 ones.
  gusset_design__roof_front__design: undefined,
  gusset_design__roof_rear__design: undefined,
  // Leftovers of the base sample's 2-bar 253-15.
  gusset_design__a_pillar_2pc_left_upper_rear__design: undefined, gusset_design__a_pillar_2pc_left_lower_rear__design: undefined,
  gusset_design__a_pillar_2pc_left_upper_front__design: undefined, gusset_design__a_pillar_2pc_left_lower_front__design: undefined,
  gusset_design__a_pillar_2pc_right_upper_rear__design: undefined, gusset_design__a_pillar_2pc_right_lower_rear__design: undefined,
  gusset_design__a_pillar_2pc_right_upper_front__design: undefined, gusset_design__a_pillar_2pc_right_lower_front__design: undefined,
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 45, unit: "mm" }, thickness: { val: 2.5, unit: "mm" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 38, unit: "mm" }, thickness: { val: 2.5, unit: "mm" } } },
  vehicle_drive_side: { value: "rhd" },
  vehicle_manufacturer: { value: "Ford" },
  vehicle_model: { value: "Fiesta Mk6" },
  vehicle_year: { value: "2005" },
  vehicle_weight: { value: { value: "1100", unit: "kg" } }, // Fiesta Mk6, approx. stock curb weight
  vehicle_builder: { value: "Custom Cages (kit)" },
}));

// cagekits.org -- MX-5 Miata NA/NB road race kit (NASA / SCCA inspired):
// X door bars, single front-left roof diagonal, X between the backstays
// (no gussets), single main hoop diagonal topping out on the driver side,
// 253-31 temple bars and windshield reinforcements on both sides, no
// A-pillar gussets, harness bar, dash bar, 1.5" x .095" DOM throughout.
// Driver only.
make("CageKits Mazda MX-5 Miata.json", "Mazda MX-5 Miata NA/NB -- CageKits road race", Object.assign({}, common, {
  roof_bars: { value: "single-front-left" },
  backstay_diagonals: { value: "253-21-1" },
  main_hoop_diagonals: { value: "diag-left" },
  temple_bar_present: { value: "both" },
  windshield_reinforcement_present: { value: "both" },
  // No 253-15 bars, so no tube rows for them either.
  a_pillar_reinforcement: { value: "none" },
  a_pillar_dimension_a: undefined, // not known for this kit
  tubing_bar_classification__a_pillar_left__spec: undefined,
  tubing_bar_classification__a_pillar_right__spec: undefined,
  // No gussets at the backstay X or the A-pillars ("" = answered None).
  gusset_design__backstay_diag_left__design: { value: "" },
  gusset_design__backstay_diag_right__design: { value: "" },
  gusset_design__backstay_diag_upper__design: { value: "" },
  gusset_design__backstay_diag_lower__design: { value: "" },
  gusset_design__a_pillar_left__design: { value: "" },
  gusset_design__a_pillar_right__design: { value: "" },
  gusset_design__a_pillar_side_left__design: { value: "" },
  gusset_design__a_pillar_side_right__design: { value: "" },
  tubing_bar_classification__main_diagonals_left__spec: { value: "primary" },
  tubing_bar_classification__temple_bar_left__spec: { value: "secondary" },
  tubing_bar_classification__temple_bar_right__spec: { value: "secondary" },
  tubing_bar_classification__windshield_reinforcement_left__spec: { value: "secondary" },
  tubing_bar_classification__windshield_reinforcement_right__spec: { value: "secondary" },
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "Mazda" },
  vehicle_model: { value: "MX-5 Miata (NA/NB)" },
  vehicle_year: { value: "1995" },
  vehicle_weight: { value: { value: "2200", unit: "lb" } }, // MX-5 NA/NB, approx. stock curb weight
  vehicle_builder: { value: "CageKits (kit)" },
}));

// cagekits.org -- Datsun 240Z (S30, 1970-73) NHRA 8.50 kit, 1.625" x .083"
// 4130 chromoly: two door bars per side, main hoop V-brace, backstays to
// the rear strut towers with no diagonal, no FIA roof bar design, dash bar,
// harness bar.
make("CageKits Datsun 240Z NHRA.json", "Datsun 240Z -- CageKits NHRA 8.50 chromoly", Object.assign({}, common, {
  roof_bars: { value: "none" },
  backstay_diagonals: { value: "none" },
  main_hoop_diagonals: { value: "diag-lower-half" },
  // No 253-15 bars, so no tube rows for them either.
  a_pillar_reinforcement: { value: "none" },
  a_pillar_dimension_a: undefined, // not known for this kit
  tubing_bar_classification__a_pillar_left__spec: undefined,
  tubing_bar_classification__a_pillar_right__spec: undefined,
  // No A-pillar gussets ("" = answered None).
  gusset_design__a_pillar_left__design: { value: "" },
  gusset_design__a_pillar_right__design: { value: "" },
  gusset_design__a_pillar_side_left__design: { value: "" },
  gusset_design__a_pillar_side_right__design: { value: "" },
  door_bars_left: { value: "253-11", extra: { sill_bar: "no" } },
  door_bars_right: { value: "253-11", extra: { sill_bar: "no" } },
  tubing_bar_classification__main_diagonals_left__spec: { value: "primary" },
  tubing_bar_classification__main_diagonals_right__spec: { value: "primary" },
  tubing_bar_classification__d11_left__spec: { value: "secondary" },
  tubing_bar_classification__d11_right__spec: { value: "secondary" },
  primary_tubing: { value: { material: "chromoly_4130", diameter: { val: 1.625, unit: "in" }, thickness: { val: 0.083, unit: "in" } } },
  secondary_tubing: { value: { material: "chromoly_4130", diameter: { val: 1.625, unit: "in" }, thickness: { val: 0.083, unit: "in" } } },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "Datsun" },
  vehicle_model: { value: "240Z (S30)" },
  vehicle_year: { value: "1972" },
  vehicle_weight: { value: { value: "2300", unit: "lb" } }, // 240Z, approx. stock curb weight
  vehicle_builder: { value: "CageKits (kit)" },
}));

// cagekits.org -- BMW E92 (2006-2013) weld-in roll bar kit, 1.5" x .095"
// DOM: main hoop with an X and a harness bar, two backstays to the rear
// with a 253-21 X between them, no gussets at either X. Built on the roll
// bar sample, not the full cage.
make("CageKits BMW E92 roll bar.json", "BMW E92 -- CageKits roll bar", {
  main_structure_layout: { value: "half-rollcage" },
  main_hoop_diagonals: { value: "253-7-1" },
  harness_bar_present: { value: "253-26-27" },
  backstays: { value: "yes" },
  backstay_diagonals: { value: "253-21-1" },
  // No gussets at the 253-7 or 253-21 crossings ("" = answered None).
  gusset_design__main_hoop_diag_left__design: { value: "" },
  gusset_design__main_hoop_diag_right__design: { value: "" },
  gusset_design__main_hoop_diag_upper__design: { value: "" },
  gusset_design__main_hoop_diag_lower__design: { value: "" },
  gusset_design__backstay_diag_left__design: { value: "" },
  gusset_design__backstay_diag_right__design: { value: "" },
  gusset_design__backstay_diag_upper__design: { value: "" },
  gusset_design__backstay_diag_lower__design: { value: "" },
  rear_lateral_reinforcement_present: { value: "none" },
  rear_transversal_present: { value: "no" },
  rear_lower_x_present: { value: "none" },
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  vehicle_drive_side: { value: "lhd" },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "BMW" },
  vehicle_model: { value: "3 Series coupe (E92)" },
  vehicle_year: { value: "2010" },
  vehicle_weight: { value: { value: "3450", unit: "lb" } }, // E92 coupe, approx. stock curb weight
  vehicle_builder: { value: "CageKits (kit)" },
}, ROLLBAR_BASE);

// 9hio custom cages (from 9hio's walk-around videos), all DOM tubing.
const DOM_TUBING = {
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 1.75, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
};
const nineHio = (vehicle) => Object.assign({}, common, DOM_TUBING, { a_pillar_reinforcement: { value: "continuous" }, vehicle_drive_side: { value: "lhd" }, vehicle_builder: { value: "9hio" } }, vehicle);
make("9hio Subaru BRZ rally.json", "Subaru BRZ -- 9hio rally cage", nineHio({
  // 253-14 roof with its 253-22 backstay V.
  roof_bars: { value: "253-14" },
  backstay_diagonals: { value: "253-22" },
  vehicle_codriver: { value: "yes" },
  vehicle_manufacturer: { value: "Subaru" }, vehicle_model: { value: "BRZ" }, vehicle_year: { value: "2015" },
  vehicle_weight: { value: { value: "2800", unit: "lb" } }, // approx. stock curb weight
}));
make("9hio Subaru STI hillclimb.json", "Subaru WRX STI -- 9hio hillclimb cage", nineHio({
  // 253-14 roof with its 253-22 backstay V, sill bars both sides, 253-17
  // lower bar, 2-piece 253-15 with upper front / lower rear gussets.
  roof_bars: { value: "253-14" },
  backstay_diagonals: { value: "253-22" },
  door_bars_left: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  door_bars_right: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  rear_lateral_reinforcement_present: { value: "lower" },
  // B-pillar gussets (main hoop to B-pillar), both sides.
  gusset_design__b_pillar_left__design: { value: "single_plate" },
  gusset_design__b_pillar_right__design: { value: "single_plate" },
  a_pillar_reinforcement: { value: "two_bars" },
  gusset_design__a_pillar_2pc_left_upper_front__design: { value: "taco" },
  gusset_design__a_pillar_2pc_left_lower_rear__design: { value: "taco" },
  gusset_design__a_pillar_2pc_left_upper_rear__design: { value: "" },
  gusset_design__a_pillar_2pc_left_lower_front__design: { value: "" },
  gusset_design__a_pillar_2pc_right_upper_front__design: { value: "taco" },
  gusset_design__a_pillar_2pc_right_lower_rear__design: { value: "taco" },
  gusset_design__a_pillar_2pc_right_upper_rear__design: { value: "" },
  gusset_design__a_pillar_2pc_right_lower_front__design: { value: "" },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "Subaru" }, vehicle_model: { value: "WRX STI" }, vehicle_year: { value: "2016" },
  vehicle_weight: { value: { value: "3400", unit: "lb" } }, // approx. stock curb weight
}));
// Single main hoop diagonal topping out on the driver side, 253-21 X in the
// rear (no gussets), 2-piece 253-15 (no gussets), sill bars both sides,
// 253-17 lower bar, 253-31 temple bars and windshield reinforcements both
// sides, 253-54 multiplane box main hoop feet.
make("9hio BMW road racing.json", "BMW E46 M3 -- 9hio road racing cage", nineHio({
  roof_bars: { value: "single-front-left" },
  main_hoop_diagonals: { value: "diag-left" },
  tubing_bar_classification__main_diagonals_left__spec: { value: "primary" },
  backstay_diagonals: { value: "253-21-1" },
  gusset_design__backstay_diag_left__design: { value: "" },
  gusset_design__backstay_diag_right__design: { value: "" },
  gusset_design__backstay_diag_upper__design: { value: "" },
  gusset_design__backstay_diag_lower__design: { value: "" },
  a_pillar_reinforcement: { value: "two_bars" },
  ...Object.fromEntries(["left", "right"].flatMap((s) => ["upper_front", "upper_rear", "lower_front", "lower_rear"].map((p) => ["gusset_design__a_pillar_2pc_" + s + "_" + p + "__design", { value: "" }]))),
  door_bars_left: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  door_bars_right: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  rear_lateral_reinforcement_present: { value: "lower" },
  temple_bar_present: { value: "both" },
  windshield_reinforcement_present: { value: "both" },
  mounting_feet_design__main_hoop_left__design: { value: "multiplane_box" },
  mounting_feet_design__main_hoop_right__design: { value: "multiplane_box" },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "BMW" }, vehicle_model: { value: "M3 (E46)" }, vehicle_year: { value: "2003" },
  vehicle_weight: { value: { value: "3400", unit: "lb" } }, // approx. stock curb weight
}));
// 253-21 X in the rear, 253-31 temple bars and windshield reinforcements
// both sides.
make("9hio Ford Mustang road racing.json", "Ford Mustang -- 9hio road racing cage", nineHio({
  roof_bars: { value: "single-front-left" },
  main_hoop_diagonals: { value: "diag-left" },
  tubing_bar_classification__main_diagonals_left__spec: { value: "primary" },
  backstay_diagonals: { value: "253-21-1" },
  temple_bar_present: { value: "both" },
  windshield_reinforcement_present: { value: "both" },
  // No gussets at the 253-21 X or the 1-bar 253-15 ("" = answered None).
  gusset_design__backstay_diag_left__design: { value: "" },
  gusset_design__backstay_diag_right__design: { value: "" },
  gusset_design__backstay_diag_upper__design: { value: "" },
  gusset_design__backstay_diag_lower__design: { value: "" },
  gusset_design__a_pillar_side_left__design: { value: "" },
  gusset_design__a_pillar_side_right__design: { value: "" },
  vehicle_codriver: { value: "no" },
  vehicle_manufacturer: { value: "Ford" }, vehicle_model: { value: "Mustang (S550)" }, vehicle_year: { value: "2018" },
  vehicle_weight: { value: { value: "3700", unit: "lb" } }, // approx. stock curb weight
}));

// From 9hio's photos: 253-7 X main hoop with harness bar, 253-14 roof with
// its 253-22 backstay V to the rear strut towers, 253-18 between them,
// 253-9 X door bars (no sill bars), 253-17 upper bar, 1-bar 253-15 with its
// side gussets, 253-31 windshield reinforcements, dash bar.
make("9hio Honda Fit rally.json", "Honda Fit -- 9hio rally cage", nineHio({
  roof_bars: { value: "253-14" },
  backstay_diagonals: { value: "253-22" },
  rear_transversal_present: { value: "yes" },
  rear_lateral_reinforcement_present: { value: "upper" },
  // 2-piece 253-15 with upper front / lower rear gussets, 253-25.
  a_pillar_reinforcement: { value: "two_bars" },
  ...Object.fromEntries(["left", "right"].flatMap((s) => ["upper_front", "upper_rear", "lower_front", "lower_rear"].map((p) =>
    ["gusset_design__a_pillar_2pc_" + s + "_" + p + "__design", { value: p === "upper_front" || p === "lower_rear" ? "taco" : "" }]))),
  anti_intrusion_present: { value: "yes" },
  // 253-31 temple bars and windshield reinforcements, both sides.
  temple_bar_present: { value: "both" },
  windshield_reinforcement_present: { value: "both" },
  vehicle_codriver: { value: "yes" },
  vehicle_manufacturer: { value: "Honda" }, vehicle_model: { value: "Fit (GD)" }, vehicle_year: { value: "2008" },
  vehicle_weight: { value: { value: "2500", unit: "lb" } }, // approx. stock curb weight
}));

// Also: 253-31 temple bars and sill bars on both sides, and a 2-piece
// 253-15 with 2 gussets per side (upper front, lower rear).
make("Broken Motorsports Subaru GC.json", "Subaru Impreza GC -- Broken Motorsports DOM tubing", Object.assign({}, common, {
  backstay_diagonals: { value: "253-21-1" },
  temple_bar_present: { value: "both" },
  door_bars_left: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  door_bars_right: { value: "253-9-intersection-1", extra: { sill_bar: "yes" } },
  a_pillar_reinforcement: { value: "two_bars" },
  gusset_design__a_pillar_2pc_left_upper_front__design: { value: "taco" },
  gusset_design__a_pillar_2pc_left_lower_rear__design: { value: "taco" },
  gusset_design__a_pillar_2pc_left_upper_rear__design: { value: "" },
  gusset_design__a_pillar_2pc_left_lower_front__design: { value: "" },
  gusset_design__a_pillar_2pc_right_upper_front__design: { value: "taco" },
  gusset_design__a_pillar_2pc_right_lower_rear__design: { value: "taco" },
  gusset_design__a_pillar_2pc_right_upper_rear__design: { value: "" },
  gusset_design__a_pillar_2pc_right_lower_front__design: { value: "" },
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 1.75, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.095, unit: "in" } } },
  vehicle_manufacturer: { value: "Subaru" },
  vehicle_model: { value: "Impreza (GC)" },
  vehicle_year: { value: "1998" },
  vehicle_weight: { value: { value: "2750", unit: "lb" } }, // Impreza GC, approx. stock curb weight
  vehicle_builder: { value: "Broken Motorsports (kit)" },
}));

// "Worst cage" design template: everything one should not do in a
// rollcage, for the lowest possible Frog Safety score (and to review every
// warning the app gives). The base sample's every check is failed --
// welds incomplete, junctions 150mm away, bends non-compliant, lines
// between the shell and the cage, no gussets -- and every design choice is
// the worst one that still keeps the checklist's items shown: a single
// main rollbar diagonal and a single roof bar (with no diagonal or no roof
// bar at all, their junction tables would be hidden), a 253-9 without
// gussets on one side and a single door bar on the other, no sill bars,
// no 253-15 with dimension A over 200mm, single plane feet...
make("Worst cage.json", "Worst cage -- what not to do", {
  vehicle_codriver: { value: "no" }, // driver only: its side's unbraced main rollbar corner counts too
  vehicle_drive_side: { value: "lhd" },
  vehicle_year: { value: "1995" }, // pre-2002, without anti-intrusion bars
  vehicle_manufacturer: undefined, vehicle_model: undefined, vehicle_builder: undefined, vehicle_weight: undefined,
  // Part 2 -- design
  main_hoop_diagonals: { value: "diag-right" }, // its top on the codriver side: the driver side corner unbraced
  backstay_diagonals: { value: "none" },
  roof_bars: { value: "single-front-right" }, // the driver side front roof corner unsupported
  door_bars_left: { value: "253-9-intersection-1", extra: { sill_bar: "no" } },
  door_bars_right: { value: "single-bar", extra: { sill_bar: "no" } },
  a_pillar_reinforcement: { value: "none" },
  harness_bar_present: { value: "none" },
  lower_main_hoop_bar_present: { value: "no" },
  rear_lateral_reinforcement_present: { value: "none" },
  rear_transversal_present: { value: "no" },
  rear_lower_x_present: { value: "none" },
  anti_intrusion_present: { value: "no" },
  dash_bar_present: { value: "no" },
  temple_bar_present: { value: "none" },
  windshield_reinforcement_present: { value: "none" },
  ...Object.fromEntries(["front_left", "front_right", "main_hoop_left"].map((f) => ["mounting_feet_design__" + f + "__design", { value: "single_plane" }])),
  ...Object.fromEntries(["main_hoop_right", "backstay_left", "backstay_right"].map((f) => ["mounting_feet_design__" + f + "__design", { value: "none" }])),
  ...Object.fromEntries(["front_left", "front_right", "main_hoop_left", "main_hoop_right", "backstay_left", "backstay_right"].map((f) => ["mounting_feet_design__" + f + "__mount_type", { value: "bolted" }])),
  // The lateral-to-A-pillar gussets and the 253-9 crossing (left), all None.
  ...Object.fromEntries(["a_pillar_left", "a_pillar_right", "door_front_left", "door_rear_left", "door_upper_left", "door_lower_left"].map((r) => ["gusset_design__" + r + "__design", { value: "" }])),
  // Part 3 -- tubing & plates: undersized DOM, thin plates
  tubing_bar_classification__singlebar_right__spec: { value: "secondary" },
  primary_tubing: { value: { material: "cds_dom", diameter: { val: 1.5, unit: "in" }, thickness: { val: 0.065, unit: "in" } } },
  secondary_tubing: { value: { material: "cds_dom", diameter: { val: 1.25, unit: "in" }, thickness: { val: 0.049, unit: "in" } } },
  mounting_feet_material: { value: { material: "Steel", thickness: { val: 1.5, unit: "mm" } } },
  gusset_material: { value: { material: "steel", thickness: { val: 1, unit: "mm" } } },
  // Part 4 -- installation constraints
  cage_within_suspension_points: { value: "no" },
  main_structure_construction: { value: "no" },
  main_hoop_single_plane: { value: "no" },
  main_hoop_lean_angle: { value: "25" },
  main_hoop_bend_count: { value: "3" },
  front_rollbar_angle: { value: { bend_count: "2", angle: "25" } },
  front_feet_forward_of_rollbar: { value: "no" },
  backstay_angle: { value: "20" },
  a_pillar_dimension_a: { value: "350" },
  ...Object.fromEntries(["driver", "codriver"].flatMap((r) => [["windshield_measurements__" + r + "__straight", { value: "no" }], ["windshield_measurements__" + r + "__bend_angle", { value: "35" }]])),
  installation_constraints__a__value: { value: { value: "200", unit: "mm" } },
  installation_constraints__b__value: { value: { value: "350", unit: "mm" } },
  installation_constraints__c__value: { value: { value: "400", unit: "mm" } },
  installation_constraints__h__value: { value: { value: "800", unit: "mm" } },
  installation_constraints__e__value: { value: { value: "600", unit: "mm" } },
  installation_constraints__r1__value: { value: { value: "150", unit: "mm" } },
  installation_constraints__r2__value: { value: { value: "120", unit: "mm" } },
  // Part 6 -- seats & belts
  seat_angle_location__driver__backrest_distance: { value: { value: "40", unit: "mm" } },
  belt_shoulder_distance_angle__driver__pivot_distance: { value: { value: "50", unit: "mm" } },
  belt_shoulder_distance_angle__driver__horizontal_angle: { value: "35" },
  belt_shoulder_strap_angle__driver__strap_angle: { value: "45" },
  belt_lap_distance_angle__driver_left__belt_angle: { value: "85" },
  belt_lap_distance_angle__driver_right__belt_angle: { value: "85" },
  belt_six_point_angle__driver__spacing: { value: { value: "10", unit: "in" } },
}, CAGE_BASE, (k, a) => {
  if (/^gusset_dimensions__/.test(k) || (/^(seat|belt)_/.test(k) && /codriver/.test(k))) return undefined; // no gussets to measure; no codriver seat
  if (/__welds?$/.test(k)) return Object.assign(a, { value: "no" });
  if (/__distance$/.test(k)) return Object.assign(a, { value: { value: "150", unit: "mm" } });
  if (/__quick$/.test(k)) return Object.assign(a, { value: "" });
  if (/__compliant$/.test(k)) return Object.assign(a, { value: "no" });
  if (/^gusset_design__/.test(k)) return Object.assign(a, { value: "" });
  if (/^mounting_feet_size__/.test(k)) return Object.assign(a, { value: { value: "30" } });
  if (/^routing_of_lines__/.test(k)) return Object.assign(a, { value: "between_shell_cage" });
  if (/__plate_thickness$/.test(k)) return Object.assign(a, { value: { value: "1", unit: "mm" } });
  return a;
});
