// Sablon nézetek szerkesztője (vezetőknek): a beépített sablonok átállíthatók (és visszaállíthatók),
// egyedi sablon készíthető, átnevezhető, törölhető. Szakaszonként: Auto / Nyitva / Csukva / Rejtve.

import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, Card, H2, Sub, Body, Btn, Input, Badge, Segmented, Empty, Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { getCurrentUserId, insertRow, updateRow, softDeleteRow } from '../lib/repo';
import { notify, confirmDialog } from '../lib/dialogs';
import { Profile, TaskViewPreset } from '../lib/types';
import { VIEW_SECTIONS, VIEW_MODE_OPTIONS, VIEW_TOGGLE_OPTIONS, ViewMode, ViewSections, TaskView, builtinSections, builtinEditable, sanitizeSections } from '../lib/taskViews';
import { useTaskViews, setActiveTaskViewId } from '../lib/taskViewState';

const MODE_LABEL: Record<ViewMode, string> = { auto: 'auto', open: 'nyitva', closed: 'csukva', hidden: 'rejtve' };

const summary = (s: ViewSections, editable: boolean) => {
  const parts = VIEW_SECTIONS.filter((x) => s[x.key] && s[x.key] !== 'auto').map((x) => `${x.label.replace(/^\S+\s/, '')}: ${MODE_LABEL[s[x.key]!]}`);
  const lock = editable ? '' : '🔒 szerkesztés nélkül · ';
  return lock + (parts.length ? parts.join(' · ') : 'minden szakasz automatikus — ahogy az app magától mutatja');
};

const norm = (s: ViewSections) => VIEW_SECTIONS.map((x) => s[x.key] ?? 'auto').join(',');
const same = (a: ViewSections, b: ViewSections) => norm(a) === norm(b);

