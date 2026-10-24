import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const binary = process.env.LUAU_BIN || 'luau'
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: LUAU_BIN=/path/to/luau pnpm verify:luau <file> [...files]')
  process.exit(2)
}
try {
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
  console.log(`Luau compiler: ${version}`)
  for (const file of files) {
    const source = readFileSync(resolve(file), 'utf8')
    execFileSync(binary, ['--compile', 'none', '-'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] })
    console.log(`PASS ${file}`)
  }
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error(`Luau compiler unavailable. Set LUAU_BIN to an official Luau CLI binary.`)
  } else {
    console.error(error?.stderr?.toString() || error?.message || 'Luau compiler rejected input.')
  }
  process.exit(1)
}
