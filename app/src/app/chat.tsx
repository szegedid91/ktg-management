// Közös chat: egy mindenki által látható üzenőfal (vezetők és munkavállalók).
// @név → az illető értesítést kap; 📌 feladat hozzátűzése → a feladat kódja/címe
// az üzenetben, koppintásra megnyílik; a vezető kitűzhet üzenetet (fent marad).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Screen, Sub, Btn, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow, softDeleteRow, getCurrentUserId } from '../lib/repo';
import { confirmDialog } from '../lib/dialogs';
import { hd, todayISO, localDateISO } from '../lib/format';
import { isActiveTask, isOpenForWorker, wname } from '../lib/tasks';
import { markChatSeen } from '../lib/chatSeen';
import { ChatMessage, Profile, WorkerTask, TaskAssignee, Worker } from '../lib/types';

/** Megemlíthető személy: a megjelenő név + ki kapja az értesítést (fiók nélküli embernél a vállalkozója) */
type Cand = { key: string; name: string; recipient: string | null };

const hm = (ts: string) => new Date(ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => iso === todayISO() ? 'Ma' : iso === localDateISO(new Date(Date.now() - 864e5)) ? 'Tegnap' : hd(iso);
const taskLabelOf = (t: WorkerTask) => `${t.code ? `${t.code} · ` : ''}${t.title}`;

/** Az üzenet szövege: az @említések kiemelve. */
function Body({ text, names }: { text: string; names: string[] }) {
  // a hosszabb nevek előbb, hogy a „Kovács Márton” ne a „Kovács” részre illeszkedjen
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const parts: { t: string; m: boolean }[] = [];
  let rest = text;
  while (rest.length) {
    let best: { i: number; n: string } | null = null;
    for (const n of sorted) {
      const i = rest.indexOf(`@${n}`);
      if (i >= 0 && (!best || i < best.i)) best = { i, n };
    }
    if (!best) { parts.push({ t: rest, m: false }); break; }
    if (best.i > 0) parts.push({ t: rest.slice(0, best.i), m: false });
    parts.push({ t: `@${best.n}`, m: true });
    rest = rest.slice(best.i + best.n.length + 1);
  }
  return (
    <Text style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>
      {parts.map((p, i) => <Text key={i} style={p.m ? { color: C.primary, fontWeight: '700' } : undefined}>{p.t}</Text>)}
    </Text>
  );
}

export default function Chat() {
  const me = getCurrentUserId();
  const profiles = useTable<Profile>('profiles');
  const messages = useTable<ChatMessage>('chat_messages');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const workers = useTable<Worker>('workers');
  const myProfile = profiles.find((p) => p.id === me);
  const isWorker = !!myProfile?.worker_id;
  // a név ugyanaz, mint a Munkavállalók listában (becenév / név); vezetőnél a fiók neve
  const profileName = (p: Profile) => {
    const w = p.worker_id ? workers.find((x) => x.id === p.worker_id) : undefined;
    return w ? wname(w) : p.display_name;
  };
  const authorOf = (m: ChatMessage) => { const p = profiles.find((x) => x.id === m.created_by); return p ? profileName(p) : (m.author_name ?? 'Ismeretlen'); };
  // megemlíthetők: minden élő, jóváhagyott munkavállaló (fiók nélkülinél a vállalkozója kapja az értesítést)
  // + a vezetők; akinek nincs se fiókja, se vállalkozója, az csak névként kerül a szövegbe
  const candidates = useMemo<Cand[]>(() => {
    const out: Cand[] = [];
    const covered = new Set<string>();
    for (const w of workers) {
      if (!w.approved_at || w.id === myProfile?.worker_id) continue;
      covered.add(w.id);
      const own = profiles.find((p) => p.worker_id === w.id);
      const boss = w.contractor_id ? profiles.find((p) => p.worker_id === w.contractor_id) : undefined;
      out.push({ key: `w:${w.id}`, name: wname(w), recipient: own?.id ?? boss?.id ?? null });
    }
    for (const p of profiles) {
      if (p.id === me || !p.display_name) continue;
      if (!p.worker_id) out.push({ key: `p:${p.id}`, name: p.display_name, recipient: p.id });
      else if (p.active === true && !covered.has(p.worker_id)) out.push({ key: `p:${p.id}`, name: p.display_name, recipient: p.id });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }, [workers, profiles, me, myProfile?.worker_id]);
  const names = useMemo(() => Array.from(new Set([...candidates.map((c) => c.name), ...profiles.map(profileName), ...profiles.map((p) => p.display_name)].filter(Boolean))), [candidates, profiles, workers]);

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Cand[]>([]);
  const [task, setTask] = useState<WorkerTask | null>(null);
  const [taskPick, setTaskPick] = useState(false);
  const [taskQ, setTaskQ] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages]);
  const pinned = sorted.filter((m) => m.pinned_at);

  // megnyitva: minden eddigi olvasott; új üzenetnél az aljára görgetünk
  useEffect(() => { markChatSeen(); }, [sorted.length]);
  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50); return () => clearTimeout(t); }, [sorted.length]);

  // @név ajánló: a kurzor előtti (szöveg végi) „@valami” részre illeszkedő nevek
  const atMatch = /(^|\s)@([^@]{0,30})$/.exec(text);
  const suggestions = atMatch
    ? candidates.filter((c) => c.name.toLowerCase().includes(atMatch[2].toLowerCase())).slice(0, 60)
    : [];
  const pickMention = (c: Cand) => {
    setText(text.slice(0, text.length - (atMatch ? atMatch[0].length : 0)) + `${atMatch?.[1] ?? ''}@${c.name} `);
    if (!mentions.some((m) => m.key === c.key)) setMentions([...mentions, c]);
  };

  // feladat-választó: vezetőnek a futó feladatok, munkavállalónak a sajátjai
  const pickable = useMemo(() => {
    const list = isWorker
      ? tasks.filter((t) => isOpenForWorker(t) && assignees.some((a) => a.task_id === t.id && a.worker_id === myProfile?.worker_id))
      : tasks.filter(isActiveTask);
    const q = taskQ.trim().toLowerCase();
    return list.filter((t) => !q || taskLabelOf(t).toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
  }, [tasks, assignees, isWorker, myProfile?.worker_id, taskQ]);

  const send = () => {
    const body = text.trim();
    if (!body && !task) return;
    // csak az marad említés, akinek a neve tényleg benne van a szövegben; az értesítést a fiók (vagy a vállalkozó) kapja
    const ids = Array.from(new Set(mentions.filter((c) => body.includes(`@${c.name}`)).map((c) => c.recipient).filter((x): x is string => !!x)));
    insertRow('chat_messages', {
      body, mentions: ids, task_id: task?.id ?? null, task_label: task ? taskLabelOf(task) : null, pinned_at: null, pinned_by: null,
    });
    setText(''); setMentions([]); setTask(null); setTaskPick(false); setTaskQ('');
    markChatSeen();
  };
  const remove = async (m: ChatMessage) => {
    setMenuFor(null);
    if (!await confirmDialog('Üzenet törlése', 'Biztos törlöd ezt az üzenetet?', 'Törlés')) return;
    softDeleteRow('chat_messages', m.id);
  };
  const togglePin = (m: ChatMessage) => {
    setMenuFor(null);
    updateRow('chat_messages', m.id, m.pinned_at ? { pinned_at: null, pinned_by: null } : { pinned_at: new Date().toISOString(), pinned_by: me });
  };

  const bubble = (m: ChatMessage) => {
    const mine = m.created_by === me;
    const canMenu = mine || !isWorker;
    return (
      <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <Pressable onLongPress={() => canMenu && setMenuFor(menuFor === m.id ? null : m.id)} onPress={() => menuFor && setMenuFor(null)} delayLongPress={350}
          style={{ maxWidth: '88%', backgroundColor: mine ? C.primary + '22' : C.card, borderWidth: 1, borderColor: m.pinned_at ? C.warning : C.border,
            borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, paddingVertical: 6, paddingHorizontal: 10, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: mine ? C.primary : C.text, flexShrink: 1 }}>{mine ? 'Én' : authorOf(m)}</Text>
            <Text style={{ fontSize: 11, color: C.sub }}>{hm(m.created_at)}</Text>
            {m.pinned_at ? <Text style={{ fontSize: 11 }}>📌</Text> : null}
            {canMenu ? <Pressable onPress={() => setMenuFor(menuFor === m.id ? null : m.id)} hitSlop={8}><Text style={{ color: C.sub, fontSize: 14 }}>⋯</Text></Pressable> : null}
          </View>
          {m.body ? <Body text={m.body} names={names} /> : null}
          {m.task_id ? (
            <Pressable onPress={() => router.push(`/task/${m.task_id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 }}>
              <Text style={{ fontSize: 14 }}>🛠️</Text>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={2}>{m.task_label ?? 'Feladat'}</Text>
              <Text style={{ fontSize: 12, color: C.primary }}>›</Text>
            </Pressable>
          ) : null}
          {menuFor === m.id ? (
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', paddingTop: 4 }}>
              {!isWorker ? <Btn title={m.pinned_at ? '📌 Kitűzés levétele' : '📌 Kitűzés'} kind="ghost" small onPress={() => togglePin(m)} /> : null}
              <Btn title="🗑️ Törlés" kind="ghost" small onPress={() => void remove(m)} />
            </View>
          ) : null}
        </Pressable>
      </View>
    );
  };

  // napok szerint elválasztva
  const rows: React.ReactNode[] = [];
  let lastDay = '';
  for (const m of sorted) {
    const d = localDateISO(m.created_at);
    if (d !== lastDay) {
      lastDay = d;
      rows.push(<Text key={`d-${d}`} style={{ alignSelf: 'center', fontSize: 11, color: C.sub, fontWeight: '700', marginVertical: 4 }}>{dayLabel(d)}</Text>);
    }
    rows.push(bubble(m));
  }

  const composer = (
    <View style={{ borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card, padding: S.sm, gap: 6 }}>
      {suggestions.length ? (
        // minden aktív név látszik (görgethető), gépelésre szűkül
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 132 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((c) => (
              <Pressable key={c.key} onPress={() => pickMention(c)} style={{ backgroundColor: C.chipBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>@{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {task ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 13 }}>🛠️</Text>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1}>{taskLabelOf(task)}</Text>
          <Pressable onPress={() => setTask(null)} hitSlop={8}><Text style={{ color: C.sub, fontWeight: '800' }}>✕</Text></Pressable>
        </View>
      ) : null}
      {taskPick ? (
        <View style={{ gap: 6, maxHeight: 260 }}>
          <TextInput value={taskQ} onChangeText={setTaskQ} placeholder="Feladat keresése (kód vagy cím)…" placeholderTextColor={C.sub} autoFocus
            style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 14, color: C.text, backgroundColor: C.bg }} />
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 210 }}>
            {pickable.length === 0 ? <Sub>Nincs ilyen feladat.</Sub> : null}
            {pickable.map((t) => (
              <Pressable key={t.id} onPress={() => { setTask(t); setTaskPick(false); setTaskQ(''); }}
                style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1}>{taskLabelOf(t)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Btn title="Mégse" kind="ghost" small onPress={() => { setTaskPick(false); setTaskQ(''); }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        <Pressable onPress={() => setText((t) => (t.endsWith(' ') || !t ? `${t}@` : `${t} @`))} hitSlop={6} accessibilityLabel="Ember megemlítése"
          style={{ paddingVertical: 9, paddingHorizontal: 8 }}><Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>@</Text></Pressable>
        <Pressable onPress={() => setTaskPick(!taskPick)} hitSlop={6} accessibilityLabel="Feladat hozzátűzése" style={{ paddingVertical: 9, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 18 }}>📌</Text>
        </Pressable>
        <TextInput value={text} onChangeText={setText} placeholder="Írj üzenetet… (@név: megemlítés)" placeholderTextColor={C.sub} multiline
          style={{ flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: Platform.OS === 'web' ? 10 : 8, paddingHorizontal: 12, fontSize: 15, color: C.text, backgroundColor: C.bg }} />
        <Pressable onPress={send} disabled={!text.trim() && !task} accessibilityLabel="Küldés"
          style={{ backgroundColor: text.trim() || task ? C.primary : C.chipBg, borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>➤</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen scroll={false} pad={false} footer={composer}>
      <View style={{ flex: 1 }}>
        {pinned.length ? (
          <View style={{ backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border, padding: S.sm, gap: 4 }}>
            {pinned.slice(-3).map((m) => (
              <Pressable key={m.id} onPress={() => m.task_id ? router.push(`/task/${m.task_id}`) : undefined} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Text style={{ fontSize: 12 }}>📌</Text>
                <Text style={{ flex: 1, fontSize: 12, color: C.text }} numberOfLines={1}>
                  <Text style={{ fontWeight: '800' }}>{authorOf(m)}: </Text>{m.body || m.task_label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.md, gap: 8, flexGrow: 1, justifyContent: 'flex-end' }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {sorted.length === 0 ? <Empty text="Még nincs üzenet. Írj elsőként — mindenki látja, aki használja az appot." /> : null}
          {rows}
        </ScrollView>
      </View>
    </Screen>
  );
}
