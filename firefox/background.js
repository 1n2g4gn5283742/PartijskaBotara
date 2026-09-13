// =====================================================================
//  Automatsko povlacenje baze sa GitHub-a + status za popup
// =====================================================================
//  Workflow za azuriranje baze:
//    users.txt  ->  hash_users.bat  ->  git push  ->  ekstenzije same povuku
//
//  Ovaj fajl radi u pozadini (Chrome: service worker, Firefox: event page).
//  Proverava da li se fajlovi na GitHub-u menjaju, pamti ih u storage.local
//  (trajna baza ekstenzije) i racuna razliku: koliko je naloga dodato, a
//  koliko uklonjeno.
//
//  Content script cita bazu iz storage-a, a ako je nema koristi UGRAĐENE
//  fajlove (hash.txt / hash_whitelist.txt) - zato ekstenzija radi i prvi
//  put, i offline, i ako GitHub padne.
// =====================================================================

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

// ==== PODESAVANJA - OVDE UPISI SVOJ REPO ==============================
// Oblik adrese: https://raw.githubusercontent.com/<KORISNIK>/<REPO>/main/
//
// Repo MORA biti javan (public). Za privatne repoe raw adresa vraca 404.
const RAW_BASE = 'https://raw.githubusercontent.com/1n2g4gn5283742/PartijskaBotara/main/';

// Folder u repou u kojem se nalaze hash.txt i hash_whitelist.txt.
// U ovom projektu su u hromovom folderu, pa adresa ispada npr.:
//   .../main/chrome-opera-brave-edge/hash.txt
// Oba foldera imaju IDENTICNE fajlove (pise ih isti .bat), pa je svejedno
// koji se koristi.
const REMOTE_DIR = 'chrome-opera-brave-edge/';

// Ime fajlova. Koristi se i za putanju na GitHub-u (REMOTE_DIR + ime) i za
// UGRAĐENI fajl u ekstenziji (runtime.getURL(ime)) - zato ovde ide samo ime,
// bez foldera.
const FILES = {
  listBot: 'hash.txt',
  listWhitelist: 'hash_whitelist.txt'
};
// =====================================================================

const ALARM_NAME = 'partijskabotara-refresh';
const REFRESH_MINUTES = 360;   // provera svakih 6 sati
const TIMEOUT_MS = 20000;      // prekid ako GitHub ne odgovori

// ---------------------------------------------------------------------
// Pomocne funkcije
// ---------------------------------------------------------------------
function toSet(text) {
  return new Set(String(text || '').split('\n').map(l => l.trim()).filter(Boolean));
}

function countOf(text) {
  return String(text || '').split('\n').filter(l => l.trim()).length;
}

function repoConfigured() {
  return RAW_BASE.indexOf('<KORISNIK>') === -1 && RAW_BASE.indexOf('<REPO>') === -1;
}

// Koliko je naloga dodato / uklonjeno između dve verzije baze.
// Racuna se po hesеvima, pa je tacno i kad se samo deo liste promeni.
function computeDiff(oldText, newText) {
  const a = toSet(oldText);
  const b = toSet(newText);
  let added = 0, removed = 0;
  for (const h of b) if (!a.has(h)) added++;
  for (const h of a) if (!b.has(h)) removed++;
  return { added, removed };
}

// ---------------------------------------------------------------------
// Validacija preuzetog sadrzaja
// ---------------------------------------------------------------------
// Stiti od toga da se u bazu upise smece (HTML stranica greske, captcha
// portal, prazan odgovor). Svaka linija mora biti tacno 64 hex znaka.
function isValidList(text, allowEmpty) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return !!allowEmpty;
  return lines.every(l => /^[0-9a-f]{64}$/.test(l));
}

