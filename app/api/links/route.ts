import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

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
    return NextResponse.json({
      links: blobs.filter((blob) => blob.pathname.endsWith('.lua')).map((blob) => ({
        id: blob.pathname.replace(/^protected\//, '').replace(/\.lua$/, ''),
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Could not list protected links.' }, { status: 500 })
  }
}

export { authorized }
