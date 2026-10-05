import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNameKey, normalizePhone, extractPhoneFromDataId, isInvalidIdentity } from "../src/lib/keys.js";
import { DEFAULT_FIELDS, DEFAULT_ROLES, assertExpected, assertUniqueIds, clone, resolveIdentity, scopeFor, validateFields, validateRoles, validateValues } from "../src/lib/model.js";
import { CRMStorage } from "../src/lib/storage.js";
import { CRMService } from "../src/background.js";
import { SHEETS_SCOPE, SheetsClient, assertSameHeaders, columnName, parseSheetSnapshot, parseSpreadsheetId, planRecordWrite, planSchemaAppend, planInitializeIds, validateSheetCell } from "../src/lib/sheets.js";

const sheetId = "synthetic_spreadsheet_000001";
function errorCode(code) { return error => error?.code === code; }
function cell(value, { formula, date } = {}) {
  if (value === undefined || value === "") return {};
  const scalar = typeof value === "number" ? { numberValue: value } : typeof value === "boolean" ? { boolValue: value } : { stringValue: value };
  return { userEnteredValue: formula ? { formulaValue: formula } : scalar, effectiveValue: scalar, formattedValue: String(value), ...(date ? { effectiveFormat: { numberFormat: { type: "DATE" } } } : {}) };
}
function grid(rows, { headers = ["id", "nome", "telefone", "observacoes"], protections = [], title = "CRM" } = {}) {
  return { properties: { sheetId: 0, title, gridProperties: { rowCount: 1000, columnCount: 26 } }, data: [{ rowData: [headers.map(value => cell(value)), ...rows].map(values => ({ values })) }], protectedRanges: protections };
}
function fixture(rows, options) { return parseSheetSnapshot(grid(rows.map(row => row.map(value => typeof value === "object" ? value : cell(value))), options)); }
function localService() {
  let serial = 0;
  const storage = new CRMStorage(null);
  const service = new CRMService({ storage, uuid: () => `test-id-${++serial}`, now: () => 1791226800000 });
  return { service, storage };
}
function fakeSheets(sheet) {
  return {
    sheet, writes: [],
    async metadata() { return { id: sheetId, title: "Synthetic test sheet", tabs: [{ id: 0, title: this.sheet.properties.title }] }; },
    async readSheet(id, tab, saved) { return parseSheetSnapshot(clone(this.sheet), saved); },
    async ensureGrid() {},
    async writeCells(id, data) {
      this.writes.push({ id, data: clone(data), valueInputOption: "RAW" });
      for (const item of data) {
        const match = /!([A-Z]+)(\d+)$/.exec(item.range);
        const index = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        const row = Number(match[2]) - 1;
        this.sheet.data[0].rowData[row] ??= { values: [] };
        this.sheet.data[0].rowData[row].values[index] = cell(item.values[0][0]);
      }
    },
    async disconnect() {},
  };
}

test("country-aware phone identity preserves explicit foreign country and the ninth digit", () => {
  assert.equal(normalizePhone("(11) 91234-5678", "55"), "5511912345678");
  assert.equal(normalizePhone("+1 202 555 0101", "55"), "12025550101");
  assert.notEqual(normalizePhone("2025550101", "55"), normalizePhone("2025550101", "1"));
  assert.notEqual(normalizePhone("+55 11 91234-5678"), normalizePhone("+55 11 1234-5678"));
  assert.equal(normalizePhone("00351 912 345 678", "55"), "351912345678");
  assert.equal(normalizePhone("01234", "55"), null);
  assert.equal(normalizePhone("=12345678901", "55"), null);
  assert.equal(normalizePhone("912345678", "999"), null);
});

test("names preserve particles; placeholders and group JIDs never become identities", () => {
  assert.equal(normalizeNameKey("  José   de Souza "), "jose de souza");
  assert.notEqual(normalizeNameKey("Ana de Lima"), normalizeNameKey("Ana Lima"));
  assert.equal(isInvalidIdentity("#REF!"), true);
  assert.equal(normalizePhone("#N/A"), null);
  assert.equal(extractPhoneFromDataId("false_12025550101@c.us_message"), "12025550101");
  assert.equal(extractPhoneFromDataId("12025550101-123@g.us"), null);
});

