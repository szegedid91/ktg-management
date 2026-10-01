import { useIsWorker } from '../../lib/hooks';
import React, { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Screen, Card, Input, Btn, Empty, H2, Sub, Divider } from '../../ui/kit';
import { S } from '../../ui/theme';
import { insertRow } from '../../lib/repo';
import { ContactDraft, ContactFields, emptyContact, insertContacts } from '../../components/SiteContacts';

function NewSiteInner() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  // elérhetőségek (kapcsolattartók): több is megadható, az üresen hagyott nem kerül rögzítésre
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);

  const save = () => {
    if (!name.trim()) return;
    const id = insertRow('sites', {
      name: name.trim(),
      address: address.trim() || null,
      note: note.trim() || null,
      status: 'active',
    });
    insertContacts(id, contacts);
    router.replace(`/site/${id}`);
  };

  return (
    <Screen>
      <Card>
        <Input label="Név *" value={name} onChangeText={setName} placeholder="pl. Újlak utca" />
        <Input label="Cím" value={address} onChangeText={setAddress} placeholder="opcionális" />
        <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline placeholder="opcionális" />
      </Card>
      <Card style={{ gap: S.sm }}>
        <H2>📞 Elérhetőség</H2>
        <Sub>Opcionális — pl. megrendelő, helyszíni kapcsolattartó. Több is megadható, később is bővíthető.</Sub>
        {contacts.map((c, i) => (
          <View key={i} style={{ gap: S.sm }}>
            {i > 0 ? <Divider /> : null}
            <ContactFields value={c} onChange={(d) => setContacts(contacts.map((x, j) => (j === i ? d : x)))} />
            {contacts.length > 1 ? <Btn title="🗑️ Ez az elérhetőség nem kell" kind="ghost" small onPress={() => setContacts(contacts.filter((_, j) => j !== i))} /> : null}
          </View>
        ))}
        <Btn title="+ Még egy elérhetőség" kind="secondary" small onPress={() => setContacts([...contacts, emptyContact()])} />
      </Card>
      <Btn title="Létrehozás" onPress={save} disabled={!name.trim()} />
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function NewSite() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <NewSiteInner />;
}
