// Build utáni lépés: PWA meta-adatok beszúrása a dist/index.html-be.
// (Az app.json "output":"single" módja nem használja a +html.tsx sablont.)
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../dist/index.html', import.meta.url).pathname;
let html = readFileSync(path, 'utf8');

html = html.replace('<html lang="en">', '<html lang="hu">');
html = html.replace('shrink-to-fit=no', 'shrink-to-fit=no, viewport-fit=cover');

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
      /* PWA: a kivágás (notch) mögötti sáv a fejléc színét kapja */
      html, body { background-color: #1F4E5F; }
      body { padding-top: env(safe-area-inset-top); box-sizing: border-box; }
    </style>
  </head>`;
html = html.replace('</head>', head);

writeFileSync(path, html);
console.log('PWA meta beszúrva:', path);
