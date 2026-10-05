import { CRMError, assertExpected, assertUniqueIds, sameValue, validateFields, validateRoles } from "./model.js";
import { isInvalidIdentity, normalizeNameKey } from "./keys.js";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const MAX_RECORDS = 10000;
const API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

export function parseSpreadsheetId(value) {
  const text = String(value ?? "").trim();
  let id = text;
  if (/^https?:/i.test(text)) {
    let url;
    try { url = new URL(text); } catch { throw new CRMError("INVALID_SPREADSHEET", "Cole o link de uma planilha do Google Sheets."); }
    const match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match) throw new CRMError("INVALID_SPREADSHEET", "Use um link https://docs.google.com/spreadsheets/d/…");
    id = match[1];
  }
  if (!/^[a-zA-Z0-9_-]{20,180}$/.test(id)) throw new CRMError("INVALID_SPREADSHEET", "O ID da planilha é inválido.");
  return id;
}
export function columnName(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new CRMError("INVALID_COLUMN", "Coluna inválida.");
  let value = index + 1;
  let name = "";
  while (value) { const digit = (value - 1) % 26; name = String.fromCharCode(65 + digit) + name; value = Math.floor((value - 1) / 26); }
  return name;
}
export function quoteSheetTitle(title) { return "'" + String(title).replace(/'/g, "''") + "'"; }
export function cellRange(title, rowNumber, columnIndex) { return `${quoteSheetTitle(title)}!${columnName(columnIndex)}${rowNumber}`; }
function cellHasValue(cell) {
  return Boolean(cell && (cell.userEnteredValue != null || cell.effectiveValue != null || cell.formattedValue != null && cell.formattedValue !== ""));
}
function scalarValue(cell, type = "text") {
  if (!cell) return type === "checkbox" ? false : "";
  const effective = cell.effectiveValue ?? cell.userEnteredValue ?? {};
  if (effective.errorValue) return cell.formattedValue || "#ERROR!";
  if (type === "checkbox" && typeof effective.boolValue === "boolean") return effective.boolValue;
  if (type === "number" && typeof effective.numberValue === "number") return effective.numberValue;
  if (type === "date" && typeof effective.numberValue === "number" && ["DATE", "DATE_TIME"].includes(cell.effectiveFormat?.numberFormat?.type)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(effective.numberValue) * 86400000).toISOString().slice(0, 10);
  }
  return cell.formattedValue ?? effective.stringValue ?? (effective.numberValue != null ? String(effective.numberValue) : effective.boolValue != null ? String(effective.boolValue) : "");
}
function headerKey(cell) {
  if (cell?.userEnteredValue?.formulaValue) throw new CRMError("FORMULA_HEADER", "Cabeçalhos com fórmulas não podem ser usados. Use nomes de coluna fixos.");
  return String(scalarValue(cell)).trim();
}
export function autodetectRoles(fields) {
  const aliases = {
    id: ["id", "uuid", "crm_id", "record_id", "identificador"],
    name: ["nome", "name", "contato", "contact", "cliente", "customer"],
    phone: ["telefone", "phone", "celular", "mobile", "whatsapp", "numero"],
    stage: ["etapa", "stage", "status", "pipeline"],
    nextContact: ["proximo_contato", "next_contact", "follow_up", "followup", "nextcontact"],
    notes: ["observacoes", "notes", "notas", "anotacoes"],
  };
  const roles = {};
  for (const [role, names] of Object.entries(aliases)) {
    const candidates = fields.filter(field => names.includes(normalizeNameKey(field.key).replace(/[^a-z0-9]+/g, "_")));
    roles[role] = candidates.length === 1 ? candidates[0].key : "";
  }
  return roles;
}
function inferType(key, cells) {
  const name = normalizeNameKey(key).replace(/[^a-z0-9]+/g, "_");
  if (/^(telefone|phone|celular|mobile|whatsapp)$/.test(name)) return "phone";
  if (/^(email|e_mail)$/.test(name)) return "email";
  if (/^(observacoes|notes|notas|anotacoes)$/.test(name)) return "textarea";
  if (/^(proximo_contato|next_contact|data|date|followup|follow_up)$/.test(name)) return "date";
  if (cells.length && cells.every(cell => typeof cell.effectiveValue?.boolValue === "boolean" || typeof cell.userEnteredValue?.boolValue === "boolean")) return "checkbox";
  if (name !== "id" && cells.length && cells.every(cell => typeof cell.effectiveValue?.numberValue === "number" && !["DATE", "DATE_TIME"].includes(cell.effectiveFormat?.numberFormat?.type))) return "number";
  return "text";
}
export function validateSheetCell(cell, value, label) {
  const rule = cell?.dataValidation;
  if (!rule?.strict || value === "" || value == null) return;
  const condition = rule.condition;
  const type = condition?.type;
  const options = (condition?.values ?? []).map(item => item.userEnteredValue);
  let valid;
  const text = String(value);
  const number = Number(value);
  const numeric = options.every(item => item !== undefined && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(item)));
  const unsupported = () => { throw new CRMError("SHEET_VALIDATION_UNSUPPORTED", `O campo ${label} tem uma validação da planilha que o CRM não consegue verificar. Edite essa célula diretamente no Google Sheets.`); };
  switch (type) {
    case "ONE_OF_LIST": valid = options.includes(text); break;
    case "BOOLEAN": valid = options.length ? options.includes(text) : typeof value === "boolean"; break;
    case "TEXT_IS_VALID_EMAIL": valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text); break;
    case "TEXT_IS_VALID_URL": { try { valid = ["http:", "https:"].includes(new URL(text).protocol); } catch { valid = false; } break; }
    case "TEXT_CONTAINS": valid = options.length === 1 && text.toLowerCase().includes(options[0]?.toLowerCase()); break;
    case "TEXT_NOT_CONTAINS": valid = options.length === 1 && !text.toLowerCase().includes(options[0]?.toLowerCase()); break;
    case "TEXT_STARTS_WITH": valid = options.length === 1 && text.toLowerCase().startsWith(options[0]?.toLowerCase()); break;
    case "TEXT_ENDS_WITH": valid = options.length === 1 && text.toLowerCase().endsWith(options[0]?.toLowerCase()); break;
    case "TEXT_EQ": valid = options.length === 1 && text.toLowerCase() === options[0]?.toLowerCase(); break;
    case "NUMBER_GREATER": case "NUMBER_GREATER_THAN_EQ": case "NUMBER_LESS": case "NUMBER_LESS_THAN_EQ": case "NUMBER_EQ": case "NUMBER_NOT_EQ": case "NUMBER_BETWEEN": case "NUMBER_NOT_BETWEEN": {
      if (!numeric || !options.length || (type.includes("BETWEEN") && options.length !== 2)) return unsupported();
      if (!Number.isFinite(number) || !text.trim()) { valid = false; break; }
      const a = Number(options[0]), b = Number(options[1]);
      valid = type === "NUMBER_GREATER" ? number > a : type === "NUMBER_GREATER_THAN_EQ" ? number >= a : type === "NUMBER_LESS" ? number < a : type === "NUMBER_LESS_THAN_EQ" ? number <= a : type === "NUMBER_EQ" ? number === a : type === "NUMBER_NOT_EQ" ? number !== a : type === "NUMBER_BETWEEN" ? number >= a && number <= b : !(number >= a && number <= b);
      break;
    }
    default: return unsupported(); // Formula/range/date rules need Google's evaluator.
  }
  if (!valid) throw new CRMError("SHEET_VALIDATION", `O valor de ${label} não atende à validação configurada na planilha.`);
}

