// Az építkezés elérhetőségei (kapcsolattartók): több is megadható — név, telefon,
// e-mail, megjegyzés. A vezető írja; elérhetőségenként eldönti, hogy a
// munkavállaló is lássa-e. Hívás / e-mail egy gombnyomásra.

import React, { useState } from 'react';
import { View, Text, Linking, Platform } from 'react-native';
import { Card, H2, Sub, Input, Btn, Badge, Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow, softDeleteRow } from '../lib/repo';
import { notify, confirmDialog } from '../lib/dialogs';
import { SiteContact } from '../lib/types';

export type ContactDraft = { name: string; phone: string; email: string; note: string; visible: boolean };
export const emptyContact = (): ContactDraft => ({ name: '', phone: '', email: '', note: '', visible: true });
export const contactFilled = (d: ContactDraft) => !!(d.name.trim() || d.phone.trim() || d.email.trim());
const toRow = (d: ContactDraft) => ({
  name: d.name.trim() || null, phone: d.phone.trim() || null, email: d.email.trim() || null,
  note: d.note.trim() || null, visible_to_workers: d.visible,
});

/** Az építkezés élő elérhetőségei, a rögzítés sorrendjében. */
export function useSiteContacts(siteId: string | null | undefined): SiteContact[] {
  return useTable<SiteContact>('site_contacts')
    .filter((c) => c.site_id === siteId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

function open(url: string) {
  // tel: / mailto: — weben helyben (új lap nélkül), natívon a rendszer kezeli
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else void Linking.openURL(url).catch(() => {});
}
export const callPhone = (phone: string) => open(`tel:${phone.replace(/[^\d+]/g, '')}`);
export const sendMail = (email: string) => open(`mailto:${email.trim()}`);

/** Egy elérhetőség űrlapja (új építkezésnél és szerkesztésnél is ez megy). */
export function ContactFields({ value, onChange }: { value: ContactDraft; onChange: (d: ContactDraft) => void }) {
  return (
    <View style={{ gap: S.sm }}>
      <Input label="Név" value={value.name} onChangeText={(t) => onChange({ ...value, name: t })} placeholder="pl. Kovács Péter (üzletvezető)" />
      <Input label="Telefon" value={value.phone} onChangeText={(t) => onChange({ ...value, phone: t })} keyboardType="phone-pad" placeholder="pl. +36 30 123 4567" />
      <Input label="E-mail" value={value.email} onChangeText={(t) => onChange({ ...value, email: t })} keyboardType="email-address" autoCapitalize="none" placeholder="opcionális" />
      <Input label="Megjegyzés" value={value.note} onChangeText={(t) => onChange({ ...value, note: t })} placeholder="pl. 8–16 között hívható" />
      <Check checked={value.visible} onToggle={() => onChange({ ...value, visible: !value.visible })}
        label="A munkavállaló is látja" sub="Kikapcsolva csak a vezetők látják." />
    </View>
  );
}

/** Egy elérhetőség megjelenítve: név, megjegyzés, hívás / e-mail gomb. `big`: munkavállalói nézet (nagy gombok). */
export function ContactLine({ c, big = false, showVisibility = false, actions }: { c: SiteContact; big?: boolean; showVisibility?: boolean; actions?: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
          <Text style={{ fontWeight: '700', color: C.text, flexShrink: 1 }}>👤 {c.name || 'Elérhetőség'}</Text>
          {showVisibility && !c.visible_to_workers ? <Badge text="csak vezetők" color={C.sub} /> : null}
        </View>
        {actions}
      </View>
      {c.note ? <Sub>{c.note}</Sub> : null}
      {c.phone ? (big
        ? <Btn title={`📞 Hívás: ${c.phone}`} kind="secondary" onPress={() => callPhone(c.phone!)} />
        : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Sub style={{ flex: 1 }}>📞 {c.phone}</Sub>
            <Btn title="📞 Hívás" kind="ghost" small onPress={() => callPhone(c.phone!)} />
          </View>
        )) : null}
      {c.email ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Sub style={{ flex: 1 }}>✉️ {c.email}</Sub>
          <Btn title="✉️ E-mail" kind="ghost" small onPress={() => sendMail(c.email!)} />
        </View>
      ) : null}
    </View>
  );
}

/** Az építkezés adatlapján: lista + felvétel / szerkesztés / törlés (vezetőknek). */
export function SiteContactsCard({ siteId, editable }: { siteId: string; editable: boolean }) {
  const contacts = useSiteContacts(siteId);
  // null: nincs nyitott űrlap; id nélkül: új elérhetőség
  const [form, setForm] = useState<{ id: string | null; d: ContactDraft } | null>(null);

  const save = () => {
    if (!form) return;
    if (!contactFilled(form.d)) { notify('Hiányzó adat', 'Adj meg legalább nevet, telefonszámot vagy e-mail címet.'); return; }
    if (form.id) updateRow('site_contacts', form.id, toRow(form.d));
    else insertRow('site_contacts', { site_id: siteId, ...toRow(form.d), position: contacts.reduce((m, c) => Math.max(m, c.position), 0) + 1 });
    setForm(null);
  };
  const remove = async (c: SiteContact) => {
    if (!await confirmDialog('Elérhetőség törlése', `Biztos törlöd: ${c.name || c.phone || c.email}?`, 'Törlés')) return;
    softDeleteRow('site_contacts', c.id);
  };

  if (!editable && contacts.length === 0) return null;
  return (
    <Card style={{ gap: S.sm }}>
      <H2>📞 Elérhetőségek{contacts.length ? ` (${contacts.length})` : ''}</H2>
      {contacts.length === 0 && !form ? <Sub>Még nincs megadva elérhetőség (pl. megrendelő, helyszíni kapcsolattartó).</Sub> : null}
      {contacts.map((c) => (form?.id === c.id ? null : (
        <View key={c.id} style={{ gap: 4, paddingBottom: S.sm, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <ContactLine c={c} showVisibility actions={editable ? (
            <>
              <Btn title="✏️" kind="ghost" small onPress={() => setForm({ id: c.id, d: { name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', note: c.note ?? '', visible: c.visible_to_workers } })} />
              <Btn title="🗑️" kind="ghost" small onPress={() => void remove(c)} />
            </>
          ) : undefined} />
        </View>
      )))}
      {form ? (
        <View style={{ gap: S.sm }}>
          <Text style={{ fontWeight: '700', color: C.text }}>{form.id ? 'Elérhetőség szerkesztése' : 'Új elérhetőség'}</Text>
          <ContactFields value={form.d} onChange={(d) => setForm({ ...form, d })} />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setForm(null)} /></View>
            <View style={{ flex: 1 }}><Btn title="Mentés" onPress={save} disabled={!contactFilled(form.d)} /></View>
          </View>
        </View>
      ) : editable ? (
        <Btn title="+ Elérhetőség hozzáadása" kind="secondary" small onPress={() => setForm({ id: null, d: emptyContact() })} />
      ) : null}
    </Card>
  );
}

/** Új építkezés létrehozása után: a megadott (nem üres) elérhetőségek rögzítése. */
export function insertContacts(siteId: string, drafts: ContactDraft[]): void {
  drafts.filter(contactFilled).forEach((d, i) => insertRow('site_contacts', { site_id: siteId, ...toRow(d), position: i + 1 }));
}
