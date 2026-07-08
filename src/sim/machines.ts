// ── Machine registry: stats, costs, ports-by-behavior ──────────────────────
import type { ItemId, MachineClass, MachineTypeId } from './types';

export interface MachineDef {
  id: MachineTypeId;
  name: string;
  cls: MachineClass;
  desc: string;
  size: 1 | 2;
  glyph: string;
  color: string;   // base body color
  height: number;  // render prism height (px at zoom 1)
  cost: Partial<Record<ItemId, number>>;
  tier: 0 | 1 | 2 | 3 | 4;
  powerDraw: number; // kW while running
  maxTemp: number;   // °C overheat threshold
  // engines
  quality?: number;   // fraction of Carnot achieved
  capacity?: number;  // HU/s max heat intake
  // sinks
  thermalMass?: number; // HU per °C
  rejectCoeff?: number; // HU/s per °C above ambient
  // sources
  sourceTemp?: number;
  sourceRate?: number; // HU/s
  fuelEnergy?: number; // HU per coal item
  // transformers / movers
  throughput?: number; // HU/s or water-units/s
  placeOn?: 'vent' | 'deposit';
}

export const BOILER_MAX_TEMP_BASE = 200;
export const BOILER_MAX_TEMP_HP = 340; // after Combined Cycle research
export const AUX_POWER = 6; // kW starter genset, keeps bootstrap possible
export const BELT_RATE = 4; // items/s
export const BELT_TILE_CAP = 3;
export const SMELT_MIN_TEMP = 100; // °C heat needed to smelt
export const REHEATER_QUALITY_MULT = 1.12;
export const REHEATER_QUALITY_CAP = 0.8;
export const GAS_TURBINE_COMBUST_T = 900;
export const GAS_TURBINE_EXHAUST_T = 330;
export const TEG_INTERNAL_COLD = 50; // °C, self-rejecting internal cold side
export const SUPERHEATER_MAX_T = 520;
export const HEATPUMP_MAX_PULL = 40; // HU/s
export const MIN_SINK_TEMP = -25;

