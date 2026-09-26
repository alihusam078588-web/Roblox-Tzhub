import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { blacklistEntries, executionEvents, protectedLinks, scriptVersions, services, supportedGames } from '@/lib/db/schema'

function validPassword(value: string | null) {
  const secret = process.env.OBFUSCATOR_PASSWORD ?? ''
  if (!value || !secret) return false
  const left = Buffer.from(value), right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}
const text = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) || null : null

async function logEvent(input: { loaderId: string; status: string; reason?: string | null; userId?: string | null; username?: string | null; placeId?: string | null; gameName?: string | null; scriptId?: string | null; version?: string | null; ip: string }) {
  await db.insert(executionEvents).values({ id: randomUUID(), loaderId: input.loaderId, status: input.status, denialReason: input.reason ?? null, userId: input.userId ?? null, username: input.username ?? null, placeId: input.placeId ?? null, gameName: input.gameName ?? null, scriptId: input.scriptId ?? null, scriptVersion: input.version ?? null, ipHash: createHash('sha256').update(input.ip).digest('hex').slice(0, 24) })
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)
  const editorMode = url.searchParams.get('mode') === 'edit' && validPassword(url.searchParams.get('password'))
  const acceptsHtml = request.headers.get('accept')?.includes('text/html')
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (editorMode) return serveBlob(`sources/${id}.luau`)
  if (acceptsHtml) return new NextResponse('Access denied.', { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const telemetry = (() => { try { return JSON.parse(request.headers.get('x-tz-telemetry') ?? '{}') as Record<string, unknown> } catch { return {} } })()
  const userId = text(telemetry.userId, 100), username = text(telemetry.username, 100), placeId = text(telemetry.placeId, 40)
  const [link] = await db.select().from(protectedLinks).where(eq(protectedLinks.id, id)).limit(1)
  const deny = async (reason: string, status = 403) => { await logEvent({ loaderId: id, status: 'denied', reason, userId, username, placeId, ip }); return NextResponse.json({ allowed: false, reason }, { status, headers: { 'Cache-Control': 'no-store' } }) }
  if (!link) return deny('Invalid loader ID.', 404)
  if (!link.active) return deny('Protected link is disabled.')
  if (link.expiresAt && link.expiresAt <= new Date()) return deny('Protected link has expired.')
  if (!link.versionId || !link.gameId) return deny('Protected link is not fully configured.', 500)
  const [game] = await db.select().from(supportedGames).where(and(eq(supportedGames.id, link.gameId), eq(supportedGames.status, 'active'), placeId ? eq(supportedGames.placeId, placeId) : eq(supportedGames.id, link.gameId))).limit(1)
  if (!game) return deny(placeId ? 'Unsupported PlaceId or inactive game.' : 'PlaceId is required.')
  const [version] = await db.select().from(scriptVersions).where(and(eq(scriptVersions.id, link.versionId), eq(scriptVersions.scriptId, link.scriptId ?? ''), eq(scriptVersions.status, 'active'))).limit(1)
  if (!version) return deny('Script version is disabled or unavailable.')
  const [service] = await db.select().from(services).where(and(eq(services.scriptId, version.scriptId), eq(services.enabled, true))).limit(1)
  if (service && placeId && Array.isArray(service.placeIds) && !(service.placeIds as unknown[]).includes(placeId)) return deny('This script is not enabled for the current game.')
  const [blocked] = await db.select().from(blacklistEntries).where(and(eq(blacklistEntries.active, true), userId ? eq(blacklistEntries.userId, userId) : eq(blacklistEntries.usernameSnapshot, username ?? ''), or(isNull(blacklistEntries.expiresAt), gt(blacklistEntries.expiresAt, new Date())))).limit(1)
  if (blocked) return deny(blocked.reason)
  await logEvent({ loaderId: id, status: 'allowed', userId, username, placeId, gameName: game.name, scriptId: version.scriptId, version: version.version, ip })
  return serveBlob(version.protectedUrl ?? `protected/${version.id}.lua`)
}

async function serveBlob(path: string) {
  try { const result = await get(path, { access: 'private' }); if (!result) return new NextResponse('Not found', { status: 404 }); return new NextResponse(result.stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) } catch { return new NextResponse('Not found', { status: 404 }) }
}
