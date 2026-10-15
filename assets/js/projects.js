for (const button of document.querySelectorAll('[data-copy-command]')) {
  button.addEventListener('click', async () => {
    const command = document.getElementById(button.dataset.copyCommand);
    try {
      await navigator.clipboard.writeText(command.textContent);
      button.textContent = 'copied';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(command);
      selection.removeAllRanges(); selection.addRange(range);
      button.textContent = 'selected';
    }
    setTimeout(() => { button.textContent = 'copy'; }, 1600);
  });
}
