import { clone, DEFAULT_CONFIG, DEFAULT_FIELDS, DEFAULT_ROLES, DEFAULT_TEMPLATES } from "./model.js";
export const STORAGE_KEY = "sheetdock.state.v1";
export function emptyStore() {
  return { version: 1, config: clone(DEFAULT_CONFIG), local: { fields: clone(DEFAULT_FIELDS), roles: clone(DEFAULT_ROLES), records: [] }, sheetsSchemas: {}, chatLinks: {}, templates: clone(DEFAULT_TEMPLATES), sheetMetadata: null };
}
export class CRMStorage {
  constructor(area = globalThis.chrome?.storage?.local) { this.area = area; this.memory = null; }
  async read() {
    if (!this.area) return clone(this.memory ?? emptyStore());
    const result = await this.area.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    return value?.version === 1 ? value : emptyStore();
  }
  async write(value) {
    if (!this.area) { this.memory = clone(value); return; }
    await this.area.set({ [STORAGE_KEY]: value });
  }
}
