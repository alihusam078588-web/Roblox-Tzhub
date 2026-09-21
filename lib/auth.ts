import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'

const origins = ['http://localhost:3000', ...['V0_RUNTIME_URL', 'V0_DEV_APP_URL', 'V0_BUILD_URL', 'V0_SANDBOX_URL'].map((key) => process.env[key]).filter((value): value is string => Boolean(value))]
const productionOrigins = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter((value): value is string => Boolean(value)).map((value) => value.startsWith('http') ? value : `https://${value}`)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  baseURL: process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.V0_RUNTIME_URL),
  trustedOrigins: process.env.NODE_ENV === 'development' ? origins : productionOrigins,
  ...(process.env.NODE_ENV === 'development' ? { advanced: { defaultCookieAttributes: { sameSite: 'none' as const, secure: true } } } : {}),
})
