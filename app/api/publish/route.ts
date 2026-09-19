import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { obfuscate, optimizeRegisterSafe } from '@/lib/obfuscator'

export const maxDuration = 60

function secret() {
  return process.env.OBFUSCATOR_PASSWORD ?? ''
}

function sign(id: string, exp: number) {
  return createHmac('sha256', secret()).update(`${id}.${exp}`).digest('hex')
}

function validPassword(value: unknown) {
  if (typeof value !== 'string' || !secret()) return false
  const left = Buffer.from(value)
  const right = Buffer.from(secret())
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!validPassword(body.password)) {
      return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    }
    if (typeof body.source !== 'string' || body.source.length === 0) {
      return NextResponse.json({ error: 'Source script is required.' }, { status: 400 })
    }
    if (body.source.length > 8_000_000) {
      return NextResponse.json({ error: 'Source script is too large.' }, { status: 413 })
    }

    const optimizedSource = optimizeRegisterSafe(body.source).source
    const result = obfuscate(optimizedSource, {
      targetSize: Math.max(0, Number(body.targetSize) || 2_000_000),
      chunkSize: Math.max(64, Number(body.chunkSize) || 1024),
      seed: Number.isFinite(body.seed) ? Number(body.seed) >>> 0 : undefined,
    })
    if (!result.roundtripOk) {
      return NextResponse.json({ error: 'Round-trip verification failed.' }, { status: 422 })
    }

    const id = randomUUID()
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    await Promise.all([
      put(`protected/${id}.lua`, result.code, {
        access: 'private',
        contentType: 'text/plain; charset=utf-8',
        addRandomSuffix: false,
      }),
      put(`sources/${id}.luau`, body.source, {
        access: 'private',
        contentType: 'text/plain; charset=utf-8',
        addRandomSuffix: false,
      }),
    ])
    const token = `${exp}.${sign(id, exp)}`
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
    const deploymentHost = process.env.VERCEL_URL
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin
      ? configuredOrigin
      : forwardedHost
        ? `${forwardedProto}://${forwardedHost}`
        : deploymentHost
          ? `https://${deploymentHost}`
          : new URL(request.url).origin
    return NextResponse.json({
      id,
      url: `${origin}/api/protected/${id}?token=${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      size: result.size,
      seed: result.seed,
    })
  } catch (error) {
    console.error('[v0] publish failed', error)
    return NextResponse.json({ error: 'Could not publish protected script.' }, { status: 500 })
  }
}

export { sign }
