// ── Heat Flow: bootstrap, game loop, input ──────────────────────────────────
import { World } from './sim/world';
import { saveGame, loadGame, clearSave } from './sim/save';
import { Renderer, UIView } from './render/renderer';
import { Hud } from './ui/hud';
import { BuildMenu } from './ui/buildMenu';
import { Inspector } from './ui/inspector';
import { ResearchPanel } from './ui/researchPanel';
import { Toasts } from './ui/toasts';
import { TICK, idx, inBounds } from './sim/types';
import { recipeById } from './sim/recipes';
import { MACHINE_DEFS, PIPE_COST, INS_PIPE_COST, BELT_COST, isEngine, isSink } from './sim/machines';
import { tutorialTargets } from './ui/toasts';
import { setPortraitProvider } from './ui/portraits';

let world = loadGame() ?? World.newGame();
let wasWon = world.state.won;
let lastSpeed: 1 | 2 | 4 = 1;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
renderer.camera.centerOn(10, 12);
setPortraitProvider({
  machine: (t, px) => renderer.machinePortrait(t, px),
  tool: (k, px) => renderer.toolPortrait(k, px),
});

const ui: UIView = { hover: null, tool: null, selectedId: null, heatOverlay: false, beltDir: 0 };

const toasts = new Toasts(document.getElementById('toasts')!);
const inspector = new Inspector(
  document.getElementById('inspector')!,
  (id) => {
    const m = world.machineById(id);
    if (m) world.removeAt(m.gx, m.gy);
  },
  (id, recipe) => {
    const m = world.machineById(id);
    if (!m) return;
    // refund inputs already consumed by an in-progress craft
    const old = m.recipe ? recipeById(m.recipe) : undefined;
    if (m.progress > 0 && old) {
      for (const [item, n] of Object.entries(old.inputs)) {
        m.inItems[item as keyof typeof m.inItems] = (m.inItems[item as keyof typeof m.inItems] ?? 0) + (n as number);
      }
    }
    m.recipe = recipe;
    m.progress = 0;
  },
);
const research = new ResearchPanel(document.getElementById('researchPanel')!, () => {
  buildMenu.refresh(world, ui.tool);
});
const buildMenu = new BuildMenu(document.getElementById('buildMenu')!, (t) => {
  ui.tool = t;
  buildMenu.refresh(world, ui.tool);
  canvas.style.cursor = t ? 'crosshair' : 'default';
});
const hud = new Hud(document.getElementById('hud')!, {
  onSpeed: (s) => {
    world.state.speed = s;
    if (s !== 0) lastSpeed = s;
  },
  onResearch: () => research.toggle(world),
  onHeatOverlay: () => { ui.heatOverlay = !ui.heatOverlay; },
  onHelp: () => toggleHelp(),
  onSave: () => {
    if (saveGame(world)) toasts.show('Game saved.', 'info', 1600);
  },
  onNewGame: () => {
    if (!window.confirm('Start over? This wipes your save.')) return;
    clearSave();
    world = World.newGame();
    wasWon = false;
    ui.tool = null;
    ui.selectedId = null;
    inspector.select(null);
    research.close();
    renderer.camera.centerOn(10, 12);
    toasts.show('New works commissioned. Find a vent!', 'info', 4000);
  },
});

// ── auxiliary overlays ───────────────────────────────────────────────────────
const worldTip = document.createElement('div');
worldTip.id = 'worldTip';
worldTip.className = 'hidden';
document.body.appendChild(worldTip);

const pausedEl = document.createElement('div');
pausedEl.id = 'paused';
pausedEl.className = 'hidden';
pausedEl.textContent = '⏸ PAUSED — Space to resume';
document.body.appendChild(pausedEl);

const legend = document.createElement('div');
legend.id = 'heatLegend';
legend.className = 'hidden';
legend.innerHTML = `
  <div class="legend-title">TEMPERATURE</div>
  <div class="legend-bar"></div>
  <div class="legend-ticks"><span>-25°</span><span>60°</span><span>300°</span><span>900°</span></div>`;
