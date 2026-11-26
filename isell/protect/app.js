/* iSell Gadget Protection dashboard — powered by M&P Developers.
   iSell team (iSell Billing logins) sees every client company; company logins see only their own. */
'use strict';

if (window.top !== window.self) {
  document.documentElement.innerHTML = '<body style="font:16px system-ui;padding:24px">Open iSell Gadget Protection directly at hedezfx.github.io/isell/protect/</body>';
  throw new Error('Framed');
}

const CFG = window.ISP_CONFIG;
const FN = CFG.SUPABASE_URL + '/functions/v1/isell-protect';
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const LOGO = window.ISELL_LOGO || '';
const PACKAGE = 'com.isell.protect';
const ADMIN = PACKAGE + '/com.mpdevelopers.lock.AdminReceiver';

let me = null, devices = [], companies = [], tab = 'phones';
// The iSell team can type "admin" instead of the admin email. Client companies use their email.
const ADMIN_EMAIL = String(CFG.ADMIN_EMAIL || '').toLowerCase(); // set in config.js
const loginEmail = () => { const v = $('aEmail').value.trim().toLowerCase(); return v === 'admin' && ADMIN_EMAIL ? ADMIN_EMAIL : v; };

/* ---------- helpers ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'K' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
const fdate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const ftime = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function since(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
const isTeam = () => me && me.team;
const isAdmin = () => me && me.role === 'admin';
const paused = () => me && !me.team && me.company && me.company.paused;

async function token() { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; }
async function api(method, path, body) {
  const t = await token();
  const r = await fetch(FN + path, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + (t || '') }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { showAuth(); throw new Error(j.error || 'Please log in.'); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
function banner(msg, ok) { const b = $('banner'); b.hidden = !msg; b.textContent = msg || ''; b.className = 'banner ' + (ok ? 'ok' : 'err'); }
let busy = false;
async function once(btn, fn) {
  if (busy) return;
  busy = true; if (btn) btn.disabled = true;
  try { return await fn(); } finally { busy = false; if (btn) btn.disabled = false; }
}

/* ---------- login ---------- */
function showAuth() { $('loading').hidden = true; $('app').hidden = true; $('auth').hidden = false; $('dotBtn').hidden = true; $('dotPanel').hidden = true; }
$('logoA').src = LOGO; $('logoH').src = LOGO;
$('dotLogin').innerHTML = window.dotHTML('main');
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const err = $('aErr'); err.className = 'aerr'; err.textContent = '';
  busy = true; $('authBtn').disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(), password: $('aPass').value });
    if (error) throw error;
    busy = false; $('authBtn').disabled = false;
    await start();
  } catch (ex) { err.textContent = ex.message || 'Could not sign in.'; }
  finally { busy = false; $('authBtn').disabled = false; }
});
$('authForgot').onclick = async () => {
  const err = $('aErr'), email = loginEmail();
  if (!email) { err.className = 'aerr'; err.textContent = 'Type your email (or admin) first, then tap Forgot password.'; $('aEmail').focus(); return; }
  await once($('authForgot'), async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    err.className = error ? 'aerr' : 'aerr ok';
    err.textContent = error ? (error.message || 'Could not send the email.') : 'If that email has a login, a reset link is on its way.';
  });
};
sb.auth.onAuthStateChange(async (event) => {
  if (event !== 'PASSWORD_RECOVERY') return;
  for (;;) {
    const pw = await ask({ title: 'Choose a new password', text: 'At least 8 characters.', value: '', password: true, okLabel: 'Save password' });
    if (pw === null) return;
    if (pw.length < 8) continue;
    const { error } = await sb.auth.updateUser({ password: pw });
    if (!error) { banner('Password changed.', true); return; }
    await ask({ title: 'Could not change the password', text: error.message || 'Try again.', confirmOnly: true, okLabel: 'Try again' });
  }
});
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- dialogs ---------- */
let askResolve = null;
function ask({ title, text, value, multiline, number, password, confirmOnly, okLabel, html, noCancel }) {
  $('askTitle').textContent = title; $('askText').textContent = text || '';
  const f = $('askField'); f.innerHTML = html || '';
  let input = null;
  if (!confirmOnly && !html) {
    input = document.createElement(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = 3;
    if (number) { input.type = 'number'; input.min = '0'; input.inputMode = 'decimal'; }
    if (password) { input.type = 'password'; input.autocomplete = 'new-password'; }
    input.value = value == null ? '' : value;
    f.appendChild(input);
  }
  $('askOk').textContent = okLabel || 'OK';
  $('askCancel').hidden = !!noCancel;
  $('askModal').classList.add('open');
  if (input) setTimeout(() => input.focus(), 50);
  return new Promise((res) => {
    askResolve = (v) => { $('askModal').classList.remove('open'); askResolve = null; res(v); };
    $('askOk').onclick = () => askResolve(confirmOnly || html ? true : input.value);
  });
}
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => {
  const m = b.closest('.modal'); m.classList.remove('open');
  if (m.id === 'askModal' && askResolve) askResolve(null);
}));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
  if (e.target === m) { m.classList.remove('open'); if (m.id === 'askModal' && askResolve) askResolve(null); }
}));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = document.querySelector('.modal.open');
  if (m) { m.classList.remove('open'); if (m.id === 'askModal' && askResolve) askResolve(null); }
  else if (!$('dotPanel').hidden) $('dotPanel').hidden = true;
});

