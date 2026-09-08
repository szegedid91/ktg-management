// Jelszó mutatása/elrejtése ikon a beviteli mező jobb oldalára
import React from 'react';
import { Pressable, Text } from 'react-native';

export function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} hitSlop={10} accessibilityLabel={shown ? 'Jelszó elrejtése' : 'Jelszó mutatása'}
      style={({ pressed }) => ({ paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 22 }}>{shown ? '🙈' : '👁️'}</Text>
    </Pressable>
  );
}
