import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appAdmins, auditLogs, blacklistEntries, executionEvents, protectedLinks, scriptVersions, supportedGames } from '@/lib/db/schema'

async function admin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const [record] = await db.select().from(appAdmins).where(eq(appAdmins.email, session.user.email)).limit(1)
  return record ? session.user : null
}

const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) || null : null

export async function GET(_: Request, context: { params: Promise<{ resource: string }> }) {
  const user = await admin()
  if (!user) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  const { resource } = await context.params
  const queries = {
    games: db.select().from(supportedGames).orderBy(desc(supportedGames.createdAt)).limit(100),
    blacklist: db.select().from(blacklistEntries).orderBy(desc(blacklistEntries.createdAt)).limit(100),
    scripts: db.select().from(scriptVersions).orderBy(desc(scriptVersions.createdAt)).limit(100),
    links: db.select().from(protectedLinks).orderBy(desc(protectedLinks.createdAt)).limit(100),
    executions: db.select().from(executionEvents).orderBy(desc(executionEvents.createdAt)).limit(100),
    'audit-logs': db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
    users: db.select({ id: appAdmins.id, email: appAdmins.email, displayName: appAdmins.displayName, createdAt: appAdmins.createdAt }).from(appAdmins).orderBy(desc(appAdmins.createdAt)).limit(100),
  } as const
  const query = queries[resource as keyof typeof queries]
  if (!query) return NextResponse.json({ error: 'Unknown resource.' }, { status: 404 })
  return NextResponse.json({ rows: await query })
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const user = await admin()
  if (!user) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  const { resource } = await context.params
  const body = await request.json()
  const id = randomUUID()
  try {
    if (resource === 'games') {
      const name = text(body.name, 120), placeId = text(body.placeId, 40)
      if (!name || !placeId) return NextResponse.json({ error: 'Name and PlaceId are required.' }, { status: 400 })
      await db.insert(supportedGames).values({ id, name, placeId, universeId: text(body.universeId, 80), description: text(body.description, 500), status: text(body.status, 30) ?? 'active', scriptVersion: text(body.scriptVersion, 30) ?? '1.0.0' })
    } else if (resource === 'blacklist') {
      const reason = text(body.reason, 500)
      if (!reason) return NextResponse.json({ error: 'Reason is required.' }, { status: 400 })
      await db.insert(blacklistEntries).values({ id, userId: text(body.userId, 100), usernameSnapshot: text(body.usernameSnapshot, 100), reason, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, createdBy: user.email, active: true })
    } else if (resource === 'scripts') {
      const name = text(body.name, 120), version = text(body.version, 40)
      if (!name || !version) return NextResponse.json({ error: 'Name and version are required.' }, { status: 400 })
      await db.insert(scriptVersions).values({ id, scriptId: text(body.scriptId, 120) ?? id, gameId: text(body.gameId, 120), name, version, protectedUrl: text(body.protectedUrl, 1000), releaseNotes: text(body.releaseNotes, 1000), status: text(body.status, 30) ?? 'active' })
    } else if (resource === 'links') {
      const versionId = text(body.versionId, 120), gameId = text(body.gameId, 120), scriptId = text(body.scriptId, 120)
      if (!versionId || !gameId || !scriptId) return NextResponse.json({ error: 'Version, game, and script are required.' }, { status: 400 })
      await db.insert(protectedLinks).values({ id, versionId, gameId, scriptId, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, active: true })
    } else return NextResponse.json({ error: 'Unsupported create resource.' }, { status: 400 })
    await db.insert(auditLogs).values({ id: randomUUID(), actorEmail: user.email, action: `created_${resource}`, entityType: resource, entityId: id, metadata: body })
    return NextResponse.json({ id })
  } catch { return NextResponse.json({ error: 'Could not save record. Check required fields and uniqueness.' }, { status: 400 }) }
}
