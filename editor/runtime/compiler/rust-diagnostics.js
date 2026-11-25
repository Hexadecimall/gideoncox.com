import { sourceDigest } from '../rust/diagnostics.js?v=1';

const decoder = new TextDecoder();
const levels = new Map([['error', 1], ['warning', 2]]);
const LIMIT = 400;

function workspacePath(path, sources) {
  if (!path.startsWith('/workspace/')) return null;
  const relative = path.slice('/workspace/'.length);
  return sources.has(relative) ? relative : null;
}

function findSpan(span, directory, sources) {
  for (let depth = 0; span && depth < 8; depth++, span = span.expansion?.span) {
    if (typeof span.file_name !== 'string') continue;
    const file = span.file_name.replace(/^(?:\.\/)+/, '');
    if (file.split('/').includes('..')) continue;
    const path = workspacePath(file.startsWith('/') ? file : `${directory}/${file}`, sources);
    if (path) return { path, span };
  }
  return null;
}

function position(lines, line, column) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) return null;
  // Rust's JSON columns count Unicode scalar values. Zed uses UTF-16 positions.
  return { line: line - 1, character: Array.from(lines[line - 1]).slice(0, column - 1).join('').length };
}

export async function cargoDiagnostics(cwd, files, messages) {
  const sources = new Map(files.map(([path, bytes]) => [path.slice(cwd.length + 1), bytes]));
  const diagnostics = new Map();
  let count = 0;
  for (const { directory, message } of messages) {
    if (typeof directory !== 'string' || (directory !== '/workspace' && !directory.startsWith('/workspace/'))
      || !levels.has(message?.level) || typeof message.message !== 'string') continue;
    for (const span of message.spans ?? []) {
      if (!span.is_primary) continue;
      const found = findSpan(span, directory, sources);
      if (!found) continue;
      const { path, span: location } = found;
      let file = diagnostics.get(path);
      if (!file) {
        file = { items: [], lines: decoder.decode(sources.get(path)).split(/\r?\n/) };
        diagnostics.set(path, file);
      }
      const start = position(file.lines, location.line_start, location.column_start);
      const end = position(file.lines, location.line_end, location.column_end);
      if (!start || !end) continue;
      const code = typeof message.code?.code === 'string' ? message.code.code : undefined;
      file.items.push({ range: { start, end }, message: message.message, code,
        severity: levels.get(message.level), source: code?.startsWith('clippy::') ? 'clippy' : 'rustc' });
      if (++count >= LIMIT) break;
    }
    if (count >= LIMIT) break;
  }
  return Promise.all([...diagnostics].filter(([, file]) => file.items.length).map(async ([path, file]) => ({
    path: `${cwd}/${path}`, digest: await sourceDigest(sources.get(path)), items: file.items,
  })));
}
