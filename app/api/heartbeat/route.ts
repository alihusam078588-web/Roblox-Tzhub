import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { liveSessions } from '@/lib/db/schema'

const text = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) || null : null

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const loaderId = text(body.loaderId, 160)
  if (!loaderId) return NextResponse.json({ error: 'loaderId is required.' }, { status: 400 })
  const sessionId = text(body.sessionId, 160) ?? `${loaderId}:${text(body.userId, 100) ?? 'anonymous'}`
  await db.insert(liveSessions).values({ id: sessionId, loaderId, userId: text(body.userId, 100), username: text(body.username, 100), placeId: text(body.placeId, 40), gameName: text(body.gameName, 160), lastSeenAt: new Date(), status: 'online', metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : null }).onConflictDoUpdate({ target: liveSessions.id, set: { loaderId, userId: text(body.userId, 100), username: text(body.username, 100), placeId: text(body.placeId, 40), gameName: text(body.gameName, 160), lastSeenAt: new Date(), status: 'online', metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : null } })
  return NextResponse.json({ ok: true, sessionId })
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sessionId = text(body.sessionId, 160)
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  await db.update(liveSessions).set({ status: 'offline', lastSeenAt: new Date() }).where((await import('drizzle-orm')).eq(liveSessions.id, sessionId))
  return NextResponse.json({ ok: true })
}
