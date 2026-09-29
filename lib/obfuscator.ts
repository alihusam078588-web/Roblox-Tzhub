export interface ObfuscateOptions {
  targetSize?: number
  chunkSize?: number
  seed?: number
}

export interface ObfuscateResult {
  code: string
  size: number
  functionCount: number
  roundtripOk: boolean
  wrapperOk: boolean
  seed: number
  payloadBytes: number
}

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

function randInt(
  rng: () => number,
  min: number,
  max: number,
): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function mod256(x: number): number {
  return ((x % 256) + 256) % 256
}

function buildPermutation(
  rng: () => number,
): {
  box: number[]
  inv: number[]
} {
  const box = Array.from(
    { length: 256 },
    (_, i) => i,
  )

  for (let i = 255; i > 0; i--) {
    const j = randInt(rng, 0, i)

    const temp = box[i]
    box[i] = box[j]
    box[j] = temp
  }

  const inv = new Array<number>(256)

  for (let i = 0; i < 256; i++) {
    inv[box[i]] = i
  }

  return {
    box,
    inv,
  }
}

function makeIdentifier(
  rng: () => number,
  used: Set<string>,
): string {
  while (true) {
    const id =
      `_v${randInt(rng, 0x10000, 0xffffff).toString(16)}_` +
      `${randInt(rng, 0x1000, 0xffff).toString(16)}`

    if (!used.has(id)) {
      used.add(id)
      return id
    }
  }
}

function decimalEscape(bytes: number[]): string {
  // Joining an array avoids repeated string reallocations for large payloads.
  const escaped = new Array<string>(bytes.length)

  for (let i = 0; i < bytes.length; i++) {
    escaped[i] = `\\${bytes[i]}`
  }

  return escaped.join("")
}

function randomHex(
  rng: () => number,
  count: number,
): string {
  const alphabet = "0123456789abcdef"

  let out = ""

  for (let i = 0; i < count; i++) {
    out += alphabet[
      randInt(rng, 0, alphabet.length - 1)
    ]
  }

  return out
}

const HASH_MOD = 1_000_000_007
const HASH_SEED = 216613626

const MIX_A1 = 167
const MIX_B1 = 13

const MIX_A2 = 73
const MIX_B2 = 91

function hashBytes(bytes: number[]): number {
  let hash = HASH_SEED

  for (let i = 0; i < bytes.length; i++) {
    hash =
      (
        hash * 257 +
        bytes[i] +
        i +
        1
      ) % HASH_MOD
  }

  return hash
}

