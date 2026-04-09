import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function ZoneTabs() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Zone Tabs — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 36, backgroundColor: C.mid, justifyContent: 'center', alignItems: 'center' },
  text: { color: C.muted, fontSize: 12 },
});