// ---------------------------------------------------------------------
// Preuzimanje jednog fajla
// ---------------------------------------------------------------------
// cache: 'no-cache' tera browser da posalje uslovni zahtev (If-None-Match),
// pa GitHub vrati "304 Not Modified" ako se fajl nije menjao - tako se
// 860 KB ne skida bez potrebe.
async function fetchText(url, force) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // force=true (rucno azuriranje iz popup-a) zaobilazi i CDN kes
    const res = await fetch(url, {
      cache: force ? 'reload' : 'no-cache',
      signal: controller.signal
    });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) return { error: 'HTTP ' + res.status, reached: true };
    return { text: await res.text() };
  } catch (e) {
    return { error: (e && e.message) ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Glavna funkcija - proveri, preuzmi i UPISI bazu
// ---------------------------------------------------------------------
async function refresh(force) {
  if (!repoConfigured()) {
    await api.storage.local.set({
      listStatus: 'Repo nije podesen (koristi se ugradjena baza)',
      listCheckedAt: Date.now()
    });
    return { ok: false, reason: 'no-repo' };
  }

  const prev = await api.storage.local.get(Object.keys(FILES));

  // Oba fajla se preuzimaju PARALELNO (Promise.allSettled), pa rucno
  // azuriranje u najgorem slucaju ceka jedan timeout (~20 s), a ne dva
  // zaredom (~40 s).
  const results = await Promise.allSettled(
    Object.keys(FILES).map((key) => fetchText(RAW_BASE + REMOTE_DIR + FILES[key], force))
  );

  const updates = {};
  const changed = [];        // kljucevi lista koje su se promenile
  let reached = false;
  const errors = [];

  // Prva faza: SAMO preuzmi i validiraj obe liste - nista se ne upisuje.
  const fetched = {};

  for (let i = 0; i < Object.keys(FILES).length; i++) {
    const key = Object.keys(FILES)[i];
    const file = FILES[key];
    const remotePath = REMOTE_DIR + file;
    const result = (results[i].status === 'fulfilled')
      ? results[i].value
      : { error: String(results[i].reason || 'fetch nije uspeo') };

    if (result.notModified) {
      reached = true;
      continue;                       // fajl je isti - nista ne diramo
    }
    if (result.error) {
      if (result.reached) reached = true;   // server odgovorio, ali greskom
      // U poruci ide puna putanja - da se odmah vidi sta je pogresno
      errors.push(remotePath + ': ' + result.error);
      continue;
    }

    reached = true;
    // Lista izuzetaka sme biti prazna (ispravna baza bez izuzetaka), baza ne sme.
    const allowEmpty = (key === 'listWhitelist');
    if (!isValidList(result.text, allowEmpty)) {
      errors.push(remotePath + ': sadrzaj nije validan');
      continue;
    }

    fetched[key] = result.text;
  }

  // Druga faza: ATOMSKA AKTIVACIJA. Upisuje se SAMO ako su OBE liste u
  // redu (ili 304/nepromenjene). Inace se NE upisuje ni jedna - inace bi
  // npr. nova baza mogla da se aktivira uz STARU whitelistu.
  if (errors.length) {
    // Ne diramo nijednu listu - ostaju stare, konzistentne vrednosti.
  } else {
    for (const key of Object.keys(FILES)) {
      const text = fetched[key];
      if (text === undefined) continue;         // 304 - nepromenjeno
      if (text !== prev[key]) {
        updates[key] = text;                    // UPIS u aktivnu bazu (storage.local)
        changed.push(key);
      }
    }
  }

  const now = Date.now();
  updates.listCheckedAt = now;

  if (changed.length) {
    updates.listUpdatedAt = now;

    // Razlika se racuna ODRVOJENO za svaku listu, pa popup moze da prikaze
    // "+12 novih, -3 uklonjenih" i za bazu i za listu izuzetaka.
    const first = !prev.listBot;      // jos nijednom nije povucena baza
    const nextBot = (updates.listBot !== undefined) ? updates.listBot : (prev.listBot || '');
    const nextWl = (updates.listWhitelist !== undefined) ? updates.listWhitelist : (prev.listWhitelist || '');

    const botDiff = computeDiff(prev.listBot || '', nextBot);
    const wlDiff = computeDiff(prev.listWhitelist || '', nextWl);

    updates.listDiff = {
      at: now,
      first: first,
      // Pri prvom preuzimanju je sve "novo"
      bot: { added: first ? countOf(nextBot) : botDiff.added, removed: first ? 0 : botDiff.removed },
      wl: { added: first ? countOf(nextWl) : wlDiff.added, removed: first ? 0 : wlDiff.removed }
    };
  }

  if (errors.length) {
    updates.listStatus = reached
      ? errors.join(' | ')
      : 'Nema veze sa GitHub-om';
    updates.listError = true;
  } else {
    updates.listError = false;
    if (changed.length) {
      const botCh = changed.indexOf('listBot') !== -1;
      const wlCh = changed.indexOf('listWhitelist') !== -1;
      if (botCh && wlCh) updates.listStatus = 'Baza i lista izuzetaka azurirane sa GitHub-a';
      else if (botCh) updates.listStatus = 'Baza azurirana sa GitHub-a';
      else updates.listStatus = 'Lista izuzetaka azurirana sa GitHub-a';
    } else if (reached) {
      updates.listStatus = 'Baza i lista izuzetaka su vec aktuelne';
    }
  }

  await api.storage.local.set(updates);
  // changedLists govori pozivaocu koje su se liste promenile
  return { ok: true, changed: changed.length > 0, changedLists: changed };
}

// ---------------------------------------------------------------------
// Status za popup i stranicu podesavanja
// ---------------------------------------------------------------------
async function buildStatus() {
  const keys = Object.keys(FILES).concat(['listStatus', 'listCheckedAt', 'listUpdatedAt', 'listDiff', 'listError']);
  const data = await api.storage.local.get(keys);

  let botText = data.listBot;
  let wlText = data.listWhitelist;
  let source;

  if (botText) {
    // Baza postoji u storage-u - doci je sa GitHub-a (svjeza ili kesirana
    // ako je mreza/pad bio problem pri poslednjoj proveri).
    source = data.listError ? 'github-cached' : 'github';
  } else {
    // Baza jos nije povucena - brojimo ugrađene fajlove
    try {
      const r = await fetch(api.runtime.getURL(FILES.listBot));
      botText = await r.text();
      try {
        const r2 = await fetch(api.runtime.getURL(FILES.listWhitelist));
        wlText = await r2.text();
      } catch (e) { wlText = ''; }
    } catch (e) { botText = ''; wlText = ''; }
    source = 'ugradjena';
  }

  const botSet = toSet(botText);
  const wlSet = toSet(wlText);
  let effective = 0;
  for (const h of botSet) if (!wlSet.has(h)) effective++;

  return {
    ok: true,
    // github = aktivna baza je skidneta sa GitHub-a;
    // github-cached = isto, ali poslednja provera nije uspela (stariji kes);
    // ugradjena = storage je prazan, koriste se fajlovi iz ekstenzije.
    source: source,
    repoConfigured: repoConfigured(),
    botCount: botSet.size,
    whitelistCount: wlSet.size,
    // Broj naloga koji se stvarno oznacavaju (baza minus izuzeci)
    effectiveCount: effective,
    status: data.listStatus || null,
    isError: !!data.listError,
    checkedAt: data.listCheckedAt || null,
    updatedAt: data.listUpdatedAt || null,
    diff: data.listDiff || null
  };
}

// ---------------------------------------------------------------------
// Alarm - periodicna provera
// ---------------------------------------------------------------------
function ensureAlarm() {
  try {
    api.alarms.create(ALARM_NAME, {
      periodInMinutes: REFRESH_MINUTES,
      delayInMinutes: 1
    });
  } catch (e) { /* alarms nedostupan - provera ce se desiti na startu */ }
}

api.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refresh(true);
});

api.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refresh(false);
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) refresh(false);
});

// ---------------------------------------------------------------------
// Poruke od popup-a i stranice podesavanja
// ---------------------------------------------------------------------
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'refreshNow') {
    refresh(true)
      .then(() => buildStatus())
      .then(status => sendResponse({ ok: true, status: status }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;   // odgovor stize asinhrono
  }

  if (msg.type === 'getStatus') {
    buildStatus()
      .then(status => sendResponse(status))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // Tekst baze - za izvoz u fajl (hash.txt / hash_whitelist.txt)
  if (msg.type === 'getList') {
    api.storage.local.get([msg.key])
      .then(async (data) => {
        let text = data[msg.key];
        if (!text) {
          // Ako u storage-u nema nicega, vrati ugrađeni fajl
          const file = (msg.key === 'listBot') ? FILES.listBot : FILES.listWhitelist;
          try {
            const r = await fetch(api.runtime.getURL(file));
            text = await r.text();
          } catch (e) { text = ''; }
        }
        sendResponse({ ok: true, text: text || '' });
      })
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