test("duplicate identities are ambiguous and unique names are suggestions only", () => {
  const records = [
    { id: "a", values: { nome: "Ana", telefone: "+1 202 555 0101" } },
    { id: "b", values: { nome: "Ana", telefone: "+1 202 555 0101" } },
  ];
  assert.equal(resolveIdentity({ phone: "+1 202 555 0101" }, records, DEFAULT_ROLES).status, "ambiguous");
  assert.equal(resolveIdentity({ name: "Ana" }, records, DEFAULT_ROLES).status, "ambiguous");
  assert.equal(resolveIdentity({ name: "Ana" }, records.slice(0, 1), DEFAULT_ROLES).status, "suggested");
  assert.equal(resolveIdentity({ name: "Ana", phone: "+1 202 555 0102" }, records, DEFAULT_ROLES).status, "none");
  assert.equal(resolveIdentity({ name: "Ana", phone: "invalid" }, records, DEFAULT_ROLES).status, "none");
});

test("schema validates unique safe keys and role references", () => {
  assert.throws(() => validateFields([{ key: "id", label: "ID", type: "text" }, { key: "id", label: "Repeat", type: "text" }]), errorCode("INVALID_SCHEMA"));
  assert.throws(() => validateFields([{ key: "__proto__", label: "Unsafe", type: "text" }]), errorCode("INVALID_SCHEMA"));
  assert.throws(() => validateFields([{ key: "stage", label: "Stage", type: "select", options: ["one", "one"] }]), errorCode("INVALID_SCHEMA"));
  assert.throws(() => validateRoles({ id: "missing" }, DEFAULT_FIELDS), errorCode("INVALID_ROLE"));
  assert.throws(() => validateRoles({ name: "nome" }, DEFAULT_FIELDS), errorCode("ID_REQUIRED"));
});

test("typed fields accept valid values and reject invalid dates, numbers, email and URLs", () => {
  const fields = validateFields([
    { key: "id", label: "ID", type: "text", readOnly: true },
    { key: "n", label: "Number", type: "number" }, { key: "d", label: "Date", type: "date" },
    { key: "e", label: "Email", type: "email" }, { key: "p", label: "Phone", type: "phone" },
    { key: "u", label: "URL", type: "url" }, { key: "c", label: "Checkbox", type: "checkbox" },
    { key: "s", label: "Select", type: "select", options: ["Open"] },
  ]);
  const values = validateValues({ n: "12.5", d: "2026-10-05", e: "demo@example.invalid", p: "+1 2025550101", u: "https://example.invalid", c: "TRUE", s: "Open" }, fields, { idKey: "id" });
  assert.equal(values.n, 12.5); assert.equal(values.c, true);
  for (const invalid of [{ d: "2026-02-30" }, { d: "garbage" }, { n: "Infinity" }, { n: "=1+2" }, { e: "no-address" }, { u: "javascript:alert(1)" }, { s: "closed" }, { c: "yes" }]) assert.throws(() => validateValues(invalid, fields, { idKey: "id" }), errorCode("INVALID_VALUE"));
  assert.throws(() => validateValues({ id: "chosen-id" }, fields, { idKey: "id" }), errorCode("READ_ONLY"));
});

test("editing another field preserves unchanged legacy date and removed field values", () => {
  const fields = [{ key: "id", label: "ID", type: "text", readOnly: true }, { key: "date", label: "Date", type: "date" }, { key: "notes", label: "Notes", type: "text" }];
  const base = { id: "a", date: "05/10/2026", notes: "before", archived: "retained" };
  const result = validateValues({ ...base, notes: "after" }, fields, { base, editing: true, idKey: "id" });
  assert.equal(result.date, "05/10/2026"); assert.equal(result.archived, "retained");
  assert.throws(() => validateValues({ ...base, archived: "changed" }, fields, { base, editing: true, idKey: "id" }), errorCode("UNKNOWN_FIELD"));
});

test("optimistic updates require the complete prior values and preserve unknown fields", () => {
  const record = { values: { id: "a", nome: "Alice", observacoes: "updated elsewhere" } };
  assert.throws(() => assertExpected(record), errorCode("EXPECTED_REQUIRED"));
  assert.throws(() => assertExpected(record, { id: "a", nome: "Alice" }), errorCode("CONFLICT"));
  assert.doesNotThrow(() => assertExpected(record, clone(record.values)));
});

