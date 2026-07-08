// ── Machine/tool portrait registry: main.ts plugs the Renderer in here so UI
//    modules can request mini machine renders without owning the renderer. ──
import type { MachineTypeId } from '../sim/types';

export type ToolKind = 'pipe' | 'insPipe' | 'belt' | 'bulldoze';

export interface PortraitProvider {
  machine(type: MachineTypeId, px: number): string;
  tool(kind: ToolKind, px: number): string;
}

let provider: PortraitProvider | null = null;

export function setPortraitProvider(p: PortraitProvider): void {
  provider = p;
}

export function machinePortrait(type: MachineTypeId, px = 76): string {
  return provider ? provider.machine(type, px) : '';
}

export function toolPortrait(kind: ToolKind, px = 76): string {
  return provider ? provider.tool(kind, px) : '';
}
