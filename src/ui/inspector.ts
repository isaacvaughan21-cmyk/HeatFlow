// ── Selected-machine panel: honest live numbers for engineer brains ─────────
// Data-bound: the DOM skeleton is built once per selection and only text/width
// values update each tick, so numbers stay live and buttons never break.
import { World } from '../sim/world';
import { MACHINE_DEFS, isEngine, isSink } from '../sim/machines';
import { RECIPES } from '../sim/recipes';
import { recipeUnlocked, nodeById, nodeRemaining } from '../sim/research';
import { heatPumpCOP } from '../sim/thermo';
import { ITEM_NAMES, ItemId, Machine } from '../sim/types';
import { iconHtml } from './itemIcons';
import { machinePortrait } from './portraits';

const STATUS_LABEL: Record<string, string> = {
  ok: 'Running', idle: 'Idle', overheat: 'OVERHEATED', noHeat: 'No heat input',
  noWater: 'No feedwater', noSteam: 'No steam', noSink: 'No cold sink!',
  noFuel: 'No fuel', noPower: 'Power deficit', lowTemp: 'Input temp too low',
};

type Segment =
  | { type: 'row'; k: string; label: string }
  | { type: 'bar'; k: string }
  | { type: 'note'; k: string }
  | { type: 'select'; k: string; options: { value: string; label: string }[] };

interface Values {
  rows: Record<string, { v: string; cls?: string; html?: boolean }>;
  bars: Record<string, { frac: number; cls: string }>;
  notes: Record<string, string>;
  selects: Record<string, string>;
  status: { text: string; cls: string };
}

function itemsList(items: Partial<Record<ItemId, number>>): string {
  const parts: string[] = [];
  for (const [item, n] of Object.entries(items) as [ItemId, number][]) {
    if ((n ?? 0) > 0.05) {
      parts.push(`<span class="item-chip" title="${ITEM_NAMES[item]}">${iconHtml(item, 14)}${(n ?? 0).toFixed(1)}</span>`);
    }
  }
  return parts.length ? parts.join(' ') : '—';
}

export class Inspector {
  selectedId: number | null = null;
  private sig = '';
  private rowEls = new Map<string, { row: HTMLElement; val: HTMLElement }>();
  private barEls = new Map<string, HTMLElement>();
  private noteEls = new Map<string, HTMLElement>();
  private selectEls = new Map<string, HTMLSelectElement>();
  private statusEl: HTMLElement | null = null;

  constructor(
    private container: HTMLElement,
    private onDelete: (id: number) => void,
    private onRecipe: (id: number, recipe: string) => void,
  ) {}

  select(id: number | null): void {
    this.selectedId = id;
    this.sig = '';
    this.container.classList.toggle('hidden', id === null);
    if (id === null) this.container.innerHTML = '';
  }