test("IDs must be present, fixed and unique before writes", () => {
  assert.throws(() => assertUniqueIds([{ values: { id: "" } }], "id"), errorCode("MISSING_ID"));
  assert.throws(() => assertUniqueIds([{ values: { id: "a" } }, { values: { id: "a" } }], "id"), errorCode("DUPLICATE_ID"));
  const duplicate = fixture([["a", "Alice"], ["a", "Bruno"]]);
  assert.equal(duplicate.writeIssue.code, "DUPLICATE_ID");
  assert.notEqual(duplicate.records[0].id, duplicate.records[1].id);
});

test("imported duplicate/formula headers are rejected and unnamed data blocks writing", () => {
  assert.throws(() => fixture([], { headers: ["id", "id"] }), errorCode("DUPLICATE_HEADER"));
  const sheet = grid([]); sheet.data[0].rowData[0].values[0] = cell("id", { formula: '="id"' });
  assert.throws(() => parseSheetSnapshot(sheet), errorCode("FORMULA_HEADER"));
  const unnamed = fixture([["a", "Alice", "", "", "unmapped"]]);
  assert.equal(unnamed.writeIssue.code, "UNNAMED_COLUMN");
});

test("formula columns are readonly, formula IDs block all writes", () => {
  const snapshot = fixture([["a", "Alice", "", cell("Computed", { formula: '=B2&" computed"' })]]);
  assert.equal(snapshot.fields.find(field => field.key === "observacoes").readOnly, true);
  assert.throws(() => planRecordWrite(snapshot, { id: "a", values: { ...snapshot.records[0].values, observacoes: "replace" }, expected: snapshot.records[0].values }), errorCode("READ_ONLY"));
  const formulaId = fixture([[cell("a", { formula: '="a"' }), "Alice"]]);
  assert.equal(formulaId.writeIssue.code, "FORMULA_ID");
});

test("Sheets date serials are converted to ISO dates", () => {
  const serial = (Date.UTC(2026, 9, 5) - Date.UTC(1899, 11, 30)) / 86400000;
  const snapshot = fixture([["a", "Alice", cell(serial, { date: true })]], { headers: ["id", "nome", "proximo_contato"] });
  assert.equal(snapshot.records[0].values.proximo_contato, "2026-10-05");
  const plan = planRecordWrite(snapshot, { id: "a", expected: snapshot.records[0].values, values: { ...snapshot.records[0].values, proximo_contato: "2026-10-06" } });
  assert.equal(plan.data[0].values[0][0], serial + 1);
});

test("native strict Sheets validations reject invalid values and unsupported formula rules", () => {
  const rule = (type, values) => ({ dataValidation: { strict: true, condition: { type, values: values.map(userEnteredValue => ({ userEnteredValue })) } } });
  assert.doesNotThrow(() => validateSheetCell(rule("ONE_OF_LIST", ["Open", "Closed"]), "Open", "Stage"));
  assert.throws(() => validateSheetCell(rule("ONE_OF_LIST", ["Open", "Closed"]), "Invalid", "Stage"), errorCode("SHEET_VALIDATION"));
  assert.throws(() => validateSheetCell(rule("NUMBER_BETWEEN", ["0", "10"]), 11, "Number"), errorCode("SHEET_VALIDATION"));
  assert.throws(() => validateSheetCell(rule("NUMBER_GREATER", ["=A1"]), 11, "Number"), errorCode("SHEET_VALIDATION_UNSUPPORTED"));
  assert.throws(() => validateSheetCell(rule("CUSTOM_FORMULA", ["=A1>0"]), "change", "Custom"), errorCode("SHEET_VALIDATION_UNSUPPORTED"));
  assert.throws(() => validateSheetCell(rule("TEXT_IS_VALID_EMAIL", []), "invalid", "Email"), errorCode("SHEET_VALIDATION"));
});

