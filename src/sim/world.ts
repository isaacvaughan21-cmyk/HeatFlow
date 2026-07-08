// ── World: grid, placement, networks, and the fixed-timestep sim tick ──────
import {
  AMBIENT, DIRS, GameEvent, GameState, ITEM_NAMES, ItemId, MAP_H, MAP_W, Machine,
  MachineClass, MachineTypeId, PipeTile, SAVE_VERSION, StatBucket,
  TICK, TerrainType, WinReport, clamp, idx, inBounds,
} from './types';
import {
  PIPE_RETENTION, PIPE_RETENTION_INS, attenuateTemp, carnotLimit, engineOutput,
  heatPumpCOP, sinkStep, wasteTemp, WATER_HEAT_K, WATER_PER_HU,
} from './thermo';
import {
  AUX_POWER, BELT_RATE, BELT_TILE_CAP, BOILER_MAX_TEMP_BASE, BOILER_MAX_TEMP_HP,
  GAS_TURBINE_COMBUST_T, GAS_TURBINE_EXHAUST_T, HEATPUMP_MAX_PULL, INS_PIPE_COST,
  MACHINE_DEFS, MIN_SINK_TEMP, MachineDef, PIPE_COST, BELT_COST, REFUND_RATE,
  REHEATER_QUALITY_CAP, REHEATER_QUALITY_MULT, SMELT_MIN_TEMP, SUPERHEATER_MAX_T,
  TEG_INTERNAL_COLD, isEngine, isSink,
} from './machines';
import { RECIPES, Recipe, recipeById } from './recipes';
import { RESEARCH_NODES, machineUnlocked, nodeById, nodeRemaining } from './research';
import type { FluidType } from './types';

const WIN_EFF_TARGET = 0.55;
const WIN_HOLD_TIME = 60;
const WIN_CLASSES: MachineClass[] = [
  'source', 'boiler', 'superheater', 'engine', 'condenser', 'sink',
  'heatPump', 'regenerator', 'coupler',
];
const STAT_WINDOW = 120; // seconds of ring buffer

interface Received { q: number; t: number; }
type ReceivedMap = Map<number, Partial<Record<FluidType, Received>>>;
type DemandMap = Map<number, Partial<Record<FluidType, number>>>;

interface ThermalNetwork {
  machines: number[];
  tiles: number[];
  att: Map<string, number>; // "a-b" (a<b machine ids) -> retention 0..1
}

function attKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function mkBuf(fluid: FluidType, temp: number, cap: number) {
  return { fluid, amount: 0, temp, cap };
}

const DEPOSIT_ORE: Partial<Record<TerrainType, ItemId>> = {
  ironDeposit: 'ironOre', copperDeposit: 'copperOre',
  coalDeposit: 'coal', quartzDeposit: 'quartz',
};

export class World {
  state: GameState;
  occupancy: Int32Array; // machine id + 1, or 0
  networks: ThermalNetwork[] = [];
  netOf = new Map<number, number>(); // machine id -> network index
  dirty = true;
  events: GameEvent[] = [];
  private warnUntil = new Map<string, number>();
  /** per-tick scratch */
  private received: ReceivedMap = new Map();
  private demands: DemandMap = new Map();
  private drawn = new Map<number, number>(); // producer id -> HU drawn this tick
  private lossTick = 0;
  private primaryTick = 0;

  constructor(state: GameState) {
    this.state = state;
    this.occupancy = new Int32Array(MAP_W * MAP_H);
    this.rebuildOccupancy();
  }

  static newGame(): World {
    const terrain: TerrainType[] = new Array(MAP_W * MAP_H).fill('ground');
    const put = (t: TerrainType, spots: [number, number][]) => {
      for (const [x, y] of spots) terrain[idx(x, y)] = t;
    };
    put('vent', [[7, 8], [20, 7], [7, 21]]);
    put('ironDeposit', [[14, 17], [15, 17], [14, 18], [15, 18]]);
    put('copperDeposit', [[20, 16], [21, 16], [20, 17]]);
    put('coalDeposit', [[22, 10], [23, 10], [22, 11], [23, 11]]);
    put('quartzDeposit', [[16, 22], [17, 22], [16, 23]]);
    const buckets: StatBucket[] = [];
    for (let i = 0; i < STAT_WINDOW; i++) buckets.push({ work: 0, primary: 0 });
    const state: GameState = {
      version: SAVE_VERSION,
      time: 0,
      speed: 1,
      terrain,
      machines: [],
      nextId: 1,
      pipes: new Array(MAP_W * MAP_H).fill(null),
      belts: new Array(MAP_W * MAP_H).fill(null),
      inventory: { ironPlate: 60, ironIngot: 120, copperWire: 45 },
      research: { completed: [], active: null, progress: {}, bestSustained: 0 },
      stats: {
        buckets, bucketPos: 0, bucketFrac: 0,
        eff10: 0, eff30: 0, eff60: 0, carnotCeiling: 0,
        gen: 0, auxGen: AUX_POWER, load: 0, throttle: 1,
        primaryRate: 0, pipeLoss: 0, fuelUsed: 0,
      },
      winTimer: 0,
      won: false,
      sandbox: false,
      tutorialStep: 0,
    };
    return new World(state);
  }

  // ── lookups ───────────────────────────────────────────────────────────────
  defOf(m: Machine): MachineDef {
    return MACHINE_DEFS[m.type];
  }

  machineById(id: number): Machine | undefined {
    return this.state.machines.find((m) => m.id === id);
  }

  machineAt(gx: number, gy: number): Machine | undefined {
    if (!inBounds(gx, gy)) return undefined;
    const o = this.occupancy[idx(gx, gy)];
    return o > 0 ? this.machineById(o) : undefined;
  }

