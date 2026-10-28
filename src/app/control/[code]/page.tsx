import { redirect } from "next/navigation";

/** Endereço antigo baseado em código: encaminha para o painel atual. */
export default function LegacyControlCode() {
  redirect("/");
}
