'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminShell } from '@/components/admin-dashboard'

 type Service = { id: string; name: string; placeIds: unknown; enabled: boolean; scriptId: string | null }

export default function FullLoaderPage() {
  const [services, setServices] = useState<Service[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  useEffect(() => { fetch('/api/admin/services').then((response) => response.json()).then((data) => setServices(data.rows ?? [])) }, [])
  const active = services.filter((service) => service.enabled && selected.includes(service.id))
  const source = useMemo(() => {
    const routes = active.flatMap((service) => (Array.isArray(service.placeIds) ? service.placeIds : []).map((placeId) => `  [${JSON.stringify(String(placeId))}] = ${JSON.stringify(`/api/protected/${service.scriptId ?? service.id}`)},`)).join('\n')
    return `local routes = {\n${routes}\n}\nlocal placeId = tostring(game.PlaceId)\nlocal endpoint = routes[placeId]\nif not endpoint then warn("TZ HUB: PlaceId is not supported") return end\nloadstring(game:HttpGet(endpoint))()`
  }, [active])
  return <AdminShell title="Build Full Loader" eyebrow="Distribution workflow"><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-6"><p className="text-[10px] uppercase tracking-[0.2em] text-[#768291]">Live service routing</p><h2 className="mt-2 text-xl font-semibold">Generate one PlaceId-aware loader</h2><p className="mt-3 text-sm leading-6 text-[#8794a2]">Select persisted Neon services. The generated source contains routing metadata only; protected script contents remain behind the delivery endpoint.</p><div className="mt-5 space-y-2">{services.map((service) => <label key={service.id} className="flex items-center gap-3 rounded-lg border border-white/[0.07] p-3 text-sm"><input type="checkbox" checked={selected.includes(service.id)} disabled={!service.enabled} onChange={(event) => setSelected((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))} /><span>{service.name}</span><span className="ml-auto text-xs text-[#768291]">{service.enabled ? 'enabled' : 'disabled'}</span></label>)}</div><button type="button" className="mt-5 rounded-lg bg-[#c6ff45] px-4 py-2.5 text-sm font-semibold text-[#10150c] disabled:opacity-40" disabled={!active.length} onClick={() => { navigator.clipboard.writeText(source); setCopied(true); setTimeout(() => setCopied(false), 1600) }}>{copied ? 'Copied loader' : 'Copy generated loader'}</button></section><section className="rounded-2xl border border-white/[0.08] bg-[#0e141c] p-6"><h2 className="text-lg font-semibold">Generated output</h2><pre className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-white/[0.06] bg-black/20 p-4 text-xs leading-6 text-[#b7c5d0]">{source}</pre><p className="mt-4 text-xs leading-5 text-[#768291]">No webhook URLs are created here. This workflow only generates a protected script router from enabled Neon services.</p></section></div></AdminShell>
}