document.body.appendChild(legend);

const helpPanel = document.createElement('div');
helpPanel.id = 'helpPanel';
helpPanel.className = 'hidden';
helpPanel.innerHTML = `
  <div class="help-head"><b>HOW TO PLAY</b><button id="help-close">✕</button></div>
  <div class="help-cols">
    <div>
      <h4>Controls</h4>
      <div class="help-row"><kbd>drag</kbd> / <kbd>W A S D</kbd> pan · <kbd>wheel</kbd> zoom</div>
      <div class="help-row"><kbd>click</kbd> build button, then click the map to place</div>
      <div class="help-row"><kbd>drag</kbd> on the map lays pipes &amp; belts (belt direction follows the drag)</div>
      <div class="help-row"><kbd>R</kbd> rotate belt · <kbd>right-click</kbd> demolish / cancel tool</div>
      <div class="help-row"><kbd>click</kbd> a machine → live readouts · <kbd>Del</kbd> demolish it</div>
      <div class="help-row"><kbd>H</kbd> heat overlay · <kbd>T</kbd> research · <kbd>Space</kbd> pause · <kbd>1 2 3</kbd> speed · <kbd>Home</kbd> recenter</div>
    </div>
    <div>
      <h4>The loop</h4>
      <div class="help-row">🔥 Vent/furnace heat → <b>Boiler</b> (+water) → steam → <b>Engine</b> → power.</div>
      <div class="help-row">♨ Engines are Carnot-bound: η depends on T<sub>hot</sub> − T<sub>cold</sub>. Waste heat <i>must</i> reach a sink — overloaded sinks get hot, your efficiency collapses, machines trip.</div>
      <div class="help-row">🏭 Miners → smelters (need piped heat!) → fabricators → belts feed the <b>Research Lab</b> and the <b>Depot</b> (build materials).</div>
      <div class="help-row">🏆 Win: sustain <b>55% net efficiency</b>, every machine class running, feeding a Grand Cycle Controller for 60 s.</div>
      <h4>Tips</h4>
      <div class="help-row">Touching machines connect automatically. Keep pipe runs short — every tile bleeds heat. Insulate. Superheat. Chill sinks with heat pumps. Keep hot and cold loops on separate pipe networks.</div>
    </div>
  </div>`;
document.body.appendChild(helpPanel);
helpPanel.querySelector('#help-close')!.addEventListener('click', () => helpPanel.classList.add('hidden'));
function toggleHelp(): void {
  helpPanel.classList.toggle('hidden');
}

// ── input ────────────────────────────────────────────────────────────────────
const heldKeys = new Set<string>();
let panning = false;
let panButton = -1;
let dragMoved = false;
let placing = false;
let lastTile: { gx: number; gy: number } | null = null;
let lastMouse = { x: 0, y: 0 };

function tileAtMouse(e: MouseEvent): { gx: number; gy: number } {
  const g = renderer.camera.toGrid(e.clientX, e.clientY);
  return { gx: Math.floor(g.gx), gy: Math.floor(g.gy) };
}

