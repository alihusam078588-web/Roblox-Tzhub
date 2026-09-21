'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function SignUpPage() {
  const router = useRouter(); const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [claim, setClaim] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(''); const result = await authClient.signUp.email({ email, password, name }); if (result.error) return setError('Unable to create the account.'); const claimResult = await fetch('/api/admin/claim', { method: 'POST' }); setClaim(claimResult.ok); router.push(claimResult.ok ? '/dashboard' : '/sign-in') }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6"><form onSubmit={submit} className="w-full rounded-2xl border border-border bg-card p-6"><p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">TZ HUB</p><h1 className="mt-3 text-2xl font-semibold">Create the first admin</h1><p className="mt-2 text-sm text-muted-foreground">Only the first account can claim initial admin access. Later registrations are not administrators.</p><div className="mt-6 flex flex-col gap-3"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="rounded-lg border border-border bg-background px-3 py-2" /><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-border bg-background px-3 py-2" /><input required minLength={12} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (12+ characters)" className="rounded-lg border border-border bg-background px-3 py-2" /><button className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">Create secure admin</button>{claim && <p className="text-sm text-accent">Initial admin access claimed.</p>}{error && <p className="text-sm text-destructive">{error}</p>}</div></form></main>
}
