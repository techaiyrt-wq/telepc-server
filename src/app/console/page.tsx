import { redirect } from "next/navigation";

import { hub } from "@/lib/hub";

export const dynamic = "force-dynamic";

/** /console sem PC: leva ao mais recente ou ao assistente de ligação. */
export default async function ConsoleIndex() {
  const devices = await hub.knownDevices();
  const target = devices.find((device) => device.online) ?? devices[0];
  redirect(target ? `/console/${target.id}` : "/install");
}