/* ---------- tabs + stats ---------- */
function renderTabs() {
  const t = [['phones', 'Phones']];
  if (isTeam()) t.push(['companies', 'Companies & bills']); else t.push(['bill', 'Our bill']);
  if (isAdmin()) t.push(['settings', 'Settings']);
  $('tabs').innerHTML = t.map(([k, l]) => `<button type="button" data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
  $('tabPhones').hidden = tab !== 'phones'; $('tabCompanies').hidden = tab !== 'companies';
  $('tabBill').hidden = tab !== 'bill'; $('tabSettings').hidden = tab !== 'settings';
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-t]'); if (!b) return;
  tab = b.dataset.t; renderTabs();
  if (tab === 'companies') loadCompanies(); if (tab === 'bill') loadOwnBill();
});
function stat(k, v, n, bad) { return `<div class="stat${bad ? ' bad' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="n">${n}</div></div>`; }
function renderStats() {
  const live = devices.filter((d) => d.status !== 'released');
  const locked = devices.filter((d) => d.status === 'locked').length;
  const offline = live.filter((d) => d.lastSeen && Date.now() - d.lastSeen > 2 * 86400000).length;
  let html = stat('Protected phones', live.length, 'being protected now') + stat('Locked now', locked, 'locked by the company', locked > 0) +
    stat('Offline 2+ days', offline, 'not checking in', offline > 0);
  if (isTeam()) {
    const overdue = companies.reduce((s, c) => s + (c.overdue || 0), 0);
    html += stat('Overdue', money(overdue), `${companies.filter((c) => c.overdue > 0).length} companies behind`, overdue > 0);
  } else html += stat('Our balance', money(ownBillCache ? ownBillCache.summary?.balance : 0), ownBillCache && ownBillCache.summary?.overdue > 0 ? money(ownBillCache.summary.overdue) + ' overdue' : 'see "Our bill"', ownBillCache && ownBillCache.summary?.overdue > 0);
  $('stats').innerHTML = html;
}

/* ---------- phones ---------- */
async function loadDevices() {
  try { devices = (await api('GET', '/api/devices')).devices; renderPhones(); renderStats(); }
  catch (e) { banner('Cannot load phones: ' + e.message); }
}
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const LOC_PROBLEM = {
  off: 'location is switched off on the phone', no_permission: 'location is not allowed — redo the phone setup',
  no_fix: 'no GPS signal at the last try', not_owner: 'the app is not in full control — redo the phone setup',
};
const accTxt = (a) => (a == null || a < 0 ? '' : ` · within ${Math.round(a)} m`);
function locLine(d) {
  if (d.status === 'released' || !d.lastSeen) return '';
  const pend = d.locateRequestedAt ? ' · <span class="pend">locating…</span>' : '';
  const prob = d.locProblem && LOC_PROBLEM[d.locProblem] ? ` · <span class="warn">${LOC_PROBLEM[d.locProblem]}</span>` : '';
  if (!d.location) return `<div class="loc">${PIN} Location: waiting for the first report${pend}${prob}</div>`;
  return `<div class="loc">${PIN} Location <b>${since(d.location.at)}</b>${accTxt(d.location.acc)}${pend}${prob}</div>`;
}
function seenLine(d) {
  if (d.status === 'released') return `<div class="seen">released ${d.releasedAt ? fdate(d.releasedAt) : ''} · no longer protected</div>`;
  if (!d.lastSeen) return '<div class="seen">not set up yet — never checked in</div>';
  const stale = Date.now() - d.lastSeen > d.graceDays * 86400000;
  return `<div class="seen${stale ? ' stale' : ''}">checked in ${since(d.lastSeen)}${stale ? ' — offline too long, it locks itself' : ''}</div>`;
}
function renderPhones() {
  const fc = $('fCompany').value, fs = $('fStatus').value, ft = $('fText').value.trim().toLowerCase();
  const rows = devices.filter((d) => (!fc || d.companyId === fc) && (!fs || d.status === fs) &&
    (!ft || [d.employee, d.companyName, d.model, d.imei, d.assetTag, d.employeePhone].join(' ').toLowerCase().includes(ft)));
  $('phoneCount').textContent = devices.length ? `(${rows.length} of ${devices.length})` : '';
  const list = $('phoneList');
  if (!rows.length) { list.innerHTML = `<div class="empty"><div class="dotstage">${window.dotHTML(devices.length ? 'thinking' : 'hello')}</div>${devices.length ? 'No phones match.' : isTeam() ? 'No phones yet. Add a company, then protect its first phone above.' : 'No phones yet. iSell will set up your phones.'}</div>`; return; }
  const p = paused();
  list.innerHTML = rows.map((d) => {
    const live = d.status !== 'released';
    const main = !live ? '' : d.status === 'locked'
      ? `<button class="okb" data-a="unlock" data-id="${d.id}"${p ? ' disabled' : ''}>Unlock</button>`
      : `<button class="danger" data-a="lock" data-id="${d.id}"${p ? ' disabled' : ''}>Lock</button>`;
    return `<div class="card">
      <div class="top"><div><div class="nm">${esc(d.employee)}</div>
        <div class="mt">${isTeam() ? `<b>${esc(d.companyName)}</b> · ` : ''}${esc(d.model || 'phone')}${d.imei ? ' · IMEI ' + esc(d.imei) : ''}${d.assetTag ? ' · ' + esc(d.assetTag) : ''}${d.employeePhone ? ' · ' + esc(d.employeePhone) : ''}</div>
        ${seenLine(d)}</div><span class="badge ${d.status}">${d.status}</span></div>
      ${d.status === 'locked' && d.lockMessage ? `<div class="mt">Message on phone: “${esc(d.lockMessage)}”</div>` : ''}
      ${locLine(d)}
      <div class="acts">${main}
        ${live ? `<button class="ghost" data-a="loc" data-id="${d.id}"${p ? ' disabled' : ''}>Location</button>` : ''}
        ${isTeam() && live ? `<button class="ghost" data-a="edit" data-id="${d.id}">Edit</button><button class="ghost" data-a="usb" data-id="${d.id}">USB setup</button><button class="ghost" data-a="setup" data-id="${d.id}">QR setup</button><button class="ghost" data-a="code" data-id="${d.id}">Code</button><button class="ghost" data-a="release" data-id="${d.id}">Release</button>` : ''}
        ${isAdmin() ? `<button class="ghost" data-a="del" data-id="${d.id}">Delete</button>` : ''}
      </div></div>`;
  }).join('');
}
['fCompany', 'fStatus'].forEach((id) => ($(id).onchange = renderPhones));
$('fText').oninput = renderPhones;

$('phoneList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const d = devices.find((x) => x.id === b.dataset.id); if (!d) return;
  return once(b, () => phoneAction(b.dataset.a, d));
});
async function phoneAction(a, d, presetMessage) {
  try {
    switch (a) {
      case 'lock': {
        const m = presetMessage != null ? presetMessage : await ask({ title: `Lock ${d.employee}'s phone`, text: 'Message shown on the locked phone (blank = standard message). It locks at the next check-in — usually within 30 minutes when online. Emergency calls still work.', value: '', multiline: true, okLabel: 'Lock phone' });
        if (m === null) return;
        await api('POST', `/api/devices/${d.id}/lock`, { message: m }); banner(`${d.employee}'s phone will lock at its next check-in.`, true); break;
      }
      case 'unlock': await api('POST', `/api/devices/${d.id}/unlock`, {}); banner(`${d.employee}'s phone will unlock at its next check-in.`, true); break;
      case 'locate': await api('POST', `/api/devices/${d.id}/locate`, {}); banner(`Asked ${d.employee}'s phone for its location. It answers at its next check-in.`, true); break;
      case 'loc': openLocation(d.id); return;
      case 'edit': {
        const ok = await ask({ title: `Edit ${d.employee}'s phone`, html: `<div class="grid" style="grid-template-columns:1fr">
          <label>Employee name<input id="eEmp" value="${esc(d.employee)}"></label>
          <label>Employee phone<input id="ePh" value="${esc(d.employeePhone)}"></label>
          <label>Device model<input id="eMod" value="${esc(d.model)}"></label>
          <label>IMEI<input id="eImei" value="${esc(d.imei)}"></label>
          <label>Asset tag<input id="eTag" value="${esc(d.assetTag)}"></label>
          <label>Contact number on lock screen<input id="eCon" value="${esc(d.contactPhone)}"></label></div>`, okLabel: 'Save' });
        if (!ok) return;
        await api('POST', `/api/devices/${d.id}/edit`, { employee: $('eEmp').value, employeePhone: $('ePh').value, model: $('eMod').value, imei: $('eImei').value, assetTag: $('eTag').value, contactPhone: $('eCon').value });
        break;
      }
      case 'release': {
        const ok = await ask({ title: 'Release this phone?', text: `${d.employee}'s phone (${d.companyName}) stops being protected for good: it unlocks, the lock and USB block are removed at its next check-in, monthly charges stop and its location history is deleted.`, confirmOnly: true, okLabel: 'Release' });
        if (!ok) return;
        await api('POST', `/api/devices/${d.id}/release`, {}); break;
      }
      case 'del': {
        const ok = await ask({ title: 'Delete this phone record?', text: 'Release the phone first. A deleted phone can no longer check in and locks itself when its offline days run out. Its charges stay on the company bill. This cannot be undone.', confirmOnly: true, okLabel: 'Delete' });
        if (!ok) return;
        await api('DELETE', `/api/devices/${d.id}`); break;
      }
      case 'usb': openUsbSetup(d.id, d.employee); return;
      case 'setup': openSetupQR(d.id, d.employee); return;
      case 'code': { const j = await api('GET', `/api/devices/${d.id}/enroll`); openCodeQR(j.code); return; }
    }
    await loadDevices();
  } catch (err) { banner(err.message); }
}

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  return once(e.target.querySelector('button[type=submit]'), async () => {
    try {
      const j = await api('POST', '/api/devices', body);
      e.target.reset(); $('addForm').graceDays.value = me.settings.graceDays;
      await loadDevices();
      if (isTeam()) loadCompanies(true);
      openUsbSetup(j.device.id, j.device.employee);
    } catch (err) { banner(err.message); }
  });
});

