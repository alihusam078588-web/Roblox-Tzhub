import { analyzeScopes, parse, print } from 'luau-parser'

export type ProtectionPreset = 'light' | 'balanced' | 'maximum'
export type RegisterPressureLevel = 'safe' | 'warning' | 'high' | 'unsafe'

export interface ObfuscateOptions {
  preset?: ProtectionPreset
  seed?: number
  renameLocals?: boolean
  minify?: boolean
  targetSize?: number
  chunkSize?: number
}

export interface SpillReport {
  attempted: boolean
  applied: boolean
  spilledBindings: number
  unsupported: boolean
  message: string
}

export interface RegisterPressureReport {
  parseOk: boolean
  parseError?: string
  estimatedLocals: number
  estimatedFunctions: number
  likelyLimitExceeded: boolean
  level: RegisterPressureLevel
  lines: number[]
  message: string
  functions: Array<{ name: string; locals: number; parameters: number; level: RegisterPressureLevel }>
}

export interface ObfuscateResult {
  code: string
  size: number
  functionCount: number
  roundtripOk: boolean
  seed: number
  payloadBytes: number
  pressure: RegisterPressureReport
  warnings: string[]
  spill: SpillReport
  verification: { syntax: boolean; compiler: 'not-configured' | 'unavailable' | 'passed' | 'failed'; behavior: 'not-executed' | 'passed' | 'failed' }
}

const BUILTINS = ['game', 'workspace', 'script', 'Instance', 'Vector3', 'Enum', 'task', 'print', 'pairs', 'ipairs', 'type', 'typeof', 'tostring', 'tonumber', 'string', 'table', 'math', 'coroutine', 'select', 'unpack', 'require', 'error', 'warn', 'assert', 'pcall', 'xpcall', 'next', 'setmetatable', 'getmetatable']
const RESERVED = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue'])

function levelFor(locals: number): RegisterPressureLevel {
  return locals >= 200 ? 'unsafe' : locals >= 181 ? 'high' : locals >= 161 ? 'warning' : 'safe'
}

function lineOf(node: any): number { return node?.line?.start ?? 0 }

