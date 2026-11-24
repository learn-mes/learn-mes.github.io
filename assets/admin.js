// ══════════════════════════════════════════
// ADMIN.JS: the owner's panel (admin.html) over /api/admin/* (backend/src/admin.js).
// Sign-in is the same Firebase email + password as the app. The session is
// kept for this tab only (sessionStorage), and every view reads live from
// the API: nothing here can be changed without the server agreeing.
// ══════════════════════════════════════════
(function () {
  const cfg = window.MES_BACKEND || {};
  const AUTH = (cfg.authBase || 'https://identitytoolkit.googleapis.com/v1') + '/accounts:';
  const TOKEN = (cfg.tokenBase || 'https://securetoken.googleapis.com/v1') + '/token';
  const SESSION_KEY = 'mes_admin_session_v1';
  const $ = (id) => document.getElementById(id);

  // ── Tiny DOM builder: everything is text, never HTML ──
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  // ── Formatting ──
  function money(minor, currency) {
    if (minor === null || minor === undefined) return '·';
    const n = minor / 100;
    if (currency === 'INR') return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    if (currency === 'USD') return '$' + n.toFixed(2);
    if (!currency) return minor === 0 ? 'free' : String(minor);
    return n.toFixed(2) + ' ' + currency;
  }
  // D1 stores UTC "YYYY-MM-DD HH:MM:SS"; show it in India time.
  function when(s) {
    if (!s) return '·';
    const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return s;
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function productName(p) {
    if (p === 'bundle') return 'Full access';
    const m = /^module-(\d{2})$/.exec(p || '');
    return m ? 'Module ' + m[1] : (p || '·');
  }
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const pill = (text, kind) => h('span', { class: 'pill ' + (kind || '') }, text);
  const STATE_KIND = { running: 'ok', scheduled: 'info', ended: 'muted', off: 'muted', paid: 'ok', refunded: 'warn' };

  // ── Session ──
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }
  function saveSession(s) {
    session = s;
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  async function signIn(email, password) {
    const res = await fetch(AUTH + 'signInWithPassword?key=' + encodeURIComponent(cfg.firebaseApiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (data.error && data.error.message) || '';
      throw new Error(/INVALID|EMAIL_NOT_FOUND|PASSWORD/.test(code) ? 'Wrong email or password.'
        : /TOO_MANY/.test(code) ? 'Too many attempts. Wait a few minutes.' : 'Couldn’t sign in. Check your connection.');
    }
    saveSession({ email: data.email, idToken: data.idToken, refreshToken: data.refreshToken, exp: Date.now() + (parseInt(data.expiresIn, 10) - 60) * 1000 });
  }

  async function idToken() {
    if (!session) throw new Error('signed-out');
    if (Date.now() < session.exp) return session.idToken;
    const res = await fetch(TOKEN + '?key=' + encodeURIComponent(cfg.firebaseApiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { saveSession(null); throw new Error('signed-out'); }
    saveSession({ ...session, idToken: data.id_token, refreshToken: data.refresh_token, exp: Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000 });
    return session.idToken;
  }

  async function api(path, init) {
    const token = await idToken();
    const res = await fetch(cfg.apiBase + '/api/admin/' + path, {
      ...(init || {}),
      headers: { ...((init && init.headers) || {}), 'Authorization': 'Bearer ' + token, ...(init && init.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { saveSession(null); showSignIn('Your session ended. Sign in again.'); throw new Error('signed-out'); }
    if (res.status === 404 && data.error === 'not_found') throw new Error('not-admin');
    if (!res.ok) { const err = new Error(data.error || 'http-' + res.status); err.data = data; throw err; }
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

  // ── Shell ──
  function notice(text, bad) {
    const n = $('notice');
    n.textContent = text || '';
    n.hidden = !text;
    n.classList.toggle('bad', !!bad);
  }

  function showSignIn(message) {
    $('panel').hidden = true;
    $('who').hidden = true;
    $('signin').hidden = false;
    $('siError').textContent = message || '';
    $('siEmail').focus();
  }

  function showPanel() {
    $('signin').hidden = true;
    $('panel').hidden = false;
    $('who').hidden = false;
    $('whoEmail').textContent = session.email;
    open(location.hash.slice(1) || 'overview');
  }

  const views = {};
  let current = null;
  function open(tab, arg) {
    if (!views[tab]) tab = 'overview';
    current = tab;
    document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
    notice('');
    const view = $('view');
    view.textContent = '';
    view.append(h('p', { class: 'muted' }, 'Loading…'));
    views[tab](arg).then((node) => {
      if (current !== tab) return;
      view.textContent = '';
      view.append(node);
    }).catch((e) => {
      if (e.message === 'signed-out') return;
      view.textContent = '';
      view.append(h('p', { class: 'error' }, e.message === 'not-admin'
        ? 'This account isn’t an admin. Add its email to ADMIN_EMAILS in backend/wrangler.toml.'
        : 'Couldn’t load this (' + e.message + '). Check your connection and try again.'));
    });
  }

  function table(columns, rows, empty) {
    if (!rows.length) return h('p', { class: 'muted' }, empty || 'Nothing yet.');
    return h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col' }, c.label)))),
      h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => h('td', { 'data-label': c.label }, c.cell(r))))))
    ));
  }

  const customerLink = (email) => h('button', { type: 'button', class: 'link', onclick: () => open('customer', email) }, email);

  function purchaseColumns(onChange) {
    return [
      { label: 'When', cell: (r) => when(r.created_at) },
      { label: 'Email', cell: (r) => customerLink(r.email) },
      { label: 'Product', cell: (r) => productName(r.product) },
      { label: 'Amount', cell: (r) => money(r.amount, r.currency) },
      { label: 'Via', cell: (r) => r.provider },
      { label: 'Reference', cell: (r) => h('code', null, r.provider_ref) },
      { label: 'Status', cell: (r) => pill(r.status, STATE_KIND[r.status]) },
      ...(onChange ? [{ label: '', cell: (r) => statusButton(r, onChange) }] : [])
    ];
  }

  function statusButton(r, onChange) {
    const revoke = r.status === 'paid';
    return h('button', {
      type: 'button',
      class: revoke ? 'small danger' : 'small',
      onclick: async () => {
        const ask = revoke
          ? 'Remove access to ' + productName(r.product) + ' from ' + r.email + '?\n\nThis doesn’t refund money. Refund in the Razorpay dashboard first; its webhook also does this for you.'
          : 'Give ' + r.email + ' access to ' + productName(r.product) + ' again?';
        if (!confirm(ask)) return;
        try {
          await post('purchases/' + r.id + '/status', { status: revoke ? 'refunded' : 'paid' });
          onChange();
          notice(revoke ? 'Access removed.' : 'Access restored.');
        } catch (e) { notice('Couldn’t change it: ' + e.message, true); }
      }
    }, revoke ? 'Revoke' : 'Restore');
  }

  // ── Overview ──
  views.overview = async function () {
    const s = await api('summary');
    const rev = (list) => (list.length ? list.map((r) => money(r.total, r.currency)).join(' + ') : '₹0');
    const card = (label, value, sub) => h('div', { class: 'card' }, h('div', { class: 'card-label' }, label), h('div', { class: 'card-value' }, value), sub ? h('div', { class: 'card-sub' }, sub) : null);
    const kinds = Object.fromEntries((s.byProduct || []).map((r) => [r.kind, r.n]));
    return h('div', null,
      h('div', { class: 'cards' },
        card('Revenue today', rev(s.revenue.today)),
        card('Last 30 days', rev(s.revenue.last30)),
        card('All time', rev(s.revenue.all), 'paid, minus refunds'),
        card('Purchases', String(s.counts.paid || 0), (kinds.bundle || 0) + ' full access · ' + plural(kinds.module || 0, 'single module')),
        card('Buyers', String(s.counts.buyers || 0), (s.counts.refunded || 0) + ' refunded'),
        card('Accounts', String(s.accounts.total || 0), (s.accounts.verified || 0) + ' verified · ' + (s.accounts.active30 || 0) + ' active in 30 days'),
        card('Promo code uses', String(s.promoUses || 0))
      ),
      h('h2', null, 'Latest purchases'),
      table(purchaseColumns(), s.recent || [], 'No purchases yet.')
    );
  };

  // ── Purchases ──
  let purchaseQuery = { q: '', status: '', offset: 0 };
  views.purchases = async function () {
    const params = new URLSearchParams({ q: purchaseQuery.q, status: purchaseQuery.status, offset: String(purchaseQuery.offset) });
    const data = await api('purchases?' + params);
    const reload = () => open('purchases');
    const q = h('input', { type: 'search', placeholder: 'Email or payment ID', value: purchaseQuery.q, 'aria-label': 'Search purchases' });
    const status = h('select', { 'aria-label': 'Status' },
      [['', 'All'], ['paid', 'Paid'], ['refunded', 'Refunded']].map(([v, t]) => h('option', { value: v, selected: purchaseQuery.status === v }, t)));
    const search = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); purchaseQuery = { q: q.value.trim(), status: status.value, offset: 0 }; reload(); } },
      q, status, h('button', { type: 'submit', class: 'primary' }, 'Search'));

    const from = data.total ? data.offset + 1 : 0;
    const to = data.offset + data.rows.length;
    const pager = h('div', { class: 'pager' },
      h('span', { class: 'muted' }, from + '–' + to + ' of ' + data.total),
      h('button', { type: 'button', class: 'small', disabled: data.offset === 0, onclick: () => { purchaseQuery.offset = Math.max(0, data.offset - data.page); reload(); } }, '← Newer'),
      h('button', { type: 'button', class: 'small', disabled: to >= data.total, onclick: () => { purchaseQuery.offset = data.offset + data.page; reload(); } }, 'Older →'));

    return h('div', null, grantForm(reload), search, table(purchaseColumns(reload), data.rows, 'No purchases match.'), pager);
  };

  function productSelect() {
    const opts = [h('option', { value: 'bundle' }, 'Full access (all 16)')];
    for (let n = 2; n <= 17; n++) opts.push(h('option', { value: String(n).padStart(2, '0') }, 'Module ' + String(n).padStart(2, '0')));
    return h('select', { 'aria-label': 'Product' }, opts);
  }

  function grantForm(onDone, presetEmail) {
    const email = h('input', { type: 'email', placeholder: 'buyer@example.com', required: true, value: presetEmail || '', 'aria-label': 'Email' });
    const product = productSelect();
    const note = h('input', { type: 'text', placeholder: 'Note (optional), e.g. paid by bank transfer', maxlength: '200', 'aria-label': 'Note' });
    const form = h('form', { class: 'grant', onsubmit: async (e) => {
      e.preventDefault();
      const label = product.options[product.selectedIndex].text;
      if (!confirm('Give ' + email.value.trim() + ' access to ' + label + ' for free?')) return;
      try {
        await post('purchases', { email: email.value, product: product.value, note: note.value });
        onDone();
        notice('Access granted to ' + email.value.trim() + '. It shows up the next time they open the app.');
      } catch (err) { notice(err.message === 'bad_email' ? 'That email doesn’t look right.' : 'Couldn’t grant it: ' + err.message, true); }
    } }, email, product, note, h('button', { type: 'submit', class: 'primary' }, 'Grant access'));
    return h('details', { class: 'box' }, h('summary', null, 'Give someone access by hand'), form);
  }

  // ── Customer ──
  views.customer = async function (email) {
    const input = h('input', { type: 'email', placeholder: 'buyer@example.com', value: email || '', 'aria-label': 'Customer email' });
    const form = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) open('customer', input.value.trim()); } },
      input, h('button', { type: 'submit', class: 'primary' }, 'Look up'));
    if (!email) return h('div', null, form, h('p', { class: 'muted' }, 'Find everything about one buyer: their purchases, devices, promo codes and history.'));

    const c = await api('customer?email=' + encodeURIComponent(email));
    const reload = () => open('customer', c.email);
    const accounts = c.accounts.length
      ? table([
        { label: 'Account ID', cell: (a) => h('code', null, a.uid) },
        { label: 'Verified', cell: (a) => (a.verified ? pill('yes', 'ok') : pill('no', 'warn')) },
        { label: 'Signed up', cell: (a) => when(a.created_at) },
        { label: 'Last seen', cell: (a) => when(a.last_seen) },
        { label: 'Devices', cell: (a) => {
          const n = c.devices.filter((d) => d.uid === a.uid).length;
          return h('span', null, n + ' ', n ? h('button', { type: 'button', class: 'small', onclick: async () => {
            if (!confirm('Sign ' + a.email + ' out of all ' + n + ' device(s) for paid content? Their next ' + n + ' devices can then take the slots.')) return;
            try { await post('devices/reset', { uid: a.uid }); reload(); notice('Devices reset.'); } catch (e) { notice('Couldn’t reset: ' + e.message, true); }
          } }, 'Reset devices') : null);
        } }
      ], c.accounts)
      : h('p', { class: 'muted' }, 'No app sign-in with this email yet (purchases still unlock when they sign in).');

    return h('div', null, form,
      h('h2', null, c.email),
      h('h3', null, 'Accounts'), accounts,
      h('h3', null, 'Purchases'), table(purchaseColumns(reload), c.purchases, 'No purchases.'),
      grantForm(reload, c.email),
      h('h3', null, 'Devices'), table([
        { label: 'Device', cell: (d) => d.label || 'Unknown device' },
        { label: 'Added', cell: (d) => when(d.created_at) },
        { label: 'Last used', cell: (d) => when(d.last_seen) }
      ], c.devices, 'No devices.'),
      h('h3', null, 'Promo codes used'), table([
        { label: 'Code', cell: (r) => h('code', null, r.code) },
        { label: 'Product', cell: (r) => productName(r.product) },
        { label: 'Paid', cell: (r) => money(r.amount, r.currency) },
        { label: 'When', cell: (r) => when(r.at) }
      ], c.promos, 'None.'),
      c.claims.length ? [h('h3', null, 'Moved purchases'), table([
        { label: 'From', cell: (r) => r.from_email },
        { label: 'To', cell: (r) => r.to_email },
        { label: 'When', cell: (r) => when(r.at) }
      ], c.claims)] : null,
      h('h3', null, 'History'), auditTable(c.audit)
    );
  };

  // ── Offers & codes ──
  // Times are entered and shown in India time; the API stores ISO strings.
  const IST_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function toInput(value, end) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value + (end ? 'T23:59' : 'T00:00');
    const d = new Date(value);
    if (isNaN(d)) return '';
    const p = Object.fromEntries(IST_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  const fromInput = (v) => (v ? v + ':00+05:30' : null);
  function showTime(value, end) {
    if (!value) return null;
    const v = toInput(value, end);
    const d = new Date(v + ':00+05:30');
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function dates(x) {
    const s = showTime(x.starts, false);
    const e = showTime(x.ends, true);
    if (!s && !e) return 'always';
    return (s || 'now') + ' → ' + (e || 'no end');
  }
  function discountText(x) {
    if (x.price) return Object.entries(x.price).map(([cur, p]) => money(p.module, cur) + ' / module, ' + money(p.bundle, cur) + ' / full').join('; ');
    if (x.percentOff) return x.percentOff + '% off';
    if (x.amountOff) return Object.entries(x.amountOff).map(([cur, a]) => money(a, cur) + ' off').join(', ');
    return '·';
  }
  const products = (x) => (Array.isArray(x.products) && x.products.length === 1 ? (x.products[0] === 'bundle' ? 'full access only' : 'single modules only') : 'everything');
  const SOURCE_TEXT = { 'built-in': 'built in', 'built-in, edited': 'built in, edited', panel: 'added here' };

  // Only the fields the API takes, from a listed rule.
  function ruleBody(x, patch) {
    const b = { label: x.label, active: x.active !== false, starts: x.starts || null, ends: x.ends || null };
    if (Array.isArray(x.products)) b.products = x.products;
    if (x.price) b.price = x.price;
    else if (x.amountOff) b.amountOff = x.amountOff;
    else b.percentOff = x.percentOff;
    if (x.code) { if (Number.isInteger(x.maxUses)) b.maxUses = x.maxUses; b.oncePerAccount = x.oncePerAccount !== false; }
    return { ...b, ...(patch || {}) };
  }

  const ruleId = (kind, x) => (kind === 'offer' ? x.id : x.code);
  const saveRule = (kind, id, body) => api('rules/' + kind + '/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) });
  const ruleError = (e) => (e.data && e.data.why ? e.data.why : 'Couldn’t save: ' + e.message);

  function ruleActions(kind, x, reload, edit) {
    const id = ruleId(kind, x);
    const on = x.active !== false;
    const name = kind === 'offer' ? 'offer “' + (x.label || id) + '”' : 'code ' + id;
    const Name = name.charAt(0).toUpperCase() + name.slice(1);
    const toggle = h('button', { type: 'button', class: on ? 'small danger' : 'small', onclick: async () => {
      if (!confirm((on ? 'Switch off ' : 'Switch on ') + name + '? Buyers see the change within a minute.')) return;
      try { await saveRule(kind, id, ruleBody(x, { active: !on })); reload(); notice(Name + (on ? ' switched off.' : ' switched on.')); }
      catch (e) { notice(ruleError(e), true); }
    } }, on ? 'Switch off' : 'Switch on');
    const editBtn = h('button', { type: 'button', class: 'small', onclick: () => edit(x) }, 'Edit');
    let remove = null;
    if (x.source === 'panel' || x.source === 'built-in, edited') {
      const reset = x.source === 'built-in, edited';
      remove = h('button', { type: 'button', class: 'small', onclick: async () => {
        if (!confirm(reset ? 'Undo your changes to ' + name + ' and go back to its built-in settings?' : 'Delete ' + name + '? Anyone who already used it keeps what they bought.')) return;
        try { await api('rules/' + kind + '/' + encodeURIComponent(id), { method: 'DELETE' }); reload(); notice(Name + (reset ? ' is back to its built-in settings.' : ' deleted.')); }
        catch (e) { notice('Couldn’t delete: ' + e.message, true); }
      } }, reset ? 'Reset' : 'Delete');
    }
    return h('div', { class: 'actions' }, toggle, editBtn, remove);
  }

  // The create / edit form for an offer or a promo code.
  function ruleEditor(kind, x, current, onSaved, onCancel) {
    const isNew = !x;
    x = x || {};
    const isOffer = kind === 'offer';
    const err = h('p', { class: 'error', role: 'alert' });
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
    const num = (value, attrs) => h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: value === undefined || value === null ? '' : String(value), ...(attrs || {}) });
    const rupees = (minor) => (Number.isInteger(minor) ? minor / 100 : '');

    const idInput = h('input', { type: 'text', value: ruleId(kind, x) || '', disabled: !isNew, required: true, maxlength: isOffer ? '40' : '32',
      placeholder: isOffer ? 'e.g. diwali-2026' : 'e.g. LAUNCH20', autocapitalize: isOffer ? 'none' : 'characters', spellcheck: 'false' });
    const label = h('input', { type: 'text', value: x.label || '', maxlength: '40', placeholder: isOffer ? 'Shown to buyers, e.g. Diwali sale' : 'e.g. 20% launch discount' });
    if (isNew && isOffer) label.addEventListener('input', () => { if (!idInput.dataset.touched) idInput.value = label.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); });
    idInput.addEventListener('input', () => { idInput.dataset.touched = '1'; });

    // Discount: percent, or fixed prices (offers) / fixed amount off (codes).
    const fixedKind = isOffer ? 'price' : 'amountOff';
    const type = h('select', null,
      h('option', { value: 'percent', selected: !x[fixedKind] }, 'Percent off'),
      h('option', { value: 'fixed', selected: !!x[fixedKind] }, isOffer ? 'Set exact prices' : 'Fixed amount off'));
    const pct = num(x.percentOff, { min: '1', max: isOffer ? '99' : '100', step: '1' });
    const pctBox = field('Percent off', pct, isOffer ? '1 to 99' : '1 to 100 (100 = free, no payment needed)');
    let fixedBox;
    let readFixed;
    if (isOffer) {
      const p = x.price || {};
      const inrM = num(rupees(p.INR && p.INR.module));
      const inrB = num(rupees(p.INR && p.INR.bundle));
      const usdM = num(rupees(p.USD && p.USD.module));
      const usdB = num(rupees(p.USD && p.USD.bundle));
      fixedBox = h('div', { class: 'grid2' },
        field('Single module, ₹', inrM), field('Full access, ₹', inrB),
        field('Single module, $ (optional)', usdM, 'Empty: same share off the dollar price'), field('Full access, $ (optional)', usdB));
      readFixed = () => {
        const out = { INR: { module: Math.round(inrM.value * 100), bundle: Math.round(inrB.value * 100) } };
        if (usdM.value || usdB.value) out.USD = { module: Math.round(usdM.value * 100), bundle: Math.round(usdB.value * 100) };
        return out;
      };
    } else {
      const a = x.amountOff || {};
      const inr = num(rupees(a.INR));
      const usd = num(rupees(a.USD));
      fixedBox = h('div', { class: 'grid2' }, field('Amount off, ₹', inr), field('Amount off, $ (optional)', usd, 'Empty: same share off in dollars'));
      readFixed = () => {
        const out = { INR: Math.round(inr.value * 100) };
        if (usd.value) out.USD = Math.round(usd.value * 100);
        return out;
      };
    }
    const syncType = () => { pctBox.hidden = type.value !== 'percent'; fixedBox.hidden = type.value === 'percent'; };
    type.addEventListener('change', syncType);
    syncType();

    const scope = Array.isArray(x.products) && x.products.length === 1 ? x.products[0] : 'both';
    const onModules = h('input', { type: 'checkbox', checked: scope !== 'bundle' });
    const onBundle = h('input', { type: 'checkbox', checked: scope !== 'module' });
    const starts = h('input', { type: 'datetime-local', value: toInput(x.starts, false) });
    const ends = h('input', { type: 'datetime-local', value: toInput(x.ends, true) });
    const active = h('input', { type: 'checkbox', checked: x.active !== false });
    const maxUses = isOffer ? null : num(x.maxUses, { min: '1', step: '1', placeholder: 'No limit' });
    const once = isOffer ? null : h('input', { type: 'checkbox', checked: x.oncePerAccount !== false });

    const preview = h('p', { class: 'preview' });
    function updatePreview() {
      const inr = current.INR;
      if (!inr) { preview.textContent = ''; return; }
      try {
        const body = read();
        const kinds = [onModules.checked && 'module', onBundle.checked && 'bundle'].filter(Boolean);
        preview.textContent = 'Preview (₹): ' + kinds.map((k) => {
          const name = k === 'bundle' ? 'Full access' : 'Single module';
          if (isOffer) {
            const list = inr[k].list;
            const price = body.price ? body.price.INR[k] : Math.round(list * (100 - body.percentOff) / 100 / 100) * 100;
            return name + ' ' + money(list, 'INR') + ' → ' + money(price, 'INR');
          }
          const base = inr[k].price;
          let total = body.amountOff ? base - body.amountOff.INR : Math.round(base * (100 - body.percentOff) / 100 / 100) * 100;
          if (body.percentOff !== 100) total = Math.max(100, total);
          return name + ' ' + money(base, 'INR') + ' → ' + money(Math.min(base, total), 'INR');
        }).join(' · ');
      } catch (e) { preview.textContent = ''; }
    }

    function read() {
      const body = { label: label.value.trim(), active: active.checked, starts: fromInput(starts.value), ends: fromInput(ends.value) };
      if (onModules.checked !== onBundle.checked) body.products = [onModules.checked ? 'module' : 'bundle'];
      else if (!onModules.checked) body.products = [];
      if (type.value === 'percent') body.percentOff = parseInt(pct.value, 10);
      else body[fixedKind] = readFixed();
      if (!isOffer) {
        if (maxUses.value) body.maxUses = parseInt(maxUses.value, 10);
        body.oncePerAccount = once.checked;
      }
      return body;
    }

    const form = h('form', { class: 'editor', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const id = isOffer ? idInput.value.trim().toLowerCase() : idInput.value.trim().toUpperCase();
      if (!id) { err.textContent = isOffer ? 'Give the offer a short id.' : 'Type the code.'; return; }
      try {
        await saveRule(kind, id, read());
        onSaved((isOffer ? 'Offer “' + (label.value.trim() || id) + '”' : 'Code ' + id) + ' saved. Buyers see it within a minute.');
      } catch (ex) { err.textContent = ruleError(ex); }
    } },
      h('h3', null, (isNew ? 'New ' : 'Edit ') + (isOffer ? 'offer' : 'promo code')),
      h('div', { class: 'grid2' },
        field(isOffer ? 'Offer id' : 'Code', idInput, isNew ? (isOffer ? 'Lowercase, digits and dashes. Can’t be changed later.' : 'Buyers type this. Can’t be changed later.') : null),
        field('Label', label, isOffer ? 'Shown next to the price' : 'Shown when the code is applied')),
      h('div', { class: 'grid2' }, field('Discount', type), h('div', null, pctBox, fixedBox)),
      h('fieldset', null, h('legend', null, 'Applies to'),
        h('label', { class: 'check' }, onModules, ' Single modules'),
        h('label', { class: 'check' }, onBundle, ' Full access')),
      h('div', { class: 'grid2' },
        field('Starts (India time)', starts, 'Leave empty to start now'),
        field('Ends (India time)', ends, 'Leave empty for no end')),
      isOffer ? null : h('div', { class: 'grid2' },
        field('Total uses allowed', maxUses, 'Paid uses across everyone. Empty = no limit.'),
        h('label', { class: 'check tall' }, once, ' Once per account')),
      h('label', { class: 'check' }, active, ' Switched on'),
      preview, err,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'primary' }, 'Save'),
        h('button', { type: 'button', onclick: onCancel }, 'Cancel')));
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    updatePreview();
    return form;
  }

  views.promos = async function () {
    const p = await api('promos');
    const reload = () => open('promos');
    const priceRows = Object.entries(p.current).flatMap(([cur, sheet]) => ['module', 'bundle'].map((k) => ({ cur, k, ...sheet[k] })));
    const editorSlot = h('div');
    const showEditor = (kind, x) => {
      editorSlot.textContent = '';
      editorSlot.append(h('div', { class: 'box' }, ruleEditor(kind, x, p.current, (msg) => { reload(); notice(msg); }, () => { editorSlot.textContent = ''; })));
      editorSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const stateCell = (x) => h('span', null, pill(x.state, STATE_KIND[x.state]), ' ', h('small', { class: 'muted' }, SOURCE_TEXT[x.source] || ''));

    return h('div', null,
      h('p', { class: 'muted' }, 'Switch offers and codes on or off, set their dates, or add new ones. Changes reach buyers within a minute; nothing needs deploying. Full prices are set in backend/src/pricing-config.js.'),
      h('h2', null, 'What buyers pay right now'),
      table([
        { label: 'Product', cell: (r) => (r.k === 'bundle' ? 'Full access' : 'Single module') + (r.cur !== 'INR' ? ' (' + r.cur + ')' : '') },
        { label: 'Full price', cell: (r) => money(r.list, r.cur) },
        { label: 'They pay', cell: (r) => h('strong', null, money(r.price, r.cur)) },
        { label: 'Offer', cell: (r) => (r.offer ? r.offer.label + ' · ' + r.percentOff + '% off' : 'none') }
      ], priceRows),
      editorSlot,
      h('div', { class: 'section-head' }, h('h2', null, 'Offers'), h('button', { type: 'button', class: 'primary small', onclick: () => showEditor('offer', null) }, '+ New offer')),
      table([
        { label: 'Offer', cell: (o) => h('span', null, h('strong', null, o.label || o.id), ' ', h('code', null, o.id)) },
        { label: 'Price', cell: discountText },
        { label: 'On', cell: products },
        { label: 'When', cell: dates },
        { label: 'State', cell: stateCell },
        { label: '', cell: (o) => ruleActions('offer', o, reload, (x) => showEditor('offer', x)) }
      ], p.offers, 'No offers. Buyers pay the full price.'),
      h('div', { class: 'section-head' }, h('h2', null, 'Promo codes'), h('button', { type: 'button', class: 'primary small', onclick: () => showEditor('promo', null) }, '+ New code')),
      table([
        { label: 'Code', cell: (x) => h('span', null, h('code', null, x.code), x.label ? h('small', { class: 'muted' }, ' ' + x.label) : null) },
        { label: 'Discount', cell: discountText },
        { label: 'On', cell: products },
        { label: 'When', cell: dates },
        { label: 'Used', cell: (x) => x.uses + (Number.isInteger(x.maxUses) ? ' / ' + x.maxUses : '') + (x.oncePerAccount === false ? ', repeat use allowed' : '') },
        { label: 'State', cell: stateCell },
        { label: '', cell: (x) => ruleActions('promo', x, reload, (r) => showEditor('promo', r)) }
      ], p.promos, 'No promo codes yet. Add one with “+ New code”.'),
      p.retired.length ? [h('h3', null, 'Deleted codes that were used'), table([
        { label: 'Code', cell: (r) => h('code', null, r.code) },
        { label: 'Used', cell: (r) => r.n },
        { label: 'Last', cell: (r) => when(r.last) }
      ], p.retired)] : null,
      h('h2', null, 'Latest code uses'),
      table([
        { label: 'When', cell: (r) => when(r.at) },
        { label: 'Code', cell: (r) => h('code', null, r.code) },
        { label: 'Who', cell: (r) => (r.email ? customerLink(r.email) : h('code', null, r.uid)) },
        { label: 'Product', cell: (r) => productName(r.product) },
        { label: 'Paid', cell: (r) => money(r.amount, r.currency) }
      ], p.recent, 'No codes used yet.')
    );
  };

  // ── Activity ──
  const EVENT_NAMES = {
    purchase: 'Purchase', refund: 'Refund', admin_grant: 'Granted by admin', admin_revoke: 'Revoked by admin',
    admin_restore: 'Restored by admin', admin_devices_reset: 'Devices reset by admin', device_added: 'Device added',
    device_removed: 'Device removed', checkout_order: 'Checkout started', purchase_claimed: 'Purchase moved',
    account_deleted: 'Account deleted', checkout_upstream_error: 'Razorpay error', purchase_unmapped: 'Unmatched payment',
    admin_offer_saved: 'Offer saved by admin', admin_offer_deleted: 'Offer deleted by admin',
    admin_promo_saved: 'Promo code saved by admin', admin_promo_deleted: 'Promo code deleted by admin'
  };
  function detailText(d) {
    if (!d) return '';
    let o;
    try { o = JSON.parse(d); } catch (e) { return d; }
    return Object.entries(o).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ');
  }
  function auditTable(rows) {
    return table([
      { label: 'When', cell: (r) => when(r.at) },
      { label: 'What', cell: (r) => EVENT_NAMES[r.event] || r.event },
      { label: 'Who', cell: (r) => (r.subject && r.subject.includes('@') ? customerLink(r.subject) : h('code', null, r.subject || '·')) },
      { label: 'Details', cell: (r) => h('span', { class: 'detail' }, detailText(r.detail)) }
    ], rows || [], 'Nothing recorded.');
  }
  let auditOffset = 0;
  views.audit = async function () {
    const data = await api('audit?offset=' + auditOffset);
    const pager = h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'small', disabled: auditOffset === 0, onclick: () => { auditOffset = Math.max(0, auditOffset - data.page); open('audit'); } }, '← Newer'),
      h('button', { type: 'button', class: 'small', disabled: data.rows.length < data.page, onclick: () => { auditOffset += data.page; open('audit'); } }, 'Older →'));
    return h('div', null, h('p', { class: 'muted' }, 'Everything that changed someone’s access, newest first.'), auditTable(data.rows), pager);
  };

  // ── Wiring ──
  document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));
  window.addEventListener('hashchange', () => { if (session && location.hash.slice(1) !== current) open(location.hash.slice(1)); });
  $('signOut').addEventListener('click', () => { saveSession(null); showSignIn(); });
  $('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('siError').textContent = '';
    try {
      await signIn($('siEmail').value.trim(), $('siPassword').value);
      $('siPassword').value = '';
      showPanel();
    } catch (err) { $('siError').textContent = err.message; }
  });

  if (!cfg.apiBase || !cfg.firebaseApiKey) {
    $('signin').hidden = false;
    $('siError').textContent = 'The backend isn’t configured (assets/backend-config.js).';
  } else if (session) showPanel();
  else showSignIn();
})();
