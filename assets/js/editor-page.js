import './terminal/client.js';
import './editor.js';

const file = new URLSearchParams(location.search).get('file');
if (file) {
  window.siteFilesReady.then(() => {
    window.dispatchEvent(new CustomEvent('open-site-editor', { detail: { path: file } }));
  }).catch(() => {});
}
