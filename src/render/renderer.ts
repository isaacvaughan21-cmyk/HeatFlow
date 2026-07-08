// ── Canvas renderer: blueprint-dark isometric world ─────────────────────────
import { Camera, TILE_W, TILE_H } from './iso';
import { tempColor, heatIntensity } from './heatmap';
import { World } from '../sim/world';
import { MACHINE_DEFS, MachineDef } from '../sim/machines';
import {
  AMBIENT, BeltTile, DIRS, ItemId, MAP_H, MAP_W, Machine, MachineTypeId,
  TerrainType, idx, inBounds,
} from '../sim/types';

export type Tool =
  | { kind: 'machine'; type: MachineTypeId }
  | { kind: 'pipe'; insulated: boolean }
  | { kind: 'belt' }
  | { kind: 'bulldoze' }
  | null;

export interface UIView {
  hover: { gx: number; gy: number } | null;
  tool: Tool;
  selectedId: number | null;
  heatOverlay: boolean;
  beltDir: 0 | 1 | 2 | 3;
}

const TERRAIN_FILL: Record<TerrainType, string> = {
  ground: '#20252f',
  vent: '#3c2c1c',
  ironDeposit: '#252a35',
  copperDeposit: '#2e2620',
  coalDeposit: '#1a1d24',
  quartzDeposit: '#272c37',
};

const DEPOSIT_ROCK: Partial<Record<TerrainType, string>> = {
  ironDeposit: '#8a92a2',
  copperDeposit: '#c47a42',
  coalDeposit: '#3a3e48',
  quartzDeposit: '#dbe4f2',
};

const ITEM_COLOR: Record<ItemId, string> = {
  ironOre: '#8a8f9a', copperOre: '#c07840', coal: '#40444e', quartz: '#dfe4ee',
  ironIngot: '#aab1bd', copperIngot: '#d98d4f', ironPlate: '#c3c9d4',
  copperWire: '#e0a060', copperCoil: '#e8b070', machineFrame: '#9aa4b8',
  sensor: '#7fd4c0', turbineBlade: '#b9c4e0',
};

interface Particle {
  gx: number; gy: number;   // grid position
  z: number;                // px above ground at zoom 1
  vz: number;               // px/s
  vx: number; vy: number;   // grid units/s drift
  life: number; maxLife: number;
  r: number;                // px radius at zoom 1
  grow: number;             // px/s radius growth
  color: [number, number, number];
  alpha: number;
}

const MAX_PARTICLES = 260;

function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function mixHex(hex: string, target: [number, number, number], t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t) + target[0] * t);
  const g = Math.round(((n >> 8) & 255) * (1 - t) + target[1] * t);
  const b = Math.round((n & 255) * (1 - t) + target[2] * t);
  return `rgb(${r},${g},${b})`;
}

