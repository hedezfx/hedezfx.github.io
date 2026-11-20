/* M&P Lock dashboard — Supabase login + the mplock edge function. */
'use strict';

const CFG = window.MPLOCK_CONFIG;
const FN = CFG.SUPABASE_URL + '/functions/v1/mplock';
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

let devices = [], selected = null, filter = 'all', me = null, signupMode = false;

/* ---------- helpers ---------- */
const money = (n) => 'K' + (Number(n) || 0).toLocaleString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isPaid = (d) => d.price > 0 && d.paid >= d.price;
const kind = (d) => (d.status === 'released' ? 'released' : isPaid(d) ? 'paid' : d.status);
function ago(t) {
  if (!t) return 'never checked in';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'checked in just now';
  if (m < 60) return `checked in ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `checked in ${h} h ago`;
  return `checked in ${Math.round(h / 24)} days ago`;
}
const fdate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : null;
}
async function api(method, path, body) {
  const t = await token();
  const r = await fetch(FN + path, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + (t || '') }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { await showAuth(); throw new Error(j.error || 'Please log in.'); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
function banner(msg, ok) {
  const b = $('banner'); b.hidden = !msg; b.textContent = msg || ''; b.className = 'banner ' + (ok ? 'ok' : 'err');
}

/* ---------- login ---------- */
function showAuth() { $('loading').hidden = true; $('app').hidden = true; $('auth').hidden = false; }
$('authSwitch').onclick = () => {
  signupMode = !signupMode;
  $('authTitle').textContent = signupMode ? 'Create owner account' : 'Log in';
  $('authText').textContent = signupMode ? 'The first account becomes the shop owner. No one else can sign up after.' : 'Shop owner login.';
  $('authBtn').textContent = signupMode ? 'Create account' : 'Log in';
  $('authSwitch').textContent = signupMode ? 'Already have an account? Log in' : 'First time here? Create the owner account';
  $('aErr').textContent = '';
};
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('aErr'); err.className = 'aerr'; err.textContent = '';
  const email = $('aEmail').value.trim(), password = $('aPass').value;
  try {
    if (signupMode) {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      const { data } = await sb.auth.getSession();
      if (!data.session) { err.className = 'aerr aok'; err.textContent = 'Account made. Check your email to confirm, then log in.'; return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await start();
  } catch (ex) { err.textContent = ex.message || 'Could not sign in.'; }
});
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- dialogs ---------- */
let askResolve = null;
function ask({ title, text, value, multiline, number, confirmOnly, okLabel, html }) {
  $('askTitle').textContent = title;
  $('askText').textContent = text || '';
  const f = $('askField'); f.innerHTML = html || '';
  let input = null;
  if (!confirmOnly && !html) {
    input = document.createElement(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = 3;
    if (number) { input.type = 'number'; input.min = '0'; }
    input.value = value == null ? '' : value;
    f.appendChild(input);
  }
  $('askOk').textContent = okLabel || 'OK';
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

/* ---------- data ---------- */
async function refresh() {
  try { devices = (await api('GET', '/api/devices')).devices; banner(''); render(); }
  catch (e) { banner('Cannot load phones: ' + e.message); }
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.autoLock = e.target.autoLock.checked;
  try {
    const j = await api('POST', '/api/devices', body);
    e.target.reset();
    $('addForm').graceDays.value = me.graceDays;
    $('addForm').shopPhone.value = me.shopPhone || '';
    selected = j.device.id;
    await refresh();
    openUsbSetup(j.device.id, j.device.name);
  } catch (err) { banner(err.message); }
});

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

/* ---------- settings + app upload ---------- */
$('saveSet').onclick = async () => {
  try {
    const frp = $('setFrp').value.replace(/\s+/g, '');
    if (frp && !/^[0-9]{6,30}$/.test(frp)) { banner('The Google account ID is a long number, not the email address. See the guide.'); return; }
    await api('POST', '/api/settings', { shopPhone: $('setPhone').value, graceDays: Number($('setGrace').value), lateGraceDays: Number($('setLate').value), frpAccount: frp });
    me.shopPhone = $('setPhone').value; me.graceDays = Number($('setGrace').value);
    me.lateGraceDays = Number($('setLate').value); me.frpAccount = frp;
    banner('Settings saved.', true);
  } catch (e) { banner(e.message); }
};
$('upApk').onclick = async () => {
  const file = $('apkFile').files[0];
  if (!file) { banner('Choose the app file first.'); return; }
  try {
    banner('Uploading app…', true);
    let apk = file, name = file.name;
    // If they picked the GitHub zip, pull the APK out of it in the browser.
    if (/\.zip$/i.test(name) || file.type === 'application/zip') {
      apk = await apkFromZip(file);
      name = 'app-debug.apk';
    }
    const up = await api('POST', '/api/app/upload-url', {});
    const put = await sb.storage.from('mplock-app').uploadToSignedUrl(up.path, up.token, apk, { contentType: 'application/vnd.android.package-archive' });
    if (put.error) throw new Error(put.error.message);
    const fin = await api('POST', '/api/app/finalize', { path: up.path });
    me.app = { uploadedAt: Date.now(), size: fin.size };
    $('apkFile').value = '';
    banner('App uploaded. QR setup is ready.', true);
    renderAppState();
  } catch (e) { banner('Upload failed: ' + e.message); }
};
// Minimal ZIP reader: find app-debug.apk (stored or deflated) inside the GitHub zip.
async function apkFromZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file.');
  let n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const fl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const nm = new TextDecoder().decode(buf.slice(off + 46, off + 46 + fl));
    if (/\.apk$/i.test(nm)) {
      const lfl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
      const data = buf.slice(lho + 30 + lfl + lel, lho + 30 + lfl + lel + csize);
      const bytes = method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      return new Blob([bytes], { type: 'application/vnd.android.package-archive' });
    }
    off += 46 + fl + el + cl;
  }
  throw new Error('No .apk inside that zip.');
}
function renderAppState() {
  $('appState').textContent = me.app ? `app ready (${(me.app.size / 1048576).toFixed(1)} MB)` : 'no app uploaded yet — phone setup needs it';
}

/* ---------- render ---------- */
function renderStats() {
  const live = devices.filter((d) => d.status !== 'released');
  const on = live.filter((d) => !isPaid(d));
  const locked = devices.filter((d) => d.status === 'locked');
  const paid = devices.filter((d) => isPaid(d) || d.status === 'released');
  const owed = on.reduce((s, d) => s + Math.max(0, d.price - d.paid), 0);
  $('sOn').textContent = on.length;
  $('sLock').textContent = locked.length;
  $('sPaid').textContent = paid.length;
  $('sOwed').textContent = money(owed);
  $('sAll').textContent = `from ${on.length} phone${on.length === 1 ? '' : 's'} on lay-by`;
}
function shown(d) {
  if (filter === 'all') return true;
  if (filter === 'layby') return d.status !== 'released' && !isPaid(d);
  if (filter === 'locked') return d.status === 'locked';
  if (filter === 'paid') return isPaid(d) || d.status === 'released';
  return true;
}
function render() {
  renderStats();
  const list = $('list');
  $('count').textContent = devices.length ? `(${devices.length})` : '';
  const rows = devices.filter(shown);
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${devices.length ? 'No phones in this view.' : 'No phones yet. Add one above.'}</div>`;
    renderPreview(); return;
  }
  list.innerHTML = '';
  for (const d of rows) {
    const owed = Math.max(0, d.price - d.paid);
    const pct = d.price ? Math.min(100, Math.round((d.paid / d.price) * 100)) : 0;
    const k = kind(d);
    const stale = d.status !== 'released' && d.lastSeen && Date.now() - d.lastSeen > d.graceDays * 86400000;
    const el = document.createElement('div');
    el.className = 'card' + (d.id === selected ? ' sel' : '');
    el.onclick = (ev) => { if (!ev.target.closest('button')) { selected = d.id; render(); } };
    let main = '';
    if (d.status === 'locked') main = `<button class="unlockb" data-a="unlock" data-id="${d.id}">Unlock</button>`;
    else if (d.status !== 'released' && !isPaid(d)) main = `<button class="lockb" data-a="lock" data-id="${d.id}">Lock</button>`;
    el.innerHTML = `
      <div class="top"><div><div class="nm">${esc(d.name)}</div>
        <div class="mt">${esc(d.model || '—')} · ${esc(d.phone || 'no number')}${d.imei ? ' · IMEI ' + esc(d.imei) : ''}</div>
        <div class="seen${stale ? ' stale' : ''}">${ago(d.lastSeen)}${stale ? ' — offline too long, will self-lock' : ''}</div></div>
        <span class="badge ${k}">${k === 'paid' ? 'paid off' : k}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="fig"><span>Paid <b>${money(d.paid)}</b> of ${money(d.price)}</span><span>Owing <b>${money(owed)}</b></span></div>
      ${dueLine(d)}
      <div class="acts">
        ${main}
        ${d.status !== 'released' ? `<button class="ghost" data-a="pay" data-id="${d.id}">Record payment</button>` : ''}
        ${isPaid(d) && d.status !== 'released' ? `<button class="relb" data-a="release" data-id="${d.id}">Release</button>` : ''}
        ${d.status !== 'released' && !isPaid(d) ? `<button class="ghost" data-a="plan" data-id="${d.id}">Plan</button>` : ''}
        <button class="ghost" data-a="hist" data-id="${d.id}">Payments</button>
        ${d.status !== 'released' ? `<button class="ghost" data-a="usb" data-id="${d.id}">USB setup</button>` : ''}
        ${d.status !== 'released' ? `<button class="ghost" data-a="setup" data-id="${d.id}">QR setup</button>` : ''}
        ${d.status !== 'released' ? `<button class="ghost" data-a="code" data-id="${d.id}">Code</button>` : ''}
        <button class="ghost" data-a="del" data-id="${d.id}">Delete</button>
      </div>`;
    list.appendChild(el);
  }
  renderPreview();
}

