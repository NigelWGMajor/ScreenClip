const { ipcRenderer } = require('electron');

console.log('Renderer process loaded');

ipcRenderer.on('toggle-border', () => {
  const body = document.querySelector('body');
  const currentBorder = getComputedStyle(body).borderWidth;

  if (currentBorder === '0px') {
    body.style.borderWidth = '2px';
    body.style.borderColor = 'red';
  } else {
    body.style.borderWidth = '0px';
    body.style.borderColor = 'transparent';
  }
});
