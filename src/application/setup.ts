import type { SetupRuntime, SetupStore } from "./setup-ports.js";
export function createSetup(store: SetupStore, runtime: SetupRuntime) {
  return {
    status: () => store.read(),
    chooseFresh: (expectedRevision: number) => store.chooseFresh(expectedRevision, runtime.now()),
  };
}