export function obfuscate(
  source: string,
  options: ObfuscateOptions = {},
): ObfuscateResult {
  const targetSize = Math.max(
    0,
    Math.floor(
      options.targetSize ?? 2_000_000,
    ),
  )

  const chunkSize = Math.max(
    64,
    Math.floor(
      options.chunkSize ?? 768,
    ),
  )

  const seed = (
    options.seed ??
    Math.floor(
      Math.random() * 0x1_0000_0000,
    )
  ) >>> 0

  const rng = mulberry32(seed)

  const used = new Set<string>()

  const N = {
    p1: makeIdentifier(rng, used),
    p2: makeIdentifier(rng, used),

    k1: makeIdentifier(rng, used),
    k2: makeIdentifier(rng, used),

    data: makeIdentifier(rng, used),
    src: makeIdentifier(rng, used),
    out: makeIdentifier(rng, used),

    i: makeIdentifier(rng, used),
    x: makeIdentifier(rng, used),
    y: makeIdentifier(rng, used),
    z: makeIdentifier(rng, used),

    hash: makeIdentifier(rng, used),

    load: makeIdentifier(rng, used),
    fn: makeIdentifier(rng, used),
    err: makeIdentifier(rng, used),
  }

  const sourceBytes = Array.from(
    new TextEncoder().encode(source),
  )

  const first = buildPermutation(rng)
  const second = buildPermutation(rng)

  const keyLength1 = randInt(
    rng,
    48,
    64,
  )

  const keyLength2 = randInt(
    rng,
    48,
    64,
  )

  const key1 = Array.from(
    { length: keyLength1 },
    () => randInt(rng, 0, 255),
  )

  const key2 = Array.from(
    { length: keyLength2 },
    () => randInt(rng, 0, 255),
  )

  /*
   * Layer 1:
   *
   * source byte
   * -> position mix
   * -> key
   * -> permutation
   *
   * Layer 2:
   *
   * result of layer 1
   * -> second position mix
   * -> second key
   * -> second permutation
   */

  const encoded = new Array<number>(
    sourceBytes.length,
  )

  for (
    let index = 0;
    index < sourceBytes.length;
    index++
  ) {
    const position = index + 1

    const firstValue = mod256(
      sourceBytes[index] +
      key1[index % keyLength1] +
      mod256(
        position * MIX_A1 +
        MIX_B1,
      ),
    )

    const firstMapped =
      first.box[firstValue]

    const secondValue = mod256(
      firstMapped +
      key2[index % keyLength2] +
      mod256(
        position * MIX_A2 +
        MIX_B2,
      ),
    )

    encoded[index] =
      second.box[secondValue]
  }

  /*
   * Internal build verification.
   */

  const decoded = new Array<number>(
    encoded.length,
  )

  for (
    let index = 0;
    index < encoded.length;
    index++
  ) {
    const position = index + 1

    const secondMapped =
      second.inv[encoded[index]]

    const firstValue = mod256(
      secondMapped -
      key2[index % keyLength2] -
      mod256(
        position * MIX_A2 +
        MIX_B2,
      ),
    )

    const firstMapped =
      first.inv[firstValue]

    decoded[index] = mod256(
      firstMapped -
      key1[index % keyLength1] -
      mod256(
        position * MIX_A1 +
        MIX_B1,
      ),
    )
  }

  const roundtripOk =
    decoded.length === sourceBytes.length &&
    decoded.every(
      (value, index) =>
        value === sourceBytes[index],
    )

  if (!roundtripOk) {
    throw new Error(
      "Internal obfuscation round-trip failed",
    )
  }

  const expectedHash =
    hashBytes(sourceBytes)

  /*
   * Split payload into chunks.
   */

  const chunks: string[] = []

  for (
    let offset = 0;
    offset < encoded.length;
    offset += chunkSize
  ) {
    chunks.push(
      decimalEscape(
        encoded.slice(
          offset,
          offset + chunkSize,
        ),
      ),
    )
  }

  if (chunks.length === 0) {
    chunks.push("")
  }

  /*
   * Randomize the order in which assignments
   * appear in the generated source.
   *
   * Their numeric indexes remain correct,
   * so table.concat() still restores order.
   */

  const order = Array.from(
    {
      length: chunks.length,
    },
    (_, index) => index,
  )

  for (
    let i = order.length - 1;
    i > 0;
    i--
  ) {
    const j = randInt(rng, 0, i)

    const temp = order[i]
    order[i] = order[j]
    order[j] = temp
  }

  const lines: string[] = []

  /*
   * Required prefix.
   */

  lines.push(
    "return(function(...)",
  )

  /*
   * Inverse S-box tables.
   */

  lines.push(
    `local ${N.p1}={` +
    `${first.inv.join(",")};};`,
  )

  lines.push(
    `local ${N.p2}={` +
    `${second.inv.join(",")};};`,
  )

  /*
   * Keys.
   */

  lines.push(
    `local ${N.k1}={` +
    `${key1.join(",")};};`,
  )

  lines.push(
    `local ${N.k2}={` +
    `${key2.join(",")};};`,
  )

  /*
   * Payload table.
   */

  lines.push(
    `local ${N.data}={};`,
  )

  /*
   * Emit chunks in shuffled source order.
   */

  for (const index of order) {
    lines.push(
      `${N.data}[${index + 1}]=` +
      `"${chunks[index]}";`,
    )
  }

  /*
   * Join encoded bytes.
   */

  lines.push(
    `local ${N.src}=table.concat(${N.data});`,
  )

  /*
   * Output table.
   */

  lines.push(
    `local ${N.out}={};`,
  )

  /*
   * Integrity hash.
   */

  lines.push(
    `local ${N.hash}=${HASH_SEED};`,
  )

  /*
   * Runtime decode.
   */

  lines.push(
    `for ${N.i}=1,#${N.src} do`,
  )

  lines.push(
    `  local ${N.x}=` +
    `string.byte(${N.src},${N.i});`,
  )

  /*
   * Reverse layer 2.
   */

  lines.push(
    `  local ${N.y}=` +
    `${N.p2}[${N.x}+1];`,
  )

  lines.push(
    `  ${N.y}=` +
    `(${N.y}-` +
    `${N.k2}[((${N.i}-1)%#${N.k2})+1]-` +
    `(((${N.i}*${MIX_A2}+${MIX_B2})%256))` +
    `)%256;`,
  )

  /*
   * Reverse layer 1.
   */

  lines.push(
    `  local ${N.z}=` +
    `${N.p1}[${N.y}+1];`,
  )

  lines.push(
    `  ${N.z}=` +
    `(${N.z}-` +
    `${N.k1}[((${N.i}-1)%#${N.k1})+1]-` +
    `(((${N.i}*${MIX_A1}+${MIX_B1})%256))` +
    `)%256;`,
  )

  /*
   * Convert the recovered byte into
   * a string character.
   */

  lines.push(
    `  ${N.out}[${N.i}]=` +
    `string.char(${N.z});`,
  )

  /*
   * Runtime integrity verification.
   */

  lines.push(
    `  ${N.hash}=` +
    `(${N.hash}*257+${N.z}+${N.i})` +
    `%${HASH_MOD};`,
  )

  lines.push("end;")

  lines.push(
    `if ${N.hash}~=${expectedHash} then ` +
    `error("integrity check failed",0); ` +
    `end;`,
  )

  /*
   * Reconstruct original source.
   */

  lines.push(
    `local ${N.src}_final=` +
    `table.concat(${N.out});`,
  )

  /*
   * Load the reconstructed source.
   */

  lines.push(
    `local ${N.load}=loadstring or load;`,
  )

  lines.push(
    `local ${N.fn},${N.err}=` +
    `${N.load}(${N.src}_final,"=protected");`,
  )

  lines.push(
    `if not ${N.fn} then ` +
    `error(${N.err},0); ` +
    `end;`,
  )

  /*
   * Forward the original varargs.
   */

  lines.push(
    `return ${N.fn}(...);`,
  )

  /*
   * Close the required wrapper.
   */

  lines.push(
    "end)(...);",
  )

  /*
   * Emit the protected program as ONE physical line.
   *
   * Semicolons are already used between generated statements,
   * so removing generator newlines does not change the Lua/Luau
   * statement boundaries. No line comments are emitted here.
   */

  let code = lines.join("")

  /*
   * Size padding.
   *
   * Padding is a block comment so the entire generated output
   * remains a single physical line and never turns the rest of
   * the program into a line comment.
   */

  if (targetSize > code.length) {
    let remaining = targetSize - code.length

    while (remaining > 0) {
      const payloadLength = Math.min(
        1024,
        Math.max(1, remaining - 6),
      )

      const blob = randomHex(
        rng,
        payloadLength,
      )

      const piece = `--[[${blob}]]`
      code += piece
      remaining -= piece.length
    }
  }

  /*
   * Generator-level checks.
   */

  const wrapperOk =
    code.startsWith(
      "return(function(...)",
    ) &&
    code.includes(
      "end)(...);",
    ) &&
    !code.includes("\n") &&
    !code.includes("\r")

  const functionCount =
    (
      code.match(
        /\bfunction\s*\(/g,
      ) || []
    ).length

  return {
    code,
    size: code.length,
    functionCount,
    roundtripOk,
    wrapperOk,
    seed,
    payloadBytes: sourceBytes.length,
  }
}
