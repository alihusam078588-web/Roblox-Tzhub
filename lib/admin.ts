import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appAdmins } from '@/lib/db/schema'

export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const [admin] = await db.select().from(appAdmins).where(eq(appAdmins.email, session.user.email)).limit(1)
  return admin ? session : null
}
