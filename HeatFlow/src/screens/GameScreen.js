import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import useGameStore from '../store/gameStore';
import { ZONES } from '../data/zones';
import GameGrid from '../components/GameGrid';
import Notification from '../components/Notification';

export default function GameScreen() {
  const zone = useGameStore((s) => s.zone);
  const bg = ZONES[zone]?.bg || '#0d1117';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <GameGrid />
      <Notification />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