test("consistent native dropdowns become select fields and validate the target cell", () => {
  const value = cell("Open");
  value.dataValidation = { strict: true, condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Open" }, { userEnteredValue: "Closed" }] } };
  const snapshot = fixture([["a", "Alice", value]], { headers: ["id", "nome", "etapa"] });
  assert.equal(snapshot.fields[2].type, "select");
  assert.deepEqual(snapshot.fields[2].options, ["Open", "Closed"]);
  assert.throws(() => planRecordWrite(snapshot, { id: "a", expected: snapshot.records[0].values, values: { ...snapshot.records[0].values, etapa: "Other" } }), errorCode("SHEET_VALIDATION"));
});

test("record writes reidentify a moved row by ID and write RAW individual cells", () => {
  const first = fixture([["a", "Alice", "", "before"], ["b", "Bruno", "", "other"]], { title: "CRM's data" });
  const moved = fixture([["b", "Bruno", "", "other"], ["a", "Alice", "", "before"]], { title: "CRM's data" });
  const plan = planRecordWrite(moved, { id: "a", expected: first.records[0].values, values: { ...first.records[0].values, observacoes: "=IMPORTXML(\"https://example.invalid\")" } });
  assert.equal(plan.valueInputOption, "RAW");
  assert.deepEqual(plan.data, [{ range: "'CRM''s data'!D3", values: [['=IMPORTXML("https://example.invalid")']] }]);
  assert.equal(columnName(0), "A"); assert.equal(columnName(26), "AA");
});

test("changed record values and protected target cells prevent writes", () => {
  const snapshot = fixture([["a", "Alice", "", "new"]]);
  assert.throws(() => planRecordWrite(snapshot, { id: "a", expected: { ...snapshot.records[0].values, observacoes: "old" }, values: snapshot.records[0].values }), errorCode("CONFLICT"));
  const protectedSnapshot = fixture([["a", "Alice", "", "new"]], { protections: [{ range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: 4 } }] });
  assert.throws(() => planRecordWrite(protectedSnapshot, { id: "a", expected: protectedSnapshot.records[0].values, values: { ...protectedSnapshot.records[0].values, observacoes: "changed" } }), errorCode("PROTECTED_RANGE"));
});

test("schema additions preserve headers, require blank destinations, and reject renames", () => {
  const snapshot = fixture([["a", "Alice"]]);
  const fields = snapshot.fields.map(({ columnIndex, hasFormula, ...field }) => field);
  const plan = planSchemaAppend(snapshot, [...fields.map(field => ({ ...field, label: "Editable label" })), { key: "custom", label: "Custom", type: "text" }]);
  assert.deepEqual(plan.data, [{ range: "'CRM'!E1", values: [["custom"]] }]);
  assert.throws(() => planSchemaAppend(snapshot, fields.slice(0, -1)), errorCode("HEADER_IMMUTABLE"));
  const blocked = fixture([["a", "Alice", "", "", "existing data"]]);
  assert.throws(() => planSchemaAppend(blocked, [...fields, { key: "custom", label: "Custom", type: "text" }]), errorCode("COLUMN_NOT_EMPTY"));
});

test("header movement is detected before a stale contact write", () => {
  const before = fixture([["a", "Alice"]]);
  const after = fixture([["Alice", "a"]], { headers: ["nome", "id", "telefone", "observacoes"] });
  assert.throws(() => assertSameHeaders(before, after), errorCode("SCHEMA_CHANGED"));
});

test("external header renames load safely and clear obsolete roles for self-service repair", () => {
  const sheet = grid([[cell("a"), cell("Alice")]], { headers: ["id", "display_name"] });
  const snapshot = parseSheetSnapshot(sheet, { roles: { id: "id", name: "nome", phone: "telefone", notes: "observacoes" } });
  assert.equal(snapshot.roles.id, "id"); assert.equal(snapshot.roles.name, "");
  assert.equal(snapshot.fields.some(field => field.key === "display_name"), true);
  assert.equal(snapshot.records.length, 1);
});

test("ID initialization appends a dedicated column and preserves all original cells", () => {
  let serial = 0;
  const snapshot = fixture([["Alice", "+12025550101", "note"], ["Bruno", "", "other"]], { headers: ["nome", "telefone", "observacoes"] });
  const plan = planInitializeIds(snapshot, () => `generated-${++serial}`);
  assert.equal(plan.roles.id, "crm_id"); assert.equal(plan.created, 2);
  assert.deepEqual(plan.data, [
    { range: "'CRM'!D1", values: [["crm_id"]] },
    { range: "'CRM'!D2", values: [["generated-1"]] },
    { range: "'CRM'!D3", values: [["generated-2"]] },
  ]);
  assert.equal(snapshot.records[0].values.observacoes, "note");
});

