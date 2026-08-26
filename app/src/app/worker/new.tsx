import React, { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Btn } from '../../ui/kit';
import { WorkerForm, emptyWorkerForm, formToRow } from '../../components/WorkerForm';
import { insertRow, callRpc } from '../../lib/repo';
import { notify, confirmDialog } from '../../lib/dialogs';

export default function NewWorker() {
  const [form, setForm] = useState(emptyWorkerForm());

  const save = async () => {
    if (!form.name.trim()) return;
    const id = insertRow('workers', formToRow(form));
    if (form.bank_account.trim()) {
      try {
        await callRpc('set_worker_bank_account', { p_worker: id, p_account: form.bank_account.trim() });
      } catch {
        notify('Figyelem', 'A bankszámlaszám mentéséhez internet kell — most nem sikerült, add meg később újra.');
      }
    }
    router.replace(`/worker/${id}`);
  };

  return (
    <Screen>
      <WorkerForm value={form} onChange={setForm} />
      <Btn title="Mentés" onPress={() => void save()} disabled={!form.name.trim()} />
    </Screen>
  );
}
