import { NextResponse } from 'next/server'

export const maxDuration = 60
const MAX_BODY_BYTES = 300 * 1024

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'Request body is too large.' }, { status: 413 })
    }
    const body = await request.text()
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'Request body is too large.' }, { status: 413 })
    }
    const upstream = await fetch('https://rbx.lol/api/protect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(55_000),
    })
    const responseBody = await upstream.text()
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Protection service is unavailable.' }, { status: 502 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers: { Allow: 'POST' } })
}

export async function PUT() { return GET() }
export async function PATCH() { return GET() }
export async function DELETE() { return GET() }
export async function OPTIONS() { return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } }) }