export function analyzeRegisterPressure(source: string): RegisterPressureReport {
  try {
    const program: any = parse(source)
    const analysis: any = analyzeScopes(program, { builtinGlobals: BUILTINS })
    const bindings = [...analysis.bindings.values()].filter((binding: any) => binding.kind !== 'global') as any[]
    const estimatedLocals = bindings.length
    const estimatedFunctions = countFunctions(program)
    const functions = collectFunctions(program).map((item) => {
      const locals = item.bindings.filter((binding: any) => binding.kind === 'local' || binding.kind.startsWith('for-')).length
      const parameters = item.bindings.filter((binding: any) => binding.kind === 'param').length
      return { name: item.name, locals, parameters, level: levelFor(locals + parameters) }
    })
    const level = levelFor(estimatedLocals)
    return { parseOk: true, estimatedLocals, estimatedFunctions, likelyLimitExceeded: level === 'unsafe', level, lines: functions.filter((f) => f.level !== 'safe').map((f) => 0), functions, message: level === 'unsafe' ? `Input contains ${estimatedLocals} lexical locals. The engine will not claim local-limit repair without a verified storage transformation.` : `Syntax and scope analysis passed. Register pressure: ${level}.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Luau parse error.'
    return { parseOk: false, parseError: message, estimatedLocals: 0, estimatedFunctions: 0, likelyLimitExceeded: true, level: 'unsafe', lines: [], functions: [], message: `Luau parsing failed: ${message}` }
  }
}

function countFunctions(node: any): number {
  let count = 0
  walk(node, (value) => { if (value?.type === 'FunctionBody' || value?.type === 'FunctionExpression') count++ })
  return count
}

function walk(node: any, visitor: (node: any) => void, seen = new Set<any>()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node); visitor(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visitor, seen)
    else if (value && typeof value === 'object') walk(value, visitor, seen)
  }
}

function collectFunctions(program: any) {
  const result: Array<{ name: string; bindings: any[] }> = []
  const analysis: any = analyzeScopes(program, { builtinGlobals: BUILTINS })
  const allBindings = [...analysis.bindings.values()] as any[]
  walk(program, (node) => {
    if (node.type === 'FunctionBody') {
      const start = lineOf(node)
      const end = node.line?.end ?? start
      const bindings = allBindings.filter((binding) => {
        const declaration = binding.declarationNode
        const line = lineOf(declaration)
        return line >= start && line <= end && binding.kind !== 'global'
      })
      result.push({ name: 'function@' + start, bindings })
    }
  })
  return result
}

function makeName(index: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  let value = index + 1
  let name = ''
  while (value > 0) { value--; name = alphabet[value % alphabet.length] + name; value = Math.floor(value / alphabet.length) }
  return '_' + name
}

function renameBindings(program: any, analysis: any): number {
  let renamed = 0
  let index = 0
  for (const binding of analysis.bindings.values() as any) {
    if (binding.kind === 'global' || binding.isBuiltin || !binding.declarationNode) continue
    let name = makeName(index++)
    while (RESERVED.has(name)) name = makeName(index++)
    binding.name = name
    binding.declarationNode.name = name
    for (const reference of binding.references) reference.name = name
    renamed++
  }
  return renamed
}

function numberLiteral(value: number): any { return { type: 'NumberLiteral', value, raw: String(value), line: { start: 0, end: 0 }, column: { start: 0, end: 0 } } }

function encodeStringLiterals(program: any, mode: 'none' | 'long' | 'all'): number {
  let encoded = 0
  walk(program, (node) => {
    if (node.type !== 'StringLiteral' || typeof node.value !== 'string') return
    if (mode === 'none' || (mode === 'long' && node.value.length < 4)) return
    const chars = [...node.value].map((char) => numberLiteral(char.codePointAt(0) ?? 0))
    node.type = 'CallExpression'
    node.callee = { type: 'MemberExpression', object: { type: 'Identifier', name: 'string' }, property: { type: 'Identifier', name: 'char' } }
    node.arguments = chars
    delete node.value
    delete node.raw
    encoded++
  })
  return encoded
}

function preserveDirectives(source: string): string {
  const directives = source.split(/\r?\n/).filter((line) => /^\s*--!/.test(line))
  return directives.length ? directives.join('\n') + '\n' : ''
}

export function spillExcessLocals(_program: any, pressure: RegisterPressureReport): SpillReport {
  if (!pressure.likelyLimitExceeded) return { attempted: false, applied: false, spilledBindings: 0, unsupported: false, message: 'Local-limit repair was not needed.' }
  return { attempted: true, applied: false, spilledBindings: 0, unsupported: true, message: 'Storage spilling is unsupported until binding-preserving declaration, assignment, closure, loop, vararg, and multi-return rewrites are compiler-tested.' }
}

export function obfuscate(source: string, options: ObfuscateOptions = {}): ObfuscateResult {
  const pressure = analyzeRegisterPressure(source)
  if (!pressure.parseOk) throw new Error(pressure.message)
  const program: any = parse(source)
  const spill = spillExcessLocals(program, pressure)
  const analysis: any = analyzeScopes(program, { builtinGlobals: BUILTINS })
  const preset = options.preset ?? 'balanced'
  const renamed = options.renameLocals ?? preset !== 'light' ? renameBindings(program, analysis) : 0
  const stringMode = preset === 'maximum' ? 'all' : preset === 'balanced' ? 'long' : 'none'
  const encodedStrings = encodeStringLiterals(program, stringMode)
  const printed = print(program, { quote: '"' })
  const rendered = options.minify === false ? printed.trim() : printed.replace(/\s+/g, ' ').trim()
  const code = preserveDirectives(source) + rendered + '\n'
  const verification = (() => { try { parse(code); return true } catch { return false } })()
  if (!verification) throw new Error('Generated output failed syntax validation.')
  const size = new TextEncoder().encode(code).byteLength
  const target = options.targetSize ?? 0
  const warnings = [...(spill.unsupported ? [spill.message] : []), ...(pressure.level === 'high' ? ['High register pressure detected; no unverified local-storage rewrite was applied.'] : []), ...(pressure.level === 'unsafe' ? ['This input exceeds the conservative 200-local threshold. Output is not claimed to repair compiler register allocation.'] : []), `${renamed} lexical bindings renamed with scope analysis.`, `${encodedStrings} string literals encoded with runtime string.char reconstruction.`, ...(target > 0 && size < target ? [`Genuine transformations produced ${size} bytes, below the ${target} byte target; no padding or junk was added.`] : [])]
  return { code, size, functionCount: pressure.estimatedFunctions, roundtripOk: true, seed: options.seed ?? 0, payloadBytes: new TextEncoder().encode(source).length, pressure, spill, warnings, verification: { syntax: true, compiler: 'unavailable', behavior: 'not-executed' } }
}

export function optimizeRegisterSafe(source: string) { return { source, serviceLookupsFound: 0, serviceLookupsRewritten: 0, playerGuiLookupsFound: 0, playerGuiLookupsRewritten: 0, skippedWindUI: 0, warnings: ['Safe optimizer performs no storage rewrite without a verified Luau compiler.'] } }
