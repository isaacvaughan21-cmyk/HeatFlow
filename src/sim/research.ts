// ── Tech tree (Builderment-style: one active node, fed by the Lab) ─────────
import type { ItemId, MachineTypeId, ResearchState } from './types';

export interface ResearchNode {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  /** requires best sustained (30 s window) net efficiency ≥ this to select */
  effGate?: number;
  requires: string[];
  unlockMachines: MachineTypeId[];
  unlockRecipes: string[];
  /** side-effect flags, e.g. hpBoiler raises boiler max temp */
  extra?: 'hpBoiler';
}

export const RESEARCH_NODES: ResearchNode[] = [
  // ── Tier 1: Rankine Basics ──
  {
    id: 'steamTurbine', name: 'Steam Turbine', tier: 1,
    desc: 'A real engine: 68% of Carnot and triple the intake of the piston.',
    cost: { ironPlate: 20, copperCoil: 10 }, requires: [],
    unlockMachines: ['turbine'], unlockRecipes: [],
  },
  {
    id: 'closedLoop', name: 'Closed Loop', tier: 1,
    desc: 'Condenser returns spent steam as water; feedwater pump re-pressurizes long runs.',
    cost: { ironPlate: 15, copperWire: 20 }, requires: [],
    unlockMachines: ['condenser', 'feedpump'], unlockRecipes: [],
  },
  {
    id: 'insulation', name: 'Pipe Insulation', tier: 1,
    desc: 'Insulated pipes lose 5× less heat per tile.',
    cost: { ironPlate: 10, copperIngot: 10 }, requires: [],
    unlockMachines: [], unlockRecipes: [],
  },
  {
    id: 'combustion', name: 'Combustion', tier: 1,
    desc: 'Burn coal at 550 °C — far hotter than the vents.',
    cost: { ironPlate: 15, copperCoil: 5 }, requires: [],
    unlockMachines: ['furnace'], unlockRecipes: [],
  },
  // ── Tier 2: Cycle Optimization ──
  {
    id: 'superheating', name: 'Superheating', tier: 2,
    desc: 'Push steam past the boiling point — the main lever on the Carnot ceiling.',
    cost: { machineFrame: 10, copperCoil: 15 }, effGate: 0.18,
    requires: ['steamTurbine', 'combustion'],
    unlockMachines: ['superheater'], unlockRecipes: [],
  },
  {
    id: 'economizerTech', name: 'Economizer', tier: 2,
    desc: 'Recycle waste heat into feedwater preheat.',
    cost: { machineFrame: 8, ironPlate: 20 },
    requires: ['closedLoop'],
    unlockMachines: ['economizer'], unlockRecipes: [],
  },
  {
    id: 'coolingTowerTech', name: 'Cooling Tower', tier: 2,
    desc: 'Industrial-scale heat rejection keeps T_cold pinned low.',
    cost: { machineFrame: 10, ironPlate: 25 },
    requires: ['closedLoop'],
    unlockMachines: ['coolingTower'], unlockRecipes: [],
  },
  {
    id: 'instrumentation', name: 'Instrumentation', tier: 2,
    desc: 'Quartz sensors + heat exchangers for coupling loops.',
    cost: { machineFrame: 6, copperCoil: 10 },
    requires: ['insulation'],
    unlockMachines: ['exchanger'], unlockRecipes: ['sensor'],
  },
  // ── Tier 3: Advanced Thermal ──
  {
    id: 'brayton', name: 'Brayton Cycle', tier: 3,
    desc: 'Gas turbines: 900 °C combustion, and the exhaust is still hot enough to boil water.',
    cost: { machineFrame: 15, sensor: 10 }, effGate: 0.32,
    requires: ['superheating', 'instrumentation'],
    unlockMachines: ['gasTurbine'], unlockRecipes: ['turbineBlade'],
  },
  {
    id: 'heatPumpTech', name: 'Heat Pumps', tier: 3,
    desc: 'Spend work to move heat against the gradient — chill sinks below ambient.',
    cost: { sensor: 10, copperCoil: 20 },
    requires: ['coolingTowerTech', 'instrumentation'],
    unlockMachines: ['heatPump'], unlockRecipes: [],
  },
  {
    id: 'reheat', name: 'Reheat Stages', tier: 3,
    desc: 'Multi-stage expansion squeezes more work from the same steam.',
    cost: { turbineBlade: 8, machineFrame: 10 },
    requires: ['brayton'],
    unlockMachines: ['reheater'], unlockRecipes: [],
  },
  {
    id: 'tegTech', name: 'Thermoelectrics', tier: 3,
    desc: 'Direct heat→power conversion. Inefficient but needs no cold loop.',
    cost: { sensor: 8, copperWire: 30 },
    requires: ['instrumentation'],
    unlockMachines: ['teg'], unlockRecipes: [],
  },
  // ── Tier 4: The Grand Cycle ──
  {
    id: 'combinedCycle', name: 'Combined Cycle', tier: 4,
    desc: 'Brayton topping + Rankine bottoming. Also: high-pressure boilers (steam to 340 °C).',
    cost: { turbineBlade: 10, machineFrame: 20 }, effGate: 0.4,
    requires: ['brayton'],
    unlockMachines: ['coupler'], unlockRecipes: [], extra: 'hpBoiler',
  },
  {
    id: 'regenTech', name: 'Regeneration', tier: 4,
    desc: 'The final efficiency squeeze: heavy waste-heat recycling.',
    cost: { sensor: 15, machineFrame: 15 },
    requires: ['economizerTech', 'reheat'],
    unlockMachines: ['regenerator'], unlockRecipes: [],
  },
  {
    id: 'grandCycle', name: 'The Grand Cycle', tier: 4,
    desc: 'The Controller. Integrate everything; approach the limit.',
    cost: { turbineBlade: 15, sensor: 20, machineFrame: 25 }, effGate: 0.46,
    requires: ['combinedCycle', 'heatPumpTech', 'regenTech'],
    unlockMachines: ['controller'], unlockRecipes: [],
  },
];

