// Popup: prikazuje broj naloga u bazi, razliku posle azuriranja i
// omogucava izvoz baze u fajl.
// Firefox verzija - `browser` API vraca Promise-e, pa nema callback-ova.

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const el = (id) => document.getElementById(id);

function fmt(ts) {
  if (!ts) return 'nikad';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'danas u ' + time;
  return d.toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + time;
}

function num(n) {
  return (typeof n === 'number') ? n.toLocaleString('sr-RS') : '–';
}

// Ujednaci oblik razlike. Podrzava i stariji zapis (samo baza) da popup
// ne pukne ako je u browseru ostao podatak od prethodne verzije.
function normDiff(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.bot || d.wl) {
    return {
      at: d.at || null,
      first: !!d.first,
      bot: d.bot || { added: 0, removed: 0 },
      wl: d.wl || { added: 0, removed: 0 }
    };
  }
  if (typeof d.added === 'number') {
    return {
      at: d.at || null,
      first: !!d.first,
      bot: { added: d.whitelistOnly ? 0 : d.added, removed: d.whitelistOnly ? 0 : d.removed },
      wl: { added: 0, removed: 0 }
    };
  }
  return null;
}

function diffRows(list) {
  const parts = [];
  if (list.added) parts.push('<span class="add">+' + num(list.added) + '</span>');
  if (list.removed) parts.push('<span class="rem">−' + num(list.removed) + '</span>');
  return parts.join(' ');
}

function renderDiff(raw, status) {
  const diff = el('diff');
  diff.className = 'diff';

  const d = normDiff(raw);
  if (!d) return;

  const botRow = diffRows(d.bot);
  const wlRow = diffRows(d.wl);

  // Razlika se pamti dok se baza stvarno ne promeni - da korisnik i posle
  // nekoliko praznih provera i dalje vidi "+12 novih". Zato razlikujemo da li
  // je ova razlika od SADA (provera je nasla promenu) ili od ranije.
  const isFromThisCheck = status && status.checkedAt && d.at &&
    Math.abs(status.checkedAt - d.at) < 10000;
  const titleNow = d.first ? 'Baza preuzeta sa GitHub-a' : 'Baza ažurirana sa GitHub-a';
  const titleOld = 'Poslednja promena baze';

  if (d.first) {
    diff.classList.add('show', 'ok');
    const rows = [];
    rows.push('<div class="drow"><span class="dk">Nalozi preuzeti</span><span class="dv"><span class="add">+' + num(d.bot.added) + '</span></span></div>');
    rows.push('<div class="drow"><span class="dk">Izuzeti preuzeti</span><span class="dv"><span class="add">+' + num(d.wl.added) + '</span></span></div>');
    diff.innerHTML = '<div class="dtitle">' + (isFromThisCheck ? titleNow : titleOld) + '</div>' + rows.join('') +
      '<div class="dtime">' + fmt(d.at) + '</div>';
    return;
  }

  if (!botRow && !wlRow) {
    diff.classList.add('show', 'same');
    diff.innerHTML = 'Baza i lista izuzetaka su već bile aktuelne — <b>bez promena</b>.' +
      '<div class="dtime">' + fmt(d.at) + '</div>';
    return;
  }

  const rows = [];
  if (botRow) rows.push('<div class="drow"><span class="dk">Nalozi u bazi</span><span class="dv">' + botRow + '</span></div>');
  if (wlRow) rows.push('<div class="drow"><span class="dk">Izuzeti (whitelist)</span><span class="dv">' + wlRow + '</span></div>');

  diff.classList.add('show', 'ok');
  diff.innerHTML = '<div class="dtitle">' + (isFromThisCheck ? titleNow : titleOld) + '</div>' + rows.join('') +
    '<div class="dtime">' + (isFromThisCheck ? fmt(d.at) : fmt(d.at) + ' — baza je od tada nepromenjena') + '</div>';
}

function render(status) {
  if (!status || !status.ok) {
    el('msg').textContent = 'Status nije dostupan.';
    return;
  }

  el('effective').textContent = num(status.effectiveCount);
  el('botCount').textContent = num(status.botCount);
  el('wlCount').textContent = num(status.whitelistCount);
  el('source').textContent = (status.source === 'github') ? 'GitHub' : 'ugrađena u ekstenziju';
  el('checkedAt').textContent = fmt(status.checkedAt);
  el('updatedAt').textContent = fmt(status.updatedAt);

  let msg = status.status || '';
  if (!status.repoConfigured) {
    msg = 'Repo nije podešen — koristi se ugrađena baza.';
  }
  el('msg').textContent = msg;
  el('msg').style.color = status.isError ? '#b3261e' : '#667085';

  renderDiff(status.diff, status);
}

async function loadStatus() {
  try {
    const res = await api.runtime.sendMessage({ type: 'getStatus' });
    render(res);
  } catch (e) {
    el('msg').textContent = 'Pozadinski proces nije dostupan.';
  }
}

// --- Azuriranje baze ---
el('update').addEventListener('click', async () => {
  const btn = el('update');
  btn.disabled = true;
  btn.textContent = 'Ažuriram…';
  el('msg').textContent = '';
  el('msg').style.color = '#667085';
  el('diff').className = 'diff';

  try {
    const res = await api.runtime.sendMessage({ type: 'refreshNow' });
    if (res && res.ok && res.status) {
      render(res.status);
    } else {
      el('msg').textContent = 'Ažuriranje nije uspelo.';
      el('msg').style.color = '#b3261e';
    }
  } catch (e) {
    el('msg').textContent = 'Greška pri ažuriranju.';
    el('msg').style.color = '#b3261e';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ažuriraj bazu';
  }
});

// --- Izvoz baze u fajl ---
async function exportList(key, filename) {
  el('msg').textContent = 'Pripremam fajl…';
  el('msg').style.color = '#667085';

  try {
    const res = await api.runtime.sendMessage({ type: 'getList', key: key });
    if (!res || !res.ok || !res.text) {
      el('msg').textContent = 'Izvoz nije uspeo.';
      el('msg').style.color = '#b3261e';
      return;
    }
    const blob = new Blob([res.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    el('msg').textContent = 'Sačuvano: ' + filename;
  } catch (e) {
    el('msg').textContent = 'Izvoz nije uspeo.';
    el('msg').style.color = '#b3261e';
  }
}

el('exportBot').addEventListener('click', () => exportList('listBot', 'hash.txt'));
el('exportWl').addEventListener('click', () => exportList('listWhitelist', 'hash_whitelist.txt'));

// --- Podesavanja ---
el('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  if (api.runtime.openOptionsPage) {
    api.runtime.openOptionsPage();
  }
  window.close();
});

loadStatus();
