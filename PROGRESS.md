# Heat Flow — Build Progress Handoff

> This file is the resume point for any future session. Read it fully before touching code.

## Status: COMPLETE ✅ (2026-07-04)

All Definition-of-Done items pass. If you are a future session: run `npm run build` and
`npm run sanity` to re-verify; both must be clean. The dev server is `npm run dev` (port 5173).

## Completed
- [x] Cleared old project files (kept .git, .claude)
- [x] Project scaffold (package.json, tsconfig, vite config, index.html)
- [x] sim/types.ts — all data types (NOTE: 4 fluids: heat/steam/water/waste)
- [x] sim/thermo.ts — physics core
- [x] sim/machines.ts — machine registry
- [x] sim/recipes.ts — item recipes
- [x] sim/research.ts — tech tree
- [x] sim/world.ts — grid, networks, sim tick (priority allocation: recyclers before sinks)
- [x] sim/save.ts — localStorage save/load
- [x] sim/sanity.ts — ALL PASSING: Carnot/1st-law sweeps, tier-0 ~14%, overload spiral
      overheats radiator, endgame plant hits 55.3% eff60 and triggers victory
- [x] render/iso.ts, heatmap.ts, renderer.ts
- [x] ui/hud.ts, buildMenu.ts, inspector.ts, researchPanel.ts, toasts.ts
- [x] content/tiers.ts
- [x] main.ts — bootstrap, game loop, input (window.__hf debug hook for testing)
- [x] npm install + `npm run build` clean
- [x] Sanity script passes (Carnot never exceeded, energy conserved, win reachable ≥55%)
- [x] Browser verification via dev server (no console errors): placement via real input
      events, tier-0 loop makes power, pipe temp drop 180→151 over 13 tiles, belts incl.
      corners flow, research consumes items, deficit throttling works, heat overlay works,
      save/load across reload works, victory overlay renders
- [x] README
- [x] Final review pass (4 reviewers + adversarial verification, 26 raw findings) — all real
      findings fixed: feedwater pump never demanded water (was a pure 3 kW parasite); machines
      could satisfy their own demand from their own buffer (phantom coupler activity fooled the
      win check); sinks absorbed streams colder than themselves (2nd-law violation); superheater
      minted steam from raw heat with no water (exploit — now capped at 2× steam flow);
      economizer divisor leak; condenser water return uncapped + double-booked enthalpy;
      water pipe-loss booked in wrong units; overheat latch-tick energy leak; recipe-switch
      destroyed consumed inputs; lab hoarded fulfilled ingredients; belt latency was
      direction-dependent (snapshot fix); belt-drag row-wrap OOB; camera X clamp let the map
      leave the screen; culling not zoom-scaled; inspector/research panels swallowed clicks on
      rebuild (hover guard); heat-pump inspector used wrong adjacency; version-mismatched saves
      now backed up instead of silently wiped; dead 40 copperIngot starting stock replaced.
- [x] Feedpump relay regression test added to sanity; final build + full sanity suite green.

## Spec summary (the contract — honor all of this)
**Heat Flow**: 2.5D isometric thermodynamics factory builder. Vite + TypeScript strict, Canvas 2D,
zero runtime deps (devDeps: vite, typescript, tsx only). 28×28 map. Fixed-timestep sim at 10 Hz,
speeds pause/1×/2×/4×. localStorage save/load + autosave 15 s.

**Physics (inviolable):** 1st law: work + waste = heat in, always. 2nd law: engine eta = machineQuality × Carnot,
clamped < 0.98×Carnot where Carnot = 1 − Tcold_K/Thot_K (Kelvin = °C + 273.15); heat flows hot→cold only;
waste heat must be rejected to sinks. Sinks: dT = (Q_absorbed − rejectCoeff×(T_sink − T_ambient))×dt/C;
overloaded sink heats up → engine T_cold rises → efficiency collapses → overheat (throttle then offline, recover on cooling).
Pipes attenuate: per-tile retention 0.985 uninsulated / 0.997 insulated, applied to flow amount and temp-above-ambient
(lost energy = pipe loss to ambient). Ambient = 20 °C.

**Model decisions made (keep these):**
- Fluids: 'heat' | 'steam' | 'water', all through one pipe network type; per-fluid flow resolution
  with pairwise attenuation (Dijkstra best-retention path, cached per network rebuild).
