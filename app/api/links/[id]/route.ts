import { del, put } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { authorized } from '@/app/api/links/route'

function pathname(id: string) {
  return `protected/${id}.lua`
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const body = await request.json()
    if (!authorized(body.password)) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    if (typeof body.code !== 'string' || !body.code.trim()) return NextResponse.json({ error: 'Code is required.' }, { status: 400 })
    await put(pathname(id), body.code, { access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false, allowOverwrite: true })
    return NextResponse.json({ saved: true })
  } catch {
    return NextResponse.json({ error: 'Could not save this link.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const body = await request.json()
    if (!authorized(body.password)) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
    await del(pathname(id))
    return NextResponse.json({ deleted: true })
  } catch {
    return NextResponse.json({ error: 'Could not delete this link.' }, { status: 500 })
  }
}
