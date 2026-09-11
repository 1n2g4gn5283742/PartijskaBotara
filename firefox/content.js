// Firefox verzija - ista logika kao chrome-opera-brave-edge/content.js,
// ali preko `browser` API-ja (Firefox podrzava i chrome.*, ali browser.* je
// native i vraca Promise-e).
//
// ⚠️ OVAJ FAJL SE IZVODI IZ chrome-opera-brave-edge/content.js - ne menjaj ga
//    rucno! Ako menjas logiku, menjaj hromovu verziju pa je prenesi ovde
//    (razlike su samo u API pozivima i u toBytes fallback-u ispod).

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

// Nakon reload-a ekstenzije stari content script ostaje u tabu sa mrtvim
// API-jem ("Extension context invalidated") - ovako se tiho ugasi.
function isContextValid() {
  try {
    return !!(api.runtime && api.runtime.id);
  } catch (e) {
    return false;
  }
}

// =====================================================================
//  Podesavanja prikaza (boja i tekst oznake)
// =====================================================================
const DEFAULT_BG = '#ffcccc';
const DEFAULT_TEXT = 'BOT';

let CONFIG = { labelBg: DEFAULT_BG, labelText: DEFAULT_TEXT };

// Marker klasa na elementima koje smo obojili. Sluzi SAMO kao selektor da
// mozemo da ih nadjemo kad se podesavanje promeni - boja ostaje inline stil
// (to je najstabilniji pristup, X pregazi CSS klase na hover).
const COLORED_CLASS = 'bot-colored';

// Prihvata samo ispravan hex zapis (#rrggbb). Stiti od toga da u inline stil
// udje nesto sto nije boja (npr. ako je storage rucno menjan).
function isValidHex(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function sanitizeText(v) {
  if (typeof v !== 'string') return DEFAULT_TEXT;
  const t = v.trim().slice(0, 30);
  return t || DEFAULT_TEXT;
}

async function loadConfig() {
  if (!isContextValid()) return;
  try {
    const stored = await api.storage.sync.get(['labelBg', 'labelText']);
    if (stored) {
      if (isValidHex(stored.labelBg)) CONFIG.labelBg = stored.labelBg;
      if (stored.labelText) CONFIG.labelText = sanitizeText(stored.labelText);
    }
  } catch (e) { /* storage nedostupan - ostaju podrazumevane vrednosti */ }
}

// Primeni trenutna podesavanja na elemente koji su VEC oznaceni.
// Poziva se kad korisnik promeni boju u Podesavanjima - da se vidi odmah,
// bez cekanja na novi post ili osvezavanje stranice.
function applyConfigToExisting() {
  try {
    // 1. Pozadina svih obojenih elemenata
    document.querySelectorAll('.' + COLORED_CLASS).forEach(el => {
      el.style.backgroundColor = CONFIG.labelBg;
    });

    // 2. Tekst svih oznaka (bot-flag je zajednicka klasa svih oznaka)
    document.querySelectorAll('.bot-flag').forEach(el => {
      el.innerText = ' ' + CONFIG.labelText;
    });
  } catch (e) { /* DOM nedostupan - nista strasno */ }
}

// =====================================================================
//  Ucitavanje liste
// =====================================================================
function toSet(text) {
  return new Set(String(text || '').split('\n').map(line => line.trim()).filter(Boolean));
}

// Lista se menja u toku rada (kad background povuce novo), pa je modul-level
// promenljiva koju sve check* funkcije dobijaju pri svakom pozivu.
let hashSet = new Set();

async function readFromStorage() {
  if (!isContextValid()) return null;
  try {
    const data = await api.storage.local.get(['listBot', 'listWhitelist']);
    if (data && data.listBot) {
      return { bot: data.listBot, whitelist: data.listWhitelist || '', source: 'github' };
    }
  } catch (e) { /* storage nedostupan - idemo na ugrađenu listu */ }
  return null;
}

async function readBundled() {
  const [botRes, wlRes] = await Promise.all([
    fetch(api.runtime.getURL('hash.txt')),
    fetch(api.runtime.getURL('hash_whitelist.txt')).catch(() => null)
  ]);
  const bot = await botRes.text();
  let whitelist = '';
  if (wlRes && wlRes.ok) whitelist = await wlRes.text();
  return { bot, whitelist, source: 'ugradjena' };
}

async function loadHashes() {
  let data = await readFromStorage();
  if (!data) {
    try {
      data = await readBundled();
    } catch (e) {
      hashSet = new Set();
      return { source: 'nema', count: 0 };
    }
  }

  // Whitelist pobeđuje: njeni hesevi se brisu iz glavnog seta.
  const set = toSet(data.bot);
  toSet(data.whitelist).forEach(h => set.delete(h));
  hashSet = set;

  const info = { source: data.source, count: set.size };
  try { console.log('[PartijskaBotara] lista: ' + set.size + ' naloga (izvor: ' + data.source + ')'); } catch (e) {}
  return info;
}

// UTF-8 -> bajtovi (sa fallback-om ako TextEncoder nije dostupan u sandbox-u)
function toBytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const utf8 = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
  return bytes;
}

