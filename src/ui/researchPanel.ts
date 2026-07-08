// ── Tech tree overlay ────────────────────────────────────────────────────────
import { World } from '../sim/world';
import {
  RESEARCH_NODES, ResearchNode, canSelect, effGateMet, isNodeComplete,
  nodeProgressFrac, nodeRemaining, prereqsMet,
} from '../sim/research';
import { MACHINE_DEFS } from '../sim/machines';
import { ITEM_NAMES, ItemId } from '../sim/types';
import { iconHtml } from './itemIcons';
import { machinePortrait } from './portraits';

export class ResearchPanel {
  visible = false;
  private lastHash = '';

  constructor(private container: HTMLElement, private onChanged: () => void) {}

  toggle(world: World): void {
    this.visible = !this.visible;
    this.container.classList.toggle('hidden', !this.visible);
    if (this.visible) this.render(world);
  }

  close(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }

  private hash(world: World): string {
    const rs = world.state.research;
    const prog = Object.entries(rs.progress)
      .map(([n, items]) => `${n}:${Object.values(items).map((x) => Math.floor(x ?? 0)).join(',')}`)
      .join(';');
    return `${rs.active}|${rs.completed.join(',')}|${rs.bestSustained.toFixed(3)}|${prog}`;
  }

  update(world: World): void {
    if (!this.visible) return;
    // re-render only when the data actually changed, and never yank the DOM
    // out from under the cursor (that would swallow clicks)
    const h = this.hash(world);
    if (h === this.lastHash || this.container.matches(':hover')) return;
    this.render(world);
  }

  private render(world: World): void {
    this.lastHash = this.hash(world);
    const rs = world.state.research;
    let html = `<div class="rp-head">
      <b>RESEARCH</b>
      <span class="rp-best" title="Some nodes require you to have sustained a net efficiency (30 s average). Best you've reached:">best sustained η: <b>${(rs.bestSustained * 100).toFixed(1)}%</b></span>
      <span class="rp-hint">select one node — feed its parts into a Research Lab</span>
      <button class="rp-close" data-act="close">✕</button>
    </div><div class="rp-cols">`;
    for (const tier of [1, 2, 3, 4] as const) {
      html += `<div class="rp-col"><div class="rp-tier">TIER ${tier}</div>`;
      for (const node of RESEARCH_NODES.filter((n) => n.tier === tier)) {
        html += this.nodeCard(world, node);
      }
      html += '</div>';
    }
    html += '</div>';
    this.container.innerHTML = html;
    this.container.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    for (const el of this.container.querySelectorAll('[data-node]')) {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.node!;
        const node = RESEARCH_NODES.find((n) => n.id === id)!;
        const rs2 = world.state.research;
        if (isNodeComplete(rs2, id)) return;
        if (rs2.active === id) {
          rs2.active = null;
        } else if (canSelect(rs2, node)) {
          rs2.active = id;
        }
        this.render(world);
        this.onChanged();
      });
    }
  }

  private nodeCard(world: World, node: ResearchNode): string {
    const rs = world.state.research;
    const complete = isNodeComplete(rs, node.id);
    const active = rs.active === node.id;
    const prereq = prereqsMet(rs, node);
    const gate = effGateMet(rs, node);
    const selectable = canSelect(rs, node);
    let cls = 'rp-node';
    if (complete) cls += ' rp-done';
    else if (active) cls += ' rp-active';
    else if (selectable) cls += ' rp-avail';
    else cls += ' rp-locked';
    const frac = nodeProgressFrac(rs, node);
    let html = `<div class="${cls}" data-node="${node.id}">`;
    html += `<div class="rp-node-name">${complete ? '✓ ' : ''}${node.name}${active ? ' <span class="rp-badge">ACTIVE</span>' : ''}</div>`;
    html += `<div class="rp-node-desc">${node.desc}</div>`;
    if (node.unlockMachines.length) {
      const unlocks = node.unlockMachines
        .map((t) => `<span class="rp-unlock-chip"><img class="rp-mini" src="${machinePortrait(t, 40)}" alt="">${MACHINE_DEFS[t].name}</span>`)
        .join(' ');
      html += `<div class="rp-unlocks">→ ${unlocks}${node.unlockRecipes.length ? ` <span class="rp-unlock-chip">+ ${node.unlockRecipes.join(', ')} recipe</span>` : ''}</div>`;
    } else if (node.id === 'insulation') {
      html += `<div class="rp-unlocks">→ Insulated Pipes</div>`;
    }
    if (!complete) {
      const rem = nodeRemaining(rs, node);
      const costs: string[] = [];
      for (const [item, need] of Object.entries(node.cost) as [ItemId, number][]) {
        const left = rem[item] ?? 0;
        costs.push(`<span class="item-chip ${left <= 0 ? 'cost-ok' : ''}" title="${ITEM_NAMES[item]}">${iconHtml(item, 15)}${need - left}/${need}</span>`);
      }
      html += `<div class="rp-cost">${costs.join(' ')}</div>`;
      if (frac > 0) html += `<div class="insp-bar"><div class="insp-bar-fill fill-eff" style="width:${Math.round(frac * 100)}%"></div></div>`;
      if (node.effGate !== undefined) {
        html += `<div class="rp-gate ${gate ? 'gate-ok' : 'gate-bad'}">⚡ requires sustained η ≥ ${(node.effGate * 100).toFixed(0)}%${gate ? ' ✓' : ` (best: ${(rs.bestSustained * 100).toFixed(1)}%)`}</div>`;
      }
      if (!prereq) {
        const missing = node.requires.filter((r) => !rs.completed.includes(r))
          .map((r) => RESEARCH_NODES.find((n) => n.id === r)?.name ?? r);
        html += `<div class="rp-req">needs: ${missing.join(', ')}</div>`;
      }
    }
    html += '</div>';
    return html;
  }
}
