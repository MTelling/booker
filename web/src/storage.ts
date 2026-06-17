// Tiny localStorage helpers. A person is identified only by the name they type,
// which we remember so they don't retype it on every event.

const NAME_KEY = "booker.name";
const adminKey = (eventId: string) => `booker.admin.${eventId}`;

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSavedName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function getAdminToken(eventId: string): string | null {
  try {
    return localStorage.getItem(adminKey(eventId));
  } catch {
    return null;
  }
}

export function setAdminToken(eventId: string, token: string): void {
  try {
    localStorage.setItem(adminKey(eventId), token);
  } catch {
    /* ignore */
  }
}

export function clearAdminToken(eventId: string): void {
  try {
    localStorage.removeItem(adminKey(eventId));
  } catch {
    /* ignore */
  }
}
