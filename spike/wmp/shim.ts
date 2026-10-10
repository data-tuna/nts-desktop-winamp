// The sandboxed frame has an opaque origin, so localStorage throws.
// Webamp Modern's ConfigPersistent reads it at load; give it a memory store.
// Imported before the engine so it is in place when the engine's modules run.
const mem = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  },
});