export function parseSheetSnapshot(sheet, saved = {}) {
  const rows = [];
  for (const block of sheet.data ?? []) {
    const startRow = block.startRow ?? 0;
    const startColumn = block.startColumn ?? 0;
    for (const [offset, row] of (block.rowData ?? []).entries()) {
      const rowIndex = startRow + offset;
      rows[rowIndex] ??= [];
      for (const [column, cell] of (row.values ?? []).entries()) rows[rowIndex][startColumn + column] = cell;
    }
  }
  let lastDataRow = 0;
  for (let index = 0; index < rows.length; index++) if (rows[index]?.some(cellHasValue)) lastDataRow = index + 1;
  if (lastDataRow > MAX_RECORDS + 1) throw new CRMError("BASE_TOO_LARGE", `Esta versão aceita até ${MAX_RECORDS} linhas de contato. Escolha uma aba menor.`);
  const headerRow = rows[0] ?? [];
  const keys = new Set();
  const columns = [];
  for (const [columnIndex, cell] of headerRow.entries()) {
    const key = headerKey(cell);
    if (!key) continue;
    if (keys.has(key)) throw new CRMError("DUPLICATE_HEADER", `A coluna ${key} aparece mais de uma vez. Corrija os cabeçalhos na planilha.`);
    keys.add(key);
    const columnCells = rows.slice(1).map(row => row?.[columnIndex]).filter(cellHasValue);
    const stored = saved.fields?.find(field => field.key === key);
    const field = { key, label: stored?.label ?? key, type: stored?.type ?? inferType(key, columnCells), columnIndex };
    const lists = columnCells.map(cell => cell.dataValidation?.condition).filter(condition => condition?.type === "ONE_OF_LIST").map(condition => (condition.values ?? []).map(item => item.userEnteredValue));
    if (!stored?.type && lists.length && lists.every(options => JSON.stringify(options) === JSON.stringify(lists[0])) && lists[0].every(option => typeof option === "string" && option.trim())) { field.type = "select"; field.options = lists[0]; }
    if (stored?.options && field.type === "select") field.options = [...stored.options];
    for (const flag of ["required", "hidden", "readOnly"]) if (stored?.[flag]) field[flag] = true;
    if (columnCells.some(value => value?.userEnteredValue?.formulaValue)) field.readOnly = true;
    if (columnCells.some(value => value?.userEnteredValue?.formulaValue)) field.hasFormula = true;
    columns.push(field);
  }
  const valid = validateFields(columns, { allowEmpty: true });
  const fields = valid.map((field, index) => ({ ...field, columnIndex: columns[index].columnIndex, ...(columns[index].hasFormula ? { hasFormula: true } : {}) }));
  // A user may rename or remove headers directly in their own spreadsheet.
  // Load the current schema and leave vanished role assignments empty so the
  // settings panel can repair them; a stale form is still rejected on writing.
  const availableKeys = new Set(fields.map(field => field.key));
  const roleInput = saved.roles ? Object.fromEntries(Object.entries(saved.roles).map(([role, key]) => [role, availableKeys.has(key) ? key : ""])) : autodetectRoles(fields);
  const roles = validateRoles(roleInput, fields, { requireId: false });
  const idField = fields.find(field => field.key === roles.id);
  if (idField) idField.readOnly = true;
  const records = [];
  let unnamedData = false;
  const positions = new Set(fields.map(field => field.columnIndex));
  for (let rowIndex = 1; rowIndex < lastDataRow; rowIndex++) {
    const cells = rows[rowIndex] ?? [];
    if (cells.some((cell, index) => cellHasValue(cell) && !positions.has(index))) unnamedData = true;
    if (!fields.some(field => cellHasValue(cells[field.columnIndex]))) continue;
    const values = Object.fromEntries(fields.map(field => [field.key, scalarValue(cells[field.columnIndex], field.type)]));
    const formulaKeys = fields.filter(field => cells[field.columnIndex]?.userEnteredValue?.formulaValue).map(field => field.key);
    records.push({ id: String(values[roles.id] ?? "").trim(), values, rowNumber: rowIndex + 1, ...(formulaKeys.length ? { formulaKeys } : {}) });
  }
  const counts = new Map();
  for (const record of records) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  for (const record of records) if (isInvalidIdentity(record.id) || counts.get(record.id) > 1) record.id = `unidentified:${record.rowNumber}`;
  let writeIssue = null;
  try {
    assertUniqueIds(records, roles.id);
    if (!fields.length) throw new CRMError("EMPTY_HEADERS", "Esta aba não tem cabeçalhos. Crie uma aba modelo ou preencha a primeira linha.");
    if (idField?.hasFormula) throw new CRMError("FORMULA_ID", "IDs não podem vir de fórmulas. Use IDs fixos e únicos.");
    if (unnamedData) throw new CRMError("UNNAMED_COLUMN", "Há dados em colunas sem cabeçalho. Nomeie essas colunas antes de editar pelo CRM.");
  } catch (error) { writeIssue = { code: error.code, message: error.message }; }
  return { fields, roles, records, rows, lastDataRow, properties: sheet.properties, protectedRanges: sheet.protectedRanges ?? [], writeIssue, unnamedData };
}

