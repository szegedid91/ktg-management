// Pénzösszeg felismerése szabad szövegben („kb 100000ft”, „25 ezer”, „12.500,-”, „80e”) — arra, hogy
// figyelmeztessünk, ha valaki megjegyzésbe írja az anyag árát ahelyett, hogy anyagköltségként rögzítené.
// Szándékosan óvatos: csak pénznemmel (Ft, forint, HUF, „,-”) vagy ezres jelöléssel (ezer, e, k, millió)
// álló számot tekint összegnek — a „300as üst”, „2 db”, „3 kg”, „12:30” nem az.

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
    if (lower === 'millió') n *= 1_000_000;
    else if (lower) n *= 1000;
    n = Math.round(n);
    // néhány forintos „összeg” jellemzően nem ár (pl. „2 e” elírás) — 100 Ft alatt nem szólunk
    if (n >= 100 && n <= 100_000_000) return n;
  }
  return null;
}
