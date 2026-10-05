import { CRMStorage, emptyStore } from "./lib/storage.js";
import {
  CRMError, DEFAULT_FIELDS, DEFAULT_ROLES, assertExpected, assertUniqueIds, clone,
  demoRecords, normalizeTemplates, scopeFor, validateCountryCode, validateFields,
  validateRoles, validateValues,
} from "./lib/model.js";
import { normalizeName, normalizeNameKey, normalizePhone } from "./lib/keys.js";
import { SheetsClient, assertSameHeaders, parseSheetSnapshot, parseSpreadsheetId, planRecordWrite, planSchemaAppend, planInitializeIds } from "./lib/sheets.js";

const STATE_TTL = 30000;
function publicFields(fields) { return fields.map(({ columnIndex, hasFormula, ...field }) => field); }
function rebuildSnapshot(snapshot, saved) {
  return parseSheetSnapshot({ properties: snapshot.properties, data: [{ rowData: snapshot.rows.map(values => ({ values })) }], protectedRanges: snapshot.protectedRanges }, saved);
}

export class CRMService {
  constructor({ storage = new CRMStorage(), sheets = new SheetsClient(), now = () => Date.now(), uuid = () => crypto.randomUUID(), runtime = globalThis.chrome?.runtime, tabs = globalThis.chrome?.tabs } = {}) {
    this.storage = storage; this.sheets = sheets; this.now = now; this.uuid = uuid; this.runtime = runtime; this.tabs = tabs;
    this.store = null; this.snapshot = null; this.syncedAt = 0; this.connectionError = null; this.queue = Promise.resolve();
  }
  async initialize() { this.store ??= await this.storage.read(); }
  async persist(next = this.store) { await this.storage.write(next); this.store = next; }
  get savedSchema() { return this.store.sheetsSchemas[scopeFor(this.store.config)] ?? {}; }
  get tab() { return this.store.sheetMetadata?.tabs.find(tab => tab.id === this.store.config.sheetId); }
  async loadSheet() {
    if (!this.tab) throw new CRMError("SHEET_REQUIRED", "Escolha uma aba da planilha para carregar seus contatos.");
    const snapshot = await this.sheets.readSheet(this.store.config.spreadsheetId, this.tab, this.savedSchema);
    this.snapshot = snapshot; this.syncedAt = this.now(); this.connectionError = null;
    this.store.config.roles = clone(snapshot.roles);
    this.store.config.sheetTitle = snapshot.properties.title;
    return snapshot;
  }
  async state({ refresh = false } = {}) {
    await this.initialize();
    const config = clone(this.store.config);
    config.chatLinks = clone(this.store.chatLinks[scopeFor(config)] ?? {});
    if (config.provider === "local") return {
      config: { ...config, roles: clone(this.store.local.roles) }, fields: clone(this.store.local.fields), records: clone(this.store.local.records), templates: clone(this.store.templates),
      connection: { provider: "local", status: "local", writable: true, tabs: [] },
    };
    if (config.sheetId != null && (refresh || !this.snapshot || this.now() - this.syncedAt > STATE_TTL)) {
      try { await this.loadSheet(); } catch (error) { this.connectionError = { code: error.code ?? "SHEETS_ERROR", message: error.message }; this.snapshot = null; }
    }
    const snapshot = this.snapshot;
    const issue = this.connectionError ?? snapshot?.writeIssue ?? (config.sheetId == null ? { code: "SHEET_REQUIRED", message: "Escolha uma aba para carregar seus contatos." } : null);
    return {
      config: { ...config, sheetTitle: this.store.config.sheetTitle, roles: clone(snapshot?.roles ?? this.savedSchema.roles ?? config.roles) },
      fields: publicFields(snapshot?.fields ?? this.savedSchema.fields ?? []), records: clone(snapshot?.records ?? []), templates: clone(this.store.templates),
      connection: { provider: "sheets", status: this.connectionError ? "error" : config.sheetId == null ? "select-sheet" : "connected", spreadsheetTitle: this.store.sheetMetadata?.title, tabs: clone(this.store.sheetMetadata?.tabs ?? []), writable: Boolean(snapshot && !issue), issue, lastSync: this.syncedAt ? new Date(this.syncedAt).toISOString() : null },
    };
  }
  dispatch(message) {
    // Serialize mutations and reads so an in-flight operation cannot save into a
    // different database selected by another extension view.
    const operation = this.queue.then(async () => { await this.initialize(); return this.handle(message?.type, message?.payload ?? {}); });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async handle(type, payload) {
    if (["CONTACT_SAVE", "CONTACT_DELETE", "SCHEMA_SAVE", "LINK_CHAT", "IMPORT_BACKUP", "CONFIG_SAVE", "CLEAR_LOCAL_DATA", "INITIALIZE_IDS"].includes(type) && payload.scope !== undefined && payload.scope !== scopeFor(this.store.config)) throw new CRMError("BASE_CHANGED", "A base de dados mudou em outra janela. Atualize esta página antes de salvar.");
    switch (type) {
      case "STATE": return this.state();
      case "REFRESH": {
        if (this.store.config.provider === "sheets") await this.loadSheet();
        return this.state();
      }
      case "CONTACT_SAVE": return this.saveContact(payload);
      case "CONTACT_DELETE": {
        if (this.store.config.provider !== "local") throw new CRMError("SHEETS_DELETE_UNSUPPORTED", "Exclua este contato diretamente na planilha e atualize o CRM. A exclusão de linhas pelo CRM ainda não está disponível.");
        const next = clone(this.store);
        const record = next.local.records.find(item => item.id === String(payload.id));
        if (!record) throw new CRMError("NOT_FOUND", "Este contato já não existe na base local.");
        assertExpected(record, payload.expected);
        next.local.records = next.local.records.filter(item => item.id !== record.id);
        for (const [key, link] of Object.entries(next.chatLinks.local ?? {})) if (link.recordId === record.id) delete next.chatLinks.local[key];
        await this.persist(next); return this.state();
      }
      case "SCHEMA_SAVE": return this.saveSchema(payload);
      case "INITIALIZE_IDS": {
        if (this.store.config.provider !== "sheets") throw new CRMError("SHEETS_ONLY", "A preparação de IDs só é necessária para uma planilha Google.");
        if (payload.scope !== scopeFor(this.store.config) || payload.confirmation !== "INITIALIZE_IDS") throw new CRMError("CONFIRMATION_REQUIRED", "Confirme a criação de IDs nas linhas da planilha antes de continuar.");
        const previous = this.snapshot;
        const snapshot = await this.loadSheet();
        if (previous) assertSameHeaders(previous, snapshot);
        const plan = planInitializeIds(snapshot, this.uuid);
        await this.sheets.ensureGrid(this.store.config.spreadsheetId, snapshot, { columns: plan.requiredColumns, rows: plan.requiredRows });
        await this.sheets.writeCells(this.store.config.spreadsheetId, plan.data);
        const next = clone(this.store);
        next.sheetsSchemas[scopeFor(next.config)] = { fields: plan.fields, roles: plan.roles }; next.config.roles = plan.roles;
        await this.persist(next); this.snapshot = null; this.syncedAt = 0;
        const state = await this.state({ refresh: true });
        state.connection.idsCreated = plan.created;
        if (state.connection.issue) state.connection.writeConfirmed = true;
        return state;
      }
      case "CONFIG_SAVE": return this.saveConfig(payload.config ?? {});
      case "TEMPLATES_SAVE": {
        const next = clone(this.store); next.templates = normalizeTemplates(payload.templates); await this.persist(next); return this.state();
      }
      case "IMPORT_BACKUP": return this.importBackup(payload.backup);
      case "CLEAR_LOCAL_DATA": {
        if (this.store.config.provider !== "local") throw new CRMError("LOCAL_ONLY", "Desconecte o Google antes de apagar os dados deste navegador. A planilha será preservada.");
        if (payload.scope !== "local" || payload.confirmation !== "CLEAR_LOCAL_DATA") throw new CRMError("CONFIRMATION_REQUIRED", "Confirme explicitamente a exclusão dos contatos e configurações locais.");
        await this.sheets.disconnect();
        await this.persist(emptyStore()); this.snapshot = null; this.syncedAt = 0; this.connectionError = null;
        return this.state();
      }
      case "DEMO_RESET": {
        if (this.store.config.provider !== "local") throw new CRMError("LOCAL_ONLY", "A demonstração só pode ser criada no modo local.");
        if (this.store.local.records.length) throw new CRMError("DEMO_NONEMPTY", "A demonstração só pode ser adicionada a uma base local vazia. Seus contatos atuais foram preservados.");
        const next = clone(this.store); next.local.records = demoRecords(next.local.fields, next.local.roles); await this.persist(next); return this.state();
      }
      case "CONNECT": {
        const id = parseSpreadsheetId(payload.spreadsheetUrl ?? payload.spreadsheetId);
        const metadata = await this.sheets.metadata(id, true);
        const next = clone(this.store);
        next.sheetMetadata = metadata;
        next.config = { ...next.config, provider: "sheets", spreadsheetId: id, sheetId: null, sheetTitle: "", roles: Object.fromEntries(Object.keys(DEFAULT_ROLES).map(role => [role, ""])) };
        await this.persist(next); this.snapshot = null; this.connectionError = null; this.syncedAt = 0;
        return { ...await this.state(), tabs: clone(metadata.tabs) };
      }
      case "SELECT_SHEET": {
        if (this.store.config.provider !== "sheets" || !this.store.sheetMetadata) throw new CRMError("CONNECT_REQUIRED", "Conecte uma planilha antes de escolher a aba.");
        const id = Number(payload.sheetId);
        const tab = this.store.sheetMetadata.tabs.find(item => item.id === id);
        if (!tab) throw new CRMError("SHEET_NOT_FOUND", "Esta aba não está disponível na planilha conectada.");
        const next = clone(this.store); next.config.sheetId = id; next.config.sheetTitle = tab.title;
        const saved = next.sheetsSchemas[scopeFor(next.config)] ?? {};
        const snapshot = await this.sheets.readSheet(next.config.spreadsheetId, tab, saved);
        next.config.roles = clone(snapshot.roles);
        next.sheetsSchemas[scopeFor(next.config)] = { fields: publicFields(snapshot.fields), roles: clone(snapshot.roles) };
        await this.persist(next); this.snapshot = snapshot; this.syncedAt = this.now(); this.connectionError = null; return this.state();
      }
      case "CREATE_SHEET": {
        const metadata = await this.sheets.createSpreadsheet(payload.title, DEFAULT_FIELDS.map(field => field.key));
        const tab = metadata.tabs[0];
        const next = clone(this.store); next.sheetMetadata = metadata;
        next.config = { ...next.config, provider: "sheets", spreadsheetId: metadata.id, sheetId: tab.id, sheetTitle: tab.title, roles: clone(DEFAULT_ROLES) };
        next.sheetsSchemas[scopeFor(next.config)] = { fields: clone(DEFAULT_FIELDS), roles: clone(DEFAULT_ROLES) };
        // Creation was confirmed by Google before switching databases. Read-back
        // may fail; keep the real ID and report that failure without creating again.
        await this.persist(next); this.snapshot = null; this.syncedAt = 0; this.connectionError = null;
        return this.state({ refresh: true });
      }
      case "DISCONNECT": {
        await this.sheets.disconnect();
        const next = clone(this.store);
        next.config = { ...next.config, provider: "local", spreadsheetId: "", sheetId: null, sheetTitle: "", roles: clone(next.local.roles) };
        next.sheetMetadata = null;
        await this.persist(next); this.snapshot = null; this.connectionError = null; this.syncedAt = 0; return this.state();
      }
      case "LINK_CHAT": return this.linkChat(payload);
      case "OPEN_DASHBOARD": {
        if (!this.tabs?.create || !this.runtime?.getURL) throw new CRMError("CHROME_REQUIRED", "Instale a extensão no Chrome para abrir o painel.");
        await this.tabs.create({ url: this.runtime.getURL("src/dashboard/dashboard.html") });
        return { opened: true };
      }
      default: throw new CRMError("UNKNOWN_ACTION", "Esta operação não é reconhecida pela extensão.");
    }
  }
  async saveContact(payload) {
    const config = this.store.config;
    if (config.provider === "local") {
      const next = clone(this.store);
      const existing = payload.id ? next.local.records.find(record => record.id === String(payload.id)) : null;
      if (payload.id && !existing) throw new CRMError("NOT_FOUND", "O contato não existe mais. Atualize sua lista.");
      assertUniqueIds(next.local.records, next.local.roles.id);
      if (existing) assertExpected(existing, payload.expected);
      const values = validateValues(payload.values, next.local.fields, { countryCode: config.countryCode, base: existing?.values ?? {}, editing: Boolean(existing), idKey: next.local.roles.id });
      const id = existing?.id ?? this.uuid(); values[next.local.roles.id] = id;
      const record = { id, values };
      if (existing) next.local.records[next.local.records.indexOf(existing)] = record;
      else next.local.records.push(record);
      assertUniqueIds(next.local.records, next.local.roles.id);
      await this.persist(next); return this.state();
    }
    const previous = this.snapshot;
    const snapshot = await this.loadSheet();
    if (previous) assertSameHeaders(previous, snapshot);
    const existing = payload.id ? snapshot.records.find(record => record.id === String(payload.id)) : null;
    if (payload.id && !existing) throw new CRMError("NOT_FOUND", "O contato não existe mais nesta planilha. Atualize a lista.");
    const values = validateValues(payload.values, snapshot.fields, { countryCode: config.countryCode, base: existing?.values ?? {}, editing: Boolean(existing), idKey: snapshot.roles.id });
    const plan = planRecordWrite(snapshot, { ...payload, values, newId: this.uuid() });
    await this.sheets.ensureGrid(config.spreadsheetId, snapshot, { rows: plan.rowNumber });
    await this.sheets.writeCells(config.spreadsheetId, plan.data);
    // A failed read-back must not suggest that a confirmed write did not happen.
    this.snapshot = null; this.syncedAt = 0;
    const state = await this.state({ refresh: true });
    if (state.connection.issue) state.connection.writeConfirmed = true;
    return state;
  }
  async saveSchema(payload) {
    const fields = validateFields(payload.fields);
    const roles = validateRoles(payload.roles ?? this.store.config.roles, fields, { requireId: this.store.config.provider === "local" });
    const idField = fields.find(field => field.key === roles.id);
    if (idField) idField.readOnly = true;
    const next = clone(this.store);
    if (next.config.provider === "local") {
      if (next.local.records.length && roles.id !== next.local.roles.id) throw new CRMError("ID_IMMUTABLE", "O campo ID de uma base com contatos não pode ser trocado. Seus identificadores precisam continuar estáveis.");
      next.local.fields = fields; next.local.roles = roles; next.config.roles = roles;
      await this.persist(next); return this.state();
    }
    const previous = this.snapshot;
    const snapshot = await this.loadSheet();
    if (previous) assertSameHeaders(previous, snapshot);
    const idColumn = snapshot.fields.find(field => field.key === roles.id);
    if (idColumn?.hasFormula) throw new CRMError("FORMULA_ID", "A coluna ID não pode ter fórmulas.");
    const plan = planSchemaAppend(snapshot, fields);
    await this.sheets.ensureGrid(next.config.spreadsheetId, snapshot, { columns: plan.requiredColumns });
    await this.sheets.writeCells(next.config.spreadsheetId, plan.data);
    next.sheetsSchemas[scopeFor(next.config)] = { fields, roles }; next.config.roles = roles;
    await this.persist(next); this.snapshot = null; this.syncedAt = 0; return this.state({ refresh: true });
  }
  async saveConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CRMError("INVALID_CONFIG", "As configurações são inválidas.");
    const next = clone(this.store);
    if (input.provider && input.provider !== next.config.provider) {
      if (input.provider !== "local") throw new CRMError("CONNECT_REQUIRED", "Use Conectar para selecionar uma planilha Google.");
      next.config.provider = "local"; next.config.roles = clone(next.local.roles);
    }
    for (const key of ["spreadsheetId", "sheetId", "sheetTitle"]) if (input[key] !== undefined && input[key] !== next.config[key]) throw new CRMError("CONNECT_REQUIRED", "Use Conectar e Escolher aba para trocar a base de dados.");
    if (input.countryCode !== undefined) next.config.countryCode = validateCountryCode(input.countryCode);
    if (input.roles) {
      const fields = next.config.provider === "local" ? next.local.fields : this.snapshot?.fields ?? this.savedSchema.fields ?? [];
      const roles = validateRoles(input.roles, fields, { requireId: next.config.provider === "local" });
      if (next.config.provider === "local") {
        if (next.local.records.length && roles.id !== next.local.roles.id) throw new CRMError("ID_IMMUTABLE", "O campo ID de uma base com contatos não pode ser trocado.");
        next.local.roles = roles;
      } else {
        if (fields.find(field => field.key === roles.id)?.hasFormula) throw new CRMError("FORMULA_ID", "A coluna ID não pode ter fórmulas.");
        next.sheetsSchemas[scopeFor(next.config)] = { ...this.savedSchema, roles };
      }
      next.config.roles = roles;
    }
    await this.persist(next);
    if (next.config.provider === "local") { this.snapshot = null; this.connectionError = null; }
    else if (this.snapshot) this.snapshot = rebuildSnapshot(this.snapshot, this.savedSchema);
    return this.state();
  }
  async linkChat({ recordId, identity, expected }) {
    const state = await this.state();
    if (!state.records.some(record => record.id === String(recordId))) throw new CRMError("NOT_FOUND", "Escolha um contato que exista nesta base.");
    if (state.config.provider === "sheets" && state.connection.issue) throw new CRMError(state.connection.issue.code, state.connection.issue.message);
    const phone = normalizePhone(identity?.phone, state.config.countryCode);
    const name = normalizeName(identity?.name) ?? "";
    const nameKey = normalizeNameKey(name);
    if (identity?.phone && !phone) throw new CRMError("INVALID_IDENTITY", "O telefone desta conversa não é uma identidade válida.");
    if (!phone && !nameKey) throw new CRMError("INVALID_IDENTITY", "A conversa não tem telefone ou nome identificável.");
    const key = phone ? `phone:${phone}` : `name:${nameKey}`;
    const scope = scopeFor(state.config);
    const next = clone(this.store); next.chatLinks[scope] ??= {};
    const current = next.chatLinks[scope][key]?.recordId ?? null;
    const expectedId = expected && typeof expected === "object" ? expected.recordId ?? null : expected ?? null;
    if (current !== expectedId) throw new CRMError("LINK_CONFLICT", "O vínculo desta conversa mudou. Atualize antes de escolher outro contato.");
    next.chatLinks[scope][key] = { recordId: String(recordId), name, phone: phone ?? "", updatedAt: new Date(this.now()).toISOString() };
    await this.persist(next); return this.state();
  }
  async importBackup(backup) {
    if (this.store.config.provider !== "local") throw new CRMError("LOCAL_ONLY", "Importe o backup no modo local.");
    if (!backup || backup.format !== "sheetdock-backup" || backup.version !== 1 || !Array.isArray(backup.records) || backup.records.length > 5000 || JSON.stringify(backup).length > 5000000) throw new CRMError("INVALID_BACKUP", "Use um backup SheetDock versão 1, com até 5 MB e 5.000 contatos.");
    const incomingFields = validateFields(backup.fields);
    const incomingRoles = validateRoles(backup.roles, incomingFields);
    const next = clone(this.store);
    // Restoring into an empty base adopts the backup's complete schema. Defaults
    // must not reintroduce required fields, labels or roles the user customized.
    const merged = next.local.records.length ? [...next.local.fields] : [];
    for (const field of incomingFields) {
      const existing = merged.find(item => item.key === field.key);
      if (existing && (existing.type !== field.type || existing.type === "select" && JSON.stringify(existing.options) !== JSON.stringify(field.options))) throw new CRMError("BACKUP_SCHEMA_CONFLICT", `O campo ${field.key} tem um tipo ou opções diferentes na base atual. Ajuste o backup antes de importar.`);
      if (existing && field.readOnly && !existing.readOnly) {
        if (next.local.records.length) throw new CRMError("BACKUP_SCHEMA_CONFLICT", `O campo ${field.key} é somente leitura no backup e editável na base atual. Ajuste os campos antes de importar para preservar essa configuração.`);
        existing.readOnly = true;
      }
      if (!existing) merged.push(field);
    }
    const fields = validateFields(merged);
    const roles = next.local.records.length ? next.local.roles : incomingRoles;
    const records = [...next.local.records];
    const countryCode = validateCountryCode(backup.countryCode ?? next.config.countryCode);
    for (const source of backup.records) {
      if (!source?.values || typeof source.values !== "object" || Array.isArray(source.values)) throw new CRMError("INVALID_BACKUP", "Um contato do backup não possui valores válidos.");
      const input = {};
      const snapshots = {};
      for (const field of fields) {
        if (field.key === incomingRoles.id || field.key === roles.id || !Object.hasOwn(source.values, field.key)) continue;
        const value = source.values[field.key] ?? "";
        if (field.readOnly) {
          // Readonly exports are literal snapshots, including computed text or
          // formula error strings. Keep their scalar values without evaluating
          // expressions or granting ordinary CONTACT_SAVE permission to change them.
          if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 30000) throw new CRMError("INVALID_VALUE", `O valor somente leitura de ${field.label} no backup é inválido ou muito longo.`);
          snapshots[field.key] = value;
        } else input[field.key] = value;
      }
      const values = { ...validateValues(input, fields, { countryCode, idKey: roles.id }), ...snapshots };
      const id = this.uuid(); values[roles.id] = id; records.push({ id, values });
    }
    assertUniqueIds(records, roles.id);
    // Templates are validated as well. Existing templates are preserved; imported
    // IDs are regenerated to avoid collisions with another user's backup.
    if (backup.templates !== undefined) next.templates.push(...normalizeTemplates(backup.templates).map(template => ({ ...template, id: this.uuid() })));
    if (next.templates.length > 100) throw new CRMError("INVALID_TEMPLATES", "A importação excederia 100 modelos de mensagem.");
    next.local = { fields, roles, records }; next.config.roles = clone(roles);
    if (!this.store.local.records.length) next.config.countryCode = countryCode;
    await this.persist(next); return this.state();
  }
}

// Exported service and pure helpers support deterministic tests without a browser.
// Tokens are acquired per Google request and never written to extension storage.
export const service = new CRMService();
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // No externally_connectable manifest; accept only this extension's own pages
  // and content scripts. Ordinary websites cannot call these mutation methods.
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  service.dispatch(message).then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: { code: error.code ?? "INTERNAL_ERROR", message: error instanceof CRMError ? error.message : "Não foi possível concluir a operação. Atualize a extensão e tente novamente." } }));
  return true;
});
