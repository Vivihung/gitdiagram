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
