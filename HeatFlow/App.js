import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import TitleScreen from './src/screens/TitleScreen';
import GameScreen from './src/screens/GameScreen';

export default function App() {
  const [screen, setScreen] = useState('title');

  return (
    <>
      <StatusBar style="light" />
      {screen === 'title' ? (
        <TitleScreen
          onNewGame={() => setScreen('game')}
          onContinue={() => setScreen('game')}
        />
      ) : (
        <GameScreen />
      )}
    </>
  );
}