const EVERY = { 7: 'every week', 14: 'every 2 weeks', 30: 'every month' };
function dueLine(d) {
  if (d.status === 'released' || isPaid(d)) return '';
  if (!d.plan) return '<div class="due">No fixed payment plan · lock by hand if needed</div>';
  const p = d.plan, auto = d.autoLock ? 'auto-lock on' : 'auto-lock off';
  if (p.behind > 0) {
    const days = Math.max(0, Math.floor((Date.now() - p.lateSince) / 86400000));
    return `<div class="due late">LATE ${days} day${days === 1 ? '' : 's'} · <b>${money(p.behind)}</b> behind (due ${fdate(p.lateSince)}) · ${auto}</div>`;
  }
  return `<div class="due">Next: <b>${money(p.nextDueAmount)}</b> due <b>${fdate(p.nextDueAt)}</b> · ${money(d.planAmount)} ${EVERY[d.planEveryDays] || ''} · ${auto}</div>`;
}

$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const d = devices.find((x) => x.id === b.dataset.id); if (!d) return;
  selected = d.id;
  try {
    switch (b.dataset.a) {
      case 'lock': {
        const m = await ask({ title: `Lock ${d.name}'s phone`, text: 'Message shown on the locked phone. It locks at the phone\'s next check-in (minutes when online).', value: 'Your payment is overdue. Please visit the shop or call to continue using this phone.', multiline: true, okLabel: 'Lock phone' });
        if (m === null) return;
        await api('POST', `/api/devices/${d.id}/lock`, { message: m });
        break;
      }
      case 'unlock': await api('POST', `/api/devices/${d.id}/unlock`, {}); break;
      case 'pay': {
        const v = await ask({ title: 'Record payment', text: `Amount received from ${d.name} (K). Still owing ${money(Math.max(0, d.price - d.paid))}.`, value: '', number: true, okLabel: 'Save payment' });
        if (v === null) return;
        await api('POST', `/api/devices/${d.id}/payment`, { amount: Number(v) });
        break;
      }
      case 'plan': {
        const opt = (v, t) => `<option value="${v}"${Number(d.planEveryDays) === v ? ' selected' : ''}>${t}</option>`;
        const ok = await ask({
          title: `Payment plan — ${d.name}`,
          text: `Owing ${money(Math.max(0, d.price - d.paid))}. A late payment locks the phone by itself and it unlocks by itself once the payment is recorded.`,
          html: `<div class="pf">
            <label>Installment (K)<input id="pfAmt" type="number" min="0" value="${d.planAmount || ''}"></label>
            <label>Pay every<select id="pfEvery">${opt(7, 'Week')}${opt(14, '2 weeks')}${opt(30, 'Month (30 days)')}${opt(0, 'No fixed plan')}</select></label>
            <label class="chk"><input id="pfAuto" type="checkbox"${d.autoLock ? ' checked' : ''}> Lock automatically when late</label></div>`,
          okLabel: 'Save plan',
        });
        if (!ok) return;
        await api('POST', `/api/devices/${d.id}/plan`, { planAmount: Number($('pfAmt').value), planEveryDays: Number($('pfEvery').value), autoLock: $('pfAuto').checked });
        break;
      }
      case 'release': {
        const ok = await ask({ title: 'Release this phone?', text: `${d.name} has paid in full. Releasing keeps the phone unlocked for good and turns the USB block off at its next check-in.`, confirmOnly: true, okLabel: 'Release' });
        if (!ok) return;
        await api('POST', `/api/devices/${d.id}/release`, {});
        break;
      }
      case 'hist': {
        const rows = (d.payments || []).slice().reverse().map((p) => `<div><span>${fdate(p.at)}${p.note ? ' · ' + esc(p.note) : ''}</span><b>${money(p.amount)}</b></div>`).join('') || '<div>No payments yet.</div>';
        await ask({ title: `Payments — ${d.name}`, text: `Paid ${money(d.paid)} of ${money(d.price)}.`, html: `<div class="hist">${rows}</div>`, okLabel: 'Close' });
        return;
      }
      case 'setup': openSetupQR(d.id, d.name); return;
      case 'usb': openUsbSetup(d.id, d.name); return;
      case 'code': {
        const j = await api('GET', `/api/devices/${d.id}/enroll`);
        openCodeQR(j.code);
        return;
      }
      case 'del': {
        const ok = await ask({ title: 'Delete this record?', text: 'Unlock or release the phone first. A deleted phone can no longer check in and will lock itself when its offline days run out. This cannot be undone.', confirmOnly: true, okLabel: 'Delete' });
        if (!ok) return;
        await api('DELETE', `/api/devices/${d.id}`, {});
        selected = null;
        break;
      }
    }
    await refresh();
  } catch (err) { banner(err.message); }
});

