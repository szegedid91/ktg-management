// Közös UI-komponensek — minden képernyő ezekből épül

import React, { ReactNode, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal, RefreshControl,
  ActivityIndicator, ViewStyle, TextStyle, KeyboardAvoidingView, Platform,
} from 'react-native';
import { C, S, F } from './theme';
import { BottomBar } from '../components/BottomBar';
import { syncNow } from '../lib/sync';

const PULL_TRIGGER = 70; // ennyi px lehúzás indítja a frissítést

export function Screen({ children, scroll = true, pad = true, footer }: {
  children: ReactNode; scroll?: boolean; pad?: boolean;
  /** fix sáv a görgethető tartalom alatt, az alsó menüsor felett */
  footer?: ReactNode;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await syncNow(); } finally { setRefreshing(false); }
  };

  // Lehúzásos frissítés weben: a böngésző nem ad RefreshControl-t,
  // ezért érintésből számoljuk — csak a lista tetején, lefelé húzásra.
  const scrollY = useRef(0);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const webPullProps = Platform.OS === 'web' ? {
    onScroll: (e: any) => { scrollY.current = e.nativeEvent.contentOffset.y; },
    scrollEventThrottle: 16,
    onTouchStart: (e: any) => {
      startY.current = scrollY.current <= 0 ? e.nativeEvent.touches?.[0]?.pageY ?? null : null;
    },
    onTouchMove: (e: any) => {
      if (startY.current == null || refreshing) return;
      const d = (e.nativeEvent.touches?.[0]?.pageY ?? 0) - startY.current;
      setPull(d > 0 ? Math.min(d * 0.45, PULL_TRIGGER + 20) : 0);
    },
    onTouchEnd: () => {
      if (pull >= PULL_TRIGGER) void doRefresh();
      startY.current = null;
      setPull(0);
    },
  } : {};

  const content = pad ? <View style={{ padding: S.lg, gap: S.md, flex: scroll ? undefined : 1 }}>{children}</View> : children;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 48 }}
            refreshControl={Platform.OS !== 'web'
              ? <RefreshControl refreshing={refreshing} onRefresh={() => void doRefresh()} tintColor={C.primary} />
              : undefined}
            {...webPullProps}
          >
            {content}
          </ScrollView>
        ) : content}
        {Platform.OS === 'web' && (pull > 0 || refreshing) ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center',
              opacity: refreshing ? 1 : Math.min(pull / PULL_TRIGGER, 1),
              transform: [{ translateY: refreshing ? 12 : pull * 0.4 }],
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 18, backgroundColor: C.card,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.border,
              shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
            }}>
              {refreshing
                ? <ActivityIndicator size="small" color={C.primary} />
                : <Text style={{
                    fontSize: 18, color: C.primary, fontWeight: '700',
                    transform: [{ rotate: pull >= PULL_TRIGGER ? '180deg' : '0deg' }],
                  }}>↓</Text>}
            </View>
          </View>
        ) : null}
      </View>
      {footer}
      <BottomBar />
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[st.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={F.title}>{children}</Text>;
}

export function H2({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[F.h2, style]}>{children}</Text>;
}

