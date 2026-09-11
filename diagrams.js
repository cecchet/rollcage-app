// Original schematic icons for rollcage configuration options.
// These are simplified illustrative pictograms authored from scratch for
// this app -- NOT extracted or traced from the FIA or NASA source PDFs,
// both of which explicitly prohibit reproduction of their diagrams.
// They exist purely to help a user recognize which configuration they're
// looking at; the checklist text descriptions remain the authoritative
// requirement, not these icons.

(function () {
  "use strict";

  const CTX = 'stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" class="diagram-context"';
  const HI = 'stroke="var(--accent)" stroke-width="4" fill="none" stroke-linecap="round" class="diagram-highlight"';
  const wrap = (inner) =>
    '<svg viewBox="0 0 140 100" xmlns="http://www.w3.org/2000/svg" class="diagram-icon">' + inner + "</svg>";

  // Reusable base hoop context pieces (front 3/4 pictogram: two side hoops + roof)
  const mainHoop = `<path d="M30,90 L30,35 Q30,15 50,15 L90,15 Q110,15 110,35 L110,90" ${CTX}/>`;
  const backstaysCtx = `<path d="M30,35 L15,90" ${CTX}/><path d="M110,35 L125,90" ${CTX}/>`;
  const frontHoop = `<path d="M20,90 L20,45 Q20,20 45,18 L60,15" ${CTX}/>`;
  const lateralRearPillar = `<path d="M110,35 L110,90" ${CTX}/>`;

  const D = {}; // diagram registry, key -> svg string
  window.DIAGRAM_LEGENDS = window.DIAGRAM_LEGENDS || {};

  // 253-1/253-2/253-3 (base structure layout) intentionally have no static
  // icon here anymore -- the persistent live 3D cage viewer (cage_view.js,
  // mounted in index.html) shows the real, verified model colored per
  // config instead, which replaced these hand-authored isometric pictograms.

  D["mrc-4"] = wrap(
    `<ellipse cx="70" cy="18" rx="40" ry="8" ${HI}/>` +
    `<path d="M30,90 L30,35" ${CTX}/><path d="M110,90 L110,35" ${CTX}/>` +
    `<path d="M20,90 L35,40" ${HI}/><path d="M120,90 L105,40" ${HI}/>` +
    backstaysCtx
  );

  // ---- Roof bars (plan view: wide/rear edge on top, narrow/front edge on
  // the bottom -- looking down at the roof from above) ----
  const roofLabels = '<text x="70" y="12" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.65">REAR</text>' +
    '<text x="70" y="68" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.65">FRONT</text>';
  const roofTrap = `<path d="M25,20 L115,20 L95,55 L45,55 Z" ${CTX}/>` + roofLabels;
  D["253-12"] = wrap(roofTrap + `<path d="M25,20 L95,55 M115,20 L45,55" ${HI}/>`);
  // 253-13 is the front-to-back mirror of 253-14: apex at rear center,
  // one bar to each front corner (instead of apex-front/legs-to-rear).
  D["253-13"] = wrap(roofTrap + `<path d="M45,55 L70,20 L95,55" ${HI}/>`);
  // 253-14: a symmetric V/"Lambda" -- apex at front center, one bar to
  // each rear corner (not a single one-directional diagonal).
  D["253-14"] = wrap(roofTrap + `<path d="M25,20 L70,55 L115,20" ${HI}/>`);
  D["rb-4"] = wrap(roofTrap + `<path d="M25,20 L95,55" ${HI}/>` + `<path d="M100,22 L112,22 L112,32 Z" ${HI}/><path d="M40,53 L52,53 L40,43 Z" ${HI}/>`);
  // Simpler/older single-bar roof configurations -- captured for
  // identification, not compliant with FIA 253-12/253-14 for new
  // construction. The two "single bar front left/right" options reuse the
  // exact same corner-to-corner diagonal legs as 253-12 (one leg each,
  // not a new shape), matching how the live 3D model reuses "Roof bar
  // 1/2.stl" individually for them.
  D["roof-single-center"] = wrap(roofTrap + `<path d="M70,20 L70,55" ${HI}/>`);
  D["roof-single-front-left"] = wrap(roofTrap + `<path d="M115,20 L45,55" ${HI}/>`);
  D["roof-single-front-right"] = wrap(roofTrap + `<path d="M25,20 L95,55" ${HI}/>`);

  // ---- Backstay diagonals (rear view) ----
  const backstaysRear = `<path d="M40,15 L20,90" ${CTX}/><path d="M100,15 L120,90" ${CTX}/>`;
  D["253-20"] = wrap(backstaysRear + `<path d="M40,15 L120,90" ${HI}/>`);
  D["253-20-right"] = wrap(backstaysRear + `<path d="M100,15 L20,90" ${HI}/>`);
  D["253-21"] = wrap(backstaysRear + `<path d="M40,15 L120,90 M100,15 L20,90" ${HI}/>`);
  // 253-22 is a V (apex at top center, legs down to both bottom corners) --
  // NOT a single diagonal.
  D["253-22"] = wrap(backstaysRear + `<path d="M20,90 L70,15 L120,90" ${HI}/>`);

  // ---- Main hoop diagonal (front view of main hoop) ----
  const hoopFront = `<path d="M30,90 L30,20 Q30,10 45,10 L95,10 Q110,10 110,20 L110,90" ${CTX}/>`;
  D["253-5"] = wrap(hoopFront + `<path d="M30,90 L70,45 L110,90" ${HI}/><path d="M45,60 L95,60" ${HI}/>`);
  D["253-6"] = wrap(hoopFront + `<path d="M30,90 L70,60 L110,90" ${HI}/><path d="M45,70 L95,70" ${HI}/>`);
  D["253-7"] = wrap(hoopFront + `<path d="M30,90 L110,20 M110,90 L30,20" ${HI}/>`);
  // Non-253-7 main-hoop-diagonal configurations -- captured for grandfathering
  // review / other disciplines, not compliant with FIA 253-7 new-construction.
  D["diag-left"] = wrap(hoopFront + `<path d="M30,20 L110,90" ${HI}/>`);
  D["diag-right"] = wrap(hoopFront + `<path d="M110,20 L30,90" ${HI}/>`);
  D["diag-horizontal"] = wrap(hoopFront + `<path d="M30,55 L110,55" ${HI}/>`);
  D["diag-lower-half"] = wrap(hoopFront + `<path d="M30,55 L70,90 M110,55 L70,90" ${HI}/>`);
  D["diag-v-center"] = wrap(hoopFront + `<path d="M30,90 L70,20 L110,90" ${HI}/>`);

  // ---- Door bars (side view of door opening) ----
  const doorOpening = `<rect x="25" y="15" width="90" height="70" rx="6" ${CTX}/>`;
  // 253-9's two fabrication variants get visually distinct icons: the
  // intersection design is a full corner-to-corner X, but the continuous
  // bar's crossing partner has a small gap right at the center -- showing
  // that it's actually 2 half-bars, not one piece, unlike the fully
  // unbroken continuous bar it's crossing. The bent design is 2 curved bars
  // (bent along their own length, not straight) -- like 2 half-moons facing
  // each other, meeting at a single point at center: one arcing between the
  // two top corners dipping down to the meeting point, the other arcing
  // between the two bottom corners rising up to that same point.
  D["253-9-intersection"] = wrap(doorOpening + `<path d="M30,20 L110,80" ${HI}/><path d="M30,80 L62,54 M78,46 L110,20" ${HI}/>`);
  // Same X, continuous/half-bar roles swapped -- which physical tube is
  // fabricated as the continuous one isn't fixed by the rule, so both are
  // offered as separate design picks (see DOOR_BAR_DESIGN_OPTIONS).
  D["253-9-intersection-2"] = wrap(doorOpening + `<path d="M30,80 L110,20" ${HI}/><path d="M30,20 L62,46 M78,54 L110,80" ${HI}/>`);
  D["253-9"] = wrap(doorOpening + `<path d="M30,25 Q70,75 110,25" ${HI}/><path d="M30,75 Q70,25 110,75" ${HI}/>`);
  D["253-10"] = wrap(doorOpening + `<path d="M30,35 L70,55 L110,35 Z" ${HI}/>`);
  // 253-11 (double bars) is the single diagonal bar plus the sill bar
  // (the horizontal bottom line) -- 2 bars total, not 2 parallel diagonals.
  D["253-11"] = wrap(doorOpening + `<path d="M25,70 L115,70" ${HI}/><path d="M30,25 L115,70" ${HI}/>`);
  // NASCAR: parallel top/bottom rails (253-10's top rail + the sill bar)
  // with 2 vertical bars between them, matching the real part count.
  D["stock-car"] = wrap(doorOpening + `<path d="M30,30 L110,30 M30,70 L110,70" ${HI}/><path d="M57,30 L57,70 M83,30 L83,70" ${HI}/>`);
  // A single bar, captured for identification -- top-left to bottom-right.
  D["single-bar"] = wrap(doorOpening + `<path d="M30,20 L110,80" ${HI}/>`);
  // Sill bar sub-toggle icon -- same door-opening context, just the
  // horizontal bottom bar (253-11's own sill line, minus its diagonal).
  D["sill-bar-toggle"] = wrap(doorOpening + `<path d="M25,70 L115,70" ${HI}/>`);

  // ---- Rear lateral reinforcement (253-17) -- side view, same door
  // opening context as the door bar diagrams above. The rear end attaches
  // low, near the backstay; the front end (what actually varies between
  // options) reaches either the upper door bar point, the lower one, or
  // both.
  D["253-17-upper"] = wrap(doorOpening + `<path d="M110,78 L30,20" ${HI}/>`);
  D["253-17-lower"] = wrap(doorOpening + `<path d="M110,78 L30,72" ${HI}/>`);
  D["253-17-both"] = wrap(doorOpening + `<path d="M110,78 L30,20 M110,78 L30,72" ${HI}/>`);
  D["253-17-none"] = wrap(doorOpening);

  // A user-supplied reference photo, sized the same way as the hand-drawn
  // SVGs above (see the ".element-diagram img"/".choice-diagram img" rules
  // in style.css).
  const wrapImg = (src) => `<img src="images/${src}" alt="" class="diagram-icon diagram-icon-photo">`;

  // ---- A-pillar reinforcement (253-15) ----
  D["253-15"] = wrapImg("253-15.jpg");

  // ---- Sill bar ----
  D["sillbar"] = wrap(
    `<path d="M25,25 L25,80 M115,25 L115,80" ${CTX}/>` +
    `<path d="M20,80 L120,80" ${HI}/>`
  );

  // ---- Windshield-bar gusset (grandfathered conditional item) ----
  D["gusset"] = wrap(
    `<path d="M30,85 L30,20 L110,20 L110,85" ${CTX}/>` +
    `<path d="M45,20 L45,35 L60,20 Z" ${HI}/><path d="M95,20 L95,35 L80,20 Z" ${HI}/>`
  );

  // ---- Main hoop leaning angle (+/-10 degrees from vertical) ----
  D["lean-angle"] = wrapImg("main_hoop_angle.jpg");

  // ---- Main hoop bend count (1 max) ----
  D["main-hoop-bend"] = wrapImg("main_hoop_bend.jpg");

  // ---- Front rollbar angle / no bends below windscreen line ----
  D["front-rollbar-bend"] = wrapImg("front_rollbar_bend.jpg");

  // ---- Backstay angle (>30 degrees from vertical) ----
  D["backstay-angle"] = wrapImg("backstay_angle.jpg");

  // ---- Bend radius / stretch compliance (cold-bend, 90% stretch, 3x radius) ----
  D["bend-radius"] = wrapImg("bend_radius_compliance.png");

  // ---- Cage contained between front and rear suspension mounting points ----
  D["suspension-containment"] = wrapImg("suspension_containment.png");

  window.DIAGRAMS = D;
})();
