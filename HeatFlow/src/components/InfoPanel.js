import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function InfoPanel() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Info Panel — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { color: C.muted, fontSize: 12 },
});
