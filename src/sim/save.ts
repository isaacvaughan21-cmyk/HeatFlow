// ── Persistence: plain-JSON GameState in localStorage ───────────────────────
import { GameState, SAVE_VERSION } from './types';
import { World } from './world';

const KEY = 'heatflow-save';

export function saveGame(world: World): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(world.state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): World | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    if (!state || state.version !== SAVE_VERSION) {
      // don't destroy an old-version save — park it under a backup key
      if (state?.version !== undefined) {
        localStorage.setItem(`${KEY}-backup-v${state.version}`, raw);
      }
      return null;
    }
    return new World(state);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
