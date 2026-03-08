// In-memory secret store — intentionally does NOT persist to localStorage or
// sessionStorage to avoid CodeQL "clear text storage of sensitive information"
// alerts.  Values are lost on page reload; the UI reflects this.

const store = new Map<string, string>();

export function getSecret(key: string): string | null {
  return store.get(key) ?? null;
}

export function setSecret(key: string, value: string): void {
  store.set(key, value);
}

export function removeSecret(key: string): void {
  store.delete(key);
}
