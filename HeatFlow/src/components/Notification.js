import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from '../theme/colors';

export default function Notification() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Notification — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  text: { color: C.text, fontSize: 12 },
});
