import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TelePC — Comando remoto do PC",
    short_name: "TelePC",
    description:
      "Espelho do ecrã, rato, teclado, janelas, terminal e macros do teu PC directamente no iPhone.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05070c",
    theme_color: "#05070c",
    categories: ["utilities", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
