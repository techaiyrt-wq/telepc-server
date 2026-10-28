import Dashboard from "@/components/Dashboard";
import { hub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Rendered on the server so the user never sees a wrong "no PC yet" flash.
  const devices = await hub.knownDevices();
  return <Dashboard initialDevices={devices} />;
}
