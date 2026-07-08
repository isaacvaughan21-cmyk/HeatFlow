// ── The physics. Honor the laws; keep the math clean. ──────────────────────
import { AMBIENT, clamp } from './types';

export const K0 = 273.15;

export function toK(c: number): number {
  return c + K0;
}

/** Theoretical Carnot ceiling for a heat engine, 0..1. Zero if no gradient. */
export function carnotLimit(tHotC: number, tColdC: number): number {
  const th = toK(tHotC);
  const tc = toK(tColdC);
  if (th <= tc || th <= 0) return 0;
  return 1 - tc / th;
}

export interface EngineResult {
  work: number;   // kW
  waste: number;  // HU/s — MUST be rejected somewhere
  eta: number;    // actual efficiency achieved
  carnot: number; // ceiling for this gradient
}

/**
 * The central equation. Given heat drawn qIn (HU/s) at tHot, rejecting at tCold,
 * with a machine achieving `quality` fraction of Carnot:
 *   eta = quality * carnot, strictly clamped below 0.98 * carnot.
 * Energy is exactly conserved: work + waste === qIn.
 */
export function engineOutput(qIn: number, tHotC: number, tColdC: number, quality: number): EngineResult {
  const carnot = carnotLimit(tHotC, tColdC);
  if (carnot <= 0 || qIn <= 0) {
    return { work: 0, waste: Math.max(0, qIn), eta: 0, carnot: 0 };
  }
  const q = clamp(quality, 0, 1);
  const eta = clamp(carnot * q, 0, 0.98 * carnot);
  const work = qIn * eta;
  return { work, waste: qIn - work, eta, carnot };
}

/**
 * Cold sink integration for one tick.
 * Absorbs qAbsorbed (HU/s), rejects rejectCoeff*(T - ambient) to ambient (never
 * below ambient by rejection alone). Returns new temp + actual rejection rate.
 */
export function sinkStep(
  tSink: number, qAbsorbed: number, rejectCoeff: number, thermalMass: number, dt: number,
): { temp: number; rejected: number } {
  const rejected = tSink > AMBIENT ? rejectCoeff * (tSink - AMBIENT) : 0;
  let temp = tSink + ((qAbsorbed - rejected) * dt) / thermalMass;
  // Rejection alone can't cool below ambient (only heat pumps can do that).
  if (qAbsorbed <= 0 && temp < AMBIENT && tSink >= AMBIENT) temp = AMBIENT;
  return { temp, rejected };
}

/**
 * Pipe attenuation: fraction of flow (and of temp-above-ambient) retained per tile.
 * Losses go to ambient; caller books them as pipe loss.
 */
export const PIPE_RETENTION = 0.985;      // bare pipe: 1.5% per tile
export const PIPE_RETENTION_INS = 0.997;  // insulated: 0.3% per tile

/** Temperature after traveling with a given total retention factor. */
export function attenuateTemp(tempC: number, retention: number): number {
  return AMBIENT + (tempC - AMBIENT) * retention;
}

/**
 * Heat pump COP toward a rejection reservoir at ambient+15.
 * Below the reservoir temp the pump works against the gradient: COP shrinks as
 * the lift grows (Carnot-flavored bound), so approaching very low T_cold costs
 * ever more work — the 3rd-law flavor.
 */
export const HEATPUMP_REJECT_T = AMBIENT + 15;
export function heatPumpCOP(tSinkC: number): number {
  if (tSinkC >= HEATPUMP_REJECT_T) return 6;
  const lift = toK(HEATPUMP_REJECT_T) - toK(tSinkC);
  return clamp(0.45 * (toK(tSinkC) / lift), 0.6, 6);
}

/** Water carries sensible preheat energy: HU per water-unit per °C above ambient.
 *  Calibrated so 200 °C feedwater saves ~27% of the 30 HU/water-unit steam cost —
 *  matching real sensible-vs-latent heat proportions. */
export const WATER_HEAT_K = 0.045;
/** Water needed per HU of steam raised. */
export const WATER_PER_HU = 1 / 30;

export function waterPreheatEnergy(waterUnits: number, waterTempC: number): number {
  return Math.max(0, waterUnits * WATER_HEAT_K * (waterTempC - AMBIENT));
}

/** Engines exhaust waste hotter than the sink (real turbine exhaust carries
 *  usable heat) — this is what makes economizers honest. */
export function wasteTemp(tHotC: number, tColdC: number): number {
  return tColdC + 0.25 * Math.max(0, tHotC - tColdC);
}