/* ---------- companies + bills (iSell team) ---------- */
async function loadCompanies(quiet) {
  if (!isTeam()) return;
  try {
    const j = await api('GET', '/api/companies');
    companies = j.companies;
    const opts = companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.paused ? ' (paused)' : ''}</option>`).join('');
    const keepF = $('fCompany').value, keepA = $('addCompany').value;
    $('fCompany').innerHTML = '<option value="">All companies</option>' + opts; $('fCompany').value = keepF;
    $('addCompany').innerHTML = companies.length ? '<option value="">Choose company…</option>' + opts : '<option value="">Add a company first</option>';
    $('addCompany').value = keepA;
    renderCompanies(); renderStats();
  } catch (e) { if (!quiet) banner('Cannot load companies: ' + e.message); }
}
function renderCompanies() {
  $('companyCount').textContent = companies.length ? `(${companies.length})` : '';
  if (!companies.length) { $('companyList').innerHTML = `<div class="empty"><div class="dotstage">${window.dotHTML('hello')}</div>No client companies yet. Add your first one above.</div>`; return; }
  $('companyList').innerHTML = companies.map((c) => `<div class="card">
    <div class="top"><div><div class="nm">${esc(c.name)}</div>
      <div class="mt">${esc(c.contactPhone || 'no contact phone')}${c.email ? ' · ' + esc(c.email) : ''} · ${c.logins} login${c.logins === 1 ? '' : 's'} · ${c.protectedPhones} protected phone${c.protectedPhones === 1 ? '' : 's'}</div></div>
      ${c.paused ? '<span class="badge paused">paused</span>' : c.overdue > 0 ? '<span class="badge locked">overdue</span>' : '<span class="badge active">ok</span>'}</div>
    <div class="money"><span>Fees <b>${money(c.setupFee)}</b> install + <b>${money(c.monthlyFee)}</b>/month per phone</span>
      <span>Billed <b>${money(c.charged)}</b></span><span>Paid <b>${money(c.paid)}</b></span><span>Balance <b>${money(c.balance)}</b></span>
      ${c.overdue > 0 ? `<span class="due">Overdue <b class="due">${money(c.overdue)}</b></span>` : ''}</div>
    <div class="acts">
      <button class="primary" data-c="bill" data-id="${c.id}">Bill & payments</button>
      <button class="ghost" data-c="pay" data-id="${c.id}">Record payment</button>
      ${isAdmin() ? `<button class="ghost" data-c="logins" data-id="${c.id}">Logins</button><button class="ghost" data-c="edit" data-id="${c.id}">Edit</button>
        ${c.paused ? `<button class="okb" data-c="resume" data-id="${c.id}">Resume service</button>` : `<button class="ghost" data-c="pause" data-id="${c.id}">Pause service</button>`}
        <button class="ghost" data-c="del" data-id="${c.id}">Delete</button>` : ''}
      <button class="ghost" data-c="phones" data-id="${c.id}">Show phones</button>
    </div></div>`).join('');
}
$('companyList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]'); if (!b) return;
  const c = companies.find((x) => x.id === b.dataset.id); if (!c) return;
  return once(b, () => companyAction(b.dataset.c, c));
});
async function companyAction(a, c) {
  try {
    switch (a) {
      case 'bill': await showBill(c.id, c.name); return;
      case 'phones': tab = 'phones'; renderTabs(); $('fCompany').value = c.id; renderPhones(); return;
      case 'pay': {
        const v = await ask({ title: `Payment from ${c.name}`, text: `Balance ${money(c.balance)}${c.overdue > 0 ? `, of which ${money(c.overdue)} overdue` : ''}. Amount received (K):`, value: '', number: true, okLabel: 'Save payment' });
        if (v === null) return;
        const note = await ask({ title: 'Payment note (optional)', text: 'e.g. receipt number or "Airtel Money"', value: '', okLabel: 'Save' });
        await api('POST', `/api/companies/${c.id}/payment`, { amount: Number(v), note: note || '' });
        banner('Payment saved.', true); break;
      }
      case 'edit': {
        const ok = await ask({ title: `Edit ${c.name}`, text: 'New fees apply to charges from now on; past charges stay as they were.', html: `<div class="grid" style="grid-template-columns:1fr">
          <label>Company name<input id="cName" value="${esc(c.name)}"></label>
          <label>Contact phone<input id="cPhone" value="${esc(c.contactPhone)}"></label>
          <label>Email<input id="cEmail" value="${esc(c.email)}"></label>
          <label>Installation fee per phone (K)<input id="cSetup" type="number" min="0" value="${c.setupFee}"></label>
          <label>Monthly fee per phone (K)<input id="cMonthly" type="number" min="0" value="${c.monthlyFee}"></label></div>`, okLabel: 'Save' });
        if (!ok) return;
        await api('POST', `/api/companies/${c.id}`, { name: $('cName').value, contactPhone: $('cPhone').value, email: $('cEmail').value, setupFee: Number($('cSetup').value), monthlyFee: Number($('cMonthly').value) });
        break;
      }
      case 'pause': {
        const ok = await ask({ title: `Pause ${c.name}?`, text: `${c.name}'s logins can still see their phones and bill, but cannot lock, unlock or locate phones until you resume. Their phones stay protected. Overdue: ${money(c.overdue)}.`, confirmOnly: true, okLabel: 'Pause service' });
        if (!ok) return;
        await api('POST', `/api/companies/${c.id}/pause`, {}); break;
      }
      case 'resume': await api('POST', `/api/companies/${c.id}/resume`, {}); break;
      case 'del': {
        const ok = await ask({ title: `Delete ${c.name}?`, text: 'Only possible when the company has no phones. Its logins, bill and payments are deleted too. This cannot be undone.', confirmOnly: true, okLabel: 'Delete' });
        if (!ok) return;
        await api('DELETE', `/api/companies/${c.id}`); break;
      }
      case 'logins': await showLogins(c); return;
    }
    await loadCompanies();
  } catch (err) { banner(err.message); }
}
$('companyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  return once(e.target.querySelector('button[type=submit]'), async () => {
    try { await api('POST', '/api/companies', body); e.target.reset(); banner(`${body.name} added. Next: give them a login (Logins) and protect their phones.`, true); await loadCompanies(); }
    catch (err) { banner(err.message); }
  });
});

