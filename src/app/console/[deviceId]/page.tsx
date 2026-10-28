import ConsoleClient from "@/components/console/ConsoleClient";
import ConsoleMissing from "@/components/ConsoleMissing";
import { hub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export default async function ConsolePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const devices = await hub.knownDevices();
  const device = devices.find((item) => item.id === deviceId);

  // Nunca devolvemos um 404: se o PC ainda não existe (servidor reiniciado,
  // base de dados nova, link antigo) mostramos como voltar a ligá-lo.
  if (!device) return <ConsoleMissing deviceId={deviceId} />;

  return <ConsoleClient deviceId={deviceId} initialPresence={device} />;
}