  footprint(m: Machine): [number, number][] {
    const s = this.defOf(m).size;
    const out: [number, number][] = [];
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) out.push([m.gx + dx, m.gy + dy]);
    return out;
  }

  boilerMaxTemp(): number {
    return this.state.research.completed.some((c) => nodeById(c)?.extra === 'hpBoiler')
      ? BOILER_MAX_TEMP_HP : BOILER_MAX_TEMP_BASE;
  }

  // ── inventory ─────────────────────────────────────────────────────────────
  canAfford(cost: Partial<Record<ItemId, number>>): boolean {
    for (const [item, n] of Object.entries(cost) as [ItemId, number][]) {
      if ((this.state.inventory[item] ?? 0) + 1e-6 < n) return false;
    }
    return true;
  }

  pay(cost: Partial<Record<ItemId, number>>): void {
    for (const [item, n] of Object.entries(cost) as [ItemId, number][]) {
      this.state.inventory[item] = Math.max(0, (this.state.inventory[item] ?? 0) - n);
    }
  }

  refund(cost: Partial<Record<ItemId, number>>): void {
    for (const [item, n] of Object.entries(cost) as [ItemId, number][]) {
      this.state.inventory[item] = (this.state.inventory[item] ?? 0) + Math.floor(n * REFUND_RATE);
    }
  }

  // ── placement ─────────────────────────────────────────────────────────────
  canPlaceMachine(type: MachineTypeId, gx: number, gy: number): { ok: boolean; reason: string } {
    const def = MACHINE_DEFS[type];
    if (!machineUnlocked(this.state.research, type, def.tier)) return { ok: false, reason: 'Locked — research required' };
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough materials' };
    for (let dx = 0; dx < def.size; dx++) {
      for (let dy = 0; dy < def.size; dy++) {
        const x = gx + dx; const y = gy + dy;
        if (!inBounds(x, y)) return { ok: false, reason: 'Out of bounds' };
        const i = idx(x, y);
        if (this.occupancy[i] !== 0 || this.state.pipes[i] || this.state.belts[i]) {
          return { ok: false, reason: 'Tile occupied' };
        }
        const terr = this.state.terrain[i];
        if (def.placeOn === 'vent') {
          if (terr !== 'vent') return { ok: false, reason: 'Must be placed on a vent tile' };
        } else if (def.placeOn === 'deposit') {
          if (!DEPOSIT_ORE[terr]) return { ok: false, reason: 'Must be placed on a deposit' };
        } else if (terr !== 'ground') {
          return { ok: false, reason: 'Cannot build on special tiles' };
        }
      }
    }
    return { ok: true, reason: '' };
  }

  placeMachine(type: MachineTypeId, gx: number, gy: number, rot = 0): Machine | null {
    if (!this.canPlaceMachine(type, gx, gy).ok) return null;
    const def = MACHINE_DEFS[type];
    this.pay(def.cost);
    const m: Machine = {
      id: this.state.nextId++, type, gx, gy, rot,
      temp: AMBIENT,
      fluidOut: null, waterOut: null,
      inItems: {}, outItems: {},
      recipe: type === 'smelter' ? 'ironIngot' : type === 'fabricator' ? 'ironPlate' : null,
      progress: 0,
      status: 'idle',
      work: 0, qIn: 0, qWaste: 0, tHot: AMBIENT, tCold: AMBIENT,
      eta: 0, carnot: 0, rejected: 0, powerUse: 0, throttle: 1,
      active: false, overheat: false, overheatT: 0,
    };
    this.initBuffers(m);
    this.state.machines.push(m);
    for (const [x, y] of this.footprint(m)) this.occupancy[idx(x, y)] = m.id;
    this.dirty = true;
    return m;
  }

  private initBuffers(m: Machine): void {
    switch (m.type) {
      case 'vent': m.fluidOut = mkBuf('heat', 180, 10); break;
      case 'furnace': m.fluidOut = mkBuf('heat', 550, 15); break;
      case 'gasTurbine': m.fluidOut = mkBuf('heat', GAS_TURBINE_EXHAUST_T, 25); break;
      case 'pump': m.fluidOut = mkBuf('water', AMBIENT, 3); break;
      case 'boiler':
        m.fluidOut = mkBuf('steam', AMBIENT, 9);
        m.waterOut = mkBuf('water', AMBIENT, 4); // feedwater tank (not offered)
        break;
      case 'superheater': m.fluidOut = mkBuf('steam', AMBIENT, 20); break;
      case 'piston': m.fluidOut = mkBuf('waste', AMBIENT, 10); break;
      case 'turbine': m.fluidOut = mkBuf('waste', AMBIENT, 20); break;
      case 'economizer': m.fluidOut = mkBuf('water', AMBIENT, 6); break;
      case 'regenerator': m.fluidOut = mkBuf('water', AMBIENT, 8); break;
      case 'feedpump': m.fluidOut = mkBuf('water', AMBIENT, 4); break;
      case 'exchanger': m.fluidOut = mkBuf('heat', AMBIENT, 12); break;
      case 'coupler': m.fluidOut = mkBuf('heat', AMBIENT, 20); break;
      case 'condenser': m.waterOut = mkBuf('water', AMBIENT, 5); break;
      default: break;
    }
  }

  canPlacePipe(gx: number, gy: number, insulated: boolean): boolean {
    if (!inBounds(gx, gy)) return false;
    const i = idx(gx, gy);
    if (this.occupancy[i] !== 0 || this.state.belts[i]) return false;
    if (insulated && !this.state.research.completed.includes('insulation')) return false;
    const existing = this.state.pipes[i];
    if (existing && existing.insulated === insulated) return false;
    return this.canAfford(insulated ? INS_PIPE_COST : PIPE_COST);
  }

  placePipe(gx: number, gy: number, insulated: boolean): boolean {
    if (!this.canPlacePipe(gx, gy, insulated)) return false;
    const i = idx(gx, gy);
    const existing = this.state.pipes[i];
    if (existing) this.refund(existing.insulated ? INS_PIPE_COST : PIPE_COST);
    this.pay(insulated ? INS_PIPE_COST : PIPE_COST);
    this.state.pipes[i] = { insulated, temp: AMBIENT, flow: 0 };
    this.dirty = true;
    return true;
  }

  canPlaceBelt(gx: number, gy: number): boolean {
    if (!inBounds(gx, gy)) return false;
    const i = idx(gx, gy);
    if (this.occupancy[i] !== 0 || this.state.pipes[i]) return false;
    if (this.state.belts[i]) return true; // rotation is free
    return this.canAfford(BELT_COST);
  }

  placeBelt(gx: number, gy: number, dir: 0 | 1 | 2 | 3): boolean {
    if (!this.canPlaceBelt(gx, gy)) return false;
    const i = idx(gx, gy);
    const existing = this.state.belts[i];
    if (existing) {
      existing.dir = dir;
    } else {
      this.pay(BELT_COST);
      this.state.belts[i] = { dir, items: {} };
    }
    return true;
  }

  removeAt(gx: number, gy: number): boolean {
    if (!inBounds(gx, gy)) return false;
    const i = idx(gx, gy);
    const m = this.machineAt(gx, gy);
    if (m) {
      this.refund(this.defOf(m).cost);
      for (const [x, y] of this.footprint(m)) this.occupancy[idx(x, y)] = 0;
      this.state.machines = this.state.machines.filter((o) => o.id !== m.id);
      this.dirty = true;
      return true;
    }
    if (this.state.pipes[i]) {
      this.refund(this.state.pipes[i]!.insulated ? INS_PIPE_COST : PIPE_COST);
      this.state.pipes[i] = null;
      this.dirty = true;
      return true;
    }
    if (this.state.belts[i]) {
      this.refund(BELT_COST);
      this.state.belts[i] = null;
      return true;
    }
    return false;
  }

  private rebuildOccupancy(): void {
    this.occupancy.fill(0);
    for (const m of this.state.machines) {
      for (const [x, y] of this.footprint(m)) this.occupancy[idx(x, y)] = m.id;
    }
  }

  // ── network building ──────────────────────────────────────────────────────
  rebuildNetworks(): void {
    this.networks = [];
    this.netOf.clear();
    const pipeNet = new Int32Array(MAP_W * MAP_H).fill(-1);
    const visitedM = new Set<number>();

    const pipeAt = (x: number, y: number): PipeTile | null =>
      inBounds(x, y) ? this.state.pipes[idx(x, y)] : null;

    for (const seed of this.state.machines) {
      if (visitedM.has(seed.id)) continue;
      const netIdx = this.networks.length;
      const net: ThermalNetwork = { machines: [], tiles: [], att: new Map() };
      // BFS over machines + pipes
      const mQueue: Machine[] = [seed];
      visitedM.add(seed.id);
      const tQueue: number[] = [];
      const tileSeen = new Set<number>();
      while (mQueue.length || tQueue.length) {
        if (mQueue.length) {
          const m = mQueue.pop()!;
          net.machines.push(m.id);
          this.netOf.set(m.id, netIdx);
          for (const [fx, fy] of this.footprint(m)) {
            for (const [dx, dy] of DIRS) {
              const x = fx + dx; const y = fy + dy;
              if (!inBounds(x, y)) continue;
              const i = idx(x, y);
              if (pipeAt(x, y) && !tileSeen.has(i)) { tileSeen.add(i); tQueue.push(i); }
              const om = this.machineAt(x, y);
              if (om && !visitedM.has(om.id)) { visitedM.add(om.id); mQueue.push(om); }
            }
          }
        } else {
          const i = tQueue.pop()!;
          net.tiles.push(i);
          pipeNet[i] = netIdx;
          const x = i % MAP_W; const y = Math.floor(i / MAP_W);
          for (const [dx, dy] of DIRS) {
            const nx = x + dx; const ny = y + dy;
            if (!inBounds(nx, ny)) continue;
            const ni = idx(nx, ny);
            if (pipeAt(nx, ny) && !tileSeen.has(ni)) { tileSeen.add(ni); tQueue.push(ni); }
            const om = this.machineAt(nx, ny);
            if (om && !visitedM.has(om.id)) { visitedM.add(om.id); mQueue.push(om); }
          }
        }
      }
      if (net.machines.length > 1 || net.tiles.length > 0) {
        this.computeAttenuation(net);
      }
      this.networks.push(net);
    }
    this.dirty = false;
  }

  /** Dijkstra per machine: path retention = product of per-pipe-tile retention. */
  private computeAttenuation(net: ThermalNetwork): void {
    // node ids: pipe tiles by map index; machines by 1e6 + id
    const MOFF = 1_000_000;
    const nodeCost = new Map<number, number>(); // -log retention of entering node
    const adj = new Map<number, number[]>();
    const addEdge = (a: number, b: number) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    };
    const tileSet = new Set(net.tiles);
    for (const t of net.tiles) {
      const p = this.state.pipes[t]!;
      nodeCost.set(t, -Math.log(p.insulated ? PIPE_RETENTION_INS : PIPE_RETENTION));
      const x = t % MAP_W; const y = Math.floor(t / MAP_W);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx; const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (tileSet.has(ni) && ni > t) addEdge(t, ni);
      }
    }
    const machines = net.machines.map((id) => this.machineById(id)!).filter(Boolean);
    for (const m of machines) {
      nodeCost.set(MOFF + m.id, 0);
      for (const [fx, fy] of this.footprint(m)) {
        for (const [dx, dy] of DIRS) {
          const x = fx + dx; const y = fy + dy;
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (tileSet.has(i)) addEdge(MOFF + m.id, i);
          const om = this.machineAt(x, y);
          if (om && om.id !== m.id) addEdge(MOFF + m.id, MOFF + om.id);
        }
      }
    }
    // Dijkstra from each machine (naive; networks are small)
    for (const src of machines) {
      const dist = new Map<number, number>();
      dist.set(MOFF + src.id, 0);
      const visited = new Set<number>();
      for (;;) {
        let best = -1; let bd = Infinity;
        for (const [n, d] of dist) {
          if (!visited.has(n) && d < bd) { bd = d; best = n; }
        }
        if (best === -1) break;
        visited.add(best);
        for (const nb of adj.get(best) ?? []) {
          if (visited.has(nb)) continue;
          const nd = bd + (nodeCost.get(nb) ?? 0);
          if (nd < (dist.get(nb) ?? Infinity)) dist.set(nb, nd);
        }
      }
      for (const other of machines) {
        if (other.id <= src.id) continue;
        const d = dist.get(MOFF + other.id);
        if (d !== undefined) net.att.set(attKey(src.id, other.id), Math.exp(-d));
      }
    }
  }

  attBetween(net: ThermalNetwork, a: number, b: number): number {
    if (a === b) return 1;
    return net.att.get(attKey(a, b)) ?? 0;
  }

  // ── the sim tick ──────────────────────────────────────────────────────────
  tick(): void {
    const st = this.state;
    const dt = TICK;
    if (this.dirty) {
      this.rebuildOccupancy();
      this.rebuildNetworks();
    }
    this.received.clear();
    this.demands.clear();
    this.drawn.clear();
    this.lossTick = 0;
    this.primaryTick = 0;
    for (const m of st.machines) { m.active = false; }
    for (const p of st.pipes) {
      if (p) {
        p.flow *= 0.85;
        p.temp += (AMBIENT - p.temp) * 0.01;
      }
    }

    // 1. demands, 2. resolve flows per network per fluid
    for (const m of st.machines) this.demands.set(m.id, this.computeDemands(m, dt));
    for (const net of this.networks) {
      for (const fluid of ['heat', 'steam', 'water', 'waste'] as FluidType[]) {
        this.resolveFluid(net, fluid);
      }
    }

    // 3. thermal machine processing
    for (const m of st.machines) this.processThermal(m, dt);

    // 4. sink integration + overheat bookkeeping
    for (const m of st.machines) this.updateSinkAndOverheat(m, dt);

    // 5. power grid + powered machines
    this.powerPhase(dt);

    // 6. belts
    this.beltPhase(dt);

    // 7-9. stats, win, warnings
    this.statsPhase(dt);
    this.winPhase(dt);
    this.warningsPhase();

    st.time += dt;
  }

  private recv(m: Machine, fluid: FluidType): Received {
    return this.received.get(m.id)?.[fluid] ?? { q: 0, t: AMBIENT };
  }

  private bufSpace(b: { amount: number; cap: number } | null): number {
    return b ? Math.max(0, b.cap - b.amount) : 0;
  }

  private addToBuf(b: { amount: number; temp: number; cap: number }, q: number, t: number): void {
    if (q <= 0) return;
    const total = b.amount + q;
    b.temp = total > 0 ? (b.temp * b.amount + t * q) / total : t;
    b.amount = total;
  }

  /** What each machine wants to draw this tick, per fluid (absolute units). */
  private computeDemands(m: Machine, dt: number): Partial<Record<FluidType, number>> {
    const def = this.defOf(m);
    const d: Partial<Record<FluidType, number>> = {};
    if (m.overheat) return d;
    switch (m.type) {
      case 'boiler': {
        const space = this.bufSpace(m.fluidOut);
        const waterTank = m.waterOut; // boiler stores feedwater in waterOut buffer
        const waterAvail = waterTank ? waterTank.amount : 0;
        d.heat = Math.max(0, Math.min(def.throughput! * dt, space, waterAvail / WATER_PER_HU));
        if (waterTank) d.water = this.bufSpace(waterTank);
        break;
      }
      case 'piston': case 'turbine': {
        if (!this.engineHasSink(m)) break;
        d.steam = Math.max(0, Math.min(def.capacity! * dt, this.bufSpace(m.fluidOut)));
        break;
      }
      case 'teg': {
        d.heat = def.capacity! * dt;
        break;
      }
      case 'superheater': {
        const space = this.bufSpace(m.fluidOut);
        d.steam = Math.max(0, Math.min(def.throughput! * 0.7 * dt, space * 0.7));
        // heat demand follows actual steam flow (m.qWaste remembers last tick's
        // steam intake) — no steam, no superheating, just a probe trickle
        const heatCap = Math.max(0.05 * dt, 2 * m.qWaste * dt);
        d.heat = Math.max(0, Math.min(def.throughput! * 0.3 * dt, space * 0.3, heatCap));
        break;
      }
      case 'reheater': {
        d.steam = def.throughput! * dt; // operating bleed, dumped as loss
        break;
      }
      case 'economizer': case 'regenerator': {
        const buf = m.fluidOut!;
        d.water = this.bufSpace(buf);
        const maxT = m.type === 'economizer' ? 120 : 200;
        // 2nd law: water can only be heated toward the waste temp we actually see
        const capT = Math.min(maxT, m.tHot);
        const need = Math.max(0, buf.amount * WATER_HEAT_K * (capT - buf.temp));
        d.waste = Math.min(def.throughput! * dt, need + 0.05 * dt); // + probe trickle
        break;
      }
      case 'exchanger': {
        const space = this.bufSpace(m.fluidOut);
        d.heat = Math.min(def.throughput! * dt * 0.5, space * 0.5);
        d.steam = Math.min(def.throughput! * dt * 0.5, space * 0.5);
        break;
      }
      case 'coupler': {
        d.heat = Math.min(def.throughput! * dt, this.bufSpace(m.fluidOut));
        break;
      }
      case 'feedpump': {
        d.water = Math.max(0, Math.min(def.throughput! * dt, this.bufSpace(m.fluidOut)));
        break;
      }
      case 'smelter': {
        const r = m.recipe ? recipeById(m.recipe) : undefined;
        if (r && this.canCraft(m, r)) d.heat = def.throughput! * dt;
        break;
      }
      case 'condenser': case 'radiator': case 'coolingTower': {
        if (m.temp < def.maxTemp) d.waste = this.sinkIntakeRate(def, m.temp) * dt;
        break;
      }
      default: break;
    }
    return d;
  }

  private canCraft(m: Machine, r: Recipe): boolean {
    if (m.progress > 0) return true;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      if ((m.inItems[item] ?? 0) < n) return false;
    }
    const outHave = m.outItems[r.output] ?? 0;
    return outHave < 20;
  }

  private engineHasSink(m: Machine): boolean {
    const netI = this.netOf.get(m.id);
    if (netI === undefined) return false;
    const net = this.networks[netI];
    for (const id of net.machines) {
      const s = this.machineById(id);
      if (!s || s.id === m.id) continue;
      const sd = this.defOf(s);
      if (isSink(sd) && !s.overheat) return true;
      // waste can also be consumed by economizers/regenerators/exchangers
      if ((s.type === 'economizer' || s.type === 'regenerator') && !s.overheat) continue;
    }
    return false;
  }

  /** Sinks soak greedily into their thermal mass until they trip overheat. */
  private sinkIntakeRate(def: MachineDef, temp: number): number {
    return Math.max(0, (def.thermalMass! * (def.maxTemp + 40 - temp)) / 30);
  }

  /** Cold temp an engine sees: sink temps weighted by where waste actually flows
   *  (intake share), so a big hot tower can't be masked by one chilled radiator. */
  private coldSideTemp(m: Machine): number | null {
    const netI = this.netOf.get(m.id);
    if (netI === undefined) return null;
    const net = this.networks[netI];
    let wSum = 0; let tSum = 0;
    for (const id of net.machines) {
      const s = this.machineById(id);
      if (!s || s.overheat) continue;
      const sd = this.defOf(s);
      if (!isSink(sd)) continue;
      const w = this.sinkIntakeRate(sd, s.temp);
      wSum += w;
      tSum += s.temp * w;
    }
    return wSum > 0 ? tSum / wSum : null;
  }

  private reheaterBoost(m: Machine): number {
    const netI = this.netOf.get(m.id);
    if (netI === undefined) return 1;
    const net = this.networks[netI];
    for (const id of net.machines) {
      const s = this.machineById(id);
      if (s && s.type === 'reheater' && s.active) return REHEATER_QUALITY_MULT;
    }
    return 1;
  }

  /** Recyclers (economizer/regenerator) claim waste before sinks destroy it. */
  private demandPriority(m: Machine, fluid: FluidType): number {
    if (fluid === 'waste' && (m.type === 'economizer' || m.type === 'regenerator')) return 0;
    if (fluid === 'waste') return 1;
    if (fluid === 'water' && m.type === 'feedpump') return 1; // repeaters yield to boilers
    return 0;
  }

  private resolveFluid(net: ThermalNetwork, fluid: FluidType): void {
    interface Offer { m: Machine; buf: { amount: number; temp: number; cap: number }; }
    const offers: Offer[] = [];
    const groups = new Map<number, { m: Machine; amount: number }[]>();
    for (const id of net.machines) {
      const m = this.machineById(id);
      if (!m) continue;
      if (!m.overheat) {
        for (const buf of [m.fluidOut, m.waterOut]) {
          if (!buf || buf.fluid !== fluid || buf.amount <= 1e-9) continue;
          if (m.type === 'boiler' && buf === m.waterOut) continue; // feedwater tank is private
          offers.push({ m, buf });
        }
      }
      const dem = this.demands.get(id)?.[fluid] ?? 0;
      if (dem > 1e-9) {
        const p = this.demandPriority(m, fluid);
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p)!.push({ m, amount: dem });
      }
    }
    if (!offers.length || !groups.size) return;
    let moved = 0; let movedTemp = 0;
    const priorities = [...groups.keys()].sort((a, b) => a - b);
    for (const p of priorities) {
      const consumers = groups.get(p)!;
      const totalOffer = offers.reduce((s, o) => s + o.buf.amount, 0);
      if (totalOffer <= 1e-9) break;
      const shares = offers.map((o) => o.buf.amount / totalOffer);
      const totalDemand = consumers.reduce((s, c) => s + c.amount, 0);
      const scale = Math.min(1, totalOffer / totalDemand);
      for (const c of consumers) {
        const gross = c.amount * scale;
        if (gross <= 0) continue;
        let recvQ = 0; let recvTQ = 0;
        for (let oi = 0; oi < offers.length; oi++) {
          const o = offers[oi];
          if (o.m.id === c.m.id) continue; // never satisfy a machine's demand from its own buffer
          const x = Math.min(gross * shares[oi], o.buf.amount);
          if (x <= 0) continue;
          const att = this.attBetween(net, o.m.id, c.m.id);
          const delivered = x * att;
          const tArr = attenuateTemp(o.buf.temp, att);
          o.buf.amount = Math.max(0, o.buf.amount - x);
          recvQ += delivered;
          recvTQ += delivered * tArr;
          if (fluid === 'water') {
            // water units are not HU: book the lost sensible heat, not the mass
            this.lossTick += (x - delivered) * WATER_HEAT_K * Math.max(0, o.buf.temp - AMBIENT)
              + delivered * WATER_HEAT_K * Math.max(0, o.buf.temp - tArr);
          } else {
            this.lossTick += x - delivered;
          }
          this.drawn.set(o.m.id, (this.drawn.get(o.m.id) ?? 0) + x);
          if (this.defOf(o.m).cls === 'source') this.primaryTick += x;
          moved += x; movedTemp = Math.max(movedTemp, o.buf.temp);
        }
        if (recvQ > 0) {
          const rec = this.received.get(c.m.id) ?? {};
          const prev = rec[fluid];
          const t = recvTQ / recvQ;
          rec[fluid] = prev
            ? { q: prev.q + recvQ, t: (prev.t * prev.q + t * recvQ) / (prev.q + recvQ) }
            : { q: recvQ, t };
          this.received.set(c.m.id, rec);
        }
      }
    }
    // pipe render telemetry
    if (moved > 0) {
      for (const t of net.tiles) {
        const p = this.state.pipes[t];
        if (p) {
          p.flow = Math.max(p.flow, moved / TICK);
          p.temp = Math.max(p.temp, movedTemp);
        }
      }
    }
  }

  private processThermal(m: Machine, dt: number): void {
    const def = this.defOf(m);
    const st = this.state;
    switch (m.type) {
      case 'vent': {
        const buf = m.fluidOut!;
        buf.temp = def.sourceTemp!;
        buf.amount = Math.min(buf.cap, buf.amount + def.sourceRate! * dt);
        const drew = this.drawn.get(m.id) ?? 0;
        m.qIn = drew / dt;
        m.active = drew > 1e-6;
        m.status = m.active ? 'ok' : 'idle';
        m.temp = def.sourceTemp!;
        break;
      }
      case 'furnace': {
        const buf = m.fluidOut!;
        buf.temp = def.sourceTemp!;
        const space = this.bufSpace(buf);
        const coal = m.inItems.coal ?? 0;
        const burn = Math.min(def.sourceRate! * dt, space, coal * def.fuelEnergy!);
        if (burn > 0) {
          const used = burn / def.fuelEnergy!;
          m.inItems.coal = coal - used;
          st.stats.fuelUsed += used;
          this.primaryTick += 0; // primary booked on draw (source cls)
          this.addToBuf(buf, burn, def.sourceTemp!);
        }
        const drew = this.drawn.get(m.id) ?? 0;
        m.qIn = drew / dt;
        m.active = drew > 1e-6;
        m.status = coal <= 0.01 && space > buf.cap * 0.5 ? 'noFuel' : m.active ? 'ok' : 'idle';
        m.temp = def.sourceTemp!;
        break;
      }
      case 'boiler': {
        const heat = this.recv(m, 'heat');
        const water = this.recv(m, 'water');
        const tank = m.waterOut!;
        if (water.q > 0) this.addToBuf(tank, water.q, water.t);
        if (heat.q > 0) {
          const waterUsed = Math.min(tank.amount, heat.q * WATER_PER_HU);
          const steamQ = waterUsed / WATER_PER_HU;
          const usable = Math.min(heat.q, steamQ);
          const preheat = Math.max(0, waterUsed * WATER_HEAT_K * (tank.temp - AMBIENT));
          tank.amount -= waterUsed;
          const tSteam = Math.min(heat.t, this.boilerMaxTemp());
          this.addToBuf(m.fluidOut!, usable + preheat, tSteam);
          this.lossTick += heat.q - usable; // dry-fired excess, if any
          m.qIn = heat.q / dt;
          m.tHot = heat.t;
          m.active = usable > 1e-6;
          m.status = m.active ? 'ok' : 'noWater';
          m.temp = tSteam;
        } else {
          m.qIn = 0;
          m.active = false;
          m.status = tank.amount < 0.05 ? 'noWater' : 'noHeat';
        }
        break;
      }
      case 'piston': case 'turbine': {
        const steam = this.recv(m, 'steam');
        const tCold = this.coldSideTemp(m);
        if (steam.q > 0 && tCold !== null) {
          const boost = this.reheaterBoost(m);
          const quality = Math.min(REHEATER_QUALITY_CAP, def.quality! * boost);
          const res = engineOutput(steam.q / dt, steam.t, tCold, quality);
          m.work = res.work;
          m.qIn = steam.q / dt;
          m.qWaste = res.waste;
          m.eta = res.eta;
          m.carnot = res.carnot;
          m.tHot = steam.t;
          m.tCold = tCold;
          m.temp = steam.t;
          this.addToBuf(m.fluidOut!, res.waste * dt, wasteTemp(steam.t, tCold));
          m.active = res.work > 1e-6;
          m.status = m.active ? 'ok' : 'lowTemp';
          if (steam.t > def.maxTemp) m.overheatT += dt;
          else m.overheatT = Math.max(0, m.overheatT - dt);
          if (m.overheatT > 3) {
            m.overheat = true;
            m.overheatT = 0;
            m.temp = steam.t;
            this.pushEvent(`overheat-${m.id}`, `${def.name} overheated! (${Math.round(steam.t)} °C > ${def.maxTemp} °C max)`, 'warn', 40);
          }
        } else {
          m.work = 0; m.qIn = 0; m.qWaste = 0; m.eta = 0;
          m.active = false;
          m.status = m.overheat ? 'overheat' : tCold === null ? 'noSink' : 'noSteam';
        }
        if (m.overheat) {
          m.overheatT += dt;
          if (m.overheatT > 8) { m.overheat = false; m.overheatT = 0; }
          m.status = 'overheat';
          if (m.work > 0) this.lossTick += m.work * dt; // latch tick: work already split from waste
          m.work = 0;
        }
        break;
      }
      case 'teg': {
        const heat = this.recv(m, 'heat');
        if (heat.q > 0) {
          const res = engineOutput(heat.q / dt, heat.t, TEG_INTERNAL_COLD, def.quality!);
          m.work = res.work;
          m.qIn = heat.q / dt;
          m.qWaste = res.waste;
          m.eta = res.eta; m.carnot = res.carnot;
          m.tHot = heat.t; m.tCold = TEG_INTERNAL_COLD;
          this.lossTick += res.waste * dt; // self-rejects to ambient
          m.active = res.work > 1e-6;
          m.status = m.active ? 'ok' : 'lowTemp';
        } else {
          m.work = 0; m.qIn = 0; m.active = false; m.status = 'noHeat';
        }
        break;
      }
      case 'gasTurbine': {
        const buf = m.fluidOut!;
        const coal = m.inItems.coal ?? 0;
        const carnot = carnotLimit(GAS_TURBINE_COMBUST_T, GAS_TURBINE_EXHAUST_T);
        const eta = Math.min(0.98 * carnot, def.quality! * carnot);
        const q = Math.min(def.capacity! * dt, coal * def.fuelEnergy!);
        if (q > 0) {
          const used = q / def.fuelEnergy!;
          m.inItems.coal = coal - used;
          st.stats.fuelUsed += used;
          this.primaryTick += q;
          const waste = q * (1 - eta);
          m.work = (q * eta) / dt;
          m.qIn = q / dt;
          m.qWaste = waste / dt;
          m.eta = eta; m.carnot = carnot;
          m.tHot = GAS_TURBINE_COMBUST_T; m.tCold = GAS_TURBINE_EXHAUST_T;
          m.temp = GAS_TURBINE_EXHAUST_T;
          const space = this.bufSpace(buf);
          const toBuf = Math.min(space, waste);
          this.addToBuf(buf, toBuf, GAS_TURBINE_EXHAUST_T);
          this.lossTick += waste - toBuf; // vented exhaust (simple cycle)
          m.active = true;
          m.status = 'ok';
        } else {
          m.work = 0; m.qIn = 0; m.active = false; m.status = 'noFuel';
        }
        break;
      }
      case 'superheater': {
        const steam = this.recv(m, 'steam');
        const heat = this.recv(m, 'heat');
        m.qWaste = steam.q / dt; // remembered for next tick's heat demand
        // no free steam from raw heat: heat mixed in is capped by real steam flow
        const usable = Math.min(heat.q, 2 * steam.q);
        this.lossTick += heat.q - usable;
        const total = steam.q + usable;
        if (total > 0 && steam.q > 1e-9) {
          let t = (steam.q * steam.t + usable * heat.t) / total;
          t = Math.min(t, SUPERHEATER_MAX_T);
          this.addToBuf(m.fluidOut!, total, t);
          m.qIn = total / dt;
          m.tHot = t;
          m.temp = t;
          m.active = true;
          m.status = 'ok';
        } else {
          m.qIn = 0; m.active = false; m.status = 'noSteam';
        }
        break;
      }
      case 'reheater': {
        const steam = this.recv(m, 'steam');
        this.lossTick += steam.q; // operating bleed
        m.qIn = steam.q / dt;
        m.active = steam.q > this.defOf(m).throughput! * dt * 0.5;
        m.status = m.active ? 'ok' : 'noSteam';
        m.temp = steam.t;
        break;
      }
      case 'economizer': case 'regenerator': {
        const buf = m.fluidOut!;
        const water = this.recv(m, 'water');
        const heat = this.recv(m, 'waste');
        if (water.q > 0) this.addToBuf(buf, water.q, water.t);
        if (heat.q > 0) m.tHot = heat.t; // remember waste temp for next tick's demand
        if (heat.q > 0 && buf.amount > 0.01) {
          const maxT = m.type === 'economizer' ? 120 : 200;
          const capT = Math.min(maxT, Math.max(buf.temp, heat.t));
          const denom = buf.amount * WATER_HEAT_K;
          const absorbed = Math.min(heat.q, Math.max(0, denom * (capT - buf.temp)));
          buf.temp += absorbed / denom;
          this.lossTick += heat.q - absorbed;
          m.qIn = heat.q / dt;
          m.active = absorbed > 1e-6;
        } else {
          this.lossTick += heat.q;
          m.qIn = heat.q / dt;
          m.active = false;
        }
        m.temp = buf.temp;
        m.status = m.active ? 'ok' : buf.amount < 0.05 ? 'noWater' : 'noHeat';
        break;
      }
      case 'exchanger': {
        const heat = this.recv(m, 'heat');
        const steam = this.recv(m, 'steam');
        const total = heat.q + steam.q;
        if (total > 0) {
          const t = (heat.q * heat.t + steam.q * steam.t) / total;
          const out = total * 0.97;
          this.addToBuf(m.fluidOut!, out, attenuateTemp(t, 0.97));
          this.lossTick += total - out;
          m.qIn = total / dt;
          m.temp = t;
          m.active = true;
          m.status = 'ok';
        } else {
          m.qIn = 0; m.active = false; m.status = 'noHeat';
        }
        break;
      }
      case 'coupler': {
        const heat = this.recv(m, 'heat');
        if (heat.q > 0) {
          this.addToBuf(m.fluidOut!, heat.q, heat.t);
          m.qIn = heat.q / dt;
          m.temp = heat.t;
          m.active = true;
          m.status = 'ok';
        } else {
          m.qIn = 0; m.active = false; m.status = 'noHeat';
        }
        break;
      }
      case 'smelter': {
        const heat = this.recv(m, 'heat');
        m.qIn = heat.q / dt;
        m.tHot = heat.t;
        m.temp = heat.t;
        // crafting handled in power phase; here we just record heat
        break;
      }
      case 'condenser': case 'radiator': case 'coolingTower': {
        // absorption + rejection handled in updateSinkAndOverheat
        break;
      }
      default: break;
    }
  }

  private updateSinkAndOverheat(m: Machine, dt: number): void {
    const def = this.defOf(m);
    if (!isSink(def)) return;
    const heat = this.recv(m, 'waste');
    // 2nd law: a stream can't heat a sink hotter than itself. Colder-than-sink
    // arrivals bypass to ambient (the pipe run itself acted as the radiator).
    let qAbs = heat.q;
    if (heat.q > 0) {
      const maxByTemp = Math.max(0, (heat.t - m.temp) * def.thermalMass!); // HU that would equalize
      qAbs = Math.min(heat.q, maxByTemp);
      this.lossTick += heat.q - qAbs;
    }
    // condenser water return: cap-limited, and its enthalpy comes OUT of the absorbed heat
    if (m.type === 'condenser' && qAbs > 0) {
      const wq = Math.min(this.bufSpace(m.waterOut), qAbs / 32);
      if (wq > 0) {
        const wTemp = Math.max(AMBIENT, m.temp);
        this.addToBuf(m.waterOut!, wq, wTemp);
        qAbs = Math.max(0, qAbs - wq * WATER_HEAT_K * (wTemp - AMBIENT));
      }
    }
    const powered = def.powerDraw > 0 ? m.throttle : 1;
    const res = sinkStep(m.temp, qAbs / dt, def.rejectCoeff! * powered, def.thermalMass!, dt);
    m.temp = clamp(res.temp, MIN_SINK_TEMP, 1000);
    m.rejected = res.rejected;
    m.qIn = qAbs / dt;
    m.active = heat.q > 1e-6 || res.rejected > 0.5;
    if (m.temp > def.maxTemp && !m.overheat) {
      m.overheat = true;
      this.pushEvent(`sinkOver-${m.id}`, `${def.name} over max temp — it stopped accepting heat. Engines will stall!`, 'warn', 12);
    } else if (m.overheat && m.temp < def.maxTemp - 15) {
      m.overheat = false;
    }
    m.status = m.overheat ? 'overheat' : m.active ? 'ok' : 'idle';
  }

  private powerPhase(dt: number): void {
    const st = this.state;
    let gen = 0;
    for (const m of st.machines) gen += m.work;
    // loads
    interface Load { m: Machine; kw: number; }
    const loads: Load[] = [];
    for (const m of st.machines) {
      const def = this.defOf(m);
      if (def.powerDraw <= 0) continue;
      let wants = false;
      switch (m.type) {
        case 'pump': wants = this.bufSpace(m.fluidOut) > 0.01; break;
        case 'miner': wants = this.minerOre(m) !== null && (m.outItems[this.minerOre(m)!] ?? 0) < 20; break;
        case 'smelter': { const r = m.recipe ? recipeById(m.recipe) : undefined; wants = !!r && this.canCraft(m, r); break; }
        case 'fabricator': { const r = m.recipe ? recipeById(m.recipe) : undefined; wants = !!r && this.canCraft(m, r); break; }
        case 'lab': wants = st.research.active !== null && this.labHasFeed(m); break;
        case 'condenser': case 'coolingTower': wants = m.temp > AMBIENT + 1; break;
        case 'heatPump': wants = this.heatPumpTargets(m).some((s) => s.temp > MIN_SINK_TEMP + 1); break;
        case 'controller': wants = true; break;
        case 'feedpump': wants = this.bufSpace(m.fluidOut) > 0.01; break;
        default: wants = false;
      }
      if (wants) loads.push({ m, kw: def.powerDraw });
    }
    const totalLoad = loads.reduce((s, l) => s + l.kw, 0);
    const avail = gen + AUX_POWER;
    const throttle = totalLoad > 0 ? Math.min(1, avail / totalLoad) : 1;
    st.stats.gen = gen;
    st.stats.auxGen = AUX_POWER;
    st.stats.load = totalLoad;
    st.stats.throttle = throttle;
    for (const m of st.machines) { m.powerUse = 0; m.throttle = 1; }
    for (const { m, kw } of loads) {
      m.powerUse = kw * throttle;
      m.throttle = throttle;
    }
    // run powered machines
    for (const { m } of loads) this.runPowered(m, dt);
    // idle statuses for unpowered producers
    for (const m of st.machines) {
      if (m.throttle < 0.5 && m.powerUse > 0) m.status = 'noPower';
    }
  }

  private minerOre(m: Machine): ItemId | null {
    const terr = this.state.terrain[idx(m.gx, m.gy)];
    return DEPOSIT_ORE[terr] ?? null;
  }

  private labHasFeed(m: Machine): boolean {
    const st = this.state;
    if (!st.research.active) return false;
    const node = nodeById(st.research.active);
    if (!node) return false;
    const rem = nodeRemaining(st.research, node);
    return (Object.keys(rem) as ItemId[]).some((i) => (m.inItems[i] ?? 0) > 0);
  }

  heatPumpTargets(m: Machine): Machine[] {
    const out: Machine[] = [];
    for (const [fx, fy] of this.footprint(m)) {
      for (const [dx, dy] of DIRS) {
        const s = this.machineAt(fx + dx, fy + dy);
        if (s && isSink(this.defOf(s)) && !out.includes(s)) out.push(s);
      }
    }
    return out;
  }

  private runPowered(m: Machine, dt: number): void {
    const st = this.state;
    const def = this.defOf(m);
    const thr = m.throttle;
    switch (m.type) {
      case 'pump': {
        const buf = m.fluidOut!;
        this.addToBuf(buf, Math.min(this.bufSpace(buf), def.throughput! * thr * dt), AMBIENT);
        m.active = thr > 0.1;
        m.status = thr < 0.5 ? 'noPower' : 'ok';
        break;
      }
      case 'feedpump': {
        // acts as repeater: demand/receive handled in fluid phase; move received water out
        const water = this.recv(m, 'water');
        if (water.q > 0) this.addToBuf(m.fluidOut!, water.q, water.t);
        m.active = water.q > 1e-6;
        m.status = m.active ? 'ok' : 'idle';
        break;
      }
      case 'miner': {
        const ore = this.minerOre(m);
        if (ore) {
          m.outItems[ore] = Math.min(20, (m.outItems[ore] ?? 0) + def.throughput! * thr * dt);
          m.active = thr > 0.1;
          m.status = thr < 0.5 ? 'noPower' : 'ok';
        }
        break;
      }
      case 'smelter': case 'fabricator': {
        const r = m.recipe ? recipeById(m.recipe) : undefined;
        if (!r) { m.status = 'idle'; break; }
        const heatOK = m.type === 'fabricator' || (m.qIn > def.throughput! * 0.5 && m.tHot >= SMELT_MIN_TEMP);
        if (m.type === 'smelter' && !heatOK) {
          m.status = m.tHot < SMELT_MIN_TEMP && m.qIn > 0.1 ? 'lowTemp' : 'noHeat';
          break;
        }
        if (m.progress === 0) {
          if (!this.canCraft(m, r)) { m.status = 'idle'; break; }
          for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
            m.inItems[item] = (m.inItems[item] ?? 0) - n;
          }
          m.progress = 1e-6;
        }
        m.progress += thr * dt;
        m.active = thr > 0.1;
        m.status = thr < 0.5 ? 'noPower' : 'ok';
        if (m.progress >= r.time) {
          m.outItems[r.output] = (m.outItems[r.output] ?? 0) + r.outCount;
          m.progress = 0;
        }
        break;
      }
      case 'lab': {
        const rs = st.research;
        if (!rs.active) { m.status = 'idle'; break; }
        const node = nodeById(rs.active);
        if (!node) { rs.active = null; break; }
        const rem = nodeRemaining(rs, node);
        let budget = 1 * thr * dt; // items/s feed rate
        let fed = false;
        for (const [item, need] of Object.entries(rem) as [ItemId, number][]) {
          if (budget <= 0) break;
          const have = m.inItems[item] ?? 0;
          if (have <= 0) continue;
          const eat = Math.min(budget, have, need);
          m.inItems[item] = have - eat;
          const prog = rs.progress[node.id] ?? (rs.progress[node.id] = {});
          prog[item] = (prog[item] ?? 0) + eat;
          budget -= eat;
          fed = true;
        }
        m.active = fed;
        m.status = fed ? 'ok' : 'idle';
        if (fed && Object.keys(nodeRemaining(rs, node)).length === 0) {
          rs.completed.push(node.id);
          rs.active = null;
          this.pushEvent(`research-${node.id}`, `Research complete: ${node.name}!`, 'good', 0);
        }
        break;
      }
      case 'heatPump': {
        const targets = this.heatPumpTargets(m);
        if (!targets.length) { m.status = 'idle'; m.active = false; break; }
        const power = def.powerDraw * thr;
        let pulled = 0;
        for (const s of targets) {
          const sd = this.defOf(s);
          const cop = heatPumpCOP(s.temp);
          const q = Math.min(HEATPUMP_MAX_PULL / targets.length, (cop * power) / targets.length);
          const before = s.temp;
          s.temp = clamp(s.temp - (q * dt) / sd.thermalMass!, MIN_SINK_TEMP, 1000);
          pulled += (before - s.temp) * sd.thermalMass! / dt;
        }
        m.qIn = pulled;
        // powered + attached counts as active even when the sink is pinned cold
        m.active = pulled > 0.01 || thr > 0.9;
        m.status = thr < 0.5 ? 'noPower' : m.active ? 'ok' : 'idle';
        break;
      }
      case 'controller': {
        m.active = m.throttle > 0.99;
        m.status = m.active ? 'ok' : 'noPower';
        break;
      }
      default: break;
    }
  }

  private beltPhase(dt: number): void {
    const st = this.state;
    const rate = BELT_RATE * dt;
    // snapshot pre-tick belt contents: items that arrive this tick can't hop
    // again this tick (keeps latency direction-independent)
    const snap: (Partial<Record<ItemId, number>> | null)[] =
      st.belts.map((b) => (b ? { ...b.items } : null));
    for (let i = 0; i < st.belts.length; i++) {
      const belt = st.belts[i];
      if (!belt) continue;
      const x = i % MAP_W; const y = Math.floor(i / MAP_W);
      const [dx, dy] = DIRS[belt.dir];
      // push into machine ahead
      const ahead = this.machineAt(x + dx, y + dy);
      if (ahead) {
        for (const item of Object.keys(belt.items) as ItemId[]) {
          const have = belt.items[item] ?? 0;
          if (have <= 1e-9) { delete belt.items[item]; continue; }
          if (!this.machineAccepts(ahead, item)) continue;
          const give = Math.min(rate, have, this.machineItemSpace(ahead, item));
          if (give <= 0) continue;
          this.giveItem(ahead, item, give);
          const left = have - give;
          if (left <= 1e-9) delete belt.items[item];
          else belt.items[item] = left;
          break; // one item type per tick per belt
        }
      }
      // pull: machine directly behind, else ANY adjacent belt pointing at us
      // (so corner chains work)
      const bx = x - dx; const by = y - dy;
      let space = BELT_TILE_CAP - (Object.values(belt.items) as number[]).reduce((s, v) => s + (v ?? 0), 0);
      if (space <= 1e-9) continue;
      const behindM = this.machineAt(bx, by);
      if (behindM) {
        for (const item of Object.keys(behindM.outItems) as ItemId[]) {
          const have = behindM.outItems[item] ?? 0;
          if (have <= 1e-9) continue;
          const take = Math.min(rate, have, space);
          behindM.outItems[item] = have - take;
          belt.items[item] = (belt.items[item] ?? 0) + take;
          space -= take;
          break;
        }
      }
      if (space <= 1e-9) continue;
      for (const [ndx, ndy] of DIRS) {
        const nx = x + ndx; const ny = y + ndy;
        if (!inBounds(nx, ny)) continue;
        if (nx === x + dx && ny === y + dy) continue; // never pull from where we push
        const ni = idx(nx, ny);
        const nb = st.belts[ni];
        if (!nb || nx + DIRS[nb.dir][0] !== x || ny + DIRS[nb.dir][1] !== y) continue;
        const nSnap = snap[ni];
        for (const item of Object.keys(nb.items) as ItemId[]) {
          const have = Math.min(nb.items[item] ?? 0, nSnap?.[item] ?? 0);
          if (have <= 1e-9) continue;
          const take = Math.min(rate, have, space);
          nb.items[item] = (nb.items[item] ?? 0) - take;
          if (nSnap) nSnap[item] = (nSnap[item] ?? 0) - take;
          if ((nb.items[item] ?? 0) <= 1e-9) delete nb.items[item];
          belt.items[item] = (belt.items[item] ?? 0) + take;
          space -= take;
          break;
        }
        if (space <= 1e-9) break;
      }
    }
  }

  machineAccepts(m: Machine, item: ItemId): boolean {
    switch (m.type) {
      case 'depot': return true;
      case 'smelter': return item === 'ironOre' || item === 'copperOre';
      case 'fabricator': {
        const r = m.recipe ? recipeById(m.recipe) : undefined;
        return !!r && item in r.inputs;
      }
      case 'furnace': case 'gasTurbine': return item === 'coal';
      case 'lab': {
        const rs = this.state.research;
        if (!rs.active) return false;
        const node = nodeById(rs.active);
        if (!node) return false;
        return item in nodeRemaining(rs, node); // don't hoard fulfilled ingredients
      }
      default: return false;
    }
  }

  private machineItemSpace(m: Machine, item: ItemId): number {
    if (m.type === 'depot') return 999;
    return Math.max(0, 20 - (m.inItems[item] ?? 0));
  }

  private giveItem(m: Machine, item: ItemId, n: number): void {
    if (m.type === 'depot') {
      this.state.inventory[item] = (this.state.inventory[item] ?? 0) + n;
      m.active = true;
    } else {
      m.inItems[item] = (m.inItems[item] ?? 0) + n;
    }
  }

  private statsPhase(dt: number): void {
    const st = this.state;
    const s = st.stats;
    s.primaryRate = this.primaryTick / dt;
    s.pipeLoss = this.lossTick / dt;
    // smelter auto-recipe: switch to whichever ore it has
    for (const m of st.machines) {
      if (m.type === 'smelter' && m.progress === 0) {
        if ((m.inItems.copperOre ?? 0) > (m.inItems.ironOre ?? 0)) m.recipe = 'copperIngot';
        else if ((m.inItems.ironOre ?? 0) > 0) m.recipe = 'ironIngot';
      }
    }
    // bucket accumulation
    const cur = s.buckets[s.bucketPos];
    cur.work += s.gen * dt;
    cur.primary += this.primaryTick;
    s.bucketFrac += dt;
    if (s.bucketFrac >= 1) {
      s.bucketFrac = 0;
      s.bucketPos = (s.bucketPos + 1) % STAT_WINDOW;
      const nb = s.buckets[s.bucketPos];
      nb.work = 0; nb.primary = 0;
    }
    const winEff = (n: number): number => {
      let w = 0; let p = 0;
      for (let k = 0; k < n; k++) {
        const b = s.buckets[(s.bucketPos - k + STAT_WINDOW) % STAT_WINDOW];
        w += b.work; p += b.primary;
      }
      return p > 0.5 ? w / p : 0;
    };
    s.eff10 = winEff(10);
    s.eff30 = winEff(30);
    s.eff60 = winEff(60);
    let ceiling = 0;
    for (const m of st.machines) if (m.work > 0.01) ceiling = Math.max(ceiling, m.carnot);
    s.carnotCeiling = ceiling;
    if (s.eff30 > st.research.bestSustained) st.research.bestSustained = s.eff30;
  }

  winReport(): WinReport {
    const st = this.state;
    const rs = st.research;
    const unlockedClasses = new Set<MachineClass>();
    for (const def of Object.values(MACHINE_DEFS)) {
      if (machineUnlocked(rs, def.id, def.tier) && WIN_CLASSES.includes(def.cls)) {
        unlockedClasses.add(def.cls);
      }
    }
    const needed = WIN_CLASSES.filter((c) => unlockedClasses.has(c));
    const activeClasses = new Set<MachineClass>();
    let anyOverheat = false;
    let controllerOk = false;
    for (const m of st.machines) {
      const def = this.defOf(m);
      if (m.overheat) anyOverheat = true;
      if (m.active && WIN_CLASSES.includes(def.cls)) activeClasses.add(def.cls);
      if (m.type === 'controller' && m.active) controllerOk = true;
    }
    return {
      controllerOk,
      classesNeeded: needed,
      classesActive: needed.filter((c) => activeClasses.has(c)),
      effOk: st.stats.eff60 >= WIN_EFF_TARGET,
      eff: st.stats.eff60,
      stableOk: !anyOverheat,
      powerOk: st.stats.throttle >= 0.999,
      timer: st.winTimer,
      target: WIN_EFF_TARGET,
      holdTime: WIN_HOLD_TIME,
    };
  }

  private winPhase(dt: number): void {
    const st = this.state;
    if (st.won) return;
    const r = this.winReport();
    const allClasses = r.classesActive.length === r.classesNeeded.length && r.classesNeeded.length >= WIN_CLASSES.length;
    if (r.controllerOk && allClasses && r.effOk && r.stableOk && r.powerOk) {
      st.winTimer += dt;
      if (st.winTimer >= WIN_HOLD_TIME) {
        st.won = true;
        st.sandbox = true;
        this.pushEvent('victory', 'THE GRAND CYCLE IS COMPLETE!', 'good', 0);
      }
    } else {
      st.winTimer = 0;
    }
  }

  private warningsPhase(): void {
    const st = this.state;
    for (const m of st.machines) {
      const def = this.defOf(m);
      if (isSink(def) && !m.overheat && m.temp > def.maxTemp * 0.85) {
        this.pushEvent('sinkHot', `${def.name} at ${Math.round(m.temp)} °C — nearing its ${def.maxTemp} °C limit. Efficiency is dropping!`, 'warn', 35);
      }
      if (m.status === 'noSink' && isEngine(def)) {
        this.pushEvent('noSink', 'An engine has no cold sink — pipe its waste heat to a radiator or condenser.', 'warn', 35);
      }
      if (m.type === 'boiler' && m.status === 'noWater') {
        this.pushEvent('noWater', 'A boiler is out of feedwater — pipe in a Water Pump (or condenser return).', 'warn', 45);
      }
    }
    if (st.stats.throttle < 0.999 && st.stats.load > 0.1) {
      this.pushEvent('deficit', `POWER DEFICIT — machines throttled to ${Math.round(st.stats.throttle * 100)}%. Build more generation.`, 'warn', 40);
    }
  }

  pushEvent(id: string, msg: string, kind: GameEvent['kind'], cooldownS: number): void {
    const until = this.warnUntil.get(id) ?? -1;
    if (this.state.time < until) return;
    this.warnUntil.set(id, this.state.time + cooldownS);
    this.events.push({ id, msg, kind });
  }

  // ── cheats for sanity testing ─────────────────────────────────────────────
  grantAll(): void {
    for (const item of Object.keys(ITEM_NAMES) as ItemId[]) {
      this.state.inventory[item] = 10_000;
    }
  }

  completeAllResearch(): void {
    this.state.research.completed = RESEARCH_NODES.map((n) => n.id);
    this.state.research.bestSustained = 1;
  }
}

export { WIN_EFF_TARGET, WIN_HOLD_TIME, WIN_CLASSES };
export type { ThermalNetwork };
export { RECIPES };
