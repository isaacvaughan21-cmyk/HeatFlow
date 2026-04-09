import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function GridCell() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Cell</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: 32, height: 32, backgroundColor: C.card, margin: 1 },
  text: { color: C.muted, fontSize: 8, textAlign: 'center' },
});
