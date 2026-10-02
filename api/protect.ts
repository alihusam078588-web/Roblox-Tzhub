// Vercel serverless function → place this file at:  api/protect.ts
// Forwards { source } to the rbx.lol obfuscator and returns its JSON unchanged (avoids browser CORS limits).
export const config = { maxDuration: 60 };

const TARGET = 'https://rbx.lol/api/protect';
const MAX_BODY = 300 * 1024; // pieces are ≤ 256 KB; reject anything bigger

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const source = body && body.source;
    if (typeof source !== 'string' || !source) return res.status(400).json({ ok: false, error: 'Missing "source"' });
    if (source.length > MAX_BODY) return res.status(413).json({ ok: false, error: 'That script is too large for this proxy.' });

    const r = await fetch(TARGET, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', 'application/json');
    try { JSON.parse(text); return res.send(text); }
    catch { return res.json({ ok: false, error: `rbx.lol returned HTTP ${r.status} (not JSON)` }); }
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: 'Proxy error: ' + (e && e.message ? e.message : String(e)) });
  }
}
