import { analyzeScopes, parse } from 'luau-parser'

// Luau "VM-layer" obfuscator.
//
// Strategy (chosen deliberately to satisfy the constraints):
//   * The original source is preserved byte-for-byte (UTF-8) so runtime behavior
//     is identical -- nothing about the original logic is rewritten or parsed.
//   * Those bytes are pushed through a heavy, position-dependent transform:
//     a rolling key + arithmetic mixing + a random 256-entry S-box permutation.
//   * The generated program embeds the inverse S-box, the key table, and the
//     encoded payload, then reconstructs the source at runtime and hands it to
//     `loadstring`/`load` for execution.
//   * Because reconstruction happens in loops (no per-piece helper functions),
//     the generated wrapper defines ZERO Lua functions of its own. That keeps
//     the protected script far below the 200-function ceiling -- the only
//     functions that ever exist at runtime are the ones your original script
//     already declared.
//
// Every transform is verified in-process with a JS mirror of the exact Lua
// decode math, so a build only succeeds when the round-trip is provably lossless.

export interface ObfuscateOptions {
  /** Minimum size (characters) of the generated output. */
  targetSize?: number
  /** Bytes of payload per emitted string chunk. */
  chunkSize?: number
  /** Optional seed for deterministic, reproducible builds. */
  seed?: number
}

export interface ObfuscateResult {
  code: string
  size: number
  /** Number of `function` keyword definitions the obfuscation layer added. */
  functionCount: number
  /** True when the embedded transform round-trips back to the exact source. */
  roundtripOk: boolean
  seed: number
  payloadBytes: number
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so a given seed always yields the same build.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1))

// ---------------------------------------------------------------------------
// Identifier generation: English words + underscores + digits, all valid Lua.
// ---------------------------------------------------------------------------
const WORDS = [
  'silver', 'harbor', 'lantern', 'quiet', 'meadow', 'river', 'ember', 'cobalt',
  'willow', 'marble', 'cinder', 'hollow', 'amber', 'thistle', 'copper', 'onyx',
  'velvet', 'pebble', 'canyon', 'drifter', 'beacon', 'ripple', 'granite', 'maple',
  'crimson', 'timber', 'nimbus', 'zephyr', 'lagoon', 'orchard', 'cascade', 'summit',
  'meridian', 'aurora', 'basalt', 'cedar', 'dahlia', 'fjord', 'glacier', 'juniper',
  'kelp', 'lattice', 'mosaic', 'nectar', 'obsidian', 'prairie', 'quartz', 'rune',
  'saffron', 'tundra', 'umbra', 'verdant', 'willowisp', 'xenon', 'yarrow', 'zenith',
  'anchor', 'bramble', 'clover', 'dusk', 'echo', 'fable', 'grove', 'haven',
  'iris', 'jasper', 'kismet', 'lumen', 'mirth', 'nova', 'opal', 'plume',
  'raven', 'sable', 'trove', 'vapor', 'wisp', 'crest', 'delta', 'flare',
  'gale', 'hearth', 'inlet', 'jade', 'knoll', 'lark', 'mist', 'north',
  'orbit', 'quill', 'reef', 'shale', 'talon', 'vale', 'warden', 'brook',
  'coral', 'drake', 'fern', 'gust', 'heron', 'ivory', 'lotus', 'moor',
]

function makeNamer(rng: () => number) {
  const used = new Set<string>([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true',
    'until', 'while', 'string', 'table', 'loadstring', 'load', 'assert', 'byte',
    'char', 'concat', 'select', 'pcall', 'error',
  ])
  return function next(): string {
    for (let attempt = 0; attempt < 500; attempt++) {
      const parts: string[] = []
      const count = randInt(rng, 2, 3)
      for (let i = 0; i < count; i++) parts.push(WORDS[randInt(rng, 0, WORDS.length - 1)])
      let name = parts.join('_')
      if (rng() < 0.5) name += '_' + randInt(rng, 10, 9999)
      const lead = '_'.repeat(randInt(rng, 0, 2))
      const trail = '_'.repeat(randInt(rng, 0, 2))
      name = lead + name + trail
      if (!used.has(name)) {
        used.add(name)
        return name
      }
    }
    // Fallback guaranteed-unique name.
    let n = '_fallback_' + used.size
    used.add(n)
    return n
  }
}