export function Sub({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[F.sub, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[F.body, style]}>{children}</Text>;
}

export function Money({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[F.money, style]}>{children}</Text>;
}

export function Btn({ title, onPress, kind = 'primary', disabled, small }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; small?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : kind === 'secondary' ? C.accent : 'transparent';
  const fg = kind === 'ghost' ? C.primary : kind === 'secondary' ? '#3A2A00' : C.primaryText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.btn, small && st.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: C.primary },
      ]}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Input({ label, value, onChangeText, placeholder, keyboardType, multiline, autoCapitalize, secureTextEntry, right, autoComplete }: {
  label?: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad'; multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words'; secureTextEntry?: boolean; right?: ReactNode;
  /** böngésző-kitöltés vezérlése (weben az autocomplete attribútum), pl. 'new-password', 'current-password', 'off' */
  autoComplete?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <TextInput
          style={[st.input, multiline && { height: 80, textAlignVertical: 'top' }, { flex: 1 }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.sub}
          keyboardType={keyboardType}
          multiline={multiline}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          secureTextEntry={secureTextEntry}
          autoComplete={autoComplete as any}
        />
        {right}
      </View>
    </View>
  );
}

/** Egyszerű választó: gombokként megjelenő opciók */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[st.chip, value === o.value && { backgroundColor: C.primary }]}
          >
            <Text style={{ color: value === o.value ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Modális lista-választó (építkezés, munkás, kategória...) */
export function Picker<T>({ label, items, selectedId, getId, getLabel, onSelect, placeholder, allowNull, nullLabel }: {
  label?: string; items: T[]; selectedId: string | null | undefined;
  getId: (i: T) => string; getLabel: (i: T) => string; onSelect: (id: string | null) => void;
  placeholder?: string; allowNull?: boolean; nullLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => getId(i) === selectedId);
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <Pressable style={st.input} onPress={() => setOpen(true)}>
        <Text style={{ color: selected ? C.text : C.sub, fontSize: 15 }}>
          {selected ? getLabel(selected) : (placeholder ?? 'Válassz…')}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={st.modalBg} onPress={() => setOpen(false)}>
          <View style={st.modalSheet}>
            <ScrollView>
              {allowNull ? (
                <Pressable style={st.modalRow} onPress={() => { onSelect(null); setOpen(false); }}>
                  <Text style={[F.body, { color: C.sub }]}>{nullLabel ?? '— nincs —'}</Text>
                </Pressable>
              ) : null}
              {items.map((i) => (
                <Pressable key={getId(i)} style={st.modalRow} onPress={() => { onSelect(getId(i)); setOpen(false); }}>
                  <Text style={F.body}>{getLabel(i)}</Text>
                </Pressable>
              ))}
              {items.length === 0 ? <Text style={[F.sub, { padding: S.lg }]}>Nincs elem.</Text> : null}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Check({ checked, onToggle, label, sub }: { checked: boolean; onToggle: () => void; label?: string; sub?: string }) {
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
      <View style={[st.checkbox, checked && { backgroundColor: C.success, borderColor: C.success }]}>
        {checked ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
      </View>
      {label ? (
        <View style={{ flex: 1 }}>
          <Text style={F.body}>{label}</Text>
          {sub ? <Text style={F.sub}>{sub}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function Row({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const inner = (
    <View style={[st.row, style]}>{children}</View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{inner}</Pressable> : inner;
}

export function Empty({ text }: { text: string }) {
  return <Text style={[F.sub, { textAlign: 'center', paddingVertical: S.xl }]}>{text}</Text>;
}

export function Loading() {
  return <ActivityIndicator color={C.primary} style={{ padding: S.xl }} />;
}

export function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <View style={{ backgroundColor: (color ?? C.primary) + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
      <Text style={{ color: color ?? C.primary, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border }} />;
}

export function KV({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
      <Text style={[F.sub, strong && { fontWeight: '700', color: C.text }]}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number'
        ? <Text style={[F.money, !strong && { fontWeight: '500' }]}>{v}</Text>
        : v}
    </View>
  );
}

// Getter-alapú stílusok: renderkor olvassák a C-t, így a témaváltás
// (esti nézet) azonnal érvényesül — a StyleSheet.create betöltéskor
// bemerevítené a színeket.
export const st = {
  get card(): ViewStyle {
    return {
      backgroundColor: C.card, borderRadius: S.radius, padding: S.lg,
      borderWidth: 1, borderColor: C.border, gap: S.sm,
    };
  },
  get btn(): ViewStyle {
    return {
      paddingHorizontal: S.lg, paddingVertical: 12, borderRadius: S.radiusSm,
      alignItems: 'center', justifyContent: 'center',
    };
  },
  get btnSmall(): ViewStyle {
    return { paddingHorizontal: S.md, paddingVertical: 7 };
  },
  get input(): TextStyle & ViewStyle {
    return {
      backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
      borderRadius: S.radiusSm, paddingHorizontal: S.md, paddingVertical: 10,
      // 16px: iOS Safari 16 alatt fókuszkor automatikusan rázoomol a mezőre
      fontSize: 16, color: C.text, minHeight: 42, justifyContent: 'center',
    };
  },
  get label(): TextStyle {
    return { fontSize: 13, fontWeight: '600', color: C.sub };
  },
  get chip(): ViewStyle {
    return {
      backgroundColor: C.chipBg, paddingHorizontal: S.md, paddingVertical: 7,
      borderRadius: 999,
    };
  },
  get checkbox(): ViewStyle {
    return {
      width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.border,
      alignItems: 'center', justifyContent: 'center', backgroundColor: C.card,
    };
  },
  get row(): ViewStyle {
    return {
      flexDirection: 'row', alignItems: 'center', gap: S.md,
      backgroundColor: C.card, borderRadius: S.radiusSm, padding: S.md,
      borderWidth: 1, borderColor: C.border,
    };
  },
  get modalBg(): ViewStyle {
    return { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' };
  },
  get modalSheet(): ViewStyle {
    return {
      backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16,
      maxHeight: '70%', paddingVertical: S.sm,
    };
  },
  get modalRow(): ViewStyle {
    return { paddingHorizontal: S.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border };
  },
};
