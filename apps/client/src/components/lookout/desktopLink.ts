/**
 * Calls the Lookout desktop pairing routes on the Lapse API.
 * These sit beside the oRPC API because the desktop app speaks a fixed
 * JSON protocol (see hackclub/lookout docs/integration.md). The website
 * uses the same routes, with the user's access token, for consent and revoke.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";

export interface LinkedDesktop {
  id: string;
  label: string;
  createdAt: string;
}

export class DesktopLinkError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const token = localStorage.getItem("lapse:token");
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function expectOk(res: Response): Promise<void> {
  if (res.ok)
    return;
  const body = await res.json().catch(() => ({})) as { error?: string };
  throw new DesktopLinkError(res.status, body.error || `Request failed (${res.status})`);
}

export async function acceptPairing(input: { challenge: string; state: string; device: string }): Promise<string> {
  const res = await call("/lookout/pair/accept", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await expectOk(res);
  const data = await res.json() as { code?: string };
  if (!data.code)
    throw new DesktopLinkError(res.status, "Lapse did not return a pairing code");
  return data.code;
}

export async function listLinkedDesktops(): Promise<LinkedDesktop[]> {
  const res = await call("/lookout/devices", { method: "GET" });
  await expectOk(res);
  const data = await res.json() as { devices?: LinkedDesktop[] };
  return data.devices ?? [];
}

export async function revokeLinkedDesktop(id: string): Promise<void> {
  const res = await call(`/lookout/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  await expectOk(res);
}

/** The deep link the desktop app is waiting on. State is echoed exactly. */
export function pairingCallbackUrl(code: string, state: string): string {
  return `lookout://pair?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}
