'use strict';

// Loads the unpacked MV3 extension in an isolated, disposable Chromium profile.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const projectRoot = path.resolve(__dirname, '..');

function executable() {
  if (process.env.SHEETDOCK_EXTENSION_BROWSER_PATH) return process.env.SHEETDOCK_EXTENSION_BROWSER_PATH;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
  const builds = fs.existsSync(cache) ? fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const build of builds) {
    for (const relative of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = path.join(cache, build, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Chromium necessário para carregar a extensão. Instale o navegador do Playwright ou informe SHEETDOCK_EXTENSION_BROWSER_PATH.');
}

async function start(profile) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: executable(), headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`],
    viewport: { width: 1280, height: 900 },
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).hostname;
  return { context, worker, extensionId };
}

async function rpc(page, type, payload = {}) {
  const response = await page.evaluate(async ({ type, payload }) => chrome.runtime.sendMessage({ type, payload }), { type, payload });
  assert.equal(response?.ok, true, `${type}: ${JSON.stringify(response?.error)}`);
  return response.data;
}

test('real MV3 worker, dashboard and WhatsApp content persist local records across browser restart', { timeout: 90000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sheetdock-extension-'));
  let context;
  t.after(async () => {
    await context?.close();
    const resolved = path.resolve(profile);
    // Delete only the exact disposable directory created by this test.
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('sheetdock-extension-')) fs.rmSync(resolved, { recursive: true, force: true });
  });
  const session = await start(profile);
  context = session.context;
  assert.match(session.worker.url(), /\/src\/background\.js$/);
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${session.extensionId}/src/dashboard/dashboard.html`);
  const empty = await rpc(dashboard, 'STATE');
  assert.equal(empty.config.provider, 'local');
  assert.equal(empty.records.length, 0);
  assert.equal(empty.config.spreadsheetId, '');
  assert.deepEqual(empty.config.chatLinks, {});
  const values = {
    [empty.config.roles.name]: 'Extension Demo',
    [empty.config.roles.phone]: '+1 202 555 0101',
    [empty.config.roles.notes]: 'Criado no service worker real',
  };
  const stage = empty.fields.find(field => field.key === empty.config.roles.stage);
  if (stage?.options?.length) values[stage.key] = stage.options[0];
  await rpc(dashboard, 'CONTACT_SAVE', { values, scope: 'local' });
  const saved = await rpc(dashboard, 'STATE');
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].values[saved.config.roles.name], 'Extension Demo');
  await dashboard.reload();
  await dashboard.getByText('Extension Demo', { exact: true }).waitFor();

  // This page is a local intercepted fixture on the real content-script match.
  await context.route('https://web.whatsapp.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><section id="main"><header style="padding:20px"><span title="+1 202 555 0101">+1 202 555 0101</span></header><div>Mensagens não acessadas pelo CRM</div><footer><textarea aria-label="Escrever mensagem"></textarea></footer></section></body></html>',
  }));
  const chat = await context.newPage();
  await chat.goto('https://web.whatsapp.com/');
  await chat.getByRole('button', { name: 'Abrir SheetDock CRM', exact: true }).click();
  const notesLabel = saved.fields.find(field => field.key === saved.config.roles.notes).label;
  await chat.getByRole('textbox', { name: notesLabel, exact: true }).waitFor();
  await chat.getByRole('button', { name: 'Confirmar vínculo desta conversa', exact: true }).click();
  await chat.getByText('Vínculo confirmado para esta conversa.', { exact: true }).waitFor();
  const linked = await rpc(dashboard, 'STATE');
  assert.equal(linked.config.chatLinks['phone:12025550101'].recordId, saved.records[0].id, 'International phone stays explicit at the RPC boundary.');
  assert.equal(linked.config.chatLinks['phone:5512025550101'], undefined, 'Configured Brazil country must not be prepended to a US number.');
  await chat.getByRole('textbox', { name: notesLabel, exact: true }).fill('Atualizado pelo painel real');
  await chat.getByRole('button', { name: 'Salvar contato', exact: true }).click();
  await chat.getByText('Contato salvo.', { exact: true }).waitFor();
  assert.equal(await chat.getByRole('textbox', { name: 'Escrever mensagem' }).inputValue(), '');
  const updated = await rpc(dashboard, 'STATE');
  assert.equal(updated.records[0].values[updated.config.roles.notes], 'Atualizado pelo painel real');
  assert.equal(requests.filter(url => /^https?:/.test(url) && !url.startsWith('https://web.whatsapp.com/')).length, 0, 'Local mode must not contact external data services.');
  fs.mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });
  await chat.locator('#sheetdock-crm-root').locator('.panel-body').evaluate(element => { element.scrollTop = 0; });
  await chat.screenshot({ path: path.join(projectRoot, 'artifacts', 'extension-real-panel.png') });

  await context.close();
  context = null;
  const restarted = await start(profile);
  context = restarted.context;
  assert.equal(restarted.extensionId, session.extensionId);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${restarted.extensionId}/src/dashboard/dashboard.html`);
  const persisted = await rpc(reopened, 'STATE');
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].values[persisted.config.roles.name], 'Extension Demo');
  assert.equal(persisted.records[0].values[persisted.config.roles.notes], 'Atualizado pelo painel real');
  assert.equal(persisted.config.chatLinks['phone:12025550101'].recordId, persisted.records[0].id);
  await reopened.getByText('Extension Demo', { exact: true }).waitFor();
});
