// Command editing is separate from shell execution and terminal rendering.
export class LineBuffer {
  text = '';
  cursor = 0;

  replace(text) { this.text = text; this.cursor = text.length; }
  insert(text) {
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
  }
  move(direction) {
    if (direction < 0 && this.cursor) this.cursor -= Array.from(this.text.slice(0, this.cursor)).at(-1).length;
    else if (direction > 0 && this.cursor < this.text.length) this.cursor += Array.from(this.text.slice(this.cursor))[0].length;
  }
  backspace() {
    const end = this.cursor;
    this.move(-1);
    this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
  }
  delete() {
    const start = this.cursor;
    this.move(1);
    this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
    this.cursor = start;
  }
  deleteWord() {
    const start = this.text.slice(0, this.cursor).replace(/\S*\s*$/, '').length;
    this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
    this.cursor = start;
  }
}