export default function TaskViews() {
  const { views, active } = useTaskViews();
  const rows = useTable<TaskViewPreset>('task_view_presets');
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();
  const isWorker = !!profiles.find((p) => p.id === me)?.worker_id;
  /** id: a szerkesztett nézet; 'new' = új egyedi sablon */
  const [draft, setDraft] = useState<{ id: string; name: string; sections: ViewSections; editable: boolean } | null>(null);

  if (isWorker) return <Screen><Empty text="A sablon nézetek a vezetőknek szólnak." /></Screen>;

  const startEdit = (v: TaskView) => setDraft({ id: v.id, name: v.name, sections: { ...v.sections }, editable: v.editable });

  const save = () => {
    if (!draft) return;
    const sections = sanitizeSections(draft.sections);
    if (draft.id === 'new') {
      const name = draft.name.trim();
      if (!name) { notify('Név kell', 'Adj nevet a sablonnak (pl. „Helyszíni bejáráshoz”).'); return; }
      if (views.some((v) => v.name.toLowerCase() === name.toLowerCase())) { notify('Már van ilyen', 'Ilyen nevű sablon már létezik — adj neki más nevet.'); return; }
      const position = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0) + 1;
      const id = insertRow<TaskViewPreset>('task_view_presets', { name: name.slice(0, 40), builtin: null, sections, editable: draft.editable, position });
      setActiveTaskViewId(id);
      setDraft(null);
      notify('Mentve ✅', `Az új sablon („${name}”) ki is van választva.`);
      return;
    }
    const v = views.find((x) => x.id === draft.id);
    if (!v) { setDraft(null); return; }
    if (v.builtin) {
      // a beépített sablon átállítása: a saját változat sorban tárolódik
      if (v.rowId) updateRow('task_view_presets', v.rowId, { sections, editable: draft.editable });
      else insertRow<TaskViewPreset>('task_view_presets', { name: v.name, builtin: v.builtin, sections, editable: draft.editable, position: 0 });
    } else if (v.rowId) {
      const name = draft.name.trim();
      if (!name) { notify('Név kell', 'A sablon neve nem lehet üres.'); return; }
      if (views.some((x) => x.id !== v.id && x.name.toLowerCase() === name.toLowerCase())) { notify('Már van ilyen', 'Ilyen nevű sablon már létezik — adj neki más nevet.'); return; }
      updateRow('task_view_presets', v.rowId, { name: name.slice(0, 40), sections, editable: draft.editable });
    }
    setDraft(null);
  };

  const reset = async (v: TaskView) => {
    if (!v.builtin) return;
    if (!(await confirmDialog('Visszaállítás', `A(z) „${v.name}” sablon visszaáll az eredeti beállításra.`, 'Visszaállítás'))) return;
    for (const r of rows.filter((x) => x.builtin === v.builtin && x.created_by === me)) softDeleteRow('task_view_presets', r.id);
    setDraft(null);
  };

  const remove = async (v: TaskView) => {
    if (!v.rowId || v.builtin) return;
    if (!(await confirmDialog('Sablon törlése', `Törlöd a(z) „${v.name}” sablont?`, 'Törlés'))) return;
    softDeleteRow('task_view_presets', v.rowId);
    setDraft(null);
  };

  const editor = (v: TaskView | null) => draft ? (
    <View style={{ gap: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.border }}>
      {!v || !v.builtin ? <Input label="Sablon neve *" value={draft.name} onChangeText={(t) => setDraft({ ...draft, name: t })} placeholder="pl. Helyszíni bejáráshoz" /> : null}
      <Check checked={draft.editable} onToggle={() => setDraft({ ...draft, editable: !draft.editable })} label="✏️ Szerkesztési lehetőség"
        sub="Kikapcsolva a feladat csak megtekinthető: nincs műveletsáv, szerkesztés, törlés, rögzítés — az Excel-exportok megmaradnak." />
      {VIEW_SECTIONS.map((s) => (
        <Segmented key={s.key} label={s.label} options={'toggleOnly' in s && s.toggleOnly ? VIEW_TOGGLE_OPTIONS : VIEW_MODE_OPTIONS} value={draft.sections[s.key] ?? 'auto'}
          onChange={(m) => setDraft({ ...draft, sections: { ...draft.sections, [s.key]: m } })} />
      ))}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setDraft(null)} /></View>
        <View style={{ flex: 2 }}><Btn title="Mentés" small onPress={save} /></View>
      </View>
    </View>
  ) : null;

  return (
    <Screen>
      <Sub>A kiválasztott nézet szerint jelennek meg a szakaszok, amikor megnyitsz egy feladatot. Auto: az app dönt, ahogy eddig (pl. a megjegyzések nyitva, ha van megjegyzés) · Nyitva · Csukva: csak a fejléce látszik, koppintásra nyílik · Rejtve: nem jelenik meg. A sablonok a fiókodhoz tartoznak — minden készülékeden ugyanazok.</Sub>

      {views.map((v) => {
        const editing = draft?.id === v.id;
        const modified = !!v.builtin && !!v.rowId && (!same(v.sections, builtinSections(v.builtin)) || v.editable !== builtinEditable(v.builtin));
        return (
          <Card key={v.id} style={active.id === v.id ? { borderColor: C.primary } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
              <H2 style={{ flex: 1 }}>{v.name}</H2>
              {active.id === v.id ? <Badge text="✓ kiválasztva" color={C.primary} /> : null}
              {v.builtin ? <Badge text={modified ? 'beépített · átállítva' : 'beépített'} color={C.sub} /> : <Badge text="egyedi" color={C.success} />}
            </View>
            {!editing ? <Sub>{summary(v.sections, v.editable)}</Sub> : null}
            {!editing ? (
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                {active.id !== v.id ? <Btn title="Kiválasztom" kind="secondary" small onPress={() => setActiveTaskViewId(v.id)} /> : null}
                <Btn title="✏️ Beállítás" kind="ghost" small onPress={() => startEdit(v)} />
                {modified ? <Btn title="↩ Visszaállítás" kind="ghost" small onPress={() => void reset(v)} /> : null}
                {!v.builtin ? <Btn title="🗑️ Törlés" kind="ghost" small onPress={() => void remove(v)} /> : null}
              </View>
            ) : editor(v)}
          </Card>
        );
      })}

      {draft?.id === 'new' ? (
        <Card style={{ borderColor: C.accent }}>
          <H2>Új sablon nézet</H2>
          {editor(null)}
        </Card>
      ) : (
        <Btn title="+ Új sablon nézet" kind="secondary" onPress={() => setDraft({ id: 'new', name: '', sections: {}, editable: true })} />
      )}
      <Body style={{ color: C.sub, fontSize: 12 }}>Az, hogy épp melyik nézet van kiválasztva, készülékenként külön jegyződik meg.</Body>
    </Screen>
  );
}
