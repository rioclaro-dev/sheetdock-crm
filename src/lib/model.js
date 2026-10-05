import { isInvalidIdentity, normalizeNameKey, normalizePhone } from "./keys.js";

export class CRMError extends Error {
  constructor(code, message) { super(message); this.name = "CRMError"; this.code = code; }
}
export const FIELD_TYPES = Object.freeze(["text", "textarea", "number", "date", "select", "checkbox", "email", "phone", "url"]);
export const ROLE_NAMES = Object.freeze(["id", "name", "phone", "stage", "nextContact", "notes"]);
export const DEFAULT_FIELDS = Object.freeze([
  { key: "id", label: "ID", type: "text", readOnly: true, hidden: true },
  { key: "nome", label: "Nome", type: "text", required: true },
  { key: "telefone", label: "Telefone", type: "phone" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "empresa", label: "Empresa", type: "text" },
  { key: "etapa", label: "Etapa", type: "select", options: ["Novo", "Em conversa", "Concluído"] },
  { key: "proximo_contato", label: "Próximo contato", type: "date" },
  { key: "observacoes", label: "Observações", type: "textarea" },
]);
export const DEFAULT_ROLES = Object.freeze({ id: "id", name: "nome", phone: "telefone", stage: "etapa", nextContact: "proximo_contato", notes: "observacoes" });
export const DEFAULT_CONFIG = Object.freeze({ provider: "local", spreadsheetId: "", sheetId: null, sheetTitle: "", countryCode: "55", roles: DEFAULT_ROLES, chatLinks: {} });
export const DEFAULT_TEMPLATES = Object.freeze([
  { id: "retomar", name: "Retomar conversa", text: "Olá, {{primeiro_nome}}! Podemos retomar nossa conversa?" },
]);
export const clone = value => structuredClone(value);
const badKey = key => !key || key.length > 100 || /[\u0000-\u001f\u007f]/.test(key) || ["__proto__", "prototype", "constructor"].includes(key);

export function validateFields(input, { allowEmpty = false } = {}) {
  if (!Array.isArray(input) || (!allowEmpty && !input.length) || input.length > 100) throw new CRMError("INVALID_SCHEMA", "Escolha de 1 a 100 campos.");
  const keys = new Set();
  return input.map(field => {
    const key = String(field?.key ?? "").trim();
    if (badKey(key) || keys.has(key)) throw new CRMError("INVALID_SCHEMA", "Cada campo precisa de uma chave única, sem caracteres de controle.");
    keys.add(key);
    const label = String(field.label ?? key).trim();
    if (!label || label.length > 100 || !FIELD_TYPES.includes(field.type)) throw new CRMError("INVALID_SCHEMA", `Tipo ou rótulo inválido para o campo ${key}.`);
    const output = { key, label, type: field.type };
    if (field.type === "select") {
      if (!Array.isArray(field.options) || field.options.length > 100) throw new CRMError("INVALID_SCHEMA", `Defina as opções do campo ${label}.`);
      const options = field.options.map(option => String(option).trim());
      if (options.some(option => !option || option.length > 200) || new Set(options).size !== options.length) throw new CRMError("INVALID_SCHEMA", `As opções de ${label} precisam ser únicas e não vazias.`);
      output.options = options;
    }
    for (const flag of ["required", "hidden", "readOnly"]) if (field[flag]) output[flag] = true;
    return output;
  });
}
export function validateRoles(input, fields, { requireId = true } = {}) {
  const keys = new Set(fields.map(field => field.key));
  const roles = {};
  for (const role of ROLE_NAMES) {
    const key = String(input?.[role] ?? "").trim();
    if (key && !keys.has(key)) throw new CRMError("INVALID_ROLE", `O campo configurado para ${role} não existe.`);
    roles[role] = key;
  }
  if (requireId && !roles.id) throw new CRMError("ID_REQUIRED", "Defina um campo ID único antes de salvar contatos.");
  if (roles.id && Object.entries(roles).some(([role, key]) => role !== "id" && key === roles.id)) throw new CRMError("INVALID_ROLE", "O campo ID não pode ter outro papel.");
  return roles;
}
export function validateCountryCode(value) {
  const code = String(value ?? "55").replace(/^\+/, "").trim();
  if (!/^[1-9]\d{0,2}$/.test(code)) throw new CRMError("INVALID_COUNTRY", "Informe o código de país, como 55, 1 ou 351.");
  return code;
}
export function sameValue(a, b) { return a === b || ((a == null || a === "") && (b == null || b === "")); }

