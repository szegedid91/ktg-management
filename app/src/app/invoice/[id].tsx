import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Screen, Card, Sub, Btn, KV, Empty, Check, Body } from '../../ui/kit';
import { S } from '../../ui/theme';
import { useRow, useTable } from '../../lib/hooks';
import { getCurrentUserId, softDeleteRow, markInvoicePaid } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { Invoice, Site, Profile } from '../../lib/types';
import { Comments } from '../../components/Comments';
import { notify, confirmDialog } from '../../lib/dialogs';

export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useRow<Invoice>('invoices', id);
  const sites = useTable<Site>('sites');
  const profiles = useTable<Profile>('profiles');
  const me = getCurrentUserId();

  if (!invoice) return <Screen><Empty text="Számla nem található." /></Screen>;
  const mine = invoice.created_by === me;

  return (
    <Screen>
      <Stack.Screen options={{ title: invoice.title || 'Számla' }} />
      <Card>
        <KV k="Építkezés" v={sites.find((s) => s.id === invoice.site_id)?.name ?? '?'} />
        <KV k="Teljesítés" v={hd(invoice.invoice_date)} />
        <KV k="Számlázva" v={invoice.invoiced_at ? hd(invoice.invoiced_at) : '—'} />
        <KV k="Nettó" v={ft(invoice.net_amount)} strong />
        <KV k={`ÁFA (${invoice.vat_rate}%)`} v={ft(invoice.vat_amount)} />
        <KV k="Bruttó" v={ft(invoice.gross_amount)} />
        <KV k="Kiállította" v={profiles.find((p) => p.id === invoice.created_by)?.display_name ?? '?'} />
        {invoice.note ? <><Sub>Megjegyzés</Sub><Body>{invoice.note}</Body></> : null}
      </Card>

      <Card>
        <Check
          checked={!!invoice.paid_at}
          onToggle={() => markInvoicePaid(invoice.id, !invoice.paid_at)}
          label={invoice.paid_at ? `Befolyt: ${hd(invoice.paid_at)}` : 'Befolyt — jelölés'}
          sub={invoice.paid_at && invoice.paid_marked_by
            ? `Jelölte: ${profiles.find((p) => p.id === invoice.paid_marked_by)?.display_name ?? '?'}`
            : 'A bevételi kimutatás csak a befolyt összegekkel számol.'}
        />
      </Card>

      {mine ? (
        <Btn title="Számla törlése" kind="danger" onPress={() => {
          void confirmDialog('Törlés', 'Biztosan törlöd ezt a számlát?', 'Törlés', true).then((ok) => {
            if (ok) { softDeleteRow('invoices', invoice.id); router.back(); }
          });
        }} />
      ) : null}

      <Comments entityType="invoice" entityId={invoice.id} />
    </Screen>
  );
}