function applyTool(gx: number, gy: number, prev: { gx: number; gy: number } | null, firstClick: boolean): void {
  const t = ui.tool;
  if (!t || !inBounds(gx, gy)) return;
  if (t.kind === 'machine') {
    const res = world.canPlaceMachine(t.type, gx, gy);
    if (res.ok) {
      world.placeMachine(t.type, gx, gy);
      buildMenu.refresh(world, ui.tool);
    } else if (firstClick) {
      toasts.show(res.reason, 'warn', 2200);
    }
  } else if (t.kind === 'pipe') {
    const ok = world.placePipe(gx, gy, t.insulated);
    if (!ok && firstClick) {
      if (t.insulated && !world.state.research.completed.includes('insulation')) {
        toasts.show('Insulated pipes need the “Pipe Insulation” research (T).', 'warn', 2600);
      } else if (!world.canAfford(t.insulated ? INS_PIPE_COST : PIPE_COST)) {
        toasts.show(t.insulated ? 'Not enough Iron Plates for insulated pipe.' : 'Not enough Iron Ingots for pipe.', 'warn', 2400);
      }
    }
  } else if (t.kind === 'belt') {
    let dir = ui.beltDir;
    if (prev && inBounds(prev.gx, prev.gy)) {
      const dx = gx - prev.gx;
      const dy = gy - prev.gy;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        dir = dx === 1 ? 0 : dx === -1 ? 2 : dy === 1 ? 1 : 3;
        ui.beltDir = dir;
        // make the previous belt point at us so corners flow naturally
        const pb = world.state.belts[idx(prev.gx, prev.gy)];
        if (pb) pb.dir = dir;
      }
    }
    const ok = world.placeBelt(gx, gy, dir);
    if (!ok && firstClick && !world.canAfford(BELT_COST)) {
      toasts.show('Not enough Iron Ingots for a belt.', 'warn', 2400);
    }
  } else if (t.kind === 'bulldoze') {
    world.removeAt(gx, gy);
    buildMenu.refresh(world, ui.tool);
  }
}

canvas.addEventListener('mousedown', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  dragMoved = false;
  if (e.button === 1 || e.button === 2 || (e.button === 0 && !ui.tool)) {
    panning = true;
    panButton = e.button;
    canvas.style.cursor = 'grabbing';
  } else if (e.button === 0 && ui.tool) {
    placing = true;
    const t = tileAtMouse(e);
    lastTile = t;
    applyTool(t.gx, t.gy, null, true);
  }
});

window.addEventListener('mousemove', (e) => {
  // defensive: a mouseup we never saw (alt-tab, devtools, OS chrome) must not
  // leave the camera glued to the cursor or the tool buying pipes forever
  if ((panning || placing) && e.buttons === 0) {
    panning = false;
    placing = false;
    lastTile = null;
    panButton = -1;
    canvas.style.cursor = ui.tool ? 'crosshair' : 'default';
  }
  const t = tileAtMouse(e);
  ui.hover = t;
  if (panning) {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
    renderer.camera.pan(dx, dy);
    lastMouse = { x: e.clientX, y: e.clientY };
    return;
  }
  lastMouse = { x: e.clientX, y: e.clientY };
  if (placing && lastTile && (t.gx !== lastTile.gx || t.gy !== lastTile.gy)) {
    applyTool(t.gx, t.gy, lastTile, false);
    lastTile = t;
  }
});

