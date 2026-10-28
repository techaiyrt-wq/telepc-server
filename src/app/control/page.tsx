import { redirect } from "next/navigation";

/** Endereço antigo (versões anteriores da app) — mantém-se a funcionar. */
export default function LegacyControl() {
  redirect("/");
}
