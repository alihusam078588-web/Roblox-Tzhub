const TARGET = 'https://rbx.lol/api/protect'
const MAX_BODY = 300 * 1024

export async function POST(request: Request) {
  try {
    const body = await request.json() as { source?: unknown }
    const source = body?.source
    if (typeof source !== 'string' || !source) return Response.json({ ok: false, error: 'Missing "source"' }, { status: 400 })
    if (source.length > MAX_BODY) return Response.json({ ok: false, error: 'That script is too large for this proxy.' }, { status: 413 })
    const response = await fetch(TARGET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) })
    const text = await response.text()
    try { JSON.parse(text); return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } }) }
    catch { return Response.json({ ok: false, error: `rbx.lol returned HTTP ${response.status} (not JSON)` }, { status: response.status }) }
  } catch (error) {
    return Response.json({ ok: false, error: `Proxy error: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 })
  }
}
