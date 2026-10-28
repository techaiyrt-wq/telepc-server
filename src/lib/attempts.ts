export interface Attempt {
  id: number;
  at: number;
  name: string;
  platform: string;
  status: number;
  detail: string;
  hostname?: string;
  tokenPrefix?: string;
}

/** Traduz o erro técnico do agente numa instrução que se percebe. */
export function explainAttempt(attempt: Attempt): string {
  if (attempt.status === 401) {
    return "O PC chegou ao hub, mas o código estava errado (provavelmente geraste um novo entretanto). Descarrega o instalador atualizado e volta a abri-lo no PC.";
  }
  if (attempt.status === 404) {
    return "O endereço respondeu mas não é um hub TelePC. O endereço muda quando o servidor reinicia: descarrega o instalador atualizado.";
  }
  if (attempt.status >= 500) {
    return "O hub teve um problema momentâneo. Tenta outra vez dentro de alguns segundos.";
  }
  return "O PC não conseguiu chegar a este endereço. Confirma que tem internet e descarrega o instalador atualizado — o endereço do hub muda quando o servidor reinicia.";
}
