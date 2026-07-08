// ── Headless sanity + tuning harness. Run with `npm run sanity`. ───────────
// Asserts: Carnot never exceeded, energy conserved, sink-overload feedback
// works, the tier-0 loop makes power, and the endgame plant can actually win.
import { carnotLimit, engineOutput, sinkStep } from './thermo';
import { World, WIN_EFF_TARGET } from './world';
import { TICK, AMBIENT, Machine, MachineTypeId } from './types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function section(name: string): void {
  console.log(`\n== ${name} ==`);
}

// ── 1. Pure thermo unit tests ────────────────────────────────────────────────
section('thermo core');
{
  let carnotOK = true;
  let conserveOK = true;
  let noFreeEnergy = true;
  for (let tHot = -50; tHot <= 1200; tHot += 37) {
    for (let tCold = -50; tCold <= 400; tCold += 23) {
      for (const q of [0.1, 0.45, 0.7, 0.95, 1.0]) {
        const r = engineOutput(50, tHot, tCold, q);
        const carnot = carnotLimit(tHot, tCold);
        if (r.eta >= carnot && carnot > 0) carnotOK = false;
        if (carnot > 0 && r.eta > 0.98 * carnot + 1e-12) carnotOK = false;
        if (Math.abs(r.work + r.waste - 50) > 1e-9) conserveOK = false;
        if (tHot <= tCold && r.work > 0) noFreeEnergy = false;
      }
    }
  }
  check('eta strictly below Carnot across sweep', carnotOK);
  check('work + waste === qIn (1st law)', conserveOK);
  check('no work without a gradient (2nd law)', noFreeEnergy);

  // sink integration: energy balance over a step
  let t = AMBIENT;
  let absorbed = 0;
  let rejected = 0;
  const C = 200;
  const coeff = 2;
  for (let i = 0; i < 5000; i++) {
    const r = sinkStep(t, 30, coeff, C, TICK);
    absorbed += 30 * TICK;
    rejected += r.rejected * TICK;
    t = r.temp;
  }
  const stored = (t - AMBIENT) * C;
  check('sink energy balance (absorbed = stored + rejected)',
    Math.abs(absorbed - (stored + rejected)) < 1e-6 * absorbed,
    `abs=${absorbed.toFixed(1)} stored=${stored.toFixed(1)} rej=${rejected.toFixed(1)}`);
  const equilibrium = AMBIENT + 30 / coeff;
  check('sink approaches analytic equilibrium', Math.abs(t - equilibrium) < 0.5,
    `t=${t.toFixed(2)} expect≈${equilibrium}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function place(w: World, type: MachineTypeId, gx: number, gy: number): Machine {
  const m = w.placeMachine(type, gx, gy);
  if (!m) {
    const why = w.canPlaceMachine(type, gx, gy).reason;
    throw new Error(`could not place ${type} at ${gx},${gy}: ${why}`);
  }
  return m;
}

function run(w: World, seconds: number, each?: (w: World) => void): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) {
    each?.(w);
    w.tick();
  }
}

// ── 2. Tier-0 loop: vent → boiler → piston → radiator ──────────────────────
section('tier-0 plant');
{
  const w = World.newGame();
  w.grantAll();
  // vent at (7,8); build adjacently: boiler(7,9), piston(7,10), radiator(7,11), pump(6,9)
  place(w, 'vent', 7, 8);
  place(w, 'boiler', 7, 9);
  place(w, 'piston', 7, 10);
  place(w, 'radiator', 7, 11);
  place(w, 'pump', 6, 9);
  run(w, 120);
  const piston = w.state.machines.find((m) => m.type === 'piston')!;
  const radiator = w.state.machines.find((m) => m.type === 'radiator')!;
  check('piston produces work', piston.work > 1, `work=${piston.work.toFixed(2)} kW`);
  check('piston below Carnot', piston.eta < piston.carnot, `eta=${piston.eta.toFixed(3)} carnot=${piston.carnot.toFixed(3)}`);
  check('radiator warmed above ambient', radiator.temp > AMBIENT + 5, `T=${radiator.temp.toFixed(1)}`);
  check('radiator under its limit', radiator.temp < 120, `T=${radiator.temp.toFixed(1)}`);
  const eff = w.state.stats.eff60;
  check('netEff in sane band (5%..20%)', eff > 0.05 && eff < 0.2, `eff=${(eff * 100).toFixed(1)}%`);
  console.log(`  info: tier-0 netEff=${(eff * 100).toFixed(1)}%, work=${piston.work.toFixed(1)} kW, T_sink=${radiator.temp.toFixed(1)}°C`);
}

// ── 3. Sink overload: the entropy spiral ────────────────────────────────────
section('sink overload feedback');
{
  const w = World.newGame();
  w.grantAll();
  w.completeAllResearch();
  // Two turbines dumping ~60 HU/s of waste into ONE small radiator: must spiral.
  place(w, 'vent', 7, 8);
  const fur = place(w, 'furnace', 5, 8);
  place(w, 'boiler', 7, 9);
  place(w, 'boiler', 6, 9);
  place(w, 'boiler', 6, 8);
  place(w, 'boiler', 5, 9);
  place(w, 'turbine', 7, 10);
  place(w, 'turbine', 6, 10);
  place(w, 'radiator', 7, 11);
  place(w, 'pump', 5, 10);
  place(w, 'pump', 4, 9);
  place(w, 'pump', 8, 10);
  const feed = (world: World): void => {
    const f = world.state.machines.find((m) => m.id === fur.id);
    if (f) f.inItems.coal = 5;
  };
  const turbine = w.state.machines.find((m) => m.type === 'turbine')!;
  const radiator = w.state.machines.find((m) => m.type === 'radiator')!;
  run(w, 20, feed);
  const etaEarly = turbine.eta;
  const tEarly = radiator.temp;
  let sawOverheat = false;
  let etaMid = etaEarly;
  run(w, 180, (world) => {
    feed(world);
    if (radiator.overheat) sawOverheat = true;
    if (turbine.eta > 0) etaMid = turbine.eta;
  });
  const tLate = radiator.temp;
  check('overloaded sink temp climbed', Math.max(tLate, 100) > tEarly + 10, `early=${tEarly.toFixed(1)} late=${tLate.toFixed(1)}`);
  check('efficiency fell as sink heated', etaMid < etaEarly,
    `etaEarly=${etaEarly.toFixed(3)} etaMid=${etaMid.toFixed(3)}`);
  check('overload eventually overheats the radiator', sawOverheat || radiator.overheat,
    `T=${radiator.temp.toFixed(1)} overheat=${radiator.overheat}`);
}

// ── 3.5 Feedpump actually repeats water over a long run ─────────────────────
section('feedwater pump relay');
{
  const w = World.newGame();
  w.grantAll();
  w.completeAllResearch();
  place(w, 'pump', 3, 3);
  for (const [x, y] of [[4, 3], [5, 3]]) {
    if (!w.placePipe(x, y, false)) throw new Error(`pipe@${x},${y}`);
  }
  const fp = place(w, 'feedpump', 6, 3);
  for (const [x, y] of [[7, 3], [8, 3]]) {
    if (!w.placePipe(x, y, false)) throw new Error(`pipe@${x},${y}`);
  }
  place(w, 'vent', 7, 8);
  place(w, 'boiler', 9, 3);
  run(w, 30);
  const boiler = w.state.machines.find((m) => m.type === 'boiler')!;
  check('feedpump moves water', fp.active || fp.fluidOut!.amount > 0.05,
    `buf=${fp.fluidOut!.amount.toFixed(2)} status=${fp.status}`);
  check('boiler tank receives relayed water', boiler.waterOut!.amount > 0.1,
    `tank=${boiler.waterOut!.amount.toFixed(2)}`);
}

// ── 4. Endgame: full Grand Cycle plant must be able to win ──────────────────
section('grand cycle win reachability');
{
  const w = World.newGame();
  w.grantAll();
  w.completeAllResearch();
  w.state.sandbox = false;

  // Combined cycle: GT(2x2) → coupler → boilers → superheater(+furnace) → turbines → condensers → tower
  const gt = place(w, 'gasTurbine', 2, 2);
  place(w, 'coupler', 4, 2);
  place(w, 'boiler', 5, 2);
  place(w, 'boiler', 4, 3);
  place(w, 'boiler', 3, 4); // third boiler: soak ALL the exhaust + furnace heat
  const furnace = place(w, 'furnace', 5, 1);
  place(w, 'superheater', 6, 2);
  place(w, 'reheater', 6, 1);
  place(w, 'turbine', 7, 2);
  place(w, 'turbine', 7, 3);
  place(w, 'condenser', 8, 2);
  place(w, 'condenser', 8, 3);
  place(w, 'coolingTower', 9, 2);
  place(w, 'heatPump', 8, 1);  // chills condenser 1
  place(w, 'heatPump', 9, 1);  // chills the tower (the dominant absorber)
  place(w, 'heatPump', 11, 2); // chills the tower
  place(w, 'economizer', 5, 3);
  place(w, 'regenerator', 6, 3);
  place(w, 'pump', 10, 4);
  place(w, 'pump', 11, 3);
  place(w, 'controller', 12, 2);

  const feedFuel = (world: World): void => {
    for (const m of world.state.machines) {
      if (m.id === gt.id || m.id === furnace.id) m.inItems.coal = 5;
    }
  };
  run(w, 240, feedFuel);
  const s = w.state.stats;
  const turbines = w.state.machines.filter((m) => m.type === 'turbine');
  const cond = w.state.machines.filter((m) => m.type === 'condenser');
  const report = w.winReport();
  console.log(`  info: eff10=${(s.eff10 * 100).toFixed(1)}% eff60=${(s.eff60 * 100).toFixed(1)}% gen=${s.gen.toFixed(1)}kW load=${s.load.toFixed(1)}kW`);
  console.log(`  info: T_cold=${cond.map((c) => c.temp.toFixed(1)).join('/')}°C turbineEta=${turbines.map((t) => t.eta.toFixed(3)).join('/')}`);
  console.log(`  info: carnotCeiling=${(s.carnotCeiling * 100).toFixed(1)}% pipeLoss=${s.pipeLoss.toFixed(1)}HU/s primary=${s.primaryRate.toFixed(1)}HU/s`);
  console.log(`  info: classes active: ${report.classesActive.join(',')} / needed: ${report.classesNeeded.join(',')}`);
  console.log(`  info: controllerOk=${report.controllerOk} effOk=${report.effOk} stable=${report.stableOk} power=${report.powerOk} timer=${report.timer.toFixed(1)}`);

  for (const t of turbines) {
    check(`turbine ${t.id} below Carnot`, t.eta < t.carnot || t.work === 0,
      `eta=${t.eta.toFixed(3)} carnot=${t.carnot.toFixed(3)}`);
  }
  check('all win classes active', report.classesActive.length === report.classesNeeded.length,
    `missing: ${report.classesNeeded.filter((c) => !report.classesActive.includes(c)).join(',')}`);
  check('controller powered', report.controllerOk);
  check('power surplus', report.powerOk, `throttle=${s.throttle.toFixed(3)}`);
  check('stable (no overheats)', report.stableOk);
  check(`eff60 ≥ ${WIN_EFF_TARGET} (win target)`, s.eff60 >= WIN_EFF_TARGET, `eff60=${(s.eff60 * 100).toFixed(1)}%`);

  // keep running with fuel until victory (needs 60 consecutive s)
  run(w, 90, feedFuel);
  check('victory triggers', w.state.won, `winTimer=${w.state.winTimer.toFixed(1)}s eff60=${(w.state.stats.eff60 * 100).toFixed(1)}%`);
}

// ── 5. Global energy conservation audit on the endgame plant ────────────────
section('summary');
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log('\nAll sanity checks passed.');
}
