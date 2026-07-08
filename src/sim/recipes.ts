// ── Item recipes ────────────────────────────────────────────────────────────
import type { ItemId } from './types';

export interface Recipe {
  id: string;
  name: string;
  machine: 'smelter' | 'fabricator';
  inputs: Partial<Record<ItemId, number>>;
  output: ItemId;
  outCount: number;
  time: number; // s at full throttle
  /** locked until a research node lists this id in unlockRecipes */
  locked?: boolean;
}

export const RECIPES: Recipe[] = [
  // Smelting — uses HEAT (thematic tie): 8 HU/s at ≥100 °C while running.
  { id: 'ironIngot', name: 'Iron Ingot', machine: 'smelter', inputs: { ironOre: 1 }, output: 'ironIngot', outCount: 1, time: 2 },
  { id: 'copperIngot', name: 'Copper Ingot', machine: 'smelter', inputs: { copperOre: 1 }, output: 'copperIngot', outCount: 1, time: 2 },
  // Fabrication — uses POWER.
  { id: 'ironPlate', name: 'Iron Plate', machine: 'fabricator', inputs: { ironIngot: 1 }, output: 'ironPlate', outCount: 1, time: 1.5 },
  { id: 'copperWire', name: 'Copper Wire', machine: 'fabricator', inputs: { copperIngot: 1 }, output: 'copperWire', outCount: 2, time: 1.5 },
  { id: 'copperCoil', name: 'Copper Coil', machine: 'fabricator', inputs: { copperWire: 2 }, output: 'copperCoil', outCount: 1, time: 2 },
  { id: 'machineFrame', name: 'Machine Frame', machine: 'fabricator', inputs: { ironPlate: 2, copperCoil: 1 }, output: 'machineFrame', outCount: 1, time: 3 },
  { id: 'sensor', name: 'Sensor', machine: 'fabricator', inputs: { copperCoil: 1, quartz: 1 }, output: 'sensor', outCount: 1, time: 3, locked: true },
  { id: 'turbineBlade', name: 'Turbine Blade', machine: 'fabricator', inputs: { ironPlate: 1, sensor: 1 }, output: 'turbineBlade', outCount: 1, time: 3, locked: true },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
