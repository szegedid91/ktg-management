// Pénzösszeg felismerése szabad szövegben („kb 100000ft”, „25 ezer”, „12.500,-”, „80e”) — arra, hogy
// figyelmeztessünk, ha valaki megjegyzésbe írja az anyag árát ahelyett, hogy anyagköltségként rögzítené.
// Szándékosan óvatos: a pénznemmel (Ft, forint, HUF, „,-”) vagy ezres jelöléssel (ezer, e, k, millió) álló
// számot, illetve a pénznem nélküli KEREK, legalább négyjegyű számot („250000 faanyag”) tekinti összegnek —
// a „300as üst”, „2 db”, „3 kg”, „12:30”, telefonszám, évszám, „1500 mm” nem az.

const RE = /(\d{1,3}(?:[ . ]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(millió|ezer|e(?![a-záéíóöőúüű])|k(?![a-záéíóöőúüű]))?\s*(ft(?![a-záéíóöőúüű])|forint|huf(?![a-záéíóöőúüű])|,-|\.-)?/gi;

/** A szövegben talált első pénzösszeg forintban; ha nincs benne összeg, null. */
export function moneyInText(text: string | null | undefined): number | null {
  if (!text) return null;
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    if (m[0] === '') { RE.lastIndex++; continue; }
    const mult = m[3], cur = m[4];
    if (!mult && !cur) continue; // puszta szám: nem tudjuk, hogy pénz-e
    let n = Number(m[1].replace(/[ . ]/g, ''));
    if (m[2]) n += Number(`0.${m[2]}`);
    const lower = (mult ?? '').toLowerCase();
    // az „e” / „k” rövidítés csak három számjegyig ezres jel („100k”, „80e”) — a „3000K” színhőmérséklet, nem pénz
    if ((lower === 'k' || lower === 'e') && n >= 1000 && !cur) continue;
    if (lower === 'millió') n *= 1_000_000;
    else if (lower) n *= 1000;
    n = Math.round(n);
    // néhány forintos „összeg” jellemzően nem ár (pl. „2 e” elírás) — 100 Ft alatt nem szólunk
    if (n >= 100 && n <= 100_000_000) return n;
  }
  return bareAmount(text);
}

const LETTER = /^[a-záéíóöőúüű°%]/i;
const UNIT_AFTER = /^\s*(mm|cm|m|km|kg|g|db|w|kw|v|a|l|liter|méter|fok|bar|x|óra|perc|nap)(?![a-záéíóöőúüű])/i;

/** Pénznem nélküli szám („250000 faanyag”, „250 000 lett”): csak a kerek (százasra végződő), 1 000 és
 *  9 999 999 közti számot vesszük összegnek, ha nem évszám, nem számsor része (telefonszám, dátum, kód),
 *  és nem áll mögötte mértékegység vagy rag („1500 mm”, „3000K”, „1000es”). */
function bareAmount(text: string): number | null {
  const re = /\d{1,3}(?:[ \u00a0.]\d{3})+|\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 7) continue;
    const n = Number(digits);
    if (n % 100 !== 0 || (n >= 1900 && n <= 2100)) continue;
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    if (/\d[ .\u00a0:/-]?$/.test(before)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (LETTER.test(after) || /^[ .\u00a0:/-]?\d/.test(after) || UNIT_AFTER.test(after)) continue;
    return n;
  }
  return null;
}

/** A megjegyzésekben szereplő összegek közül az első, amelyet a rögzített anyagköltségek nem fednek le
 *  (egyik tétel és a tételek összege sincs a ±20%-os közelében); ha mind le van fedve, null. */
export function uncoveredAmount(texts: (string | null | undefined)[], materialAmounts: number[]): number | null {
  const total = materialAmounts.reduce((a, b) => a + b, 0);
  const near = (x: number, y: number) => y > 0 && Math.abs(x - y) <= 0.2 * x;
  for (const t of texts) {
    const n = moneyInText(t);
    if (n == null) continue;
    if (materialAmounts.some((a) => near(n, a)) || near(n, total)) continue;
    return n;
  }
  return null;
}