test("ID initialization fills only blanks and rejects duplicates, formula IDs and protected cells", () => {
  const snapshot = fixture([["keep-me", "Alice"], ["", "Bruno"]]);
  const plan = planInitializeIds(snapshot, () => "new-id");
  assert.deepEqual(plan.data, [{ range: "'CRM'!A3", values: [["new-id"]] }]);
  assert.throws(() => planInitializeIds(fixture([["same", "Alice"], ["same", "Bruno"]])), errorCode("DUPLICATE_ID"));
  assert.throws(() => planInitializeIds(fixture([[cell("computed", { formula: '=B2' }), "Alice"]])), errorCode("FORMULA_ID"));
  const protectedSnapshot = fixture([["", "Alice"]], { protections: [{ range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 } }] });
  assert.throws(() => planInitializeIds(protectedSnapshot), errorCode("PROTECTED_RANGE"));
  const unnamed = fixture([["Alice", "", "", "unmapped"]], { headers: ["nome"] });
  assert.throws(() => planInitializeIds(unnamed), errorCode("UNNAMED_COLUMN"));
});

test("Google links accept only the Sheets document origin and a valid ID", () => {
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`), sheetId);
  assert.throws(() => parseSpreadsheetId(`https://attacker.invalid/spreadsheets/d/${sheetId}`), errorCode("INVALID_SPREADSHEET"));
  assert.throws(() => parseSpreadsheetId("short"), errorCode("INVALID_SPREADSHEET"));
});

test("a fresh install is empty; demo requires an explicit call and an empty local base", async () => {
  const { service } = localService();
  const initial = await service.dispatch({ type: "STATE" });
  assert.equal(initial.records.length, 0); assert.equal(initial.fields.length, 8);
  const demo = await service.dispatch({ type: "DEMO_RESET" });
  assert.equal(demo.records.length, 3);
  assert.equal(demo.records.every(record => record.values.nome.includes("Demonstração")), true);
  await assert.rejects(service.dispatch({ type: "DEMO_RESET" }), errorCode("DEMO_NONEMPTY"));
});

test("local save uses generated IDs, detects conflicts and preserves values after schema edits", async () => {
  const { service } = localService();
  let state = await service.dispatch({ type: "CONTACT_SAVE", payload: { values: { nome: "Synthetic Alice", observacoes: "stored" }, scope: "local" } });
  const record = clone(state.records[0]);
  state = await service.dispatch({ type: "CONTACT_SAVE", payload: { id: record.id, values: { ...record.values, observacoes: "new" }, expected: record.values } });
  await assert.rejects(service.dispatch({ type: "CONTACT_SAVE", payload: { id: record.id, values: record.values, expected: record.values } }), errorCode("CONFLICT"));
  const fields = state.fields.filter(field => field.key !== "observacoes");
  const roles = { ...state.config.roles, notes: "" };
  state = await service.dispatch({ type: "SCHEMA_SAVE", payload: { fields, roles } });
  assert.equal(state.records[0].values.observacoes, "new");
  await assert.rejects(service.dispatch({ type: "SCHEMA_SAVE", payload: { fields, roles: { ...roles, id: "nome", name: "" } } }), errorCode("ID_IMMUTABLE"));
});

test("manual links detect reassociation conflicts, scope databases and disappear on local deletion", async () => {
  const { service } = localService();
  let state = await service.dispatch({ type: "CONTACT_SAVE", payload: { values: { nome: "Synthetic Alice" } } });
  const record = state.records[0];
  state = await service.dispatch({ type: "LINK_CHAT", payload: { recordId: record.id, identity: { name: "Alice", phone: "+12025550101" }, expected: null } });
  assert.equal(state.config.chatLinks["phone:12025550101"].recordId, record.id);
  await assert.rejects(service.dispatch({ type: "LINK_CHAT", payload: { recordId: record.id, identity: { phone: "+12025550101" }, expected: null } }), errorCode("LINK_CONFLICT"));
  assert.notEqual(scopeFor({ provider: "sheets", spreadsheetId: "a", sheetId: 0 }), scopeFor({ provider: "sheets", spreadsheetId: "a", sheetId: 1 }));
  state = await service.dispatch({ type: "CONTACT_DELETE", payload: { id: record.id, expected: record.values } });
  assert.equal(state.records.length, 0); assert.deepEqual(state.config.chatLinks, {});
});