export function validateValues(input, fields, { countryCode = "55", base = {}, editing = false, idKey = "", enforceRequired = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CRMError("INVALID_CONTACT", "Os valores do contato são inválidos.");
  const fieldMap = new Map(fields.map(field => [field.key, field]));
  for (const key of Object.keys(input)) if (!fieldMap.has(key) && !(editing && Object.hasOwn(base, key) && sameValue(input[key], base[key]))) throw new CRMError("UNKNOWN_FIELD", `O campo ${key} não existe nesta base.`);
  const output = { ...base };
  for (const [key, supplied] of Object.entries(input)) {
    const field = fieldMap.get(key);
    if (!field) continue; // Preserve values of removed local fields.
    if (key === idKey || field.readOnly) {
      if (editing && !sameValue(supplied, base[key] ?? "")) throw new CRMError("READ_ONLY", `O campo ${field.label} é somente leitura.`);
      if (!editing && supplied !== "" && supplied != null) throw new CRMError("READ_ONLY", `O campo ${field.label} é gerado automaticamente.`);
      continue;
    }
    if (editing && sameValue(supplied, base[key])) continue; // Legacy/imported values need not be retyped to edit another field.
    let value = supplied ?? "";
    if (!["string", "number", "boolean"].includes(typeof value)) throw new CRMError("INVALID_VALUE", `Valor inválido para ${field.label}.`);
    if (typeof value === "string" && value.length > 30000) throw new CRMError("INVALID_VALUE", `O texto de ${field.label} é muito longo.`);
    if (field.type === "checkbox") {
      if (![true, false, "", "TRUE", "FALSE", "true", "false"].includes(value)) throw new CRMError("INVALID_VALUE", `Use verdadeiro ou falso em ${field.label}.`);
      value = value === true || value === "TRUE" || value === "true";
    } else if (value !== "") {
      const str = String(value).trim();
      if (field.type === "number") {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(str) || !Number.isFinite(Number(str))) throw new CRMError("INVALID_VALUE", `Use um número válido em ${field.label}.`);
        value = Number(str);
      } else if (field.type === "date") {
        const date = new Date(str + "T00:00:00Z");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== str) throw new CRMError("INVALID_VALUE", `Use uma data válida (AAAA-MM-DD) em ${field.label}.`);
        value = str;
      } else if (field.type === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) throw new CRMError("INVALID_VALUE", `Use um e-mail válido em ${field.label}.`);
        value = str;
      } else if (field.type === "phone") {
        if (!normalizePhone(str, countryCode)) throw new CRMError("INVALID_VALUE", `Use um telefone válido em ${field.label}. Para outro país, comece com + e o código do país.`);
        value = str;
      } else if (field.type === "url") {
        let url;
        try { url = new URL(str); } catch { throw new CRMError("INVALID_VALUE", `Use um endereço completo em ${field.label}.`); }
        if (!["https:", "http:"].includes(url.protocol)) throw new CRMError("INVALID_VALUE", `Use um endereço http ou https em ${field.label}.`);
        value = str;
      } else if (field.type === "select") {
        if (!field.options.includes(str)) throw new CRMError("INVALID_VALUE", `Escolha uma opção válida em ${field.label}.`);
        value = str;
      } else value = typeof value === "string" ? value : String(value);
    }
    output[key] = value;
  }
  if (enforceRequired) for (const field of fields) {
    if (field.key !== idKey && field.required && !field.readOnly && (output[field.key] == null || String(output[field.key]).trim() === "")) throw new CRMError("REQUIRED_FIELD", `Preencha ${field.label}.`);
  }
  return output;
}
export function assertExpected(record, expected) {
  if (expected === undefined) throw new CRMError("EXPECTED_REQUIRED", "Reabra o contato antes de editar. Uma versão anterior é necessária para detectar alterações.");
  const values = expected?.values && typeof expected.values === "object" ? expected.values : expected;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new CRMError("INVALID_EXPECTED", "A versão anterior do contato é inválida.");
  const keys = new Set([...Object.keys(record.values), ...Object.keys(values)]);
  if ([...keys].some(key => !sameValue(record.values[key], values[key]))) throw new CRMError("CONFLICT", "Este contato mudou desde que foi aberto. Atualize e revise antes de salvar.");
}
export function assertUniqueIds(records, idKey) {
  if (!idKey) throw new CRMError("ID_REQUIRED", "Defina a coluna ID nas configurações antes de salvar contatos.");
  const ids = new Set();
  for (const record of records) {
    const id = String(record.values[idKey] ?? "").trim();
    if (isInvalidIdentity(id)) throw new CRMError("MISSING_ID", "Existem linhas sem ID. Preencha IDs únicos na planilha antes de salvar contatos.");
    if (ids.has(id)) throw new CRMError("DUPLICATE_ID", "Existem IDs repetidos na planilha. Corrija-os antes de salvar contatos.");
    ids.add(id);
  }
  return ids;
}
export function resolveIdentity(identity, records, roles, countryCode = "55") {
  const phone = normalizePhone(identity?.phone, countryCode);
  const name = normalizeNameKey(identity?.name);
  let candidates = [];
  let method = "none";
  if (phone && roles.phone) {
    method = "phone";
    candidates = records.filter(record => normalizePhone(record.values[roles.phone], countryCode) === phone);
  } else if (!identity?.phone && name && roles.name) {
    method = "name";
    candidates = records.filter(record => normalizeNameKey(record.values[roles.name]) === name);
  }
  if (identity?.phone && !phone) return { status: "none", candidates: [], method: "invalid-phone" };
  if (candidates.length === 1) return { status: method === "name" ? "suggested" : "matched", record: candidates[0], candidates, method };
  return { status: candidates.length > 1 ? "ambiguous" : "none", candidates, method };
}
export function scopeFor(config) {
  return config.provider === "sheets" ? `sheets:${config.spreadsheetId}:${config.sheetId ?? "unselected"}` : "local";
}
export function normalizeTemplates(input) {
  if (!Array.isArray(input) || input.length > 100) throw new CRMError("INVALID_TEMPLATES", "Use até 100 modelos de mensagem.");
  const ids = new Set();
  return input.map(template => {
    const id = String(template.id || crypto.randomUUID());
    const name = String(template.name ?? template.title ?? "").trim();
    const text = String(template.text ?? template.body ?? "");
    if (!name || name.length > 100 || !text.trim() || text.length > 10000 || ids.has(id)) throw new CRMError("INVALID_TEMPLATES", "Cada modelo precisa de um nome, um texto e um ID único.");
    ids.add(id);
    return { id, name, text };
  });
}
export function demoRecords(fields = DEFAULT_FIELDS, roles = DEFAULT_ROLES) {
  return ["Alice", "Bruno", "Carla"].map((name, index) => ({
    id: `demo-${index + 1}`,
    values: Object.fromEntries(fields.map(field => [field.key,
      field.key === roles.id ? `demo-${index + 1}` :
      field.key === roles.name ? `${name} Demonstração` :
      field.key === roles.phone ? `+1 202 555 010${index + 1}` :
      field.key === roles.stage ? (field.options?.[index % field.options.length] ?? "") :
      field.key === roles.notes ? "Contato fictício. Apague ou substitua ao começar sua base." :
      field.type === "checkbox" ? false : ""])),
  }));
}
