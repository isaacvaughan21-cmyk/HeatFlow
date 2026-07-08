// ── Top bar: the numbers that matter ────────────────────────────────────────
import { World } from '../sim/world';

export interface HudCallbacks {
  onSpeed(s: 0 | 1 | 2 | 4): void;
  onResearch(): void;
  onHeatOverlay(): void;
  onHelp(): void;
  onSave(): void;
  onNewGame(): void;
}

export class Hud {
  private eff!: HTMLElement;
  private ceiling!: HTMLElement;
  private powerFill!: HTMLElement;
  private powerText!: HTMLElement;
  private clock!: HTMLElement;
  private goal!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private heatBtn!: HTMLButtonElement;
  private spark!: HTMLCanvasElement;
  private sparkT = 0;

  constructor(container: HTMLElement, cb: HudCallbacks) {
    container.innerHTML = `
      <div class="hud-left">
        <span class="hud-logo">HEAT<b>FLOW</b></span>
        <div class="hud-stat" title="Net efficiency: engine work generated ÷ primary heat drawn (vents + fuel), rolling 10 s. The small ◇ number is the Carnot ceiling of your best running engine — physics forbids reaching it; get close.">
          <span class="hud-label">NET EFFICIENCY</span>
          <span class="hud-eff" id="hud-eff">0.0%</span>
          <span class="hud-ceiling" id="hud-ceiling">◇ Carnot —</span>
        </div>
        <canvas id="hud-spark" width="132" height="30" title="Net efficiency, last 2 minutes. The dotted line is the 55% Grand Cycle target."></canvas>
        <div class="hud-stat hud-power" title="Electric grid: demand / generation. Deficits throttle every powered machine. The +6 kW auxiliary genset is always on.">
          <span class="hud-label">POWER</span>
          <div class="power-bar"><div class="power-fill" id="power-fill"></div></div>
          <span class="hud-small" id="power-text">0 / 0 kW</span>
        </div>
      </div>
      <div class="hud-right">
        <span class="hud-goal" id="hud-goal" title="The Grand Cycle: with a Controller built, sustain 55% net efficiency with every machine class active, stable and fully powered, for 60 s.">🏆 —</span>
        <span class="hud-clock" id="hud-clock">0:00</span>
        <span class="speed-group" id="speed-group"></span>
        <button class="hud-btn" id="btn-research" title="Research tree (T)">Research</button>
        <button class="hud-btn" id="btn-heat" title="Heat overlay: recolor everything by temperature (H)">Heat</button>
        <button class="hud-btn" id="btn-help" title="Controls & how to play (?)">?</button>
        <button class="hud-btn" id="btn-save" title="Save now (autosaves every 15 s)">Save</button>
        <button class="hud-btn hud-btn-danger" id="btn-new" title="Wipe the save and restart">New</button>
      </div>`;
    this.eff = container.querySelector('#hud-eff')!;
    this.ceiling = container.querySelector('#hud-ceiling')!;
    this.powerFill = container.querySelector('#power-fill')!;
    this.powerText = container.querySelector('#power-text')!;
    this.clock = container.querySelector('#hud-clock')!;
    this.goal = container.querySelector('#hud-goal')!;
    this.spark = container.querySelector('#hud-spark')!;
    const speedGroup = container.querySelector('#speed-group')!;
    const speeds: [0 | 1 | 2 | 4, string][] = [[0, '⏸'], [1, '1×'], [2, '2×'], [4, '4×']];
    for (const [s, label] of speeds) {
      const b = document.createElement('button');
      b.className = 'hud-btn speed-btn';
      b.textContent = label;
      b.title = s === 0 ? 'Pause (Space)' : `Speed ${label} (key ${s === 4 ? 3 : s})`;
      b.addEventListener('click', () => cb.onSpeed(s));
      b.dataset.speed = String(s);
      speedGroup.appendChild(b);
      this.speedBtns.push(b);
    }
    this.heatBtn = container.querySelector('#btn-heat')!;
    (container.querySelector('#btn-research') as HTMLButtonElement).addEventListener('click', cb.onResearch);
    this.heatBtn.addEventListener('click', cb.onHeatOverlay);
    (container.querySelector('#btn-help') as HTMLButtonElement).addEventListener('click', cb.onHelp);
    (container.querySelector('#btn-save') as HTMLButtonElement).addEventListener('click', cb.onSave);
    (container.querySelector('#btn-new') as HTMLButtonElement).addEventListener('click', cb.onNewGame);
  }

