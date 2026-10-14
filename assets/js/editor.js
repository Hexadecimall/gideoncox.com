const root = document.querySelector('#editor');

if (root) {
  root.innerHTML = `
    <header class="tool-heading editor-heading"><h3>Editor</h3><div class="editor-heading-actions">
      <button class="tool-button" type="button" data-action="new">New file</button>
      <button class="tool-button" type="button" data-action="folder">New folder</button>
      <button class="tool-button" type="button" data-action="import">Import</button>
      <input class="editor-import" type="file" aria-label="Import a text file">
    </div></header>
    <div class="editor-layout">
      <aside class="editor-files" aria-label="Files"><div class="editor-directory"><button class="tool-button" type="button" data-action="up" aria-label="Parent directory">..</button><span></span></div><div class="editor-files-list"></div></aside>
      <div class="editor-document">
        <div class="editor-document-bar"><span class="editor-path">No file open</span><div class="editor-actions">
          <button class="tool-button" type="button" data-action="save" disabled>Save</button>
          <button class="tool-button" type="button" data-action="reload" disabled>Reload</button>
          <button class="tool-button" type="button" data-action="rename" disabled>Rename</button>
          <button class="tool-button" type="button" data-action="find" disabled>Find</button>
          <button class="tool-button" type="button" data-action="export" disabled>Export</button>
        </div></div>
        <form class="editor-input-row editor-name-form" hidden><label for="editor-filename">File name</label><input id="editor-filename" autocomplete="off" spellcheck="false" required><button class="tool-button" type="submit">Create</button><button class="tool-button" type="button" data-action="cancel-name">Cancel</button></form>
        <form class="editor-input-row editor-find-form" hidden><label for="editor-search">Find</label><input id="editor-search" autocomplete="off" spellcheck="false"><button class="tool-button" type="submit">Next</button><button class="tool-button" type="button" data-action="close-find">Close</button></form>
        <div class="editor-surface"><pre class="editor-gutter" aria-hidden="true">1</pre><textarea class="editor-text" aria-label="File contents" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" disabled></textarea></div>
        <div class="editor-status"><span role="status" aria-live="polite">Loading files…</span><span class="editor-position">Ln 1, Col 1</span></div>
      </div>
    </div>`;

  const text = root.querySelector('.editor-text');
  const gutter = root.querySelector('.editor-gutter');
  const pathLabel = root.querySelector('.editor-path');
  const directoryLabel = root.querySelector('.editor-directory span');
  const filesList = root.querySelector('.editor-files-list');
  const status = root.querySelector('[role="status"]');
  const position = root.querySelector('.editor-position');
  const nameForm = root.querySelector('.editor-name-form');
  const nameInput = root.querySelector('#editor-filename');
  const findForm = root.querySelector('.editor-find-form');
  const findInput = root.querySelector('#editor-search');
  const importInput = root.querySelector('.editor-import');
  let directory = '/home/web';
  let currentPath = null;
  let savedText = '';
  let formAction = 'new';
  let refreshVersion = 0;
  let savePending = false;
  let available = false;
  let openVersion = 0;

  const dirty = () => currentPath !== null && text.value !== savedText;
  const parent = path => path.slice(0, path.lastIndexOf('/')) || '/';
  const filename = path => path.slice(path.lastIndexOf('/') + 1);
  const child = name => `${directory === '/' ? '' : directory}/${name}`;
  const notify = (message, error = false) => {
    status.textContent = message;
    status.parentElement.dataset.error = String(error);
  };
  const request = (action, args) => window.siteFiles.request(action, args);
  const mayDiscard = () => !dirty() || window.confirm(`Discard unsaved changes to ${filename(currentPath)}?`);

  function updateDocument() {
    pathLabel.textContent = currentPath ? `${currentPath}${dirty() ? ' •' : ''}` : 'No file open';
    pathLabel.dataset.dirty = String(dirty());
    for (const action of ['save', 'reload', 'rename', 'find', 'export']) {
      root.querySelector(`[data-action="${action}"]`).disabled = !currentPath || (action === 'save' && savePending);
    }
    gutter.textContent = Array.from({length: text.value.split('\n').length}, (_, index) => index + 1).join('\n');
    gutter.scrollTop = text.scrollTop;
    const preceding = text.value.slice(0, text.selectionStart).split('\n');
    position.textContent = `Ln ${preceding.length}, Col ${preceding.at(-1).length + 1}`;
  }

  async function refreshFiles() {
    if (!available) return;
    const version = ++refreshVersion;
    try {
      const entries = await request('list', {path: directory});
      if (version !== refreshVersion) return;
      directoryLabel.textContent = directory;
      filesList.replaceChildren();
      entries.sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
      for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-file';
        button.textContent = entry.name + (entry.directory ? '/' : '');
        button.setAttribute('aria-current', String(entry.path === currentPath));
        button.addEventListener('click', () => {
          if (entry.directory) { directory = entry.path; refreshFiles(); }
          else openFile(entry.path);
        });
        filesList.append(button);
      }
      if (!entries.length) {
        const empty = document.createElement('span');
        empty.className = 'editor-file-empty';
        empty.textContent = 'Empty folder';
        filesList.append(empty);
      }
    } catch (error) { notify(error.message || String(error), true); }
  }

  async function openFile(path) {
    if (!mayDiscard()) return;
    const version = ++openVersion;
    try {
      const contents = await request('read', {path});
      if (version !== openVersion) return;
      currentPath = path;
      directory = parent(path);
      savedText = contents;
      text.value = contents;
      text.disabled = false;
      text.scrollTop = 0;
      text.setSelectionRange(0, 0);
      nameForm.hidden = true;
      updateDocument();
      await refreshFiles();
      notify('');
      text.focus({preventScroll: true});
    } catch (error) { notify(error.message || String(error), true); }
  }

  async function save() {
    if (!currentPath || savePending) return;
    const savingPath = currentPath;
    const contents = text.value;
    const previousContents = savedText;
    savePending = true;
    updateDocument();
    try {
      const latest = await request('read', {path: savingPath});
      if (latest !== previousContents) {
        notify('This file changed in Terminal. Export your edits or reload the saved file before saving.', true);
        return;
      }
      await request('write', {path: savingPath, text: contents});
      if (currentPath === savingPath) savedText = contents;
      notify(`Saved ${filename(savingPath)}`);
    } catch (error) { notify(error.message || String(error), true); }
    finally { savePending = false; updateDocument(); }
  }

  function showName(action) {
    if (!available) return;
    formAction = action;
    nameForm.hidden = false;
    nameForm.querySelector('label').textContent = action === 'folder' ? 'Folder name' : 'File name';
    nameForm.querySelector('[type="submit"]').textContent = action === 'rename' ? 'Rename' : 'Create';
    nameInput.value = action === 'rename' ? filename(currentPath) : '';
    nameInput.focus();
    nameInput.select();
  }

  nameForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name || name.includes('/') || name === '.' || name === '..' || /[\u0000-\u001f]/.test(name)) {
      notify('Enter a file name without slashes or control characters.', true); return;
    }
    if (formAction === 'new' && !mayDiscard()) return;
    const destination = formAction === 'rename' ? `${parent(currentPath) === '/' ? '' : parent(currentPath)}/${name}` : child(name);
    try {
      const siblings = await request('list', {path: parent(destination)});
      if (siblings.some(entry => entry.name === name) && !(formAction === 'rename' && destination === currentPath)) {
        notify('That name already exists.', true); return;
      }
      if (formAction === 'rename') {
        await request('rename', {from: currentPath, to: destination});
        currentPath = destination;
        updateDocument();
      } else if (formAction === 'folder') {
        await request('mkdir', {path: destination});
      } else {
        await request('write', {path: destination, text: ''});
        currentPath = null;
        await openFile(destination);
      }
      nameForm.hidden = true;
      notify('');
      await refreshFiles();
    } catch (error) { notify(error.message || String(error), true); }
  });

  findForm.addEventListener('submit', event => {
    event.preventDefault();
    const query = findInput.value;
    if (!query) return;
    let index = text.value.indexOf(query, text.selectionEnd);
    if (index < 0) index = text.value.indexOf(query);
    if (index < 0) { notify('No matches'); return; }
    text.focus();
    text.setSelectionRange(index, index + query.length);
    text.scrollTop = Math.max(0, (text.value.slice(0, index).split('\n').length - 3) * 20);
    updateDocument();
    notify('');
  });

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (['new', 'folder', 'rename'].includes(action)) showName(action);
    else if (action === 'save') save();
    else if (action === 'reload' && currentPath) openFile(currentPath);
    else if (action === 'up') { directory = parent(directory); refreshFiles(); }
    else if (action === 'cancel-name') nameForm.hidden = true;
    else if (action === 'find') { findForm.hidden = false; findInput.focus(); findInput.select(); }
    else if (action === 'close-find') { findForm.hidden = true; text.focus(); }
    else if (action === 'import') importInput.click();
    else if (action === 'export' && currentPath) {
      const url = URL.createObjectURL(new Blob([text.value], {type: 'text/plain;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename(currentPath);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });

  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file || !mayDiscard()) return;
    if (file.size > 512 * 1024) { notify('Text files up to 512 KiB are supported.', true); return; }
    try {
      const contents = await file.text();
      if (contents.includes('\0')) { notify('Choose a text file.', true); return; }
      const existing = await request('list', {path: directory});
      let name = file.name;
      let suffix = 1;
      while (existing.some(entry => entry.name === name)) name = `${file.name}.${suffix++}`;
      const path = child(name);
      await request('write', {path, text: contents});
      currentPath = null;
      await openFile(path);
      notify(`Imported ${name}`);
    } catch (error) { notify(error.message || String(error), true); }
  });

  const applyPreferences = () => {
    const preferences = window.sitePreferences?.values;
    text.wrap = preferences?.editorWrap ? 'soft' : 'off';
    gutter.hidden = Boolean(preferences?.editorWrap);
  };
  applyPreferences();
  window.addEventListener('site-preferences-changed', applyPreferences);
  text.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const width = window.sitePreferences?.values.editorTabSize || 2;
    const start = text.selectionStart;
    text.setRangeText(' '.repeat(width), start, text.selectionEnd, 'end');
    updateDocument();
  });
  text.addEventListener('input', updateDocument);
  text.addEventListener('select', updateDocument);
  text.addEventListener('click', updateDocument);
  text.addEventListener('keyup', updateDocument);
  text.addEventListener('scroll', () => { gutter.scrollTop = text.scrollTop; });
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && currentPath) {
      event.preventDefault(); findForm.hidden = false; findInput.focus(); findInput.select();
    }
    if (event.key === 'Escape') { nameForm.hidden = true; findForm.hidden = true; }
  });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('site-files-changed', () => {
    refreshFiles();
  });
  window.addEventListener('open-site-editor', async event => {
    try {
      await window.siteFilesReady;
      if (!window.siteFiles) throw new Error('File storage is unavailable.');
      root.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
      await openFile(event.detail.path);
    } catch (error) { notify(error.message || String(error), true); }
  });

  async function initialize() {
    try {
      await window.siteFilesReady;
      if (!window.siteFiles) throw new Error('File storage is unavailable.');
      available = true;
      await refreshFiles();
      notify('Open a file or create one. Files are shared with Terminal.');
    } catch (error) { notify(error.message || String(error), true); }
  }
  initialize();
}
