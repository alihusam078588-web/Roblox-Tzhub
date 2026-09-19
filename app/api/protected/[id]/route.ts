import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

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
  const token = new URL(request.url).searchParams.get('token')
  const userAgent = request.headers.get('user-agent')?.toLowerCase() ?? ''
  const acceptsHtml = request.headers.get('accept')?.includes('text/html')

  if (!validToken(id, token) || acceptsHtml || /mozilla|chrome|safari|firefox|edg\//.test(userAgent)) {
    return new NextResponse('Do not dump or try to deobfuscate this code.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  try {
    const result = await get(`protected/${id}.lua`, { access: 'private' })
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
