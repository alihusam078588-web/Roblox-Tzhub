# Luau verification

The application uses `luau-parser` for production parsing and scope analysis. That parser is not treated as compiler verification.

## Official compiler

CI pins the official Luau repository to tag `0.693`, builds the `luau` CLI from source with CMake, and runs the regression fixtures through `pnpm verify:regression`. The browser cannot assume this native CLI exists, so production reports compiler verification as unavailable unless a separate server-side compiler service is configured.

For local verification, build the pinned Luau CLI and run:

```sh
LUAU_BIN=/path/to/luau pnpm verify:regression
LUAU_BIN=/path/to/luau pnpm verify:luau path/to/file.luau
```

The fixture runner generates 199-, 200-, and 201-local functions. It records the actual compiler result; it does not infer compilation from parsing.

## Local-limit repair status

`spillExcessLocals` is a conservative pipeline pass. It reports unsupported when a function would require spilling because no storage-table rewrite is emitted without compiler-tested binding, assignment, closure, loop, vararg, and multiple-return semantics. The obfuscator therefore never labels a 201-local result as repaired merely because AST transformation succeeded.

Compiler and behavior verification are separate result fields. The current browser build reports syntax validation separately and does not claim compiler or behavior success.
