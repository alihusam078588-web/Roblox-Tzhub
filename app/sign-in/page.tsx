'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const result = await authClient.signIn.email({ email, password })
    if (result.error) setError('Unable to sign in with those credentials.')
    else router.push('/dashboard')
  }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6"><form onSubmit={submit} className="w-full rounded-2xl border border-border bg-card p-6"><p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">TZ HUB</p><h1 className="mt-3 text-2xl font-semibold">Admin sign in</h1><div className="mt-6 flex flex-col gap-3"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-border bg-background px-3 py-2" /><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="rounded-lg border border-border bg-background px-3 py-2" /><button className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">Sign in</button>{error && <p className="text-sm text-destructive">{error}</p>}<Link href="/sign-up" className="text-center text-xs text-muted-foreground hover:text-foreground">Create the first admin account</Link></div></form></main>
}
