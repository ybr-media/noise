"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { BellMark } from "@/app/bell-mark";
import { Button } from "@/app/ui/button";
import { Card } from "@/app/ui/card";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await signIn("resend", { email, redirect: false, callbackUrl: "/" });
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main className="signin-page">
      <Card className="signin-card">
        <div className="signin-lockup">
          <BellMark />
          <p className="signin-wordmark">Noise Lab</p>
        </div>
        {sent ? (
          <section aria-live="polite">
            <h1>Check your email</h1>
            <p>We sent a sign-in link if that address is invited to Noise Lab. The link expires in 15 minutes.</p>
            <Button type="button" variant="neutral" onClick={() => setSent(false)}>Use a different email</Button>
          </section>
        ) : (
          <form onSubmit={submit}>
            <h1>Sign in</h1>
            <p>Use your invited email address to open the console.</p>
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send sign-in link"}</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
