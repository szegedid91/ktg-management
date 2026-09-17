// Megjegyzések egy feladathoz: a fő felhasználó ír, szerkeszt, töröl;
// kétféle láthatóság (csak fő felhasználók / a munkavállaló is látja).
// Munkavállalónak látható megjegyzés rögzítése előtt megerősítés kell.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Sub, Body, Input, Btn, Badge, Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow, softDeleteRow, getCurrentUserId } from '../lib/repo';
import { hdt } from '../lib/format';
import { notify, confirmDialog } from '../lib/dialogs';
import { TaskNote, Profile } from '../lib/types';

const CONFIRM_TITLE = 'A munkavállaló is látni fogja';
const CONFIRM_BODY = 'Ezt a megjegyzést a feladatra kiosztott munkavállaló(k) is látják az appban, és értesítést kapnak róla.\n\nBiztos rögzíted így?';

export function TaskNotes({ taskId, isWorker }: { taskId: string; isWorker: boolean }) {
  const notes = useTable<TaskNote>('task_notes').filter((n) => n.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();
  const [text, setText] = useState('');
  const [toWorkers, setToWorkers] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editVis, setEditVis] = useState(false);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    if (toWorkers && !await confirmDialog(CONFIRM_TITLE, CONFIRM_BODY, 'Igen, rögzítem')) return;
    insertRow('task_notes', { task_id: taskId, body, visible_to_workers: toWorkers });
    setText(''); setToWorkers(false);
  };
  const startEdit = (n: TaskNote) => { setEditId(n.id); setEditText(n.body); setEditVis(n.visible_to_workers); };
  const saveEdit = async (n: TaskNote) => {
    const body = editText.trim();
    if (!body) { notify('Hiba', 'A megjegyzés nem lehet üres.'); return; }
    if (editVis && (!n.visible_to_workers || body !== n.body) && !await confirmDialog(CONFIRM_TITLE, CONFIRM_BODY, 'Igen, mentem')) return;
    updateRow('task_notes', n.id, { body, visible_to_workers: editVis });
    setEditId(null);
  };
  const remove = async (n: TaskNote) => {
    if (!await confirmDialog('Megjegyzés törlése', `„${n.body.slice(0, 80)}${n.body.length > 80 ? '…' : ''}”\n\nTörlöd?`, 'Törlés', true)) return;
    softDeleteRow('task_notes', n.id);
  };

  return (
    <View style={{ gap: S.sm }}>
      {notes.length === 0 ? <Sub>{isWorker ? 'Nincs megjegyzés.' : 'Még nincs megjegyzés.'}</Sub> : null}
      {notes.map((n) => (
        <View key={n.id} style={{ gap: 4, borderLeftWidth: 3, borderLeftColor: n.visible_to_workers ? C.primary : C.border, paddingLeft: S.sm, paddingVertical: 2 }}>
          {editId === n.id ? (
            <View style={{ gap: S.sm }}>
              <Input value={editText} onChangeText={setEditText} multiline />
              <Check checked={editVis} onToggle={() => setEditVis(!editVis)} label="A munkavállaló is lássa" />
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setEditId(null)} /></View>
                <View style={{ flex: 2 }}><Btn title="Mentés" small onPress={() => void saveEdit(n)} /></View>
              </View>
            </View>
          ) : (
            <>
              <Body>{n.body}</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
                {!isWorker ? <Badge text={n.visible_to_workers ? '👷 munkavállaló is látja' : '🔒 csak fő felhasználók'} color={n.visible_to_workers ? C.primary : C.sub} /> : null}
                <Sub style={{ fontSize: 11, flex: 1 }}>{profiles.find((p) => p.id === n.created_by)?.display_name ?? (n.created_by === me ? 'én' : '?')} · {hdt(n.updated_at !== n.created_at ? n.updated_at : n.created_at)}{n.updated_at !== n.created_at ? ' (szerk.)' : ''}</Sub>
                {!isWorker ? <Btn title="✏️" kind="ghost" small onPress={() => startEdit(n)} /> : null}
                {!isWorker ? <Btn title="🗑️" kind="ghost" small onPress={() => void remove(n)} /> : null}
              </View>
            </>
          )}
        </View>
      ))}
      {!isWorker ? (
        <View style={{ gap: S.sm, paddingTop: 4 }}>
          <Input value={text} onChangeText={setText} placeholder="Új megjegyzés…" multiline />
          <Check checked={toWorkers} onToggle={() => setToWorkers(!toWorkers)} label="A munkavállaló is lássa" sub="Bepipálva a kiosztott munkavállaló(k) is olvassák, és értesítést kapnak. Üresen csak a fő felhasználók látják." />
          <Btn title="Megjegyzés rögzítése" kind="secondary" small disabled={!text.trim()} onPress={() => void add()} />
        </View>
      ) : null}
      {isWorker && notes.length ? <Text style={{ fontSize: 11, color: C.sub }}>A fő felhasználók megjegyzései ehhez a feladathoz.</Text> : null}
    </View>
  );
}
