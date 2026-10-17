import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://gideoncox.com';
const pageURL = new URL('/projects/frame/', origin);
const page = await readFile(new URL('../projects/frame/index.html', import.meta.url), 'utf8');
const main = page.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
const tags = html => [...html.matchAll(/<[a-z][^>]*>/gi)].map(match => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2];
const ids = html => new Set(tags(html).map(tag => attr(tag, 'id')).filter(Boolean));
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function localReference(reference, base) {
  assert.ok(!/^javascript:/i.test(reference), 'Executable links are not allowed');
  if (/^(data:|mailto:|tel:)/i.test(reference)) return;
  const url = new URL(reference, base);
  assert.match(url.protocol, /^https?:$/, `Unsupported public-page URL: ${reference}`);
  if (url.hostname !== pageURL.hostname) return;
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  const relative = path.relative(root, file);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Reference escapes site root: ${reference}`);
  const info = await stat(file).catch(() => assert.fail(`Missing local reference: ${reference} from ${base}`));
  const target = info.isDirectory() ? path.join(file, 'index.html') : file;
  assert.ok((await stat(target)).isFile(), `Reference has no page or file: ${reference}`);
  if (url.hash && target.endsWith('.html')) {
    const targetHTML = await readFile(target, 'utf8');
    assert.ok(ids(targetHTML).has(decodeURIComponent(url.hash.slice(1))), `Missing fragment: ${url.href}`);
  }
  return {url, target};
}

async function htmlFiles(directory = root) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await htmlFiles(file));
    else if (entry.name.endsWith('.html')) result.push(file);
  }
  return result;
}

test('Frame describes the actual 1.8.9 development preview and pending platform validation', () => {
  assert.ok(main, 'Frame needs a main product surface');
  const copy = plain(main);
  assert.match(copy, /Minecraft(?: Java)? 1\.8\.9/);
  assert.match(copy, /Development preview/i);
  assert.match(copy, /In development\./i);
  assert.match(copy, /Public downloads and purchasing are not open yet\./i);
  assert.match(copy, /macOS runtime validation is still pending\./i);
  assert.doesNotMatch(copy, /guaranteed\s+(?:performance|FPS)|(?:double|triple)\s+your\s+FPS/i);
  assert.equal((page.match(/<h1\b/gi) || []).length, 1);
  assert.equal(ids(page).size, tags(page).map(tag => attr(tag, 'id')).filter(Boolean).length, 'Duplicate page IDs break navigation');
  assert.match(page, /<link\b[^>]*rel="canonical"[^>]*href="https:\/\/gideoncox\.com\/projects\/frame\/"/);
});

test('the preview offers section navigation and configured checkout controls without fake purchasing', async () => {
  for (const tag of tags(page)) {
    for (const attribute of ['href', 'src', 'action']) {
      const value = attr(tag, attribute);
      if (!value) continue;
      const url = new URL(value, pageURL);
      assert.doesNotMatch(url.pathname, /(?:-private(?:[-./]|$)|\.(?:exe|msi|zip|dmg|pkg|deb)$)/i, `Public preview references installer: ${value}`);
      assert.doesNotMatch(url.hostname, /(?:^|\.)(?:stripe\.com|paypal\.com|gumroad\.com|lemonsqueezy\.com|paddle\.com)$/i, `Purchasing is not open: ${value}`);
    }
    assert.ok(!/^<a\b/i.test(tag) || !/\sdownload(?:\s|=|>)/i.test(tag), 'Preview has an active download anchor');
  }
  assert.doesNotMatch(main, /<(?:form|button)\b[^>]*(?:checkout|purchase|buy)[^>]*>/i);
  for (const tag of tags(main).filter(tag => /\bdata-(?:buy-now|trial)\b/.test(tag))) {
    assert.equal(attr(tag, 'aria-disabled'), 'true', 'Unconfigured checkout must not be active');
    assert.equal(attr(tag, 'href'), undefined, 'Unconfigured checkout must not have a destination');
  }
  assert.equal(tags(main).filter(tag => /\bdata-buy-now\b/.test(tag)).length, 1);
  assert.equal(tags(main).filter(tag => /\bdata-trial\b/.test(tag)).length, 1);
  const config = JSON.parse(await readFile(new URL('../assets/frame/commerce.json', import.meta.url), 'utf8'));
  assert.equal(config.enabled, false);
  assert.equal(config.trialHours, 24);
  assert.equal(config.checkoutUrl, '');
  assert.equal(config.trialUrl, '');
  const primary = main.match(/<a\b[^>]*class="[^"]*frame-button-primary[^"]*"[^>]*>[\s\S]*?<\/a>/i)?.[0];
  assert.ok(primary, 'The main action must remain usable');
  assert.equal(attr(primary, 'href'), '#launcher');
  assert.match(plain(primary), /View the launcher/i);
});

test('every Frame HTML reference and linked CSS asset resolves, including local fragments', async () => {
  const stylesheets = [];
  for (const tag of tags(page)) {
    for (const attribute of ['href', 'src']) {
      const value = attr(tag, attribute);
      if (!value) continue;
      const local = await localReference(value, pageURL);
      if (local && /^<link\b/i.test(tag) && attr(tag, 'rel') === 'stylesheet') stylesheets.push(local);
    }
    for (const attribute of ['aria-controls', 'aria-labelledby']) {
      for (const id of (attr(tag, attribute) || '').split(/\s+/).filter(Boolean)) {
        assert.ok(ids(page).has(id), `Missing accessible control/label target: ${id}`);
      }
    }
  }
  assert.ok(stylesheets.some(item => item.url.pathname.endsWith('/frame.css')));
  for (const {target, url} of stylesheets) {
    const css = await readFile(target, 'utf8');
    for (const match of css.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi)) {
      await localReference((match[2] ?? match[3]).trim(), url);
    }
  }
});

test('purchase return page has valid local resources, fragments and accessible controls', async () => {
  const receiptURL = new URL('/projects/frame/checkout/', origin);
  const receipt = await readFile(new URL('../projects/frame/checkout/index.html', import.meta.url), 'utf8');
  const identifiers = ids(receipt);
  assert.equal(identifiers.size, tags(receipt).map(tag => attr(tag, 'id')).filter(Boolean).length);
  for (const tag of tags(receipt)) {
    for (const name of ['href', 'src']) {
      const value = attr(tag, name);
      if (value) await localReference(value, receiptURL);
    }
    for (const name of ['aria-controls', 'aria-labelledby']) {
      for (const id of (attr(tag, name) || '').split(/\s+/).filter(Boolean)) assert.ok(identifiers.has(id));
    }
  }
});

test('account page resolves local resources and accessible form labels', async () => {
  const accountURL = new URL('/projects/frame/account/', origin);
  const account = await readFile(new URL('../projects/frame/account/index.html', import.meta.url), 'utf8');
  const identifiers = ids(account);
  assert.equal(identifiers.size, tags(account).map(tag => attr(tag, 'id')).filter(Boolean).length);
  for (const tag of tags(account)) {
    for (const name of ['href', 'src']) {
      const value = attr(tag, name);
      if (value) await localReference(value, accountURL);
    }
    for (const name of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for']) {
      for (const id of (attr(tag, name) || '').split(/\s+/).filter(Boolean)) assert.ok(identifiers.has(id), `Missing account control: ${id}`);
    }
  }
  const expectedStyles = ['/assets/css/base.css', '/assets/css/navigation.css', '/assets/css/tools.css',
    '/assets/css/motion.css', '/assets/css/quote.css', '/assets/css/doodle.css'];
  const styles = tags(account).filter(tag => /^<link\b/.test(tag) && attr(tag, 'rel') === 'stylesheet')
    .map(tag => new URL(attr(tag, 'href'), accountURL).pathname).filter(value => expectedStyles.includes(value));
  assert.deepEqual(styles, expectedStyles);
});

test('Frame ships real font faces, their license, a vector logo and the declared launcher PNG', async () => {
  for (const name of ['Inter-Regular.ttf', 'Inter-Bold.ttf']) {
    const font = await readFile(new URL(`../assets/frame/fonts/${name}`, import.meta.url));
    assert.ok(font.length > 1000, `Font is empty or a placeholder: ${name}`);
    assert.ok(font.readUInt32BE(0) === 0x00010000 || font.toString('ascii', 0, 4) === 'OTTO', `Invalid font container: ${name}`);
  }
  const license = await readFile(new URL('../assets/frame/fonts/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE/i);
  const logo = await readFile(new URL('../assets/frame/logo.svg', import.meta.url), 'utf8');
  assert.match(logo, /<svg\b[^>]*viewBox=/);
  const png = await readFile(new URL('../assets/frame/launcher.png', import.meta.url));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.ok(width >= 900 && height >= 600, 'Launcher screenshot is not a usable full-size image');
  const image = tags(main).find(tag => /^<img\b/i.test(tag) && attr(tag, 'src')?.endsWith('/launcher.png'));
  assert.ok(image, 'Actual launcher screenshot is not displayed');
  assert.equal(Number(attr(image, 'width')), width);
  assert.equal(Number(attr(image, 'height')), height);
  assert.ok(attr(image, 'alt')?.length > 20, 'Launcher image needs a meaningful description');
  const css = await readFile(new URL('../assets/css/frame.css', import.meta.url), 'utf8');
  assert.equal((css.match(/@font-face\s*\{/g) || []).length, 2);
  assert.match(css, /font-display:\s*swap/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /\.frame-screenshot img\s*\{[^}]*height:\s*auto/);
});

test('Frame uses the site icon and keeps client source out of the public product assets', async () => {
  const favicon = tags(page).find(tag => /^<link\b/i.test(tag) && attr(tag, 'rel') === 'icon');
  assert.ok(favicon, 'The product page needs the shared site icon');
  assert.equal(new URL(attr(favicon, 'href'), pageURL).pathname, '/assets/icons/favicon.svg');
  assert.match(page, /class="brand-mark">\s*g\.\s*<\/span>/);
  assert.equal((await stat(path.join(root, 'frame')).catch(() => null)), null, 'The obsolete root-level route remains');
  const allowed = new Set(['.html', '.css', '.svg', '.png', '.ttf', '.txt', '.json']);
  async function checkFiles(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await checkFiles(file);
      else assert.ok(allowed.has(path.extname(entry.name)), `Non-public product file: ${path.relative(root, file)}`);
    }
  }
  await checkFiles(path.join(root, 'projects/frame'));
  await checkFiles(path.join(root, 'assets/frame'));
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /client source is private and is not part of this website/);
});

test('Frame is discoverable from every project menu, the home destinations and sitemap', async () => {
  const pages = await htmlFiles();
  assert.ok(pages.length >= 7, 'Expected the existing shared site pages');
  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    if (path.relative(root, file).split(path.sep).join('/') === 'editor/app/index.html') {
      assert.doesNotMatch(html, /id="site-header"/, 'The standalone editor must remain fullscreen');
      continue;
    }
    const panel = html.match(/<div\b[^>]*id="projects-panel"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    assert.ok(panel, `Projects menu missing from ${path.relative(root, file)}`);
    const links = [...panel.matchAll(/<a\b[^>]*href="\/projects\/frame\/"[^>]*>([\s\S]*?)<\/a>/gi)];
    assert.equal(links.length, 1, `Expected one Frame project link in ${path.relative(root, file)}`);
    assert.equal(plain(links[0][1]), 'Frame');
    for (const [href, label] of [['/projects/astral/', 'Astral'], ['/projects/ark/', 'Ark'], ['/projects/', 'All projects']]) {
      const expected = [...panel.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].filter(link => link[1] === href);
      assert.equal(expected.length, 1, `Expected one ${label} link in ${path.relative(root, file)}`);
      assert.equal(plain(expected[0][2]), label);
    }
  }
  const home = await readFile(path.join(root, 'index.html'), 'utf8');
  const mainHome = home.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  assert.match(mainHome, /<a\b[^>]*href="\/projects\/frame\/"[^>]*>[\s\S]*?destination-name[^>]*>Frame/);
  const projects = await readFile(path.join(root, 'projects/index.html'), 'utf8');
  assert.match(projects, /<a\b[^>]*href="\/projects\/frame\/"[^>]*>\s*<h2>Frame<\/h2>/);
  const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>https:\/\/gideoncox\.com\/projects\/frame\/<\/loc>/g) || []).length, 1);
});
