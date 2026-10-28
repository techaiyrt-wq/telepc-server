"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Btn, Chip, Empty, Panel, Pill } from "@/components/ui";
import { haptic, useStandalone } from "@/lib/ux";

export default function MobileInstall() {
  const standalone = useStandalone();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Mostra a dica de instalação apenas se ainda não estiver instalado como app.
    if (!standalone && !shown) {
      const t = setTimeout(() => setShown(true), 1200);
      return () => clearTimeout(t);
    }
  }, [standalone, shown]);

  return (
    <div className="app-shell mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-20 pt-3">
      <header className="flex items-center gap-3 pt-1">
        <Link href="/" className="btn btn-ghost !min-h-0 !px-2.5 !py-2 text-lg" aria-label="Voltar">
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold tracking-tight">
            Instalar o TelePC
            <span className="ml-2 text-signal-300 text-xs">grátis</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-mist-500">
            Não custa nada, não precisa de App Store e não ocupa quase espaço.
          </p>
        </div>
        {standalone ? (
          <Pill tone="ok">
            <span className="dot dot-on pulse" /> Já instalada
          </Pill>
        ) : (
          <Pill tone="info">PWA (Progressive Web App)</Pill>
        )}
      </header>

      <Panel title="O que é isto?" icon="📱" hint="É um site que funciona como app: fica com ícone no ecrã, abre sem barras do navegador e até funciona sem internet.">
        <div className="grid grid-cols-2 gap-3">
          <div className="card-flat p-3">
            <span className="text-2xl">💸</span>
            <h3 className="mt-1.5 text-[13px] font-bold">Grátis para sempre</h3>
            <p className="mt-1 text-[11px] text-mist-500">
              Sem subscrição, sem compras dentro da app e sem registo obrigatório.
            </p>
          </div>
          <div className="card-flat p-3">
            <span className="text-2xl">🔒</span>
            <h3 className="mt-1.5 text-[13px] font-bold">Só o teu PC e tu</h3>
            <p className="mt-1 text-[11px] text-mist-500">
              A ligação é direta entre o telemóvel e o teu computador pelo teu próprio hub.
            </p>
          </div>
          <div className="card-flat p-3 col-span-2">
            <span className="text-2xl">⚡</span>
            <h3 className="mt-1.5 text-[13px] font-bold">Instala em 30 segundos</h3>
            <p className="mt-1 text-[11px] text-mist-500">
              Abre no navegador, toca em Partilhar (iPhone) ou no menu (Android) e escolhe adicionar ao ecrã principal.
            </p>
          </div>
        </div>
      </Panel>

      {/* --------------------------------------------- iPhone */}
      <Panel title="iPhone — Safari" icon="🍎" hint="O iPhone não tem App Store para isto: usas o Safari mesmo." glow>
        <ol className="flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-mist-300">
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">1</span>
            <div className="min-w-0">
              <p className="font-semibold">Abre o TelePC no Safari</p>
              <p className="text-[11px] text-mist-500">Vais ao endereço do teu hub (ex.: <span className="mono">https://teu-servidor.com</span>).</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">2</span>
            <div className="min-w-0">
              <p className="font-semibold">Toca em Partilhar</p>
              <p className="text-[11px] text-mist-500">É o quadrado com a seta para cima, em baixo no ecrã.</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">3</span>
            <div className="min-w-0">
              <p className="font-semibold">Escolhe «Adicionar ao ecrã principal»</p>
              <p className="text-[11px] text-mist-500">Desliza a linha de ícones se não aparecer à primeira.</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">4</span>
            <div className="min-w-0">
              <p className="font-semibold">Confirma em «Adicionar»</p>
              <p className="text-[11px] text-mist-500">O ícone TelePC aparece no teu ecrã como uma app nativa.</p>
            </div>
          </li>
        </ol>
        <div className="mt-3 rounded-xl border border-line-soft bg-ink-950/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm">💡</span>
            <p className="text-[11px] leading-relaxed text-mist-500">
              Se usares o TelePC pelo ecrã principal, ele abre em ecrã inteiro, sem barra de endereços do Safari.
            </p>
          </div>
        </div>
      </Panel>

      {/* --------------------------------------------- Android */}
      <Panel title="Android — Chrome" icon="🤖" hint="O Chrome adiciona o atalho diretamente ao ecrã inicial.">
        <ol className="flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-mist-300">
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">1</span>
            <div className="min-w-0">
              <p className="font-semibold">Abre o TelePC no Chrome</p>
              <p className="text-[11px] text-mist-500">Vais ao endereço do teu hub.</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">2</span>
            <div className="min-w-0">
              <p className="font-semibold">Abre o menu (⋮ no canto superior direito)</p>
              <p className="text-[11px] text-mist-500">Toque nos três pontos verticais.</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">3</span>
            <div className="min-w-0">
              <p className="font-semibold">Escolha «Adicionar ao ecrã inicial»</p>
              <p className="text-[11px] text-mist-500">Às vezes chama-se «Instalar app».</p>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="step-num !h-6 !w-6 !text-[11px]">4</span>
            <div className="min-w-0">
              <p className="font-semibold">Confirme</p>
              <p className="text-[11px] text-mist-500">O TelePC fica disponível como qualquer outra app.</p>
            </div>
          </li>
        </ol>
      </Panel>

      {/* --------------------------------------------- dica */}
      {!standalone && shown && (
        <div
          className="card card-glow relative overflow-hidden p-4 rise"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔔</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] font-bold">Queres um atalho direto?</h3>
              <p className="mt-1 text-[11.5px] text-mist-300">
                Abre esta página no navegador do telemóvel e siga os passos acima. Depois é só tocar no ícone.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Btn variant="primary" className="flex-1" onClick={() => haptic("tap")}>
              Abrir no navegador agora
            </Btn>
            <Btn onClick={() => setShown(false)} className="flex-1">
              Não agora
            </Btn>
          </div>
        </div>
      )}

      {/* --------------------------------------------- rodapé */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/" className="btn flex-1">
          ‹ Voltar ao painel
        </Link>
        <Link href="/install" className="btn btn-primary flex-1">
          ➕ Ligar um PC
        </Link>
      </div>

      <div className="card-flat flex items-start gap-3 p-3.5 text-center">
        <span className="text-lg">⚠️</span>
        <p className="text-[11px] leading-relaxed text-mist-500">
          <strong className="text-mist-300">Importante:</strong> o TelePC precisa do teu computador ligado com o programa
          TelePC a correr. Se não ligares o PC, a app abre mas não controla nada.
        </p>
      </div>
    </div>
  );
}
