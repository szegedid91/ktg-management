// Közös (területhez nem kötött) költségek listája — ezek eddig csak az
// összegekben látszottak, tételesen sehol.

import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Row, Body, Sub, Money, Empty, Card } from '../../ui/kit';
import { useTable, useIsWorker } from '../../lib/hooks';
import { ft, hd } from '../../lib/format';
import { Expense, ExpenseCategory, Profile } from '../../lib/types';

function CommonExpensesInner() {
  const expenses = useTable<Expense>('expenses').filter((e) => !e.site_id);
  // törölt kategória neve is kelljen a régi tételekhez
  const categories = useTable<ExpenseCategory>('expense_categories', true);
  const profiles = useTable<Profile>('profiles');

  const sorted = [...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  const total = sorted.reduce((s, e) => s + Number(e.net_amount), 0);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name;

  return (
    <Screen>
      <Card>
        <Sub>Területhez nem kötött költségek (pl. üzemanyag, közös szerszám) — minden építkezéstől függetlenül számítanak az elszámolásba.</Sub>
        <Body style={{ fontWeight: '800' }}>Összesen: {ft(total)} (nettó)</Body>
      </Card>
      {sorted.length === 0 ? <Empty text="Nincs közös költség." /> : null}
      {sorted.map((e) => (
        <Row key={e.id} onPress={() => router.push(`/expense/${e.id}`)}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600' }}>{e.title || catName(e.category_id) || 'Költség'}</Body>
            <Sub>
              {hd(e.expense_date)} · {catName(e.category_id) ?? 'nincs kategória'}
              {' · '}{profiles.find((p) => p.id === e.paid_by)?.display_name ?? '?'}
            </Sub>
          </View>
          <Money>{ft(e.net_amount)}</Money>
        </Row>
      ))}
    </Screen>
  );
}

/** Fő felhasználói oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function CommonExpenses() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <CommonExpensesInner />;
}