function sha256(str) {
  const data = toBytes(str);
  return crypto.subtle.digest('SHA-256', data).then(buf => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

// ---------------------------------------------------------------------
// Provera da li je nalog na listi - NEOSETLJIVO NA VELICINU SLOVA
// ---------------------------------------------------------------------
// X korisnicka imena su case-insensitive: @NASA i @nasa su ISTI nalog (X ne
// dozvoljava da postoje dva naloga koja se razlikuju samo po velikim slovima).
//
// Ali X u href-ovima prikazuje case koji je nalog registrovao - @NASA ostaje
// /NASA, ne postaje /nasa. Zato ako je u nasoj listi nalog upisan pogresnim
// case-om (npr. @Nasa umesto @NASA), hes se ne poklapa i nalog se ne oboji.
//
// Resenje: proveravamo OBA oblika - tacan i lowercase. Time detekcija radi
// bez obzira na case u listi ili na stranici.
//
// Zasto ovo ne pravi lazne oznake: na X-u ne mogu da postoje dva naloga koja
// se razlikuju samo po velicini slova, pa lowercase poklapanje ne moze da
// pogodi neki drugi, nevini nalog.
function isOnList(username, hashSet) {
  const lower = username.toLowerCase();
  return Promise.all([sha256(username), sha256(lower)])
    .then(([exactHash, lowerHash]) => hashSet.has(exactHash) || hashSet.has(lowerHash));
}

// =====================================================================
//  Oznacavanje
// =====================================================================

// Oboji element trenutnom bojom iz podesavanja (+ marker klasa za kasnije
// osvezavanje kad se boja promeni).
function colorElement(el) {
  el.style.backgroundColor = CONFIG.labelBg;
  el.classList.add(COLORED_CLASS);
}

// Napravi oznaku sa trenutnim tekstom iz podesavanja.
function makeLabel(extraClass) {
  const label = document.createElement('span');
  label.innerText = ' ' + CONFIG.labelText;
  label.className = 'bot-flag ' + extraClass;
  label.style.color = 'red';
  label.style.fontWeight = 'bold';
  label.style.paddingLeft = '5px';
  return label;
}

// Mentions only — no background
function markAsBot(anchor, username) {
  const post = anchor.closest('article');
  if (!post) return;

  if (post.querySelector('.bot-flag-text')) return;

  const tweetText = anchor.closest('[data-testid="tweetText"]');
  if (!tweetText) return;

  anchor.insertAdjacentElement('afterend', makeLabel('bot-flag-text'));
}

// Only mark author if bot
function checkPostAuthor(post, hashSet) {
  if (post.querySelector('.bot-flag-author')) return;

  const nameBlock = post.querySelector('[data-testid="User-Name"]');
  if (!nameBlock) return;

  const anchor = nameBlock.querySelector('a[href^="/"]:not([href*="/status/"])');
  if (!anchor) return;

  const username = "@" + anchor.getAttribute('href').slice(1).trim();
  if (!username || username.includes('/')) return;

  isOnList(username, hashSet).then(onList => {
    if (onList) {
      colorElement(post);

      const label = makeLabel('bot-flag-author');

      const span = anchor.querySelector('span');
      if (span) {
        span.insertAdjacentElement('afterend', label);
      } else {
        anchor.appendChild(label);
      }
    }
  });
}

// Sidebar "You might like"
function checkSuggestedUsers(hashSet) {
  document.querySelectorAll('[data-testid="UserCell"]:not([data-suggestion-checked])').forEach(cell => {
    cell.setAttribute('data-suggestion-checked', 'true');

    const anchor = cell.querySelector('a[href^="/"]:not([href*="/status/"])');
    if (!anchor) return;

    const username = "@" + anchor.getAttribute('href').slice(1).trim();
    if (!username || username.includes('/')) return;

    isOnList(username, hashSet).then(onList => {
      if (onList) {
        colorElement(cell);

        const span = anchor.querySelector('span');
        if (span && !cell.querySelector('.bot-flag-suggestion')) {
          span.insertAdjacentElement('afterend', makeLabel('bot-flag-suggestion'));
        }
      }
    });
  });
}

// Live search
function checkSearchResults(hashSet) {
  document.querySelectorAll('[data-testid="typeaheadResult"]:not([data-search-checked])').forEach(item => {
    item.setAttribute('data-search-checked', 'true');

    const spans = item.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (!text.startsWith('@')) continue;

      const username = text;
      isOnList(username, hashSet).then(onList => {
        if (onList) {
          colorElement(item);
          if (!span.parentElement.querySelector('.bot-flag-search')) {
            span.insertAdjacentElement('afterend', makeLabel('bot-flag-search'));
          }
        }
      });
      break;
    }
  });
}

// Recent searches
function checkRecentSearches(hashSet) {
  document.querySelectorAll('[data-testid="typeaheadRecentSearchesItem"]:not([data-recent-checked])').forEach(item => {
    item.setAttribute('data-recent-checked', 'true');

    const spans = item.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (!text.startsWith('@')) continue;

      const username = text;
      isOnList(username, hashSet).then(onList => {
        if (onList) {
          colorElement(item);
          if (!span.parentElement.querySelector('.bot-flag-recent')) {
            span.insertAdjacentElement('afterend', makeLabel('bot-flag-recent'));
          }
        }
      });
      break;
    }
  });
}

