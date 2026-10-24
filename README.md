# TZ HUB Obfuscator

## Obfuscation providers

The provider selector keeps the existing rbx.lol-backed obfuscator available. LuaProtect is shown for visibility, but remains unavailable until LuaProtect documents a public script-obfuscation endpoint.

LuaProtect's documented API uses server-side bearer API keys for management operations. Its dashboard obfuscation request is an internal session/Turnstile flow, so this app does not guess or bypass it and does not send source code to that endpoint.

When LuaProtect publishes a supported obfuscation API, add its API key as a server-only Vercel environment variable and proxy requests through a server route. Never expose the key in browser code or logs.
