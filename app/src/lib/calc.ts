// ÁFA-számítás: nettó / ÁFA / bruttó — bármelyik kettőből a harmadik.
// A profit-számítás mindig NETTÓ alapon történik (DB-oldali view-k),
// itt csak a beviteli űrlapok kiegészítő számítása él.

export interface VatAmounts {
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
}

export function fromNet(net: number, vatRate: number): VatAmounts {
  const vat = round2(net * vatRate / 100);
  return { net: round2(net), vatRate, vat, gross: round2(net + vat) };
}

export function fromGross(gross: number, vatRate: number): VatAmounts {
  const net = round2(gross / (1 + vatRate / 100));
  return { net, vatRate, vat: round2(gross - net), gross: round2(gross) };
}

export function fromNetAndGross(net: number, gross: number): VatAmounts {
  const vat = round2(gross - net);
  const vatRate = net !== 0 ? round2(vat / net * 100) : 0;
  return { net: round2(net), vatRate, vat, gross: round2(gross) };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Jelenléti tétel bérköltsége — a DB triggerrel azonos logika, optimista előnézethez */
export function attendanceAmount(
  payBasis: 'hourly' | 'daily' | 'project' | 'presence',
  appliedRate: number,
  hours: number | null,
  dayMultiplier: number,
): number {
  switch (payBasis) {
    case 'hourly': return round2(appliedRate * (hours ?? 0));
    case 'daily': return round2(appliedRate * dayMultiplier);
    case 'project': return round2(appliedRate);
    default: return 0;
  }
}

/** Közvetítői díj — a bérköltség RÉSZE (osztódik, nem adódik hozzá) */
export function commissionAmount(
  amount: number,
  mode: 'percent' | 'fixed' | null,
  value: number | null,
  unit: 'hour' | 'day' | 'project' | null,
  payBasis: 'hourly' | 'daily' | 'project' | 'presence',
  hours: number | null,
  dayMultiplier: number,
): number {
  if (!mode || payBasis === 'presence') return 0;
  let c = 0;
  if (mode === 'percent') {
    c = round2(amount * (value ?? 0) / 100);
  } else {
    switch (unit) {
      case 'hour': c = round2((value ?? 0) * (hours ?? 0)); break;
      case 'day': c = round2((value ?? 0) * dayMultiplier); break;
      case 'project': c = payBasis === 'project' ? (value ?? 0) : 0; break;
    }
  }
  return Math.min(c, amount);
}