// =====================================================================
//  Glavna petlja
// =====================================================================
async function main() {
  // Podesavanja prikaza se ucitavaju PRE petlje, da prvi obojeni post
  // odmah dobije ispravnu boju.
  await loadConfig();

  // NAPOMENA: hashSet je modul-level (vidi gore) - NE praviti lokalnu kopiju,
  // inace background osvezavanje liste ne bi stizalo do petlje ispod.
  await loadHashes();

  if (isContextValid() && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      // 1. Nova lista sa GitHub-a (background je upisuje u local)
      if (area === 'local' && (changes.listBot || changes.listWhitelist)) {
        loadHashes();
      }
      // 2. Promena boje ili teksta u Podesavanjima (sync)
      if (area === 'sync' && (changes.labelBg || changes.labelText)) {
        if (changes.labelBg && isValidHex(changes.labelBg.newValue)) {
          CONFIG.labelBg = changes.labelBg.newValue;
        }
        if (changes.labelText && changes.labelText.newValue) {
          CONFIG.labelText = sanitizeText(changes.labelText.newValue);
        }
        applyConfigToExisting();   // odmah primeni na vec oznacene postove
      }
    });
  }

  const loop = setInterval(() => {
    if (!isContextValid()) {
      clearInterval(loop); // ekstenzija reload-ovana - ugasi stari primerak
      return;
    }

    document.querySelectorAll('article:not([data-author-checked])').forEach(post => {
      post.setAttribute('data-author-checked', 'true');
      checkPostAuthor(post, hashSet);
    });

    document.querySelectorAll('a[href^="/"]:not([data-bot-checked])').forEach(async a => {
      a.setAttribute('data-bot-checked', 'true');

      const href = a.getAttribute('href');
      if (!href || href.includes('/status/')) return;

      const username = "@" + href.slice(1).trim();
      if (!username || username.includes('/')) return;

      if (await isOnList(username, hashSet)) {
        markAsBot(a, username);
      }
    });

    checkSuggestedUsers(hashSet);
    checkSearchResults(hashSet);
    checkRecentSearches(hashSet);
  }, 1000);
}

main();
