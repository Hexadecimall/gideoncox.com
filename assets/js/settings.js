const form = document.querySelector('#preferences');
const status = document.querySelector('#preferences-status');
function fill() {
  const values = window.sitePreferences.values;
  for (const field of form.elements) {
    if (!(field.name in values)) continue;
    if (field.type === 'checkbox') field.checked = values[field.name];
    else field.value = values[field.name];
    const output = form.querySelector(`output[for="${field.id}"]`);
    if (output) output.textContent = field.value;
  }
}
form.addEventListener('input', event => {
  const field = event.target;
  if (!field.name) return;
  const value = field.type === 'checkbox' ? field.checked : (['number', 'range'].includes(field.type) || field.name === 'editorTabSize') ? Number(field.value) : field.value;
  try { window.sitePreferences.update({ [field.name]: value }); status.textContent = 'Saved in this browser.'; }
  catch { status.textContent = 'Browser storage is unavailable. This change only lasts for this page.'; }
  const output = form.querySelector(`output[for="${field.id}"]`);
  if (output) output.textContent = field.value;
});
form.addEventListener('submit', event => event.preventDefault());
document.querySelector('#preferences-reset').addEventListener('click', () => {
  window.sitePreferences.reset(); fill(); status.textContent = 'Default settings restored.';
});
window.addEventListener('site-preferences-changed', fill);
fill();