window.addEventListener('mouseup', (e) => {
  if (panning) {
    panning = false;
    canvas.style.cursor = ui.tool ? 'crosshair' : 'default';
    // click without drag: select or clear
    if (!dragMoved && panButton === 0 && !ui.tool && e.target === canvas) {
      const t = tileAtMouse(e);
      const m = world.machineAt(t.gx, t.gy);
      ui.selectedId = m ? m.id : null;
      inspector.select(ui.selectedId);
      if (m) inspector.update(world);
    }
    if (!dragMoved && panButton === 2 && e.target === canvas) {
      if (ui.tool) {
        ui.tool = null;
        buildMenu.refresh(world, ui.tool);
        canvas.style.cursor = 'default';
      } else {
        const t = tileAtMouse(e);
        world.removeAt(t.gx, t.gy);
      }
    }
    panButton = -1;
  }
  placing = false;
  lastTile = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

const PAN_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const key = e.key.toLowerCase();
  if (PAN_KEYS.includes(key)) {
    heldKeys.add(key);
    if (key.startsWith('arrow')) e.preventDefault();
    return;
  }
  switch (key) {
    case 'h':
      ui.heatOverlay = !ui.heatOverlay;
      break;
    case 't':
      research.toggle(world);
      break;
    case 'r':
      ui.beltDir = ((ui.beltDir + 1) % 4) as 0 | 1 | 2 | 3;
      break;
    case '?': case 'f1':
      e.preventDefault();
      toggleHelp();
      break;
    case 'home': {
      const ms = world.state.machines;
      if (ms.length) {
        const cx = ms.reduce((sum, m) => sum + m.gx, 0) / ms.length;
        const cy = ms.reduce((sum, m) => sum + m.gy, 0) / ms.length;
        renderer.camera.centerOn(cx + 0.5, cy + 0.5);
      } else {
        renderer.camera.centerOn(7.5, 8.5); // first vent
      }
      break;
    }
    case ' ':
      e.preventDefault();
      world.state.speed = world.state.speed === 0 ? lastSpeed : 0;
      break;
    case '1': world.state.speed = 1; lastSpeed = 1; break;
    case '2': world.state.speed = 2; lastSpeed = 2; break;
    case '3': case '4': world.state.speed = 4; lastSpeed = 4; break;
    case 'escape':
      if (!helpPanel.classList.contains('hidden')) helpPanel.classList.add('hidden');
      else if (research.visible) research.close();
      else if (ui.tool) {
        ui.tool = null;
        buildMenu.refresh(world, ui.tool);
        canvas.style.cursor = 'default';
      } else {
        ui.selectedId = null;
        inspector.select(null);
      }
      break;
    case 'delete': case 'backspace': {
      if (ui.selectedId !== null) {
        const m = world.machineById(ui.selectedId);
        if (m) world.removeAt(m.gx, m.gy);
        ui.selectedId = null;
        inspector.select(null);
      }
      break;
    }
    default: break;
  }
});

