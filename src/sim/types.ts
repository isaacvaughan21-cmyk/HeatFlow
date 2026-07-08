// ── Heat Flow: core data types ──────────────────────────────────────────────
// Everything in here is plain-serializable (save/load = JSON of GameState).

export const TICK = 0.1; // s, fixed sim step (10 Hz)
export const AMBIENT = 20; // °C, the ultimate cold reservoir
export const MAP_W = 28;
export const MAP_H = 28;
export const SAVE_VERSION = 3;

export type FluidType = 'heat' | 'steam' | 'water' | 'waste';

export type ItemId =
  | 'ironOre' | 'copperOre' | 'coal' | 'quartz'
  | 'ironIngot' | 'copperIngot' | 'ironPlate' | 'copperWire'
  | 'copperCoil' | 'machineFrame' | 'sensor' | 'turbineBlade';

export const ALL_ITEMS: ItemId[] = [
  'ironOre', 'copperOre', 'coal', 'quartz',
  'ironIngot', 'copperIngot', 'ironPlate', 'copperWire',
  'copperCoil', 'machineFrame', 'sensor', 'turbineBlade',
];

export const ITEM_NAMES: Record<ItemId, string> = {
  ironOre: 'Iron Ore', copperOre: 'Copper Ore', coal: 'Coal (Fuel)', quartz: 'Quartz',
  ironIngot: 'Iron Ingot', copperIngot: 'Copper Ingot', ironPlate: 'Iron Plate',
  copperWire: 'Copper Wire', copperCoil: 'Copper Coil', machineFrame: 'Machine Frame',
  sensor: 'Sensor', turbineBlade: 'Turbine Blade',
};

export const ITEM_GLYPHS: Record<ItemId, string> = {
  ironOre: 'Fe·', copperOre: 'Cu·', coal: 'C', quartz: 'Qz',
  ironIngot: 'Fe', copperIngot: 'Cu', ironPlate: 'Pl', copperWire: 'Wr',
  copperCoil: 'Co', machineFrame: 'Fr', sensor: 'Sn', turbineBlade: 'Bl',
};

export type TerrainType =
  | 'ground' | 'vent' | 'ironDeposit' | 'copperDeposit' | 'coalDeposit' | 'quartzDeposit';

export type MachineTypeId =
  | 'vent' | 'pump' | 'boiler' | 'piston' | 'radiator' | 'lab' | 'smelter'
  | 'miner' | 'fabricator' | 'depot'
  | 'turbine' | 'condenser' | 'feedpump' | 'furnace'
  | 'superheater' | 'economizer' | 'coolingTower' | 'exchanger'
  | 'gasTurbine' | 'heatPump' | 'reheater' | 'teg'
  | 'coupler' | 'regenerator' | 'controller';

// Class is what the Grand Cycle win condition counts.
export type MachineClass =
  | 'source' | 'boiler' | 'superheater' | 'engine' | 'sink' | 'condenser'
  | 'heatPump' | 'regenerator' | 'coupler' | 'exchanger'
  | 'logistics' | 'production' | 'research' | 'controller';

export type MachineStatus =
  | 'ok' | 'idle' | 'overheat' | 'noHeat' | 'noWater' | 'noSteam'
  | 'noSink' | 'noFuel' | 'noPower' | 'lowTemp';

export interface FluidBuffer {
  fluid: FluidType;
  amount: number; // HU for heat/steam, units for water
  temp: number;   // °C
  cap: number;
}

export interface Machine {
  id: number;
  type: MachineTypeId;
  gx: number;
  gy: number;
  rot: number; // 0..3, visual + belt-side hints
  temp: number; // sink temp for sinks; last seen hot-side temp otherwise
  fluidOut: FluidBuffer | null;  // primary fluid output (steam/heat/water)
  waterOut: FluidBuffer | null;  // condenser secondary water return
  inItems: Partial<Record<ItemId, number>>;
  outItems: Partial<Record<ItemId, number>>;
  recipe: string | null; // selected recipe id (fabricator/smelter)
  progress: number;      // seconds of crafting done
  status: MachineStatus;
  // live telemetry (persisted; cheap and keeps inspector correct after load)
  work: number;     // kW out (engines)
  qIn: number;      // HU/s drawn this tick
  qWaste: number;   // HU/s waste out
  tHot: number;
  tCold: number;
  eta: number;
  carnot: number;
  rejected: number; // HU/s rejected to ambient (sinks)
  powerUse: number; // kW drawn
  throttle: number; // 0..1 power throttle applied last tick
  active: boolean;  // did real work this tick (win-condition check)
  overheat: boolean; // latched until cooled
  overheatT: number; // seconds spent above maxTemp (grace before latch)
}

export interface PipeTile {
  insulated: boolean;
  // render/telemetry only:
  temp: number;
  flow: number;
}

// dir: 0 = +x, 1 = +y, 2 = -x, 3 = -y  (grid axes; iso render handles the rest)
export interface BeltTile {
  dir: 0 | 1 | 2 | 3;
  items: Partial<Record<ItemId, number>>;
}

export interface ResearchState {
  completed: string[];
  active: string | null;
  // delivered item counts per node id
  progress: Record<string, Partial<Record<ItemId, number>>>;
  bestSustained: number; // best 30s-window netEff ever reached (gates latch on this)
}

export interface StatBucket { work: number; primary: number; }

export interface Stats {
  buckets: StatBucket[];  // per-second ring buffer
  bucketPos: number;      // index of current bucket
  bucketFrac: number;     // seconds accumulated into current bucket
  eff10: number;
  eff30: number;
  eff60: number;
  carnotCeiling: number;  // best running engine's raw Carnot
  gen: number;            // kW thermal generation (excl. aux)
  auxGen: number;         // kW auxiliary baseline
  load: number;           // kW demanded
  throttle: number;       // grid throttle 0..1
  primaryRate: number;    // HU/s primary heat in
  pipeLoss: number;       // HU/s lost in pipes
  fuelUsed: number;       // total coal burned (for victory screen)
}

export interface WinReport {
  controllerOk: boolean;
  classesNeeded: MachineClass[];
  classesActive: MachineClass[];
  effOk: boolean;
  eff: number;
  stableOk: boolean;   // no overheats, sinks under max
  powerOk: boolean;    // no deficit
  timer: number;       // consecutive seconds all conditions held
  target: number;      // required efficiency
  holdTime: number;    // required seconds
}

export interface GameEvent {
  id: string;          // dedupe/cooldown key
  msg: string;
  kind: 'info' | 'warn' | 'good';
}

export interface GameState {
  version: number;
  time: number; // sim seconds
  speed: 0 | 1 | 2 | 4;
  terrain: TerrainType[];
  machines: Machine[];
  nextId: number;
  pipes: (PipeTile | null)[];
  belts: (BeltTile | null)[];
  inventory: Partial<Record<ItemId, number>>;
  research: ResearchState;
  stats: Stats;
  winTimer: number;
  won: boolean;
  sandbox: boolean;
  tutorialStep: number;
}

export function idx(gx: number, gy: number): number {
  return gy * MAP_W + gx;
}

export function inBounds(gx: number, gy: number): boolean {
  return gx >= 0 && gy >= 0 && gx < MAP_W && gy < MAP_H;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
];
