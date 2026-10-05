'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(projectRoot, 'src/content.js'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'src/overlay/overlay.css'), 'utf8');
let browser;
before(async () => {
  const options = { headless: true };
  if (process.env.SHEETDOCK_BROWSER_PATH) options.executablePath = process.env.SHEETDOCK_BROWSER_PATH;
  else if (!fs.existsSync(chromium.executablePath())) options.channel = 'chrome';
  browser = await chromium.launch(options);
});
after(async () => { await browser?.close(); });

function fixtureState(overrides = {}) {
  return {
    config: { provider: 'local', countryCode: '55', roles: { id: 'id', name: 'name', phone: 'phone', stage: 'stage', nextContact: 'next', notes: 'notes' }, chatLinks: {} },
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'phone', label: 'Telefone', type: 'phone' },
      { key: 'stage', label: 'Etapa', type: 'select', options: ['Novo', 'Em conversa', 'Concluído'] },
      { key: 'next', label: 'Próximo contato', type: 'date' },
      { key: 'notes', label: 'Notas', type: 'textarea' },
      { key: 'active', label: 'Ativo', type: 'checkbox' },
      { key: 'score', label: 'Prioridade', type: 'number' },
      { key: 'private', label: 'Campo oculto', type: 'text', hidden: true },
    ],
    records: [
      { id: 'c1', values: { name: 'Maya Demo', phone: '+55 11 90000-1001', stage: 'Novo', next: '2026-10-15', notes: 'Contato de demonstração', active: true, score: '1', private: 'hidden' } },
      { id: 'c2', values: { name: 'Noah Demo', phone: '+55 21 90000-2002', stage: 'Em conversa', next: '', notes: 'Segundo contato', active: false, score: '2' } },
    ],
    templates: [{ id: 't1', name: 'Boas-vindas', body: 'Olá, {{primeiro_nome}}! Etapa: {{stage}}. {{missing}}' }],
    connection: { connected: false },
    ...overrides,
  };
}

async function setup({ name = 'Maya Demo', state = fixtureState() } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('https://fixture.test/**', async route => {
    if (route.request().url().endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: css });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Chat fixture</title></head><body style="margin:0;background:#eef1ee;font:16px system-ui"><div style="width:300px;height:100vh;background:#fff;padding:20px;box-sizing:border-box">Conversas de demonstração</div><section id="main" style="position:absolute;left:300px;right:0;top:0;height:100vh"><header style="height:64px;padding:16px 24px;background:#fff;box-sizing:border-box"><span title="">Demo</span><span style="display:block;font-size:11px;color:#718075">online</span></header><div id="messages" data-id="false_5511900001001@c.us_demo" style="padding:50px">Mensagens fora do acesso do CRM</div><footer><textarea aria-label="Escrever mensagem"></textarea></footer></section></body></html>' });
  });
  await page.goto('https://fixture.test/');
  await page.evaluate(({ state, name }) => {
    window.fixtureState = structuredClone(state);
    window.rpcLog = [];
    window.rpcResolved = [];
    window.rpcDelays = {};
    window.copiedTexts = [];
    window.fixtureConflict = false;
    const header = document.querySelector('#main header span');
    header.textContent = name;
    header.title = name;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedTexts.push(text); } } });
    window.chrome = {
      runtime: {
        getURL: file => `https://fixture.test/${file}`,
        lastError: null,
        sendMessage(message, callback) {
          window.rpcLog.push(structuredClone(message));
          let response;
          if (message.type === 'STATE' || message.type === 'REFRESH') response = { ok: true, data: structuredClone(window.fixtureState) };
          else if (message.type === 'CONTACT_SAVE') {
            if (window.fixtureConflict) response = { ok: false, error: { code: 'CONFLICT', message: 'Contato mudou.' } };
            else {
              const record = window.fixtureState.records.find(item => item.id === message.payload.id);
              record.values = structuredClone(message.payload.values);
              response = { ok: true, data: structuredClone(record) };
            }
          } else if (message.type === 'LINK_CHAT') {
            const identity = message.payload.identity;
            const phone = identity.phone ? identity.phone.replace(/\D/g, '') : '';
            const key = phone ? `phone:${phone}` : `name:${identity.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()}`;
            window.fixtureState.config.chatLinks[key] = { ...identity, phone, recordId: message.payload.recordId };
            response = { ok: true, data: structuredClone(window.fixtureState) };
          } else if (message.type === 'OPEN_DASHBOARD') response = { ok: true, data: null };
          else response = { ok: false, error: { code: 'UNKNOWN', message: 'RPC inesperado.' } };
          setTimeout(() => {
            callback(response);
            // loadState resumes and renders in its promise microtask first.
            queueMicrotask(() => window.rpcResolved.push(structuredClone(message)));
          }, window.rpcDelays[message.type] || 0);
        },
      },
      storage: { local: { get(_keys, callback) { callback({}); }, set() {} } },
    };
  }, { state, name });
  await page.addScriptTag({ content: script });
  return page;
}

