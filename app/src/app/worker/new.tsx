import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Btn } from '../../ui/kit';
import { WorkerForm, emptyWorkerForm, formToRow, validateWorkerForm } from '../../components/WorkerForm';
import { insertRow, callRpc } from '../../lib/repo';
import { notify, confirmDialog } from '../../lib/dialogs';
import { useDraft } from '../../lib/draft';
import { S } from '../../ui/theme';

export default function NewWorker() {
  // a félbehagyott kitöltést 10 percig megőrizzük (a bankszámlaszám kivételével)
  const { value: form, setValue: setForm, clear, dirty } = useDraft('worker-new', emptyWorkerForm, ['bank_account']);

  const save = async () => {
    const err = validateWorkerForm(form);
    if (err) { notify('Hiba', err); return; }
    const id = insertRow('workers', formToRow(form));
    if (form.bank_account.trim()) {
      try {
        await callRpc('set_worker_bank_account', { p_worker: id, p_account: form.bank_account.trim() });
      } catch {
        notify('Figyelem', 'A bankszámlaszám mentéséhez internet kell — most nem sikerült, add meg később újra.');
      }
    }
    clear();
    router.replace(`/worker/${id}`);
  };

  const clearAll = async () => {
    if (!await confirmDialog('Űrlap ürítése', 'Minden beírt adat törlődik. Biztos?', 'Ürítés', true)) return;
    clear();
  };

  return (
    <Screen>
      <WorkerForm value={form} onChange={setForm} />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        {dirty ? <View style={{ flex: 1 }}><Btn title="Ürítés" kind="ghost" onPress={() => void clearAll()} /></View> : null}
        <View style={{ flex: 2 }}><Btn title="Mentés" onPress={() => void save()} disabled={!form.name.trim()} /></View>
      </View>
    </Screen>
  );
}