function billHTML(j) {
  const s = j.summary || { charged: 0, paid: 0, balance: 0, overdue: 0, protected_phones: 0 };
  const rows = [
    ...j.charges.map((x) => ({ t: x.dueAt, html: `<div><span>${fdate(x.dueAt)} · ${x.kind === 'setup' ? 'Installation' : 'Month ' + x.period} · ${esc(x.label)}</span><b>${money(x.amount)}</b></div>` })),
    ...j.payments.map((x) => ({ t: x.at, html: `<div style="color:var(--ok)"><span>${fdate(x.at)} · Payment${x.note ? ' · ' + esc(x.note) : ''}</span><b>−${money(x.amount)}</b></div>` })),
  ].sort((a, b) => b.t - a.t).map((r) => r.html).join('') || '<div>Nothing billed yet.</div>';
  return `<div class="money" style="margin-bottom:6px"><span>Fees <b>${money(j.setupFee)}</b> install + <b>${money(j.monthlyFee)}</b>/month per phone</span><span>Protected phones <b>${s.protected_phones}</b></span></div>
    <div class="money"><span>Billed <b>${money(s.charged)}</b></span><span>Paid <b>${money(s.paid)}</b></span><span>Balance <b>${money(s.balance)}</b></span>${s.overdue > 0 ? `<span class="due">Overdue <b class="due">${money(s.overdue)}</b></span>` : ''}</div>
    ${j.paused ? '<div class="banner warn" style="margin-top:10px">Service paused until the overdue amount is paid.</div>' : ''}
    <div class="hist">${rows}</div>`;
}
async function showBill(id, name) {
  const j = await api('GET', `/api/companies/${id}/billing`);
  await ask({ title: `Bill — ${name}`, html: billHTML(j), okLabel: 'Close', noCancel: true });
}
let ownBillCache = null;
async function loadOwnBill() {
  if (isTeam() || !me.company) return;
  try { ownBillCache = await api('GET', `/api/companies/${me.company.id}/billing`); $('ownBill').innerHTML = billHTML(ownBillCache) + '<p class="mt" style="margin-top:10px">To pay, contact iSell Innovations. Payments show here once iSell records them.</p>'; renderStats(); }
  catch (e) { $('ownBill').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function showLogins(c) {
  for (;;) {
    const j = await api('GET', `/api/companies/${c.id}/users`);
    const rows = j.users.map((u) => `<div><span>${esc(u.name || u.email)}<br><small>${esc(u.email)}${u.whatsapp ? ' · WhatsApp +' + esc(u.whatsapp) : ''}</small></span><span><button class="ghost" data-u="wa" data-id="${u.id}" data-wa="${esc(u.whatsapp || '')}">WhatsApp</button> <button class="ghost" data-u="pw" data-id="${u.id}">New password</button> <button class="ghost" data-u="rm" data-id="${u.id}">Remove</button></span></div>`).join('') || '<div>No logins yet.</div>';
    let picked = null;
    const p = ask({ title: `Logins — ${c.name}`, text: 'People at this company who can see and lock their own phones. They only ever see this company.', okLabel: 'Add a login', html: `<div class="hist" id="loginList">${rows}</div>` });
    $('loginList').onclick = (e) => { const b = e.target.closest('button[data-u]'); if (b) { picked = { a: b.dataset.u, id: b.dataset.id, wa: b.dataset.wa }; askResolve && askResolve('pick'); } };
    const r = await p;
    if (r === null) return;
    if (r === 'pick' && picked) {
      if (picked.a === 'wa') {
        const v = await ask({ title: 'WhatsApp number for Dot', text: 'With country code, digits only (e.g. 260977123456). Messages from this number to the iSell WhatsApp get answers about this company only. Leave blank to remove.', value: picked.wa || '', okLabel: 'Save' });
        if (v !== null) try { await api('POST', `/api/companies/${c.id}/user-whatsapp`, { userId: picked.id, whatsapp: v }); } catch (err) { await ask({ title: 'Not saved', text: err.message, confirmOnly: true, noCancel: true }); }
        continue;
      }
      if (picked.a === 'pw') {
        const k = await api('POST', `/api/companies/${c.id}/user-password`, { userId: picked.id });
        await ask({ title: 'New password', html: `<p>Give this to the person privately. They can change it with "Forgot password".</p><div class="secret">${esc(k.password)}</div>`, okLabel: 'Done', noCancel: true });
      } else {
        const ok = await ask({ title: 'Remove this login?', text: 'They lose access to this company straight away.', confirmOnly: true, okLabel: 'Remove' });
        if (ok) await api('POST', `/api/companies/${c.id}/user-remove`, { userId: picked.id });
      }
      continue;
    }
    const ok = await ask({ title: `New login for ${c.name}`, html: `<div class="grid" style="grid-template-columns:1fr"><label>Name<input id="nuName" autocomplete="off"></label><label>Email<input id="nuEmail" type="email" autocomplete="off"></label><label>WhatsApp number for Dot (optional)<input id="nuWa" inputmode="tel" placeholder="260977123456"></label></div>`, okLabel: 'Create login' });
    if (!ok) continue;
    try {
      const k = await api('POST', `/api/companies/${c.id}/users`, { name: $('nuName').value, email: $('nuEmail').value, whatsapp: $('nuWa').value });
      await ask({ title: 'Login created', html: `<p>Send these to <b>${esc(k.email)}</b> privately. The password is shown only once.</p><div class="secret">Website: hedezfx.github.io/isell/protect<br>Email: ${esc(k.email)}<br>Password: ${esc(k.password)}</div>`, okLabel: 'Done', noCancel: true });
    } catch (err) { await ask({ title: 'Could not create the login', text: err.message, confirmOnly: true, okLabel: 'OK', noCancel: true }); }
  }
}

/* ---------- settings + app upload (iSell admin) ---------- */
function fillSettings() {
  const s = me.settings; if (!s) return;
  $('sPhone').value = s.contactPhone || ''; $('sGrace').value = s.graceDays; $('sBillGrace').value = s.billingGraceDays;
  $('sSetup').value = s.defaultSetupFee; $('sMonthly').value = s.defaultMonthlyFee; $('sFrp').value = s.frpAccount || '';
  $('sTeamWa').value = s.teamWhatsapp || '';
  $('waState').textContent = me.whatsapp ? '· WhatsApp connected' : '· WhatsApp not connected yet';
  $('appState').textContent = s.app ? `app ready (${(s.app.size / 1048576).toFixed(1)} MB, ${fdate(s.app.uploadedAt)})` : 'no app uploaded yet — phone setup needs it';
  $('addForm').graceDays.value = s.graceDays;
}
$('saveSet').onclick = () => once($('saveSet'), async () => {
  try {
    const frp = $('sFrp').value.replace(/\s+/g, '');
    if (frp && !/^[0-9]{6,30}$/.test(frp)) { banner('The Google account ID is a long number, not the email address.'); return; }
    await api('POST', '/api/settings', { contactPhone: $('sPhone').value, graceDays: Number($('sGrace').value), billingGraceDays: Number($('sBillGrace').value), defaultSetupFee: Number($('sSetup').value), defaultMonthlyFee: Number($('sMonthly').value), frpAccount: frp, teamWhatsapp: $('sTeamWa').value });
    me = await api('GET', '/api/me'); fillSettings(); banner('Settings saved.', true);
  } catch (e) { banner(e.message); }
});
$('upApk').onclick = () => once($('upApk'), async () => {
  const file = $('apkFile').files[0];
  if (!file) { banner('Choose the app file first.'); return; }
  try {
    banner('Uploading app…', true);
    const apk = /\.zip$/i.test(file.name) || file.type === 'application/zip' ? await apkFromZip(file) : file;
    const up = await api('POST', '/api/app/upload-url', {});
    const put = await sb.storage.from('isell-protect-app').uploadToSignedUrl(up.path, up.token, apk, { contentType: 'application/vnd.android.package-archive' });
    if (put.error) throw new Error(put.error.message);
    await api('POST', '/api/app/finalize', { path: up.path });
    $('apkFile').value = '';
    me = await api('GET', '/api/me'); fillSettings();
    banner('App uploaded. Phone setup is ready, and protected phones update themselves.', true);
  } catch (e) { banner('Upload failed: ' + e.message); }
});
// Reads the APK out of the GitHub zip (prefers the iSell one).
async function apkFromZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file.');
  let n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
  const found = [];
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const fl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    const nm = new TextDecoder().decode(buf.slice(off + 46, off + 46 + fl));
    if (/\.apk$/i.test(nm)) found.push({ nm, method, csize, lho });
    off += 46 + fl + el + cl;
  }
  const f = found.find((x) => /isell/i.test(x.nm)) || found[0];
  if (!f) throw new Error('No .apk inside that zip.');
  if (!/isell/i.test(f.nm) && !confirm(`This zip contains "${f.nm}", not the iSell app. Upload it anyway?`)) throw new Error('Cancelled.');
  const lfl = dv.getUint16(f.lho + 26, true), lel = dv.getUint16(f.lho + 28, true);
  const data = buf.slice(f.lho + 30 + lfl + lel, f.lho + 30 + lfl + lel + f.csize);
  const bytes = f.method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return new Blob([bytes], { type: 'application/vnd.android.package-archive' });
}

