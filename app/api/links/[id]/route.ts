import { del, get, put } from '@vercel/blob'
import { obfuscate, optimizeRegisterSafe } from '@/lib/obfuscator'
import { NextResponse } from 'next/server'
import { authorized } from '@/app/api/links/route'

function pathname(id: string) {
  return `protected/${id}.lua`
}

function sourcePathname(id: string) {
  return `sources/${id}.luau`
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const body = await request.json()
    if (!authorized(body.password)) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    if (typeof body.source !== 'string' || !body.source.trim()) return NextResponse.json({ error: 'Source code is required.' }, { status: 400 })
    const optimizedSource = optimizeRegisterSafe(body.source).source
    const result = obfuscate(optimizedSource, { targetSize: 2_000_000, chunkSize: 1024 })
    if (!result.roundtripOk) return NextResponse.json({ error: 'Obfuscation verification failed.' }, { status: 422 })
    await Promise.all([
      put(sourcePathname(id), body.source, { access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false, allowOverwrite: true }),
      put(pathname(id), result.code, { access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false, allowOverwrite: true }),
    ])
    return NextResponse.json({ saved: true, size: result.size })
  } catch {
    return NextResponse.json({ error: 'Could not save this link.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const body = await request.json()
    if (!authorized(body.password)) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    await Promise.all([del(pathname(id)), del(sourcePathname(id))])
    return NextResponse.json({ deleted: true })
  } catch {
    return NextResponse.json({ error: 'Could not delete this link.' }, { status: 500 })
  }
}
