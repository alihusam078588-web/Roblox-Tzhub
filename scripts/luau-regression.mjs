import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const dir = resolve('.tmp/luau-regression')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const fixture = (count) => `local function pressure()\n${Array.from({ length: count }, (_, i) => `  local v${i} = ${i}`).join('\n')}\n  return v${count - 1}\nend\nreturn pressure()`
for (const count of [199, 200, 201]) writeFileSync(resolve(dir, `${count}.luau`), fixture(count))
const files = [199, 200, 201].map((count) => resolve(dir, `${count}.luau`))
const binary = process.env.LUAU_BIN
if (!binary) {
  console.log('Fixtures generated. Compiler execution skipped: LUAU_BIN is not set.')
  process.exit(0)
}
for (const file of files) {
  try { execFileSync(binary, ['--compile', 'none', '-'], { input: readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'] }); console.log(`PASS ${file}`) }
  catch (error) { console.log(`REJECT ${file}: ${error.stderr?.toString() || error.message}`) }
}
