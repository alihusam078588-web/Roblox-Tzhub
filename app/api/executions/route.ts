import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { blacklistEntries, executionEvents, supportedGames } from '@/lib/db/schema'

const text = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) || null : null
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const userId = text(body.userId, 80)
    const username = text(body.username, 80)
    const placeId = text(body.placeId, 40)
    const loaderId = text(body.loaderId, 120)
    if (!placeId || !loaderId) return NextResponse.json({ allowed: false, reason: 'Missing loader or PlaceId.' }, { status: 400 })
    const [blacklist] = await db.select().from(blacklistEntries).where(and(eq(blacklistEntries.active, true), or(userId ? eq(blacklistEntries.userId, userId) : eq(blacklistEntries.usernameSnapshot, username ?? ''), isNull(blacklistEntries.expiresAt), gt(blacklistEntries.expiresAt, new Date())))).limit(1)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const base = { id: randomUUID(), userId, username, placeId, loaderId, ipHash: createHash('sha256').update(ip).digest('hex').slice(0, 24), createdAt: new Date() }
    if (blacklist) {
      await db.insert(executionEvents).values({ ...base, status: 'blacklisted', denialReason: blacklist.reason })
      return NextResponse.json({ allowed: false, reason: blacklist.reason }, { status: 403 })
    }
    const [game] = await db.select().from(supportedGames).where(and(eq(supportedGames.placeId, placeId), eq(supportedGames.status, 'active'))).limit(1)
    if (!game) {
      await db.insert(executionEvents).values({ ...base, status: 'unsupported' })
      return NextResponse.json({ allowed: false, reason: 'TZ HUB does not currently support this game.' }, { status: 404 })
    }
    await db.insert(executionEvents).values({ ...base, gameName: game.name, scriptId: game.scriptId, scriptVersion: game.scriptVersion, status: 'allowed' })
    return NextResponse.json({ allowed: true, game: game.name, scriptId: game.scriptId, version: game.scriptVersion })
  } catch {
    return NextResponse.json({ allowed: false, reason: 'Telemetry request rejected.' }, { status: 400 })
  }
}
