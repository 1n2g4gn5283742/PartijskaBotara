const HASH_URL = 'https://raw.githubusercontent.com/1n2g4gn5283742/PartijskaBotara/main/hash.txt';

async function loadHashes() {
  try {
    const res = await fetch(HASH_URL, {
      cache: 'no-store', // 
    });

    if (!res.ok) {
      console.error('Failed to load hash list from GitHub:', res.status, res.statusText);
      return new Set();
    }

    const text = await res.text();
    return new Set(
      text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
  } catch (e) {
    console.error('Error while fetching hash list from GitHub:', e);
    return new Set();
  }
}

function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return crypto.subtle.digest('SHA-256', data).then(buf => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

// Mentions only — no background
function markAsBot(anchor, username) {
  const post = anchor.closest('article');
  if (!post) return;

  if (post.querySelector('.bot-flag-text')) return;

  const tweetText = anchor.closest('[data-testid="tweetText"]');
  if (!tweetText) return;

  const label = document.createElement('span');
  label.innerText = ' BOT';
  label.className = 'bot-flag bot-flag-text';
  label.style.color = 'red';
  label.style.fontWeight = 'bold';
  label.style.paddingLeft = '5px';

  anchor.insertAdjacentElement('afterend', label);
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

  sha256(username).then(hash => {
    if (hashSet.has(hash)) {
      post.style.backgroundColor = '#ffcccc';

      const label = document.createElement('span');
      label.innerText = ' BOT';
      label.className = 'bot-flag bot-flag-author';
      label.style.color = 'red';
      label.style.fontWeight = 'bold';
      label.style.paddingLeft = '5px';

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

    sha256(username).then(hash => {
      if (hashSet.has(hash)) {
        cell.style.backgroundColor = '#ffcccc';

        const span = anchor.querySelector('span');
        if (span && !cell.querySelector('.bot-flag-suggestion')) {
          const label = document.createElement('span');
          label.innerText = ' BOT';
          label.className = 'bot-flag bot-flag-suggestion';
          label.style.color = 'red';
          label.style.fontWeight = 'bold';
          label.style.paddingLeft = '5px';
          span.insertAdjacentElement('afterend', label);
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
      sha256(username).then(hash => {
        if (hashSet.has(hash)) {
          if (!span.parentElement.querySelector('.bot-flag-search')) {
            const label = document.createElement('span');
            label.innerText = ' BOT';
            label.className = 'bot-flag bot-flag-search';
            label.style.color = 'red';
            label.style.fontWeight = 'bold';
            label.style.paddingLeft = '5px';
            span.insertAdjacentElement('afterend', label);
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
      sha256(username).then(hash => {
        if (hashSet.has(hash)) {
          if (!span.parentElement.querySelector('.bot-flag-recent')) {
            const label = document.createElement('span');
            label.innerText = ' BOT';
            label.className = 'bot-flag bot-flag-recent';
            label.style.color = 'red';
            label.style.fontWeight = 'bold';
            label.style.paddingLeft = '5px';
            span.insertAdjacentElement('afterend', label);
          }
        }
      });
      break;
    }
  });
}

async function main() {
  const hashSet = await loadHashes();

  setInterval(() => {
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

      const hash = await sha256(username);
      if (hashSet.has(hash)) {
        markAsBot(a, username);
      }
    });

    checkSuggestedUsers(hashSet);
    checkSearchResults(hashSet);
    checkRecentSearches(hashSet);
  }, 1000);
}

main();