import React, { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Card, Input, Btn } from '../../ui/kit';
import { insertRow } from '../../lib/repo';

export default function NewSite() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');

  const save = () => {
    if (!name.trim()) return;
    const id = insertRow('sites', {
      name: name.trim(),
      address: address.trim() || null,
      note: note.trim() || null,
      status: 'active',
    });
    router.replace(`/site/${id}`);
  };

  return (
    <Screen>
      <Card>
        <Input label="Név *" value={name} onChangeText={setName} placeholder="pl. Újlak utca" />
        <Input label="Cím" value={address} onChangeText={setAddress} placeholder="opcionális" />
        <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline placeholder="opcionális" />
        <Btn title="Létrehozás" onPress={save} disabled={!name.trim()} />
      </Card>
    </Screen>
  );
}