export function nodeById(id: string): ResearchNode | undefined {
  return RESEARCH_NODES.find((n) => n.id === id);
}

export function isNodeComplete(rs: ResearchState, id: string): boolean {
  return rs.completed.includes(id);
}

/** prereqs met (efficiency gate is checked separately so UI can explain) */
export function prereqsMet(rs: ResearchState, node: ResearchNode): boolean {
  return node.requires.every((r) => rs.completed.includes(r));
}

export function effGateMet(rs: ResearchState, node: ResearchNode): boolean {
  return node.effGate === undefined || rs.bestSustained >= node.effGate;
}

export function canSelect(rs: ResearchState, node: ResearchNode): boolean {
  return !isNodeComplete(rs, node.id) && prereqsMet(rs, node) && effGateMet(rs, node);
}

export function machineUnlocked(rs: ResearchState, type: MachineTypeId, tier: number): boolean {
  if (tier === 0) return true;
  return RESEARCH_NODES.some((n) => rs.completed.includes(n.id) && n.unlockMachines.includes(type));
}

export function recipeUnlocked(rs: ResearchState, recipeId: string, locked: boolean | undefined): boolean {
  if (!locked) return true;
  return RESEARCH_NODES.some((n) => rs.completed.includes(n.id) && n.unlockRecipes.includes(recipeId));
}

/** remaining item needs for a node given progress */
export function nodeRemaining(rs: ResearchState, node: ResearchNode): Partial<Record<ItemId, number>> {
  const done = rs.progress[node.id] ?? {};
  const out: Partial<Record<ItemId, number>> = {};
  for (const [item, need] of Object.entries(node.cost) as [ItemId, number][]) {
    const rem = need - (done[item] ?? 0);
    if (rem > 0) out[item] = rem;
  }
  return out;
}

export function nodeProgressFrac(rs: ResearchState, node: ResearchNode): number {
  const done = rs.progress[node.id] ?? {};
  let total = 0;
  let has = 0;
  for (const [item, need] of Object.entries(node.cost) as [ItemId, number][]) {
    total += need;
    has += Math.min(done[item] ?? 0, need);
  }
  return total > 0 ? has / total : 0;
}
