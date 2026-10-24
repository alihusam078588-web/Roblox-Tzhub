import { redirect } from 'next/navigation'
import { count, desc, sql } from 'drizzle-orm'
import { getAdminSession } from '@/lib/admin'
import { db } from '@/lib/db'
import { auditLogs, blacklistEntries, executionEvents, protectedLinks, scriptVersions, supportedGames } from '@/lib/db/schema'
import { AdminShell, DashboardCards, MetricRow, StatusBadge } from '@/components/admin-dashboard'

export default async function DashboardPage() {
  const session = await getAdminSession()
  if (!session?.user) redirect('/sign-in')
  const [[all], [today], [users], [games], [scripts], [links], [blacklist], recent, audit] = await Promise.all([
    db.select({ value: count() }).from(executionEvents),
    db.select({ value: count() }).from(executionEvents).where(sql`${executionEvents.createdAt} >= current_date`),
    db.select({ value: sql<number>`count(distinct ${executionEvents.userId})` }).from(executionEvents),
    db.select({ value: count() }).from(supportedGames).where(sql`${supportedGames.status} = 'active'`),
    db.select({ value: count() }).from(scriptVersions).where(sql`${scriptVersions.status} = 'active'`),
    db.select({ value: count() }).from(protectedLinks).where(sql`${protectedLinks.active} = true`),
    db.select({ value: count() }).from(blacklistEntries).where(sql`${blacklistEntries.active} = true AND (${blacklistEntries.expiresAt} IS NULL OR ${blacklistEntries.expiresAt} > now())`),
    db.select().from(executionEvents).orderBy(desc(executionEvents.createdAt)).limit(6),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(5),
  ])
  return <AdminShell title="Overview" eyebrow="Operations dashboard">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#c6ff45]/15 bg-[#c6ff45]/[0.04] px-5 py-4"><div><p className="text-sm font-medium">Your distribution stack is online</p><p className="mt-1 text-xs text-[#8794a2]">Neon-backed telemetry, protected delivery, and audit logging are active.</p></div><StatusBadge>Operational</StatusBadge></div>
    <DashboardCards cards={[[ 'Total executions', Number(all.value) ], ['Executions today', Number(today.value)], ['Unique players', Number(users.value)], ['Supported games', Number(games.value)], ['Active versions', Number(scripts.value)], ['Protected links', Number(links.value)], ['Blacklisted players', Number(blacklist.value)]]} />
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <section className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.2em] text-[#768291]">Telemetry stream</p><h2 className="mt-1 text-lg font-semibold">Recent executions</h2></div><a href="/dashboard/executions" className="text-xs text-[#c6ff45] hover:underline">View all →</a></div><div className="space-y-1">{recent.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] py-3 last:border-0"><div><p className="text-sm font-medium">{event.username ?? 'Unknown player'}</p><p className="mt-1 text-xs text-[#768291]">{event.placeId ?? 'No PlaceId'} · {event.gameName ?? 'Unknown game'}</p></div><div className="text-right"><StatusBadge tone={event.status === 'allowed' ? 'green' : 'red'}>{event.status}</StatusBadge><p className="mt-1 text-[11px] text-[#768291]">{new Date(event.createdAt).toLocaleString()}</p></div></div>)}{recent.length === 0 && <p className="py-10 text-center text-sm text-[#768291]">No execution telemetry yet.</p>}</div></section>
      <section className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-5"><div className="mb-4"><p className="text-[10px] uppercase tracking-[0.2em] text-[#768291]">Platform health</p><h2 className="mt-1 text-lg font-semibold">System status</h2></div><MetricRow label="Database" value="Connected" /><MetricRow label="Protected delivery" value="Active" /><MetricRow label="Audit trail" value="Recording" /><MetricRow label="Runtime errors" value="0 reported" detail="current view" /><div className="mt-5 rounded-xl bg-[#080b10] p-4"><p className="text-xs font-medium">Next recommended action</p><p className="mt-2 text-sm text-[#8794a2]">Create a Service, attach one Script, then build a protected version.</p><a href="/dashboard/scripts" className="mt-3 inline-block text-xs font-semibold text-[#c6ff45] hover:underline">Open Scripts →</a></div></section>
      <section className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-5 xl:col-span-2"><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.2em] text-[#768291]">Change history</p><h2 className="mt-1 text-lg font-semibold">Latest audit activity</h2></div><a href="/dashboard/audit-logs" className="text-xs text-[#c6ff45] hover:underline">Open audit logs →</a></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">{audit.map((entry) => <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-[#080b10] p-3"><p className="truncate text-xs font-medium">{entry.action}</p><p className="mt-2 text-[11px] text-[#768291]">{entry.actorEmail ?? 'System'} · {new Date(entry.createdAt).toLocaleDateString()}</p></div>)}{audit.length === 0 && <p className="text-sm text-[#768291]">No audit events yet.</p>}</div></section>
    </div>
  </AdminShell>
}
