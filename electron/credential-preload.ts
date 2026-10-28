import { ipcRenderer } from 'electron';
ipcRenderer.on('credentials:failed', () => { const notice = document.createElement('p'); notice.textContent = 'No se guardó: credencial inválida o cifrado no disponible.'; document.body.append(notice); });
// Only the main-created, local credential window loads this preload. No secret
// reader or provider resolver is exposed to its page or the ordinary shell.
window.addEventListener('DOMContentLoaded', () => {
  document.querySelector('form')?.addEventListener('submit', event => {
    event.preventDefault();
    const field = document.querySelector<HTMLInputElement>('input[type=password]');
    if (!field || !event.isTrusted) return;
    const value = field.value; field.value = '';
    ipcRenderer.send('credentials:submit', value);
  });
});