window.addEventListener('keyup', (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('beforeunload', () => saveGame(world));

// ── victory ──────────────────────────────────────────────────────────────────
function showVictory(): void {
  const el = document.getElementById('victory')!;
  const s = world.state.stats;
  const ratio = s.carnotCeiling > 0 ? s.eff60 / s.carnotCeiling : 0;
  const grade = ratio > 0.82 ? 'S' : ratio > 0.72 ? 'A' : ratio > 0.62 ? 'B' : 'C';
  el.innerHTML = `
    <div class="victory-panel">
      <div class="victory-title">THE GRAND CYCLE IS COMPLETE</div>
      <div class="victory-sub">You bent entropy as far as it bends.</div>
      <div class="victory-stats">
        <div><span>Net efficiency (60 s)</span><b>${(s.eff60 * 100).toFixed(1)}%</b></div>
        <div><span>Carnot ceiling of your plant</span><b>${(s.carnotCeiling * 100).toFixed(1)}%</b></div>
        <div><span>Fraction of the possible, achieved</span><b>${(ratio * 100).toFixed(0)}%</b></div>
        <div><span>Total fuel burned</span><b>${s.fuelUsed.toFixed(0)} coal</b></div>
        <div><span>Engineer grade</span><b class="grade grade-${grade}">${grade}</b></div>
      </div>
      <button id="victory-continue">Continue in Sandbox</button>
    </div>`;
  el.classList.remove('hidden');
  document.getElementById('victory-continue')?.addEventListener('click', () => {
    el.classList.add('hidden');
  });
}

// ── loop ─────────────────────────────────────────────────────────────────────
let last = performance.now();
let acc = 0;
let uiTimer = 0;
let autosaveTimer = 0;

/** one-line live summary for the hover tooltip */
function machineSummary(mId: number): string {
  const m = world.machineById(mId);
  if (!m) return '';
  const def = MACHINE_DEFS[m.type];
  if (isEngine(def)) return `${m.work.toFixed(1)} kW · η ${(m.eta * 100).toFixed(0)}%`;
  if (isSink(def)) return `${m.temp.toFixed(0)} °C / ${def.maxTemp} °C`;
  if (m.type === 'boiler') return `steam ${m.fluidOut!.temp.toFixed(0)} °C`;
  if (m.type === 'vent' || m.type === 'furnace') return `${m.qIn.toFixed(0)} HU/s drawn`;
  if (m.type === 'superheater' || m.type === 'coupler' || m.type === 'exchanger') return `${m.qIn.toFixed(0)} HU/s`;
  return '';
}

const STATUS_SHORT: Record<string, string> = {
  ok: '● running', idle: '○ idle', overheat: '⚠ OVERHEATED', noHeat: '❄ no heat',
  noWater: '≈ no water', noSteam: '○ no steam', noSink: '♨ NO SINK', noFuel: '▲ no fuel',
  noPower: '⚡ power deficit', lowTemp: '❄ too cold',
};

function updateWorldTip(): void {
  let show = false;
  if (!ui.tool && !panning && ui.hover) {
    const m = world.machineAt(ui.hover.gx, ui.hover.gy);
    if (m) {
      const def = MACHINE_DEFS[m.type];
      const stat = machineSummary(m.id);
      worldTip.innerHTML = `<b>${def.name}</b><span class="${m.status === 'ok' ? 'tip-ok' : 'tip-warn'}">${STATUS_SHORT[m.status] ?? m.status}</span>${stat ? `<i>${stat}</i>` : ''}`;
      const tx = Math.min(window.innerWidth - worldTip.offsetWidth - 12, lastMouse.x + 18);
      const ty = Math.max(58, lastMouse.y - 14);
      worldTip.style.left = `${tx}px`;
      worldTip.style.top = `${ty}px`;
      show = true;
    }
  }
  worldTip.classList.toggle('hidden', !show);
}

function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dtReal * world.state.speed;
  let steps = 0;
  while (acc >= TICK && steps < 48) {
    world.tick();
    acc -= TICK;
    steps++;
  }
  if (steps >= 48) acc = 0;

  // keyboard panning
  if (heldKeys.size) {
    const spd = 560 * dtReal;
    let px = 0; let py = 0;
    if (heldKeys.has('a') || heldKeys.has('arrowleft')) px += spd;
    if (heldKeys.has('d') || heldKeys.has('arrowright')) px -= spd;
    if (heldKeys.has('w') || heldKeys.has('arrowup')) py += spd;
    if (heldKeys.has('s') || heldKeys.has('arrowdown')) py -= spd;
    if (px !== 0 || py !== 0) renderer.camera.pan(px, py);
  }

  toasts.drainEvents(world);
  toasts.updateTutorial(world);
  hud.update(world, ui.heatOverlay, dtReal);
  updateWorldTip();
  legend.classList.toggle('hidden', !ui.heatOverlay);
  pausedEl.classList.toggle('hidden', world.state.speed !== 0);

  uiTimer += dtReal;
  if (uiTimer >= 0.25) {
    uiTimer = 0;
    inspector.update(world);
    buildMenu.refresh(world, ui.tool);
    buildMenu.setHighlights(tutorialTargets(world));
    research.update(world);
  }

  autosaveTimer += dtReal;
  if (autosaveTimer >= 15) {
    autosaveTimer = 0;
    saveGame(world);
  }

  if (world.state.won && !wasWon) {
    wasWon = true;
    showVictory();
  }

  renderer.render(world, ui, dtReal);
  requestAnimationFrame(frame);
}

buildMenu.refresh(world, ui.tool);
if (world.state.machines.length === 0) {
  toasts.show('Find the glowing vents — free geothermal heat.', 'info', 6000);
}
requestAnimationFrame(frame);

// dev/debug hook (harmless in prod; lets tests drive the sim)
declare global {
  interface Window { __hf?: { world(): World; ui: UIView; cam(): { x: number; y: number; zoom: number } } }
}
window.__hf = {
  world: () => world,
  ui,
  cam: () => renderer.camera,
};
