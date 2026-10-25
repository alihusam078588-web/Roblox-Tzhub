import { obfuscate } from '../lib/obfuscator.ts'

const inputs = {
  unicode: 'local greeting = "héllo 世界"\nreturn greeting',
  escaped: 'local value = "quote: \\\" null: \\0 tab: \\t"\nreturn value',
  shadowed: 'local string = { char = function() error("shadowed") end }\nlocal value = "safe"\nreturn value',
  nested: 'local function outer(a) local function inner(b) local c = a + b return c end return inner(2) end return outer(3)',
  large: `local value = "${'x'.repeat(5000)}"\nreturn value`,
}

for (const [name, source] of Object.entries(inputs)) {
  for (const [level, preset] of [['low', 'light'], ['default', 'balanced'], ['heavy', 'maximum']] as const) {
    const result = obfuscate(source, { preset, renameLocals: level !== 'low', minify: level !== 'low', targetSize: level === 'low' ? 500 * 1024 : level === 'default' ? 1024 * 1024 : 2 * 1024 * 1024 })
    if (!result.verification.syntax || result.roundtripOk !== true) throw new Error(`${name}/${level}: syntax verification failed`)
    console.log(JSON.stringify({ name, level, bytes: result.size, targetReached: result.size >= (level === 'low' ? 500 * 1024 : level === 'default' ? 1024 * 1024 : 2 * 1024 * 1024), parses: result.verification.syntax, behavior: result.verification.behavior }))
  }
}
