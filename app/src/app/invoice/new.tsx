import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, Input, Btn, Picker } from '../../ui/kit';
import { useTable } from '../../lib/hooks';
import { insertRow } from '../../lib/repo';
import { AmountVat, initialVatState, vatStateToAmounts, VatState } from '../../components/AmountVat';
import { todayISO } from '../../lib/format';
import { Site, AppSettings } from '../../lib/types';

export default function NewInvoice() {
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const settings = useTable<AppSettings>('app_settings')[0];

  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [date, setDate] = useState(todayISO());
  const [invoicedAt, setInvoicedAt] = useState(todayISO());
  const [title, setTitle] = useState('');
  const [vat, setVat] = useState<VatState>(initialVatState(settings ? Number(settings.default_vat_rate) : 27));
  const [note, setNote] = useState('');

  const save = () => {
    if (!site) return;
    const a = vatStateToAmounts(vat);
    insertRow('invoices', {
      site_id: site,
      invoice_date: date,
      invoiced_at: invoicedAt || null,
      title: title.trim() || null,
      net_amount: a.net,
      vat_rate: a.vatRate,
      vat_amount: a.vat,
      gross_amount: a.gross,
      note: note.trim() || null,
    });
    router.back();
  };

  return (
    <Screen>
      <Card>
        <Picker label="Építkezés *" items={sites} selectedId={site} getId={(s) => s.id} getLabel={(s) => s.name} onSelect={setSite} />
        <Input label="Megnevezés" value={title} onChangeText={setTitle} placeholder="pl. 1. részszámla" />
        <Input label="Teljesítés dátuma (ÉÉÉÉ-HH-NN)" value={date} onChangeText={setDate} />
        <Input label="Számlázva dátum (ÉÉÉÉ-HH-NN)" value={invoicedAt} onChangeText={setInvoicedAt} />
        <AmountVat value={vat} onChange={setVat} />
        <Input label="Megjegyzés" value={note} onChangeText={setNote} multiline />
        <Btn title="Mentés" onPress={save} disabled={!site} />
      </Card>
    </Screen>
  );
}