/* ---------- location ---------- */
let loc = { id: null, map: null, layer: null, points: [], timer: null };
const locDevice = () => devices.find((x) => x.id === loc.id);
const gmaps = (lat, lng) => `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
async function openLocation(id) {
  loc.id = id;
  const d = locDevice(); if (!d) return;
  $('locName').textContent = d.employee + (isTeam() ? ' · ' + d.companyName : '');
  $('locHist').innerHTML = '';
  $('locModal').classList.add('open');
  if (!loc.map && window.L) {
    loc.map = L.map('locMap').setView([-15.4167, 28.2833], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(loc.map);
    loc.layer = L.layerGroup().addTo(loc.map);
  } else if (!window.L) $('locMap').innerHTML = '<div class="mapfail">The map could not load. The list below still works.</div>';
  setTimeout(() => loc.map && loc.map.invalidateSize(), 60);
  renderLocHeader(); await loadLocHistory();
  if (d.locateRequestedAt) pollLocate();
}
function renderLocHeader() {
  const d = locDevice(); if (!d) return;
  const note = $('locNote');
  $('locSummary').textContent = !d.lastSeen ? 'This phone has not checked in yet. Finish the phone setup first.'
    : d.location ? `Last seen here ${since(d.location.at)} (${ftime(d.location.at)})${accTxt(d.location.acc)}.`
      : 'No location yet. Phones send their first one within about 2 hours of setup, or press Locate now.';
  $('locGmaps').hidden = !d.location;
  if (d.location) $('locGmaps').href = gmaps(d.location.lat, d.location.lng);
  $('locNow').disabled = !d.lastSeen || paused();
  if (d.locateRequestedAt) { note.className = 'locnote pend'; note.textContent = `Locate now sent ${since(d.locateRequestedAt)}. Waiting for the phone — it answers at its next check-in, usually within 30 minutes if it has signal.`; }
  else if (d.locProblem && LOC_PROBLEM[d.locProblem]) { note.className = 'locnote warn'; note.textContent = 'Problem at the last try: ' + LOC_PROBLEM[d.locProblem] + '.'; }
  else { note.className = 'locnote'; note.textContent = ''; }
}
async function loadLocHistory() {
  const d = locDevice(); if (!d) return;
  try { loc.points = (await api('GET', `/api/devices/${d.id}/locations?days=${encodeURIComponent($('locDays').value)}`)).points || []; }
  catch (e) { loc.points = []; $('locNote').className = 'locnote warn'; $('locNote').textContent = e.message; }
  const pts = loc.points, hist = $('locHist');
  hist.innerHTML = pts.length ? '' : '<div>No positions in this period.</div>';
  pts.forEach((p, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span>${esc(ftime(p.fixAt))}${p.live ? '<span class="tag">Locate now</span>' : ''}${i === 0 ? '<span class="tag">latest</span>' : ''}</span><span>${p.acc != null ? 'within ' + Math.round(p.acc) + ' m' : ''}${p.battery != null ? ' · battery ' + p.battery + '%' : ''}</span>`;
    b.onclick = () => loc.map && loc.map.setView([p.lat, p.lng], 17);
    hist.appendChild(b);
  });
  if (!loc.map) return;
  loc.layer.clearLayers();
  if (!pts.length) return;
  const line = pts.slice().reverse().map((p) => [p.lat, p.lng]);
  if (line.length > 1) L.polyline(line, { color: '#5E2FAF', weight: 3, opacity: 0.55 }).addTo(loc.layer);
  pts.slice(1).forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#8A5CE6', fillOpacity: 0.9 }).bindTooltip(ftime(p.fixAt)).addTo(loc.layer));
  const last = pts[0];
  if (last.acc) L.circle([last.lat, last.lng], { radius: last.acc, color: '#5E2FAF', weight: 1, fillOpacity: 0.12 }).addTo(loc.layer);
  L.circleMarker([last.lat, last.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#b42318', fillOpacity: 1 }).bindTooltip('Latest: ' + ftime(last.fixAt)).addTo(loc.layer);
  if (pts.length === 1) loc.map.setView([last.lat, last.lng], 16); else loc.map.fitBounds(L.latLngBounds(line).pad(0.2), { maxZoom: 17 });
}
$('locDays').onchange = loadLocHistory;
$('locNow').onclick = () => once($('locNow'), async () => {
  const d = locDevice(); if (!d) return;
  try { await api('POST', `/api/devices/${d.id}/locate`, {}); await loadDevices(); renderLocHeader(); pollLocate(); }
  catch (e) { $('locNote').className = 'locnote warn'; $('locNote').textContent = e.message; }
});
function pollLocate() {
  clearTimeout(loc.timer);
  const started = Date.now();
  const tick = async () => {
    if (!$('locModal').classList.contains('open') || Date.now() - started > 40 * 60000) return;
    await loadDevices(); renderLocHeader();
    const d = locDevice();
    if (d && !d.locateRequestedAt) { await loadLocHistory(); return; }
    loc.timer = setTimeout(tick, 30000);
  };
  loc.timer = setTimeout(tick, 30000);
}

/* ---------- setup (QR / USB / code) ---------- */
function drawQR(boxId, text, size) {
  const box = $(boxId); box.innerHTML = '';
  const c = document.createElement('canvas'); box.appendChild(c);
  if (window.QRCode) QRCode.toCanvas(c, text, { width: size || 220, margin: 2, color: { dark: '#2B0F69' } }, (err) => { if (err) box.innerHTML = '<p>Could not draw QR.</p>'; });
}
function needApp() {
  if (me.settings && me.settings.app) return true;
  banner('Upload the iSell Protect app file in Settings first, then phone setup will work.');
  if (isAdmin()) { tab = 'settings'; renderTabs(); }
  return false;
}
async function openSetupQR(id, name) {
  if (!needApp()) return;
  try { const j = await api('GET', `/api/devices/${id}/setup-qr`); $('setupName').textContent = name; drawQR('setupBox', j.qr, 300); $('setupModal').classList.add('open'); }
  catch (e) { banner(e.message); }
}
let lastCode = '';
function openCodeQR(code) { lastCode = code; $('qrtext').textContent = code; drawQR('qrbox', code, 210); $('copyBtn').textContent = 'Copy code'; $('qrModal').classList.add('open'); }
$('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText(lastCode); $('copyBtn').textContent = 'Copied'; } catch { $('copyBtn').textContent = 'Select and copy it'; } };
let usb = null;
function b64urlToHex(b) { let t = String(b || '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return [...atob(t)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }
async function openUsbSetup(id, name) {
  if (!needApp()) return;
  try {
    const [q, e] = await Promise.all([api('GET', `/api/devices/${id}/setup-qr`), api('GET', `/api/devices/${id}/enroll`)]);
    const qr = JSON.parse(q.qr);
    usb = { id, name, url: qr['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'], hex: b64urlToHex(qr['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM']), code: e.code };
    $('usbName').textContent = name; $('usbName2').textContent = name;
    drawQR('usbQR', usb.code, 190); $('usbCopy').textContent = 'Copy code';
    $('usbModal').querySelector('.box').scrollTop = 0; $('usbModal').classList.add('open');
  } catch (err) { banner(err.message); }
}
$('usbCopy').onclick = async () => { try { await navigator.clipboard.writeText(usb.code); $('usbCopy').textContent = 'Copied'; } catch { $('usbCopy').textContent = 'Could not copy'; } };
$('usbToQR').onclick = () => { $('usbModal').classList.remove('open'); if (usb) openSetupQR(usb.id, usb.name); };
$('usbDl').onclick = () => {
  if (!usb) return;
  const safe = usb.name.replace(/[^A-Za-z0-9 .'-]/g, '').trim().slice(0, 40) || 'phone';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([installerBat(safe, usb.url, usb.hex)], { type: 'application/octet-stream' }));
  a.download = 'iSell-Protect-setup-' + (safe.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'phone') + '.bat';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
// Windows installer: downloads Android tools + the app, checks it, installs, gives it control.
function installerBat(name, url, hex) {
  if (!/^https:\/\/[A-Za-z0-9.\/_-]+$/.test(url)) throw new Error('Unexpected app address.');
  if (!/^[0-9a-f]{64}$/.test(hex)) hex = '';
  const W = '%WORK%\\';
  const L = [
    '@echo off', 'setlocal EnableExtensions', 'title iSell Protect - USB phone setup', 'color 5F',
    'set "NAME=' + name + '"', 'set "APKURL=' + url + '"', 'set "APKSHA=' + hex + '"', 'set "ADMIN=' + ADMIN + '"',
    'set "WORK=%LOCALAPPDATA%\\iSellProtect"', 'if not exist "%WORK%" mkdir "%WORK%"',
    'echo.', 'echo  ==================================================', 'echo    iSell Gadget Protection - USB phone setup', 'echo    Powered by M^&P Developers', 'echo    Phone for: %NAME%', 'echo  ==================================================', 'echo.',
    'where curl >nul 2>&1 || goto oldwindows',
    'set "ADB="', 'if exist "C:\\platform-tools\\adb.exe" set "ADB=C:\\platform-tools\\adb.exe"', `if exist "${W}platform-tools\\adb.exe" set "ADB=${W}platform-tools\\adb.exe"`, 'if defined ADB goto haveadb',
    'echo  [1/5] Downloading the Android tools from Google - first time only...',
    `curl -f -L -s -S -o "${W}pt.zip" "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"`, 'if errorlevel 1 goto netfail',
    `tar -xf "${W}pt.zip" -C "%WORK%"`, `if not exist "${W}platform-tools\\adb.exe" goto toolfail`, `set "ADB=${W}platform-tools\\adb.exe"`,
    ':haveadb', 'echo  [1/5] Android tools ready.', 'echo  [2/5] Downloading iSell Protect...',
    `if exist "${W}isell.apk" del /q "${W}isell.apk"`, `curl -f -L -s -S -o "${W}isell.apk" "%APKURL%"`, 'if errorlevel 1 goto netfail',
    'if "%APKSHA%"=="" goto apkok',
    `certutil -hashfile "${W}isell.apk" SHA256 | findstr /R /X "[0-9a-fA-F ]*" > "${W}hash.txt"`,
    'set "HASH="', `set /p HASH=<"${W}hash.txt"`, 'if not defined HASH goto apkok', 'set "HASH=%HASH: =%"', 'if /I not "%HASH%"=="%APKSHA%" goto badfile',
    ':apkok', 'echo  [2/5] App downloaded and checked.',
    ':waitphone', 'echo  [3/5] Looking for the phone on the USB cable...', '"%ADB%" start-server >nul 2>&1',
    'set "STATE="', `"%ADB%" get-state > "${W}state.txt" 2>&1`, `set /p STATE=<"${W}state.txt"`,
    'if /I "%STATE%"=="device" goto gotphone',
    `findstr /I "unauthorized" "${W}state.txt" >nul && goto unauth`, `findstr /I /C:"more than one" "${W}state.txt" >nul && goto many`,
    'echo.', 'echo  Phone NOT found. Check the DATA cable, try another USB port, and that USB debugging is ON.',
    'echo  Samsung phones may need the Samsung USB driver: https://developer.samsung.com/android-usb-driver',
    'echo  Fix it, then press any key to try again.', 'pause >nul', 'goto waitphone',
    ':unauth', 'echo.', 'echo  Unlock the phone, tick "Always allow from this computer" and tap ALLOW, then press any key.', 'pause >nul', 'goto waitphone',
    ':many', 'echo.', 'echo  More than one phone is plugged in. Unplug the others, then press any key.', 'pause >nul', 'goto waitphone',
    ':gotphone', 'set "MODEL=phone"', `"%ADB%" shell getprop ro.product.model > "${W}model.txt" 2>nul`, `set /p MODEL=<"${W}model.txt"`, 'echo  [3/5] Found: %MODEL%',
    'echo  [4/5] Installing iSell Protect...', 'echo        If the phone shows a Play Protect box, tap More details, then Install anyway.',
    `"%ADB%" install -r -g "${W}isell.apk" > "${W}install.txt" 2>&1`, `findstr /C:"Success" "${W}install.txt" >nul || goto installfail`,
    'echo  [4/5] App installed.', 'echo  [5/5] Giving iSell Protect control of the phone...',
    `"%ADB%" shell dpm set-device-owner %ADMIN% > "${W}owner.txt" 2>&1`,
    `findstr /C:"Success" "${W}owner.txt" >nul && goto done`, `findstr /I /C:"already set" "${W}owner.txt" >nul && goto done`,
    `findstr /I /C:"accounts" "${W}owner.txt" >nul && goto accounts`, `findstr /I /C:"several users" /C:"multiple users" "${W}owner.txt" >nul && goto users`,
    `findstr /I /C:"provisioned" "${W}owner.txt" >nul && goto provisioned`,
    `"%ADB%" shell dumpsys device_policy > "${W}dp.txt" 2>&1`, `findstr /C:"${PACKAGE}" "${W}dp.txt" >nul && goto done`, 'goto ownerfail',
    ':done', `"%ADB%" shell am start -n ${PACKAGE}/com.mpdevelopers.lock.MainActivity >nul 2>&1`, 'color 2F', 'echo.',
    'echo  ==================================================', 'echo    DONE - iSell Gadget Protection now protects this phone.', 'echo  ==================================================', 'echo.',
    'echo  Next: back on the dashboard, do step 5 - link the phone to %NAME%.', 'echo  You can unplug the phone.', 'echo.', 'pause', 'exit /b 0',
    ':accounts', 'call :red', 'echo  There is an account on the phone. Remove every account (Settings, Accounts), then run this again.', 'goto showowner',
    ':users', 'call :red', 'echo  The phone has another user or Secure Folder. Remove it or factory-reset, then run this again.', 'goto showowner',
    ':provisioned', 'call :red', 'echo  The phone was already set up. Factory-reset it, skip ALL accounts, then run this again.', 'goto showowner',
    ':ownerfail', 'call :red', 'echo  Could not give iSell Protect control. If the app says Protection: FULL, it worked anyway.', 'echo  If not, take a photo of this window and send it to iSell.',
    ':showowner', 'echo.', 'echo  Details:', `type "${W}owner.txt"`, 'goto fail',
    ':installfail', 'call :red', 'echo  The app did not install.', `findstr /I "INCOMPATIBLE" "${W}install.txt" >nul && echo  An older test version is on the phone. Factory-reset it, then run this again.`, 'echo.', 'echo  Details:', `type "${W}install.txt"`, 'goto fail',
    ':badfile', 'call :red', 'echo  The app file did not download correctly. Check the internet and run this again.', 'goto fail',
    ':netfail', 'call :red', 'echo  Download failed. Check the internet connection and run this again.', 'goto fail',
    ':toolfail', 'call :red', 'echo  Could not unpack the Android tools. Run this installer again.', 'goto fail',
    ':oldwindows', 'call :red', 'echo  This computer needs Windows 10 or newer.', 'goto fail',
    ':red', 'color 4F', 'echo.', 'echo  ==================================================', 'echo    PROBLEM', 'echo  ==================================================', 'exit /b 0',
    ':fail', 'echo.', 'pause', 'exit /b 1',
  ];
  return L.join('\r\n') + '\r\n';
}

/* ---------- Dot ---------- */
const dot = { log: [], open: false };
$('dotBtn').innerHTML = window.dotHead();
$('dotAv').innerHTML = window.dotHead();
function dotMsg(cls, html) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; $('dotLog').appendChild(d); $('dotLog').scrollTop = 1e9; return d; }
function dotWelcome() {
  $('dotLog').innerHTML = '';
  const hi = isTeam() ? `Hi! I'm Dot. Ask me things like “which phones are locked?”, “where is Mary's phone?”, or “who owes us money?”.`
    : `Hi! I'm Dot. Ask me about ${esc(me.company.name)}'s phones — “where is John's phone?”, “lock Mary's phone”, or “what do we owe iSell?”.`;
  dotMsg('dot', `<div class="hello"><div class="fig">${window.dotHTML('hello')}</div><div>${hi}${me.ai ? '' : '<br><br><i>I\'m not switched on yet — iSell needs to add the AI key.</i>'}</div></div>`);
}
$('dotBtn').onclick = () => { $('dotPanel').hidden = !$('dotPanel').hidden; if (!$('dotPanel').hidden) $('dotIn').focus(); };
$('dotClose').onclick = () => { $('dotPanel').hidden = true; };
$('dotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('dotIn').value.trim().slice(0, 1500);
  if (!text || $('dotForm').dataset.busy) return;
  $('dotForm').dataset.busy = '1'; $('dotIn').value = '';
  dotMsg('me', esc(text));
  dot.log.push({ role: 'user', content: text });
  const wait = dotMsg('dot', `<div class="hello"><div class="fig" style="width:40px">${window.dotHTML('thinking')}</div><i>Dot is thinking…</i></div>`);
  try {
    const j = await api('POST', '/api/dot', { messages: dot.log.slice(-16) });
    wait.textContent = j.reply;
    dot.log.push({ role: 'assistant', content: j.reply });
    for (const a of j.actions || []) {
      const box = dotMsg('act', `<div>${esc(a.label)}${a.message ? `<br><small>Message: “${esc(a.message)}”</small>` : ''}</div><div class="acts"><button class="primary" type="button">Confirm</button><button class="ghost" type="button">Cancel</button></div>`);
      const [ok, no] = box.querySelectorAll('button');
      no.onclick = () => { box.innerHTML = '<i>Cancelled.</i>'; };
      ok.onclick = async () => {
        ok.disabled = true; no.disabled = true;
        const d = devices.find((x) => x.id === a.phoneId) || { id: a.phoneId, employee: 'the', companyName: '' };
        try {
          if (a.action === 'release') {
            if (!await ask({ title: 'Release this phone?', text: `${d.employee}'s phone stops being protected for good.`, confirmOnly: true, okLabel: 'Release' })) { box.innerHTML = '<i>Cancelled.</i>'; return; }
            await api('POST', `/api/devices/${a.phoneId}/release`, {});
          } else if (a.action === 'lock') await api('POST', `/api/devices/${a.phoneId}/lock`, { message: a.message || '' });
          else await api('POST', `/api/devices/${a.phoneId}/${a.action}`, {});
          box.innerHTML = `<div class="hello"><div class="fig" style="width:48px">${window.dotHTML('paid')}</div>Done — it happens at the phone's next check-in.</div>`;
          loadDevices();
        } catch (err) { box.innerHTML = `<div class="hello"><div class="fig" style="width:40px">${window.dotHTML('oops')}</div>${esc(err.message)}</div>`; }
      };
    }
  } catch (err) {
    dot.log.pop();
    wait.innerHTML = `<div class="hello"><div class="fig" style="width:40px">${window.dotHTML('oops')}</div>${esc(err.message)}</div>`;
  } finally { delete $('dotForm').dataset.busy; $('dotLog').scrollTop = 1e9; }
});

/* ---------- start ---------- */
async function start() {
  $('auth').hidden = true; $('loading').hidden = false; $('app').hidden = true;
  try {
    me = await api('GET', '/api/me');
    $('who').innerHTML = `${esc(me.email)}<br>${me.team ? 'iSell ' + esc(me.role) : esc(me.company.name)}`;
    $('hdrSub').textContent = (me.team ? 'iSell team' : me.company.name) + ' ·';
    $('pausedBanner').hidden = !paused();
    $('addPhonePanel').hidden = !isTeam(); $('addCompanyPanel').hidden = !isAdmin();
    $('fCompany').hidden = !isTeam();
    if (isTeam()) fillSettings();
    tab = 'phones'; renderTabs();
    $('loading').hidden = true; $('app').hidden = false;
    $('dotBtn').hidden = false; dotWelcome();
    await Promise.all([loadCompanies(true), loadDevices(), loadOwnBill()]);
    setInterval(loadDevices, 30000);
  } catch (e) {
    $('loading').hidden = true;
    showAuth();
    if (!/log in/i.test(e.message)) { $('aErr').textContent = e.message; await sb.auth.signOut(); }
  }
}
(async () => { const { data } = await sb.auth.getSession(); if (data.session) start(); else showAuth(); })();
