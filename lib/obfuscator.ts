import { analyzeScopes, parse, print } from 'luau-parser'

export type ProtectionPreset = 'light' | 'balanced' | 'maximum'
export type RegisterPressureLevel = 'safe' | 'warning' | 'high' | 'unsafe'

export interface ObfuscateOptions {
  preset?: ProtectionPreset
  seed?: number
  renameLocals?: boolean
  minify?: boolean
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
  verification: { syntax: boolean; compiler: 'not-configured'; behavior: 'not-executed' }
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

function preserveDirectives(source: string): string {
  const directives = source.split(/\r?\n/).filter((line) => /^\s*--!/.test(line))
  return directives.length ? directives.join('\n') + '\n' : ''
}

export function obfuscate(source: string, options: ObfuscateOptions = {}): ObfuscateResult {
  const pressure = analyzeRegisterPressure(source)
  if (!pressure.parseOk) throw new Error(pressure.message)
  const program: any = parse(source)
  const analysis: any = analyzeScopes(program, { builtinGlobals: BUILTINS })
  const preset = options.preset ?? 'balanced'
  const renamed = options.renameLocals ?? preset !== 'light' ? renameBindings(program, analysis) : 0
  const rendered = print(program, { quote: '"' }).replace(/\s+/g, ' ').trim()
  const code = preserveDirectives(source) + rendered + '\n'
  const verification = (() => { try { parse(code); return true } catch { return false } })()
  if (!verification) throw new Error('Generated output failed syntax validation.')
  const warnings = [...(pressure.level === 'high' ? ['High register pressure detected; no unverified local-storage rewrite was applied.'] : []), ...(pressure.level === 'unsafe' ? ['This input exceeds the conservative 200-local threshold. Output is not claimed to repair compiler register allocation.'] : []), ...(preset === 'maximum' ? ['Maximum selects stronger safe renaming only; VM protection and constant encryption are intentionally unsupported.'] : []), `${renamed} lexical bindings renamed with scope analysis.`]
  return { code, size: code.length, functionCount: pressure.estimatedFunctions, roundtripOk: true, seed: options.seed ?? 0, payloadBytes: new TextEncoder().encode(source).length, pressure, warnings, verification: { syntax: true, compiler: 'not-configured', behavior: 'not-executed' } }
}

export function optimizeRegisterSafe(source: string) { return { source, serviceLookupsFound: 0, serviceLookupsRewritten: 0, playerGuiLookupsFound: 0, playerGuiLookupsRewritten: 0, skippedWindUI: 0, warnings: ['Safe optimizer performs no storage rewrite without a verified Luau compiler.'] } }
