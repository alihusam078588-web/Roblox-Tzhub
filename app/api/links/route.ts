import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

function authorized(value: unknown) {
  const secret = process.env.OBFUSCATOR_PASSWORD ?? ''
  if (typeof value !== 'string' || !secret) return false
  const left = Buffer.from(value)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    if (!authorized(password)) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    const { blobs } = await list({ prefix: 'protected/' })
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
    const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    return NextResponse.json({
      links: blobs.filter((blob) => blob.pathname.endsWith('.lua')).map((blob) => {
        const id = blob.pathname.replace(/^protected\//, '').replace(/\.lua$/, '')
        const token = `${exp}.${createHmac('sha256', process.env.OBFUSCATOR_PASSWORD ?? '').update(`${id}.${exp}`).digest('hex')}`
        return { id, pathname: blob.pathname, size: blob.size, uploadedAt: blob.uploadedAt, loaderUrl: `${origin}/api/protected/${id}?token=${token}` }
      }),
    })
  } catch {
    return NextResponse.json({ error: 'Could not list protected links.' }, { status: 500 })
  }
}

export { authorized }
