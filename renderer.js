console.log('Renderer process loaded');

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

// Initial opacity value (15% to match CSS)
let currentOpacity = 0.15;

// Set initial opacity when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const body = document.querySelector('body');
  body.style.opacity = currentOpacity;
  console.log(`Initial opacity set to: ${currentOpacity}`);
});

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
  console.log('Mouse wheel event detected, deltaY:', event.deltaY);
  event.preventDefault(); // Prevent default scroll behavior
  
  const body = document.querySelector('body');
  const delta = event.deltaY > 0 ? -0.05 : 0.05; // Scroll down decreases opacity, up increases
  
  currentOpacity += delta;

  // Clamp opacity between 0.05 and 0.95
  currentOpacity = Math.max(0.05, Math.min(0.95, currentOpacity));
  
  // Apply opacity to the entire body (affects both background color and background image)
  body.style.opacity = currentOpacity;
  
  console.log(`Opacity adjusted to: ${currentOpacity.toFixed(2)}`);
});

// Double-click event to capture screenshot
document.addEventListener('dblclick', async (event) => {
  console.log('Double-click detected, capturing screenshot...');
  
  try {
    // Request screenshot from main process
    const cropInfo = await ipcRenderer.invoke('capture-screenshot');
    
    if (cropInfo && cropInfo.fullScreenshot) {
      // Create canvas to crop the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas size to window dimensions
      canvas.width = cropInfo.windowWidth;
      canvas.height = cropInfo.windowHeight;
      
      // Create image from full screenshot
      const img = new Image();
      
      const croppedDataURL = await new Promise((resolve) => {
        img.onload = () => {
          // Draw the cropped portion of the screenshot
          ctx.drawImage(
            img,
            cropInfo.windowX, cropInfo.windowY, cropInfo.windowWidth, cropInfo.windowHeight, // Source rectangle
            0, 0, cropInfo.windowWidth, cropInfo.windowHeight                                 // Destination rectangle
          );
          
          resolve(canvas.toDataURL());
        };
        img.src = cropInfo.fullScreenshot;
      });
      
      // Apply the cropped screenshot as background image
      const body = document.querySelector('body');
      body.style.backgroundImage = `url(${croppedDataURL})`;
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundRepeat = 'no-repeat';
      
      console.log('Screenshot captured and applied as background');
    } else {
      console.error('Failed to capture screenshot');
    }
  } catch (error) {
    console.error('Error during screenshot capture:', error);
  }
});

// Window dragging functionality
let isDragging = false;
let dragInfo = null;

document.addEventListener('mousedown', async (event) => {
  // Only start drag on left mouse button
  if (event.button === 0) {
    isDragging = true;
    
    try {
      dragInfo = await ipcRenderer.invoke('start-drag', {
        mouseX: event.clientX,
        mouseY: event.clientY
      });
      console.log('Drag started:', dragInfo);
    } catch (error) {
      console.error('Failed to start drag:', error);
      isDragging = false;
    }
  }
});

document.addEventListener('mousemove', async (event) => {
  if (isDragging && dragInfo) {
    const newX = event.screenX - dragInfo.offsetX;
    const newY = event.screenY - dragInfo.offsetY;
    
    try {
      await ipcRenderer.invoke('do-drag', {
        x: newX,
        y: newY,
        targetWidth: dragInfo.targetWidth,
        targetHeight: dragInfo.targetHeight
      });
    } catch (error) {
      console.error('Failed to drag window:', error);
    }
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    dragInfo = null;
    console.log('Drag ended');
  }
});
