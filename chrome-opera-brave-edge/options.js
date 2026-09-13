const DEFAULTS = { labelBg: '#ffcccc', labelText: 'BOT' };

const bgInput = document.getElementById('labelBg');
const textInput = document.getElementById('labelText');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const preview = document.getElementById('preview');
const previewFlag = document.getElementById('previewFlag');
const listBox = document.getElementById('listBox');
const refreshBtn = document.getElementById('refreshList');
const listMsg = document.getElementById('listMsg');

// Isti validator kao u content.js - prihvata samo #rrggbb
function isValidHex(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function currentValues() {
  const bg = isValidHex(bgInput.value) ? bgInput.value : DEFAULTS.labelBg;
  const text = (textInput.value || '').trim().slice(0, 30) || DEFAULTS.labelText;
  return { labelBg: bg, labelText: text };
}

// --- Pregled uzivo (ne cuva nista, samo prikazuje) ---
function updatePreview() {
  const { labelBg, labelText } = currentValues();
  preview.style.backgroundColor = labelBg;
  previewFlag.textContent = ' ' + labelText;
}

function flashSaved() {
  statusEl.classList.add('show');
  setTimeout(() => statusEl.classList.remove('show'), 1800);
}

// --- Ucitavanje trenutnih podesavanja ---
chrome.storage.sync.get(['labelBg', 'labelText']).then((stored) => {
  bgInput.value = isValidHex(stored.labelBg) ? stored.labelBg : DEFAULTS.labelBg;
  textInput.value = (stored.labelText || DEFAULTS.labelText).trim();
  updatePreview();
}).catch(() => {
  bgInput.value = DEFAULTS.labelBg;
  textInput.value = DEFAULTS.labelText;
  updatePreview();
});

// --- Cuvanje ---
function save() {
  const { labelBg, labelText } = currentValues();
  return chrome.storage.sync.set({ labelBg, labelText }).then(() => {
    flashSaved();
  }).catch(() => {
    statusEl.textContent = 'Greška pri čuvanju';
    statusEl.style.color = '#b3261e';
    statusEl.classList.add('show');
    setTimeout(() => {
      statusEl.classList.remove('show');
      statusEl.textContent = 'Sačuvano ✓';
      statusEl.style.color = '#1b7f2e';
    }, 2500);
  });
}

saveBtn.addEventListener('click', save);

// Automatsko cuvanje kad se promeni boja (color picker salje 'change' kad se
// zatvori) ili kad se napusti polje teksta. Tako korisnik ne mora da klikne.
bgInput.addEventListener('change', () => { updatePreview(); save(); });
textInput.addEventListener('input', updatePreview);
textInput.addEventListener('change', save);

// --- Status liste ---
function fmt(ts) {
  if (!ts) return 'nikad';
  return new Date(ts).toLocaleString('sr-RS');
}

function renderStatus(s) {
  if (!s || !s.ok) {
    listBox.textContent = 'Status nije dostupan.';
    return;
  }

  const lines = [];
  const src = s.source;
  const srcLabel = (src === 'github') ? '<b>GitHub</b> (aktuelna)' :
    (src === 'github-cached') ? '<b>GitHub</b> (kesirana - poslednja provera nije uspela)' :
    '<b>ugrađena</b> lista iz ekstenzije';
  if (s.botCount) {
    lines.push('<span class="k">Naloga u bazi:</span> <b>' + s.botCount + '</b>');
    lines.push('<span class="k">Izuzetaka (whitelist):</span> <b>' + (s.whitelistCount || 0) + '</b>');
    lines.push('<span class="k">Poslednja provera:</span> ' + fmt(s.checkedAt));
    lines.push('<span class="k">Poslednja promena:</span> ' + fmt(s.updatedAt));
    lines.push('<span class="k">Izvor:</span> ' + srcLabel);
  } else {
    lines.push('<span class="k">Lista:</span> koristi se ' + srcLabel);
    lines.push('<span class="k">Poslednja provera:</span> ' + fmt(s.checkedAt));
  }
  if (s.status) lines.push('<span class="k">Status:</span> ' + s.status);

  listBox.innerHTML = lines.join('<br>');
  listBox.classList.toggle('warn', !s.botCount);
}

function loadStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
      if (chrome.runtime.lastError) {
        listBox.textContent = 'Pozadinski proces nije dostupan.';
        return;
      }
      renderStatus(res);
    });
  } catch (e) {
    listBox.textContent = 'Pozadinski proces nije dostupan.';
  }
}

refreshBtn.addEventListener('click', () => {
  refreshBtn.disabled = true;
  listMsg.textContent = 'Proveravam…';
  try {
    chrome.runtime.sendMessage({ type: 'refreshNow' }, () => {
      refreshBtn.disabled = false;
      if (chrome.runtime.lastError) {
        listMsg.textContent = 'Greška: ' + chrome.runtime.lastError.message;
        return;
      }
      listMsg.textContent = 'Provera završena.';
      setTimeout(() => { listMsg.textContent = ''; }, 3000);
      loadStatus();
    });
  } catch (e) {
    refreshBtn.disabled = false;
    listMsg.textContent = 'Greška pri proveri.';
  }
});

loadStatus();
