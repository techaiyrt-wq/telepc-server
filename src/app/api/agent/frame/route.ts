import { hub } from "@/lib/hub";
import { verifyDeviceToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface LegacyFrameBody {
  deviceId?: string;
  deviceToken?: string;
  image?: string;
  width?: number;
  height?: number;
  contentType?: string;
  captureMs?: number;
  quality?: number;
  scale?: number;
}

function n(value: string | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Agent → hub: frame JPEG.
 *
 * Agentes novos enviam os bytes diretamente (`image/jpeg`), poupando ~33% de
 * dados e duas conversões base64. Continuamos a aceitar o JSON antigo para que
 * um PC já instalado não deixe de funcionar durante a atualização.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.startsWith("image/")) {
    const deviceId = request.headers.get("x-device-id")?.trim();
    const deviceToken = request.headers.get("x-device-token");
    if (!deviceId || !(await verifyDeviceToken(deviceId, deviceToken))) {
      return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const raw = await request.arrayBuffer();
    if (raw.byteLength === 0) {
      return Response.json({ ok: false, error: "Sem imagem" }, { status: 400 });
    }
    if (raw.byteLength > 8 * 1024 * 1024) {
      return Response.json({ ok: false, error: "Frame demasiado grande" }, { status: 413 });
    }

    const version = hub.setFrame(deviceId, {
      buffer: Buffer.from(raw),
      width: n(request.headers.get("x-frame-width")),
      height: n(request.headers.get("x-frame-height")),
      screenWidth: n(request.headers.get("x-screen-width")),
      screenHeight: n(request.headers.get("x-screen-height")),
      captureMs: n(request.headers.get("x-capture-ms")),
      quality: n(request.headers.get("x-quality")),
      scale: n(request.headers.get("x-scale")),
      bytes: raw.byteLength,
      ts: Date.now(),
      contentType: contentType.split(";")[0] || "image/jpeg",
    });
    hub.merge(deviceId, {});

    return Response.json({ ok: true, version }, { headers: { "Cache-Control": "no-store" } });
  }

  let body: LegacyFrameBody;
  try {
    body = (await request.json()) as LegacyFrameBody;
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const { deviceId, deviceToken } = body;
  if (!deviceId || !(await verifyDeviceToken(deviceId, deviceToken ?? null))) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (!body.image) {
    return Response.json({ ok: false, error: "Sem imagem" }, { status: 400 });
  }

  const buffer = Buffer.from(body.image, "base64");
  if (buffer.byteLength > 8 * 1024 * 1024) {
    return Response.json({ ok: false, error: "Frame demasiado grande" }, { status: 413 });
  }

  const version = hub.setFrame(deviceId, {
    buffer,
    width: body.width ?? 0,
    height: body.height ?? 0,
    screenWidth: body.width ?? 0,
    screenHeight: body.height ?? 0,
    captureMs: body.captureMs ?? 0,
    quality: body.quality ?? 0,
    scale: body.scale ?? 0,
    bytes: buffer.byteLength,
    ts: Date.now(),
    contentType: body.contentType ?? "image/jpeg",
  });
  hub.merge(deviceId, {});

  return Response.json({ ok: true, version });
}
