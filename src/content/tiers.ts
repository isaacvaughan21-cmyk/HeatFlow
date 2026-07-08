// ── Build menu structure: what shows where, grouped and tier-ordered ───────
import type { MachineTypeId } from '../sim/types';

export type BuildEntry =
  | { kind: 'machine'; type: MachineTypeId }
  | { kind: 'pipe'; insulated: boolean }
  | { kind: 'belt' }
  | { kind: 'bulldoze' };

export interface BuildGroup {
  name: string;
  entries: BuildEntry[];
}

export const BUILD_GROUPS: BuildGroup[] = [
  {
    name: 'Heat',
    entries: [
      { kind: 'machine', type: 'vent' },
      { kind: 'machine', type: 'boiler' },
      { kind: 'machine', type: 'piston' },
      { kind: 'machine', type: 'radiator' },
      { kind: 'pipe', insulated: false },
      { kind: 'pipe', insulated: true },
      { kind: 'machine', type: 'turbine' },
      { kind: 'machine', type: 'condenser' },
      { kind: 'machine', type: 'furnace' },
      { kind: 'machine', type: 'superheater' },
      { kind: 'machine', type: 'coolingTower' },
      { kind: 'machine', type: 'economizer' },
      { kind: 'machine', type: 'exchanger' },
      { kind: 'machine', type: 'gasTurbine' },
      { kind: 'machine', type: 'heatPump' },
      { kind: 'machine', type: 'reheater' },
      { kind: 'machine', type: 'teg' },
      { kind: 'machine', type: 'coupler' },
      { kind: 'machine', type: 'regenerator' },
      { kind: 'machine', type: 'controller' },
    ],
  },
  {
    name: 'Industry',
    entries: [
      { kind: 'machine', type: 'pump' },
      { kind: 'machine', type: 'feedpump' },
      { kind: 'machine', type: 'miner' },
      { kind: 'machine', type: 'smelter' },
      { kind: 'machine', type: 'fabricator' },
      { kind: 'belt' },
      { kind: 'machine', type: 'depot' },
      { kind: 'machine', type: 'lab' },
    ],
  },
  {
    name: '',
    entries: [{ kind: 'bulldoze' }],
  },
];
