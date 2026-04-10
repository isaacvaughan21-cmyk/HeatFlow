import React, { useState } from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import useGameStore from '../store/gameStore';
import GridCell from './GridCell';
import { C } from '../theme/colors';

const CELL_SIZE = 44;
const GAP = 1;

export default function GameGrid() {
  const grid = useGameStore((s) => s.grid);
  const [scale, setScale] = useState(1.0);

  const zoomIn = () => setScale((s) => Math.min(s + 0.2, 2.0));
  const zoomOut = () => setScale((s) => Math.max(s - 0.2, 0.6));

  const gridWidth = grid[0] ? grid[0].length * (CELL_SIZE + GAP) : 0;
  const gridHeight = grid.length * (CELL_SIZE + GAP);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ minHeight: gridHeight * scale + 20 }}
      >
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            width: gridWidth * scale + 20,
            paddingBottom: 20,
          }}
        >
          <View
            style={[
              styles.gridContainer,
              {
                width: gridWidth,
                transform: [{ scale }],
                transformOrigin: 'top left',
              },
            ]}
          >
            {grid.map((row, y) => (
              <View key={y} style={styles.row}>
                {row.map((cell, x) => (
                  <GridCell key={`${x}-${y}`} x={x} y={y} cell={cell} />
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>

      <View style={styles.zoomControls}>
        <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.zoomLabel}>{Math.round(scale * 100)}%</Text>
        <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  gridContainer: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomText: {
    color: C.text,
    fontSize: 18,
    fontWeight: '600',
  },
  zoomLabel: {
    color: C.muted,
    fontSize: 11,
    minWidth: 36,
    textAlign: 'center',
  },
});