test("base changes reject stale edits even when another database has the same ID and values", async () => {
  const { service } = localService();
  await service.initialize();
  service.store.config = { ...service.store.config, provider: "sheets", spreadsheetId: "base-b", sheetId: 0 };
  for (const type of ["CONTACT_SAVE", "CONTACT_DELETE", "SCHEMA_SAVE", "LINK_CHAT", "IMPORT_BACKUP", "CONFIG_SAVE"]) await assert.rejects(service.dispatch({ type, payload: { scope: "sheets:base-a:0" } }), errorCode("BASE_CHANGED"));
});

test("backup imports validate every record before a single write and regenerate all IDs", async () => {
  const { service, storage } = localService();
  let writes = 0;
  const write = storage.write.bind(storage); storage.write = async value => { writes++; await write(value); };
  const backup = { format: "sheetdock-backup", version: 1, fields: clone(DEFAULT_FIELDS), roles: clone(DEFAULT_ROLES), records: [
    { values: { id: "old-a", nome: "Alice", email: "valid@example.invalid" } },
    { values: { id: "old-b", nome: "Bruno", email: "invalid" } },
  ] };
  await assert.rejects(service.dispatch({ type: "IMPORT_BACKUP", payload: { backup } }), errorCode("INVALID_VALUE"));
  assert.equal(writes, 0); assert.equal((await service.dispatch({ type: "STATE" })).records.length, 0);
  backup.records[1].values.email = "second@example.invalid";
  const state = await service.dispatch({ type: "IMPORT_BACKUP", payload: { backup } });
  assert.equal(writes, 1); assert.equal(state.records.length, 2);
  assert.equal(state.records.some(record => record.id.startsWith("old-")), false);
  assert.equal(new Set(state.records.map(record => record.id)).size, 2);
});

test("failed persistent writes do not partially apply an import in memory", async () => {
  const { service, storage } = localService();
  const backup = { format: "sheetdock-backup", version: 1, fields: clone(DEFAULT_FIELDS), roles: clone(DEFAULT_ROLES), records: [{ values: { nome: "Alice" } }] };
  storage.write = async () => { throw new Error("simulated quota failure"); };
  await assert.rejects(service.dispatch({ type: "IMPORT_BACKUP", payload: { backup } }), /quota/);
  assert.equal((await service.dispatch({ type: "STATE" })).records.length, 0);
});

test("clearing local data requires an explicit confirmation and resets contacts and custom configuration", async () => {
  const { service } = localService();
  await service.dispatch({ type: "CONTACT_SAVE", payload: { values: { nome: "Synthetic Alice" } } });
  await service.dispatch({ type: "CONFIG_SAVE", payload: { config: { countryCode: "1" } } });
  await service.dispatch({ type: "TEMPLATES_SAVE", payload: { templates: [{ id: "custom", name: "Custom", text: "Custom text" }] } });
  await assert.rejects(service.dispatch({ type: "CLEAR_LOCAL_DATA", payload: { confirmation: "wrong", scope: "local" } }), errorCode("CONFIRMATION_REQUIRED"));
  assert.equal((await service.dispatch({ type: "STATE" })).records.length, 1);
  const state = await service.dispatch({ type: "CLEAR_LOCAL_DATA", payload: { confirmation: "CLEAR_LOCAL_DATA", scope: "local" } });
  assert.equal(state.records.length, 0); assert.equal(state.config.countryCode, "55");
  assert.equal(state.templates.some(template => template.id === "custom"), false);
  assert.deepEqual(state.config.chatLinks, {});
});

test("OAuth remains disabled without the product client and does not reuse a personal client", async () => {
  let invoked = false;
  const client = new SheetsClient({ runtime: { getManifest: () => ({}) }, identity: { getAuthToken() { invoked = true; } } });
  await assert.rejects(client.metadata(sheetId, true), errorCode("OAUTH_NOT_CONFIGURED"));
  assert.equal(invoked, false);
});

