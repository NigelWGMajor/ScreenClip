console.log('Renderer process loaded');

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

ipcRenderer.on('toggle-border', () => {
  console.log('Toggle border event received in renderer');
  const body = document.querySelector('body');
  const currentBorder = getComputedStyle(body).borderWidth;
  console.log('Current border width:', currentBorder);

  if (currentBorder === '0px' || currentBorder === '') {
    body.style.borderWidth = '2px';
    body.style.borderColor = 'red';
    console.log('Border turned on');
  } else {
    body.style.borderWidth = '0px';
    body.style.borderColor = 'transparent';
    console.log('Border turned off');
  }
});
