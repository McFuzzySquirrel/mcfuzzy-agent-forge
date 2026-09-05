import { AsyncLocalStorage } from "node:async_hooks";

/** Transitional scope for legacy helper functions while entry points become explicit sessions. */
export function createSessionScope<T extends object>(factory: () => T): {
  current: () => T;
  run: <R>(operation: () => R, initial?: T) => R;
  state: T;
} {
  const storage = new AsyncLocalStorage<T>();
  const current = (): T => {
    const value = storage.getStore();
    if (!value) throw new Error("Launcher operation requires an invocation session.");
    return value;
  };
  return {
    current,
    run: (operation, initial) => storage.run(initial ?? factory(), operation),
    state: new Proxy({} as T, {
      get: (_target, property) => Reflect.get(current(), property),
      set: (_target, property, value) => Reflect.set(current(), property, value),
    }),
  };
}
