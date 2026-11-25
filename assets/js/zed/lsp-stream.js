const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_HEADER = 8192;
const MAX_BODY = 16 * 1024 * 1024;

export function joinBytes(chunks) {
  if (chunks.length < 2) return chunks[0] ?? new Uint8Array();
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function lspFrame(message) {
  const body = encoder.encode(JSON.stringify(message));
  if (body.byteLength > MAX_BODY) throw new Error('Language server message exceeds 16 MiB.');
  return joinBytes([encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`), body]);
}

export class LspFrames {
  constructor() {
    this.buffer = new Uint8Array();
    this.length = null;
  }

  push(chunk) {
    this.buffer = joinBytes([this.buffer, new Uint8Array(chunk)]);
    const messages = [];
    while (this.buffer.length) {
      if (this.length === null) {
        let end = -1;
        for (let i = 0; i + 3 < this.buffer.length && i < MAX_HEADER; i++) {
          const b = this.buffer;
          if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) {
            end = i;
            break;
          }
        }
        if (end < 0) {
          if (this.buffer.length > MAX_HEADER + 3) throw new Error('Invalid language server header.');
          break;
        }
        const header = decoder.decode(this.buffer.subarray(0, end));
        const match = /^Content-Length:[ \t]*(\d+)[ \t]*$/im.exec(header);
        const length = Number(match?.[1]);
        if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BODY) {
          throw new Error('Invalid language server message length.');
        }
        this.length = length;
        this.buffer = this.buffer.subarray(end + 4);
      }
      if (this.buffer.length < this.length) break;
      messages.push(JSON.parse(decoder.decode(this.buffer.subarray(0, this.length))));
      this.buffer = this.buffer.subarray(this.length);
      this.length = null;
    }
    return messages;
  }
}

function offset(text, { line, character }) {
  let index = 0;
  for (let count = 0; count < line; count++) {
    const lineEnd = text.indexOf('\n', index);
    if (lineEnd === -1) return text.length;
    index = lineEnd + 1;
  }
  const nextLine = text.indexOf('\n', index);
  return Math.min(index + character, nextLine < 0 ? text.length : nextLine);
}

export function applyDocumentChanges(text, changes) {
  for (const { range, text: replacement } of changes) {
    text = range ? text.slice(0, offset(text, range.start)) + replacement
      + text.slice(offset(text, range.end)) : replacement;
  }
  return text;
}

export function documentReplacement(text, formatted) {
  if (text === formatted) return [];
  const lines = text.split('\n');
  const end = { line: lines.length - 1, character: lines.at(-1).length };
  return [{ range: { start: { line: 0, character: 0 }, end }, newText: formatted }];
}
