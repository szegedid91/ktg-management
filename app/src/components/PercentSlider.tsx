// Egyszerű, húzható százalék-csúszka (0–100). Webre és natívra is jó:
// PanResponder-rel megy, külső csomag nélkül.

import React, { useRef } from 'react';
import { View, PanResponder } from 'react-native';
import { C } from '../ui/theme';

const TRACK_H = 8;
const THUMB = 24;

export function PercentSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const widthRef = useRef(0);
  const setFromX = (x: number) => {
    if (widthRef.current <= 0) return;
    const pct = Math.round((x / widthRef.current) * 100);
    onChange(Math.max(0, Math.min(100, pct)));
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current;

  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
      style={{ height: THUMB + 8, justifyContent: 'center' }}
    >
      <View style={{ height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: C.chipBg }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 0, width: `${pct}%`,
          height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: C.primary,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: `${pct}%`, marginLeft: -THUMB / 2,
          width: THUMB, height: THUMB, borderRadius: THUMB / 2,
          backgroundColor: '#fff', borderWidth: 2, borderColor: C.primary,
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
        }}
      />
    </View>
  );
}
