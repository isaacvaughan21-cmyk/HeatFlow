// ── Isometric transforms + camera ───────────────────────────────────────────
import { MAP_H, MAP_W, clamp } from '../sim/types';

export const TILE_W = 36; // half-width of a tile diamond at zoom 1
export const TILE_H = 18; // half-height

export class Camera {
  x = 0; // screen offset of grid point (0,0)
  y = 0;
  zoom = 1;
  viewW = 800;
  viewH = 600;

  centerOn(gx: number, gy: number): void {
    const w = TILE_W * this.zoom;
    const h = TILE_H * this.zoom;
    this.x = this.viewW / 2 - (gx - gy) * w;
    this.y = this.viewH / 2 - (gx + gy) * h;
    this.clampPan();
  }

  /** grid POINT (corner) to screen. Tile (gx,gy)'s corners are points
   *  (gx,gy),(gx+1,gy),(gx+1,gy+1),(gx,gy+1). */
  toScreen(gx: number, gy: number): { x: number; y: number } {
    const w = TILE_W * this.zoom;
    const h = TILE_H * this.zoom;
    return { x: this.x + (gx - gy) * w, y: this.y + (gx + gy) * h };
  }

  /** screen to fractional grid coords (floor → tile) */
  toGrid(sx: number, sy: number): { gx: number; gy: number } {
    const w = TILE_W * this.zoom;
    const h = TILE_H * this.zoom;
    const a = (sx - this.x) / w;
    const b = (sy - this.y) / h;
    return { gx: (a + b) / 2, gy: (b - a) / 2 };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toGrid(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.45, 2.6);
    const after = this.toScreen(before.gx, before.gy);
    this.x += sx - after.x;
    this.y += sy - after.y;
    this.clampPan();
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampPan();
  }

  clampPan(): void {
    // keep the map diamond overlapping the viewport: the map's screen-x extent
    // is [x - MAP_H*w, x + MAP_W*w], so keep its near edge within ~4 tiles
    const w = TILE_W * this.zoom;
    const h = TILE_H * this.zoom;
    const minX = this.viewW / 2 - MAP_W * w - 4 * w;
    const maxX = this.viewW / 2 + MAP_H * w + 4 * w;
    const minY = this.viewH / 2 - (MAP_W + MAP_H) * h - 4 * h;
    const maxY = this.viewH / 2 + 4 * h;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }
}
