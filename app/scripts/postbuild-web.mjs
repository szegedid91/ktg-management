// Build utáni lépés: PWA meta-adatok beszúrása a dist/index.html-be.
// (Az app.json "output":"single" módja nem használja a +html.tsx sablont.)
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../dist/index.html', import.meta.url).pathname;
let html = readFileSync(path, 'utf8');

html = html.replace('<html lang="en">', '<html lang="hu">');
// zoom-tiltás (app-szerű viselkedés) + notch-kezelés
html = html.replace(
  'shrink-to-fit=no',
  'maximum-scale=1, user-scalable=no, shrink-to-fit=no, viewport-fit=cover',
);

const head = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#1F4E5F" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Költségkövető" />
    <style>
      /* PWA: a kivágás (notch) mögötti sáv a fejléc színét kapja.
         Felső padding NINCS — a fejléc (safe-area-context) maga kezeli
         az insetet, a body-padding duplázná. */
      html, body { background-color: #1F4E5F; }
      /* iOS 26 (üveg-hatású státuszsáv): a rendszer a lap TETEJÉN lévő rögzített
         elem (vagy a body) színéből színezi a státuszsávot. A fejlécünk nem
         rögzített elem, ezért a mintavétel időnként a világos oldalhátteret
         találta el (homályos, szürkés sáv). Ez a valódi, rögzített sáv a lap
         tetején mindig a fejléc színét adja: a kivágás magassága + 6 px (a
         fejléc felső, üres részét fedi, a tartalmat nem takarja). A színt a
         témaváltás a --ktg-header változón át frissíti. */
      html, body { background-color: var(--ktg-header, #1F4E5F); }
      #ktg-topbar { position: fixed; top: 0; left: 0; right: 0;
        height: calc(env(safe-area-inset-top, 0px) + 6px);
        background-color: var(--ktg-header, #1F4E5F);
        z-index: 2147483000; pointer-events: none; }
      /* a böngésző saját lehúzás-frissítése és gumiszalag-effektje ne
         ütközzön az app beépített lehúzásos frissítésével */
      html, body { overscroll-behavior-y: none; }
    </style>
  </head>`;
html = html.replace('</head>', head);
// valódi DOM-elem (nem pszeudo-elem): a WebKit a rögzített elemek színét mintázza
html = html.replace(/<body([^>]*)>/, '<body$1><div id="ktg-topbar" aria-hidden="true"></div>');
if (!html.includes('id="ktg-topbar"')) throw new Error('ktg-topbar beszúrása nem sikerült');

writeFileSync(path, html);

// verziófájl az automatikus frissítéshez: a futó app ezt kérdezi le, és ha újabb van kint, újratölt
const versionSrc = readFileSync(new URL('../src/lib/version.ts', import.meta.url).pathname, 'utf8');
const version = (versionSrc.match(/APP_VERSION = '([^']+)'/) ?? [])[1] ?? '';
writeFileSync(new URL('../dist/version.json', import.meta.url).pathname, JSON.stringify({ version }));
console.log('PWA meta beszúrva:', path);
