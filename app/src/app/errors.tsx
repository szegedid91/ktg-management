// Hibanapló — csak az admin látja. Minden felhasználó appja ide jelenti a
// rendszert érintő hibákat; a bejegyzések egy gombbal másolhatók (hibakereséshez).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Screen, Card, Sub, Body, Btn, Empty, Loading, Input } from '../ui/kit';
import { C } from '../ui/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useTable } from '../lib/hooks';
import { Profile, Worker } from '../lib/types';
import { hdt } from '../lib/format';
import { copyText } from '../lib/clipboard';
import { notify, confirmDialog } from '../lib/dialogs';

type ErrRow = {
  id: string; created_at: string; user_id: string | null; user_name: string | null;
  kind: string; message: string; detail: any; route: string | null;
  app_version: string | null; user_agent: string | null;
};

const KIND_LABELS: Record<string, string> = {
  'sync-rejected': 'Elutasított mentés', 'sync-retry': 'Szerverhiba mentéskor', sync: 'Szinkronhiba',
  upload: 'Feltöltési hiba', crash: 'Összeomlás', js: 'Programhiba', promise: 'Programhiba',
};

function asText(r: ErrRow, who?: string): string {
  return [
    `[${r.created_at}] ${r.kind} — ${who ?? r.user_name ?? r.user_id ?? 'ismeretlen'}`,
    `Üzenet: ${r.message}`,
    `Oldal: ${r.route ?? '-'} · Verzió: ${r.app_version ?? '-'}`,
    `Eszköz: ${r.user_agent ?? '-'}`,
    r.detail ? `Részletek: ${JSON.stringify(r.detail, null, 1)}` : null,
  ].filter(Boolean).join('\n');
}

export default function Errors() {
  const { session } = useAuth();
  const profiles = useTable<Profile>('profiles');
  const workers = useTable<Worker>('workers');
  const me = profiles.find((p) => p.id === session?.user.id);
  /** A fiók neve mellett a munkavállalói adatlap neve is (a kettő eltérhet, a listákban az adatlap-név látszik). */
  const whoOf = (r: ErrRow): string => {
    const prof = profiles.find((p) => p.id === r.user_id);
    const account = r.user_name ?? prof?.display_name ?? 'Ismeretlen felhasználó';
    const w = prof?.worker_id ? workers.find((x) => x.id === prof.worker_id) : undefined;
    if (!w) return prof && !prof.worker_id ? `${account} (vezető)` : account;
    return w.name === account ? account : `${w.name} (fiók: ${account})`;
  };
  const [rows, setRows] = useState<ErrRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const { data, error } = await supabase.from('client_errors').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { setFailed(true); setRows([]); return; }
    setRows((data ?? []) as ErrRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (me && !me.is_admin) return <Screen><Empty text="Nincs jogosultságod az oldal megtekintéséhez." /></Screen>;
  if (!rows) return <Screen><Loading /></Screen>;

  const needle = q.trim().toLowerCase();
  const list = needle
    ? rows.filter((r) => `${whoOf(r)} ${r.kind} ${r.message} ${r.route}`.toLowerCase().includes(needle))
    : rows;

  const copy = async (text: string, what: string) => {
    notify(await copyText(text) ? 'Kimásolva' : 'Nem sikerült másolni', what);
  };

  return (
    <Screen>
      <Card>
        <Sub>Itt látod az összes felhasználónál előfordult hibát. A „Másolás” gombbal kimásolt szöveget egy az egyben be tudod illeszteni hibakereséshez.</Sub>
        <Input label="Keresés" value={q} onChangeText={setQ} placeholder="név, hibaüzenet, oldal…" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Btn title={`Összes másolása (${list.length})`} small disabled={list.length === 0}
            onPress={() => void copy(list.map((r) => asText(r, whoOf(r))).join('\n\n---\n\n'), `${list.length} bejegyzés a vágólapon.`)} />
          <Btn title="Frissítés" kind="ghost" small onPress={() => void load()} />
          <Btn title="Napló ürítése" kind="danger" small disabled={rows.length === 0}
            onPress={() => void confirmDialog('Napló ürítése', 'Az összes hibabejegyzés törlődik. Biztosan?', 'Ürítés', true).then(async (ok) => {
              if (!ok) return;
              const { error } = await supabase.from('client_errors').delete().lte('created_at', new Date().toISOString());
              if (error) notify('Nem sikerült', error.message); else void load();
            })} />
        </View>
      </Card>

      {failed ? <Empty text="A hibanapló most nem érhető el (nincs internet, vagy nincs jogosultságod)." /> : null}
      {!failed && list.length === 0 ? <Empty text="Nincs rögzített hiba. 🎉" /> : null}

      {list.map((r) => {
        const isOpen = open === r.id;
        return (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Body style={{ fontWeight: '700', flex: 1 }}>{whoOf(r)}</Body>
              <Sub>{hdt(r.created_at)}</Sub>
            </View>
            <Sub>{KIND_LABELS[r.kind] ?? r.kind}{r.route ? ` · ${r.route}` : ''}{r.app_version ? ` · ${r.app_version}` : ''}</Sub>
            <Text selectable style={{ color: C.danger, fontSize: 13 }}>{r.message}</Text>
            {isOpen ? (
              <Text selectable style={{ fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 11, color: C.text }}>
                {asText(r, whoOf(r))}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn title="Másolás" small onPress={() => void copy(asText(r, whoOf(r)), 'A bejegyzés a vágólapon.')} />
              <Btn title={isOpen ? 'Részletek elrejtése' : 'Részletek'} kind="ghost" small onPress={() => setOpen(isOpen ? null : r.id)} />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