  update(world: World, heatOverlay: boolean, dtReal: number): void {
    const s = world.state.stats;
    this.eff.textContent = `${(s.eff10 * 100).toFixed(1)}%`;
    this.ceiling.textContent = s.carnotCeiling > 0
      ? `◇ Carnot ${(s.carnotCeiling * 100).toFixed(0)}%`
      : '◇ Carnot —';
    const gen = s.gen + s.auxGen;
    const ratio = gen > 0 ? Math.min(1, s.load / gen) : 0;
    this.powerFill.style.width = `${Math.round(ratio * 100)}%`;
    this.powerFill.classList.toggle('power-deficit', s.throttle < 0.999);
    this.powerText.textContent = `${s.load.toFixed(0)} / ${gen.toFixed(0)} kW${s.gen === 0 ? ' (aux)' : ''}`;
    const t = Math.floor(world.state.time);
    this.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    for (const b of this.speedBtns) {
      b.classList.toggle('speed-active', Number(b.dataset.speed) === world.state.speed);
    }
    this.heatBtn.classList.toggle('speed-active', heatOverlay);
    this.sparkT += dtReal;
    if (this.sparkT > 0.5) {
      this.sparkT = 0;
      this.drawSpark(world);
    }
    if (world.state.won) {
      this.goal.textContent = '🏆 GRAND CYCLE COMPLETE';
      this.goal.classList.add('goal-won');
    } else {
      const r = world.winReport();
      const hasController = world.state.machines.some((m) => m.type === 'controller');
      if (!hasController) {
        this.goal.textContent = `🏆 Goal: ${(r.target * 100).toFixed(0)}% for ${r.holdTime}s`;
      } else if (r.timer > 0) {
        this.goal.textContent = `🏆 HOLDING ${r.timer.toFixed(0)}/${r.holdTime}s`;
      } else {
        const missing: string[] = [];
        if (!r.effOk) missing.push(`eff ${(r.eff * 100).toFixed(0)}/${(r.target * 100).toFixed(0)}%`);
        if (r.classesActive.length < r.classesNeeded.length) missing.push(`${r.classesNeeded.length - r.classesActive.length} classes idle`);
        if (!r.stableOk) missing.push('overheat');
        if (!r.powerOk) missing.push('deficit');
        this.goal.textContent = `🏆 ${missing.join(' · ') || 'checking…'}`;
      }
    }
  }

  /** last ~2 minutes of per-second net efficiency */
  private drawSpark(world: World): void {
    const ctx = this.spark.getContext('2d');
    if (!ctx) return;
    const W = this.spark.width;
    const H = this.spark.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.fillRect(0, 0, W, H);
    const st = world.state.stats;
    const N = 110;
    const pts: number[] = [];
    let prev = 0;
    for (let k = N; k >= 1; k--) {
      const b = st.buckets[(st.bucketPos - k + st.buckets.length * 2) % st.buckets.length];
      const e = b.primary > 0.3 ? Math.min(1, b.work / b.primary) : prev;
      prev = e;
      pts.push(e);
    }
    // 55% target line
    const ty = H - 2 - 0.55 * (H - 5);
    ctx.strokeStyle = 'rgba(255,207,90,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, ty);
    ctx.lineTo(W, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#55c98a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * W;
      const y = H - 2 - pts[i] * (H - 5);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
