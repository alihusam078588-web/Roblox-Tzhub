import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { count, desc, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { executionEvents, supportedGames, scriptVersions, protectedLinks, blacklistEntries } from '@/lib/db/schema'

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const [[scripts], [games], [executions], [blacklisted], recent] = await Promise.all([
    db.select({ value: count() }).from(scriptVersions),
    db.select({ value: count() }).from(supportedGames),
    db.select({ value: count() }).from(executionEvents),
    db.select({ value: count() }).from(blacklistEntries).where(sql`${blacklistEntries.active} = true AND (${blacklistEntries.expiresAt} IS NULL OR ${blacklistEntries.expiresAt} > now())`),
    db.select().from(executionEvents).orderBy(desc(executionEvents.createdAt)).limit(8),
  ])
  const cards = [['Scripts', scripts.value], ['Active games', games.value], ['Executions', executions.value], ['Blacklisted', blacklisted.value]]
  return <main className="min-h-screen bg-background text-foreground"><div className="mx-auto flex max-w-7xl gap-6 px-5 py-6"><aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex"><p className="px-3 font-mono text-xs uppercase tracking-[0.25em] text-accent">TZ HUB</p>{['Dashboard','Obfuscator','Manage Links','Executions','Users','Blacklist','Game Support','Scripts','Settings'].map((item) => <a key={item} href={item === 'Dashboard' ? '/dashboard' : `/${item.toLowerCase().replaceAll(' ', '-')}`} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{item}</a>)}</aside><section className="min-w-0 flex-1"><header><p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">Control panel</p><h1 className="mt-2 text-3xl font-semibold">Dashboard</h1><p className="mt-1 text-sm text-muted-foreground">Signed in as {session.user.email}</p></header><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div><div className="mt-8 overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border p-5"><h2 className="font-semibold">Recent executions</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-muted-foreground"><tr><th className="px-5 py-3">Username</th><th className="px-5 py-3">Place ID</th><th className="px-5 py-3">Game</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Time</th></tr></thead><tbody>{recent.map((event) => <tr key={event.id} className="border-t border-border"><td className="px-5 py-3">{event.username ?? 'Unknown'}</td><td className="px-5 py-3">{event.placeId ?? '—'}</td><td className="px-5 py-3">{event.gameName ?? 'Unsupported'}</td><td className="px-5 py-3">{event.status}</td><td className="px-5 py-3 text-muted-foreground">{event.createdAt.toLocaleString()}</td></tr>)}</tbody></table></div></div></section></div></main>
}
