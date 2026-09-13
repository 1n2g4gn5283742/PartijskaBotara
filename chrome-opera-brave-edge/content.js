// Logika vracena iz backup skripte (inline backgroundColor pristup)
// + whitelist podrska
// + lista se cita iz storage-a (ako je background povukao sa GitHub-a),
//   a ako je nema - koristi UGRAĐENE fajlove hash.txt / hash_whitelist.txt
// + boja i tekst oznake se citaju iz podesavanja (storage.sync)

// Nakon reload-a ekstenzije stari content script ostaje u tabu sa mrtvim
// chrome.* API-jem ("Extension context invalidated") - ovako se tiho ugasi.
function isContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
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
    const stored = await chrome.storage.sync.get(['labelBg', 'labelText']);
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
    const data = await chrome.storage.local.get(['listBot', 'listWhitelist']);
    if (data && data.listBot) {
      return { bot: data.listBot, whitelist: data.listWhitelist || '', source: 'github' };
    }
  } catch (e) { /* storage nedostupan - idemo na ugrađenu listu */ }
  return null;
}

async function readBundled() {
  const [botRes, wlRes] = await Promise.all([
    fetch(chrome.runtime.getURL('hash.txt')),
    fetch(chrome.runtime.getURL('hash_whitelist.txt')).catch(() => null)
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

function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
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
  // VAZNO: generator (make_hashes.py) hesira ime SA znakom @ ("@snsbor"),
  // a parseXHandle() vraca ime BEZ @. Zato ovde uvek dodajemo @ pre
  // hashiranja - inace se nista nikad ne poklapa.
  // Proveravamo i tacan i lowercase oblik: novi generator pise lowercase,
  // ali kesirana lista u storage-u moze biti iz starije verzije sa
  // mesovitim case-om.
  const name = (username.charAt(0) === '@') ? username : '@' + username;
  const lower = name.toLowerCase();
  return Promise.all([sha256(name), sha256(lower)])
    .then(([exactHash, lowerHash]) => hashSet.has(exactHash) || hashSet.has(lowerHash));
}

// =====================================================================
//  Centralno parsiranje X handle-a iz href-a
// =====================================================================
// X handle: slova, brojevi i '_', najvise 15 znakova. Sve sto ne prolazi
// ovu proveru (/home, /explore, /i/flow, /status/123, prazno...) NIJE
// korisnicko ime i odmah se odbacuje - tako se ne radi bespotrebno SHA-256
// nad linkovima na stranice.
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// Vrati handle ("Ime") iz href-a ili null ako href nije link na nalog.
function parseXHandle(href) {
  if (!href) return null;
  if (href.indexOf('/') !== 0) return null;          // relativan link na /nes
  const rest = href.slice(1);
  if (!rest || rest.indexOf('/') !== -1) return null; // /home, /i/flow, /x/status/...
  return HANDLE_RE.test(rest) ? rest : null;
}

// =====================================================================
//  Oznacavanje
// =====================================================================

// EVIDENCIJA U MEMORIJI (WeakSet/WeakMap) umesto data-* atributa na
// X-ovim elementima. X ima svoje MutationObserver-e i scroll-anchoring -
// svaka nasa setAttribute promena na njegovim node-ovima (a bilo ih je
// stotine po tiku tokom skrola) moze da izazove njegovu reakciju i
// "cimanje" scroll-a. Weak kolekcije se same ociste kad X izbaci node
// iz DOM-a, i ne mogu se videti u DOM-u.
const checkedPosts = new WeakSet();      // article: author obradjen (ili odustao)
const checkedAnchors = new WeakSet();    // linkovi: obradjeni (bez hashinga opet)
const checkedCells = new WeakSet();      // UserCell / search / recent
const postHandle = new WeakMap();        // element -> handle sa kojim je proveren
const postTries = new WeakMap();         // element -> broj neuspesnih pokusaja
const markedEls = new WeakSet();         // elementi koje smo obojili
// Oboji element trenutnom bojom iz podesavanja (+ marker klasa za kasnije
// osvezavanje kad se boja promeni).
function colorElement(el) {
  el.style.backgroundColor = CONFIG.labelBg;
  el.classList.add(COLORED_CLASS);
  markedEls.add(el);
}

// Napravi oznaku sa trenutnim tekstom iz podesavanja.
//
// Oznaka MORA biti obican inline span normalne velicine. Probano je i sa
// "nultom kutijom" (width:0/height:0 + overflow:visible) da se ne menja
// layout - ali X na kontejneru imena ima overflow:hidden (elipsis za duga
// imena), pa se prelivajuci sadrzaj nulte kutije ISECE i labela postaje
// nevidljiva. Zato: normalan span + paddingLeft. Layout-stabilnost se vec
// resava pendingLabels redom (labele se ne umeću tokom skrola).
function makeLabel(extraClass) {
  const label = document.createElement('span');
  label.innerText = ' ' + CONFIG.labelText;
  label.className = 'bot-flag ' + extraClass;
  label.style.color = 'red';
  label.style.fontWeight = 'bold';
  label.style.paddingLeft = '5px';
  label.style.whiteSpace = 'nowrap';
  return label;
}

// Mentions only — no background
// Umetanje bilo kog node-a u X-ov virtualizovani layout izaziva njegovu
// scroll-korekciju (izmereno: 14/17 scroll skokova u roku 500ms posle
// dodavanja labele). Zato se labele NE ubacuju dok korisnik AKTIVNO
// SKROLUJE - cekaju u redu (pendingLabels), a flush se desava tek kad
// skrol stane (watchScroll ispod koristi 250ms "tišine"). Boja (background)
// se postavlja odmah - ona ne menja layout.
const pendingLabels = [];   // { run: Function }

function isScrolling() {
  // X skroluje i programski i touchpad-om; najpouzdaniji signal je da li
  // se scrollY menja izmedju dva uzastopna citanja u kratkom prozoru.
  return scrollActiveUntil > performance.now();
}
let scrollActiveUntil = 0;
let lastScrollY = -1;
let scrollWatchTimer = null;

// Detekcija aktivnog skrola: kratak polling scrollY-ja (60ms) - jeftino,
// radi samo dok se skrola, i ne koristi interrupt/blocking listenere.
function watchScroll() {
  if (scrollWatchTimer) return;
  const tick = () => {
    const y = window.scrollY;
    if (y !== lastScrollY) {
      lastScrollY = y;
      scrollActiveUntil = performance.now() + 250;   // skrol jos "zivi" 250ms
    }
    if (performance.now() < scrollActiveUntil) {
      scrollWatchTimer = setTimeout(tick, 60);
    } else {
      scrollWatchTimer = null;
      flushPendingLabels();   // skrol gotov - sada bezbedno ubacuj labele
    }
  };
  scrollWatchTimer = setTimeout(tick, 60);
}

function flushPendingLabels() {
  const batch = pendingLabels.splice(0, pendingLabels.length);
  for (const item of batch) {
    try { item.run(); } catch (e) { /* DOM promena u meduvremenu - preskaci */ }
  }
}

// Zakazi umetanje labele: odmah ako se ne skroluje, inace u red.
//
// attach() vraca true kad je labela stvarno ubacena (ili je vec tamo),
// a false kad uslov nije ispunjen (React mid-render, anchor detachmentovan).
// Na false se PONOVO pokusava (do LABEL_MAX_TRIES) - inace bi labela bila
// izgubljena zauvek: pozadina je vec obojena, a element je u "checked"
// evidenciji pa ga niko vise ne procesira. To je bio uzrok obojenih
// komentara bez BOT labele.
const LABEL_MAX_TRIES = 10;

function runLabelAttach(container, attach, tries) {
  if (!container.isConnected) return;   // clanak izbacen iz DOM-a - nema sta
  let ok = false;
  try { ok = attach(); } catch (e) { ok = false; }
  if (!ok && tries < LABEL_MAX_TRIES) {
    setTimeout(() => runLabelAttach(container, attach, tries + 1), 150);
  }
}

function scheduleLabel(container, attach) {
  if (!isScrolling()) {
    runLabelAttach(container, attach, 0);
    return;
  }
  pendingLabels.push({ run: () => {
    // container mora i dalje biti u DOM-u kad dodje red.
    if (container.isConnected) runLabelAttach(container, attach, 0);
  } });
  watchScroll();
}

// Mentions only — no background
function markAsBot(anchor, username) {
  const post = anchor.closest('article');
  if (!post) return;

  if (post.querySelector('.bot-flag-text')) return;

  const tweetText = anchor.closest('[data-testid="tweetText"]');
  if (!tweetText) return;

  scheduleLabel(post, () => {
    if (!post.isConnected || post.querySelector('.bot-flag-text')) return true;
    // Anchor moze biti re-renderovan (detachmentovan) u meduvremenu -
    // false znaci "pokusaj opet", umesto tihog gubitka labele.
    if (!anchor.isConnected) return false;
    anchor.insertAdjacentElement('afterend', makeLabel('bot-flag-text'));
    return true;
  });
}

// Only mark author if bot
// Vraca true ako je article "gotov" (pronadjen handle ili odustajemo),
// false ako treba pokusati opet u sledecem tiku.
const MAX_TRIES = 10;   // ~10 s cekanja na React render - posle odustajemo

function checkPostAuthor(post, hashSet) {
  if (post.querySelector('.bot-flag-author')) return true;
  if (checkedPosts.has(post)) return true;

  const nameBlock = post.querySelector('[data-testid="User-Name"]');
  // NEMA "checked" PRE provere: X React render cesto dodaje article pre
  // nego sto stavi User-Name unutra. Ali ne smemo pokusavati ZAUVEK:
  // clanci bez User-Name-a (reklame, placeholder-i) bi svake sekunde
  // ponovo skenirani. Posle MAX_TRIES odustajemo.
  if (!nameBlock) return giveUp(post, 'post');

  const anchor = nameBlock.querySelector('a[href^="/"]:not([href*="/status/"])');
  if (!anchor) return giveUp(post, 'post');

  const handle = parseXHandle(anchor.getAttribute('href'));
  if (!handle) return giveUp(post, 'post');

  // Handle je pronadjen i validan - TEK SAD je clanak "proveren".
  checkedPosts.add(post);
  postTries.delete(post);
  const hLower = handle.toLowerCase();
  postHandle.set(post, hLower);

  isOnList(handle, hashSet).then(onList => {
    // Reakcija na recikliranje: ako je article u meduvremenu dobio drugi
    // sadrzaj (drugi handle) ili je izbacen iz DOM-a, NE lepi se labela -
    // novi sadrzaj dobija svoju proveru.
    if (postHandle.get(post) !== hLower) return;
    if (!post.isConnected) return;

    if (onList) {
      colorElement(post);

      // Labela se ubacuje ODMAH samo ako se ne skroluje; inace ceka u redu
      // dok skrol ne stane (izmereno: umetanje node-a tokom skrola izaziva
      // X-ovu scroll-korekciju - "mini scroll").
      scheduleLabel(post, () => {
        if (!post.isConnected || post.querySelector('.bot-flag-author')) return true;
        const a2 = post.querySelector('[data-testid="User-Name"] a[href^="/"]:not([href*="/status/"])');
        // Nema ankora (React mid-render) - false znaci "pokusaj opet".
        if (!a2) return false;
        const label = makeLabel('bot-flag-author');
        const span = a2.querySelector('span');
        if (span) {
          span.insertAdjacentElement('afterend', label);
        } else {
          a2.appendChild(label);
        }
        return true;
      });
    }
  });
  return true;
}

// Povecaj brojac neuspesnih pokusaja; posle MAX_TRIES odustani od clanka.
// Kad odustanemo, element MORA da ide u odgovarajuci WeakSet - inace bi
// svaki sledeci scan (na svaku DOM promenu) ponovo pokusavao i brojao
// ispočetka, pa bi se beskorisno skenirao zauvek.
function giveUp(el, kind) {
  const tries = (postTries.get(el) || 0) + 1;
  if (tries >= MAX_TRIES) {
    postTries.delete(el);
    if (kind === 'cell') checkedCells.add(el);
    else checkedPosts.add(el);
    return true;
  }
  postTries.set(el, tries);
  return false;
}

// Sidebar "You might like"
function checkSuggestedUsers(hashSet) {
  document.querySelectorAll('[data-testid="UserCell"]').forEach(cell => {
    if (checkedCells.has(cell)) return;

    const anchor = cell.querySelector('a[href^="/"]:not([href*="/status/"])');
    if (!anchor) { giveUp(cell, 'cell'); return; }   // nema handle-a - pokusavamo opet

    const handle = parseXHandle(anchor.getAttribute('href'));
    if (!handle) { giveUp(cell, 'cell'); return; }

    checkedCells.add(cell);
    postTries.delete(cell);
    const hLower = handle.toLowerCase();
    postHandle.set(cell, hLower);

    isOnList(handle, hashSet).then(onList => {
      if (postHandle.get(cell) !== hLower) return;
      if (onList) {
        colorElement(cell);

        scheduleLabel(cell, () => {
          if (!cell.isConnected || cell.querySelector('.bot-flag-suggestion')) return true;
          const a2 = cell.querySelector('a[href^="/"]:not([href*="/status/"])');
          const span = a2 && a2.querySelector('span');
          if (!span) return false;   // React mid-render - pokusaj opet
          span.insertAdjacentElement('afterend', makeLabel('bot-flag-suggestion'));
          return true;
        });
      }
    });
  });
}

// Live search
function checkSearchResults(hashSet) {
  document.querySelectorAll('[data-testid="typeaheadResult"]').forEach(item => {
    if (checkedCells.has(item)) return;

    const spans = item.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text.indexOf('@') !== 0) continue;
      const handle = text.slice(1);
      if (!HANDLE_RE.test(handle)) continue;

      checkedCells.add(item);
      const hLower = handle.toLowerCase();
      postHandle.set(item, hLower);

      isOnList(handle, hashSet).then(onList => {
        if (postHandle.get(item) !== hLower) return;
        if (onList) {
          colorElement(item);

          scheduleLabel(item, () => {
            if (!item.isConnected || item.querySelector('.bot-flag-search')) return true;
            const span = Array.from(item.querySelectorAll('span'))
              .find(s => s.textContent.trim().indexOf('@') === 0);
            if (!span) return false;   // React mid-render - pokusaj opet
            span.insertAdjacentElement('afterend', makeLabel('bot-flag-search'));
            return true;
          });
        }
      });
      break;
    }
  });
}

