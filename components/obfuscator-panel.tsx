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
  const [level, setLevel] = useState<'low' | 'default' | 'heavy'>('default')
  const [result, setResult] = useState<ObfuscateResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [status, setStatus] = useState('Ready')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const loadstringSnippet = publishedUrl ? `loadstring(game:HttpGet("${publishedUrl}"))()` : ''
  const outputRef = useRef<HTMLTextAreaElement>(null)

  const runObfuscate = useCallback(async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    setCopied(false)
    setStatus('Parsing Luau and analyzing scopes…')
    setProgress({ done: 0, total: 0 })
    try {
      setProgress({ done: 1, total: 3 })
      setStatus(`Applying ${level} syntax-aware transformations…`)
      const configuration = level === 'low'
        ? { preset: 'light' as const, renameLocals: false, minify: false, targetSize: 500 * 1024 }
        : level === 'heavy'
          ? { preset: 'maximum' as const, renameLocals: true, minify: true, targetSize: 2 * 1024 * 1024 }
          : { preset: 'balanced' as const, renameLocals: true, minify: true, targetSize: 1024 * 1024 }
      const transformed = obfuscate(source, configuration)
      setProgress({ done: 2, total: 3 })
      setResult(transformed)
      const targetBytes = configuration.targetSize
      const targetStatus = transformed.size >= targetBytes ? `target reached (${formatBytes(targetBytes)})` : `target not reached (${formatBytes(transformed.size)} / ${formatBytes(targetBytes)})`
      setStatus(transformed.verification.syntax ? `Syntax validation complete · ${formatBytes(transformed.size)} · ${targetStatus}` : 'Validation failed')
      setProgress({ done: 3, total: 3 })
      if (transformed.pressure.level === 'unsafe') setError(transformed.warnings.join(' '))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Protection failed.')
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }, [source, level])

  const cancelObfuscate = useCallback(() => {
    abortRef.current?.abort()
    setStatus('Cancelled')
    setBusy(false)
  }, [])

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
        body: JSON.stringify({ password, source: result.code, targetSize: level === 'low' ? 500 * 1024 : level === 'heavy' ? 2 * 1024 * 1024 : 1024 * 1024 }),
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
  }, [result, password, level])

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
              Syntax-aware Luau transformation · scope-safe renaming · verified output
            </p>
          </div>
          <Link href="/links" className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Manage links</Link>
        </div>
        <p className="max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">
The engine parses Luau into an AST, analyzes lexical bindings, renames only proven local references,
  and prints a compact validated result. Globals, properties, table keys, strings, and comments are
  not renamed as identifiers. Compiler and behavior verification are reported separately when tooling is unavailable.
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
                    const input = e.currentTarget
                    const file = input.files?.[0]
                    if (file) setSource(await file.text())
                    input.value = ''
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

  <section className="rounded-lg border border-border bg-card/60 p-4">
    <label htmlFor="level" className="mb-2 block font-mono text-sm font-medium text-foreground">Obfuscation Level</label>
    <select id="level" value={level} onChange={(event) => setLevel(event.target.value as 'low' | 'default' | 'heavy')} className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40">
      <option value="low">Low — 500+ KB obfuscated output target</option>
      <option value="default">Default — 1 MB obfuscated output target</option>
      <option value="heavy">Heavy — 2 MB obfuscated output target</option>
    </select>
    <p className="mt-2 text-xs text-muted-foreground">Targets are minimum goals, not padding instructions. The generated byte size below is always measured from the actual output.</p>
  </section>

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
  {busy && <Button type="button" variant="outline" onClick={cancelObfuscate} className="h-11 w-full font-mono text-sm">Cancel {progress.total ? `(${progress.done}/${progress.total})` : ''}</Button>}
  {busy && <p className="text-xs text-muted-foreground" role="status">{status}</p>}

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
            <p className="mt-3 mb-1 text-xs text-muted-foreground">Executor loadstring</p>
            <code className="block break-all rounded bg-muted p-2 font-mono text-xs text-accent">{loadstringSnippet}</code>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => navigator.clipboard.writeText(publishedUrl)} className="text-xs text-muted-foreground underline hover:text-foreground">Copy URL</button>
              <button type="button" onClick={() => navigator.clipboard.writeText(loadstringSnippet)} className="text-xs text-muted-foreground underline hover:text-foreground">Copy loadstring</button>
            </div>
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
