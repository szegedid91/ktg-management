# Építkezés Költségkövető

Építkezés-költségkövető és partneri elszámoló alkalmazás két (vagy több)
üzlettársnak: közös költségek, bérek, kimenő számlák, közvetítői díjak,
egyenlegek és rendezések — weben, iOS-en és Androidon, egy kódbázisból.

## Felépítés

| Réteg | Technológia |
|---|---|
| App (web + iOS + Android) | Expo (React Native) + Expo Router — `app/` |
| Backend | Supabase: Postgres + Auth + RLS + Storage + Edge Functions + Realtime — `supabase/` |
| AI blokk-kiolvasás | `receipt-ocr` edge function (Anthropic API, Claude vision) |
| Export | `export-data` edge function (xlsx + PDF) |
| Push | `push-dispatch` edge function (Expo Push API) + DB-triggeres értesítési sor |

### Kulcsdöntések

- **Offline-first**: minden írás először a lokális tükörbe és az outboxba
  kerül (AsyncStorage), majd szinkronizál, amikor van net. Konfliktus:
  last-write-wins, de a Postgres-oldali audit trigger **minden** verziót
  megőriz, így semmi nem vész el.
- **Minden számítás DB-oldali** (view-k + függvények): egyenlegek,
  javasolt rendezés, napi költség, statisztika — a web és a mobil
  garantáltan ugyanazt mutatja. Profit mindig **nettó** alapon, az ÁFA
  külön oszlop.
- **Díj-pillanatkép**: a jelenléti tétel rögzítéskor elmenti az
  alkalmazott díjat és a közvetítői részt — a későbbi díjmódosítás nem
  írja át a múltat.
- **Közvetítői díj a bérből osztódik** (nem adódik hozzá): 40 000 Ft
  napi díj + 10 000 Ft közvetítői = az építkezés költsége 40 000,
  ebből 30 000 a munkásé, 10 000 a közvetítőé.
- **Jogosultság az adatbázisban**: olvasás minden bejelentkezettnek,
  írás/törlés csak a rekord létrehozójának (RLS). Kifizetés-pipák
  security definer RPC-vel (bárki fizethet — a pipa rögzíti, ki és mikor).
- **Bankszámlaszám titkosítva** (pgcrypto + Vault-kulcs), csak RPC-n át
  olvasható. Számlafotók privát bucketben, signed URL-lel.

## Fejlesztés (lokális)

Előfeltétel: Node 22+, Docker Desktop, Supabase CLI.

```bash
# 1. Lokális Supabase (Postgres, Auth, Storage, Edge runtime)
supabase start
supabase db reset        # migrációk + alapadatok

# 2. App
cd app
npm install
npm run web              # vagy: npm run ios / npm run android
```

Az `app/.env` alapból a lokális Supabase-re mutat
(`http://127.0.0.1:54321` + a CLI által kiírt publishable key).

### Demo adatok

A `supabase/seed_demo.sql` négy hónapnyi életszerű adatot tölt be
(3 építkezés — az egyik lezárva —, 15 munkavállaló, ~400 jelenléti nap,
vegyes költségek mindkét felhasználótól, havi számlák, rendezés).
Előbb lépj be egyszer mindkét tesztfiókkal (Dani/Anna gomb), majd:

```bash
docker exec -i $(docker ps --format '{{.Names}}' | grep supabase_db) \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seed_demo.sql
```

### Tesztek

```bash
# Számítási logika (egyenlegek, közvetítői osztás, checklist, audit) — SQL
docker exec -i $(docker ps --format '{{.Names}}' | grep supabase_db) \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/calc_test.sql

# Kliens-oldali ÁFA/bér-számítás és formázás — vitest
cd app && npm test

# Típusellenőrzés
cd app && npm run typecheck
```

## Élő telepítés (2026.08.26.)

| | |
|---|---|
| Web | **https://ktg.szakify.hu** (GitHub Pages, `szegedid91/ktg-management` repo `gh-pages` ága) |
| Backend | Supabase `ktg-management` (`sswzkwrcgagdabeywprw`, eu-central-1) — migrációk + 3 edge function fent |
| DNS | dns24.hu: `ktg` CNAME → `szegedid91.github.io` |

Új verzió kirakása:
```bash
cd app && rm -rf dist && npx expo export --platform web --clear
cp dist/index.html dist/404.html && echo "ktg.szakify.hu" > dist/CNAME
cd dist && git init -b gh-pages && git add -A && git commit -m deploy \
  && git push --force https://github.com/szegedid91/ktg-management.git gh-pages
```
(A cloud URL/kulcs az `app/.env.production`-ből megy a buildbe.)

Függőben lévő kézi teendők a Supabase dashboardon:
- `ANTHROPIC_API_KEY` secret (Edge Functions → Secrets) az AI blokk-kiolvasáshoz
- Email-megerősítés kikapcsolása, ha nem kell (Authentication → Sign In/Up)
- Cron a push-dispatchhez (lásd lent)

## Éles üzembe helyezés

1. **Supabase projekt**: hozz létre egy projektet (supabase.com), majd:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push                          # migrációk
   supabase functions deploy receipt-ocr export-data push-dispatch
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
2. **App konfiguráció**: `app/.env`-ben állítsd be az éles URL-t és
   publishable kulcsot (`EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
3. **Web**: `cd app && npx expo export --platform web` → a `dist/`
   mappa bármely statikus hostingra kitehető (Netlify, Vercel,
   Cloudflare Pages).
4. **iOS/Android**: EAS build (`npx eas build`) — a push értesítésekhez
   EAS projekt szükséges (Expo Go-ban a távoli push nem megy).
5. **Ütemezett értesítések** (heti összefoglaló, lejárt tételek):
   a Supabase dashboardon (Integrations → Cron) ütemezd a
   `push-dispatch` functiont:
   - `{"job":"digest"}` — péntek 16:00 (`0 15 * * 5` UTC)
   - `{"job":"overdue"}` — naponta reggel (`0 6 * * *`)
   - `{"job":"drain"}` — 5 percenként (a sync utáni app-oldali hívás
     mellett biztonsági hálónak)

## Könyvtárszerkezet

```
app/
  src/app/          # Expo Router képernyők (magyar UI)
  src/components/   # Kommentek (realtime), ÁFA-blokk, munkavállaló-űrlap
  src/lib/          # supabase, store (offline tükör+outbox), sync, repo,
                    # hooks, calc (ÁFA/bér), format (Ft, dátum), push
  src/ui/           # téma + UI-készlet
supabase/
  migrations/       # 9 verzionált migráció (séma, audit, RLS, RPC-k,
                    # view-k, storage, értesítések, grantok)
  functions/        # receipt-ocr, export-data, push-dispatch
  tests/            # calc_test.sql — a kritikus számítási logika tesztjei
```

## Ismert korlátok / következő lépések

- Számlafotó-feltöltéshez internet kell (offline rögzített költséghez
  a fotó később pótolható).
- A bankszámlaszám mentése/olvasása és a lezárás/újranyitás online
  művelet (security definer RPC).
- Expo Go-ban a push nem elérhető — EAS build kell hozzá.
- A „Bruttó nézet" kapcsoló a kimutatásokban még nincs bekötve (a
  nettó+ÁFA oszlopok mindenhol megvannak hozzá).