async function openPanel(page) {
  await page.getByRole('button', { name: 'Abrir SheetDock CRM', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar contatos' }).waitFor();
}

async function switchChat(page, name) {
  await page.evaluate(value => {
    const node = document.querySelector('#main header span');
    node.textContent = value;
    node.title = value;
  }, name);
  await page.getByRole('heading', { name, exact: true, level: 2 }).waitFor();
}

async function writes(page) {
  return page.evaluate(() => window.rpcLog.filter(message => ['CONTACT_SAVE', 'LINK_CHAT'].includes(message.type)));
}

async function refreshState(page) {
  const expected = await page.evaluate(() => window.rpcResolved.filter(message => message.type === 'REFRESH').length + 1);
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.waitForFunction(count => window.rpcResolved.filter(message => message.type === 'REFRESH').length >= count, expected);
}

test('panel starts collapsed; a matching display name requires explicit selection', async () => {
  const page = await setup();
  try {
    assert.equal(await page.getByRole('complementary', { name: 'SheetDock CRM' }).isVisible(), false);
    await openPanel(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Salvar contato', exact: true }).count(), 0);
    await page.getByRole('searchbox', { name: 'Buscar contatos' }).fill('90000-2002');
    const options = page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).locator('option');
    assert.equal(await options.count(), 2);
    assert.match(await options.nth(1).textContent(), /Noah Demo/);
    await page.getByRole('button', { name: 'Abrir central ↗', exact: true }).click();
    assert.equal(await page.evaluate(() => window.rpcLog.filter(m => m.type === 'OPEN_DASHBOARD').length), 1);
    await page.getByRole('button', { name: 'Fechar painel CRM', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Abrir SheetDock CRM', exact: true }).isVisible(), true);
    assert.deepEqual(await writes(page), []);
  } finally { await page.close(); }
});

test('unique visible phone matches exactly; duplicated phone and message-only phone do not', async () => {
  const page = await setup({ name: '+55 11 90000-1001' });
  try {
    await openPanel(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), 'c1');
    await switchChat(page, 'Unknown Demo');
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), '');
    await page.evaluate(() => window.fixtureState.records.push({ id: 'duplicate', values: { name: 'Other Demo', phone: '+55 11 90000-1001' } }));
    await refreshState(page);
    await switchChat(page, '+55 11 90000-1001');
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), '');
    assert.deepEqual(await writes(page), []);
  } finally { await page.close(); }
});

test('refresh revokes an automatic match when the same visible phone becomes duplicated', async () => {
  const page = await setup({ name: '+55 11 90000-1001' });
  try {
    await openPanel(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), 'c1');
    await page.evaluate(() => {
      window.fixtureState.records.push({ id: 'duplicate', values: { name: 'Other Demo', phone: '+55 11 90000-1001' } });
      window.rpcDelays.REFRESH = 40;
    });
    await refreshState(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Salvar contato', exact: true }).count(), 0);
    assert.deepEqual(await writes(page), []);
  } finally { await page.close(); }
});

test('name links require confirmation again after switches; drafts never write on chat change', async () => {
  const page = await setup();
  try {
    await openPanel(page);
    await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).selectOption('c1');
    await page.getByRole('button', { name: 'Confirmar vínculo desta conversa', exact: true }).click();
    await page.getByText('Vínculo confirmado para esta conversa.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Notas', exact: true }).fill('Rascunho preservado');
    const before = await writes(page);
    await switchChat(page, '+55 21 90000-2002');
    assert.equal(await page.getByRole('textbox', { name: 'Notas', exact: true }).inputValue(), 'Segundo contato');
    await switchChat(page, 'Maya Demo');
    assert.equal(await page.getByRole('textbox', { name: 'Notas', exact: true }).count(), 0);
    assert.deepEqual(await writes(page), before);
    await page.getByRole('button', { name: 'Confirmar vínculo desta conversa', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notas', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Notas', exact: true }).inputValue(), 'Rascunho preservado');
    assert.equal(await page.getByRole('textbox', { name: 'Escrever mensagem' }).inputValue(), '');
  } finally { await page.close(); }
});

