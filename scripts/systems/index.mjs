import { GenericAdapter } from "./base.mjs";

const registry = new Map();

export function registerAdapter(AdapterClass) {
  registry.set(AdapterClass.id, AdapterClass);
}

export function getAdapter(systemId = game.system.id) {
  const AdapterClass = registry.get(systemId) ?? GenericAdapter;
  return new AdapterClass();
}