export const MACHINE_DEFS: Record<MachineTypeId, MachineDef> = {
  vent: {
    id: 'vent', name: 'Geothermal Vent', cls: 'source', size: 1, glyph: 'V',
    desc: 'Free geothermal heat: 180 °C at up to 40 HU/s. Build only on vent tiles.',
    color: '#8a5a2b', height: 10, cost: {}, tier: 0, powerDraw: 0, maxTemp: 9999,
    sourceTemp: 180, sourceRate: 40, placeOn: 'vent',
  },
  pump: {
    id: 'pump', name: 'Water Pump', cls: 'production', size: 1, glyph: 'W',
    desc: 'Draws groundwater: 1.5 water/s. Needs 4 kW.',
    color: '#2b6a8a', height: 14, cost: { ironPlate: 3, copperWire: 2 }, tier: 0,
    powerDraw: 4, maxTemp: 9999, throughput: 1.5,
  },
  boiler: {
    id: 'boiler', name: 'Boiler', cls: 'boiler', size: 1, glyph: 'B',
    desc: 'Water + heat → steam (up to 30 HU/s). Steam temp capped at boiler max.',
    color: '#7a4a3a', height: 20, cost: { ironPlate: 4 }, tier: 0,
    powerDraw: 0, maxTemp: 600, throughput: 30,
  },
  piston: {
    id: 'piston', name: 'Piston Engine', cls: 'engine', size: 1, glyph: 'P',
    desc: 'Crude heat engine: 45% of Carnot, 25 HU/s intake. Overheats above 250 °C.',
    color: '#5a5a6a', height: 18, cost: { ironPlate: 6, copperWire: 4 }, tier: 0,
    powerDraw: 0, maxTemp: 250, quality: 0.45, capacity: 25,
  },
  radiator: {
    id: 'radiator', name: 'Radiator', cls: 'sink', size: 1, glyph: 'R',
    desc: 'Basic cold sink. Small mass — heats up fast. Rejects 0.5 HU/s per °C above ambient.',
    color: '#3a6a5a', height: 12, cost: { ironPlate: 4 }, tier: 0,
    powerDraw: 0, maxTemp: 100, thermalMass: 60, rejectCoeff: 0.5,
  },
  lab: {
    id: 'lab', name: 'Research Lab', cls: 'research', size: 2, glyph: 'L',
    desc: 'Feed it parts (belt) + 5 kW to advance the active research node at 1 item/s.',
    color: '#4a4a7a', height: 22, cost: { ironPlate: 6, copperWire: 4 }, tier: 0,
    powerDraw: 5, maxTemp: 9999,
  },
  smelter: {
    id: 'smelter', name: 'Smelter', cls: 'production', size: 1, glyph: 'S',
    desc: 'Ore + heat (≥100 °C, 8 HU/s) + 1 kW → ingots. Pipe heat in, belt ore in.',
    color: '#6a4a2a', height: 16, cost: { ironPlate: 5 }, tier: 0,
    powerDraw: 1, maxTemp: 9999, throughput: 8,
  },
  miner: {
    id: 'miner', name: 'Miner', cls: 'production', size: 1, glyph: 'M',
    desc: 'Place on a deposit. 6 kW → 0.5 ore/s.',
    color: '#5a4a3a', height: 16, cost: { ironPlate: 4, copperWire: 2 }, tier: 0,
    powerDraw: 6, maxTemp: 9999, throughput: 0.5, placeOn: 'deposit',
  },
  fabricator: {
    id: 'fabricator', name: 'Fabricator', cls: 'production', size: 1, glyph: 'F',
    desc: 'Crafts parts from ingots using 6 kW. Select a recipe in the inspector.',
    color: '#4a5a6a', height: 16, cost: { ironPlate: 5, copperWire: 3 }, tier: 0,
    powerDraw: 6, maxTemp: 9999,
  },
  depot: {
    id: 'depot', name: 'Storage Depot', cls: 'logistics', size: 1, glyph: 'D',
    desc: 'Belt items in — they join your build inventory.',
    color: '#4a4a4a', height: 14, cost: { ironPlate: 3 }, tier: 0,
    powerDraw: 0, maxTemp: 9999,
  },
  // ── Tier 1 ──
  turbine: {
    id: 'turbine', name: 'Steam Turbine', cls: 'engine', size: 1, glyph: 'T',
    desc: 'Proper engine: 68% of Carnot, 60 HU/s intake, handles 420 °C steam.',
    color: '#5a6a8a', height: 22, cost: { machineFrame: 3, copperCoil: 6 }, tier: 1,
    powerDraw: 0, maxTemp: 420, quality: 0.68, capacity: 60,
  },
  condenser: {
    id: 'condenser', name: 'Condenser', cls: 'condenser', size: 1, glyph: 'C',
    desc: 'Closed-loop sink: rejects 3 HU/s per °C and returns condensed water (1 per 32 HU).',
    color: '#3a5a7a', height: 16, cost: { ironPlate: 8, copperWire: 6 }, tier: 1,
    powerDraw: 1, maxTemp: 90, thermalMass: 250, rejectCoeff: 3.0,
  },
  feedpump: {
    id: 'feedpump', name: 'Feedwater Pump', cls: 'production', size: 1, glyph: 'fp',
    desc: 'Water repeater: re-pressurizes flow (5/s) so long water runs don\'t leak away. 3 kW.',
    color: '#2b5a7a', height: 12, cost: { ironPlate: 4, copperWire: 2 }, tier: 1,
    powerDraw: 3, maxTemp: 9999, throughput: 5,
  },
  furnace: {
    id: 'furnace', name: 'Combustion Furnace', cls: 'source', size: 1, glyph: 'Fu',
    desc: 'Burns coal: 550 °C at up to 50 HU/s. Belt coal in. 1 coal = 240 HU.',
    color: '#8a3a2a', height: 18, cost: { ironPlate: 10, copperCoil: 2 }, tier: 1,
    powerDraw: 0, maxTemp: 9999, sourceTemp: 550, sourceRate: 50, fuelEnergy: 240,
  },
  // ── Tier 2 ──
  superheater: {
    id: 'superheater', name: 'Superheater', cls: 'superheater', size: 1, glyph: 'SH',
    desc: 'Mixes hotter heat into steam, raising its temperature (up to 520 °C) — raises the Carnot ceiling.',
    color: '#8a5a3a', height: 20, cost: { machineFrame: 4, copperCoil: 6 }, tier: 2,
    powerDraw: 0, maxTemp: 620, throughput: 90,
  },
  economizer: {
    id: 'economizer', name: 'Economizer', cls: 'regenerator', size: 1, glyph: 'E',
    desc: 'Preheats feedwater with waste heat (up to 20 HU/s, water to 120 °C) — cuts boiler demand.',
    color: '#5a7a4a', height: 14, cost: { machineFrame: 3, ironPlate: 8 }, tier: 2,
    powerDraw: 0, maxTemp: 9999, throughput: 20,
  },
  coolingTower: {
    id: 'coolingTower', name: 'Cooling Tower', cls: 'sink', size: 2, glyph: 'CT',
    desc: 'Big sink: rejects 10 HU/s per °C, huge thermal mass. Fans need 2 kW.',
    color: '#4a6a6a', height: 34, cost: { machineFrame: 4, ironPlate: 12 }, tier: 2,
    powerDraw: 2, maxTemp: 80, thermalMass: 900, rejectCoeff: 10,
  },
  exchanger: {
    id: 'exchanger', name: 'Heat Exchanger', cls: 'exchanger', size: 1, glyph: 'HX',
    desc: 'Couples two loops: absorbs any hot fluid, re-emits it as heat (97% retained).',
    color: '#6a5a7a', height: 16, cost: { machineFrame: 3, copperCoil: 4 }, tier: 2,
    powerDraw: 0, maxTemp: 9999, throughput: 60,
  },
  // ── Tier 3 ──
  gasTurbine: {
    id: 'gasTurbine', name: 'Gas Turbine', cls: 'engine', size: 2, glyph: 'GT',
    desc: 'Brayton cycle: burns coal at 900 °C, 70% of Carnot vs its own 330 °C exhaust — which stays hot. Pipe the exhaust into a boiler.',
    color: '#7a3a4a', height: 26, cost: { machineFrame: 6, sensor: 4 }, tier: 3,
    powerDraw: 0, maxTemp: 9999, quality: 0.7, capacity: 72, fuelEnergy: 240,
  },
  heatPump: {
    id: 'heatPump', name: 'Heat Pump', cls: 'heatPump', size: 1, glyph: 'HP',
    desc: 'Place next to a sink: spends up to 12 kW to pump heat out of it — can chill below ambient. COP-bounded.',
    color: '#3a7a7a', height: 16, cost: { sensor: 3, copperCoil: 6 }, tier: 3,
    powerDraw: 12, maxTemp: 9999,
  },
  reheater: {
    id: 'reheater', name: 'Reheater', cls: 'superheater', size: 1, glyph: 'RH',
    desc: 'Multi-stage expansion: engines fed from this steam network run at ×1.12 quality (cap 80%). Bleeds 2 HU/s of steam to operate.',
    color: '#8a6a4a', height: 18, cost: { turbineBlade: 4, machineFrame: 3 }, tier: 3,
    powerDraw: 0, maxTemp: 620, throughput: 2,
  },
  teg: {
    id: 'teg', name: 'Thermoelectric Gen.', cls: 'engine', size: 1, glyph: 'TE',
    desc: 'Solid-state heat→power: 25% of Carnot vs its 50 °C internal cold side, self-rejecting. Compact, niche.',
    color: '#4a5a5a', height: 12, cost: { sensor: 2, copperWire: 8 }, tier: 3,
    powerDraw: 0, maxTemp: 9999, quality: 0.25, capacity: 12,
  },
  // ── Tier 4 ──
  coupler: {
    id: 'coupler', name: 'Combined-Cycle Coupler', cls: 'coupler', size: 1, glyph: 'CC',
    desc: 'Routes gas-turbine exhaust onward with zero loss (80 HU/s) — the topping→bottoming link.',
    color: '#7a5a8a', height: 18, cost: { turbineBlade: 4, machineFrame: 5 }, tier: 4,
    powerDraw: 0, maxTemp: 9999, throughput: 80,
  },
  regenerator: {
    id: 'regenerator', name: 'Regenerator', cls: 'regenerator', size: 1, glyph: 'RG',
    desc: 'Heavy-duty economizer: recycles up to 40 HU/s of waste heat into feedwater (to 200 °C).',
    color: '#5a8a5a', height: 16, cost: { sensor: 4, machineFrame: 5 }, tier: 4,
    powerDraw: 0, maxTemp: 9999, throughput: 40,
  },
  controller: {
    id: 'controller', name: 'Grand Cycle Controller', cls: 'controller', size: 2, glyph: 'GC',
    desc: 'The win condition: monitors your plant. Sustain ≥55% net efficiency with every machine class active, stable and fully powered, for 60 s.',
    color: '#8a7a3a', height: 30, cost: { turbineBlade: 6, sensor: 8, machineFrame: 10 }, tier: 4,
    powerDraw: 8, maxTemp: 9999,
  },
};

export const PIPE_COST: Partial<Record<ItemId, number>> = { ironIngot: 1 };
export const INS_PIPE_COST: Partial<Record<ItemId, number>> = { ironPlate: 1 };
export const BELT_COST: Partial<Record<ItemId, number>> = { ironIngot: 1 };

export const REFUND_RATE = 0.6;

/** Sink behavior = has thermal mass. (Condenser is a sink with a water return.) */
export function isSink(def: MachineDef): boolean {
  return def.thermalMass !== undefined && def.rejectCoeff !== undefined;
}

export function isEngine(def: MachineDef): boolean {
  return def.quality !== undefined && def.capacity !== undefined;
}
