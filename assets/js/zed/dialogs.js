import { BROWSER_ROOT, browserPath, importPaths } from './paths.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Browser platform dialogs only; Zed itself owns workspace, tabs and editor UI. */
export function installFileDialogs(zed) {
  let active = false;
  async function prompt(mode, options = {}) {
    if (active) return null;
    active = true;
    let dialog;
    try {
      const entries = JSON.parse(await zed.list_browser_paths());
      dialog = element('dialog', '', 'browser-file-dialog');
      const title = element('h2', mode === 'save' ? 'Save file' : options.prompt || 'Open');
      title.id = 'browser-dialog-title';
      dialog.setAttribute('aria-labelledby', title.id);
      const form = element('form');
      form.method = 'dialog';
      const location = element('label', 'browser');
      const paths = element('select');
      paths.setAttribute('aria-label', 'Browser files');
      paths.size = 9;
      paths.multiple = Boolean(options.multiple);
      if (mode === 'open' && options.directories) paths.append(new Option('browser/', BROWSER_ROOT));
      for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
        if (entry.path === BROWSER_ROOT) continue;
        if (mode === 'save' || (entry.isDirectory ? options.directories : options.files)) {
          paths.append(new Option(entry.path.slice(BROWSER_ROOT.length + 1) + (entry.isDirectory ? '/' : ''), entry.path));
        }
      }
      location.append(paths);
      const name = element('input');
      name.setAttribute('aria-label', 'File name');
      name.placeholder = 'File name';
      name.value = options.suggestedName || 'untitled.txt';
      name.hidden = mode !== 'save';
      const error = element('p', '', 'dialog-error');
      error.setAttribute('role', 'status');
      const imports = element('div', '', 'dialog-imports');
      const actions = element('div', '', 'dialog-actions');
      const cancel = element('button', 'Cancel');
      cancel.type = 'button';
      const accept = element('button', mode === 'save' ? 'Save' : 'Open');
      accept.type = 'submit';
      actions.append(cancel, accept);
      form.append(title, location, name, imports, error, actions);
      dialog.append(form); document.body.append(dialog);
      return await new Promise(resolve => {
        let value = null;
        let importing = false;
        let pendingImport = null;
        let overwritePath = '';
        const finish = result => { value = result; dialog.close(); };
        dialog.addEventListener('close', () => resolve(value), { once: true });
        cancel.addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); });
        paths.addEventListener('change', () => {
          pendingImport = null; overwritePath = ''; error.textContent = '';
          accept.textContent = mode === 'save' ? 'Save' : 'Open';
          if (mode === 'save' && paths.value) {
            const entry = entries.find(entry => entry.path === paths.value);
            name.value = entry?.isDirectory ? `${paths.value}/${name.value.split('/').pop() || 'untitled.txt'}` : paths.value;
          }
        });
        name.addEventListener('input', () => { overwritePath = ''; accept.textContent = 'Save'; });
        async function importFiles(files) {
          const destinations = importPaths(files);
          const collisions = entries.filter(entry => destinations.includes(entry.path));
          if (collisions.some(entry => entry.isDirectory)) throw new Error('A directory already uses one of these names.');
          if (collisions.length && !pendingImport) {
            pendingImport = { files, destinations };
            error.textContent = `Replace ${collisions.length} existing file${collisions.length === 1 ? '' : 's'}?`;
            accept.textContent = 'Replace and import';
            return;
          }
          importing = true;
          for (const control of form.querySelectorAll('button, input, select')) control.disabled = true;
          try {
            for (let i = 0; i < files.length; i++) {
              error.textContent = `Importing ${i + 1} / ${files.length}`;
              await zed.write_browser_file(destinations[i], new Uint8Array(await files[i].arrayBuffer()));
            }
            const roots = options.directories && files[0].webkitRelativePath
              ? [...new Set(destinations.map(path => BROWSER_ROOT + '/' + path.slice(BROWSER_ROOT.length + 1).split('/')[0]))]
              : destinations;
            finish(options.multiple ? roots : roots.slice(0, 1));
          } finally {
            importing = false;
            for (const control of form.querySelectorAll('button, input, select')) control.disabled = false;
          }
        }
        function importButton(folder) {
          const button = element('button', folder ? 'Import folder…' : 'Import files…');
          button.type = 'button';
          const picker = element('input'); picker.type = 'file'; picker.hidden = true;
          picker.multiple = folder || Boolean(options.multiple);
          if (folder) picker.setAttribute('webkitdirectory', '');
          button.addEventListener('click', () => picker.click());
          picker.addEventListener('change', async () => {
            const files = [...picker.files]; picker.value = ''; pendingImport = null;
            if (!files.length) return;
            try { await importFiles(files); }
            catch (failure) { error.textContent = failure.message || String(failure); }
          });
          imports.append(button, picker);
        }
        if (mode === 'open' && options.files) importButton(false);
        if (mode === 'open' && options.directories) importButton(true);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          try {
            if (pendingImport) { await importFiles(pendingImport.files); return; }
            if (mode === 'save') {
              const path = browserPath(name.value.trim(), options.directory);
              const existing = entries.find(entry => entry.path === path);
              if (existing?.isDirectory) throw new Error('This name is already a directory.');
              if (existing && overwritePath !== path) {
                overwritePath = path; error.textContent = 'Replace this file?'; accept.textContent = 'Replace'; return;
              }
              finish(path);
            } else {
              const selected = [...paths.selectedOptions].map(option => option.value);
              if (selected.length) finish(selected);
              else error.textContent = 'Choose a file or folder.';
            }
          } catch (failure) { error.textContent = failure.message || String(failure); }
        });
        dialog.showModal();
        if (mode === 'save') { name.focus(); name.select(); } else paths.focus();
      });
    } finally {
      dialog?.remove();
      active = false;
    }
  }
  globalThis.zedBrowserDialogs = {
    openPaths: options => prompt('open', options),
    savePath: (directory, suggestedName) => prompt('save', { directory, suggestedName }),
  };
}
