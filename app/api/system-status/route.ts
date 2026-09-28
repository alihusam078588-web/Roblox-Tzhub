import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appAdmins } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() { const session = await auth.api.getSession({ headers: await headers() }); if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const [admin] = await db.select({ id: appAdmins.id }).from(appAdmins).where(eq(appAdmins.email, session.user.email)).limit(1); if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); const startedAt = Date.now(); try { await db.execute(sql`select 1`); return NextResponse.json({ database: { status: 'operational', latencyMs: Date.now() - startedAt }, blob: { status: process.env.BLOB_READ_WRITE_TOKEN ? 'configured' : 'missing' }, auth: { status: process.env.BETTER_AUTH_SECRET ? 'configured' : 'missing' }, checkedAt: new Date().toISOString() }) } catch { return NextResponse.json({ database: { status: 'degraded' }, checkedAt: new Date().toISOString() }, { status: 503 }) } }
