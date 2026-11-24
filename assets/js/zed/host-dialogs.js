/** Platform file picker for the folder explicitly shared by the local connector. */
export async function localFileDialog(host, mode, options = {}) {
  const root = host.projectRoot;
  let directory = options.directory?.startsWith(root + '/') ? options.directory : root;
  const dialog = document.createElement('dialog');
  dialog.className = 'browser-file-dialog';
  dialog.setAttribute('aria-label', mode === 'save' ? 'Save local file' : 'Open local project');
  dialog.innerHTML = `<form method="dialog">
    <h2></h2><div class="dialog-imports"><button type="button" data-up aria-label="Parent folder">↑</button><span data-directory></span></div>
    <select aria-label="Local project files" size="10"></select>
    <label data-name>File name<input aria-label="File name" spellcheck="false"></label>
    <p class="dialog-error" role="status"></p>
    <div class="dialog-actions"><button type="button" data-browser>Browser files</button><button type="button" data-cancel>Cancel</button><button type="submit"></button></div>
  </form>`;
  const form = dialog.querySelector('form');
  const select = dialog.querySelector('select');
  const input = dialog.querySelector('input');
  const error = dialog.querySelector('[role=status]');
  const accept = dialog.querySelector('[type=submit]');
  const up = dialog.querySelector('[data-up]');
  dialog.querySelector('h2').textContent = mode === 'save' ? 'Save file' : options.prompt || 'Open';
  accept.textContent = mode === 'save' ? 'Save' : 'Open';
  dialog.querySelector('[data-name]').hidden = mode !== 'save';
  input.value = options.suggestedName || 'untitled.txt';
  select.multiple = Boolean(options.multiple);
  let entries = new Map();
  let overwrite = '';
  let loading = false;

  async function load(path) {
    if (loading) return;
    loading = true;
    accept.disabled = true;
    error.textContent = '';
    try {
      const children = await host.fs('read_dir', { path });
      const metadata = await Promise.all(children.map(async child => [child, await host.fs('metadata', { path: child })]));
      directory = path;
      entries = new Map(metadata.filter(([, info]) => info));
      select.replaceChildren();
      if (mode === 'open' && options.directories) select.append(new Option('./', directory));
      for (const [child, info] of [...entries].sort((a, b) => Number(b[1].is_dir) - Number(a[1].is_dir) || a[0].localeCompare(b[0]))) {
        if (info.is_dir || options.files || mode === 'save') {
          select.append(new Option(child.slice(directory.length + 1) + (info.is_dir ? '/' : ''), child));
        }
      }
      dialog.querySelector('[data-directory]').textContent = directory === root ? root.split('/').pop() || '/' : directory.slice(root.length + 1);
      up.disabled = directory === root;
    } catch (failure) {
      error.textContent = failure.message || String(failure);
    } finally {
      loading = false;
      accept.disabled = false;
    }
  }

  document.body.append(dialog);
  try {
    return await new Promise(resolve => {
      let value = null;
      const finish = result => { value = result; dialog.close(); };
      dialog.addEventListener('close', () => resolve(value), { once: true });
      dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      dialog.querySelector('[data-browser]').addEventListener('click', () => finish('browser'));
      up.addEventListener('click', () => load(directory.slice(0, directory.lastIndexOf('/')) || root));
      select.addEventListener('dblclick', () => {
        if (entries.get(select.value)?.is_dir) load(select.value);
        else if (mode === 'open' && options.files && entries.has(select.value)) finish([select.value]);
      });
      select.addEventListener('change', () => {
        overwrite = '';
        if (mode === 'save' && entries.get(select.value) && !entries.get(select.value).is_dir) input.value = select.value.split('/').pop();
      });
      input.addEventListener('input', () => { overwrite = ''; accept.textContent = 'Save'; });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (loading) return;
        try {
          if (mode === 'save') {
            const name = input.value.trim();
            if (!name || name === '.' || name === '..' || /[\/\\\0]/.test(name)) throw new Error('Enter a file name without a directory.');
            const path = directory + '/' + name;
            const metadata = await host.fs('metadata', { path });
            if (metadata?.is_dir) throw new Error('A directory already uses this name.');
            if (metadata && overwrite !== path) {
              overwrite = path; error.textContent = 'Replace this file?'; accept.textContent = 'Replace'; return;
            }
            finish(path);
          } else {
            const selected = [...select.selectedOptions].map(option => option.value);
            if (!selected.length && options.directories) selected.push(directory);
            if (selected.length === 1 && entries.get(selected[0])?.is_dir && !options.directories) {
              await load(selected[0]); return;
            }
            const permitted = selected.filter(path => path === directory ? options.directories : entries.get(path)?.is_dir ? options.directories : options.files);
            if (!permitted.length) throw new Error('Choose a file or folder.');
            finish(options.multiple ? permitted : permitted.slice(0, 1));
          }
        } catch (failure) { error.textContent = failure.message || String(failure); }
      });
      dialog.showModal();
      load(directory);
      if (mode === 'save') { input.focus(); input.select(); } else select.focus();
    });
  } finally { dialog.remove(); }
}
