import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from '../theme/colors';

export default function TitleScreen({ onNewGame, onContinue }) {
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('heatflow_save').then((val) => {
      if (val) setHasSave(true);
    });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{'🔥 HEATFLOW ❄️'}</Text>
        <Text style={styles.subtitle}>Master energy. Build the future.</Text>

        <View style={styles.spacer} />

        <TouchableOpacity style={styles.newGameBtn} onPress={onNewGame}>
          <Text style={styles.newGameText}>New Game</Text>
        </TouchableOpacity>

        {hasSave && (
          <TouchableOpacity style={styles.continueBtn} onPress={onContinue}>
            <Text style={styles.continueText}>Continue</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.dark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: C.flame,
    letterSpacing: 2,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: C.muted,
    marginBottom: 8,
  },
  spacer: {
    height: 48,
  },
  newGameBtn: {
    backgroundColor: C.flame,
    width: 200,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  newGameText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  continueBtn: {
    backgroundColor: 'transparent',
    width: 200,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.flame,
  },
  continueText: {
    color: C.flame,
    fontSize: 16,
    fontWeight: '600',
  },
});
