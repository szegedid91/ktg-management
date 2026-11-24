// Magyar formázási segédfüggvények — pénz, dátum

/** 1250000 -> "1 250 000 Ft" (ezres tagolás szóközzel) */
export function ft(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '– Ft';
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} Ft`;
}

/** Helyi naptári nap (ÉÉÉÉ-HH-NN) egy időbélyegből — a szerver is Budapest szerint napol */
export function localDateISO(ts: string | Date = new Date()): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-08-26", timestamptz vagy Date -> "2026.08.26." (időbélyegnél helyi nap) */
export function hd(date: string | Date | null | undefined): string {
  if (!date) return '–';
  const d = typeof date === 'string' ? (date.length > 10 ? new Date(date) : new Date(date.slice(0, 10) + 'T00:00:00')) : date;
  if (isNaN(d.getTime())) return '–';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}.`;
}

/** timestamptz -> "2026.08.26. 14:35" */
export function hdt(ts: string | null | undefined): string {
  if (!ts) return '–';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '–';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hd(d)} ${hh}:${mm}`;
}

/** ISO-hét (hétfőtől vasárnapig; az év első hete az, amelyikben az első csütörtök van) — a hét sorszáma és a
 *  hét éve (ami december végén / január elején eltérhet a naptári évtől). */
export function isoWeek(iso: string): { year: number; week: number } {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  // a hét csütörtökjére ugrunk: az dönti el, melyik évhez tartozik a hét
  d.setUTCDate(d.getUTCDate() + 4 - ((d.getUTCDay() + 6) % 7 + 1));
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  return { year, week: Math.ceil(((d.getTime() - jan1) / 86400000 + 1) / 7) };
}

/** Egy időszak hete / hetei, kiírva: „47. hét”, „46–47. hét”, évfordulón „2026/53 – 2027/1. hét”. */
export function weekRangeLabel(from: string, to: string): string {
  const a = from ? isoWeek(from) : null, b = isoWeek(to);
  if (!a) return `${b.week}. hétig`;
  if (a.year === b.year && a.week === b.week) return `${a.week}. hét`;
  if (a.year === b.year) return `${a.week}–${b.week}. hét`;
  return `${a.year}/${a.week} – ${b.year}/${b.week}. hét`;
}

/** Mai nap ISO formában (lokális idő szerint): "2026-08-26" */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const DAYS_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

export function monthName(m: number): string {
  return MONTHS[m] ?? '';
}

export function dayShort(dow: number): string {
  return DAYS_SHORT[dow] ?? '';
}

/** Szám-input értelmezése: szóköz, Ft, ezres tagolás (1.250.000 / 1,250,000)
 *  és tizedesvessző kezelése. A pontozott ezres tagolást NEM szabad
 *  tizedesnek nézni (különben 1.250.000-ből 1,25 Ft lenne). */
export function parseAmount(input: string): number {
  if (!input) return 0;
  let s = String(input).replace(/\s+/g, '').replace(/[^\d.,-]/g, '');
  if (s.indexOf('-') > 0) return 0; // belső kötőjel (pl. „10-20”): nem szám
  if (/^-?[1-9]\d{0,2}([.,]\d{3})+$/.test(s)) {
    // tiszta ezres tagolás: minden elválasztó törlendő
    s = s.replace(/[.,]/g, '');
  } else {
    // az utolsó , vagy . a tizedesjel, a korábbiak ezres elválasztók
    const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    if (lastSep >= 0) {
      const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
      const frac = s.slice(lastSep + 1).replace(/[.,]/g, '');
      s = `${intPart}.${frac}`;
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