const SHIELD = '<svg viewBox="-8 -8 114 140" aria-hidden="true"><path d="M49,0 L98,18 L98,61 C98,93 76.5,114 49,124 C21.5,114 0,93 0,61 L0,18 Z" fill="#1C54F2" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M28,44 L46.5,60 L28,76 M54,77 L72.5,77" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function clock() { const n = new Date(); return n.getHours().toString().padStart(2, '0') + ':' + n.getMinutes().toString().padStart(2, '0'); }
function renderPreview() {
  const d = devices.find((x) => x.id === selected), scr = $('screen'), nm = $('pvName'), hint = $('pvHint');
  if (!d) {
    nm.textContent = 'select a phone'; scr.className = 'scr home';
    scr.innerHTML = `<div class="clock">${clock()}</div><div class="date">Tap a phone to preview</div><div class="apps">${'<i></i>'.repeat(8)}</div>`;
    hint.textContent = 'What the customer sees on their phone.'; return;
  }
  nm.textContent = d.name;
  if (d.status === 'locked') {
    scr.className = 'scr lock';
    scr.innerHTML = `${SHIELD}<div class="lt">Phone locked</div>
      <div class="lm">${esc(d.lockMessage || 'This phone is on a payment plan. A payment is due. Please visit the shop or call to continue using it.')}</div>
      <div class="pb"><button class="unlockb">I have paid — check now</button><button style="background:#fff;color:#07193D">Call the shop</button><button style="background:#12306B;color:#fff">Emergency call</button></div>
      <div class="by">Secured by M&amp;P Developers</div>`;
    hint.textContent = 'Locked: Back and Home are disabled on the real phone.';
  } else {
    scr.className = 'scr home';
    scr.innerHTML = `<div class="clock">${clock()}</div><div class="date">${new Date().toDateString()}</div><div class="apps">${'<i></i>'.repeat(8)}</div>`;
    hint.textContent = d.status === 'released' ? 'Released: paid in full, stays unlocked.' : 'Active: the phone works normally.';
  }
}

