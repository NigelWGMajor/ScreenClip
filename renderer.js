console.log('Renderer process loaded');

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

// Initial opacity value (15% to match CSS)
let currentOpacity = 0.15;
let currentScaleFactor = 1; // Track DPI scale factor

// Set initial opacity when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const body = document.querySelector('body');
  body.style.opacity = currentOpacity;
  console.log(`Initial opacity set to: ${currentOpacity}`);
});

ipcRenderer.on('toggle-border', () => {
  console.log('Toggle border event received in renderer');
  const body = document.querySelector('body');
  const currentBorderColor = body.style.borderColor;
  console.log('Current border color:', currentBorderColor);

  if (currentBorderColor === 'transparent' || currentBorderColor === '' || !currentBorderColor) {
    body.style.borderWidth = '2px';
    body.style.borderStyle = 'solid';
    body.style.borderColor = 'red';
    console.log('Border turned on (red)');
  } else {
    body.style.borderWidth = '2px'; // Keep the width
    body.style.borderStyle = 'solid'; // Keep the style
    body.style.borderColor = 'transparent'; // Just make it transparent
    console.log('Border turned off (transparent)');
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
    
    console.log('Received cropInfo:', cropInfo ? 'YES' : 'NO');
    
    if (cropInfo && cropInfo.fullScreenshot) {
      console.log('Full screenshot data length:', cropInfo.fullScreenshot.length);
      console.log('Scale factor:', cropInfo.scaleFactor);
      
      // Use the scale factor from the capture
      const scaleFactor = cropInfo.scaleFactor;
      
      // Apply the FULL screenshot as background image (not cropped)
      const body = document.querySelector('body');
      body.style.backgroundImage = `url(${cropInfo.fullScreenshot})`;
      body.style.backgroundRepeat = 'no-repeat';
      
      // Scale the image to display at 1:1 scale (actual screen size in CSS pixels)
      // The screenshot is in physical pixels, so we need to scale it down by the scale factor
      const actualScreenWidth = cropInfo.screenshotSize.width / scaleFactor;
      const actualScreenHeight = cropInfo.screenshotSize.height / scaleFactor;
      body.style.backgroundSize = `${actualScreenWidth}px ${actualScreenHeight}px`;
      
      // Position the image so the window area appears centered initially
      // Apply a manual 2px compensation to counteract the consistent offset (move up and left)
      const initialX = -Math.floor(cropInfo.windowX / scaleFactor) - 2;
      const initialY = -Math.floor(cropInfo.windowY / scaleFactor) - 2;
      
      body.style.backgroundPosition = `${initialX}px ${initialY}px`;
      
      // Reset and set image offset to the initial position
      imageOffset = { x: initialX, y: initialY };
      
      // Store scale factor for future drag calculations
      currentScaleFactor = scaleFactor;
      
      console.log(`Screenshot applied successfully!`);
      console.log(`- Scale factor: ${scaleFactor}`);
      console.log(`- Image size: ${actualScreenWidth}x${actualScreenHeight}px`);
      console.log(`- Initial position: ${initialX}, ${initialY}`);
      console.log(`- Screenshot size: ${cropInfo.screenshotSize.width}x${cropInfo.screenshotSize.height}`);
      
      // Test if the background image was actually set
      const appliedBg = getComputedStyle(body).backgroundImage;
      console.log('Background image applied:', appliedBg !== 'none' ? 'YES' : 'NO');
      
    } else {
      console.error('Failed to capture screenshot - cropInfo is null or missing fullScreenshot');
    }
  } catch (error) {
    console.error('Error during screenshot capture:', error);
  }
});

// Window and image dragging functionality
let isDragging = false;
let dragInfo = null;
let isImageDrag = false;
let imageOffset = { x: 0, y: 0 }; // Track image position offset
let rightClickDragStarted = false; // Track if right-click actually started a drag

document.addEventListener('mousedown', async (event) => {
  if (event.button === 0) {
    // Left-click: Window drag
    isDragging = true;
    isImageDrag = false;
    
    try {
      dragInfo = await ipcRenderer.invoke('start-drag', {
        mouseX: event.clientX,
        mouseY: event.clientY
      });
      console.log('Window drag started:', dragInfo);
    } catch (error) {
      console.error('Failed to start window drag:', error);
      isDragging = false;
    }
  } else if (event.button === 2) {
    // Right-click: Image drag (only if there's a background image)
    const body = document.querySelector('body');
    const backgroundImage = getComputedStyle(body).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      isDragging = true;
      isImageDrag = true;
      rightClickDragStarted = false; // Reset flag
      
      dragInfo = {
        startX: event.clientX,
        startY: event.clientY,
        initialOffsetX: imageOffset.x,
        initialOffsetY: imageOffset.y
      };
      
      console.log('Image drag ready');
      // Don't prevent default here - wait for actual movement
    }
  }
});

document.addEventListener('mousemove', async (event) => {
  if (isDragging && dragInfo) {
    if (isImageDrag) {
      // Right-click drag: Move the background image
      const deltaX = event.clientX - dragInfo.startX;
      const deltaY = event.clientY - dragInfo.startY;
      
      // Only start dragging if mouse moved significantly (prevents accidental drag on simple right-click)
      if (!rightClickDragStarted && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        rightClickDragStarted = true;
        console.log('Image drag started');
      }
      
      if (rightClickDragStarted) {
        imageOffset.x = dragInfo.initialOffsetX + deltaX;
        imageOffset.y = dragInfo.initialOffsetY + deltaY;
        
        const body = document.querySelector('body');
        body.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;
        
        console.log(`Image offset: ${imageOffset.x}, ${imageOffset.y}`);
      }
    } else {
      // Left-click drag: Move the window
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
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    dragInfo = null;
    console.log(isImageDrag ? 'Image drag ended' : 'Window drag ended');
    isImageDrag = false;
    rightClickDragStarted = false; // Reset flag
  }
});

// Only prevent context menu if we actually started dragging an image
document.addEventListener('contextmenu', (event) => {
  if (rightClickDragStarted) {
    event.preventDefault(); // Only prevent if we actually dragged
  }
  // Otherwise, allow normal context menu
});