test('homonymous chats cannot reuse a title-only confirmation across headers or navigation', async () => {
  const state = fixtureState();
  state.config.chatLinks['name:maya demo'] = { recordId: 'c1', name: 'Maya Demo', phone: '' };
  const page = await setup({ state });
  try {
    await openPanel(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), 'c1');
    assert.equal(await page.getByRole('button', { name: 'Salvar contato', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Confirmar vínculo desta conversa', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notas', exact: true }).waitFor();
    const before = await writes(page);
    await page.evaluate(() => {
      const oldHeader = document.querySelector('#main header');
      oldHeader.replaceWith(oldHeader.cloneNode(true));
    });
    await page.getByRole('textbox', { name: 'Notas', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await writes(page), before);
    await page.getByRole('button', { name: 'Confirmar vínculo desta conversa', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notas', exact: true }).waitFor();
    await page.evaluate(() => {
      const pane = document.createElement('div');
      pane.id = 'pane-side';
      const button = document.createElement('button');
      button.textContent = 'Outro chat homônimo';
      pane.append(button);
      document.body.append(pane);
    });
    await page.getByRole('button', { name: 'Outro chat homônimo', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notas', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await writes(page)).length, before.length + 1);
  } finally { await page.close(); }
});

test('dynamic fields save with expected values; conflict preserves the draft', async () => {
  const page = await setup({ name: '+55 11 90000-1001' });
  try {
    await openPanel(page);
    await page.getByRole('textbox', { name: 'Notas', exact: true }).fill('Reunião confirmada');
    await page.getByRole('combobox', { name: 'Etapa', exact: true }).selectOption('Concluído');
    await page.getByLabel('Próximo contato', { exact: true }).fill('2026-11-02');
    await page.getByRole('checkbox', { name: 'Ativo', exact: true }).uncheck();
    await page.getByRole('spinbutton', { name: 'Prioridade', exact: true }).fill('4.5');
    assert.equal(await page.getByLabel('Campo oculto').count(), 0);
    await page.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await page.getByText('Contato salvo.', { exact: true }).waitFor();
    const messages = await writes(page);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'CONTACT_SAVE');
    assert.equal(messages[0].payload.scope, 'local');
    assert.equal(messages[0].payload.values.notes, 'Reunião confirmada');
    assert.equal(messages[0].payload.values.next, '2026-11-02');
    assert.equal(messages[0].payload.values.active, false);
    assert.equal(messages[0].payload.values.score, '4.5');
    assert.equal(messages[0].payload.expected.notes, 'Contato de demonstração');
    fs.mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });
    await page.locator('#sheetdock-crm-root').locator('.panel-body').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(projectRoot, 'artifacts', 'side-panel-fixture.png') });
    await page.evaluate(() => { window.fixtureConflict = true; });
    await page.getByRole('textbox', { name: 'Notas', exact: true }).fill('Manter este rascunho');
    await page.getByRole('button', { name: 'Salvar contato', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Seu rascunho foi preservado' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Notas', exact: true }).inputValue(), 'Manter este rascunho');
  } finally { await page.close(); }
});

test('template copies to clipboard without sending; untrusted labels remain text', async () => {
  const state = fixtureState();
  state.records[0].values.name = '<img src=x onerror=alert(1)> Demo';
  state.fields[0].label = '<script>danger</script>';
  const page = await setup({ name: '+55 11 90000-1001', state });
  try {
    await openPanel(page);
    await page.getByRole('button', { name: 'Copiar · Boas-vindas', exact: true }).click();
    await page.getByText('Modelo copiado. Revise o texto antes de colar.', { exact: true }).waitFor();
    const copied = await page.evaluate(() => window.copiedTexts);
    assert.equal(copied.length, 1);
    assert.equal(copied[0], 'Olá, <img! Etapa: Novo. ');
    assert.equal(await page.locator('#sheetdock-crm-root').locator('img, script').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Escrever mensagem' }).inputValue(), '');
    assert.deepEqual(await writes(page), []);
  } finally { await page.close(); }
});

test('remembered name does not override a newly visible different phone', async () => {
  const state = fixtureState();
  state.config.chatLinks['name:shared demo'] = { recordId: 'c1', name: 'Shared Demo', phone: '5511900001001' };
  const page = await setup({ name: 'Shared Demo', state });
  try {
    await page.evaluate(() => {
      const phone = document.createElement('span');
      phone.title = '+55 21 90000-2002';
      phone.textContent = '+55 21 90000-2002';
      document.querySelector('#main header').append(phone);
    });
    await openPanel(page);
    assert.equal(await page.getByRole('combobox', { name: 'Selecionar contato do CRM' }).inputValue(), 'c2');
    assert.deepEqual(await writes(page), []);
  } finally { await page.close(); }
});