/* ---------- QR codes ---------- */
function drawQR(boxId, text, size) {
  const box = $(boxId); box.innerHTML = '';
  const c = document.createElement('canvas'); box.appendChild(c);
  if (window.QRCode && QRCode.toCanvas) QRCode.toCanvas(c, text, { width: size || 220, margin: 2, color: { dark: '#07193D' } }, (err) => { if (err) box.innerHTML = '<p>Could not draw QR.</p>'; });
}
async function openSetupQR(id, name) {
  if (!me.app) { banner('Upload the M&P Lock app file in Shop settings first, then phone setup will work.'); $('setPhone').scrollIntoView({ behavior: 'smooth' }); return; }
  try {
    const j = await api('GET', `/api/devices/${id}/setup-qr`);
    $('setupName').textContent = name;
    drawQR('setupBox', j.qr, 300);
    $('setupModal').classList.add('open');
  } catch (e) { banner(e.message); }
}
let lastCode = '';
function openCodeQR(code) {
  lastCode = code;
  $('qrtext').textContent = code;
  drawQR('qrbox', code, 210);
  $('copyBtn').textContent = 'Copy code';
  $('qrModal').classList.add('open');
}
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(lastCode); $('copyBtn').textContent = 'Copied'; }
  catch { $('copyBtn').textContent = 'Select the code and copy it'; }
};

