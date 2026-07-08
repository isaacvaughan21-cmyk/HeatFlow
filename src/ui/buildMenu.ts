// ── Bottom bar: placeable machines with lock state + rich tooltip ───────────
import { World } from '../sim/world';
import { MACHINE_DEFS, PIPE_COST, INS_PIPE_COST, BELT_COST } from '../sim/machines';
import { RESEARCH_NODES, machineUnlocked } from '../sim/research';
import { BUILD_GROUPS, BuildEntry } from '../content/tiers';
import { ITEM_NAMES, ItemId } from '../sim/types';
import { iconHtml } from './itemIcons';
import { machinePortrait, toolPortrait } from './portraits';
import type { Tool } from '../render/renderer';

function entryKey(e: BuildEntry): string {
  if (e.kind === 'machine') return `m:${e.type}`;
  if (e.kind === 'pipe') return e.insulated ? 'insPipe' : 'pipe';
  return e.kind;
}

function sameTool(a: Tool, e: BuildEntry): boolean {
  if (!a) return false;
  if (a.kind === 'machine' && e.kind === 'machine') return a.type === e.type;
  if (a.kind === 'pipe' && e.kind === 'pipe') return a.insulated === e.insulated;
  return a.kind === e.kind;
}

function costHtml(world: World, cost: Partial<Record<ItemId, number>>): string {
  const parts: string[] = [];
  for (const [item, n] of Object.entries(cost) as [ItemId, number][]) {
    const have = Math.floor(world.state.inventory[item] ?? 0);
    const ok = have >= n;
    parts.push(`<span class="item-chip ${ok ? 'cost-ok' : 'cost-bad'}" title="${ITEM_NAMES[item]}">${iconHtml(item, 15)}${n} <i>(${have})</i></span>`);
  }
  return parts.length ? parts.join(' ') : 'free';
}

export class BuildMenu {
  private buttons = new Map<string, { el: HTMLButtonElement; entry: BuildEntry }>();
  private tooltip: HTMLElement;
  private invBar: HTMLElement;

  constructor(private container: HTMLElement, private onTool: (t: Tool) => void) {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'build-tooltip hidden';
    document.body.appendChild(this.tooltip);
    this.invBar = document.createElement('div');
    this.invBar.className = 'inv-bar';
    container.appendChild(this.invBar);
    const row = document.createElement('div');
    row.className = 'build-row';
    container.appendChild(row);
    for (const group of BUILD_GROUPS) {
      if (group.name) {
        const label = document.createElement('span');
        label.className = 'build-group-label';
        label.textContent = group.name;
        row.appendChild(label);
      }
      for (const entry of group.entries) {
        const b = document.createElement('button');
        b.className = 'build-btn';
        b.innerHTML = this.btnFace(entry);
        b.addEventListener('click', () => this.click(entry));
        b.addEventListener('mouseenter', () => this.showTooltip(b, entry));
        b.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
        row.appendChild(b);
        this.buttons.set(entryKey(entry), { el: b, entry });
      }
    }
  }

  private currentWorld: World | null = null;
  private currentTool: Tool = null;

  private btnFace(e: BuildEntry): string {
    if (e.kind === 'machine') {
      const def = MACHINE_DEFS[e.type];
      return `<img class="build-icon" src="${machinePortrait(e.type, 76)}" alt="${def.name}">`
        + `<span class="build-mini">${def.glyph}</span>`
        + `<span class="build-tier">${def.tier > 0 ? 'T' + def.tier : ''}</span>`;
    }
    if (e.kind === 'pipe') {
      return `<img class="build-icon" src="${toolPortrait(e.insulated ? 'insPipe' : 'pipe', 76)}" alt="pipe">`
        + `<span class="build-mini">${e.insulated ? '══' : '──'}</span>`
        + (e.insulated ? '<span class="build-tier">T1</span>' : '');
    }
    if (e.kind === 'belt') {
      return `<img class="build-icon" src="${toolPortrait('belt', 76)}" alt="belt"><span class="build-mini">»</span>`;
    }
    return `<img class="build-icon" src="${toolPortrait('bulldoze', 76)}" alt="demolish">`;
  }

  private click(entry: BuildEntry): void {
    if (this.currentTool && sameTool(this.currentTool, entry)) {
      this.onTool(null);
      return;
    }
    if (entry.kind === 'machine') this.onTool({ kind: 'machine', type: entry.type });
    else if (entry.kind === 'pipe') this.onTool({ kind: 'pipe', insulated: entry.insulated });
    else if (entry.kind === 'belt') this.onTool({ kind: 'belt' });
    else this.onTool({ kind: 'bulldoze' });
  }

