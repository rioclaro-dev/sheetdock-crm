/* SheetDock CRM — only reads the visible active-chat header, never messages. */
(() => {
  'use strict';
  if (document.getElementById('sheetdock-crm-root')) return;

  const STATUS_RE = /^(online$|digitando|gravando|visto por último|clique aqui|clique para|typing|last seen|recording|click here|search$|pesquisar$|menu$|mais opções$)/i;
  const NATIONAL_LENGTHS = { '1': [10], '7': [10], '20': [10], '27': [9], '30': [10], '31': [9], '32': [8, 9], '33': [9], '34': [9], '39': [9, 10, 11], '44': [9, 10], '49': [10, 11], '52': [10], '54': [10, 11], '55': [10, 11], '56': [9], '57': [10], '61': [9], '81': [9, 10], '82': [9, 10], '86': [11], '91': [10], '351': [9], '353': [9] };
  const host = document.createElement('div');
  host.id = 'sheetdock-crm-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('src/overlay/overlay.css');
  shadow.append(stylesheet);
  (document.body || document.documentElement).append(host);

  const ui = {};
  let state = null;
  let identity = null;
  let identitySignature = '';
  let activeRecordId = '';
  let selectionReason = '';
  let isOpen = false;
  let isBusy = false;
  let query = '';
  let notice = '';
  let noticeKind = '';
  let readVersion = 0;
  let observedHeader = null;
  let sourceSignature = '';
  let sessionConfirmation = null;
  const drafts = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function clean(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function nameKey(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  function normalizePhone(value) {
    const input = clean(value);
    if (!input || !/^(?:\+|00)?[\d\s().-]+$/.test(input)) return '';
    let digits = input.replace(/\D/g, '');
    const explicit = input.startsWith('+') || input.startsWith('00');
    if (input.startsWith('00')) digits = digits.slice(2);
    if (explicit) return /^[1-9]\d{6,14}$/.test(digits) ? digits : '';
    const country = String(state?.config?.countryCode ?? '55').replace(/^\+/, '');
    const lengths = NATIONAL_LENGTHS[country];
    if (!/^[1-9]\d{0,2}$/.test(country) || !lengths) return '';
    if (digits.startsWith(country) && lengths.includes(digits.length - country.length)) return digits;
    if (country !== '55' && country !== '1' && digits.startsWith('0') && lengths.includes(digits.length - 1)) digits = digits.slice(1);
    if (!lengths.includes(digits.length)) return '';
    const full = country + digits;
    return /^[1-9]\d{6,14}$/.test(full) ? full : '';
  }

  function visible(node) {
    if (!node || !node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function readIdentity() {
    const header = document.querySelector('#main header');
    if (!visible(header)) return null;
    // Limit the integration boundary to visible header labels. No chat IDs,
    // message elements, React internals, contact list, or account state.
    const labels = [];
    for (const node of header.querySelectorAll('span[title], [role="heading"], [data-testid="conversation-info-header-chat-title"]')) {
      if (!visible(node) || node.closest('button')) continue;
      const value = clean(node.getAttribute('title') || node.textContent);
      if (value && !STATUS_RE.test(value) && !labels.includes(value)) labels.push(value);
    }
    if (!labels.length) {
      for (const node of header.querySelectorAll('span')) {
        if (!visible(node) || node.closest('button')) continue;
        const value = clean(node.textContent);
        if (value && value.length < 160 && !STATUS_RE.test(value) && !labels.includes(value)) labels.push(value);
      }
    }
    const name = labels[0] || '';
    const phoneLabel = labels.find(value => /^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7);
    const phone = phoneLabel ? normalizePhone(phoneLabel) : '';
    return name || phone ? { name, phone } : null;
  }

  function signature(value) {
    return value ? `${nameKey(value.name)}|${value.phone || ''}` : '';
  }

  function rpc(type, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, response => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!response?.ok) {
            const error = new Error(response?.error?.message || 'Não foi possível concluir. Abra a central e tente novamente.');
            error.code = response?.error?.code;
            reject(error);
          } else resolve(response.data);
        });
      } catch (error) { reject(error); }
    });
  }

  function recordName(record) {
    return clean(record.values?.[state?.config?.roles?.name]) || 'Contato sem nome';
  }

  function currentRecord() {
    return state?.records?.find(record => record.id === activeRecordId) || null;
  }

  function baseScope() {
    const config = state?.config || {};
    return config.provider === 'sheets' ? `sheets:${config.spreadsheetId}:${config.sheetId ?? 'unselected'}` : 'local';
  }

  function linkedId() {
    if (!identity || !state) return '';
    const links = state.config?.chatLinks || {};
    // Remembered names are suggestions only. A phone never falls back to a name.
    const value = identity.phone ? links[`phone:${identity.phone}`] : links[`name:${nameKey(identity.name)}`];
    if (typeof value === 'string') return value;
    return value?.recordId || value?.id || '';
  }

  function sessionConfirmed(recordId = activeRecordId) {
    return sessionConfirmation?.recordId === recordId && sessionConfirmation.signature === identitySignature && sessionConfirmation.header === document.querySelector('#main header');
  }

  function canEditRecord() {
    return !identity || Boolean(identity.phone) || sessionConfirmed();
  }

  function pickAutomatic() {
    activeRecordId = '';
    selectionReason = '';
    if (!identity || !state) return;
    const confirmed = linkedId();
    if (!identity.phone && sessionConfirmed(sessionConfirmation?.recordId) && state.records.some(record => record.id === sessionConfirmation.recordId)) {
      activeRecordId = sessionConfirmation.recordId;
      selectionReason = 'Confirmado nesta sessão';
      return;
    }
    if (confirmed && state.records.some(record => record.id === confirmed)) {
      activeRecordId = confirmed;
      selectionReason = identity.phone ? 'Vínculo confirmado pelo telefone' : 'Sugestão pelo título · confirme nesta sessão';
      return;
    }
    const phoneField = state.config?.roles?.phone;
    if (!identity.phone || !phoneField) return;
    const matches = state.records.filter(record => normalizePhone(record.values?.[phoneField]) === identity.phone);
    if (matches.length === 1) {
      activeRecordId = matches[0].id;
      selectionReason = 'Telefone exato e único';
    }
  }

  function tick() {
    if (document.hidden) return;
    const header = document.querySelector('#main header');
    const headerChanged = header !== observedHeader;
    if (headerChanged) {
      headerObserver.disconnect();
      sessionConfirmation = null;
      observedHeader = header;
      if (header) headerObserver.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'style', 'class'], characterData: true });
    }
    const next = readIdentity();
    const nextSignature = signature(next);
    if (nextSignature === identitySignature && !headerChanged) return;
    if (nextSignature !== identitySignature) sessionConfirmation = null;
    identity = next;
    identitySignature = nextSignature;
    query = '';
    notice = '';
    pickAutomatic();
    render();
    ui.body.scrollTop = 0;
  }

  const headerObserver = new MutationObserver(tick);

  function setNotice(message, kind = '') {
    notice = message;
    noticeKind = kind;
    if (ui.notice) {
      ui.notice.textContent = notice;
      ui.notice.className = `notice ${noticeKind}`;
      ui.notice.hidden = !notice;
    }
  }

  async function loadState(refresh = false) {
    const version = ++readVersion;
    const previousId = activeRecordId;
    const previousSignature = identitySignature;
    const previousReason = selectionReason;
    const previousWasManual = previousReason === 'Seleção manual · vínculo ainda não confirmado';
    try {
      const result = await rpc(refresh ? 'REFRESH' : 'STATE');
      if (version !== readVersion) return;
      const source = `${result.config?.provider}|${result.config?.spreadsheetId || ''}|${result.config?.sheetId ?? ''}`;
      const sourceChanged = sourceSignature && sourceSignature !== source;
      if (sourceChanged) { drafts.clear(); sessionConfirmation = null; }
      sourceSignature = source;
      state = result;
      identity = readIdentity();
      identitySignature = signature(identity);
      pickAutomatic();
      // Preserve a deliberate selection, never revive an automatic match that
      // the refreshed records made ambiguous or whose confirmed link vanished.
      if (previousWasManual && !sourceChanged && !activeRecordId && previousSignature === identitySignature && result.records?.some(record => record.id === previousId)) {
        activeRecordId = previousId;
        selectionReason = previousReason;
      }
      render();
    } catch (error) {
      setNotice(error.message, 'error');
    }
  }

  function setOpen(open) {
    isOpen = open;
    ui.panel.hidden = !open;
    ui.launcher.hidden = open;
    ui.launcher.setAttribute('aria-expanded', String(open));
    try { chrome.storage.local.set({ sheetdockPanelOpen: open }); } catch (_) { /* Optional preference only. */ }
    if (open) {
      render();
      loadState();
    }
  }

  function build() {
    ui.launcher = button('◈ CRM', 'launcher', () => setOpen(true));
    ui.launcher.setAttribute('aria-label', 'Abrir SheetDock CRM');
    ui.launcher.setAttribute('aria-controls', 'sheetdock-panel');
    ui.launcher.setAttribute('aria-expanded', 'false');
    ui.panel = el('aside', 'panel');
    ui.panel.id = 'sheetdock-panel';
    ui.panel.setAttribute('aria-label', 'SheetDock CRM');
    ui.panel.hidden = true;
    const top = el('header', 'panel-header');
    const brand = el('div', 'brand');
    brand.append(el('span', 'mark', '◈'), el('strong', '', 'SheetDock'), el('span', 'brand-tag', 'CRM'));
    const collapse = button('×', 'icon-button', () => setOpen(false));
    collapse.setAttribute('aria-label', 'Fechar painel CRM');
    top.append(brand, collapse);
    ui.body = el('div', 'panel-body');
    const footer = el('footer', 'panel-footer');
    const dashboard = button('Abrir central ↗', 'text-button', async () => {
      try { await rpc('OPEN_DASHBOARD'); } catch (error) { setNotice(error.message, 'error'); }
    });
    const refresh = button('Atualizar', 'text-button', () => loadState(true));
    footer.append(dashboard, refresh);
    ui.panel.append(top, ui.body, footer);
    shadow.append(ui.launcher, ui.panel);
  }

  function render() {
    ui.body.replaceChildren();
    const chat = el('section', 'chat-card');
    chat.append(el('div', 'eyebrow', 'CONVERSA ATUAL'));
    chat.append(el('h2', 'chat-name', identity?.name || 'Abra uma conversa'));
    if (identity?.phone && identity.phone !== identity.name) chat.append(el('p', 'muted', `+${identity.phone}`));
    chat.append(el('p', 'privacy-note', 'Lê somente o cabeçalho visível. Nenhuma mensagem é lida ou enviada.'));
    ui.body.append(chat);
    ui.notice = el('p', `notice ${noticeKind}`, notice);
    ui.notice.setAttribute('role', 'status');
    ui.notice.setAttribute('aria-live', 'polite');
    ui.notice.hidden = !notice;
    ui.body.append(ui.notice);
    if (!state) {
      ui.body.append(el('p', 'empty', 'Carregando seu CRM…'));
      return;
    }
    if (!state.records?.length) {
      const empty = el('section', 'empty');
      empty.append(el('h3', '', 'Seu CRM começa na central'), el('p', '', 'Crie seus campos e contatos ou conecte uma planilha. Depois volte à conversa.'));
      ui.body.append(empty);
      return;
    }
    if (state.connection?.writable === false) ui.body.append(el('p', 'notice error', state.connection.issue?.message || 'A base está em modo de leitura. Confira a conexão na central antes de editar.'));
    renderPicker();
    const record = currentRecord();
    if (record && canEditRecord()) renderRecord(record);
    else if (record) ui.body.append(el('p', 'empty', 'Confira o contato e confirme o vínculo nesta sessão para abrir a ficha. O título pode se repetir em outras conversas.'));
    else ui.body.append(el('p', 'empty', identity?.phone ? 'Não há um telefone único vinculado. Escolha o contato e confirme o vínculo.' : 'O nome da conversa não vincula um contato automaticamente. Escolha o contato e confirme.'));
  }

  function filteredRecords() {
    const q = nameKey(query);
    return state.records.filter(record => !q || Object.values(record.values || {}).some(value => nameKey(value).includes(q))).slice(0, 50);
  }

  function renderPicker() {
    const section = el('section', 'picker-section');
    const label = el('label', 'field-label', 'Localizar contato');
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Nome, telefone ou qualquer campo';
    search.value = query;
    search.setAttribute('aria-label', 'Buscar contatos');
    label.append(search);
    const select = el('select', 'contact-picker');
    select.setAttribute('aria-label', 'Selecionar contato do CRM');
    const fillSelect = () => {
      select.replaceChildren();
      const placeholder = el('option', '', 'Selecione um contato');
      placeholder.value = '';
      select.append(placeholder);
      for (const record of filteredRecords()) {
        const phone = clean(record.values?.[state.config?.roles?.phone]);
        const option = el('option', '', phone ? `${recordName(record)} · ${phone}` : recordName(record));
        option.value = record.id;
        select.append(option);
      }
      select.value = activeRecordId;
      if (!select.value) select.value = '';
    };
    fillSelect();
    search.addEventListener('input', () => { query = search.value; fillSelect(); });
    select.addEventListener('change', () => {
      activeRecordId = select.value;
      sessionConfirmation = null;
      selectionReason = 'Seleção manual · vínculo ainda não confirmado';
      notice = '';
      render();
    });
    section.append(label, select);
    if (currentRecord() && identity) {
      section.append(el('p', 'match-note', selectionReason));
      const link = button(sessionConfirmed() || selectionReason === 'Vínculo confirmado pelo telefone' ? 'Reconfirmar vínculo desta conversa' : 'Confirmar vínculo desta conversa', 'secondary-button', () => confirmLink());
      link.disabled = isBusy;
      section.append(link);
      if (!identity.phone) section.append(el('p', 'muted small', 'Sem telefone visível, confirme a ficha a cada conversa. Nomes repetidos não identificam pessoas.'));
    }
    ui.body.append(section);
  }

  async function confirmLink() {
    const record = currentRecord();
    if (!record || !identity || isBusy) return;
    // Internal comparison uses E.164 digits; the RPC boundary is explicitly
    // international so the configured local country cannot be prepended again.
    const expectedIdentity = { ...identity, phone: identity.phone ? `+${identity.phone}` : '' };
    const previousLink = linkedId() || null;
    const scope = baseScope();
    const header = document.querySelector('#main header');
    const confirmedSignature = identitySignature;
    isBusy = true;
    render();
    try {
      await rpc('LINK_CHAT', { recordId: record.id, identity: expectedIdentity, expected: previousLink, scope });
      if (identitySignature === confirmedSignature && header === document.querySelector('#main header')) sessionConfirmation = { recordId: record.id, signature: confirmedSignature, header };
      await loadState();
      setNotice('Vínculo confirmado para esta conversa.', 'success');
    } catch (error) { setNotice(error.message, 'error'); }
    finally { isBusy = false; render(); }
  }

  function draftFor(record) {
    if (!drafts.has(record.id)) drafts.set(record.id, { values: { ...record.values }, expected: { ...record.values }, dirty: false });
    const draft = drafts.get(record.id);
    if (!draft.dirty) {
      draft.values = { ...record.values };
      draft.expected = { ...record.values };
    }
    return draft;
  }

  function createInput(field, value) {
    let input;
    if (field.type === 'textarea') input = el('textarea', 'field-input');
    else if (field.type === 'select') {
      input = el('select', 'field-input');
      const blank = el('option', '', 'Selecione');
      blank.value = '';
      input.append(blank);
      const options = [...(field.options || [])];
      if (value && !options.includes(String(value))) options.push(String(value));
      for (const optionValue of options) {
        const option = el('option', '', String(optionValue));
        option.value = String(optionValue);
        input.append(option);
      }
    } else {
      input = el('input', 'field-input');
      input.type = ({ phone: 'tel', number: 'number', date: 'date', checkbox: 'checkbox', email: 'email', url: 'url' })[field.type] || 'text';
      if (field.type === 'number') input.step = 'any';
    }
    if (field.type === 'checkbox') input.checked = value === true || value === 'true' || value === 'TRUE';
    else input.value = String(value ?? '');
    input.required = Boolean(field.required);
    input.disabled = Boolean(field.readOnly) || field.key === state.config?.roles?.id || isBusy || state.connection?.writable === false;
    input.name = field.key;
    input.id = `sd-field-${field.key}`;
    if (field.type === 'textarea') input.rows = 3;
    return input;
  }

  function renderRecord(record) {
    const draft = draftFor(record);
    const scope = baseScope();
    const section = el('section', 'record-section');
    const title = el('div', 'section-title');
    title.append(el('h3', '', recordName(record)));
    title.append(el('span', 'provider-badge', state.config?.provider === 'sheets' ? 'Google Sheets' : 'Neste navegador'));
    section.append(title);
    const nextKey = state.config?.roles?.nextContact;
    if (nextKey && record.values?.[nextKey]) section.append(el('p', 'next-contact', `Próximo contato: ${record.values[nextKey]}`));
    const form = el('form', 'record-form');
    const fields = (state.fields || []).filter(field => !field.hidden);
    for (const field of fields) {
      const wrapper = el('div', field.type === 'checkbox' ? 'field checkbox-field' : 'field');
      const label = el('label', 'field-label', `${field.label}${field.required ? ' *' : ''}`);
      label.htmlFor = `sd-field-${field.key}`;
      const input = createInput(field, draft.values[field.key]);
      input.addEventListener('input', () => {
        draft.values[field.key] = field.type === 'checkbox' ? input.checked : input.value;
        draft.dirty = true;
        dirty.textContent = 'Alterações ainda não salvas';
      });
      wrapper.append(label, input);
      form.append(wrapper);
    }
    const dirty = el('p', 'muted small', draft.dirty ? 'Alterações ainda não salvas' : 'Salve para atualizar seu banco de dados.');
    const actions = el('div', 'form-actions');
    const save = el('button', 'primary-button', isBusy ? 'Salvando…' : 'Salvar contato');
    save.type = 'submit';
    save.disabled = isBusy || state.connection?.writable === false;
    const discard = button('Descartar', 'text-button', () => { drafts.delete(record.id); render(); });
    discard.disabled = isBusy;
    actions.append(save, discard);
    form.append(dirty, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity() || isBusy) return;
      isBusy = true;
      render();
      try {
        await rpc('CONTACT_SAVE', { id: record.id, values: { ...draft.values }, expected: { ...draft.expected }, scope });
        drafts.delete(record.id);
        await loadState();
        setNotice('Contato salvo.', 'success');
      } catch (error) {
        setNotice(error.code === 'CONFLICT' ? 'O contato foi alterado em outra tela. Seu rascunho foi preservado. Atualize e confira antes de salvar.' : error.message, 'error');
      } finally { isBusy = false; render(); }
    });
    section.append(form);
    ui.body.append(section);
    renderTemplates(record);
  }

  function renderTemplates(record) {
    if (!state.templates?.length) return;
    const section = el('section', 'templates');
    section.append(el('h3', '', 'Modelos de texto'), el('p', 'muted small', 'Copie, revise e cole por sua conta. O CRM não envia mensagens.'));
    for (const template of state.templates) {
      const copy = button(`Copiar · ${template.name || template.title || 'Modelo'}`, 'secondary-button', async () => {
        const text = String(template.body ?? template.text ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key) => {
          const fieldKey = key.trim();
          return fieldKey === 'primeiro_nome' ? recordName(record).split(/\s+/)[0] : String(record.values?.[fieldKey] ?? '');
        });
        try {
          await navigator.clipboard.writeText(text);
          setNotice('Modelo copiado. Revise o texto antes de colar.', 'success');
        } catch (_) { setNotice('O navegador não permitiu copiar. Abra a central para acessar o modelo.', 'error'); }
      });
      section.append(copy);
    }
    ui.body.append(section);
  }

  build();
  tick();
  // A click on the chat-navigation surface invalidates a title-only session,
  // even when two chats reuse the same visible title and the same header node.
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#pane-side')) return;
    sessionConfirmation = null;
    identitySignature = '';
    tick();
  }, true);
  const interval = setInterval(tick, 750);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('pagehide', () => { clearInterval(interval); headerObserver.disconnect(); }, { once: true });
  try {
    chrome.storage.local.get('sheetdockPanelOpen', result => {
      if (chrome.runtime.lastError) return;
      if (result?.sheetdockPanelOpen) setOpen(true);
    });
  } catch (_) { /* Starts collapsed when storage is unavailable. */ }
})();
