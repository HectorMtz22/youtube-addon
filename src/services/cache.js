export function createCache({ ttlMs }) {
  const map = new Map();
  return {
    set(key, value) {
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expires) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    get size() {
      return map.size;
    },
  };
}
