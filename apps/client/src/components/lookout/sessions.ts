export const SESSIONS_KEY = "lapse:lookout_sessions";

export interface StoredLookoutSession {
  lookoutToken: string;
  lookoutApiBaseUrl: string;
  lookoutSessionId: string;
  timelapseId: string;
  createdAt: number;
}

export function getStoredSessions(): StoredLookoutSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeSession(session: StoredLookoutSession): void {
  const sessions = getStoredSessions().filter(s => s.timelapseId !== session.timelapseId);
  sessions.push(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function removeStoredSession(timelapseId: string): void {
  const sessions = getStoredSessions().filter(s => s.timelapseId !== timelapseId);
  if (sessions.length === 0) {
    localStorage.removeItem(SESSIONS_KEY);
  } else {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}