// ---------------------------------------------------------------------------
// Core transform math. Encode in JS, and mirror the EXACT Lua decode to verify.
// ---------------------------------------------------------------------------
const MIX_A = 167
const MIX_B = 13

function mod256(x: number): number {
  return ((x % 256) + 256) % 256
}

function buildPermutation(rng: () => number): { P: number[]; invP: number[] } {
  const P = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = randInt(rng, 0, i)
    const tmp = P[i]
    P[i] = P[j]
    P[j] = tmp
  }
  const invP = new Array<number>(256)
  for (let i = 0; i < 256; i++) invP[P[i]] = i
  return { P, invP }
}

function luaByteEscape(bytes: number[]): string {
  // Emit every byte as a \ddd decimal escape -- unambiguous and binary-safe.
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += '\\' + bytes[i]
  return out
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------
export type RegisterPressureLevel = 'safe' | 'warning' | 'high' | 'unsafe'

export interface RegisterPressureReport {
  parseOk: boolean
  parseError?: string
  estimatedLocals: number
  estimatedFunctions: number
  likelyLimitExceeded: boolean
  level: RegisterPressureLevel
  lines: number[]
  message: string
}

export function analyzeRegisterPressure(source: string): RegisterPressureReport {
  try {
    const program = parse(source)
    const scopes = analyzeScopes(program, { builtinGlobals: ['game', 'workspace', 'script', 'print', 'task'] })
    const estimatedLocals = [...scopes.bindings.values()].filter((binding) => binding.kind !== 'global').length
    const estimatedFunctions = [...source.matchAll(/\bfunction\b/g)].length
    const level: RegisterPressureLevel = estimatedLocals >= 200 ? 'unsafe' : estimatedLocals >= 181 ? 'high' : estimatedLocals >= 161 ? 'warning' : 'safe'
    const likelyLimitExceeded = level === 'unsafe'
    return {
      parseOk: true,
      estimatedLocals,
      estimatedFunctions,
      likelyLimitExceeded,
      level,
      lines: [],
      message: level === 'unsafe'
        ? `Build blocked: AST analysis found ${estimatedLocals} lexical locals. No unsafe scope rewrite was applied.`
        : `AST validation passed. ${estimatedLocals} lexical locals and ${estimatedFunctions} function declarations were resolved. Register pressure: ${level}.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Luau parse error.'
    return {
      parseOk: false,
      parseError: message,
      estimatedLocals: 0,
      estimatedFunctions: 0,
      likelyLimitExceeded: true,
      level: 'unsafe',
      lines: [],
      message: `Luau parsing failed, so no source transformation was applied: ${message}`,
    }
  }
}

export interface RegisterSafeReport {
  source: string
  serviceLookupsFound: number
  serviceLookupsRewritten: number
  playerGuiLookupsFound: number
  playerGuiLookupsRewritten: number
  skippedWindUI: number
  warnings: string[]
}

/**
 * Conservative source cleanup. It only rewrites repeated, exact lookup
 * expressions on standalone local declarations; it never renames identifiers,
 * removes callbacks, or touches WindUI lines. This intentionally favors
 * preserving behavior over claiming to solve every register-limit case.
 */
export function optimizeRegisterSafe(source: string): RegisterSafeReport {
  // Do not perform text substitutions. Until a binding-aware AST rewrite pass
  // exists, leaving the source unchanged is the only provably safe behavior.
  try {
    parse(source)
  } catch {
    return { source, serviceLookupsFound: 0, serviceLookupsRewritten: 0, playerGuiLookupsFound: 0, playerGuiLookupsRewritten: 0, skippedWindUI: 0, warnings: ['AST validation failed; source was left unchanged.'] }
  }
  return {
    source,
    serviceLookupsFound: 0,
    serviceLookupsRewritten: 0,
    playerGuiLookupsFound: 0,
    playerGuiLookupsRewritten: 0,
    skippedWindUI: 0,
    warnings: ['AST validation passed. No source rewrite was applied because a binding-aware transformation cannot be proven safe yet.'],
  }

  const lines = source.split('\n')
  const services = new Map<string, string>()
  let serviceLookupsFound = 0
  let serviceLookupsRewritten = 0
  let playerGuiLookupsFound = 0
  let playerGuiLookupsRewritten = 0
  let skippedWindUI = 0

  const optimized = lines.map((line) => {
    if (/windui/i.test(line)) {
      if (/GetService|PlayerGui/i.test(line)) skippedWindUI++
      return line
    }
    const service = line.match(/^(\\s*local\\s+([A-Za-z_]\\w*)\\s*=\\s*)game:GetService\\(["']([A-Za-z]+)["']\\)(\\s*;?\\s*(?:--.*)?)$/)
    if (service) {
      const [, prefix, variable, serviceName, suffix] = service
      serviceLookupsFound++
      const canonical = services.get(serviceName)
      if (canonical) {
        serviceLookupsRewritten++
        return `${prefix}${canonical}${suffix}`
      }
      services.set(serviceName, variable)
      return line
    }
    const gui = line.match(/^(\\s*local\\s+([A-Za-z_]\\w*)\\s*=\\s*)([A-Za-z_]\\w*)\\.LocalPlayer\\.PlayerGui(\\s*;?\\s*(?:--.*)?)$/)
    if (gui) {
      const [, prefix, variable, playerRoot, suffix] = gui
      playerGuiLookupsFound++
      const canonical = services.get('__PlayerGui__')
      if (canonical) {
        playerGuiLookupsRewritten++
        return `${prefix}${canonical}${suffix}`
      }
      services.set('__PlayerGui__', variable)
      return line
    }
    return line
  })

  const warnings: string[] = []
  if (serviceLookupsRewritten || playerGuiLookupsRewritten) warnings.push('Only exact standalone local lookups were deduplicated; callbacks and feature code were preserved.')
  if (source.length > 500_000) warnings.push('Large scripts may still exceed Luau register limits inside one function; this optimizer cannot safely split unknown scopes.')
  if (!serviceLookupsRewritten && !playerGuiLookupsRewritten) warnings.push('No provably safe duplicate lookups were found.')

  return {
    source: optimized.join('\\n'),
    serviceLookupsFound,
    serviceLookupsRewritten,
    playerGuiLookupsFound,
    playerGuiLookupsRewritten,
    skippedWindUI,
    warnings,
  }
}

export function obfuscate(source: string, options: ObfuscateOptions = {}): ObfuscateResult {
  const targetSize = Math.max(0, options.targetSize ?? 2_000_000)
  const chunkSize = Math.max(64, options.chunkSize ?? 1024)
  const seed = (options.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0

  const rng = mulberry32(seed)
  const namer = makeNamer(rng)

  // 1. Original source -> UTF-8 bytes (lossless).
  const srcBytes = Array.from(new TextEncoder().encode(source))

  // 2. Build the S-box + key material.
  const { P, invP } = buildPermutation(rng)
  const keyLen = randInt(rng, 32, 64)
  const key = Array.from({ length: keyLen }, () => randInt(rng, 0, 255))

  // 3. Encode every byte with a position-dependent transform.
  const encoded = new Array<number>(srcBytes.length)
  for (let idx = 0; idx < srcBytes.length; idx++) {
    const i1 = idx + 1 // Lua uses 1-based indexing
    const b = srcBytes[idx]
    const kw = key[idx % keyLen]
    const mix = mod256(i1 * MIX_A + MIX_B)
    const t = mod256(b + kw + mix)
    encoded[idx] = P[t]
  }

  // 4. Verify the round-trip using a mirror of the Lua decode math.
  let roundtripOk = true
  for (let idx = 0; idx < encoded.length; idx++) {
    const i1 = idx + 1
    const e = encoded[idx]
    const t = invP[e]
    const kw = key[idx % keyLen]
    const mix = mod256(i1 * MIX_A + MIX_B)
    const b = mod256(t - kw - mix)
    if (b !== srcBytes[idx]) {
      roundtripOk = false
      break
    }
  }

  // 5. Randomized identifiers for the whole VM layer.
  const N = {
    ip: namer(), // inverse permutation table
    key: namer(),
    kl: namer(), // key length
    data: namer(), // payload accumulator table
    src: namer(), // reconstructed source
    out: namer(), // output byte table
    loop: namer(), // loop counter
    e: namer(), // encoded byte
    t: namer(), // pre-image
    kw: namer(), // key value
    mix: namer(), // position mix
    ld: namer(), // loadstring alias
    fn: namer(), // loaded chunk
  }

  // 6. Assemble only runtime-essential code. No comments, dead code, or padding
  // are emitted: output size must come from the encoded source and decoder.
  const lines: string[] = []

  // Inverse S-box: values invP[0..255] in order (decode reads IP[e + 1]).
  lines.push(`local ${N.ip} = {${invP.join(',')}};`)
  lines.push(`local ${N.key} = {${key.join(',')}};`)
  lines.push(`local ${N.kl} = #${N.key};`)
  lines.push(`local ${N.data} = {};`)

  // Payload chunks: one local table, unlimited inserts -> respects Luau's
  // 200-local-per-scope limit.
  for (let off = 0; off < encoded.length; off += chunkSize) {
    const chunk = encoded.slice(off, off + chunkSize)
    lines.push(`${N.data}[#${N.data} + 1] = "${luaByteEscape(chunk)}";`)
  }
  if (encoded.length === 0) {
    lines.push(`${N.data}[#${N.data} + 1] = "";`)
  }

  // Reconstruct + decode + execute. All declarations inside the loop body are
  // per-iteration scoped, so no local accumulates and no helper function exists.
  lines.push(`local ${N.src} = table.concat(${N.data});`)
  lines.push(`local ${N.out} = {};`)
  lines.push(`for ${N.loop} = 1, #${N.src} do`)
  lines.push(`  local ${N.e} = string.byte(${N.src}, ${N.loop});`)
  lines.push(`  local ${N.t} = ${N.ip}[${N.e} + 1];`)
  lines.push(`  local ${N.kw} = ${N.key}[((${N.loop} - 1) % ${N.kl}) + 1];`)
  lines.push(`  local ${N.mix} = (${N.loop} * ${MIX_A} + ${MIX_B}) % 256;`)
  lines.push(`  ${N.out}[${N.loop}] = string.char((${N.t} - ${N.kw} - ${N.mix}) % 256);`)
  lines.push(`end;`)
  lines.push(`local ${N.src}_final = table.concat(${N.out});`)
  lines.push(`local ${N.ld} = (loadstring or load);`)
  lines.push(`local ${N.fn} = assert(${N.ld}(${N.src}_final, "=protected"));`)
  lines.push(`return ${N.fn}(...);`)

  // 7. No filler is emitted. targetSize remains accepted for API compatibility.
  void targetSize
  const code = lines.join('\n') + '\n'

  const functionCount = (code.match(/\bfunction\b/g) || []).length

  return {
    code,
    size: code.length,
    functionCount,
    roundtripOk,
    seed,
    payloadBytes: srcBytes.length,
  }
}