- Machines connect to pipes via any adjacent tile; direct machine-machine adjacency = retention 1.0.
- All transformers use 1-tick output buffers (backpressure: demand limited by output buffer space).
- Engine waste temp = T_cold + 0.25×(T_hot − T_cold) so economizer/regenerator preheating is honest.
- Water carries preheat energy: 0.08 HU per water-unit per °C above ambient; boiler needs 1 water per 30 HU steam.
- Global power grid: gen = Σ engine work + 6 kW auxiliary baseline (aux NOT counted in netEff numerator);
  deficit throttles all powered machines proportionally.
- netEff = Σ engine work / Σ primary heat (vent drawn + fuel burned), rolling 10/30/60 s windows.
- Research gates use best sustained 30 s window eff (latched). Gates: superheater 0.18, gas turbine 0.32,
  combined cycle 0.40, grand cycle controller 0.46. Win: eff60 ≥ 0.55.
- Combined-cycle research also raises boilerMaxTemp 200→340 ("high-pressure boiler").
- Reheater = steam-network booster: engines on its network get quality ×1.08 (cap 0.80).
- Heat pump: placed adjacent to a sink, pulls heat out of it to ambient, COP-clamped (0.6..6), sink temp clamp ≥ −25 °C.
- Gas turbine burns coal internally at 900 °C, quality 0.70, exhaust out as 'heat' at 330 °C (combined-cycle feed).
- Belts: directional tiles, pull-from-behind push-into-machine, 4 items/s, fractional item amounts, buffer cap 3/tile.
- Items: ironOre, copperOre, coal, quartz, ironIngot, copperIngot, ironPlate, copperWire, copperCoil,
  machineFrame, sensor, turbineBlade. Depot machine banks items into global inventory used for build costs.
- Win ("Grand Cycle"): controller placed+powered; ≥1 ACTIVE machine of every unlocked class among
  {source, boiler, superheater, engine, condenser, sink, heatPump, regenerator, coupler}; eff60 ≥ 0.55;
  no overheats; throttle≈1 — all held 60 consecutive sim-seconds → victory screen, then sandbox.

**Definition of Done:** npm install/dev/build clean, no console errors; full loop playable
(vent→boiler→engine→radiator, manufacturing, research through 4 tiers, Grand Cycle victory);
physics honest; heat overlay (H), speed controls, save/load; README.

## Graphics & UX overhaul (2026-07-05)
- Renderer: per-machine procedural bodies (cylindrical boilers/condensers/turbines, waisted
  cooling tower, radiator fin stacks, superheater coils, furnace fire aperture, heat-pump fan,
  miner derrick, lab dome, controller beacon...), drop shadows, map slab with side walls +
  vignette, per-tile floor shade variation, deposit rock clusters, vent fissure glow,
  particle system (steam plumes, smoke, embers), items ride belts as animated iso cubes,
  ground couplings drawn between adjacent machines, placement ghosts pulse the tiles they'd
  connect to. Machine motion (pistons, fans, drills, turbine spin) pauses with the sim.
- UX: live hover tooltip over machines (name/status/key stat); data-bound inspector (skeleton
  built once per selection, values update in place — dropdown/buttons never break, numbers stay
  live); research panel re-renders only when its data hash changes; HUD efficiency sparkline
  with 55% target line; help panel (? / F1 / HUD button); heat-overlay temperature legend;
  PAUSED indicator; WASD/arrow panning; Home recenters; tutorial spotlights the relevant build
  button; placement-failure toasts for pipes/belts; single-line scrollable inventory bar;
  narrow-window HUD media queries; warning-toast cooldowns raised.

## Item icons (2026-07-05)
- src/ui/itemIcons.ts: all 12 items get procedural canvas-drawn icons (cached data-URLs,
  no asset files). Used in the inventory bar, build-cost tooltips, research node costs,
  and inspector buffer/fuel readouts (data-bound rows support html values via dataset.raw
  diffing). Hover any icon for the item name.

## Build-menu machine portraits (2026-07-06)
- Renderer gained machinePortrait(type, px) / toolPortrait(kind, px): renders the REAL
  machine bodies (via drawBody with a fake machine/world/camera swapped in) onto small
  canvases, cached as data-URLs. src/ui/portraits.ts is the registry main.ts plugs the
  renderer into. Build-menu buttons now show mini machine portraits (+ tiny glyph label
  bottom-left, tier badge top-right); pipes/belt/bulldoze get hand-drawn tool icons.
  Inspector header and research-panel unlock lines show portraits too.
- Verified via DOM/pixel inspection (29/29 icons non-blank, multi-color, unique
  signatures, 38px in 44px buttons) — preview screenshot capture was broken at the
  tool level that day, page itself healthy with zero console errors.

## Known issues / next steps
- (none known)
