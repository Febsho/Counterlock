type CacheValue = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheValue>();

/** Small in-memory TTL cache. API requests are reused across UI-only recalculations. */
export async function cachedJson<T>(url: string, ttlMs = 6 * 60 * 60 * 1000): Promise<T> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Deadlock API ${response.status} for ${new URL(url).pathname}`);
  const value: unknown = await response.json();
  cache.set(url, { value, expiresAt: Date.now() + ttlMs });
  return value as T;
}

export function clearApiCache() { cache.clear(); }
