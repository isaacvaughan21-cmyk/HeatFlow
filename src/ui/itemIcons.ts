// ── Procedural item icons: drawn once to offscreen canvases, cached as
//    data-URLs, used everywhere items appear in the UI. No asset files. ─────
import { ItemId, ITEM_NAMES } from '../sim/types';

const S = 40; // draw size; CSS scales down
const cache = new Map<ItemId, string>();

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string, stroke?: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/** cluster of 3 ore lumps */
function rocks(ctx: CanvasRenderingContext2D, color: string, shine = false): void {
  const lump = (cx: number, cy: number, r: number, f: number) => {
    poly(ctx, [
      [cx - r, cy + r * 0.35], [cx - r * 0.45, cy - r * 0.8], [cx + r * 0.5, cy - r * 0.9],
      [cx + r, cy + r * 0.2], [cx + r * 0.4, cy + r * 0.8], [cx - r * 0.5, cy + r * 0.85],
    ], shade(color, f), 'rgba(0,0,0,0.4)');
    // facet
    poly(ctx, [
      [cx - r * 0.45, cy - r * 0.8], [cx + r * 0.5, cy - r * 0.9], [cx + r * 0.15, cy - r * 0.1], [cx - r * 0.3, cy - r * 0.05],
    ], shade(color, f * 1.25));
  };
  lump(14, 24, 9, 0.8);
  lump(27, 25, 8, 0.95);
  lump(21, 15, 8.5, 1.05);
  if (shine) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(18, 11, 2.4, 2.4);
    ctx.fillRect(25, 21, 2, 2);
  }
}

/** 3D ingot bar */
function ingot(ctx: CanvasRenderingContext2D, color: string): void {
  poly(ctx, [[6, 22], [16, 15], [34, 15], [26, 22]], shade(color, 1.15), 'rgba(0,0,0,0.35)'); // top
  poly(ctx, [[6, 22], [26, 22], [26, 29], [6, 29]], color, 'rgba(0,0,0,0.35)');               // front
  poly(ctx, [[26, 22], [34, 15], [34, 23], [26, 29]], shade(color, 0.65), 'rgba(0,0,0,0.35)'); // side
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(9, 23.5, 12, 1.6);
}

function drawIcon(item: ItemId, ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, S, S);
  ctx.lineJoin = 'round';
  switch (item) {
    case 'ironOre': rocks(ctx, '#8a8f9a'); break;
    case 'copperOre': rocks(ctx, '#c4763d'); break;
    case 'coal': rocks(ctx, '#3c4049', true); break;
    case 'quartz': {
      // two crystal shards
      poly(ctx, [[14, 32], [10, 20], [17, 8], [21, 21]], '#c9d6ea', 'rgba(40,60,90,0.5)');
      poly(ctx, [[17, 8], [21, 21], [17.5, 31]], '#eef4fc');
      poly(ctx, [[25, 33], [22, 24], [27, 14], [31, 25]], '#b6c6de', 'rgba(40,60,90,0.5)');
      poly(ctx, [[27, 14], [31, 25], [28, 32]], '#e2ecf8');
      break;
    }
    case 'ironIngot': ingot(ctx, '#a6adba'); break;
    case 'copperIngot': ingot(ctx, '#d0854a'); break;
    case 'ironPlate': {
      poly(ctx, [[7, 15], [33, 15], [33, 30], [7, 30]], '#b9c0cc', 'rgba(0,0,0,0.35)');
      poly(ctx, [[7, 15], [33, 15], [33, 18], [7, 18]], '#d3d9e4');
      ctx.fillStyle = 'rgba(40,48,60,0.7)';
      for (const [x, y] of [[11, 22], [29, 22], [11, 27], [29, 27]]) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'copperWire': {
      // loop of wire
      ctx.strokeStyle = '#df9c58';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.ellipse(20, 22, 11, 8, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#b7773a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(20, 22, 11, 8, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      // loose end
      ctx.strokeStyle = '#df9c58';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(29, 15);
      ctx.quadraticCurveTo(34, 11, 35, 7);
      ctx.stroke();
      break;
    }
    case 'copperCoil': {
      // wire-wound core
      poly(ctx, [[12, 10], [28, 10], [28, 31], [12, 31]], '#8a94a4', 'rgba(0,0,0,0.35)');
      ctx.strokeStyle = '#dd9250';
      ctx.lineWidth = 2.6;
      for (let y = 13; y <= 28; y += 3.6) {
        ctx.beginPath();
        ctx.moveTo(11, y + 1.5);
        ctx.lineTo(29, y - 1.5);
        ctx.stroke();
      }
      poly(ctx, [[12, 8], [28, 8], [28, 11], [12, 11]], '#aab3c2');
      poly(ctx, [[12, 30], [28, 30], [28, 33], [12, 33]], '#767f8e');
      break;
    }
    case 'machineFrame': {
      ctx.strokeStyle = '#9aa4b8';
      ctx.lineWidth = 3.6;
      ctx.strokeRect(9, 9, 22, 22);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(9, 9); ctx.lineTo(31, 31);
      ctx.moveTo(31, 9); ctx.lineTo(9, 31);
      ctx.stroke();
      ctx.fillStyle = '#c6cedd';
      for (const [x, y] of [[9, 9], [31, 9], [9, 31], [31, 31]]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sensor': {
      poly(ctx, [[8, 12], [32, 12], [32, 30], [8, 30]], '#2c333f', 'rgba(0,0,0,0.4)');
      ctx.fillStyle = '#134d44';
      ctx.beginPath();
      ctx.arc(20, 21, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fd4c0';
      ctx.beginPath();
      ctx.arc(20, 21, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eafff8';
      ctx.beginPath();
      ctx.arc(21.8, 19.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
      // legs
      ctx.strokeStyle = '#8a94a4';
      ctx.lineWidth = 1.6;
      for (const x of [12, 17, 23, 28]) {
        ctx.beginPath();
        ctx.moveTo(x, 30); ctx.lineTo(x, 34);
        ctx.stroke();
      }
      break;
    }
    case 'turbineBlade': {
      const cx = 20; const cy = 21;
      ctx.fillStyle = '#b9c4e0';
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 - 0.4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(4, -8, 2, -14);
        ctx.quadraticCurveTo(8, -10, 7, -3);
        ctx.quadraticCurveTo(5, 1, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#7d8aa8';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dfe6f4';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: break;
  }
}

export function itemIconURL(item: ItemId): string {
  const hit = cache.get(item);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawIcon(item, ctx);
  const url = canvas.toDataURL('image/png');
  cache.set(item, url);
  return url;
}

export function iconHtml(item: ItemId, size = 16): string {
  return `<img class="item-icon" width="${size}" height="${size}" src="${itemIconURL(item)}" alt="" title="${ITEM_NAMES[item]}">`;
}

/** icon + count chip, e.g. inventory or cost entries */
export function chipHtml(item: ItemId, text: string, size = 16, cls = ''): string {
  return `<span class="item-chip ${cls}" title="${ITEM_NAMES[item]}">${iconHtml(item, size)}<b>${text}</b></span>`;
}
