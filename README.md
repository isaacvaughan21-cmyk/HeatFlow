# Heat Flow

A 2.5D isometric factory/optimization builder about **thermodynamics**. Tap geothermal heat,
boil steam, spin turbines, and fight the Second Law: every engine is bounded by the Carnot
limit, and every watt you don't extract becomes waste heat that **must go somewhere**. If your
cold sinks can't shed it, they heat up, your efficiency collapses, and machines overheat.
Research better cycles, integrate everything, and sustain **55% net efficiency** to complete
**The Grand Cycle**.

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # typecheck + production build
npm run sanity   # headless physics + win-reachability test suite
```

No runtime dependencies — Vite + TypeScript (strict), hand-rolled Canvas-2D isometric renderer,
`localStorage` saves (autosave every 15 s).

## Controls

| Input | Action |
|---|---|
| Drag / wheel | Pan / zoom |
| Click build button, then click map | Place (drag to lay pipes & belts; belt direction follows drag) |
| `R` | Rotate belt direction |
| Right-click | Remove (or cancel tool) · `Del` removes selection |
| Click machine | Inspector with live thermodynamic readouts |
| `H` | **Heat overlay** — everything recolored by temperature |
| `T` | Research tree |
| `Space`, `1` `2` `3` | Pause / sim speed |

## The thermo model (grounded but simplified)

- **1st law**: for every engine, `work + waste = heat in`. Always. No free energy anywhere.
- **2nd law**: `η = machineQuality × (1 − T_cold/T_hot)` (Kelvin), clamped strictly below the
  Carnot limit. Machine quality (45% for a crude piston, 68% for a steam turbine…) is how
  research improves you *without breaking physics*.
- **Cold sinks** integrate `dT = (Q_in − k·(T − T_ambient))·dt/C`. Overload one and `T_cold`
  rises → Carnot falls → *more* waste per unit work → the entropy spiral. Above its max temp a
  sink trips offline and your engines stall.
- **Pipes** bleed heat per tile (1.5%, insulated 0.3%) — long runs cost you temperature and
  therefore efficiency. Compact, insulated layouts win.
- Fluids are rate-based (`HU/s` ≈ kJ/s) with four types — heat, steam, water, waste — flowing
  through one pipe network; waste-heat recyclers get first claim before sinks destroy it, and
  they can only heat feedwater up to the waste temperature they actually receive.
- **Power** is a single global grid; deficits throttle every powered machine.
- **Net efficiency** = work generated ÷ primary heat drawn (vents + fuel), on rolling windows.
  The HUD shows it beside the live **Carnot ceiling** — the number you're chasing.

Progression: Tier 0 piston loop → Rankine basics (turbine, condenser, insulation, combustion) →
cycle optimization (superheater, economizer, cooling tower) → advanced thermal (Brayton gas
turbine, heat pumps, reheat) → the combined-cycle Grand Cycle. Some research nodes are gated by
*sustained efficiency milestones*, so you must actually get good, not just grind items.

`npm run sanity` proves the physics: Carnot is never exceeded across a parameter sweep, energy
balances exactly, an overloaded radiator spirals and trips, and a reference endgame plant
reaches the 55% win target and triggers victory.