test("Sheets client sends RAW and keeps tokens out of JSON bodies", async () => {
  const calls = [];
  const client = new SheetsClient({
    runtime: { getManifest: () => ({ oauth2: { client_id: "synthetic-test.apps.googleusercontent.com", scopes: [SHEETS_SCOPE] } }) },
    identity: { getAuthToken(options, callback) { callback({ token: "synthetic-test-token" }); } },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => "{}" }; },
  });
  await client.writeCells(sheetId, [{ range: "'CRM'!B2", values: [["=1+2"]] }]);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.valueInputOption, "RAW"); assert.equal(body.data[0].values[0][0], "=1+2");
  assert.equal(calls[0].options.body.includes("synthetic-test-token"), false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-test-token");
});

test("Sheets service connects read-only first, reidentifies rows, and preserves formulas", async () => {
  const client = fakeSheets(grid([[cell("a"), cell("Alice"), {}, cell("Formula", { formula: '=B2&"!"' })], [cell("b"), cell("Bruno"), {}, {}]]));
  const service = new CRMService({ storage: new CRMStorage(null), sheets: client, uuid: () => "new-generated-id" });
  const connected = await service.dispatch({ type: "CONNECT", payload: { spreadsheetId: sheetId } });
  assert.equal(connected.tabs.length, 1); assert.equal(client.writes.length, 0);
  const selected = await service.dispatch({ type: "SELECT_SHEET", payload: { sheetId: 0 } });
  const record = clone(selected.records[0]);
  client.sheet.data[0].rowData.splice(1, 2, client.sheet.data[0].rowData[2], client.sheet.data[0].rowData[1]);
  const saved = await service.dispatch({ type: "CONTACT_SAVE", payload: { id: record.id, expected: record.values, values: { ...record.values, nome: "Alice updated" }, scope: `sheets:${sheetId}:0` } });
  assert.deepEqual(client.writes[0].data, [{ range: "'CRM'!B3", values: [["Alice updated"]] }]);
  assert.equal(saved.records.find(item => item.id === "a").values.observacoes, "Formula");
  assert.equal(client.sheet.data[0].rowData[2].values[3].userEnteredValue.formulaValue, '=B2&"!"');
  await assert.rejects(service.dispatch({ type: "CONTACT_DELETE", payload: { id: "a", expected: saved.records[1].values } }), errorCode("SHEETS_DELETE_UNSUPPORTED"));
});

test("duplicate/missing sheet IDs prevent writes even if a row number is supplied", async () => {
  const client = fakeSheets(grid([[cell("a"), cell("Alice")], [cell("a"), cell("Bruno")]]));
  const service = new CRMService({ storage: new CRMStorage(null), sheets: client });
  await service.dispatch({ type: "CONNECT", payload: { spreadsheetId: sheetId } });
  const state = await service.dispatch({ type: "SELECT_SHEET", payload: { sheetId: 0 } });
  assert.equal(state.connection.writable, false);
  await assert.rejects(service.dispatch({ type: "CONTACT_SAVE", payload: { values: { nome: "New" }, rowNumber: 2 } }), errorCode("DUPLICATE_ID"));
  assert.equal(client.writes.length, 0);
});

test("explicit Sheets ID preparation turns an existing no-ID base writable in one cell batch", async () => {
  let serial = 0;
  const client = fakeSheets(grid([[cell("Alice"), cell("note")], [cell("Bruno"), cell("other")]], { headers: ["nome", "observacoes"] }));
  const service = new CRMService({ storage: new CRMStorage(null), sheets: client, uuid: () => `generated-${++serial}` });
  await service.dispatch({ type: "CONNECT", payload: { spreadsheetId: sheetId } });
  const initial = await service.dispatch({ type: "SELECT_SHEET", payload: { sheetId: 0 } });
  assert.equal(initial.connection.writable, false);
  await assert.rejects(service.dispatch({ type: "INITIALIZE_IDS", payload: { scope: `sheets:${sheetId}:0`, confirmation: "wrong" } }), errorCode("CONFIRMATION_REQUIRED"));
  assert.equal(client.writes.length, 0);
  const prepared = await service.dispatch({ type: "INITIALIZE_IDS", payload: { scope: `sheets:${sheetId}:0`, confirmation: "INITIALIZE_IDS" } });
  assert.equal(client.writes.length, 1); assert.equal(prepared.connection.writable, true);
  assert.equal(prepared.connection.idsCreated, 2);
  assert.equal(prepared.records[0].values.observacoes, "note");
  assert.equal(prepared.records[0].values.crm_id, "generated-1");
  assert.equal(prepared.config.roles.id, "crm_id");
});
