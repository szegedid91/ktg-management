import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, Input, Btn, Picker } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow } from '../../lib/repo';
import { AmountVat, initialVatState, vatStateToAmounts, VatState } from '../../components/AmountVat';
import { todayISO, addDaysISO } from '../../lib/format';
import { Site, AppSettings } from '../../lib/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function NewInvoice() {
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const settings = useTable<AppSettings>('app_settings')[0];
  const payDays = settings ? Number(settings.default_payment_days) || 8 : 8;

  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [date, setDate] = useState(todayISO());
  const [invoicedAt, setInvoicedAt] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDaysISO(todayISO(), 8));
  // amíg kézzel nem írták át, a határidő követi a számlázás dátumát + alapértelmezett napokat
  const [dueTouched, setDueTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [vat, setVat] = useState<VatState>(initialVatState(settings ? Number(settings.default_vat_rate) : 27));
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!dueTouched && ISO_DATE.test(invoicedAt)) setDueDate(addDaysISO(invoicedAt, payDays));
  }, [invoicedAt, payDays, dueTouched]);

  const save = () => {
    if (!site) return;
    const a = vatStateToAmounts(vat);
    insertRow('invoices', {
      site_id: site,
      invoice_date: date,
      invoiced_at: invoicedAt || null,
      due_date: ISO_DATE.test(dueDate) ? dueDate : null,
      title: title.trim() || null,
      net_amount: a.net,
      vat_rate: a.vatRate,
      vat_amount: a.vat,
      gross_amount: a.gross,
      note: note.trim() || null,
    });
    smartBack();
  };

  return (
    <Screen>
      <Card>
        <Picker label="Építkezés *" items={sites} selectedId={site} getId={(s) => s.id} getLabel={(s) => s.name} onSelect={setSite} />
        <Input label="Megnevezés" value={title} onChangeText={setTitle} placeholder="pl. 1. részszámla" />
        <Input label="Teljesítés dátuma (ÉÉÉÉ-HH-NN)" value={date} onChangeText={setDate} />
        <Input label="Számlázva dátum (ÉÉÉÉ-HH-NN)" value={invoicedAt} onChangeText={setInvoicedAt} />
        <Input
          label={`Fizetési határidő (ÉÉÉÉ-HH-NN) — alapból ${payDays} nap`}
          value={dueDate}
          onChangeText={(v) => { setDueTouched(true); setDueDate(v); }}
        />
        <AmountVat value={vat} onChange={setVat} />
        <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline />
        <Btn title="Mentés" onPress={save} disabled={!site} />
      </Card>
    </Screen>
  );
}
