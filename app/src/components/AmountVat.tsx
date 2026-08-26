// Nettó / ÁFA-kulcs / bruttó beviteli blokk — bármelyik kettőből számolja
// a harmadikat (calc.ts, a DB-vel egyező kerekítéssel)

import React from 'react';
import { View } from 'react-native';
import { Input, Segmented, Sub } from '../ui/kit';
import { S } from '../ui/theme';
import { fromNet, fromGross } from '../lib/calc';
import { ft, parseAmount } from '../lib/format';

export interface VatState {
  net: string;
  vatRate: number;
  gross: string;
  lastEdited: 'net' | 'gross';
}

export function vatStateToAmounts(v: VatState) {
  const rate = v.vatRate;
  if (v.lastEdited === 'net') return fromNet(parseAmount(v.net), rate);
  return fromGross(parseAmount(v.gross), rate);
}

export function AmountVat({ value, onChange, defaultVatRate }: {
  value: VatState;
  onChange: (v: VatState) => void;
  defaultVatRate?: number;
}) {
  const amounts = vatStateToAmounts(value);

  const setNet = (net: string) => {
    const a = fromNet(parseAmount(net), value.vatRate);
    onChange({ ...value, net, gross: a.gross ? String(a.gross) : '', lastEdited: 'net' });
  };
  const setGross = (gross: string) => {
    const a = fromGross(parseAmount(gross), value.vatRate);
    onChange({ ...value, gross, net: a.net ? String(a.net) : '', lastEdited: 'gross' });
  };
  const setRate = (r: string) => {
    const rate = Number(r);
    const next = { ...value, vatRate: rate };
    if (value.lastEdited === 'net') {
      const a = fromNet(parseAmount(value.net), rate);
      next.gross = a.gross ? String(a.gross) : '';
    } else {
      const a = fromGross(parseAmount(value.gross), rate);
      next.net = a.net ? String(a.net) : '';
    }
    onChange(next);
  };

  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}>
          <Input label="Nettó (Ft)" value={value.net} onChangeText={setNet} keyboardType="numeric" placeholder="0" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Bruttó (Ft)" value={value.gross} onChangeText={setGross} keyboardType="numeric" placeholder="0" />
        </View>
      </View>
      <Segmented
        label="ÁFA-kulcs"
        options={[
          { value: '0', label: '0%' },
          { value: '5', label: '5%' },
          { value: '18', label: '18%' },
          { value: '27', label: '27%' },
        ]}
        value={String(value.vatRate) as any}
        onChange={setRate as any}
      />
      <Sub>ÁFA összege: {ft(amounts.vat)}</Sub>
    </View>
  );
}

export function initialVatState(vatRate = 27): VatState {
  return { net: '', gross: '', vatRate, lastEdited: 'net' };
}