/* ---------- USB setup (Windows installer) ---------- */
const ADMIN = 'com.mpdevelopers.lock/.AdminReceiver';
let usb = null; // { id, name, url, hex, code }
function b64urlToHex(b) {
  let t = String(b || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return [...atob(t)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
async function openUsbSetup(id, name) {
  if (!me.app) { banner('Upload the M&P Lock app file in Shop settings first, then phone setup will work.'); $('setPhone').scrollIntoView({ behavior: 'smooth' }); return; }
  try {
    const [q, e] = await Promise.all([api('GET', `/api/devices/${id}/setup-qr`), api('GET', `/api/devices/${id}/enroll`)]);
    const qr = JSON.parse(q.qr);
    usb = {
      id, name,
      url: qr['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'],
      hex: b64urlToHex(qr['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM']),
      code: e.code,
    };
    $('usbName').textContent = name; $('usbName2').textContent = name;
    drawQR('usbQR', usb.code, 190);
    $('usbCopy').textContent = 'Copy code';
    $('usbModal').scrollTop = 0; $('usbModal').querySelector('.box').scrollTop = 0;
    $('usbModal').classList.add('open');
  } catch (err) { banner(err.message); }
}
$('usbCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(usb.code); $('usbCopy').textContent = 'Copied'; }
  catch { $('usbCopy').textContent = 'Could not copy'; }
};
$('usbToQR').onclick = () => { $('usbModal').classList.remove('open'); if (usb) openSetupQR(usb.id, usb.name); };
$('usbDl').onclick = () => {
  if (!usb) return;
  const safe = usb.name.replace(/[^A-Za-z0-9 .'-]/g, '').trim().slice(0, 40) || 'customer';
  const bat = installerBat(safe, usb.url, usb.hex);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bat], { type: 'application/octet-stream' }));
  a.download = 'MP-Lock-setup-' + (safe.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'phone') + '.bat';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
// Windows batch file: downloads platform-tools + the app, checks it, installs, makes it Device Owner.
function installerBat(name, url, hex) {
  if (!/^https:\/\/[A-Za-z0-9.\/_-]+$/.test(url)) throw new Error('Unexpected app address.');
  if (!/^[0-9a-f]{64}$/.test(hex)) hex = '';
  const L = [
    '@echo off',
    'setlocal EnableExtensions',
    'title M^&P Lock - USB phone setup',
    'color 1F',
    'set "NAME=' + name + '"',
    'set "APKURL=' + url + '"',
    'set "APKSHA=' + hex + '"',
    'set "ADMIN=' + ADMIN + '"',
    'set "WORK=%LOCALAPPDATA%\\MPLock"',
    'if not exist "%WORK%" mkdir "%WORK%"',
    'echo.',
    'echo  ==================================================',
    'echo    M^&P Lock - USB phone setup',
    'echo    Customer: %NAME%',
    'echo  ==================================================',
    'echo.',
    'where curl >nul 2>&1 || goto oldwindows',
    'set "ADB="',
    'if exist "C:\\platform-tools\\adb.exe" set "ADB=C:\\platform-tools\\adb.exe"',
    'if exist "%WORK%\\platform-tools\\adb.exe" set "ADB=%WORK%\\platform-tools\\adb.exe"',
    'if defined ADB goto haveadb',
    'echo  [1/5] Downloading the Android tools from Google - first time only...',
    'curl -f -L -s -S -o "%WORK%\\pt.zip" "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"',
    'if errorlevel 1 goto netfail',
    'tar -xf "%WORK%\\pt.zip" -C "%WORK%"',
    'if not exist "%WORK%\\platform-tools\\adb.exe" goto toolfail',
    'set "ADB=%WORK%\\platform-tools\\adb.exe"',
    ':haveadb',
    'echo  [1/5] Android tools ready.',
    'echo  [2/5] Downloading the M^&P Lock app...',
    'if exist "%WORK%\\mplock.apk" del /q "%WORK%\\mplock.apk"',
    'curl -f -L -s -S -o "%WORK%\\mplock.apk" "%APKURL%"',
    'if errorlevel 1 goto netfail',
    'if "%APKSHA%"=="" goto apkok',
    'certutil -hashfile "%WORK%\\mplock.apk" SHA256 | findstr /R /X "[0-9a-fA-F ]*" > "%WORK%\\hash.txt"',
    'set "HASH="',
    'set /p HASH=<"%WORK%\\hash.txt"',
    'if not defined HASH goto apkok',
    'set "HASH=%HASH: =%"',
    'if /I not "%HASH%"=="%APKSHA%" goto badfile',
    ':apkok',
    'echo  [2/5] App downloaded and checked.',
    ':waitphone',
    'echo  [3/5] Looking for the phone on the USB cable...',
    '"%ADB%" start-server >nul 2>&1',
    'set "STATE="',
    '"%ADB%" get-state > "%WORK%\\state.txt" 2>&1',
    'set /p STATE=<"%WORK%\\state.txt"',
    'if /I "%STATE%"=="device" goto gotphone',
    'findstr /I "unauthorized" "%WORK%\\state.txt" >nul && goto unauth',
    'findstr /I /C:"more than one" "%WORK%\\state.txt" >nul && goto many',
    'echo.',
    'echo  Phone NOT found. Check these:',
    'echo    - The phone is plugged in with a DATA cable. Try another cable or USB port.',
    'echo    - USB debugging is ON: Settings, Developer options, USB debugging.',
    'echo    - Samsung phones may need the Samsung USB driver:',
    'echo      https://developer.samsung.com/android-usb-driver',
    'echo.',
    'echo  Fix it, then press any key to try again.',
    'pause >nul',
    'goto waitphone',
    ':unauth',
    'echo.',
    'echo  The phone is asking for permission.',
    'echo  Unlock the phone, tick "Always allow from this computer" and tap ALLOW.',
    'echo  Then press any key here.',
    'pause >nul',
    'goto waitphone',
    ':many',
    'echo.',
    'echo  More than one phone is plugged in. Unplug the others, then press any key.',
    'pause >nul',
    'goto waitphone',
    ':gotphone',
    'set "MODEL=phone"',
    '"%ADB%" shell getprop ro.product.model > "%WORK%\\model.txt" 2>nul',
    'set /p MODEL=<"%WORK%\\model.txt"',
    'echo  [3/5] Found: %MODEL%',
    'echo  [4/5] Installing M^&P Lock on the phone...',
    'echo        If the phone shows a Play Protect box, tap More details, then Install anyway.',
    '"%ADB%" install -r -g "%WORK%\\mplock.apk" > "%WORK%\\install.txt" 2>&1',
    'findstr /C:"Success" "%WORK%\\install.txt" >nul || goto installfail',
    'echo  [4/5] App installed.',
    'echo  [5/5] Giving M^&P Lock control of the phone...',
    '"%ADB%" shell dpm set-device-owner %ADMIN% > "%WORK%\\owner.txt" 2>&1',
    'findstr /C:"Success" "%WORK%\\owner.txt" >nul && goto done',
    'findstr /I /C:"already set" "%WORK%\\owner.txt" >nul && goto done',
    'findstr /I /C:"accounts" "%WORK%\\owner.txt" >nul && goto accounts',
    'findstr /I /C:"several users" /C:"multiple users" "%WORK%\\owner.txt" >nul && goto users',
    'findstr /I /C:"provisioned" "%WORK%\\owner.txt" >nul && goto provisioned',
    '"%ADB%" shell dumpsys device_policy > "%WORK%\\dp.txt" 2>&1',
    'findstr /C:"com.mpdevelopers.lock" "%WORK%\\dp.txt" >nul && goto done',
    'goto ownerfail',
    ':done',
    '"%ADB%" shell am start -n com.mpdevelopers.lock/.MainActivity >nul 2>&1',
    'color 2F',
    'echo.',
    'echo  ==================================================',
    'echo    DONE - M^&P Lock now controls this phone.',
    'echo  ==================================================',
    'echo.',
    'echo  Next: go back to the dashboard and do step 5 -',
    'echo  link the phone to %NAME%.',
    'echo  USB debugging is now switched off on the phone. You can unplug it.',
    'echo.',
    'pause',
    'exit /b 0',
    ':accounts',
    'call :red',
    'echo  There is an account on the phone, so it cannot be set up.',
    'echo  On the phone: Settings, Accounts and backup, Manage accounts -',
    'echo  remove every account. Then run this installer again.',
    'goto showowner',
    ':users',
    'call :red',
    'echo  The phone has another user, Secure Folder or Dual Messenger.',
    'echo  Remove it, or factory-reset the phone and start again. Then run this again.',
    'goto showowner',
    ':provisioned',
    'call :red',
    'echo  The phone was already set up before.',
    'echo  Factory-reset it, go through setup skipping ALL accounts, then run this again.',
    'goto showowner',
    ':ownerfail',
    'call :red',
    'echo  Could not give M^&P Lock control of the phone.',
    'echo  Open M^&P Lock on the phone: if it says Protection: FULL, it worked anyway.',
    'echo  If not, take a photo of this window and send it to M^&P Developers.',
    ':showowner',
    'echo.',
    'echo  Details:',
    'type "%WORK%\\owner.txt"',
    'goto fail',
    ':installfail',
    'call :red',
    'echo  The app did not install.',
    'findstr /I "INCOMPATIBLE" "%WORK%\\install.txt" >nul && echo  An older test version of M^&P Lock is on the phone. Factory-reset the phone, then run this again.',
    'echo.',
    'echo  Details:',
    'type "%WORK%\\install.txt"',
    'goto fail',
    ':badfile',
    'call :red',
    'echo  The app file did not download correctly. Check the internet and run this again.',
    'goto fail',
    ':netfail',
    'call :red',
    'echo  Download failed. Check this computer\'s internet connection and run this again.',
    'goto fail',
    ':toolfail',
    'call :red',
    'echo  Could not unpack the Android tools. Run this installer again.',
    'goto fail',
    ':oldwindows',
    'call :red',
    'echo  This computer needs Windows 10 or newer to run the installer.',
    'goto fail',
    ':red',
    'color 4F',
    'echo.',
    'echo  ==================================================',
    'echo    PROBLEM',
    'echo  ==================================================',
    'exit /b 0',
    ':fail',
    'echo.',
    'pause',
    'exit /b 1',
  ];
  return L.join('\r\n') + '\r\n';
}

/* ---------- start ---------- */
async function start() {
  $('auth').hidden = true; $('loading').hidden = false; $('app').hidden = true;
  try {
    me = await api('GET', '/api/me');
    if (!me.claimed) {
      // First logged-in account becomes the shop owner.
      await api('POST', '/api/claim', {});
      me = await api('GET', '/api/me');
    }
    if (!me.isOwner) {
      $('loading').hidden = true;
      await sb.auth.signOut();
      showAuth();
      $('aErr').textContent = 'This shop already has an owner account. Use that login.';
      return;
    }
    $('who').textContent = me.email;
    $('setPhone').value = me.shopPhone || '';
    $('setGrace').value = me.graceDays;
    $('setLate').value = me.lateGraceDays ?? 1;
    $('setFrp').value = me.frpAccount || '';
    renderAppState();
    $('addForm').graceDays.value = me.graceDays;
    if (me.shopPhone) $('addForm').shopPhone.value = me.shopPhone;
    $('loading').hidden = true; $('app').hidden = false;
    await refresh();
    setInterval(refresh, 30000);
    setInterval(() => { const c = document.querySelector('#screen .clock'); if (c) c.textContent = clock(); }, 10000);
  } catch (e) {
    $('loading').hidden = true;
    if (/log in/i.test(e.message)) showAuth(); else { showAuth(); $('aErr').textContent = e.message; }
  }
}

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) start(); else showAuth();
})();
