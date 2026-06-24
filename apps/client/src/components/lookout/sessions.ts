export const SESSIONS_KEY = "lapse:lookout_sessions";

export interface StoredLookoutSession {
  draftId: string;
  lookoutToken: string;
  lookoutApiBaseUrl: string;
  lookoutSessionId: string;
  createdAt: number;
}

export function getStoredSessions(): StoredLookoutSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: Record<string, unknown>) => s.draftId);
  } catch {
    return [];
  }
}

export function storeSession(session: StoredLookoutSession): void {
  const sessions = getStoredSessions().filter(s => s.draftId !== session.draftId);
  sessions.push(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function removeStoredSession(draftId: string): void {
  const sessions = getStoredSessions().filter(s => s.draftId !== draftId);
  if (sessions.length === 0) {
    localStorage.removeItem(SESSIONS_KEY);
  } else {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}
