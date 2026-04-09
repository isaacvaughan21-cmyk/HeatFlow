import { create } from 'zustand';
import { BUILDINGS } from '../data/buildings';
import { RESEARCH } from '../data/research';
import { PRICES } from '../data/prices';
import { initGrid } from '../utils/helpers';

const useGameStore = create((set, get) => ({
  grid: initGrid('frozen'),
  zone: 'frozen',
  money: 200,
  resources: {
    ore: 0,
    ingot: 0,
    component: 0,
    machine: 0,
    crystal: 0,
    energy: 10,
    research: 0,
  },
  unlockedResearch: [],
  unlockedZones: ['frozen'],
  selectedBuilding: null,
  selectedCell: null,
  showHeatMap: false,
  isPaused: false,
  speed: 1,
  tick: 0,
  totalSold: 0,
  notification: null,

  placeBuilding: (x, y) => {
    const state = get();
    const buildingId = state.selectedBuilding;
    if (!buildingId) return;

    const building = BUILDINGS[buildingId];
    if (!building) return;

    const cell = state.grid[y]?.[x];
    if (!cell || cell.building) return;

    if (state.money < building.cost) {
      set({ notification: 'Not enough money!' });
      setTimeout(() => set({ notification: null }), 2000);
      return;
    }

    const newGrid = state.grid.map((row) => row.map((c) => ({ ...c })));
    newGrid[y][x] = { ...newGrid[y][x], building: buildingId };

    set({
      grid: newGrid,
      money: state.money - building.cost,
    });
  },

  removeBuilding: (x, y) => {
    const state = get();
    const cell = state.grid[y]?.[x];
    if (!cell || !cell.building) return;

    const building = BUILDINGS[cell.building];
    const refund = Math.floor(building.cost * 0.5);

    const newGrid = state.grid.map((row) => row.map((c) => ({ ...c })));
    newGrid[y][x] = { ...newGrid[y][x], building: null };

    set({
      grid: newGrid,
      money: state.money + refund,
    });
  },

  sellResource: (type) => {
    const state = get();
    const amount = state.resources[type] || 0;
    if (amount <= 0) return;

    const price = PRICES[type] || 0;
    const total = Math.floor(amount * price);

    set({
      resources: { ...state.resources, [type]: 0 },
      money: state.money + total,
      totalSold: state.totalSold + total,
    });

    set({ notification: `Sold ${Math.floor(amount)} ${type} for $${total}` });
    setTimeout(() => set({ notification: null }), 2000);
  },

  doResearch: (id) => {
    const state = get();
    const node = RESEARCH[id];
    if (!node) return;

    if (state.unlockedResearch.includes(id)) return;

    const prereqsMet = node.requires.every((r) =>
      state.unlockedResearch.includes(r)
    );
    if (!prereqsMet) {
      set({ notification: 'Prerequisites not met!' });
      setTimeout(() => set({ notification: null }), 2000);
      return;
    }

    let cost = node.cost;
    let newResources = { ...state.resources };
    let newMoney = state.money;

    if (newResources.research >= cost) {
      newResources.research -= cost;
    } else {
      const remaining = cost - newResources.research;
      newResources.research = 0;
      if (newMoney >= remaining) {
        newMoney -= remaining;
      } else {
        set({ notification: 'Not enough research points or money!' });
        setTimeout(() => set({ notification: null }), 2000);
        return;
      }
    }

    const newUnlocked = [...state.unlockedResearch, id];
    const newZones = [...state.unlockedZones];
    if (node.unlocksZone && !newZones.includes(node.unlocksZone)) {
      newZones.push(node.unlocksZone);
    }

    set({
      resources: newResources,
      money: newMoney,
      unlockedResearch: newUnlocked,
      unlockedZones: newZones,
      notification: `Researched: ${node.name}!`,
    });
    setTimeout(() => set({ notification: null }), 2000);
  },

  switchZone: (id) => {
    set({
      zone: id,
      grid: initGrid(id),
      selectedCell: null,
    });
  },

  toggleHeatMap: () => set((s) => ({ showHeatMap: !s.showHeatMap })),
  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  setSpeed: (n) => set({ speed: n }),
  setSelectedBuilding: (id) => set({ selectedBuilding: id }),
  setSelectedCell: (cell) => set({ selectedCell: cell }),

  setNotification: (msg) => {
    set({ notification: msg });
    if (msg) {
      setTimeout(() => set({ notification: null }), 2000);
    }
  },

  gameTick: () => {
    const state = get();
    if (state.isPaused) return;
    set({ tick: state.tick + 1 });
  },
}));

export default useGameStore;
