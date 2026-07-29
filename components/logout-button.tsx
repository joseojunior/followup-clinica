"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  return <button className="logout-button" onClick={signOut} disabled={loading}>{loading ? "Saindo..." : "Sair"}</button>;
}
