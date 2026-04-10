import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform } from 'react-native';
import useGameStore from '../store/gameStore';
import { BUILDINGS } from '../data/buildings';
import { tempColor } from '../utils/helpers';
import { C } from '../theme/colors';

const CELL_SIZE = 44;
const GAP = 1;

const RESOURCE_ICONS = {
  ice: '🧊',
  magma: '🌋',
  mineral: '💎',
};

let Haptics = null;
if (Platform.OS !== 'web') {
  Haptics = require('expo-haptics');
}

function isWorking(cell) {
  if (!cell.building) return false;
  const b = BUILDINGS[cell.building];
  if (!b) return false;
  if (b.needsHeat && cell.temp < b.needsHeat) return false;
  if (b.needsTemp) {
    if (cell.temp < b.needsTemp[0] || cell.temp > b.needsTemp[1]) return false;
  }
  // Energy check would require store access; for now assume energy OK if no needsEnergy
  return true;
}

function GridCell({ x, y, cell }) {
  const selectedBuilding = useGameStore((s) => s.selectedBuilding);
  const selectedCell = useGameStore((s) => s.selectedCell);
  const showHeatMap = useGameStore((s) => s.showHeatMap);
  const placeBuilding = useGameStore((s) => s.placeBuilding);
  const removeBuilding = useGameStore((s) => s.removeBuilding);
  const setSelectedCell = useGameStore((s) => s.setSelectedCell);
  const setNotification = useGameStore((s) => s.setNotification);

  const building = cell.building ? BUILDINGS[cell.building] : null;
  const working = isWorking(cell);
  const isSelected =
    selectedCell && selectedCell.x === x && selectedCell.y === y;

  // Pulse animation for working buildings
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (building && working) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [building, working]);

  const handleTap = () => {
    if (selectedBuilding) {
      const result = placeBuilding(x, y);
      if (result === 'placed') {
        if (Haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (result === 'occupied') {
        setNotification('Tile occupied!');
        if (Haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else if (result === 'broke') {
        setNotification('Not enough credits!');
        if (Haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    } else {
      setSelectedCell({ x, y });
      if (Haptics) Haptics.selectionAsync();
    }
  };

  const handleLongPress = () => {
    if (cell.building) {
      removeBuilding(x, y);
      setNotification('Building salvaged (50% refund)');
      if (Haptics)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  // Determine background color
  let bgColor = 'rgba(255,255,255,0.02)';
  if (showHeatMap) {
    bgColor = tempColor(cell.temp);
  } else if (building) {
    bgColor = building.color;
  }

  // Purity bar
  const purity = cell.purity || 0;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handleTap}
      onLongPress={handleLongPress}
      delayLongPress={500}
      style={[
        styles.cell,
        { backgroundColor: bgColor },
        isSelected && styles.selected,
      ]}
    >
      <Animated.View
        style={[
          styles.inner,
          building && working && { transform: [{ scale: pulseAnim }] },
          building && !working && { opacity: 0.4 },
        ]}
      >
        {building ? (
          <Text style={styles.icon}>{building.icon}</Text>
        ) : cell.resourceNode ? (
          <Text style={styles.resourceIcon}>
            {RESOURCE_ICONS[cell.resourceNode]}
          </Text>
        ) : null}
      </Animated.View>

      {showHeatMap && (
        <Text style={styles.tempText}>{Math.round(cell.temp)}°</Text>
      )}

      {purity > 0 && (
        <View style={styles.purityBar}>
          <View
            style={[
              styles.purityFill,
              {
                width: `${purity}%`,
                backgroundColor:
                  purity > 80 ? C.positive : purity > 50 ? C.accent : C.negative,
              },
            ]}
          />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default React.memo(GridCell, (prev, next) => {
  return (
    prev.cell === next.cell &&
    prev.x === next.x &&
    prev.y === next.y
  );
});

const styles = StyleSheet.create({
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    margin: GAP / 2,
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  selected: {
    borderWidth: 2,
    borderColor: C.flame,
  },
  inner: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  icon: {
    fontSize: 20,
    textAlign: 'center',
  },
  resourceIcon: {
    fontSize: 16,
    opacity: 0.3,
    textAlign: 'center',
  },
  tempText: {
    position: 'absolute',
    bottom: 2,
    left: 3,
    fontSize: 7,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: 'rgba(255,255,255,0.6)',
  },
  purityBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  purityFill: {
    height: 3,
  },
});
