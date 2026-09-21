import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

function validPassword(value: string | null) {
  const secret = process.env.OBFUSCATOR_PASSWORD ?? ''
  if (!value || !secret) return false
  const left = Buffer.from(value)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

function validToken(id: string, token: string | null) {
  const secret = process.env.OBFUSCATOR_PASSWORD
  if (!secret || !token) return false
  const [rawExp, signature] = token.split('.')
  const exp = Number(rawExp)
  if (!Number.isSafeInteger(exp) || exp < Math.floor(Date.now() / 1000) || !signature) return false
  const expected = createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const editorPassword = url.searchParams.get('password')
  const editorMode = url.searchParams.get('mode') === 'edit' && validPassword(editorPassword)
  const acceptsHtml = request.headers.get('accept')?.includes('text/html')

  if (!editorMode && (!validToken(id, token) || acceptsHtml)) {
    if (acceptsHtml) {
      return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access denied</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111820;color:#e6edf3;font:16px ui-monospace,monospace}main{max-width:560px;margin:24px;padding:32px;border:1px solid #39434f;border-radius:12px;background:#1b242d;box-shadow:0 20px 60px #0006}h1{margin:0 0 12px;color:#f0b429;font-size:22px}p{line-height:1.6;color:#aeb9c5}</style></head><body><main><h1>Access denied</h1><p>This protected loader is available only to an authorized executor request. Do not dump or try to deobfuscate this code.</p></main></body></html>`, {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' },
      })
    }
    return new NextResponse('Do not dump or try to deobfuscate this code.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  if (!editorMode && request.method === 'GET') {
    const telemetryHeader = request.headers.get('x-tz-telemetry')
    if (telemetryHeader) {
      try {
        const telemetry = JSON.parse(telemetryHeader) as { username?: unknown; userId?: unknown; placeId?: unknown }
        const response = await fetch(new URL('/api/executions', request.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '' }, body: JSON.stringify({ ...telemetry, loaderId: id }) })
        if (!response.ok) return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
      } catch {
        return NextResponse.json({ allowed: false, reason: 'Telemetry validation failed.' }, { status: 400 })
      }
    }
  }

  try {
    const result = await get(editorMode ? `sources/${id}.luau` : `protected/${id}.lua`, { access: 'private' })
    if (!result) return new NextResponse('Not found', { status: 404 })
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