// Recent searches
function checkRecentSearches(hashSet) {
  document.querySelectorAll('[data-testid="typeaheadRecentSearchesItem"]').forEach(item => {
    if (checkedCells.has(item)) return;

    const spans = item.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text.indexOf('@') !== 0) continue;
      const handle = text.slice(1);
      if (!HANDLE_RE.test(handle)) continue;

      checkedCells.add(item);
      const hLower = handle.toLowerCase();
      postHandle.set(item, hLower);

      isOnList(handle, hashSet).then(onList => {
        if (postHandle.get(item) !== hLower) return;
        if (onList) {
          colorElement(item);

          scheduleLabel(item, () => {
            if (!item.isConnected || item.querySelector('.bot-flag-recent')) return true;
            const span = Array.from(item.querySelectorAll('span'))
              .find(s => s.textContent.trim().indexOf('@') === 0);
            if (!span) return false;   // React mid-render - pokusaj opet
            span.insertAdjacentElement('afterend', makeLabel('bot-flag-recent'));
            return true;
          });
        }
      });
      break;
    }
  });
}

// ---------------------------------------------------------------------
//  Rescan posle promene baze
// ---------------------------------------------------------------------
// Kad background povuce novu listu, oznake na ekranu vise ne vaze.
// Minimalno: prepovedaj SAMO vec obojene elemente po sacuvanom handle-u
// i skini oznaku onome ko vise nije na listi. Ne dira se nista drugo -
// nema globalnog skidanja labela (to bi menjalo visine clanakova i X bi
// "vrsnuo" scroll).
function rescanAfterListChange() {
  try {
    const checks = [];
    // Obojeni elementi su u markedEls (WeakSet) - njih proveravamo.
    // Pošto WeakSet nije enumerabilan, obojene elemente nalazimo klasom.
    document.querySelectorAll('.' + COLORED_CLASS).forEach(el => {
      const handle = postHandle.get(el);
      if (!handle) return;
      checks.push(isOnList(handle, hashSet).then(onList => {
        if (!onList) {
          // Povucen sa liste / dodat u whitelist - skini oznaku.
          el.classList.remove(COLORED_CLASS);
          el.style.backgroundColor = '';
          markedEls.delete(el);
          el.querySelectorAll('.bot-flag').forEach(f => f.remove());
          if (checkedPosts.has(el)) checkedPosts.delete(el);
          if (checkedCells.has(el)) checkedCells.delete(el);
        }
      }));
    });
    Promise.all(checks).catch(() => {});
  } catch (e) { /* DOM nedostupan - sledeci tik ce sve ionako videti */ }
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

  if (isContextValid() && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      // 1. Nova lista sa GitHub-a (background je upisuje u local).
      //    OBAVI rescan: stare oznake/boje na ekranu vise ne vaze jer je
      //    lista promenjena (dodavanje, uklanjanje ili whitelist promena).
      if (area === 'local' && (changes.listBot || changes.listWhitelist)) {
        loadHashes().then(rescanAfterListChange);
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

  // -------------------------------------------------------------------
  //  Scan: MutationObserver umesto polling-a
  // -------------------------------------------------------------------
  // Polling svake sekunde je znacio: labela se dodaje do 1 s NAKON sto X
  // renderuje komentar - znaci cesto TOKOM korisnikovog skrola, promena
  // visine onda izazove X-ovu scroll-korekciju ("stucanje" u komentarima).
  //
  // MutationObserver reaguje ODMAH kad X ubaci novi sadrzaj, a debounce
  // od ~120 ms ceka da X zavrsi svoje merenje. Labela se zalepi pre nego
  // sto korisnik stigne da skroluje do tog komentara -> bez korekcije.
  // Kad se DOM ne menja, NE radi se NISTA (nema tika, nema skeniranja).
  let scanTimer = null;

  function scan() {
    if (!isContextValid()) return;

    // Sve "provereno" evidencija je u WeakSet/WeakMap - ne pisemo NISTA
    // na X-ove elemente (osim labele/boje kad nalog jeste na listi).
    document.querySelectorAll('article').forEach(post => {
      if (!checkedPosts.has(post)) checkPostAuthor(post, hashSet);
    });

    // Samo linkovi koji IZGLEDAJU kao handle - parseXHandle odbacuje
    // /home, /explore, /i/... pre bilo kakvog hashiranja.
    document.querySelectorAll('a[href^="/"]').forEach(a => {
      if (checkedAnchors.has(a)) return;

      const handle = parseXHandle(a.getAttribute('href'));
      checkedAnchors.add(a);   // link se proverava TACNO JEDNOM
      if (!handle) return;

      isOnList(handle, hashSet).then(onList => {
        if (!a.isConnected) return;   // link recikliran/izbacen u meduvremenu
        if (onList) {
          markAsBot(a, handle);
        }
      });
    });

    checkSuggestedUsers(hashSet);
    checkSearchResults(hashSet);
    checkRecentSearches(hashSet);
  }

  function scheduleScan() {
    if (scanTimer) return;              // vec zakazano - ne gomilaj
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 120);
  }

  try {
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    // Fallback ako MutationObserver nije dostupan: stari polling.
    const loop = setInterval(() => {
      if (!isContextValid()) { clearInterval(loop); return; }
      scan();
    }, 1000);
  }

  scheduleScan();   // prvi scan odmah posle starta
}

main();
