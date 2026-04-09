import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function TopBar() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Top Bar — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 40, backgroundColor: C.mid, justifyContent: 'center', alignItems: 'center' },
  text: { color: C.muted, fontSize: 12 },
});
