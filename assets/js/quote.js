import { reveal, setMenu } from './navigation.js';

const toggle = document.querySelector('#quote-toggle');
const panel = document.querySelector('#quote-panel');
const content = document.querySelector('#quote-content');
const status = document.querySelector('#quote-status');
const retry = document.querySelector('#quote-retry');
const date = document.querySelector('#quote-date');
const cacheKey = 'daily-quote';
let cached = null;
let loading = false;
try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch {}

function valid(quote) {
  return quote && typeof quote.quote === 'string' && quote.quote.trim().length > 0
    && typeof quote.author === 'string' && quote.author.trim().length > 0
    && typeof quote.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(quote.date);
}

function show(quote) {
  document.querySelector('#quote-text').textContent = quote.quote;
  document.querySelector('#quote-author').textContent = quote.author;
  date.dateTime = quote.date;
  date.textContent = quote.date;
  content.hidden = false;
  status.hidden = true;
  retry.hidden = true;
}

async function loadQuote() {
  if (loading) return;
  const today = new Date().toISOString().slice(0, 10);
  if (valid(cached) && cached.date === today) { show(cached); return; }
  loading = true;
  content.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading…';
  retry.hidden = true;
  date.textContent = '';
  panel.setAttribute('aria-busy', 'true');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://dumbapis.com/daily/quote', {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('Quote unavailable');
    const quote = await response.json();
    if (!valid(quote)) throw new Error('Invalid quote');
    cached = { quote: quote.quote, author: quote.author, date: quote.date };
    try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch {}
    show(cached);
  } catch {
    status.textContent = 'Couldn’t load the quote.';
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    loading = false;
    panel.removeAttribute('aria-busy');
  }
}

function expand(open) {
  if (open && document.querySelector('#menu-toggle').getAttribute('aria-expanded') === 'true') setMenu(false);
  toggle.setAttribute('aria-expanded', String(open));
  reveal(panel, open);
  if (open) loadQuote();
}
toggle.addEventListener('click', () => expand(toggle.getAttribute('aria-expanded') !== 'true'));
retry.addEventListener('click', loadQuote);
document.addEventListener('click', event => {
  if (toggle.getAttribute('aria-expanded') === 'true' && !event.target.closest('.quote-section')) expand(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    expand(false);
    toggle.focus();
  }
});
