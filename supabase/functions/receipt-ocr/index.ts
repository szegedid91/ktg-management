// AI blokk-kiolvasás: a számla/blokk fotójából összeget, dátumot és
// bolt nevét nyeri ki. Az Anthropic API kulcs KIZÁRÓLAG itt él,
// a kliensre soha nem kerül.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller, checkQuota } from './caller.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    // csak fő felhasználó, napi kvótával (fizetős AI-hívás)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const caller = await identifyCaller(req, admin);
    if (!caller) return json({ error: 'Bejelentkezés szükséges.' }, 401);
    const { image_base64, media_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'image_base64 hiányzik' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // méretkorlát: ~8 MB base64 (≈6 MB kép) — költség-visszaélés ellen
    if (image_base64.length > 8_000_000) {
      return new Response(JSON.stringify({ error: 'A kép túl nagy (max ~6 MB). Készíts kisebb felbontású fotót.' }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // partner: 60 / nap; munkavállaló (anyagköltség blokkja): 20 / nap — csak érvényes kérésnél számít
    const limit = caller.isPartner ? 60 : 20;
    if (!await checkQuota(admin, caller.id, 'receipt-ocr', limit)) {
      return json({ error: `Elérted a napi felismerési keretet (${limit}). Holnap újra próbálhatod.` }, 429);
    }
    const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
    const mt = ALLOWED_MEDIA.has(media_type) ? media_type : 'image/jpeg';

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mt, data: image_base64 },
          },
          {
            type: 'text',
            text: `Ez egy magyar nyugta/blokk/számla fotója. Olvasd ki:
- a VÉGÖSSZEGET (bruttó, forintban, szám),
- a vásárlás DÁTUMÁT (ISO formátum: ÉÉÉÉ-HH-NN),
- a bolt/kibocsátó NEVÉT (röviden, pl. "OBI", "Praktiker").

Kizárólag ilyen JSON objektummal válaszolj, más szöveg nélkül:
{"gross_amount": <szám vagy null>, "date": "<ÉÉÉÉ-HH-NN vagy null>", "merchant": "<név vagy null>"}
Ha valamit nem tudsz kiolvasni, az legyen null.`,
          },
        ],
      }],
    });

    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { gross_amount: null, date: null, merchant: null };

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('receipt-ocr', err);
    return json({ error: 'A felismerés nem sikerült.' }, 500);
  }
});
