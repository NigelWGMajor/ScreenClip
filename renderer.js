console.log('Renderer process loaded');

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

// Initial opacity value (10% as per current CSS)
let currentOpacity = 0.1;
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

// Mouse wheel event to adjust opacity
document.addEventListener('wheel', (event) => {
  event.preventDefault(); // Prevent default scroll behavior
  
  const body = document.querySelector('body');
  const delta = event.deltaY > 0 ? -0.05 : 0.05; // Scroll down decreases opacity, up increases
  
  currentOpacity += delta;

  // Clamp opacity between 0.05 and 0.95
  currentOpacity = Math.max(0.05, Math.min(0.95, currentOpacity));
  
  // Apply the new opacity to the background color
  body.style.backgroundColor = `rgba(255, 255, 255, ${currentOpacity})`;
  
  console.log(`Opacity adjusted to: ${currentOpacity.toFixed(2)}`);
});