  private unlockHint(type: string): string {
    const node = RESEARCH_NODES.find((n) => n.unlockMachines.includes(type as never));
    return node ? `Locked — research “${node.name}” (Tier ${node.tier})` : 'Locked';
  }

  private showTooltip(btn: HTMLElement, e: BuildEntry): void {
    const w = this.currentWorld;
    if (!w) return;
    let html = '';
    if (e.kind === 'machine') {
      const def = MACHINE_DEFS[e.type];
      const locked = !machineUnlocked(w.state.research, e.type, def.tier);
      html = `<b>${def.name}</b> ${def.tier > 0 ? `<span class="tt-tier">Tier ${def.tier}</span>` : ''}`;
      if (locked) html += `<div class="tt-locked">${this.unlockHint(e.type)}</div>`;
      html += `<div class="tt-desc">${def.desc}</div>`;
      const stats: string[] = [];
      if (def.quality) stats.push(`quality ${Math.round(def.quality * 100)}% of Carnot`);
      if (def.capacity) stats.push(`intake ${def.capacity} HU/s`);
      if (def.rejectCoeff) stats.push(`rejects ${def.rejectCoeff} HU/s·°C`);
      if (def.sourceRate) stats.push(`${def.sourceRate} HU/s @ ${def.sourceTemp} °C`);
      if (def.powerDraw > 0) stats.push(`${def.powerDraw} kW`);
      if (def.maxTemp < 9000) stats.push(`max ${def.maxTemp} °C`);
      if (stats.length) html += `<div class="tt-stats">${stats.join(' · ')}</div>`;
      html += `<div class="tt-cost">${costHtml(w, def.cost)}</div>`;
    } else if (e.kind === 'pipe') {
      html = e.insulated
        ? `<b>Insulated Pipe</b><div class="tt-desc">Loses only 0.3% of heat per tile (5× better). Drag to lay runs.</div><div class="tt-cost">${costHtml(w, INS_PIPE_COST)}</div>`
        : `<b>Pipe</b><div class="tt-desc">Carries heat, steam, water and waste. Loses 1.5% of heat per tile — keep runs short. Drag to lay.</div><div class="tt-cost">${costHtml(w, PIPE_COST)}</div>`;
      if (e.insulated && !w.state.research.completed.includes('insulation')) {
        html += '<div class="tt-locked">Locked — research “Pipe Insulation” (Tier 1)</div>';
      }
    } else if (e.kind === 'belt') {
      html = `<b>Belt</b><div class="tt-desc">Moves 4 items/s. Drag to lay; direction follows your drag. R rotates.</div><div class="tt-cost">${costHtml(w, BELT_COST)}</div>`;
    } else {
      html = '<b>Bulldoze</b><div class="tt-desc">Remove machines, pipes and belts (60% refund). Right-click also works.</div>';
    }
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
    this.tooltip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }

  /** spotlight buttons the tutorial is pointing at */
  setHighlights(keys: string[]): void {
    for (const [key, { el }] of this.buttons) {
      el.classList.toggle('build-hint', keys.includes(key) && !el.classList.contains('build-locked'));
    }
  }

  refresh(world: World, tool: Tool): void {
    this.currentWorld = world;
    this.currentTool = tool;
    for (const { el, entry } of this.buttons.values()) {
      let locked = false;
      let affordable = true;
      if (entry.kind === 'machine') {
        const def = MACHINE_DEFS[entry.type];
        locked = !machineUnlocked(world.state.research, entry.type, def.tier);
        affordable = world.canAfford(def.cost);
      } else if (entry.kind === 'pipe') {
        locked = entry.insulated && !world.state.research.completed.includes('insulation');
        affordable = world.canAfford(entry.insulated ? INS_PIPE_COST : PIPE_COST);
      } else if (entry.kind === 'belt') {
        affordable = world.canAfford(BELT_COST);
      }
      el.classList.toggle('build-locked', locked);
      el.classList.toggle('build-poor', !locked && !affordable);
      el.classList.toggle('build-active', sameTool(tool, entry));
    }
    // inventory strip
    const parts: string[] = [];
    for (const [item, n] of Object.entries(world.state.inventory) as [ItemId, number][]) {
      const count = Math.floor(n);
      if (count > 0) parts.push(`<span class="inv-item item-chip" title="${ITEM_NAMES[item]}">${iconHtml(item, 18)}<b>${count}</b></span>`);
    }
    const html = parts.length ? parts.join('') : '<span class="inv-empty">Inventory empty — belt items into a Storage Depot</span>';
    if (this.invBar.innerHTML !== html) this.invBar.innerHTML = html;
    void this.container;
  }
}
