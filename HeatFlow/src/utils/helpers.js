import { ZONES } from '../data/zones';

export function tempColor(t) {
  if (t < -20) return 'rgba(30, 60, 180, 0.8)';
  if (t < 0) return 'rgba(80, 160, 220, 0.8)';
  if (t < 30) return 'rgba(60, 180, 80, 0.8)';
  if (t < 100) return 'rgba(220, 160, 40, 0.8)';
  if (t < 200) return 'rgba(220, 80, 30, 0.8)';
  return 'rgba(255, 40, 20, 0.8)';
}

export function tempLabel(t) {
  if (t < -20) return 'Frozen';
  if (t < 0) return 'Cold';
  if (t < 30) return 'Mild';
  if (t < 100) return 'Warm';
  if (t < 200) return 'Hot';
  return 'Extreme';
}

export function initGrid(zoneId) {
  const zone = ZONES[zoneId];
  const rows = 14;
  const cols = 20;
  const grid = [];

  const nodeTypes = {
    frozen: 'ice',
    volcanic: 'magma',
    temperate: 'mineral',
  };
  const nodeType = nodeTypes[zoneId] || 'mineral';

  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const temp = zone.baseTemp + (Math.random() * 10 - 5) + y * 2;
      row.push({
        building: null,
        temp: Math.round(temp * 10) / 10,
        resourceNode: Math.random() < 0.12 ? nodeType : null,
      });
    }
    grid.push(row);
  }
  return grid;
}
