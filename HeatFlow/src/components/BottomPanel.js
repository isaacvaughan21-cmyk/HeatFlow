import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function BottomPanel() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Bottom Panel — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 200, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  text: { color: C.muted, fontSize: 12 },
});
