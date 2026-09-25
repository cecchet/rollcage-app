// Persistent live 3D cage viewer, shared across the whole checklist.
//
// Loads the same 30 verified/corrected STL parts used by cage_assembly.html
// once, on page load, into a container that survives app.js's render()
// (which wipes and rebuilds #app on every state change -- a Three.js canvas
// living inside that would reload all 30 STL files on every keystroke).
//
// Every part starts as a dim "ghost" (so the car's shape reads as context)
// and lights up in its category color once the corresponding checklist
// item confirms it's present. app.js drives this by calling
// window.CageView.applyState({ filename: colorHex, ... }) after each
// render() -- any file present as a key gets that color at full opacity;
// every other file reverts to the ghost material.
(function () {
  "use strict";

  // Unlike the .js/.css files (cache-busted via ?v=N in index.html), these
  // STL parts are fetched by a fixed filename with no query string of their
  // own -- so overwriting a part's bytes on disk (a re-extraction, a resize)
  // is invisible to any browser or CDN that already cached the old ones
  // under that same URL. Bump this whenever any file in cage_parts/ changes,
  // even if PARTS itself doesn't.
  const CAGE_PARTS_VERSION = 7;
  const DEFAULT_BACKGROUND = 0x1b1e22;

  const PARTS = [
    "Main rollbar.stl", "Front left lateral.stl", "Front right lateral.stl", "Transverse member.stl",
    "Left backstay.stl", "Right backstay.stl",
    "Main diagonal  1-  253-7.stl", "Main diagonal  2-  253-7.stl",
    "Rear diagonal 1.stl", "Rear diagonal 2.stl",
    "Roof bar 1.stl", "Roof bar 2.stl",
    "Left door bar 1-  253-9.stl", "Left door bar 2-  253-9.stl",
    "Right door bar 1-  253-9.stl", "Right door bar 2-  253-9.stl",
    "253-15 Left.stl", "253-15 Right.stl",
    // 2-bar build of 253-15 (2026-09-10 v3) -- extracted from the same 3mf,
    // same MASTER_OFFSET pipeline, swapped in for "253-15 Left/Right.stl"
    // instead of overlaid alongside it (see a_pillar_reinforcement's "2 bars"
    // choice in app.js).
    "253-15 left lower.stl", "253-15 left upper.stl",
    "253-15 right lower.stl", "253-15 right upper.stl",
    "253-18.stl", "Dash bar 253-29.stl",
    "Sill bar Left.stl", "Sill bar Right.stl",
    "Foot front left.stl", "Foot front right.stl",
    "Foot main rollbar left.stl", "Foot main rollbar right.stl",
    "Foot rear left.stl", "Foot rear right.stl",
    // Extracted from "all options rollcage.3mf" (2026-09-08) -- vertices
    // already baked into this model's world coordinates (see the matching
    // extraction note below), so none of these need a Z_FIXUPS entry.
    "Main rollbar lower half left.stl", "Main rollbar lower half right.stl",
    "Main rollbar V left.stl", "Main rollbar V right.stl",
    "Roof bar 253-14 left.stl", "Roof bar 253-14 right.stl",
    "Roof bar 253-13 left.stl", "Roof bar 253-13 right.stl",
    "Rear diagonal 253-22 left.stl", "Rear diagonal 253-22 right.stl",
    "Roof bar single center.stl",
    // Extracted from "all options rollcage.3mf" (2026-09-08, second update) --
    // same MASTER_OFFSET pipeline as the batch above, so likewise no
    // Z_FIXUPS entry needed. "253-17 left/right.stl" (a single bar per side)
    // no longer exist in the source model -- replaced by these upper/lower
    // pairs, matching the door-bar's own upper/lower front-junction choice.
    "Door bar 253-10 upper left.stl", "Door bar 253-10 upper right.stl",
    "Door bar 253-10 front left.stl", "Door bar 253-10 front right.stl",
    "Door bar 253-10 rear left.stl", "Door bar 253-10 rear right.stl",
    "253-17 left upper.stl", "253-17 right upper.stl",
    "253-17 left lower.stl", "253-17 right lower.stl",
    // Extracted from "all options rollcage.3mf" (2026-09-08, third update) --
    // same MASTER_OFFSET pipeline, no Z_FIXUPS entry needed.
    "253-19 left.stl", "253-19 right.stl",
    "253-25 upper left.stl", "253-25 upper right.stl",
    "253-25 lower left.stl", "253-25 lower right.stl",
    "253-31 temple bar left.stl", "253-31 temple bar right.stl",
    "253-31 windshield left.stl", "253-31 windshield right.stl",
    "Nascar left 1.stl", "Nascar left 2.stl",
    "Nascar right 1.stl", "Nascar right 2.stl",
    // Extracted from "all options rollcage.3mf" (2026-09-10, gussets update) --
    // same MASTER_OFFSET pipeline, no Z_FIXUPS entry needed. Each of these
    // categories (253-7, roof bars, backstay diagonal) really does have 4
    // real, independently-choosable gusset positions -- some cars only
    // gusset an opposite pair (left+right, or upper+lower), others gusset
    // all 4 -- so all 4 are real files here, not 2 with 2 unused
    // alternates. "Rear backstay gusset" is for the 253-21 X-configuration
    // diagonal brace itself (where it crosses/meets), not the backstay
    // tubes -- its modeled position (near the car's centerline) is the
    // real, correct one and is used as-is, no repositioning.
    "253-7 gusset left.stl", "253-7 gusset right.stl",
    "253-7 gusset upper.stl", "253-7 gusset lower.stl",
    "Roof bars gusset left.stl", "Roof bars gusset right.stl",
    "Roof bars gusset front.stl", "Roof bars gusset rear.stl",
    "Door bar gusset front left.stl", "Door bar gusset front right.stl",
    "Door bar gusset rear left.stl", "Door bar gusset rear right.stl",
    "Rear backstay gusset left.stl", "Rear backstay gusset right.stl",
    "Rear backstay gusset upper.stl", "Rear backstay gusset lower.stl",
    // Re-extracted from an updated "all options rollcage.3mf" (2026-09-10 v2)
    // with the A-pillar gussets repositioned correctly by the user directly
    // in CAD, plus 2 new "253-15 side gusset" parts for when the windscreen
    // pillar bar is a single continuous bar (as opposed to 2 bars meeting the
    // door bar) -- same MASTER_OFFSET pipeline as the rest, no Z_FIXUPS entry.
    "A-pillar gusset left.stl", "A-pillar gusset right.stl",
    "253-15 side gusset left.stl", "253-15 side gusset right.stl",
    // 4 gussets per side (2026-09-10 v4) for the 2-bar build of 253-15,
    // where the split upper/lower tube segments meet the door bar --
    // same MASTER_OFFSET pipeline, no Z_FIXUPS entry.
    "253-15 gusset left upper front.stl", "253-15 gusset left upper rear.stl",
    "253-15 gusset left lower front.stl", "253-15 gusset left lower rear.stl",
    "253-15 gusset right upper front.stl", "253-15 gusset right upper rear.stl",
    "253-15 gusset right lower front.stl", "253-15 gusset right lower rear.stl",
    // Re-extracted from an updated "all options rollcage.3mf" (2026-09-14)
    // with the 4 "upper" 253-15 gussets above resized, plus these 4 new
    // corner-brace gussets -- same MASTER_OFFSET pipeline (freshly
    // recalibrated against this revision's own unchanged reference parts),
    // no Z_FIXUPS entry. The 3mf's own part names had 2 left/right
    // mislabelings in this batch (a "side gusset" and one of two identically-
    // named "upper front" duplicates); sides here were verified by Y-sign
    // against the already-correct "253-15 Left/Right.stl", not trusted from
    // the source labels.
    "Roof corner gusset front left.stl", "Roof corner gusset front right.stl",
    "Roof corner gusset rear left.stl", "Roof corner gusset rear right.stl",
    // Re-extracted from an updated "all options rollcage.3mf" (2026-09-14,
    // second update) -- same MASTER_OFFSET pipeline, no Z_FIXUPS entry. The
    // old single "Harness bar.stl" was moved (a few mm) and renamed
    // "253-26,27 harness bar.stl"; "253-28,66 rear harness bar.stl" is a
    // new, more rearward-mounted alternative design (mutually exclusive with
    // 253-26/27 -- see harness_bar_present in rules-data.js). "253-30 lower
    // main hoop bar.stl" is a new independent optional bar.
    "253-26,27 harness bar.stl", "253-28,66 rear harness bar.stl",
    "253-30 lower main hoop bar.stl",
    // Extracted (2026-09-24) from "rollcage full options.3mf"'s 3rd plate
    // (its "Assembly" object -- the first 2 plates predate these parts).
    // Same MASTER_OFFSET pipeline, recalibrated against 7 unchanged parts on
    // that plate (253-7/door-bar/roof-corner gussets, both harness bars):
    // a pure translation, consistent to within 0.002mm. Left/right verified
    // by Y-sign against "Front left/right lateral.stl". No Z_FIXUPS entry.
    "B-pillar gusset left.stl", "B-pillar gusset right.stl",
    // Occupant mannequins (2026-09-16) -- Driver (holding the steering
    // wheel) and Codriver (holding a book). Each is split into 3 separately
    // colorable meshes (seat shell+cushions, mannequin body, held prop)
    // rather than one merged mesh, so the seat/body can render dim/ghosted
    // while the steering wheel / book stays highlighted. Extracted
    // differently from everything else here: Driver/Codriver are their own
    // top-level 3mf build items (not nested inside the Rollcage assembly),
    // each with its own <item> transform, so MASTER_OFFSET (which has
    // actually been standing in for the Rollcage object's OWN <item>
    // transform this whole time, never applied explicitly elsewhere)
    // doesn't apply on its own here -- see the extraction note in the
    // session history for the residual-offset fix. Modeled for a
    // left-hand-drive car (driver on the left); see setDriverMirrored()
    // for the right-hand-drive case.
    // "Driver.stl"/"Driver wheel.stl"/"Codriver.stl"/"Codriver book.stl"
    // re-extracted (2026-09-16, second update) from "rollcage full
    // options.3mf"'s 2nd plate -- frog mannequins holding a floating
    // steering wheel / book, replacing the original human figures. That
    // plate has no seat mesh of its own (frogs sit directly in the
    // existing seat shells), so "Driver seat.stl"/"Codriver seat.stl" are
    // untouched. Extracted with a freshly recalibrated MASTER_OFFSET (a
    // new 3mf save) and a residual against the 2nd plate's own Rollcage
    // COPY (build item id 67, a pure-translation duplicate of id 50 used
    // to lay out the 2 plates side by side) rather than id 50 itself, so
    // the frogs land in the same world frame as everything else.
    "Driver seat.stl", "Driver.stl", "Driver wheel.stl",
    "Codriver seat.stl", "Codriver.stl", "Codriver book.stl",
  ];
  // Re-extracted from an updated "all options rollcage.3mf" (2026-09-15) --
  // the 253-15 2-piece tube ("253-15 left/right upper/lower.stl") and its 8
  // 2pc gussets plus 2 side gussets weren't actually intersecting the door
  // bar/each other correctly; the user fixed the positions directly in CAD.
  // Same MASTER_OFFSET pipeline (freshly recalibrated), no Z_FIXUPS entry,
  // no new filenames (all already in the PARTS list above) -- just updated
  // bytes, hence the CAGE_PARTS_VERSION bump. Same 2 recurring left/right
  // mislabelings as the 2026-09-14 batch (one "side gusset" and the
  // duplicate-named "upper front" gusset) -- resolved the same way, by
  // Y-sign against "253-15 Left/Right.stl", not the source labels.
  // "253-15 gusset right upper rear.stl" got one more small (~1mm) touch-up
  // in a same-day follow-up 3mf save -- re-extracted the same way, another
  // CAGE_PARTS_VERSION bump.

  // Same verified Z-fixups as cage_assembly.html (derived from
  // "253-3 rollcage.3mf" -- see that file's comment for how these were measured).
  const Z_FIXUPS = {
    "Transverse member.stl": 104.91, "Left backstay.stl": 55.62, "Right backstay.stl": 55.10,
    "Main diagonal  1-  253-7.stl": 9.06, "Main diagonal  2-  253-7.stl": 9.06,
    "Rear diagonal 1.stl": 57.91, "Rear diagonal 2.stl": 58.60,
    "Roof bar 1.stl": 105.45, "Roof bar 2.stl": 105.45,
    "Left door bar 1-  253-9.stl": 7.84, "Left door bar 2-  253-9.stl": 8.17,
    "Right door bar 1-  253-9.stl": 8.17, "Right door bar 2-  253-9.stl": 7.84,
    "253-15 Left.stl": 3.61, "253-15 Right.stl": 4.38,
    "253-18.stl": 57.41, "Dash bar 253-29.stl": 55.88,
    "Sill bar Left.stl": 4.91, "Sill bar Right.stl": 4.91,
    "Foot front left.stl": -1.61, "Foot front right.stl": -2.61,
    "Foot main rollbar left.stl": -1.61, "Foot main rollbar right.stl": -2.61,
    "Foot rear left.stl": 49.54, "Foot rear right.stl": 49.54,
  };

  const GHOST_COLOR = 0x555a60;
  const GHOST_OPACITY = 0.35;

  // Mounting feet: 253-54 (multiplane box) has no modeled geometry of its
  // own yet, so each location also gets a small procedural cube (matching
  // the real plate file's own footprint/position) that app.js can light up
  // instead of the flat plate when that design is chosen for that foot --
  // see createFootCubes() and the "virtualFile" keys below, which aren't
  // real files under cage_parts/ at all.
  // hingeFace says which Z face of the plate mesh's own bounding box the
  // 253-53 double-plane should fold from -- "top" for the front/main-hoop
  // feet, whose mesh is a genuinely thin flat plate (their top face reads
  // as the plate's own upper surface). The backstay feet's mesh is not a
  // thin plate at all: it's a tapered bracket, wide flat mounting face at
  // the bottom narrowing to a neck at the top where the tube lands -- so
  // "top" there is the narrow neck, nowhere near the actual plate edge,
  // and the fold must anchor at "bottom" (the wide face) instead.
  const FOOT_LOCATIONS = [
    { row: "front_left", plateFile: "Foot front left.stl", hingeFace: "top" },
    { row: "front_right", plateFile: "Foot front right.stl", hingeFace: "top" },
    { row: "main_hoop_left", plateFile: "Foot main rollbar left.stl", hingeFace: "top" },
    { row: "main_hoop_right", plateFile: "Foot main rollbar right.stl", hingeFace: "top" },
    // The backstay feet's plate isn't flat/horizontal like the others -- it's
    // tilted to sit perpendicular to the backstay tube's own lean, so its
    // fold geometry is derived from the plate's own tilt (see
    // plateTiltInPlane) rather than a world-axis-aligned bounding box.
    { row: "backstay_left", plateFile: "Foot rear left.stl", hingeFace: "tilted", tubeFile: "Left backstay.stl" },
    { row: "backstay_right", plateFile: "Foot rear right.stl", hingeFace: "tilted", tubeFile: "Right backstay.stl" },
  ];
  function footCubeFile(row) { return "Foot cube " + row + ".virtual"; }
  // 253-53 (double plane plate) similarly has no modeled geometry of its
  // own -- it reuses the real base plate PLUS a duplicate of that same
  // plate, rotated 90 degrees about Y so it stands as a second plane
  // (vertical, for the front feet) folded out toward the exterior side of
  // the car, forming an L-bracket with the original flat plate.
  function doublePlaneFile(row) { return "Foot double-plane " + row + ".virtual"; }
  // 253-55/56 (multiplane rocker plate) is a second 253-53 (double-plane)
  // step, duplicated and shifted up (to sit at the top of the first fold)
  // and out (by the plate's own width, along the same exterior axis the
  // fold itself offsets along) -- so the duplicated base plate lands as the
  // horizontal "tread" between the two folds' vertical "risers", forming a
  // staircase profile.
  function rockerBaseFile(row) { return "Foot rocker base " + row + ".virtual"; }
  function rockerFoldFile(row) { return "Foot rocker fold " + row + ".virtual"; }

  // Gusset locations. 253-7, roof bars, and the 253-21 backstay diagonal
  // each really do have 4 real, independently-choosable positions (left/
  // right/upper/lower or left/right/front/rear) -- most cars gusset just
  // one opposite pair, but some use all 4, so all 4 map to real files here.
  // Door bars are different: their 4 positions (front/rear x left/right)
  // are all simultaneously real junctions, not alternates. "Rear backstay
  // gusset" is for the 253-21 diagonal brace itself (where it crosses/
  // meets), not the backstay tubes -- used at its modeled position as-is.
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
    { row: "b_pillar_left", file: "B-pillar gusset left.stl" },
    { row: "b_pillar_right", file: "B-pillar gusset right.stl" },
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

  let scene, camera, renderer, wrap;
  let target, radius, theta, phi, roll;
  const meshes = {}; // filename -> THREE.Mesh
  const ghostFiles = new Set(); // files applyState() last drew as dim ghosts (see snapshot())
  let loadedCount = 0;
  let onReadyCbs = [];
  let ready = false;
  let partClickCb = null;
  let partDoubleClickCb = null;
  let partHoverCb = null;

  function colorToRGB(color) {
    const c = new THREE.Color(color);
    return [c.r, c.g, c.b];
  }

  function parseBinarySTL(buf) {
    const dv = new DataView(buf);
    const triCount = dv.getUint32(80, true);
    const positions = new Float32Array(triCount * 9);
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
      offset += 12;
      for (let j = 0; j < 9; j++) { positions[i * 9 + j] = dv.getFloat32(offset, true); offset += 4; }
      offset += 2;
    }
    return positions;
  }

  // Z is "up" in this model's own coordinates (Z = real-world height, per
  // the STL data -- see the Z_FIXUPS comment above), not the three.js
  // default of Y. So phi orbits around Z here (phi=0 looks straight down
  // from above, phi=90deg is a level side view), giving a proper top-down
  // isometric-style default with the feet planted at the bottom of the
  // screen, instead of the cage appearing to lie on its side.
  function updateCamera() {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.sin(phi) * Math.sin(theta),
      target.z + radius * Math.cos(phi)
    );
    const viewDir = target.clone().sub(camera.position).normalize();
    camera.up.copy(new THREE.Vector3(0, 0, 1).applyAxisAngle(viewDir, roll));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  function fitCamera() {
    const box = new THREE.Box3();
    let any = false;
    Object.values(meshes).forEach((m) => { m.updateMatrixWorld(true); box.expandByObject(m); any = true; });
    if (!any || box.isEmpty()) return;
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    target.copy(sphere.center);
    radius = sphere.radius * 2.3;
    updateCamera();
  }

  function init(container) {
    if (scene) return; // idempotent
    wrap = container;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(DEFAULT_BACKGROUND);
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);

    target = new THREE.Vector3(190, 155, 55);
    radius = 500; theta = Math.PI / 4; phi = Math.PI / 4; roll = 0;
    updateCamera();

    let dragging = false, lastX = 0, lastY = 0, dragButton = 0;
    let downX = 0, downY = 0, moved = false;
    // Single vs double click/tap disambiguation, shared by mouse and touch
    // below -- a native dblclick event would fire ALONGSIDE two separate
    // click cycles (double-firing the single-click jump-to-section action
    // too), so this is done by hand instead: a click is held back for
    // CLICK_WINDOW_MS in case a second one lands nearby in time, in which
    // case it's treated as a double and the pending single is cancelled.
    const CLICK_WINDOW_MS = 350;
    let pendingClickTimer = null;
    let lastClickTime = 0, lastClickX = 0, lastClickY = 0;
    function registerClick(clientX, clientY) {
      const now = performance.now();
      const isDouble = now - lastClickTime < CLICK_WINDOW_MS && Math.abs(clientX - lastClickX) < 12 && Math.abs(clientY - lastClickY) < 12;
      lastClickTime = isDouble ? 0 : now; // consumed so a 3rd rapid click doesn't chain into another "double"
      lastClickX = clientX;
      lastClickY = clientY;
      if (isDouble) {
        if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null; }
        pickPart({ clientX, clientY }, true);
      } else {
        pendingClickTimer = setTimeout(() => {
          pendingClickTimer = null;
          pickPart({ clientX, clientY }, false);
        }, CLICK_WINDOW_MS);
      }
    }
    renderer.domElement.addEventListener("mousedown", (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY; dragButton = e.button;
      downX = e.clientX; downY = e.clientY; moved = false;
    });
    window.addEventListener("mouseup", (e) => {
      dragging = false;
      // A plain left click that didn't drag (rotate/pan) selects whichever
      // part is under the cursor -- see registerClick for what single vs
      // double actually does.
      if (!moved && dragButton === 0 && e.target === renderer.domElement) registerClick(e.clientX, e.clientY);
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) moved = true;
      lastX = e.clientX; lastY = e.clientY;
      if (dragButton === 2 || e.shiftKey) {
        const panSpeed = radius * 0.0015;
        const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
        const up = camera.up.clone();
        const rightVec = new THREE.Vector3().crossVectors(camDir, up).normalize();
        target.addScaledVector(rightVec, -dx * panSpeed);
        target.addScaledVector(up, dy * panSpeed);
      } else {
        theta -= dx * 0.005;
        phi -= dy * 0.005; // unclamped: a full 360 deg vertical orbit, matching the unclamped horizontal orbit
      }
      updateCamera();
    });
    // Touch equivalents of the mouse handlers above, for phones/tablets --
    // none of the mouse listeners fire for touch input at all, so without
    // this the canvas was completely inert on a touchscreen. Follows the
    // common mobile 3D-viewer convention rather than adding mode-switch
    // buttons: one finger drags to rotate (like a plain left-drag), two
    // fingers pinch to zoom and drag to pan together (combining wheel-zoom
    // and shift-drag-pan into a single gesture, since a phone has no
    // separate shift/right-click input), and a one-finger tap that didn't
    // drag selects a part (like a plain left-click).
    let touchMode = null; // "rotate" | "pan-zoom" | null
    let tLastX = 0, tLastY = 0, tDownX = 0, tDownY = 0, tMoved = false, tPinchDist = 0;
    function touchDist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }
    function touchMid(t0, t1) { return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 }; }
    renderer.domElement.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        touchMode = "rotate";
        tLastX = tDownX = e.touches[0].clientX;
        tLastY = tDownY = e.touches[0].clientY;
        tMoved = false;
      } else if (e.touches.length >= 2) {
        touchMode = "pan-zoom";
        tPinchDist = touchDist(e.touches[0], e.touches[1]);
        const mid = touchMid(e.touches[0], e.touches[1]);
        tLastX = mid.x; tLastY = mid.y;
        tMoved = true; // a 2-finger gesture never counts as a tap-to-select
      }
      e.preventDefault();
    }, { passive: false });
    window.addEventListener("touchmove", (e) => {
      if (!touchMode) return;
      if (touchMode === "rotate" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - tLastX, dy = t.clientY - tLastY;
        if (Math.abs(t.clientX - tDownX) > 4 || Math.abs(t.clientY - tDownY) > 4) tMoved = true;
        tLastX = t.clientX; tLastY = t.clientY;
        theta -= dx * 0.005;
        phi -= dy * 0.005;
        updateCamera();
      } else if (touchMode === "pan-zoom" && e.touches.length >= 2) {
        const dist = touchDist(e.touches[0], e.touches[1]);
        const mid = touchMid(e.touches[0], e.touches[1]);
        if (tPinchDist > 0) radius = Math.max(10, Math.min(5000, radius * (tPinchDist / dist)));
        const dx = mid.x - tLastX, dy = mid.y - tLastY;
        const panSpeed = radius * 0.0015;
        const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
        const up = camera.up.clone();
        const rightVec = new THREE.Vector3().crossVectors(camDir, up).normalize();
        target.addScaledVector(rightVec, -dx * panSpeed);
        target.addScaledVector(up, dy * panSpeed);
        tPinchDist = dist; tLastX = mid.x; tLastY = mid.y;
        updateCamera();
      }
      e.preventDefault();
    }, { passive: false });
    window.addEventListener("touchend", (e) => {
      if (touchMode === "rotate" && !tMoved && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        registerClick(t.clientX, t.clientY);
      }
      if (e.touches.length === 0) {
        touchMode = null;
      } else if (e.touches.length === 1) {
        // Lifting one finger of a 2-finger pan/zoom -- restart as a plain
        // 1-finger rotate from here, but don't let this final finger's
        // eventual lift-off count as a fresh tap (the gesture as a whole
        // already moved the camera).
        touchMode = "rotate";
        tLastX = tDownX = e.touches[0].clientX;
        tLastY = tDownY = e.touches[0].clientY;
        tMoved = true;
      }
    });

    const raycaster = new THREE.Raycaster();
    // Where along a bar a click landed, as a 0-1 fraction of meshAxisBounds'
    // own range. app.js uses this to tell which end/weld-point of a multi-
    // point bar a double-click meant, rather than just knowing which file
    // was clicked.
    function axisFraction(mesh, point) {
      const b = meshAxisBounds(mesh);
      const span = b.max - b.min;
      return span > 1e-6 ? (point[b.axis] - b.min) / span : 0.5;
    }
    // Shared by click/double-click and hover below -- finds whichever
    // visible mesh (if any) is under clientX/clientY and how far along its
    // own axis the hit landed.
    function raycastPart(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const visibleMeshes = Object.values(meshes).filter((m) => m.visible);
      const hits = raycaster.intersectObjects(visibleMeshes);
      if (!hits.length) return null;
      const hitMesh = hits[0].object;
      const file = Object.keys(meshes).find((f) => meshes[f] === hitMesh);
      return file ? { file, frac: axisFraction(hitMesh, hits[0].point) } : null;
    }
    function pickPart(e, isDouble) {
      const cb = isDouble ? partDoubleClickCb : partClickCb;
      if (!cb) return;
      const hit = raycastPart(e.clientX, e.clientY);
      if (hit) cb(hit.file, hit.frac);
    }
    // Hover: lets app.js show a tooltip naming the exact weld/junction
    // point a click would land on, so a bar's several points can be told
    // apart before committing to a double-click. Only fires when not
    // dragging (rotate/pan) and the cursor is actually over the canvas --
    // reuses the identical hit-test click uses, so the tooltip and a
    // subsequent click always agree.
    renderer.domElement.addEventListener("mousemove", (e) => {
      if (dragging || !partHoverCb) return;
      const hit = raycastPart(e.clientX, e.clientY);
      partHoverCb(hit ? hit.file : null, hit ? hit.frac : null, e.clientX, e.clientY);
    });
    renderer.domElement.addEventListener("mouseleave", () => {
      if (partHoverCb) partHoverCb(null, null, 0, 0);
    });
    renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    renderer.domElement.addEventListener("wheel", (e) => {
      radius = Math.max(10, Math.min(5000, radius * (e.deltaY > 0 ? 1.1 : 0.9)));
      updateCamera();
      e.preventDefault();
    }, { passive: false });

    window.addEventListener("resize", () => {
      if (!container.clientWidth) return;
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });

    PARTS.forEach((file) => {
      fetch("cage_parts/" + encodeURIComponent(file) + "?v=" + CAGE_PARTS_VERSION).then((r) => {
        if (!r.ok) throw new Error(r.status + " for " + file);
        return r.arrayBuffer();
      }).then((buf) => {
        const positions = parseBinarySTL(buf);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const ghostColors = new Float32Array(positions.length);
        const [gr, gg, gb] = colorToRGB(GHOST_COLOR);
        for (let i = 0; i < ghostColors.length; i += 3) { ghostColors[i] = gr; ghostColors[i + 1] = gg; ghostColors[i + 2] = gb; }
        geometry.setAttribute("color", new THREE.BufferAttribute(ghostColors, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide,
          transparent: true, opacity: GHOST_OPACITY,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.rawPositions = positions;
        mesh.userData.geometryVariant = null;
        const dz = Z_FIXUPS[file] || 0;
        if (dz) mesh.position.z = dz;
        scene.add(mesh);
        meshes[file] = mesh;
      }).catch((e) => {
        console.error("CageView: failed to load", file, e);
      }).finally(() => {
        loadedCount++;
        if (loadedCount === PARTS.length) {
          createFootExtras();
          ready = true;
          fitCamera();
          onReadyCbs.forEach((cb) => cb());
          onReadyCbs = [];
        }
      });
    });

    // Ghost-colors a freshly built geometry (ghost is the correct default
    // for a brand new part -- untouched until applyState says otherwise)
    // and wraps it in a mesh with the same material settings as every
    // fetched STL part, added to the scene and registered under fileKey.
    function addProceduralPart(fileKey, geometry, position, quaternion) {
      const [gr, gg, gb] = colorToRGB(GHOST_COLOR);
      const posCount = geometry.attributes.position.count;
      const colorArr = new Float32Array(posCount * 3);
      for (let i = 0; i < posCount; i++) { colorArr[i * 3] = gr; colorArr[i * 3 + 1] = gg; colorArr[i * 3 + 2] = gb; }
      geometry.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide,
        transparent: true, opacity: GHOST_OPACITY,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      if (quaternion) mesh.quaternion.copy(quaternion);
      scene.add(mesh);
      meshes[fileKey] = mesh;
    }

    // Some mounting-foot plates (the backstay feet) aren't flat/horizontal
    // like the front and main-hoop plates -- they're tilted to sit
    // perpendicular to their own tube's lean. Reading the fold geometry off
    // a world-axis-aligned bounding box (as the front/main-hoop feet do)
    // breaks down there: the plate's real thickness axis is a mix of world
    // X and Z, not pure Z, so bb.min/max.z lands on a corner rather than a
    // face. This recovers the plate's own tilted in-plane "length" axis and
    // thickness/normal axis directly from its vertices (PCA within the X-Z
    // "side profile" plane -- every foot plate here is only tilted about Y,
    // never skewed sideways, so Y stays a clean, untouched exterior axis
    // throughout), oriented so the normal axis points toward `towardDir`
    // (the attached tube's own centroid) -- the side the fold should
    // continue onto, mirroring how the front feet fold from their top face
    // (the side the tube comes from) rather than their underside.
    function plateTiltInPlane(geometry, towardDir) {
      const pos = geometry.attributes.position;
      const n = pos.count;
      let mx = 0, mz = 0;
      for (let i = 0; i < n; i++) { mx += pos.getX(i); mz += pos.getZ(i); }
      mx /= n; mz /= n;
      let cxx = 0, cxz = 0, czz = 0;
      for (let i = 0; i < n; i++) {
        const dx = pos.getX(i) - mx, dz = pos.getZ(i) - mz;
        cxx += dx * dx; cxz += dx * dz; czz += dz * dz;
      }
      cxx /= n; cxz /= n; czz /= n;
      const trace = cxx + czz, det = cxx * czz - cxz * cxz;
      const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
      const lambdaLen = trace / 2 + disc; // larger eigenvalue -> the plate's long in-plane axis
      let vx = cxz, vz = lambdaLen - cxx;
      if (Math.hypot(vx, vz) < 1e-9) { vx = 1; vz = 0; } // already axis-aligned (cxz ~ 0)
      const vlen = Math.hypot(vx, vz);
      let lenAxis = new THREE.Vector3(vx / vlen, 0, vz / vlen);

      // Rotation (about world Y only, since both lenAxis and world X have
      // zero Y-component) that carries local +X onto lenAxis -- so a box
      // built with its length along local X ends up with that length along
      // the plate's own tilted axis, and local Z lands on whichever in-plane
      // direction is perpendicular to it (the thickness/normal axis).
      let quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), lenAxis);
      let normalAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      if (normalAxis.dot(towardDir) < 0) {
        // Shortest-arc rotation picked the other of the two valid X->lenAxis
        // solutions (lenAxis and -lenAxis are the same physical axis) --
        // flip to the one whose resulting normal actually faces the tube.
        lenAxis.negate();
        quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), lenAxis);
        normalAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      }

      let lenMin = Infinity, lenMax = -Infinity, nrmMin = Infinity, nrmMax = -Infinity;
      for (let i = 0; i < n; i++) {
        const dx = pos.getX(i) - mx, dz = pos.getZ(i) - mz;
        const pl = dx * lenAxis.x + dz * lenAxis.z;
        const pn = dx * normalAxis.x + dz * normalAxis.z;
        if (pl < lenMin) lenMin = pl; if (pl > lenMax) lenMax = pl;
        if (pn < nrmMin) nrmMin = pn; if (pn > nrmMax) nrmMax = pn;
      }
      return {
        quat, normalAxis,
        centerX: mx, centerZ: mz,
        lenSize: lenMax - lenMin,
        thickness: nrmMax - nrmMin,
        normalFaceOffset: nrmMax, // distance from center to the tube-facing face, along normalAxis
      };
    }

    // 253-55/56: a second 253-53 step, duplicated from the base plate and
    // its fold, both shifted by the same (standHeight along normalAxisVec,
    // standHeight along extAxisVec) offset -- up to sit at the top of the
    // first fold, and out by the plate's own width. The duplicated base
    // plate (same geometry/orientation as the real one, just translated)
    // becomes the horizontal tread linking the two folds' vertical risers.
    function addRockerStep(row, plateGeometry, plateBasePosition, foldGeometry, foldPosition, foldQuat, normalAxisVec, extAxisVec, standHeight) {
      const stepOffset = new THREE.Vector3()
        .addScaledVector(normalAxisVec, standHeight)
        .addScaledVector(extAxisVec, standHeight);
      addProceduralPart(
        rockerBaseFile(row), plateGeometry.clone(),
        plateBasePosition.clone().add(stepOffset)
      );
      addProceduralPart(
        rockerFoldFile(row), foldGeometry.clone(),
        foldPosition.clone().add(stepOffset), foldQuat
      );
    }

    // Builds the two placeholder parts each foot location needs beyond its
    // real flat plate mesh:
    // - a small box sized/positioned to match the plate (253-54, until real
    //   modeled geometry for the multiplane box exists), and
    // - a thin second plate standing perpendicular to the first, hinged
    //   along its outer (exterior-facing) edge (253-53's "double plane"
    //   design). Built as its own thin box rather than a rotated clone of
    //   the real plate mesh -- some locations' plate mesh (e.g. the
    //   backstay feet) is already a chunky 3D bracket, not a thin flat
    //   plate, and cloning+rotating that whole shape produced a bulky lump
    //   instead of a clean second plane. A fresh thin box sized from the
    //   original's own footprint looks right everywhere.
    // Both start ghosted and hidden like every other part; app.js's
    // applyState color map picks one (or the plain plate) per foot once
    // that foot's design is actually answered.
    function createFootExtras() {
      FOOT_LOCATIONS.forEach(({ row, plateFile, hingeFace, tubeFile }) => {
        const plateMesh = meshes[plateFile];
        if (!plateMesh) return;
        plateMesh.geometry.computeBoundingBox();
        const bb = plateMesh.geometry.boundingBox;
        const size = new THREE.Vector3(); bb.getSize(size);
        const center = new THREE.Vector3(); bb.getCenter(center);
        const dz = Z_FIXUPS[plateFile] || 0;
        const isLeft = row.indexOf("left") !== -1;

        const cubeGeometry = new THREE.BoxGeometry(Math.max(size.x, 6), Math.max(size.y, 6), Math.max(size.z, 6));
        addProceduralPart(footCubeFile(row), cubeGeometry, new THREE.Vector3(center.x, center.y, center.z + dz));

        if (hingeFace === "tilted") {
          // Plate isn't flat/horizontal -- derive the fold from its own
          // tilted axes (see plateTiltInPlane) instead of a world-axis bbox.
          const tubeMesh = meshes[tubeFile];
          const towardDir = new THREE.Vector3(1, 0, 0); // fallback, overwritten below when the tube mesh is available
          if (tubeMesh) {
            tubeMesh.geometry.computeBoundingBox();
            const tbb = tubeMesh.geometry.boundingBox;
            const tubeCenter = new THREE.Vector3(); tbb.getCenter(tubeCenter);
            tubeCenter.z += Z_FIXUPS[tubeFile] || 0;
            const plateWorldCenter = new THREE.Vector3(center.x, center.y, center.z + dz);
            towardDir.subVectors(tubeCenter, plateWorldCenter);
          }
          const t = plateTiltInPlane(plateMesh.geometry, towardDir);
          const thickness = Math.min(t.thickness, 2) || 2;
          const standHeight = size.y;
          const doubleGeometry = new THREE.BoxGeometry(t.lenSize, thickness, standHeight);
          const doubleCenterLen = new THREE.Vector3(
            t.centerX + t.normalAxis.x * (t.normalFaceOffset + standHeight / 2),
            0,
            t.centerZ + t.normalAxis.z * (t.normalFaceOffset + standHeight / 2)
          );
          const hingeY = isLeft ? bb.min.y : bb.max.y;
          const doublePosition = new THREE.Vector3(
            doubleCenterLen.x,
            hingeY + (isLeft ? -1 : 1) * thickness / 2,
            doubleCenterLen.z + dz
          );
          addProceduralPart(doublePlaneFile(row), doubleGeometry, doublePosition, t.quat);
          addRockerStep(
            row, plateMesh.geometry, new THREE.Vector3(0, 0, dz),
            doubleGeometry, doublePosition, t.quat,
            t.normalAxis, new THREE.Vector3(0, isLeft ? -1 : 1, 0), standHeight
          );
          return;
        }

        // The hinge line runs along X (the plate's own length), fixed at
        // the exterior Y edge (min Y for left-side feet, since lower Y is
        // further from centerline there; max Y for right-side feet) and at
        // whichever Z face (see hingeFace, set per location above) is the
        // plate's own flat mounting surface -- a real folded bracket
        // creases where that flat material continues into the new plane,
        // not partway inside its own thickness. The new plate is thin (its
        // own material gauge, capped at 2 units) sitting just outside that
        // edge, and stands up to the same height as the original plate's
        // own inward extent (size.y) -- so it reads as "that same plate,
        // folded 90 degrees at its outer edge" regardless of how chunky the
        // real base mesh actually is.
        const hingeY = isLeft ? bb.min.y : bb.max.y;
        const hingeZ = hingeFace === "bottom" ? bb.min.z : bb.max.z;
        const thickness = Math.min(size.y, size.z, 2) || 2;
        const standHeight = size.y;
        const doubleGeometry = new THREE.BoxGeometry(size.x, thickness, standHeight);
        const doublePosition = new THREE.Vector3(
          center.x,
          hingeY + (isLeft ? -1 : 1) * thickness / 2,
          hingeZ + standHeight / 2 + dz
        );
        addProceduralPart(doublePlaneFile(row), doubleGeometry, doublePosition);
        addRockerStep(
          row, plateMesh.geometry, new THREE.Vector3(0, 0, dz),
          doubleGeometry, doublePosition, null,
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, isLeft ? -1 : 1, 0), standHeight
        );
      });
    }

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();
  }

  function onReady(cb) {
    if (ready) cb(); else onReadyCbs.push(cb);
  }

  // A raw STL tube is typically just 2 end rings joined by long triangles
  // running its full length -- fine for a 2-way split (every vertex is
  // already at one extreme or the other, so each lands on the correct side
  // of a midpoint threshold), but a 3+-way split needs REAL vertices in the
  // middle to color, which a plain per-vertex recolor can't create: a long
  // triangle with both its real vertices colored green interpolates as
  // solid green across its whole span, even if the middle "segment" should
  // read red. subdivideAlongAxis() slices every triangle into per-segment
  // pieces (Sutherland-Hodgman clipping against evenly spaced cut planes
  // along one axis, then fan-triangulating each piece) so there's real
  // geometry at every segment boundary to color correctly.
  function clipPolygon(poly, axisIdx, boundary, keepBelow) {
    if (poly.length < 3) return [];
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const curr = poly[i];
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const currIn = keepBelow ? curr[axisIdx] <= boundary : curr[axisIdx] >= boundary;
      const prevIn = keepBelow ? prev[axisIdx] <= boundary : prev[axisIdx] >= boundary;
      if (currIn !== prevIn) {
        const denom = curr[axisIdx] - prev[axisIdx];
        const t = denom !== 0 ? (boundary - prev[axisIdx]) / denom : 0;
        out.push([
          prev[0] + t * (curr[0] - prev[0]),
          prev[1] + t * (curr[1] - prev[1]),
          prev[2] + t * (curr[2] - prev[2]),
        ]);
      }
      if (currIn) out.push(curr);
    }
    return out;
  }
  function subdivideAlongAxis(rawPositions, axisIdx, numSlices) {
    let lo = Infinity, hi = -Infinity;
    for (let i = axisIdx; i < rawPositions.length; i += 3) {
      if (rawPositions[i] < lo) lo = rawPositions[i];
      if (rawPositions[i] > hi) hi = rawPositions[i];
    }
    const span = hi - lo || 1;
    const boundaries = [];
    for (let s = 1; s < numSlices; s++) boundaries.push(lo + (span * s) / numSlices);
    const outPositions = [];
    const triCount = rawPositions.length / 9;
    for (let t = 0; t < triCount; t++) {
      const base = t * 9;
      let remaining = [
        [rawPositions[base], rawPositions[base + 1], rawPositions[base + 2]],
        [rawPositions[base + 3], rawPositions[base + 4], rawPositions[base + 5]],
        [rawPositions[base + 6], rawPositions[base + 7], rawPositions[base + 8]],
      ];
      const pieces = [];
      for (let b = 0; b < boundaries.length && remaining.length >= 3; b++) {
        const below = clipPolygon(remaining, axisIdx, boundaries[b], true);
        if (below.length >= 3) pieces.push(below);
        remaining = clipPolygon(remaining, axisIdx, boundaries[b], false);
      }
      if (remaining.length >= 3) pieces.push(remaining);
      pieces.forEach((poly) => {
        for (let i = 1; i < poly.length - 1; i++) {
          outPositions.push(poly[0][0], poly[0][1], poly[0][2]);
          outPositions.push(poly[i][0], poly[i][1], poly[i][2]);
          outPositions.push(poly[i + 1][0], poly[i + 1][1], poly[i + 1][2]);
        }
      });
    }
    return new Float32Array(outPositions);
  }
  // Swaps a mesh's geometry between its pristine loaded form and a
  // subdivided one, only rebuilding when the axis/slice count actually
  // changes (subdivision always starts fresh from the pristine positions,
  // so repeated calls never compound). rawPositions is cached once, at
  // load time, in loadMeshFile() below.
  function ensureGeometryVariant(mesh, variantKey, axisIdx, numSlices) {
    // Procedural parts (mounting-foot cubes/folds -- see addProceduralPart)
    // never carry a multi-point weld spec, so they never need subdividing;
    // guard rather than assume every mesh went through the STL-loading path.
    if (!mesh.userData.rawPositions) return;
    if ((mesh.userData.geometryVariant || null) === variantKey) return;
    mesh.userData.geometryVariant = variantKey;
    const positions = variantKey ? subdivideAlongAxis(mesh.userData.rawPositions, axisIdx, numSlices) : mesh.userData.rawPositions;
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    mesh.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    // computeVertexNormals() REUSES an existing "normal" attribute in place
    // rather than resizing it -- deleting it first forces a fresh one
    // sized to match the new position count, instead of silently keeping
    // the old (wrong-length) buffer and rendering garbage/black past its end.
    mesh.geometry.deleteAttribute("normal");
    mesh.geometry.computeVertexNormals();
  }

  // fileColorMap: { "Left backstay.stl": "#2f9e57", ... } for a flat color,
  // the string "hidden" to fully hide a part, or a band split for a single
  // part colored in two zones along one axis:
  // { "Main rollbar.stl": { axis: "y", min: 108, max: 204, inside: "#3b6fd6", outside: "#d4a017" } }
  // "inside" applies where that world-space coordinate falls within
  // [min, max], "outside" everywhere else. (Used for 253-2, where the main
  // rollbar's straight top run between roughly y=108..204 reads as a
  // transverse member (blue) but the curved bend + legs on both sides --
  // which stay gold no matter how high they reach -- read as the rear legs
  // of the two full lateral rollbars. A pure height/Z threshold doesn't
  // work here: the bend's own local peak gets almost as high as the flat
  // top, so it has to be split by width/Y position instead.)
  // Any part not present as a key is fully hidden, same as an explicit
  // "hidden" -- unless showGhostBars is true (the default -- see the
  // "Hide ghost bars" button), in which case it instead shows dim/ghosted
  // for context. Toggling that button lets a user declutter down to just
  // the confirmed bars when the ghost context gets in the way of the ones
  // that are actually part of the cage.
  function applyState(fileColorMap, showGhostBars) {
    onReady(() => {
      Object.keys(meshes).forEach((file) => {
        const mesh = meshes[file];
        const spec = fileColorMap[file];
        const dz = Z_FIXUPS[file] || 0;

        if (spec === "hidden" || (!spec && !showGhostBars)) {
          // Fully remove it from rendering, rather than opacity 0 -- a
          // transparent-but-present mesh still writes to the depth buffer
          // by default, which was punching holes in whatever colored bars
          // sat behind it from some viewing angles.
          mesh.visible = false;
          return;
        }
        mesh.visible = true;

        // A 3+-way split needs real geometry at each segment boundary (see
        // subdivideAlongAxis's own comment); anything else uses the
        // mesh's original, pristine geometry.
        const needsSubdivide = spec && typeof spec === "object" && Array.isArray(spec.colors) && spec.colors.length > 2;
        const axisIdx = needsSubdivide ? (spec.axis === "x" ? 0 : spec.axis === "y" ? 1 : 2) : 0;
        const numSlices = needsSubdivide ? spec.colors.length * 3 : 0;
        ensureGeometryVariant(mesh, needsSubdivide ? spec.axis + ":" + numSlices : null, axisIdx, numSlices);

        // A band-split mesh (multiple weld points on one bar) can sit
        // almost exactly coincident with ANOTHER split mesh it crosses
        // (e.g. a 253-9-intersection leg's own real crossing partner --
        // both are band-split, the tubes' surfaces genuinely overlap by a
        // real amount at some viewing angles, not just a z-fighting
        // artifact). Every split mesh skips depth testing and draws in
        // segCount order, so ties between two overlapping split meshes go
        // to whichever has MORE points to show (a 4-point cut leg over its
        // 2-point continuous partner) rather than whichever happened to
        // draw last. Reset for a plain single-color mesh so this doesn't
        // leak into unrelated depth ordering.
        const segCount = spec && typeof spec === "object" ? (Array.isArray(spec.colors) ? spec.colors.length : ("inside" in spec ? 2 : 0)) : 0;
        mesh.material.depthTest = segCount === 0;
        mesh.renderOrder = segCount;

        const posAttr = mesh.geometry.attributes.position;
        const colorAttr = mesh.geometry.attributes.color;
        const arr = colorAttr.array;
        const n = posAttr.count;

        if (spec) ghostFiles.delete(file);
        else ghostFiles.add(file);
        if (!spec) {
          const [r, g, b] = colorToRGB(GHOST_COLOR);
          for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b; }
          mesh.material.opacity = GHOST_OPACITY;
        } else if (typeof spec === "string") {
          const [r, g, b] = colorToRGB(spec);
          for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b; }
          mesh.material.opacity = 1;
        } else if (Array.isArray(spec.colors)) {
          // N-way split: spec.min..spec.max (that mesh's own axis range --
          // see getMeshAxisBounds) divided into spec.colors.length EQUAL
          // segments, so each of a bar's several weld/junction points gets
          // its own color instead of one worst-case color for the whole
          // mesh. Segments run low-to-high along the axis in the SAME order
          // as spec.colors, matching how app.js orders each row's color to
          // agree with cage_view.js's own axisFraction() (used for
          // double-click hit-testing) -- what you click is what lights up.
          const segColors = spec.colors.map((c) => colorToRGB(c));
          const axisIdx = spec.axis === "x" ? 0 : spec.axis === "y" ? 1 : 2;
          const axisOffset = axisIdx === 2 ? dz : 0;
          const span = (spec.max - spec.min) || 1;
          for (let i = 0; i < n; i++) {
            const v = (axisIdx === 0 ? posAttr.getX(i) : axisIdx === 1 ? posAttr.getY(i) : posAttr.getZ(i)) + axisOffset;
            let idx = Math.floor(((v - spec.min) / span) * segColors.length);
            if (idx < 0) idx = 0;
            if (idx > segColors.length - 1) idx = segColors.length - 1;
            const c = segColors[idx];
            arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
          }
          mesh.material.opacity = 1;
        } else {
          const inside = colorToRGB(spec.inside);
          const outside = colorToRGB(spec.outside);
          const axisIdx = spec.axis === "x" ? 0 : spec.axis === "y" ? 1 : 2;
          const axisOffset = axisIdx === 2 ? dz : 0; // only Z carries a part offset in this model
          for (let i = 0; i < n; i++) {
            const v = (axisIdx === 0 ? posAttr.getX(i) : axisIdx === 1 ? posAttr.getY(i) : posAttr.getZ(i)) + axisOffset;
            const c = v >= spec.min && v <= spec.max ? inside : outside;
            arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
          }
          mesh.material.opacity = 1;
        }
        colorAttr.needsUpdate = true;
      });
    });
  }

  // Driver/Codriver were modeled for a left-hand-drive car -- for a
  // right-hand-drive one, both mannequins (seat, body, and whichever prop
  // they're holding) need to swap sides. Rather than shipping a second,
  // mirrored pair of STL files, this mirrors them at render time: setting
  // position.y = 2*CENTER and scale.y = -1 reflects every world-space
  // vertex around y=CENTER (world_y = position.y + scale.y*local_y =
  // 2*CENTER - local_y), landing the Driver mesh exactly on the Codriver
  // seat and vice versa. CENTER is the midpoint of the two seats' own
  // extracted Y-centers, not the car's overall centerline, so the swap is
  // exact even if the two seats aren't perfectly symmetric about the car.
  const DRIVER_MIRROR_CENTER_Y = 156.25;
  const DRIVER_MIRROR_FILES = ["Driver seat.stl", "Driver.stl", "Driver wheel.stl", "Codriver seat.stl", "Codriver.stl", "Codriver book.stl"];
  // The frog mannequins' legs are posed slightly asymmetrically in the
  // source model (independent of our mirroring -- each body's own raw mesh
  // reaches a bit further on one lateral side than the other): the
  // codriver frog's leg lands ~4.7mm outside the sill bar on its outward
  // side, the driver frog by a much smaller ~0.6mm on its own outward side.
  // A small constant world-space nudge along the car's lateral (Y) axis,
  // added to each body's position, pulls it back inside -- and because
  // it's additive in world space rather than baked into the mesh, it stays
  // correct (still pulling inward, not outward) after mirroring for a
  // right-hand-drive car, unlike a fix baked into the STL vertices would.
  const BODY_Y_NUDGE = { "Driver.stl": 4, "Codriver.stl": -6 };
  function setDriverMirrored(mirrored) {
    onReady(() => {
      DRIVER_MIRROR_FILES.forEach((file) => {
        const mesh = meshes[file];
        if (!mesh) return;
        const nudge = BODY_Y_NUDGE[file] || 0;
        mesh.position.y = mirrored ? DRIVER_MIRROR_CENTER_Y * 2 - nudge : nudge;
        mesh.scale.y = mirrored ? -1 : 1;
      });
    });
  }

  function resetView() {
    theta = Math.PI / 4; phi = Math.PI / 4; roll = 0;
    fitCamera();
  }
  // Lets app.js (the PDF report's multi-angle capture) point the camera at
  // an arbitrary preset orbit position from outside this module -- same
  // theta/phi/roll this file already drives drag-to-rotate with (see the
  // Z-is-up comment on updateCamera above for what each one means), just
  // settable directly instead of only via mouse/touch drag. fitCamera()
  // re-centers on the current mesh bounds the same way resetView() does, so
  // this still frames the whole model correctly regardless of what's
  // currently shown/hidden.
  function setOrbit(thetaRad, phiRad, rollRad) {
    theta = thetaRad; phi = phiRad; roll = rollRad || 0;
    fitCamera();
  }

  function onPartClick(cb) { partClickCb = cb; }
  function onPartDoubleClick(cb) { partDoubleClickCb = cb; }
  function onPartHover(cb) { partHoverCb = cb; }
  // Every mesh file the model actually has, loaded or not -- lets app.js
  // default EVERY part to hidden in Part 3 (not just ones some rule
  // happened to touch), so an optional bar that's simply absent from this
  // car can't fall through as a phantom ghost just because nothing ever
  // wrote an entry for it into the color map. Mounting feet's 4 procedural
  // "virtual" meshes per location (cube/double-plane/rocker base/rocker
  // fold -- see footCubeFile() etc.) aren't in PARTS at all (they're built
  // at runtime, not loaded from cage_parts/), so without adding them here
  // too, app.js's own "default everything hidden" pass in Part 3 never
  // reaches them -- setIfActive then short-circuits on their raw "hidden"
  // color (a different design is the active one) without ever writing a
  // view entry, leaving them at their just-created default: visible and
  // ghosted. That's why every non-selected foot design used to ghost at
  // once in Part 3 instead of only the one actually picked.
  function getAllFiles() {
    const virtual = [];
    FOOT_LOCATIONS.forEach(({ row }) => {
      virtual.push(footCubeFile(row), doublePlaneFile(row), rockerBaseFile(row), rockerFoldFile(row));
    });
    return PARTS.slice().concat(virtual);
  }

  // A mesh's own bounding box, reduced to whichever single axis (x/y/z) has
  // the largest span -- the closest a plain axis-aligned box can get to
  // "that tube's running length" without per-file hand-measurement. Shared
  // by axisFraction() (double-click hit-testing, inside init() above) and
  // getMeshAxisBounds() (app.js's N-way color-split spec, below), so a
  // click and the colors it's choosing between always agree on which
  // direction "along the bar" means.
  function meshAxisBounds(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    return { axis, min: box.min[axis], max: box.max[axis] };
  }
  // Lets app.js build a same-axis N-way color-split spec (see applyState's
  // "colors" array handling) for a given file without duplicating the
  // bounding-box math here -- returns null for an unknown/not-yet-loaded
  // file rather than throwing, since app.js may call this before meshes
  // finish loading.
  // Applies an extra world-space transform (a three.js column-major 4x4
  // array) on top of a mesh's modeled placement -- e.g. a gusset that sits
  // at a different junction, at a different angle, depending on which
  // design it's paired with. Files not in the map go back to their modeled
  // placement, so each call fully describes the current transforms.
  function setMeshTransforms(transforms) {
    onReady(() => {
      Object.keys(meshes).forEach((file) => {
        const mesh = meshes[file];
        const t = transforms && transforms[file];
        if (!t) {
          if (!mesh.matrixAutoUpdate) mesh.matrixAutoUpdate = true;
          return;
        }
        mesh.updateMatrix(); // its own position/rotation/scale placement
        mesh.matrix.premultiply(new THREE.Matrix4().fromArray(t));
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldNeedsUpdate = true;
      });
    });
  }
  function getMeshAxisBounds(file) {
    const mesh = meshes[file];
    return mesh ? meshAxisBounds(mesh) : null;
  }
  // Overrides the scene background -- used by the PDF report to capture
  // white-background screenshots (less ink when printed) without touching
  // the live viewer's own dark theme; resetBackground() restores it. Takes
  // effect on the next animation frame via the existing render loop, no
  // explicit render() call needed.
  function setBackground(color) {
    if (scene) scene.background = new THREE.Color(color);
  }
  function resetBackground() {
    if (scene) scene.background = new THREE.Color(DEFAULT_BACKGROUND);
  }
  // A still of the model for the saved-rollcages list: the default 3/4
  // view with ghost bars and the occupants hidden. Rendered synchronously
  // and restored within the same call, so the live view (camera, visible
  // parts) never visibly changes. Returns a JPEG data URL at most maxWidth
  // wide, or null before the model has loaded.
  function snapshot(maxWidth) {
    if (!ready || !renderer) return null;
    const saved = { theta, phi, roll, radius, target: target.clone() };
    const hiddenForShot = [];
    Object.keys(meshes).forEach((file) => {
      const m = meshes[file];
      if (m.visible && (ghostFiles.has(file) || /^(Driver|Codriver)/.test(file))) {
        m.visible = false;
        hiddenForShot.push(m);
      }
    });
    theta = Math.PI / 4; phi = Math.PI / 4; roll = 0;
    // Frame just the bars actually showing (fitCamera frames every mesh,
    // hidden alternates and occupants included), far enough back that
    // their bounding sphere fits the narrower of the 2 fields of view --
    // the whole cage is in shot, never cropped.
    const box = new THREE.Box3();
    Object.values(meshes).forEach((m) => { if (m.visible) { m.updateMatrixWorld(true); box.expandByObject(m); } });
    if (box.isEmpty()) fitCamera();
    else {
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      target.copy(sphere.center);
      radius = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;
    }
    updateCamera();
    renderer.render(scene, camera);
    const src = renderer.domElement;
    // Trim the empty background around the cage (the viewer canvas is much
    // wider than tall), keeping a small margin, so the thumbnail is all cage.
    const full = document.createElement("canvas");
    full.width = src.width;
    full.height = src.height;
    const fctx = full.getContext("2d");
    fctx.drawImage(src, 0, 0);
    let crop = { x: 0, y: 0, w: full.width, h: full.height };
    try {
      const px = fctx.getImageData(0, 0, full.width, full.height).data;
      const bg = [px[0], px[1], px[2]];
      let minX = full.width, minY = full.height, maxX = -1, maxY = -1;
      for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
          const i = (y * full.width + x) * 4;
          if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
        const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
        crop = { x: x0, y: y0, w: Math.min(full.width, maxX + pad + 1) - x0, h: Math.min(full.height, maxY + pad + 1) - y0 };
      }
    } catch (e) { /* keep the uncropped frame */ }
    const scale = Math.min(1, maxWidth / Math.max(1, crop.w, crop.h));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(crop.w * scale));
    out.height = Math.max(1, Math.round(crop.h * scale));
    out.getContext("2d").drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
    hiddenForShot.forEach((m) => { m.visible = true; });
    theta = saved.theta; phi = saved.phi; roll = saved.roll; radius = saved.radius;
    target.copy(saved.target);
    updateCamera();
    renderer.render(scene, camera);
    return out.toDataURL("image/jpeg", 0.85);
  }
  window.CageView = { init, applyState, setMeshTransforms, resetView, setOrbit, onReady, onPartClick, onPartDoubleClick, onPartHover, setDriverMirrored, getMeshAxisBounds, getAllFiles, setBackground, resetBackground, snapshot };

  function boot() {
    const container = document.getElementById("cageViewerContainer");
    if (!container) return;
    init(container);
    const toggleBtn = document.getElementById("cageViewerToggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const hidden = container.style.display === "none";
        container.style.display = hidden ? "block" : "none";
        toggleBtn.textContent = hidden ? "Hide" : "Show";
        if (hidden) {
          camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
          camera.updateProjectionMatrix();
          renderer.setSize(container.clientWidth, container.clientHeight);
        }
      });
    }
    const resetBtn = document.getElementById("cageViewerReset");
    if (resetBtn) resetBtn.addEventListener("click", resetView);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
