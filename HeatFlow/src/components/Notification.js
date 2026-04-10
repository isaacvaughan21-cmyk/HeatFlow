import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import useGameStore from '../store/gameStore';

export default function Notification() {
  const notification = useGameStore((s) => s.notification);
  const slideAnim = useRef(new Animated.Value(60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (notification) {
      slideAnim.setValue(60);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(() => {
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start();
        }, 1600);
      });
    }
  }, [notification]);

  if (!notification) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <Text style={styles.text}>{notification}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.3)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  text: {
    color: '#FF9F1C',
    fontSize: 12,
    fontWeight: '500',
  },
});