export function assertSameHeaders(before, after) {
  const signature = snapshot => snapshot.fields.map(field => `${field.columnIndex}:${field.key}`).join("\u0000");
  if (signature(before) !== signature(after)) throw new CRMError("SCHEMA_CHANGED", "Os cabeçalhos da planilha mudaram. Atualize o CRM antes de salvar.");
}
export function assertWritable(snapshot) {
  if (snapshot.writeIssue) throw new CRMError(snapshot.writeIssue.code, snapshot.writeIssue.message);
}
export function assertCellUnprotected(snapshot, rowIndex, columnIndex) {
  for (const protection of snapshot.protectedRanges) {
    if (protection.warningOnly) continue;
    const range = protection.range;
    if (!range) throw new CRMError("PROTECTED_RANGE", "Esta aba possui um intervalo protegido. Edite esse campo na planilha.");
    const within = rowIndex >= (range.startRowIndex ?? 0) && rowIndex < (range.endRowIndex ?? Infinity) && columnIndex >= (range.startColumnIndex ?? 0) && columnIndex < (range.endColumnIndex ?? Infinity);
    const excluded = (protection.unprotectedRanges ?? []).some(free => rowIndex >= (free.startRowIndex ?? 0) && rowIndex < (free.endRowIndex ?? Infinity) && columnIndex >= (free.startColumnIndex ?? 0) && columnIndex < (free.endColumnIndex ?? Infinity));
    if (within && !excluded) throw new CRMError("PROTECTED_RANGE", "Este campo está em um intervalo protegido. Edite-o diretamente na planilha.");
  }
}
export function planRecordWrite(snapshot, { id, values, expected, newId }) {
  assertWritable(snapshot);
  const isEdit = id != null && id !== "";
  const record = isEdit ? snapshot.records.find(item => item.id === String(id)) : null;
  if (isEdit && !record) throw new CRMError("NOT_FOUND", "O contato não existe mais nesta planilha. Atualize a lista.");
  if (record) assertExpected(record, expected);
  const rowNumber = record?.rowNumber ?? Math.max(1, snapshot.lastDataRow) + 1;
  const recordId = record?.id ?? newId;
  if (!recordId || snapshot.records.some(item => item.id === recordId && item !== record)) throw new CRMError("DUPLICATE_ID", "Não foi possível gerar um ID único.");
  const output = { ...values, [snapshot.roles.id]: recordId };
  const data = [];
  for (const field of snapshot.fields) {
    const existing = record?.values[field.key] ?? "";
    const next = output[field.key] ?? (field.type === "checkbox" ? false : "");
    if (record && sameValue(existing, next)) continue;
    if (field.key !== snapshot.roles.id && (field.readOnly || field.hasFormula)) {
      if (record && !sameValue(existing, next)) throw new CRMError("READ_ONLY", `O campo ${field.label} é somente leitura.`);
      continue;
    }
    if (record && field.key === snapshot.roles.id) continue;
    assertCellUnprotected(snapshot, rowNumber - 1, field.columnIndex);
    const targetCell = snapshot.rows[rowNumber - 1]?.[field.columnIndex];
    validateSheetCell(targetCell, next, field.label);
    const raw = field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(next)) && ["DATE", "DATE_TIME"].includes(targetCell?.effectiveFormat?.numberFormat?.type) ? (Date.parse(next + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000 : next;
    // Individual cells preserve formulas, unrelated columns, and header rows.
    data.push({ range: cellRange(snapshot.properties.title, rowNumber, field.columnIndex), values: [[raw]] });
  }
  return { rowNumber, id: recordId, values: output, data, valueInputOption: "RAW" };
}
export function planSchemaAppend(snapshot, proposedFields) {
  const fields = validateFields(proposedFields);
  const proposedKeys = new Set(fields.map(field => field.key));
  for (const existing of snapshot.fields) if (!proposedKeys.has(existing.key)) throw new CRMError("HEADER_IMMUTABLE", "Cabeçalhos existentes não podem ser apagados ou renomeados pelo CRM. Altere apenas o rótulo ou oculte o campo.");
  const existingKeys = new Set(snapshot.fields.map(field => field.key));
  const additions = fields.filter(field => !existingKeys.has(field.key));
  const startColumn = snapshot.fields.length ? Math.max(...snapshot.fields.map(field => field.columnIndex)) + 1 : 0;
  const data = [];
  for (const [offset, field] of additions.entries()) {
    const columnIndex = startColumn + offset;
    if (snapshot.rows.some(row => cellHasValue(row?.[columnIndex]))) throw new CRMError("COLUMN_NOT_EMPTY", "Uma coluna de destino já contém dados. Nomeie-a na planilha antes de adicionar campos.");
    assertCellUnprotected(snapshot, 0, columnIndex);
    data.push({ range: cellRange(snapshot.properties.title, 1, columnIndex), values: [[field.key]] });
  }
  return { fields, additions, data, requiredColumns: startColumn + additions.length, valueInputOption: "RAW" };
}

export function planInitializeIds(snapshot, uuid = () => crypto.randomUUID()) {
  if (snapshot.unnamedData) throw new CRMError("UNNAMED_COLUMN", "Nomeie as colunas que já contêm dados antes de preparar os IDs.");
  const idKey = snapshot.roles.id || snapshot.fields.find(field => normalizeNameKey(field.key) === "crm_id")?.key || "crm_id";
  const existing = snapshot.fields.find(field => field.key === idKey);
  if (existing?.hasFormula) throw new CRMError("FORMULA_ID", "A coluna ID contém fórmulas. Use uma coluna com IDs fixos.");
  const proposed = snapshot.fields.map(({ columnIndex, hasFormula, ...field }) => ({ ...field, ...(field.key === idKey ? { readOnly: true } : {}) }));
  if (!existing) proposed.push({ key: idKey, label: "ID do CRM", type: "text", readOnly: true, hidden: true });
  const append = planSchemaAppend(snapshot, proposed);
  const roles = validateRoles({ ...snapshot.roles, id: idKey }, append.fields);
  const columnIndex = existing?.columnIndex ?? append.requiredColumns - 1;
  const ids = new Set();
  for (const record of snapshot.records) {
    const id = String(record.values[idKey] ?? "").trim();
    if (!id) continue;
    if (isInvalidIdentity(id)) throw new CRMError("INVALID_ID", "A coluna ID contém um valor inválido que precisa ser corrigido na planilha.");
    if (ids.has(id)) throw new CRMError("DUPLICATE_ID", "Existem IDs repetidos. Corrija-os antes de preparar IDs vazios.");
    ids.add(id);
  }
  const data = [...append.data];
  let created = 0;
  for (const record of snapshot.records) {
    if (String(record.values[idKey] ?? "").trim()) continue;
    let id;
    for (let attempt = 0; attempt < 5; attempt++) { id = uuid(); if (id && !isInvalidIdentity(id) && !ids.has(id)) break; }
    if (!id || isInvalidIdentity(id) || ids.has(id)) throw new CRMError("DUPLICATE_ID", "Não foi possível gerar um ID único. Nenhum ID foi alterado.");
    ids.add(id);
    const rowIndex = record.rowNumber - 1;
    assertCellUnprotected(snapshot, rowIndex, columnIndex);
    validateSheetCell(snapshot.rows[rowIndex]?.[columnIndex], id, existing?.label ?? "ID do CRM");
    data.push({ range: cellRange(snapshot.properties.title, record.rowNumber, columnIndex), values: [[id]] });
    created++;
  }
  return { fields: append.fields, roles, data, created, requiredColumns: append.requiredColumns, requiredRows: snapshot.lastDataRow, valueInputOption: "RAW" };
}

export class SheetsClient {
  constructor({ fetchImpl = globalThis.fetch, identity = globalThis.chrome?.identity, runtime = globalThis.chrome?.runtime } = {}) {
    this.fetchImpl = fetchImpl; this.identity = identity; this.runtime = runtime;
  }
  async token(interactive = false) {
    const oauth = this.runtime?.getManifest?.().oauth2;
    if (!oauth?.client_id || /REPLACE|YOUR_|PLACEHOLDER/i.test(oauth.client_id)) throw new CRMError("OAUTH_NOT_CONFIGURED", "A conexão Google está desativada nesta versão de desenvolvimento. O publicador deve configurar um cliente OAuth próprio do SheetDock antes do lançamento. O CRM local já funciona.");
    if (!oauth.scopes?.includes(SHEETS_SCOPE)) throw new CRMError("OAUTH_SCOPE_MISSING", "O manifest precisa declarar a permissão de Google Sheets para habilitar a conexão.");
    if (!this.identity?.getAuthToken) throw new CRMError("AUTH_UNAVAILABLE", "A autenticação Google só está disponível quando a extensão é instalada no Chrome.");
    return new Promise((resolve, reject) => {
      this.identity.getAuthToken({ interactive }, result => {
        const problem = this.runtime?.lastError;
        const token = typeof result === "string" ? result : result?.token;
        if (problem || !token) reject(new CRMError("AUTH_REQUIRED", interactive ? "Não foi possível autorizar o Google. Confira a conta do Chrome e tente novamente." : "Reconecte sua conta Google para atualizar esta planilha."));
        else resolve(token);
      });
    });
  }
  async request(id, suffix = "", { method = "GET", body, interactive = false, query } = {}) {
    const token = await this.token(interactive);
    const url = new URL(`${API_ROOT}${id ? "/" + encodeURIComponent(id) : ""}${suffix}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    let response;
    try { response = await this.fetchImpl(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new CRMError("NETWORK_ERROR", "Não foi possível acessar o Google Sheets. Confira sua conexão e tente novamente."); }
    if (!response.ok) {
      if (response.status === 401) {
        await this.removeToken(token);
        throw new CRMError("AUTH_REQUIRED", "A autorização Google expirou. Reconecte sua conta.");
      }
      if (response.status === 403) throw new CRMError("SHEETS_FORBIDDEN", "A conta Google não tem acesso de edição, a API não foi habilitada ou a autorização foi recusada.");
      if (response.status === 404) throw new CRMError("SHEETS_NOT_FOUND", "A planilha não existe ou não está acessível por esta conta.");
      if (response.status === 429) throw new CRMError("RATE_LIMIT", "O limite temporário do Google Sheets foi atingido. Aguarde e tente novamente.");
      throw new CRMError("SHEETS_ERROR", `O Google Sheets recusou a operação (${response.status}). Atualize os dados e tente novamente.`);
    }
    const text = await response.text();
    if (text.length > 10000000) throw new CRMError("BASE_TOO_LARGE", "A resposta da planilha é muito grande. Escolha uma aba menor.");
    try { return text ? JSON.parse(text) : {}; } catch { throw new CRMError("SHEETS_RESPONSE", "O Google Sheets retornou uma resposta inválida."); }
  }
  async removeToken(token) {
    if (!this.identity?.removeCachedAuthToken) return;
    await new Promise(resolve => this.identity.removeCachedAuthToken({ token }, () => { void this.runtime?.lastError; resolve(); }));
  }
  async disconnect() {
    if (this.identity?.clearAllCachedAuthTokens) await new Promise(resolve => this.identity.clearAllCachedAuthTokens(() => { void this.runtime?.lastError; resolve(); }));
    else { try { await this.removeToken(await this.token(false)); } catch { /* No cached authorization. */ } }
  }
  async metadata(id, interactive = false) {
    const result = await this.request(id, "", { interactive, query: { fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,gridProperties))" } });
    return { id: result.spreadsheetId, title: result.properties?.title ?? "Planilha", tabs: (result.sheets ?? []).filter(sheet => !sheet.properties.sheetType || sheet.properties.sheetType === "GRID").map(sheet => ({ id: sheet.properties.sheetId, title: sheet.properties.title, gridProperties: sheet.properties.gridProperties })) };
  }
  async readSheet(id, tab, saved = {}) {
    const result = await this.request(id, "", { query: {
      includeGridData: "true", ranges: quoteSheetTitle(tab.title),
      fields: "sheets(properties,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat(numberFormat),dataValidation))),protectedRanges(range,warningOnly,unprotectedRanges))",
    } });
    const sheet = result.sheets?.find(item => item.properties.sheetId === tab.id);
    if (!sheet) throw new CRMError("SHEET_NOT_FOUND", "A aba selecionada não existe mais. Escolha outra aba.");
    return parseSheetSnapshot(sheet, saved);
  }
  async writeCells(id, data) {
    if (!data.length) return;
    return this.request(id, "/values:batchUpdate", { method: "POST", body: { valueInputOption: "RAW", data, includeValuesInResponse: false } });
  }
  async ensureGrid(id, snapshot, { rows = 0, columns = 0 }) {
    const grid = snapshot.properties.gridProperties ?? {};
    const requests = [];
    if (rows > (grid.rowCount ?? 0)) requests.push({ appendDimension: { sheetId: snapshot.properties.sheetId, dimension: "ROWS", length: rows - (grid.rowCount ?? 0) } });
    if (columns > (grid.columnCount ?? 0)) requests.push({ appendDimension: { sheetId: snapshot.properties.sheetId, dimension: "COLUMNS", length: columns - (grid.columnCount ?? 0) } });
    if (requests.length) await this.request(id, ":batchUpdate", { method: "POST", body: { requests } });
  }
  async createSheet(id, title) {
    if (!String(title).trim() || String(title).length > 80 || /[\[\]:*?/\\]/.test(title)) throw new CRMError("INVALID_SHEET_TITLE", "Escolha um nome de aba de até 80 caracteres, sem colchetes, dois-pontos, asterisco, barras ou interrogação.");
    const result = await this.request(id, ":batchUpdate", { method: "POST", body: { requests: [{ addSheet: { properties: { title: String(title).trim(), gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } } } }] } });
    const properties = result.replies?.[0]?.addSheet?.properties;
    if (!properties) throw new CRMError("SHEETS_RESPONSE", "O Google não confirmou a criação da aba.");
    return { id: properties.sheetId, title: properties.title, gridProperties: properties.gridProperties };
  }
  async createSpreadsheet(title, headers) {
    const name = String(title ?? "").trim();
    if (!name || name.length > 120) throw new CRMError("INVALID_SHEET_TITLE", "Escolha um nome de planilha de até 120 caracteres.");
    const result = await this.request(null, "", { method: "POST", interactive: true, body: {
      properties: { title: name },
      sheets: [{ properties: { title: "CRM", gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values: headers.map(header => ({ userEnteredValue: { stringValue: header } })) }] }],
      }],
    } });
    if (!result.spreadsheetId || !result.sheets?.[0]?.properties) throw new CRMError("SHEETS_RESPONSE", "O Google não confirmou a criação da planilha.");
    return { id: result.spreadsheetId, title: result.properties?.title ?? name, tabs: result.sheets.map(sheet => ({ id: sheet.properties.sheetId, title: sheet.properties.title, gridProperties: sheet.properties.gridProperties })) };
  }
}
