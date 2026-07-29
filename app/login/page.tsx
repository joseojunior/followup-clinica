"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseAuthConfig } from "@/lib/supabase/config";

export default function LoginPage() {
  const router = useRouter();
  const configured = hasSupabaseAuthConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível entrar. Confira seus dados.");
      return;
    }
    setState("idle");
  }

  return <main className="login-shell">
    <section className="login-context" aria-label="Acesso ao painel">
      <div className="login-brand"><span>F</span>fluxo<i>.</i></div>
      <p className="eyebrow">CENTRAL DE FOLLOW-UP</p>
      <h1>O cuidado começa antes da próxima mensagem.</h1>
      <p>Entre para acompanhar campanhas, contatos e disparos da clínica em um só lugar.</p>
      <div className="login-steps"><span>01 · Acompanhar</span><span>02 · Planejar</span><span>03 · Enviar</span></div>
    </section>
    <section className="login-card">
      <div><p className="eyebrow">Acesso restrito</p><h2>Entrar no painel</h2><p>Use o e-mail e a senha criados no Supabase.</p></div>
      {configured ? <form onSubmit={signIn}>
        <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        <button className="primary-button" disabled={state === "loading"}>{state === "loading" ? "Entrando..." : "Entrar"}</button>
        {message && <p className="login-message">{message}</p>}
      </form> : <div className="login-setup">
        <strong>Conecte o Supabase Auth</strong>
        <p>Adicione a URL do projeto e a chave pública do Supabase ao arquivo <code>.env.local</code>. Em seguida, reinicie o servidor.</p>
      </div>}
    </section>
  </main>;
}