/** deterministic per-tile hash 0..1 */
function tileHash(gx: number, gy: number, salt = 0): number {
  let h = (gx * 374761393 + gy * 668265263 + salt * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1103515245;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  camera = new Camera();
  private animT = 0;     // always runs (UI pulses)
  private simT = 0;      // scales with sim speed (machine motion)
  private particles: Particle[] = [];
  private vignette: CanvasGradient | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.viewW = window.innerWidth;
    this.camera.viewH = window.innerHeight;
    const g = this.ctx.createRadialGradient(
      this.camera.viewW / 2, this.camera.viewH / 2, Math.min(this.camera.viewW, this.camera.viewH) * 0.35,
      this.camera.viewW / 2, this.camera.viewH / 2, Math.max(this.camera.viewW, this.camera.viewH) * 0.75,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(4,6,10,0.55)');
    this.vignette = g;
  }

  render(world: World, ui: UIView, dtReal: number): void {
    this.animT += dtReal;
    this.simT += dtReal * (world.state.speed > 0 ? Math.min(world.state.speed, 2) : 0);
    const { ctx, camera } = this;
    ctx.fillStyle = '#141924';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    this.drawSlab(ui);
    this.drawFloor(world, ui);
    this.drawCouplings(world, ui);
    this.drawPipes(world, ui);
    this.drawBelts(world);
    this.drawMachines(world, ui);
    this.updateAndDrawParticles(world, dtReal);
    this.drawGhost(world, ui);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
  }

  // ── geometry helpers ──────────────────────────────────────────────────────
  private diamond(gx: number, gy: number, s = 1): [number, number][] {
    const c = this.camera;
    const n = c.toScreen(gx, gy);
    const e = c.toScreen(gx + s, gy);
    const so = c.toScreen(gx + s, gy + s);
    const w = c.toScreen(gx, gy + s);
    return [[n.x, n.y], [e.x, e.y], [so.x, so.y], [w.x, w.y]];
  }

  private path(pts: [number, number][]): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  private tileCenter(gx: number, gy: number): { x: number; y: number } {
    return this.camera.toScreen(gx + 0.5, gy + 0.5);
  }

  private onScreen(x: number, y: number, margin: number): boolean {
    return x >= -margin && x <= this.camera.viewW + margin && y >= -margin && y <= this.camera.viewH + margin;
  }

  /** flat-shaded prism; returns top face pts */
  private prism(gx: number, gy: number, s: number, hPx: number, color: string, inset = 0.86): [number, number][] {
    const { ctx } = this;
    const z = this.camera.zoom;
    const c = this.camera.toScreen(gx + s / 2, gy + s / 2);
    const h = hPx * z;
    const base = this.diamond(gx, gy, s).map(([x, y]) =>
      [(x - c.x) * inset + c.x, (y - c.y) * inset + c.y] as [number, number]);
    const top = base.map(([x, y]) => [x, y - h] as [number, number]);
    this.path([base[3], base[2], top[2], top[3]]);
    ctx.fillStyle = shadeHex(colorToHex(color), 0.52);
    ctx.fill();
    this.path([base[2], base[1], top[1], top[2]]);
    ctx.fillStyle = shadeHex(colorToHex(color), 0.72);
    ctx.fill();
    this.path(top);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,18,0.6)';
    ctx.lineWidth = 1;
    this.path(top);
    ctx.stroke();
    // top-edge highlight (NW edges)
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(top[3][0], top[3][1]);
    ctx.lineTo(top[0][0], top[0][1]);
    ctx.lineTo(top[1][0], top[1][1]);
    ctx.stroke();
    return top;
  }

  /** iso cylinder standing on (cx, cy) ground point */
  private cylinder(cx: number, cy: number, rxPx: number, hPx: number, color: string): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const rx = rxPx * z;
    const ry = rx * 0.5;
    const h = hPx * z;
    const hex = colorToHex(color);
    const grad = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    grad.addColorStop(0, shadeHex(hex, 0.5));
    grad.addColorStop(0.45, shadeHex(hex, 0.85));
    grad.addColorStop(1, shadeHex(hex, 0.62));
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - h);
    ctx.lineTo(cx - rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, cy - h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = shadeHex(hex, 1.08);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,18,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private shadow(cx: number, cy: number, rxPx: number): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2 * z, rxPx * z, rxPx * 0.5 * z, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
  }

  private spawn(p: Omit<Particle, 'life'> & { life?: number }): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ ...p, life: p.maxLife });
  }

  // ── layers ────────────────────────────────────────────────────────────────
  private drawSlab(ui: UIView): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const d = 15 * z;
    const pSE = camera.toScreen(MAP_W, 0);
    const pS = camera.toScreen(MAP_W, MAP_H);
    const pSW = camera.toScreen(0, MAP_H);
    // side walls (extruded down)
    ctx.fillStyle = ui.heatOverlay ? '#0d1016' : '#151a24';
    ctx.beginPath();
    ctx.moveTo(pSW.x, pSW.y); ctx.lineTo(pS.x, pS.y);
    ctx.lineTo(pS.x, pS.y + d); ctx.lineTo(pSW.x, pSW.y + d);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = ui.heatOverlay ? '#0a0d13' : '#10141d';
    ctx.beginPath();
    ctx.moveTo(pS.x, pS.y); ctx.lineTo(pSE.x, pSE.y);
    ctx.lineTo(pSE.x, pSE.y + d); ctx.lineTo(pS.x, pS.y + d);
    ctx.closePath(); ctx.fill();
    // rim light along the top of the slab edge
    ctx.strokeStyle = 'rgba(120,160,220,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pSW.x, pSW.y); ctx.lineTo(pS.x, pS.y); ctx.lineTo(pSE.x, pSE.y);
    ctx.stroke();
  }

  private drawFloor(world: World, ui: UIView): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const margin = 80 * z;
    for (let gy = 0; gy < MAP_H; gy++) {
      for (let gx = 0; gx < MAP_W; gx++) {
        const c = this.tileCenter(gx, gy);
        if (!this.onScreen(c.x, c.y, margin)) continue;
        const terr = world.state.terrain[idx(gx, gy)];
        const pts = this.diamond(gx, gy);
        this.path(pts);
        if (ui.heatOverlay) {
          ctx.fillStyle = '#12151d';
        } else {
          const v = 0.94 + tileHash(gx, gy) * 0.12;
          ctx.fillStyle = shadeHex(TERRAIN_FILL[terr], v);
        }
        ctx.fill();
        ctx.strokeStyle = ui.heatOverlay ? '#191d27' : 'rgba(90,110,150,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (ui.heatOverlay) continue;
        const rock = DEPOSIT_ROCK[terr];
        if (rock && z > 0.5) this.drawDeposit(gx, gy, c, terr, rock);
        if (terr === 'vent' && !world.machineAt(gx, gy)) this.drawVentFissure(gx, gy, c, world);
      }
    }
    if (ui.hover && inBounds(ui.hover.gx, ui.hover.gy)) {
      this.path(this.diamond(ui.hover.gx, ui.hover.gy));
      ctx.strokeStyle = 'rgba(140,190,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawDeposit(gx: number, gy: number, c: { x: number; y: number }, terr: TerrainType, rock: string): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    for (let i = 0; i < 4; i++) {
      const hx = tileHash(gx, gy, i * 2 + 1) - 0.5;
      const hy = tileHash(gx, gy, i * 2 + 2) - 0.5;
      const px = c.x + hx * 30 * z;
      const py = c.y + hy * 14 * z;
      const r = (2.2 + tileHash(gx, gy, i + 9) * 2.2) * z;
      // little iso rock: top + shaded bottom
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py);
      ctx.lineTo(px, py + r * 0.7);
      ctx.lineTo(px - r, py);
      ctx.closePath();
      ctx.fillStyle = shadeHex(rock, 0.55);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py);
      ctx.lineTo(px - r * 0.15, py + r * 0.12);
      ctx.closePath();
      ctx.fillStyle = rock;
      ctx.fill();
      if (terr === 'quartzDeposit') {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(px - 0.7 * z, py - r * 0.7, 1.4 * z, 1.4 * z);
      }
    }
  }

  private drawVentFissure(gx: number, gy: number, c: { x: number; y: number }, world: World): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const pulse = 0.55 + 0.25 * Math.sin(this.animT * 2.2 + gx * 1.7);
    // glow halo
    const g = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, 16 * z);
    g.addColorStop(0, `rgba(255,150,50,${0.5 * pulse})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 16 * z, 8 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    // jagged fissure
    ctx.strokeStyle = `rgba(255,190,90,${0.8 * pulse})`;
    ctx.lineWidth = 1.8 * z;
    ctx.beginPath();
    ctx.moveTo(c.x - 9 * z, c.y + 2 * z);
    ctx.lineTo(c.x - 3 * z, c.y - 2.5 * z);
    ctx.lineTo(c.x + 2 * z, c.y + 1.5 * z);
    ctx.lineTo(c.x + 9 * z, c.y - 2 * z);
    ctx.stroke();
    if (world.state.speed > 0 && Math.random() < 0.02) {
      this.spawn({
        gx: gx + 0.5, gy: gy + 0.5, z: 0, vz: 26, vx: 0, vy: 0,
        maxLife: 1.3, r: 1.6, grow: 1, color: [255, 170, 80], alpha: 0.8,
      });
    }
  }

  /** subtle ground-level connector between directly-adjacent machines */
  private drawCouplings(world: World, ui: UIView): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    for (const m of world.state.machines) {
      for (const [fx, fy] of world.footprint(m)) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const o = world.machineAt(fx + dx, fy + dy);
          if (!o || o.id === m.id) continue;
          const a = this.tileCenter(fx, fy);
          const b = this.tileCenter(fx + dx, fy + dy);
          if (!this.onScreen((a.x + b.x) / 2, (a.y + b.y) / 2, 80 * z)) continue;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          ctx.strokeStyle = ui.heatOverlay ? '#2c3442' : '#4a5468';
          ctx.lineWidth = 4.5 * z;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(mid.x + (a.x - mid.x) * 0.55, mid.y + (a.y - mid.y) * 0.55 - 2 * z);
          ctx.lineTo(mid.x + (b.x - mid.x) * 0.55, mid.y + (b.y - mid.y) * 0.55 - 2 * z);
          ctx.stroke();
          ctx.fillStyle = '#5d6880';
          ctx.beginPath();
          ctx.arc(mid.x, mid.y - 2 * z, 2.4 * z, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private pipeNeighbors(world: World, gx: number, gy: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [dx, dy] of DIRS) {
      const nx = gx + dx; const ny = gy + dy;
      if (!inBounds(nx, ny)) continue;
      if (world.state.pipes[idx(nx, ny)] || world.machineAt(nx, ny)) out.push([dx, dy]);
    }
    return out;
  }

  private drawPipes(world: World, ui: UIView): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const margin = 90 * z;
    for (let i = 0; i < world.state.pipes.length; i++) {
      const p = world.state.pipes[i];
      if (!p) continue;
      const gx = i % MAP_W; const gy = Math.floor(i / MAP_W);
      const c = this.tileCenter(gx, gy);
      if (!this.onScreen(c.x, c.y, margin)) continue;
      const neighbors = this.pipeNeighbors(world, gx, gy);
      const casing = p.insulated ? '#9aa4b6' : '#4e5666';
      const hot = p.temp > AMBIENT + 2 || ui.heatOverlay;
      const core = hot ? tempColor(p.temp) : '#333b49';
      const lw = (p.insulated ? 7 : 5.5) * z;
      const lift = 3 * z;
      const targets: { x: number; y: number }[] = neighbors.length
        ? neighbors.map(([dx, dy]) => {
          const m2 = camera.toScreen(gx + 0.5 + dx * 0.5, gy + 0.5 + dy * 0.5);
          return { x: m2.x, y: m2.y };
        })
        : [c];
      // shadow under the pipe run
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = lw * 0.9;
      ctx.lineCap = 'round';
      for (const t of targets) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y + 1.5 * z);
        ctx.lineTo(t.x, t.y + 1.5 * z);
        ctx.stroke();
      }
      for (const t of targets) {
        ctx.strokeStyle = casing;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - lift);
        ctx.lineTo(t.x, t.y - lift);
        ctx.stroke();
      }
      for (const t of targets) {
        ctx.strokeStyle = core;
        ctx.lineWidth = lw * 0.45;
        if (p.flow > 0.5) {
          ctx.setLineDash([4 * z, 5 * z]);
          ctx.lineDashOffset = -this.simT * 26 * z;
        }
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - lift);
        ctx.lineTo(t.x, t.y - lift);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // joint cap
      ctx.fillStyle = casing;
      ctx.beginPath();
      ctx.arc(c.x, c.y - lift, lw * 0.52, 0, Math.PI * 2);
      ctx.fill();
      if (hot && p.flow > 0.5) {
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(c.x, c.y - lift, lw * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBelts(world: World): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const margin = 80 * z;
    for (let i = 0; i < world.state.belts.length; i++) {
      const b = world.state.belts[i];
      if (!b) continue;
      const gx = i % MAP_W; const gy = Math.floor(i / MAP_W);
      const c = this.tileCenter(gx, gy);
      if (!this.onScreen(c.x, c.y, margin)) continue;
      const pts = this.diamond(gx, gy).map(([x, y]) =>
        [(x - c.x) * 0.78 + c.x, (y - c.y) * 0.78 + c.y] as [number, number]);
      this.path(pts);
      ctx.fillStyle = '#272e3a';
      ctx.fill();
      ctx.strokeStyle = '#414b5d';
      ctx.lineWidth = 1;
      ctx.stroke();
      // roller lines perpendicular to travel
      const [dx, dy] = DIRS[b.dir];
      ctx.strokeStyle = 'rgba(70,82,104,0.8)';
      ctx.lineWidth = 1 * z;
      for (const f of [-0.22, 0, 0.22]) {
        const l = camera.toScreen(gx + 0.5 + dx * f - dy * 0.2, gy + 0.5 + dy * f - dx * 0.2);
        const r = camera.toScreen(gx + 0.5 + dx * f + dy * 0.2, gy + 0.5 + dy * f + dx * 0.2);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
      this.drawBeltArrow(b, gx, gy);
      // items ride the belt as little iso cubes
      let k = 0;
      const phase = (this.simT * 1.4) % 1;
      for (const item of Object.keys(b.items) as ItemId[]) {
        const n = b.items[item] ?? 0;
        if (n < 0.15) continue;
        const f = ((phase + k * 0.37) % 1) - 0.5;
        const pos = camera.toScreen(gx + 0.5 + dx * f * 0.72, gy + 0.5 + dy * f * 0.72);
        this.drawItemCube(pos.x, pos.y - 2 * z, Math.min(3.4, 2.2 + n * 0.6) * z, ITEM_COLOR[item]);
        k++;
        if (k > 2) break;
      }
    }
  }

  private drawItemCube(cx: number, cy: number, r: number, color: string): void {
    const { ctx } = this;
    const hex = colorToHex(color);
    // top
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy - r * 0.5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - r, cy - r * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // left/right faces
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + r * 0.7);
    ctx.lineTo(cx - r, cy + r * 0.2);
    ctx.closePath();
    ctx.fillStyle = shadeHex(hex, 0.55);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + r, cy - r * 0.5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + r * 0.7);
    ctx.lineTo(cx + r, cy + r * 0.2);
    ctx.closePath();
    ctx.fillStyle = shadeHex(hex, 0.75);
    ctx.fill();
  }

  private drawBeltArrow(b: BeltTile, gx: number, gy: number): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const [dx, dy] = DIRS[b.dir];
    const f = ((this.simT * 0.9) % 1) * 0.5 - 0.25;
    const tip = camera.toScreen(gx + 0.5 + dx * (f + 0.13), gy + 0.5 + dy * (f + 0.13));
    const left = camera.toScreen(gx + 0.5 + dx * f - dy * 0.1, gy + 0.5 + dy * f - dx * 0.1);
    const right = camera.toScreen(gx + 0.5 + dx * f + dy * 0.1, gy + 0.5 + dy * f + dx * 0.1);
    ctx.strokeStyle = 'rgba(150,190,240,0.6)';
    ctx.lineWidth = 1.5 * z;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  private drawMachines(world: World, ui: UIView): void {
    const sorted = [...world.state.machines].sort((a, b) => {
      const ka = a.gx + a.gy + (MACHINE_DEFS[a.type].size - 1) * 2;
      const kb = b.gx + b.gy + (MACHINE_DEFS[b.type].size - 1) * 2;
      return ka - kb;
    });
    for (const m of sorted) this.drawMachine(world, m, ui);
  }

  private bodyColor(def: MachineDef, m: Machine, ui: UIView): string {
    if (ui.heatOverlay) return tempColor(m.temp);
    const hi = heatIntensity(m.temp);
    if (hi > 0.03) return mixHex(def.color, [235, 120, 50], hi * 0.45);
    return def.color;
  }

  private drawMachine(world: World, m: Machine, ui: UIView): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const def = MACHINE_DEFS[m.type];
    const s = def.size;
    const c = camera.toScreen(m.gx + s / 2, m.gy + s / 2);
    const cull = (s * 44 + def.height + 50) * z;
    if (!this.onScreen(c.x, c.y, cull)) return;
    const h = def.height * z;
    const color = this.bodyColor(def, m, ui);
    this.shadow(c.x, c.y, s * TILE_W * 0.44);
    this.drawBody(world, m, def, c, s, color, ui);
    // heat rim glow
    if (!ui.heatOverlay) {
      const hi = heatIntensity(m.temp);
      if (hi > 0.04) {
        ctx.strokeStyle = tempColor(m.temp);
        ctx.globalAlpha = 0.3 + hi * 0.45;
        ctx.lineWidth = 2 * z;
        this.path(this.diamond(m.gx, m.gy, s).map(([x, y]) =>
          [(x - c.x) * 0.9 + c.x, (y - c.y) * 0.9 + c.y] as [number, number]));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // glyph nameplate
    if (z > 0.55) {
      ctx.font = `700 ${Math.round((s > 1 ? 12 : 10) * z)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const gy2 = c.y - h - 5 * z;
      ctx.fillStyle = 'rgba(8,10,14,0.65)';
      ctx.fillText(def.glyph, c.x + 1, gy2 + 1);
      ctx.fillStyle = m.active ? '#eef4ff' : '#96a0b4';
      ctx.fillText(def.glyph, c.x, gy2);
    }
    // status badge
    const badge = this.statusBadge(m);
    if (badge && Math.sin(this.animT * 5) > -0.35) {
      const bx = c.x;
      const by = c.y - h - 17 * z;
      ctx.beginPath();
      ctx.arc(bx, by, 8 * z, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,12,16,0.85)';
      ctx.fill();
      ctx.strokeStyle = badge[1];
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `700 ${Math.round(10 * z)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = badge[1];
      ctx.fillText(badge[0], bx, by + 0.5);
    }
    // selection
    if (ui.selectedId === m.id) {
      this.path(this.diamond(m.gx, m.gy, s));
      ctx.strokeStyle = '#9ecbff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -this.animT * 20;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** machine-specific bodies + animated accents */
  private drawBody(world: World, m: Machine, def: MachineDef, c: { x: number; y: number }, s: number, color: string, ui: UIView): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const groundY = c.y + 4 * z; // cylinder bases sit slightly below footprint center
    const active = m.active;
    switch (m.type) {
      case 'vent': {
        // rocky mound with a glowing throat
        const top = this.prism(m.gx, m.gy, s, 8, ui.heatOverlay ? color : '#6a4a2c', 0.92);
        const tc = { x: (top[0][0] + top[2][0]) / 2, y: (top[0][1] + top[2][1]) / 2 };
        const pulse = 0.6 + 0.3 * Math.sin(this.animT * 2.5);
        ctx.beginPath();
        ctx.ellipse(tc.x, tc.y, 7 * z, 3.5 * z, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,${Math.round(120 + 60 * pulse)},50,${0.85})`;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(tc.x, tc.y, 3.4 * z, 1.7 * z, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe9b0';
        ctx.fill();
        if (active && world.state.speed > 0 && Math.random() < 0.06) {
          this.spawn({ gx: m.gx + 0.5, gy: m.gy + 0.5, z: 8, vz: 24, vx: 0, vy: 0, maxLife: 1.1, r: 2, grow: 2, color: [255, 170, 90], alpha: 0.55 });
        }
        break;
      }
      case 'boiler': {
        this.cylinder(c.x, groundY, 13, def.height, color);
        // rivet band + chimney
        ctx.strokeStyle = 'rgba(10,14,20,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(c.x, groundY - def.height * 0.55 * z, 13 * z, 6.5 * z, 0, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
        this.cylinder(c.x + 8 * z, groundY - def.height * z + 2 * z, 2.6, 8, '#5a626f');
        if (active && world.state.speed > 0 && Math.random() < 0.1) {
          this.spawn({ gx: m.gx + 0.62, gy: m.gy + 0.35, z: def.height + 8, vz: 18, vx: 0.02, vy: -0.02, maxLife: 1.4, r: 1.8, grow: 2.4, color: [225, 232, 245], alpha: 0.4 });
        }
        break;
      }
      case 'condenser': {
        this.cylinder(c.x, groundY, 13, def.height, color);
        ctx.strokeStyle = 'rgba(110,180,255,0.65)';
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.ellipse(c.x, groundY - def.height * 0.35 * z, 13 * z, 6.5 * z, 0, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();
        if (active && world.state.speed > 0 && Math.random() < 0.05) {
          this.spawn({ gx: m.gx + 0.5, gy: m.gy + 0.5, z: def.height + 2, vz: 14, vx: 0, vy: 0, maxLife: 1.2, r: 1.6, grow: 1.8, color: [200, 220, 240], alpha: 0.35 });
        }
        break;
      }
      case 'pump': case 'feedpump': {
        this.cylinder(c.x, groundY, 10, def.height - 3, color);
        const bob = active ? Math.sin(this.simT * 7) * 1.6 * z : 0;
        this.cylinder(c.x, groundY - (def.height - 3) * z + 1 * z + bob, 5, 4, '#7d94ad');
        break;
      }
      case 'coolingTower': {
        // waisted hyperboloid silhouette
        const R = 26 * z; const h = def.height * z;
        const hex = colorToHex(color);
        const grad = ctx.createLinearGradient(c.x - R, 0, c.x + R, 0);
        grad.addColorStop(0, shadeHex(hex, 0.5));
        grad.addColorStop(0.45, shadeHex(hex, 0.9));
        grad.addColorStop(1, shadeHex(hex, 0.6));
        ctx.beginPath();
        ctx.moveTo(c.x - R, groundY);
        ctx.bezierCurveTo(c.x - R * 0.55, groundY - h * 0.55, c.x - R * 0.62, groundY - h * 0.75, c.x - R * 0.72, groundY - h);
        ctx.lineTo(c.x + R * 0.72, groundY - h);
        ctx.bezierCurveTo(c.x + R * 0.62, groundY - h * 0.75, c.x + R * 0.55, groundY - h * 0.55, c.x + R, groundY);
        ctx.ellipse(c.x, groundY, R, R * 0.5, 0, 0, Math.PI, false);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(c.x, groundY - h, R * 0.72, R * 0.36, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#10141c';
        ctx.fill();
        ctx.strokeStyle = shadeHex(hex, 1.1);
        ctx.lineWidth = 1.5 * z;
        ctx.stroke();
        if (m.rejected > 2 && world.state.speed > 0 && Math.random() < Math.min(0.5, m.rejected / 60)) {
          this.spawn({ gx: m.gx + 1, gy: m.gy + 1, z: def.height + 2, vz: 22, vx: 0.03, vy: -0.03, maxLife: 2.4, r: 5, grow: 7, color: [225, 232, 244], alpha: 0.34 });
        }
        break;
      }
      case 'radiator': {
        this.prism(m.gx, m.gy, s, 4, shadeHex(colorToHex(color), 0.8), 0.9);
        // fin stack
        for (let i = 0; i < 4; i++) {
          const off = (i - 1.5) * 7 * z;
          const fx = c.x + off;
          ctx.fillStyle = i % 2 ? color : shadeHex(colorToHex(color), 0.82);
          ctx.beginPath();
          ctx.moveTo(fx - 2 * z, c.y + 2 * z - 4 * z);
          ctx.lineTo(fx + 2 * z, c.y - 2 * z - 4 * z);
          ctx.lineTo(fx + 2 * z, c.y - 2 * z - (4 + def.height) * z);
          ctx.lineTo(fx - 2 * z, c.y + 2 * z - (4 + def.height) * z);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(8,12,18,0.5)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        break;
      }
      case 'piston': {
        this.prism(m.gx, m.gy, s, 10, color);
        const stroke = active ? (0.5 + 0.5 * Math.sin(this.simT * 9)) : 0.2;
        this.cylinder(c.x - 4 * z, c.y - 10 * z + 2 * z, 4.5, 6 + stroke * 5, '#8d97a8');
        this.cylinder(c.x + 6 * z, c.y - 10 * z + 2 * z, 3, 5, shadeHex(colorToHex(color), 1.15));
        break;
      }
      case 'turbine': {
        this.prism(m.gx, m.gy, s, 6, shadeHex(colorToHex(color), 0.75), 0.92);
        this.cylinder(c.x, c.y - 6 * z + 3 * z, 12, def.height - 8, color);
        // spinning highlight on the top ellipse
        const topY = c.y - 6 * z + 3 * z - (def.height - 8) * z;
        const ang = this.simT * (active ? 7 : 0.4);
        ctx.strokeStyle = 'rgba(240,246,255,0.75)';
        ctx.lineWidth = 1.6 * z;
        ctx.beginPath();
        ctx.ellipse(c.x, topY, 8.5 * z, 4.2 * z, 0, ang, ang + 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(c.x, topY, 8.5 * z, 4.2 * z, 0, ang + Math.PI, ang + Math.PI + 0.9);
        ctx.stroke();
        break;
      }
      case 'gasTurbine': {
        this.prism(m.gx, m.gy, s, 10, shadeHex(colorToHex(color), 0.8));
        this.cylinder(c.x - 8 * z, c.y - 10 * z + 4 * z, 12, def.height - 12, color);
        // exhaust glow ring on the east side
        const ex = c.x + 22 * z; const ey = c.y - 14 * z;
        const flick = active ? 0.55 + 0.3 * Math.sin(this.simT * 13 + 1) : 0.12;
        ctx.beginPath();
        ctx.ellipse(ex, ey, 6 * z, 4 * z, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,140,60,${flick})`;
        ctx.fill();
        if (active && world.state.speed > 0 && Math.random() < 0.16) {
          this.spawn({ gx: m.gx + 1.7, gy: m.gy + 0.6, z: 16, vz: 12, vx: 0.06, vy: -0.01, maxLife: 1.6, r: 2.6, grow: 3.4, color: [110, 116, 128], alpha: 0.4 });
        }
        break;
      }
      case 'furnace': {
        this.prism(m.gx, m.gy, s, def.height, color);
        // fire aperture on the SE face
        const flick = active ? 0.6 + 0.35 * Math.sin(this.simT * 11 + m.id) : 0.1;
        ctx.beginPath();
        ctx.moveTo(c.x + 4 * z, c.y + 5 * z);
        ctx.lineTo(c.x + 12 * z, c.y + 1 * z);
        ctx.lineTo(c.x + 12 * z, c.y - 6 * z);
        ctx.lineTo(c.x + 4 * z, c.y - 2 * z);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,${Math.round(120 + 80 * flick)},40,${0.35 + flick * 0.6})`;
        ctx.fill();
        if (active && world.state.speed > 0 && Math.random() < 0.12) {
          this.spawn({ gx: m.gx + 0.5, gy: m.gy + 0.5, z: def.height + 4, vz: 15, vx: 0.02, vy: -0.02, maxLife: 1.8, r: 2.2, grow: 2.8, color: [95, 100, 110], alpha: 0.45 });
        }
        break;
      }
      case 'smelter': {
        this.prism(m.gx, m.gy, s, def.height, color);
        const glow = active ? 0.7 + 0.2 * Math.sin(this.simT * 6) : 0.12;
        const topC = { x: c.x, y: c.y - def.height * z };
        ctx.beginPath();
        ctx.ellipse(topC.x, topC.y, 8 * z, 4 * z, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,150,60,${glow})`;
        ctx.fill();
        break;
      }
      case 'miner': {
        this.prism(m.gx, m.gy, s, 7, color, 0.9);
        // A-frame derrick + bobbing drill
        const topY = c.y - 26 * z;
        ctx.strokeStyle = '#7b8496';
        ctx.lineWidth = 1.6 * z;
        ctx.beginPath();
        ctx.moveTo(c.x - 9 * z, c.y - 4 * z);
        ctx.lineTo(c.x, topY);
        ctx.lineTo(c.x + 9 * z, c.y - 4 * z);
        ctx.stroke();
        const drill = active ? (Math.sin(this.simT * 10) * 0.5 + 0.5) * 8 * z : 4 * z;
        ctx.strokeStyle = '#aab4c6';
        ctx.lineWidth = 2.2 * z;
        ctx.beginPath();
        ctx.moveTo(c.x, topY);
        ctx.lineTo(c.x, c.y - 12 * z + drill);
        ctx.stroke();
        break;
      }
      case 'lab': {
        this.prism(m.gx, m.gy, s, def.height - 8, color);
        const topY = c.y - (def.height - 8) * z;
        // glass dome
        ctx.beginPath();
        ctx.ellipse(c.x, topY, 15 * z, 11 * z, 0, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(140,200,255,0.28)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,210,255,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (active) {
          const bl = 0.5 + 0.4 * Math.sin(this.animT * 3);
          ctx.fillStyle = `rgba(120,220,170,${bl})`;
          ctx.beginPath();
          ctx.arc(c.x, topY - 4 * z, 2 * z, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'depot': {
        const top = this.prism(m.gx, m.gy, s, def.height, color);
        ctx.strokeStyle = 'rgba(12,16,22,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo((top[0][0] + top[3][0]) / 2, (top[0][1] + top[3][1]) / 2);
        ctx.lineTo((top[1][0] + top[2][0]) / 2, (top[1][1] + top[2][1]) / 2);
        ctx.moveTo((top[0][0] + top[1][0]) / 2, (top[0][1] + top[1][1]) / 2);
        ctx.lineTo((top[2][0] + top[3][0]) / 2, (top[2][1] + top[3][1]) / 2);
        ctx.stroke();
        break;
      }
      case 'superheater': case 'reheater': {
        const top = this.prism(m.gx, m.gy, s, def.height, color);
        // glowing coil across the top
        const t0 = top[3]; const t1 = top[1];
        const coilCol = m.temp > AMBIENT + 5 ? tempColor(m.temp) : '#8a94a6';
        ctx.strokeStyle = coilCol;
        ctx.lineWidth = 1.8 * z;
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const f = i / 12;
          const px = t0[0] + (t1[0] - t0[0]) * f;
          const py = t0[1] + (t1[1] - t0[1]) * f + Math.sin(f * Math.PI * 5) * 3.4 * z;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        break;
      }
      case 'economizer': case 'regenerator': {
        this.prism(m.gx, m.gy, s, def.height, color);
        ctx.strokeStyle = 'rgba(220,240,225,0.35)';
        ctx.lineWidth = 1.2 * z;
        for (let i = 1; i <= 3; i++) {
          const yy = c.y + 3 * z - (def.height * z * i) / 4;
          ctx.beginPath();
          ctx.moveTo(c.x - 11 * z, yy + 5 * z);
          ctx.lineTo(c.x + 11 * z, yy - 5 * z);
          ctx.stroke();
        }
        break;
      }
      case 'exchanger': {
        const top = this.prism(m.gx, m.gy, s, def.height, color);
        const tc = { x: (top[0][0] + top[2][0]) / 2, y: (top[0][1] + top[2][1]) / 2 };
        ctx.lineWidth = 2 * z;
        ctx.strokeStyle = 'rgba(255,150,80,0.8)';
        ctx.beginPath();
        ctx.ellipse(tc.x - 3.5 * z, tc.y, 5 * z, 2.6 * z, 0, 0.6, Math.PI * 2 - 0.6);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(110,180,255,0.8)';
        ctx.beginPath();
        ctx.ellipse(tc.x + 3.5 * z, tc.y, 5 * z, 2.6 * z, 0, Math.PI + 0.6, Math.PI - 0.6);
        ctx.stroke();
        break;
      }
      case 'heatPump': {
        const top = this.prism(m.gx, m.gy, s, def.height, color);
        const tc = { x: (top[0][0] + top[2][0]) / 2, y: (top[0][1] + top[2][1]) / 2 };
        ctx.beginPath();
        ctx.ellipse(tc.x, tc.y, 8.5 * z, 4.4 * z, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10,16,22,0.65)';
        ctx.fill();
        const ang = this.simT * (active ? 10 : 0.5);
        ctx.strokeStyle = '#9fd8d8';
        ctx.lineWidth = 1.6 * z;
        for (let i = 0; i < 3; i++) {
          const a = ang + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.moveTo(tc.x, tc.y);
          ctx.lineTo(tc.x + Math.cos(a) * 7.5 * z, tc.y + Math.sin(a) * 3.8 * z);
          ctx.stroke();
        }
        break;
      }
      case 'teg': {
        this.prism(m.gx, m.gy, s, 5, shadeHex(colorToHex(color), 0.8), 0.92);
        this.prism(m.gx, m.gy, s, def.height, color, 0.62);
        break;
      }
      case 'coupler': {
        this.prism(m.gx, m.gy, s, 8, color, 0.9);
        // big junction pipes crossing on top
        const yy = c.y - 8 * z - 3 * z;
        ctx.strokeStyle = '#8d95a5';
        ctx.lineWidth = 5 * z;
        ctx.lineCap = 'round';
        const a = this.camera.toScreen(m.gx + 0.1, m.gy + 0.5);
        const b = this.camera.toScreen(m.gx + 0.9, m.gy + 0.5);
        const d = this.camera.toScreen(m.gx + 0.5, m.gy + 0.1);
        const e = this.camera.toScreen(m.gx + 0.5, m.gy + 0.9);
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 11 * z); ctx.lineTo(b.x, b.y - 11 * z); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(d.x, d.y - 11 * z); ctx.lineTo(e.x, e.y - 11 * z); ctx.stroke();
        ctx.fillStyle = m.temp > AMBIENT + 5 ? tempColor(m.temp) : '#5d6880';
        ctx.beginPath();
        ctx.arc(c.x, yy, 3.4 * z, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'controller': {
        this.prism(m.gx, m.gy, s, def.height, color, 0.7);
        this.prism(m.gx, m.gy, s, 8, shadeHex(colorToHex(color), 0.75), 0.95);
        const topY = c.y - (def.height + 10) * z;
        const pulse = 0.5 + 0.4 * Math.sin(this.animT * 2.4);
        ctx.strokeStyle = `rgba(255,210,90,${pulse})`;
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.ellipse(c.x, topY, 16 * z, 8 * z, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (world.state.winTimer > 0 || world.state.won) {
          ctx.fillStyle = `rgba(255,220,120,${0.12 + pulse * 0.12})`;
          ctx.beginPath();
          ctx.moveTo(c.x - 12 * z, topY);
          ctx.lineTo(c.x + 12 * z, topY);
          ctx.lineTo(c.x + 5 * z, topY - 70 * z);
          ctx.lineTo(c.x - 5 * z, topY - 70 * z);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      default: {
        this.prism(m.gx, m.gy, s, def.height, color);
        break;
      }
    }
  }

  private statusBadge(m: Machine): [string, string] | null {
    switch (m.status) {
      case 'overheat': return ['!', '#ff5a48'];
      case 'noPower': return ['⚡', '#ffd24a'];
      case 'noWater': return ['≈', '#5ab4ff'];
      case 'noSink': return ['♨', '#ff9a3c'];
      case 'noFuel': return ['▲', '#e0a060'];
      case 'noHeat': return ['❄', '#8fb6d8'];
      case 'noSteam': return ['○', '#9aa4b4'];
      default: return null;
    }
  }

  private updateAndDrawParticles(world: World, dtReal: number): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    const dt = dtReal * (world.state.speed > 0 ? 1 : 0.15);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.z += p.vz * dt;
      p.gx += p.vx * dt;
      p.gy += p.vy * dt;
      p.r += p.grow * dt;
      const sp = camera.toScreen(p.gx, p.gy);
      const sy = sp.y - p.z * z;
      if (!this.onScreen(sp.x, sy, 40)) continue;
      const a = p.alpha * (p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(sp.x, sy, Math.max(0.4, p.r * z), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${a.toFixed(3)})`;
      ctx.fill();
    }
  }

  // ── machine portraits: mini renders of the real bodies, for UI icons ──────
  private portraitCache = new Map<string, string>();

  private fakeMachine(type: MachineTypeId): Machine {
    return {
      id: 1, type, gx: 2, gy: 2, rot: 0, temp: AMBIENT,
      fluidOut: null, waterOut: null, inItems: {}, outItems: {},
      recipe: null, progress: 0, status: 'ok',
      work: 1, qIn: 1, qWaste: 0, tHot: AMBIENT, tCold: AMBIENT,
      eta: 0, carnot: 0, rejected: 0, powerUse: 0, throttle: 1,
      active: true, overheat: false, overheatT: 0,
    };
  }

  /** render one machine's body onto a small canvas; returns a cached dataURL */
  machinePortrait(type: MachineTypeId, px = 76): string {
    const key = `${type}@${px}`;
    const hit = this.portraitCache.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const def = MACHINE_DEFS[type];
    const s = def.size;
    const cam = new Camera();
    cam.zoom = s === 1 ? px / 80 : px / 132;
    cam.viewW = px;
    cam.viewH = px;
    const groundY = px * (s === 1 ? 0.74 : 0.8);
    cam.x = px / 2; // machine center is on the gx==gy diagonal
    cam.y = groundY - (4 + s) * TILE_H * cam.zoom;
    const realCtx = this.ctx;
    const realCam = this.camera;
    this.ctx = ctx;
    this.camera = cam;
    try {
      const m = this.fakeMachine(type);
      const fakeWorld = { state: { speed: 0, winTimer: 0, won: false } } as unknown as World;
      const fakeUI: UIView = { hover: null, tool: null, selectedId: null, heatOverlay: false, beltDir: 0 };
      const c = cam.toScreen(2 + s / 2, 2 + s / 2);
      this.shadow(c.x, c.y, s * TILE_W * 0.44);
      this.drawBody(fakeWorld, m, def, c, s, def.color, fakeUI);
    } finally {
      this.ctx = realCtx;
      this.camera = realCam;
    }
    const url = canvas.toDataURL('image/png');
    this.portraitCache.set(key, url);
    return url;
  }

  /** icons for the non-machine tools (pipes, belt, bulldoze) */
  toolPortrait(kind: 'pipe' | 'insPipe' | 'belt' | 'bulldoze', px = 76): string {
    const key = `tool:${kind}@${px}`;
    const hit = this.portraitCache.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const c = { x: px / 2, y: px * 0.55 };
    const w = px * 0.42;
    const h = px * 0.21;
    const pts: [number, number][] = [[c.x, c.y - h], [c.x + w, c.y], [c.x, c.y + h], [c.x - w, c.y]];
    const tile = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = '#20252f';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,110,150,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    if (kind === 'pipe' || kind === 'insPipe') {
      tile();
      const ins = kind === 'insPipe';
      // run through the tile along the iso axis (SW edge mid → NE edge mid)
      const a = { x: (pts[2][0] + pts[3][0]) / 2, y: (pts[2][1] + pts[3][1]) / 2 - px * 0.05 };
      const b = { x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2 - px * 0.05 };
      ctx.strokeStyle = ins ? '#9aa4b6' : '#4e5666';
      ctx.lineWidth = px * (ins ? 0.17 : 0.13);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = tempColor(210);
      ctx.lineWidth = px * (ins ? 0.075 : 0.058);
      ctx.setLineDash([px * 0.09, px * 0.1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // joint cap
      ctx.fillStyle = ins ? '#9aa4b6' : '#4e5666';
      ctx.beginPath();
      ctx.arc(c.x, c.y - px * 0.05, px * (ins ? 0.09 : 0.07), 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'belt') {
      // plate
      const inner = pts.map(([x, y]) => [(x - c.x) * 0.85 + c.x, (y - c.y) * 0.85 + c.y] as [number, number]);
      ctx.beginPath();
      ctx.moveTo(inner[0][0], inner[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(inner[i][0], inner[i][1]);
      ctx.closePath();
      ctx.fillStyle = '#2c333f';
      ctx.fill();
      ctx.strokeStyle = '#454e5e';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // rollers perpendicular to +x travel
      ctx.strokeStyle = 'rgba(70,82,104,0.9)';
      ctx.lineWidth = px * 0.02;
      for (const f of [-0.2, 0.02, 0.24]) {
        ctx.beginPath();
        ctx.moveTo(c.x + f * w - w * 0.3, c.y + f * h + h * 0.62);
        ctx.lineTo(c.x + f * w + w * 0.3, c.y + f * h - h * 0.62);
        ctx.stroke();
      }
      // chevron along travel
      ctx.strokeStyle = 'rgba(150,190,240,0.95)';
      ctx.lineWidth = px * 0.045;
      ctx.beginPath();
      ctx.moveTo(c.x - w * 0.05, c.y - h * 0.55);
      ctx.lineTo(c.x + w * 0.32, c.y + h * 0.16);
      ctx.lineTo(c.x - w * 0.05 - w * 0.28 * 0, c.y + h * 0.8);
      ctx.stroke();
      // an item riding it
      const realCtx = this.ctx;
      this.ctx = ctx;
      try {
        this.drawItemCube(c.x - w * 0.38, c.y - h * 0.35, px * 0.085, '#c3c9d4');
      } finally {
        this.ctx = realCtx;
      }
    } else {
      tile();
      const r = px * 0.17;
      ctx.strokeStyle = '#e05548';
      ctx.lineWidth = px * 0.085;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - r - px * 0.06);
      ctx.lineTo(c.x + r, c.y + r - px * 0.06);
      ctx.moveTo(c.x + r, c.y - r - px * 0.06);
      ctx.lineTo(c.x - r, c.y + r - px * 0.06);
      ctx.stroke();
    }
    const url = canvas.toDataURL('image/png');
    this.portraitCache.set(key, url);
    return url;
  }

  private drawGhost(world: World, ui: UIView): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    if (!ui.hover || !ui.tool) return;
    const { gx, gy } = ui.hover;
    if (!inBounds(gx, gy)) return;
    if (ui.tool.kind === 'machine') {
      const def = MACHINE_DEFS[ui.tool.type];
      const ok = world.canPlaceMachine(ui.tool.type, gx, gy).ok;
      // connection hints: pulse tiles this machine would couple to
      const pulse = 0.4 + 0.25 * Math.sin(this.animT * 6);
      for (let dx0 = 0; dx0 < def.size; dx0++) {
        for (let dy0 = 0; dy0 < def.size; dy0++) {
          for (const [dx, dy] of DIRS) {
            const nx = gx + dx0 + dx; const ny = gy + dy0 + dy;
            if (!inBounds(nx, ny)) continue;
            if (nx >= gx && nx < gx + def.size && ny >= gy && ny < gy + def.size) continue;
            const hasPipe = !!world.state.pipes[idx(nx, ny)];
            const neighborM = world.machineAt(nx, ny);
            if (hasPipe || neighborM) {
              this.path(this.diamond(nx, ny));
              ctx.strokeStyle = `rgba(120,230,170,${pulse})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }
        }
      }
      ctx.globalAlpha = 0.55;
      const s = def.size;
      const c = this.camera.toScreen(gx + s / 2, gy + s / 2);
      const h = def.height * z;
      const base = this.diamond(gx, gy, s).map(([x, y]) =>
        [(x - c.x) * 0.86 + c.x, (y - c.y) * 0.86 + c.y] as [number, number]);
      const top = base.map(([x, y]) => [x, y - h] as [number, number]);
      this.path([base[3], base[2], top[2], top[3]]);
      ctx.fillStyle = ok ? '#3f8f5f' : '#a04040';
      ctx.fill();
      this.path([base[2], base[1], top[1], top[2]]);
      ctx.fillStyle = ok ? '#357a50' : '#8a3636';
      ctx.fill();
      this.path([top[0], top[1], top[2], top[3]]);
      ctx.fillStyle = ok ? '#4fbf7f' : '#d05050';
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (ui.tool.kind === 'pipe') {
      const ok = world.canPlacePipe(gx, gy, ui.tool.insulated);
      this.path(this.diamond(gx, gy));
      ctx.fillStyle = ok ? 'rgba(120,200,150,0.35)' : 'rgba(220,90,80,0.35)';
      ctx.fill();
    } else if (ui.tool.kind === 'belt') {
      const ok = world.canPlaceBelt(gx, gy);
      this.path(this.diamond(gx, gy));
      ctx.fillStyle = ok ? 'rgba(120,170,240,0.35)' : 'rgba(220,90,80,0.35)';
      ctx.fill();
      const [dx, dy] = DIRS[ui.beltDir];
      const a = this.camera.toScreen(gx + 0.5 - dx * 0.25, gy + 0.5 - dy * 0.25);
      const b = this.camera.toScreen(gx + 0.5 + dx * 0.3, gy + 0.5 + dy * 0.3);
      ctx.strokeStyle = '#cfe4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (ui.tool.kind === 'bulldoze') {
      this.path(this.diamond(gx, gy));
      ctx.fillStyle = 'rgba(230,80,70,0.4)';
      ctx.fill();
    }
  }
}

function colorToHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return '#888888';
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
