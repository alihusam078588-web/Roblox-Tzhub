'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, Ban, Boxes, Code2, Home, Radio, ScrollText, Settings2, Terminal, Users, Webhook } from 'lucide-react'

const navigation = [
  { label: 'Overview', href: '/dashboard', icon: Home },
  { label: 'Services', href: '/dashboard/services', icon: Boxes },
  { label: 'Scripts', href: '/dashboard/scripts', icon: Code2 },
  { label: 'Build Full Loader', href: '/dashboard/full-loader', icon: Terminal },
  { label: 'Executions', href: '/dashboard/executions', icon: Activity },
  { label: 'Users', href: '/dashboard/users', icon: Users },
  { label: 'Live Sessions', href: '/dashboard/sessions', icon: Radio },
  { label: 'Blacklist', href: '/dashboard/blacklist', icon: Ban },
  { label: 'Discord Webhooks', href: '/dashboard/webhooks', icon: Webhook },
  { label: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings2 },
]

type Row = Record<string, unknown>

export function AdminShell({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const active = (href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  return <main className="min-h-screen bg-[#080b10] text-[#eef3f7]">
    <div className="mx-auto flex min-h-screen max-w-[1540px]">
      <aside className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden'} w-[258px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0b1017] px-4 py-5 md:sticky md:top-0 md:flex md:h-screen`}>
        <div className="flex items-center justify-between px-3 pb-7"><Link href="/dashboard" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}><span className="grid size-9 place-items-center rounded-xl bg-[#c6ff45] text-lg font-black text-[#0b1017]">TZ</span><span><span className="block text-sm font-bold tracking-[0.2em]">TZ HUB</span><span className="block text-[10px] uppercase tracking-[0.18em] text-[#768291]">Control center</span></span></Link><button className="text-[#768291] md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button></div>
        <nav className="space-y-1">{navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition ${active(item.href) ? 'bg-[#c6ff45] font-semibold text-[#10150c]' : 'text-[#91a0ad] hover:bg-white/[0.05] hover:text-white'}`}><span className={`grid size-6 place-items-center rounded-md ${active(item.href) ? 'bg-black/10' : 'bg-white/[0.04] text-[#aab6c2]'}`}><item.icon className="size-3.5" aria-hidden="true" /></span>{item.label}</Link>)}</nav>
        <div className="mt-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.2em] text-[#768291]">System status</span><span className="size-2 rounded-full bg-[#c6ff45] shadow-[0_0_12px_#c6ff45]" /></div><p className="text-sm font-medium">All systems operational</p><p className="mt-1 text-xs text-[#768291]">Neon database connected</p></div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <section className="min-w-0 flex-1"><header className="flex items-center justify-between border-b border-white/[0.08] px-4 py-4 sm:px-7 lg:px-10"><button className="rounded-lg border border-white/[0.1] px-3 py-2 text-sm text-[#aab6c2] md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button><div className="hidden md:block" /><div className="flex items-center gap-4"><div className="hidden text-right sm:block"><p className="text-xs font-medium">Admin workspace</p><p className="text-[11px] text-[#768291]">Production control</p></div><span className="grid size-9 place-items-center rounded-full bg-[#263141] text-xs font-semibold text-[#c6ff45]">AD</span></div></header><div className="px-4 py-7 sm:px-7 lg:px-10"><div className="mb-8"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[#9abf3c]">{eyebrow ?? 'Workspace'}</p><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 text-sm text-[#768291]">Build, protect, and monitor your Luau distribution stack.</p></div><Link href="/" className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-[#aab6c2] transition hover:border-[#c6ff45]/50 hover:text-white">Open obfuscator ↗</Link></div></div>{children}</div></section>
    </div>
  </main>
}

export function ResourceManager({ resource, title, description, columns, fields }: { resource: string; title: string; description: string; columns: string[]; fields: string[] }) {
  const [rows, setRows] = useState<Row[]>([]); const [form, setForm] = useState<Row>({}); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  async function load() { setBusy(true); const r = await fetch(`/api/admin/${resource}`); const data = await r.json(); setRows(data.rows ?? []); setBusy(false) }
  useEffect(() => { void load() }, [])
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); const r = await fetch(`/api/admin/${resource}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) }); const data = await r.json(); setMessage(data.error ?? 'Saved successfully'); setForm({}); await load(); setBusy(false) }
  async function remove(id: string) { if (!confirm('Remove this record?')) return; await fetch(`/api/admin/${resource}/${id}`, { method: 'DELETE' }); await load() }
  return <AdminShell title={title}><p className="mb-6 max-w-2xl text-sm text-[#8794a2]">{description}</p><form onSubmit={submit} className="mb-6 grid gap-3 rounded-2xl border border-white/[0.08] bg-[#0e141c] p-5 sm:grid-cols-2 lg:grid-cols-4">{fields.map((field) => <label key={field} className="text-xs text-[#8794a2]"><span className="mb-1.5 block capitalize">{field.replaceAll('_', ' ')}</span><input value={String(form[field] ?? '')} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="w-full rounded-lg border border-white/[0.1] bg-[#080b10] px-3 py-2.5 text-sm text-white outline-none focus:border-[#c6ff45]/60" /></label>)}<button disabled={busy} className="self-end rounded-lg bg-[#c6ff45] px-4 py-2.5 text-sm font-semibold text-[#10150c] transition hover:bg-[#d5ff78]">{busy ? 'Saving…' : 'Add record'}</button></form>{message && <p className="mb-4 text-sm text-[#c6ff45]">{message}</p>}<div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#0e141c]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-white/[0.08] text-[10px] uppercase tracking-[0.16em] text-[#768291]"><tr>{columns.map((c) => <th key={c} className="px-4 py-3.5">{c.replaceAll('_', ' ')}</th>)}<th className="px-4 py-3.5">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)} className="border-b border-white/[0.06] last:border-0"><td colSpan={columns.length + 1} className="hidden" />{columns.map((c) => <td key={c} className="px-4 py-3.5 text-[#aab6c2]">{String(row[c] ?? '—')}</td>)}<td className="px-4 py-3.5"><button onClick={() => remove(String(row.id))} className="text-xs text-[#ff7c86] hover:underline">Remove</button></td></tr>)}{rows.length === 0 && <tr><td colSpan={columns.length + 1} className="px-4 py-14 text-center text-[#768291]">No records found.</td></tr>}</tbody></table></div><button onClick={load} className="mt-4 text-sm text-[#c6ff45] hover:underline">{busy ? 'Loading…' : 'Refresh data'}</button></AdminShell>
}

export function DashboardCards({ cards }: { cards: [string, number][] }) { return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-5"><p className="text-xs text-[#768291]">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><div className="mt-4 h-1 w-12 rounded-full bg-[#c6ff45]" /></div>)}</div> }

export function StatusBadge({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'yellow' | 'red' }) { const colors = { green: 'border-[#c6ff45]/20 bg-[#c6ff45]/10 text-[#c6ff45]', yellow: 'border-[#f2c94c]/20 bg-[#f2c94c]/10 text-[#f2c94c]', red: 'border-[#ff7c86]/20 bg-[#ff7c86]/10 text-[#ff7c86]' }; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${colors[tone]}`}>{children}</span> }

export function MetricRow({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="flex items-center justify-between border-b border-white/[0.06] py-3 last:border-0"><span className="text-sm text-[#8794a2]">{label}</span><span className="text-sm font-medium">{value}{detail && <span className="ml-2 text-xs text-[#768291]">{detail}</span>}</span></div> }
