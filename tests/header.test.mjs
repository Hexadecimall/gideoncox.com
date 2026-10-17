import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const frame = await readFile(new URL('../projects/frame/index.html', import.meta.url), 'utf8');
const header = html => {
  const value = html.match(/<header\b[^>]*\bid=["']site-header["'][^>]*>([\s\S]*?)<\/header>/i)?.[1];
  assert.ok(value, 'Page must include the shared site header');
  return value;
};
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2];
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => match[0]);
const base = new URL('https://header.invalid/');
const resource = (reference, page) => new URL(reference, new URL(page, base)).pathname;
const sharedStyles = new Set(['base', 'navigation', 'tools', 'motion', 'quote', 'doodle'].map(name => `/assets/css/${name}.css`));
const sharedScripts = new Set(['preferences', 'navigation', 'tools', 'cps', 'quote', 'doodle'].map(name => `/assets/js/${name}.js`));
const styles = (html, page) => tags(html, 'link')
  .filter(tag => attr(tag, 'rel') === 'stylesheet')
  .map(tag => resource(attr(tag, 'href'), page)).filter(path => sharedStyles.has(path));
const scripts = (html, page) => tags(html, 'script')
  .filter(tag => attr(tag, 'src'))
  .map(tag => ({path: resource(attr(tag, 'src'), page), type: attr(tag, 'type') || 'classic'}))
  .filter(entry => sharedScripts.has(entry.path));

test('Frame loads shared header styles in the same order as Home', async () => {
  const expected = styles(home, '/');
  assert.equal(new Set(expected).size, sharedStyles.size, 'Home must provide the complete shared style baseline');
  assert.deepEqual(styles(frame, '/projects/frame/'), expected);
  for (const path of expected) await readFile(new URL(`..${path}`, import.meta.url));
  const quoteStyles = await readFile(new URL('../assets/css/quote.css', import.meta.url), 'utf8');
  const actions = quoteStyles.match(/\.header-actions\s*\{([^}]+)\}/)?.[1];
  assert.ok(actions, 'The shared header action layout must exist');
  assert.match(actions, /display\s*:\s*flex\s*;/);
  assert.match(actions, /align-items\s*:\s*center\s*;/);
  assert.match(actions, /margin-left\s*:\s*auto\s*;/);
});

test('Frame loads the shared header behavior, including Quote, in Home order', async () => {
  const expected = scripts(home, '/');
  assert.equal(new Set(expected.map(entry => entry.path)).size, sharedScripts.size);
  assert.deepEqual(scripts(frame, '/projects/frame/'), expected);
  for (const {path} of expected) await readFile(new URL(`..${path}`, import.meta.url));
  const quote = await readFile(new URL('../assets/js/quote.js', import.meta.url), 'utf8');
  for (const match of quote.matchAll(/querySelector\(['"]#([\w-]+)['"]\)/g))
    assert.ok(tags(header(frame), '[a-z][a-z0-9-]*').some(tag => attr(tag, 'id') === match[1]), `Missing quote control: ${match[1]}`);
});

test('Frame preserves the Home header button order, menu control and g. icon', () => {
  const expected = header(home);
  const actual = header(frame);
  const buttonIds = html => tags(html, 'button').map(tag => attr(tag, 'id')).filter(Boolean);
  assert.deepEqual(buttonIds(actual), buttonIds(expected));
  const controls = ['doodle-toggle', 'quote-toggle', 'cps-toggle'];
  assert.deepEqual(buttonIds(actual).filter(id => controls.includes(id)), controls);
  for (const html of [expected, actual]) {
    const menu = tags(html, 'button').find(tag => attr(tag, 'id') === 'menu-toggle');
    assert.equal(attr(menu, 'aria-controls'), 'site-menu');
    assert.equal(attr(menu, 'aria-expanded'), 'false');
    assert.match(attr(menu, 'class'), /\bbrand\b/);
    const mark = html.match(/<span\b[^>]*class=["']brand-mark["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    assert.equal(mark?.trim(), 'g.');
    assert.equal(tags(html, 'div').filter(tag => /\bheader-actions\b/.test(attr(tag, 'class') || '')).length, 1);
  }
});
