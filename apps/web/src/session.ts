import type { PlayerSession } from "./types";

const SESSION_KEY = "hidden-spell-session";

export function loadSession(): PlayerSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PlayerSession>;
    return typeof value.roomId === "string" && typeof value.playerId === "string" &&
      typeof value.nickname === "string" && typeof value.credential === "string"
      ? value as PlayerSession
      : null;
  } catch {
    return null;
  }
}

export function saveSession(session: PlayerSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
