'use client'

import { useState } from 'react'
import { ArrowLeft, Check, Code2, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

type LinkItem = { id: string; pathname: string; size: number; uploadedAt: string; loaderUrl: string }

export function LinkManager() {
  const [password, setPassword] = useState('')
  const [items, setItems] = useState<LinkItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function loadLinks() {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setItems(data.links)
      setNotice(`${data.links.length} protected link${data.links.length === 1 ? '' : 's'} loaded.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load links.') } finally { setBusy(false) }
  }

  async function edit(item: LinkItem) {
    setSelected(item.id); setCode(''); setError(''); setNotice('')
    const response = await fetch(`/api/protected/${item.id}?mode=edit&password=${encodeURIComponent(password)}`)
    if (!response.ok) { setError('Could not open this script.'); return }
    setCode(await response.text())
  }

  async function save() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/links/${selected}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, source: code }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setNotice('Saved. The existing loader URL now serves the updated protected code.')
      await loadLinks()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  async function remove(item: LinkItem) {
    if (!window.confirm(`Delete protected URL ${item.id}? This cannot be undone.`)) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/links/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      if (selected === item.id) { setSelected(null); setCode('') }
      setNotice('Protected URL deleted.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.') } finally { setBusy(false) }
  }

  return <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6 text-foreground">
    <header className="flex items-center justify-between border-b border-border pb-5">
      <div><p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Protected storage</p><h1 className="mt-2 font-mono text-2xl font-semibold">Available links</h1><p className="mt-1 text-sm text-muted-foreground">Edit, save, or permanently delete published loaders.</p></div>
      <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Obfuscator</Link>
    </header>
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-4 sm:flex-row">
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Publishing password" aria-label="Publishing password" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
      <Button onClick={loadLinks} disabled={!password || busy} className="gap-2 font-mono">{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Load links</Button>
    </section>
    {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${error ? 'border-destructive/40 bg-destructive/10' : 'border-accent/30 bg-accent/10'}`}>{error || notice}</div>}
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-lg border border-border bg-card/50 p-3"><h2 className="mb-3 flex items-center gap-2 font-mono text-sm"><Code2 className="size-4 text-accent" /> Published loaders</h2>{items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Unlock storage to view links.</p> : <div className="flex flex-col gap-2">{items.map((item) => <div key={item.id} className={`rounded-md border p-3 ${selected === item.id ? 'border-primary bg-primary/10' : 'border-border bg-background'}`}><code className="block truncate text-xs text-accent">{item.id}</code><p className="mt-1 text-xs text-muted-foreground">{item.size.toLocaleString()} bytes · {new Date(item.uploadedAt).toLocaleString()}</p><code className="mt-2 block break-all rounded bg-muted p-2 text-[11px] text-accent">{`loadstring(game:HttpGet("${item.loaderUrl}"))()`}</code><button type="button" onClick={() => navigator.clipboard.writeText(`loadstring(game:HttpGet("${item.loaderUrl}"))()`)} className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">Copy loadstring</button><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(item)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => remove(item)} className="gap-1 text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Delete</Button></div></div>)}</div>}</section>
      <section className="rounded-lg border border-border bg-card/50 p-3"><div className="mb-3 flex items-center justify-between"><h2 className="font-mono text-sm">Source editor</h2><Button size="sm" onClick={save} disabled={!selected || !code || busy} className="gap-2"><Save className="size-3.5" /> Save</Button></div><textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} disabled={!selected} placeholder="Select a protected loader to edit its code." className="min-h-[520px] w-full resize-y rounded-md border border-border bg-background p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60" /><p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5 text-accent" /> Save re-obfuscates this source and updates the same loader ID and URL.</p></section>
    </div>
  </main>
}
