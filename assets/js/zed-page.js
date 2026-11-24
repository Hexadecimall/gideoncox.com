import { prepareEditorIsolation } from './zed/isolation.js';

const frame = document.querySelector('.zed-frame');
if (!await prepareEditorIsolation().catch(() => false)) frame.src = frame.dataset.src;
