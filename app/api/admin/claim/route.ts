import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appAdmins, auditLogs } from '@/lib/db/schema'
import { count } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const [{ value }] = await db.select({ value: count() }).from(appAdmins)
  if (Number(value) > 0) return NextResponse.json({ error: 'Initial admin already exists.' }, { status: 409 })
  const id = randomUUID()
  try {
    await db.insert(appAdmins).values({ id, email: session.user.email, displayName: session.user.name || session.user.email })
    await db.insert(auditLogs).values({ id: randomUUID(), actorEmail: session.user.email, action: 'claimed_initial_admin', entityType: 'admin', entityId: id, metadata: { email: session.user.email } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Initial admin already exists.' }, { status: 409 })
  }
}

export async function GET() {
  const [{ value }] = await db.select({ value: count() }).from(appAdmins)
  return NextResponse.json({ available: Number(value) === 0 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Initial admin claims cannot be deleted here.' }, { status: 405 })
}