  update(world: World): void {
    if (this.selectedId === null) return;
    const m = world.machineById(this.selectedId);
    if (!m) { this.select(null); return; }
    const segments = this.describe(m, world);
    const sig = `${m.id}|${m.type}|${segments.map((s) => `${s.type}:${'k' in s ? s.k : ''}${s.type === 'select' ? s.options.map((o) => o.value).join(',') : ''}`).join('|')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.build(m, segments);
    }
    this.apply(this.values(m, world));
  }

  // ── layout per machine type ───────────────────────────────────────────────
  private describe(m: Machine, world: World): Segment[] {
    const def = MACHINE_DEFS[m.type];
    const seg: Segment[] = [];
    const row = (k: string, label: string) => seg.push({ type: 'row', k, label });
    const bar = (k: string) => seg.push({ type: 'bar', k });
    const note = (k: string) => seg.push({ type: 'note', k });

    if (isEngine(def)) {
      row('thot', 'T hot');
      row('tcold', 'T cold');
      row('carnot', 'Carnot limit');
      row('eta', 'Actual η');
      bar('etabar');
      row('qin', 'Heat in');
      row('work', 'Work out');
      row('waste', 'Waste out');
      if (def.maxTemp < 9000) row('maxt', 'Max steam temp');
      if (m.type === 'gasTurbine') row('fuel', 'Fuel buffer');
    }
    if (isSink(def)) {
      row('sinkt', 'Sink temp');
      bar('sinkbar');
      row('absorb', 'Absorbing');
      row('reject', 'Rejecting to ambient');
      if (m.type === 'condenser') row('wret', 'Water return');
    }
    if (m.type === 'boiler') {
      row('qin', 'Heat in');
      row('steam', 'Steam out');
      row('maxsteam', 'Max steam temp');
      row('tank', 'Feedwater');
      bar('tankbar');
    }
    if (m.type === 'superheater' || m.type === 'reheater') {
      row('thru', 'Throughput');
      if (m.fluidOut) row('outt', 'Steam out temp');
      if (m.type === 'reheater') row('fx', 'Effect');
    }
    if (m.type === 'vent' || m.type === 'furnace') {
      row('src', 'Source');
      row('drawn', 'Drawn');
      if (m.type === 'furnace') row('fuel', 'Coal buffer');
    }
    if (m.type === 'economizer' || m.type === 'regenerator') {
      row('win', 'Waste heat in');
      row('wout', 'Water out');
      row('fx', 'Effect');
    }
    if (m.type === 'exchanger' || m.type === 'coupler') {
      row('thru', 'Throughput');
      if (m.fluidOut) row('outt', 'Out temp');
    }
    if (m.type === 'heatPump') {
      row('pull', 'Pulling');
      row('cop', 'COP');
      row('pwr', 'Power');
      note('hpnote');
    }
    if (m.type === 'teg') {
      row('qin', 'Heat in');
      row('work', 'Work out');
      row('eta', 'η');
    }
    if (m.type === 'pump' || m.type === 'feedpump') {
      row('wout', 'Water out');
      row('pwr', 'Power');
    }
    if (m.type === 'miner') {
      row('out', 'Output buffer');
      row('pwr', 'Power');
    }
    if (m.type === 'smelter' || m.type === 'fabricator') {
      if (m.type === 'fabricator') {
        const recipes = RECIPES.filter((r) => r.machine === 'fabricator' && recipeUnlocked(world.state.research, r.id, r.locked));
        seg.push({ type: 'select', k: 'recipe', options: recipes.map((r) => ({ value: r.id, label: r.name })) });
      } else {
        row('recipe', 'Recipe');
        row('heat', 'Heat in');
      }
      bar('craftbar');
      row('in', 'Input');
      row('out', 'Output');
    }
    if (m.type === 'lab') {
      row('node', 'Researching');
      row('needs', 'Still needs');
      row('buf', 'Buffer');
      note('labnote');
    }
    if (m.type === 'depot') note('depnote');
    if (m.type === 'controller') {
      row('c1', 'Controller powered');
      row('c2', 'All classes active');
      note('missing');
      row('c3', 'Net efficiency');
      row('c4', 'No overheats');
      row('c5', 'No power deficit');
      row('hold', 'Hold');
      bar('holdbar');
    }
    if (def.powerDraw > 0 && !['heatPump', 'pump', 'feedpump', 'miner'].includes(m.type)) {
      row('pwr', 'Power');
    }
    return seg;
  }

  // ── live values ───────────────────────────────────────────────────────────
  private values(m: Machine, world: World): Values {
    const def = MACHINE_DEFS[m.type];
    const v: Values = { rows: {}, bars: {}, notes: {}, selects: {}, status: { text: '', cls: '' } };
    const R = (k: string, val: string, cls?: string) => { v.rows[k] = { v: val, cls }; };
    const RH = (k: string, val: string, cls?: string) => { v.rows[k] = { v: val, cls, html: true }; };

    v.status.text = STATUS_LABEL[m.status] ?? m.status;
    v.status.cls = m.status === 'ok' ? 'st-ok' : m.status === 'overheat' || m.status === 'noSink' ? 'st-bad' : 'st-warn';

    if (isEngine(def)) {
      R('thot', `${m.tHot.toFixed(0)} °C`);
      R('tcold', `${m.tCold.toFixed(0)} °C`);
      R('carnot', `${(m.carnot * 100).toFixed(1)}%`);
      R('eta', `${(m.eta * 100).toFixed(1)}%`, m.eta > 0 ? '' : 'dim');
      v.bars.etabar = { frac: m.carnot > 0 ? m.eta / m.carnot : 0, cls: 'fill-eff' };
      R('qin', `${m.qIn.toFixed(1)} HU/s`);
      R('work', `${m.work.toFixed(1)} kW`);
      R('waste', `${m.qWaste.toFixed(1)} HU/s`);
      if (def.maxTemp < 9000) R('maxt', `${def.maxTemp} °C`, m.tHot > def.maxTemp ? 'st-bad' : '');
      if (m.type === 'gasTurbine') RH('fuel', `<span class="item-chip">${iconHtml('coal', 14)}${(m.inItems.coal ?? 0).toFixed(1)}</span>`);
    }
    if (isSink(def)) {
      R('sinkt', `${m.temp.toFixed(1)} °C / max ${def.maxTemp} °C`, m.temp > def.maxTemp * 0.85 ? 'st-warn' : '');
      v.bars.sinkbar = { frac: (m.temp - 15) / (def.maxTemp - 15), cls: m.temp > def.maxTemp * 0.85 ? 'fill-hot' : 'fill-temp' };
      R('absorb', `${m.qIn.toFixed(1)} HU/s`);
      R('reject', `${m.rejected.toFixed(1)} HU/s`);
      if (m.type === 'condenser') R('wret', `${(m.qIn / 32).toFixed(2)} /s`);
    }
    if (m.type === 'boiler') {
      const tank = m.waterOut!;
      const out = m.fluidOut!;
      R('qin', `${m.qIn.toFixed(1)} HU/s @ ${m.tHot.toFixed(0)} °C`);
      R('steam', `${out.amount.toFixed(1)} HU @ ${out.temp.toFixed(0)} °C`);
      R('maxsteam', `${world.boilerMaxTemp()} °C`);
      R('tank', `${tank.amount.toFixed(1)} / ${tank.cap} @ ${tank.temp.toFixed(0)} °C`);
      v.bars.tankbar = { frac: tank.amount / tank.cap, cls: 'fill-water' };
    }
    if (m.type === 'superheater' || m.type === 'reheater') {
      R('thru', `${m.qIn.toFixed(1)} HU/s`);
      if (m.fluidOut) R('outt', `${m.fluidOut.temp.toFixed(0)} °C`);
      if (m.type === 'reheater') R('fx', 'engines here: quality ×1.12');
    }
    if (m.type === 'vent' || m.type === 'furnace') {
      R('src', `${def.sourceTemp} °C, ≤ ${def.sourceRate} HU/s`);
      R('drawn', `${m.qIn.toFixed(1)} HU/s`);
      if (m.type === 'furnace') RH('fuel', `<span class="item-chip">${iconHtml('coal', 14)}${(m.inItems.coal ?? 0).toFixed(1)}</span>`);
    }
    if (m.type === 'economizer' || m.type === 'regenerator') {
      const buf = m.fluidOut!;
      R('win', `${m.qIn.toFixed(1)} HU/s @ ${m.tHot.toFixed(0)} °C`);
      R('wout', `${buf.amount.toFixed(1)} @ ${buf.temp.toFixed(0)} °C`);
      R('fx', 'hot feedwater cuts boiler demand');
    }
    if (m.type === 'exchanger' || m.type === 'coupler') {
      R('thru', `${m.qIn.toFixed(1)} HU/s`);
      if (m.fluidOut) R('outt', `${m.fluidOut.temp.toFixed(0)} °C`);
    }
    if (m.type === 'heatPump') {
      const targets = world.heatPumpTargets(m);
      R('pull', `${m.qIn.toFixed(1)} HU/s from sink`);
      R('cop', targets.length ? `${heatPumpCOP(targets[0].temp).toFixed(1)} (sink at ${targets[0].temp.toFixed(0)} °C)` : '—');
      R('pwr', `${m.powerUse.toFixed(1)} kW`);
      v.notes.hpnote = targets.length ? '' : 'Place directly beside a radiator/condenser/tower.';
    }
    if (m.type === 'teg') {
      R('qin', `${m.qIn.toFixed(1)} HU/s @ ${m.tHot.toFixed(0)} °C`);
      R('work', `${m.work.toFixed(1)} kW`);
      R('eta', `${(m.eta * 100).toFixed(1)}% (self-rejecting)`);
    }
    if (m.type === 'pump' || m.type === 'feedpump') {
      R('wout', `${m.fluidOut!.amount.toFixed(1)} / ${m.fluidOut!.cap}`);
      R('pwr', `${m.powerUse.toFixed(1)} kW`);
    }
    if (m.type === 'miner') {
      RH('out', itemsList(m.outItems));
      R('pwr', `${m.powerUse.toFixed(1)} kW`);
    }
    if (m.type === 'smelter' || m.type === 'fabricator') {
      if (m.type === 'fabricator') {
        v.selects.recipe = m.recipe ?? '';
      } else {
        R('recipe', m.recipe ? (RECIPES.find((r) => r.id === m.recipe)?.name ?? '—') : 'auto');
        R('heat', `${m.qIn.toFixed(1)} HU/s @ ${m.tHot.toFixed(0)} °C (needs ≥100)`);
      }
      const rec = RECIPES.find((r) => r.id === m.recipe);
      v.bars.craftbar = { frac: rec ? m.progress / rec.time : 0, cls: 'fill-eff' };
      RH('in', itemsList(m.inItems));
      RH('out', itemsList(m.outItems));
    }
    if (m.type === 'lab') {
      const rs = world.state.research;
      const node = rs.active ? nodeById(rs.active) : undefined;
      R('node', node ? node.name : '—');
      RH('needs', node ? itemsList(nodeRemaining(rs, node)) : '—');
      RH('buf', itemsList(m.inItems));
      v.notes.labnote = node ? '' : 'No active research — press T and select a node.';
    }
    if (m.type === 'depot') v.notes.depnote = 'Items belted here join your build inventory.';
    if (m.type === 'controller') {
      const r = world.winReport();
      const chk = (ok: boolean): string => (ok ? '✅' : '⬜');
      R('c1', chk(r.controllerOk));
      R('c2', `${chk(r.classesActive.length === r.classesNeeded.length)} ${r.classesActive.length}/${r.classesNeeded.length}`);
      const missing = r.classesNeeded.filter((c) => !r.classesActive.includes(c));
      v.notes.missing = missing.length ? `Idle: ${missing.join(', ')}` : '';
      R('c3', `${chk(r.effOk)} ${(r.eff * 100).toFixed(1)} / ${(r.target * 100).toFixed(0)}%`);
      R('c4', chk(r.stableOk));
      R('c5', chk(r.powerOk));
      R('hold', `${r.timer.toFixed(0)} / ${r.holdTime} s`);
      v.bars.holdbar = { frac: r.timer / r.holdTime, cls: 'fill-eff' };
    }
    if (def.powerDraw > 0 && !['heatPump', 'pump', 'feedpump', 'miner'].includes(m.type)) {
      R('pwr', `${m.powerUse.toFixed(1)} / ${def.powerDraw} kW`);
    }
    return v;
  }

  // ── skeleton + apply ──────────────────────────────────────────────────────
  private build(m: Machine, segments: Segment[]): void {
    const def = MACHINE_DEFS[m.type];
    this.rowEls.clear();
    this.barEls.clear();
    this.noteEls.clear();
    this.selectEls.clear();
    this.container.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'insp-head';
    head.innerHTML = `<span class="insp-title"><img class="insp-icon" src="${machinePortrait(m.type, 56)}" alt=""><b>${def.name}</b></span>`;
    const close = document.createElement('button');
    close.className = 'insp-close';
    close.textContent = '✕';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.select(null));
    head.appendChild(close);
    this.container.appendChild(head);
    const desc = document.createElement('div');
    desc.className = 'insp-desc';
    desc.textContent = def.desc;
    this.container.appendChild(desc);
    this.statusEl = document.createElement('div');
    this.container.appendChild(this.statusEl);

    for (const s of segments) {
      if (s.type === 'row') {
        const el = document.createElement('div');
        el.className = 'insp-row';
        const lab = document.createElement('span');
        lab.textContent = s.label;
        const val = document.createElement('b');
        el.append(lab, val);
        this.container.appendChild(el);
        this.rowEls.set(s.k, { row: el, val });
      } else if (s.type === 'bar') {
        const el = document.createElement('div');
        el.className = 'insp-bar';
        const fill = document.createElement('div');
        fill.className = 'insp-bar-fill';
        el.appendChild(fill);
        this.container.appendChild(el);
        this.barEls.set(s.k, fill);
      } else if (s.type === 'note') {
        const el = document.createElement('div');
        el.className = 'insp-note';
        this.container.appendChild(el);
        this.noteEls.set(s.k, el);
      } else {
        const el = document.createElement('div');
        el.className = 'insp-row';
        const lab = document.createElement('span');
        lab.textContent = 'Recipe';
        const sel = document.createElement('select');
        sel.className = 'insp-select';
        for (const o of s.options) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => this.onRecipe(m.id, sel.value));
        el.append(lab, sel);
        this.container.appendChild(el);
        this.selectEls.set(s.k, sel);
      }
    }
    const del = document.createElement('button');
    del.className = 'insp-delete';
    del.textContent = 'Demolish (60% refund)';
    del.addEventListener('click', () => {
      this.onDelete(m.id);
      this.select(null);
    });
    this.container.appendChild(del);
  }

  private apply(v: Values): void {
    if (this.statusEl) {
      const cls = `insp-status ${v.status.cls}`;
      if (this.statusEl.className !== cls) this.statusEl.className = cls;
      if (this.statusEl.textContent !== v.status.text) this.statusEl.textContent = v.status.text;
    }
    for (const [k, { row, val }] of this.rowEls) {
      const d = v.rows[k];
      if (!d) continue;
      if (d.html) {
        if (val.dataset.raw !== d.v) {
          val.dataset.raw = d.v;
          val.innerHTML = d.v;
        }
      } else if (val.textContent !== d.v) {
        val.textContent = d.v;
      }
      const cls = `insp-row ${d.cls ?? ''}`.trim();
      if (row.className !== cls) row.className = cls;
    }
    for (const [k, fill] of this.barEls) {
      const d = v.bars[k];
      if (!d) continue;
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, d.frac)) * 100)}%`;
      const cls = `insp-bar-fill ${d.cls}`;
      if (fill.className !== cls) fill.className = cls;
    }
    for (const [k, el] of this.noteEls) {
      const text = v.notes[k] ?? '';
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('hidden', text === '');
    }
    for (const [k, sel] of this.selectEls) {
      const val = v.selects[k];
      if (val !== undefined && document.activeElement !== sel && sel.value !== val) sel.value = val;
    }
  }
}

export type { Machine };
