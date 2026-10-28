import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { devices, settings } from "@/db/schema";

const TOKEN_KEY = "pairing_token";

/* --------------------------------------------------------------------------
 * Segredo do servidor para assinar as sessões dos PCs.
 *
 * As sessões passam a ser *assinadas* (HMAC) em vez de guardadas em memória.
 * Assim qualquer cópia do servidor consegue validar a sessão sem precisar de
 * memória partilhada nem base de dados — o que resolve o ciclo infinito de
 * "Sessão expirada" quando o hub é reiniciado ou corre em múltiplas cópias.
 * ------------------------------------------------------------------------ */
function secretFile(): string {
  return process.env.TELEPC_SECRET_FILE || path.join(process.cwd(), ".data", "secret");
}

function readSecretFile(): string | null {
  try {
    const value = readFileSync(secretFile(), "utf8").trim();
    return value.length >= 32 ? value : null;
  } catch {
    return null;
  }
}

function writeSecretFile(secret: string) {
  try {
    const file = secretFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* sem disco de escrita: usamos o segredo só em memória */
  }
}

/**
 * O código também vive num ficheiro: assim uma recriação da base de dados não
 * invalida os PCs que já estão ligados (eles reaparecem com o mesmo id).
 */
function tokenFile(): string {
  return process.env.PAIRING_TOKEN_FILE || path.join(process.cwd(), ".data", "pairing-token");
}

function readTokenFile(): string | null {
  try {
    const value = readFileSync(tokenFile(), "utf8").trim();
    return /^[A-Z0-9]{3}-?[A-Z0-9]{3}$/i.test(value) ? value.toUpperCase() : null;
  } catch {
    return null;
  }
}

function writeTokenFile(token: string) {
  try {
    const file = tokenFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, token, { encoding: "utf8", mode: 0o600 });
  } catch {
    // sem permissões de escrita: a base de dados continua a ser a fonte
  }
}

type TokenCache = typeof globalThis & {
  __telepcPairing?: { token: string | null; deviceTokens: Map<string, string>; secret: string | null };
};

const cache = ((globalThis as TokenCache).__telepcPairing ??= {
  token: null,
  deviceTokens: new Map<string, string>(),
  secret: null,
});

function serverSecret(): string {
  if (process.env.TELEPC_SECRET) return process.env.TELEPC_SECRET;
  if (cache.secret) return cache.secret;
  const fromFile = readSecretFile();
  if (fromFile) {
    cache.secret = fromFile;
    return fromFile;
  }
  const secret = randomBytes(32).toString("hex");
  cache.secret = secret;
  writeSecretFile(secret);
  return secret;
}

function signDevice(deviceId: string, issued: string): string {
  return createHmac("sha256", serverSecret()).update(`${deviceId}.${issued}`).digest("hex");
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

/** The pairing code a user types into the agent running on the PC. */
export async function getPairingToken(): Promise<string> {
  if (process.env.PAIRING_TOKEN) return process.env.PAIRING_TOKEN;
  if (cache.token) return cache.token;
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, TOKEN_KEY)).limit(1);
    if (rows[0]?.value) {
      cache.token = rows[0].value;
      writeTokenFile(rows[0].value);
      return rows[0].value;
    }
  } catch {
    // fall through to a memory-only token
  }
  const fromFile = readTokenFile();
  if (fromFile) {
    cache.token = fromFile;
    db.insert(settings)
      .values({ key: TOKEN_KEY, value: fromFile })
      .onConflictDoUpdate({ target: settings.key, set: { value: fromFile, updatedAt: new Date() } })
      .catch(() => undefined);
    return fromFile;
  }
  const token = randomCode();
  cache.token = token;
  writeTokenFile(token);
  db.insert(settings)
    .values({ key: TOKEN_KEY, value: token })
    .onConflictDoUpdate({ target: settings.key, set: { value: token, updatedAt: new Date() } })
    .catch(() => undefined);
  return token;
}

export async function rotatePairingToken(): Promise<string> {
  const token = randomCode();
  cache.token = token;
  writeTokenFile(token);
  try {
    await db
      .insert(settings)
      .values({ key: TOKEN_KEY, value: token, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value: token, updatedAt: new Date() } });
  } catch {
    // keep the in-memory token
  }
  return token;
}

export async function verifyPairingToken(token: string | undefined | null) {
  if (!token) return false;
  const expected = await getPairingToken();
  return token.trim().toUpperCase() === expected.toUpperCase();
}

/** Sessão assinada: `v2.<quando>.<assinatura>` — validável sem estado. */
export function issueDeviceToken(deviceId: string): string {
  const issued = Date.now().toString(36);
  const token = `v2.${issued}.${signDevice(deviceId, issued)}`;
  cache.deviceTokens.set(deviceId, token);
  db.update(devices)
    .set({ token })
    .where(eq(devices.id, deviceId))
    .catch(() => undefined);
  return token;
}

export async function verifyDeviceToken(deviceId: string, token: string | null): Promise<boolean> {
  if (!token) return false;

  // Caminho principal: sessão assinada, verificada só com o segredo do servidor.
  if (token.startsWith("v2.")) {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    const expected = signDevice(deviceId, parts[1]);
    try {
      const a = Buffer.from(parts[2], "hex");
      const b = Buffer.from(expected, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Compatibilidade com sessões antigas (memória/base de dados).
  if (cache.deviceTokens.get(deviceId) === token) return true;
  try {
    const rows = await db.select({ token: devices.token }).from(devices).where(eq(devices.id, deviceId)).limit(1);
    const stored = rows[0]?.token;
    if (stored && stored === token) {
      cache.deviceTokens.set(deviceId, token);
      return true;
    }
  } catch {
    // ignore DB hiccups
  }
  return false;
}
