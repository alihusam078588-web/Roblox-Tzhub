'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Binary,
  Check,
  Copy,
  Cpu,
  Download,
  FileWarning,
  Loader2,
  ShieldCheck,
  Trash2,
  Zap,
  LockKeyhole,
  Link as LinkIcon,
} from 'lucide-react'
import { obfuscate, type ObfuscateResult } from '@/lib/obfuscator'
import { Button } from '@/components/ui/button'

const SAMPLE = `-- Sample Luau script
local Players = game and game:GetService("Players") or nil

local Counter = {}
Counter.__index = Counter

function Counter.new(start)
	return setmetatable({ value = start or 0 }, Counter)
end

function Counter:add(n)
	self.value += n
	return self.value
end

local c = Counter.new(10)
c:add(5)
c:add(25)

print("Counter value:", c.value)

for i = 1, 3 do
	print("tick", i, "->", c:add(i))
end

return c.value
`

function formatNumber(n: number) {
  return n.toLocaleString('en-US')
}

function formatBytes(chars: number) {
  if (chars < 1024) return `${chars} B`
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`
}

export function ObfuscatorPanel() {
  const [source, setSource] = useState(SAMPLE)
  const [targetMillions, setTargetMillions] = useState(2)
  const [chunkSize, setChunkSize] = useState(1024)
  const [seedInput, setSeedInput] = useState('')
  const [result, setResult] = useState<ObfuscateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const outputRef = useRef<HTMLTextAreaElement>(null)

  const runObfuscate = useCallback(() => {
    setBusy(true)
    setError(null)
    setCopied(false)
    // Defer so the loading state paints before the (potentially heavy) work.
    setTimeout(() => {
      try {
        const seed = seedInput.trim() === '' ? undefined : Number(seedInput.trim()) >>> 0
        const res = obfuscate(source, {
          targetSize: Math.max(0, targetMillions) * 1_000_000,
          chunkSize,
          seed,
        })
        setResult(res)
        if (!res.roundtripOk) {
          setError(
            'Round-trip verification failed for this input. The output was not emitted to avoid shipping a broken script.',
          )
          setResult(null)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error during obfuscation.')
        setResult(null)
      } finally {
        setBusy(false)
      }
    }, 30)
  }, [source, targetMillions, chunkSize, seedInput])

  const handleCopy = useCallback(async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Fallback: select the textarea contents.
      outputRef.current?.select()
      document.execCommand?.('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }, [result])

  const handlePublish = useCallback(async () => {
    if (!result || !password) return
    setPublishing(true)
    setPublishedUrl(null)
    setError(null)
    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, source, targetSize: targetMillions * 1_000_000, chunkSize, seed: result.seed }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Publish failed.')
      setPublishedUrl(data.url)
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }, [result, password, source, targetMillions, chunkSize])

  const handleDownload = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `protected_${result.seed}.lua`
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  const preview = useMemo(() => {
    if (!result) return ''
    // Only show the head of very large output to keep the textarea responsive.
    const LIMIT = 40_000
    return result.code.length > LIMIT
      ? result.code.slice(0, LIMIT) +
          `\n\n-- [ preview truncated -- full ${formatNumber(
            result.code.length,
          )} characters available via Copy / Download ] --\n`
      : result.code
  }, [result])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
            <Cpu className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              Luau VM Obfuscator
            </h1>
            <p className="text-sm text-muted-foreground">
              Heavy VM-layer protection · byte-lossless · under the 200-function limit
            </p>
          </div>
          <Link href="/links" className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Manage links</Link>
        </div>
        <p className="max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Your source is encoded byte-for-byte through a rolling key, arithmetic position mixing,
          and a randomized 256-entry S-box, then reconstructed and executed at runtime. The
          generated wrapper defines{' '}
          <span className="font-mono text-accent">zero</span> Lua functions of its own — only the
          functions your original script already declares ever exist.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input side */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label
              htmlFor="source"
              className="flex items-center gap-2 font-mono text-sm font-medium text-foreground"
            >
              <Binary className="size-4 text-accent" aria-hidden="true" />
              Source script
            </label>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Upload .lua
                <input
                  type="file"
                  accept=".lua,.luau,text/plain"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) setSource(await file.text())
                    e.currentTarget.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setSource('')}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>
          <textarea
            id="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            placeholder="Paste your Luau script here…"
            className="h-80 w-full resize-y rounded-lg border border-border bg-card p-4 font-mono text-[13px] leading-relaxed text-card-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />

          {/* Controls */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card/60 p-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="target" className="text-xs font-medium text-muted-foreground">
                Target size (M chars)
              </label>
              <input
                id="target"
                type="number"
                min={0}
                step={0.5}
                value={targetMillions}
                onChange={(e) => setTargetMillions(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="chunk" className="text-xs font-medium text-muted-foreground">
                Chunk size (bytes)
              </label>
              <input
                id="chunk"
                type="number"
                min={64}
                step={64}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="seed" className="text-xs font-medium text-muted-foreground">
                Seed (optional)
              </label>
              <input
                id="seed"
                type="text"
                inputMode="numeric"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="random"
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
          </div>

          <Button
            onClick={runObfuscate}
            disabled={busy || source.trim().length === 0}
            className="h-11 w-full gap-2 font-mono text-sm font-semibold"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Obfuscating…
              </>
            ) : (
              <>
                <Zap className="size-4" aria-hidden="true" />
                Obfuscate
              </>
            )}
          </Button>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
            >
              <FileWarning className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </section>

        {/* Output side */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono text-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Protected output
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!result}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {copied ? (
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!result}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Download
              </button>
            </div>
          </div>

          <textarea
            ref={outputRef}
            readOnly
            value={preview}
            spellCheck={false}
            placeholder="Obfuscated output will appear here…"
            className="h-80 w-full resize-y rounded-lg border border-border bg-card p-4 font-mono text-[12px] leading-relaxed text-muted-foreground shadow-inner outline-none placeholder:text-muted-foreground/60"
          />

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Output size"
              value={result ? formatBytes(result.size) : '—'}
              sub={result ? `${formatNumber(result.size)} chars` : undefined}
            />
            <Stat
              label="Payload"
              value={result ? formatNumber(result.payloadBytes) : '—'}
              sub={result ? 'source bytes' : undefined}
            />
            <Stat
              label="VM functions"
              value={result ? String(result.functionCount) : '—'}
              sub={result ? '/ 200 limit' : undefined}
              highlight={result?.functionCount === 0}
            />
            <Stat
              label="Round-trip"
              value={result ? (result.roundtripOk ? 'Verified' : 'Failed') : '—'}
              sub={result ? `seed ${result.seed}` : undefined}
              highlight={result?.roundtripOk}
            />
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="mb-3 flex items-center gap-2 font-mono text-sm font-medium text-foreground">
          <LockKeyhole className="size-4 text-primary" aria-hidden="true" />
          Protected loader link
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter publishing password"
            aria-label="Publishing password"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <Button onClick={handlePublish} disabled={!result || !password || publishing} variant="outline" className="gap-2 font-mono">
            {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LinkIcon className="size-4" aria-hidden="true" />}
            {publishing ? 'Publishing…' : 'Create loadstring URL'}
          </Button>
        </div>
        {publishedUrl && (
          <div className="mt-3 rounded-md border border-accent/30 bg-background p-3">
            <p className="mb-2 text-xs text-muted-foreground">Use this URL with your executor&apos;s HTTP request function. Browser requests are denied.</p>
            <code className="block break-all font-mono text-xs text-accent">{publishedUrl}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(publishedUrl)} className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">Copy URL</button>
          </div>
        )}
      </section>

      <footer className="rounded-lg border border-border bg-card/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-1 font-mono font-medium text-foreground">Runtime requirement</p>
        The reconstructed source is executed via{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-accent">loadstring</code> /{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-accent">load</code>, so the
        target environment must allow it (standard in Luau executors; enable{' '}
        <span className="font-mono">LoadStringEnabled</span> for Roblox server scripts). This is the
        deliberate trade-off that keeps the wrapper at zero added functions instead of the hundreds
        a bytecode-VM emitter would generate.
      </footer>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-base font-semibold ${
          highlight ? 'text-accent' : 'text-foreground'
        }`}
      >
        {value}
      </span>
      {sub && <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}
