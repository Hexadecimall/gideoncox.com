import { comparePosition, sourceDigest } from '../rust/diagnostics.js?v=quickfix-1';

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
    const path = spanPath(span, directory, sources);
    if (path) return { path, span };
  }
  return null;
}

function spanPath(span, directory, sources) {
  if (typeof span.file_name !== 'string') return null;
  const file = span.file_name.replace(/^(?:\.\/)+/, '');
  if (file.split('/').includes('..')) return null;
  return workspacePath(file.startsWith('/') ? file : `${directory}/${file}`, sources);
}

function position(lines, line, column) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) return null;
  // Rust's JSON columns count Unicode scalar values. Zed uses UTF-16 positions.
  const characters = Array.from(lines[line - 1]);
  if (column > characters.length + 1) return null;
  return { line: line - 1, character: characters.slice(0, column - 1).join('').length };
}

function spanRange(lines, span) {
  const start = position(lines, span.line_start, span.column_start);
  const end = position(lines, span.line_end, span.column_end);
  return start && end && comparePosition(start, end) <= 0 ? { start, end } : null;
}

function suggestions(children, sourceFile) {
  const fixes = [];
  for (const child of children ?? []) {
    if (fixes.length === 12) break;
    const spans = child.spans?.filter(span => span.suggested_replacement != null);
    if (!spans?.length || spans.length > 32 || typeof child.message !== 'string') continue;
    const files = new Map();
    for (const span of spans) {
      const file = span.suggestion_applicability === 'MachineApplicable' && sourceFile(span);
      const range = file && spanRange(file.lines, span);
      if (!range || typeof span.suggested_replacement !== 'string') {
        files.clear();
        break;
      }
      if (!files.has(file)) files.set(file, []);
      files.get(file).push({ range, newText: span.suggested_replacement });
    }
    if (!files.size) continue;
    if ([...files.values()].some(edits => {
      edits.sort((a, b) => comparePosition(a.range.start, b.range.start));
      return edits.some(({ range }, index) => index > 0 && comparePosition(edits[index - 1].range.end, range.start) > 0);
    })) continue;
    fixes.push({ title: child.message, files });
  }
  return fixes;
}

export async function cargoDiagnostics(cwd, files, messages) {
  const sources = new Map(files.map(([path, bytes]) => [path.slice(cwd.length + 1), bytes]));
  const diagnostics = new Map();
  const sourceFiles = new Map();
  const sourceFile = path => {
    if (path && !sourceFiles.has(path)) {
      const bytes = sources.get(path);
      sourceFiles.set(path, { path: `${cwd}/${path}`, lines: decoder.decode(bytes).split(/\r?\n/),
        digest: sourceDigest(bytes) });
    }
    return sourceFiles.get(path);
  };
  let count = 0;
  for (const { directory, message } of messages) {
    if (typeof directory !== 'string' || (directory !== '/workspace' && !directory.startsWith('/workspace/'))
      || !levels.has(message?.level) || typeof message.message !== 'string') continue;
    let fixes;
    for (const span of message.spans ?? []) {
      if (!span.is_primary) continue;
      const found = findSpan(span, directory, sources);
      if (!found) continue;
      const { path, span: location } = found;
      const file = sourceFile(path);
      const range = spanRange(file.lines, location);
      if (!range) continue;
      if (!diagnostics.has(file)) diagnostics.set(file, []);
      const code = typeof message.code?.code === 'string' ? message.code.code : undefined;
      const source = code?.startsWith('clippy::') ? 'clippy' : 'rustc';
      fixes ??= suggestions(message.children, span => sourceFile(spanPath(span, directory, sources)));
      diagnostics.get(file).push({ range, message: message.message, code, severity: levels.get(message.level), source, fixes });
      if (++count >= LIMIT) break;
    }
    if (count >= LIMIT) break;
  }
  return Promise.all([...diagnostics].map(async ([file, items]) => ({
    path: file.path, digest: await file.digest, items: await Promise.all(items.map(async ({ fixes, ...item }) => {
      if (fixes.length) item.fixes = await Promise.all(fixes.map(async ({ title, files }) => ({
        title, files: await Promise.all([...files].map(async ([file, edits]) => ({
          path: file.path, digest: await file.digest, edits,
        }))),
      })));
      return item;
    })),
  })));
}
