export type ProtectStats = { inputBytes: number; compactedBytes: number; pieces: number; requests: number }
export type ProtectResult = { ok: boolean; out: string; error?: string; stats: ProtectStats }
export type ProtectOptions = { onStatus?: (status: string) => void; onProgress?: (value: number) => void; signal?: AbortSignal }

const MAX_SOURCE_BYTES = 256 * 1024

function compact(source: string) {
  let out = ''
  let quote: string | null = null
  let comment = false
  let longComment = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (longComment) { if (ch === ']' && next === ']') { longComment = false; i++ } continue }
    if (comment) { if (ch === '\n') comment = false; continue }
    if (quote) { out += ch; if (ch === '\\') out += source[++i] ?? ''; else if (ch === quote) quote = null; continue }
    if ((ch === '"' || ch === "'") && !quote) { quote = ch; out += ch; continue }
    if (ch === '-' && next === '-') {
      if (source[i + 2] === '[' && source[i + 3] === '[') { longComment = true; i += 3 } else { comment = true; i++ }
      continue
    }
    out += ch
  }
  return out.replace(/[ \t\r\n]+/g, ' ').trim()
}

function splitChunks(source: string) {
  const chunks: string[] = []
  let start = 0
  let quote: string | null = null
  let depth = 0
  let lastSafe = 0
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    if ((ch === ';' || ch === '\n') && depth === 0) lastSafe = i + 1
    if (new TextEncoder().encode(source.slice(start, i + 1)).byteLength > MAX_SOURCE_BYTES - 4096) {
      const cut = lastSafe > start ? lastSafe : i + 1
      chunks.push(source.slice(start, cut).trim())
      start = cut
      lastSafe = start
    }
  }
  if (source.slice(start).trim()) chunks.push(source.slice(start).trim())
  return chunks.length ? chunks : ['']
}

async function callProtect(source: string, signal?: AbortSignal) {
  const response = await fetch('/api/protect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }), signal })
  const data = await response.json() as { ok?: boolean; protected?: string; error?: string }
  if (!response.ok || !data.ok || typeof data.protected !== 'string') throw new Error(data.error || `Protection request failed (${response.status}).`)
  return data.protected
}

export async function protectBig(source: string, options: ProtectOptions = {}): Promise<ProtectResult> {
  const stats: ProtectStats = { inputBytes: new TextEncoder().encode(source).byteLength, compactedBytes: 0, pieces: 0, requests: 0 }
  try {
    const compacted = compact(source)
    stats.compactedBytes = new TextEncoder().encode(compacted).byteLength
    const pieces = splitChunks(compacted)
    stats.pieces = pieces.length
    const output: string[] = []
    for (let i = 0; i < pieces.length; i++) {
      if (options.signal?.aborted) throw new DOMException('Protection cancelled.', 'AbortError')
      options.onStatus?.(`Protecting piece ${i + 1} of ${pieces.length}…`)
      output.push(await callProtect(pieces[i], options.signal))
      stats.requests++
      options.onProgress?.((i + 1) / pieces.length)
    }
    options.onStatus?.('Protection complete.')
    return { ok: true, out: output.join('\n'), stats }
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError' ? 'Protection cancelled.' : error instanceof Error ? error.message : 'Protection failed.'
    return { ok: false, out: '', error: message, stats }
  }
}
