// Logging suppression / debug flag
const DEBUG = false; // Set to true for verbose diagnostic output
// Preserve original console methods
const __originalConsoleLog = console.log.bind(console);
// Override console.log to silence when DEBUG is false
console.log = (...args) => { if (DEBUG) __originalConsoleLog(...args); };
// Optional: gate other console methods individually if desired
// const __originalConsoleInfo = console.info.bind(console);
// console.info = (...args) => { if (DEBUG) __originalConsoleInfo(...args); };
// Leave console.error & console.warn untouched so real problems surface

// (Removed initial noisy startup log)

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

// Helper function to send debug messages to main process (so they show in terminal)
function debugLog(message) {
  if (!DEBUG) return; // Suppress forwarding when not debugging
  console.log(message);
  ipcRenderer.send('debug-log', message);
}

// Initial opacity value (15% to match CSS)
let currentOpacity = 0.15;
let currentScaleFactor = 1; // Track DPI scale factor

// Track current image scale for zoom functionality
let currentImageScale = 1.0;
let originalImageWidth = 0;
let originalImageHeight = 0;
let originalPositionX = 0;
let originalPositionY = 0;

// Track window scaling
let currentWindowScale = 1.0;
const baseWindowWidth = 1200;
const baseWindowHeight = 800;

// Track original window state for reset functionality
let originalWindowBounds = null;

// Track window position locally to avoid system reads during moves
// CRITICAL: This prevents drift by eliminating getBounds() calls during positioning
// Data flow is: tracked position → main process → screen (never read back)
let trackedWindowPosition = { x: 100, y: 100 }; // Will be initialized on load

// Debounce timer for auto-crop after scaling
let autoCropTimer = null;

// Drawing system variables
let drawingCanvas = null;
let drawingCtx = null;
let isDrawing = false;
let drawingMode = 'arrow'; // Default to arrow mode: 'arrow', 'box', 'rounded-box', 'text', 'fill'
let drawingStart = null;
let drawingCurrent = null;
let drawingColors = ['red', 'orange', 'yellow', 'green', 'blue', 'grey', 'white', 'black'];
let colorIndex = 0; // Current color index
let drawingColor = drawingColors[colorIndex];
let drawingLineWidth = 2; // Reduced thickness for cleaner look
let textMode = false;
let pendingText = null; // For text positioning before entry
// Text size system (like CSS headings H1-H5)
let textSizeIndex = 2; // Default to size 3 (medium)
const textSizes = [32, 24, 18, 14, 10]; // H1=32px, H2=24px, H3=18px, H4=14px, H5=10px
let preventNextContextMenu = false; // Flag to prevent context menu after drawing
let rightClickStartPos = null; // Track right-click start position for drag detection
const MIN_DRAG_DISTANCE = 5; // Minimum pixels to consider it a drag vs click

// Add debugging for mode changes
function setTextMode(value, reason = 'unknown') {
  console.log(`*** TEXT MODE CHANGE *** from ${textMode} to ${value} - reason: ${reason}`);
  textMode = value;
}

function setDrawingMode(value, reason = 'unknown') {
  console.log(`*** DRAWING MODE CHANGE *** from ${drawingMode} to ${value} - reason: ${reason}`);
  drawingMode = value;
}

// Unified exit from text mode (matches original inside-text-input Escape behavior)
function exitTextModeStandard(reason = 'Exit text mode') {
  setTextMode(false, reason);
  setDrawingMode('arrow', reason);
  pendingText = null; // Cancel any pending placement
  document.body.style.cursor = 'crosshair';
  updateBorderColor();
  // Ensure drawing canvas doesn't intercept drag initiation after exiting text mode
  if (drawingCanvas) {
    drawingCanvas.style.pointerEvents = 'none';
  }
  // Recalculate cursor based on current modifier keys (in case user is holding Ctrl/Shift)
  try { updateCursor(); } catch (_) {}
  console.log('*** TEXT MODE EXITED (STANDARD) *** - Returned to arrow mode');
}

// Fallback capture-phase Escape handler: guarantees exit even if main keydown chain misses it
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
    if (textMode) {
      debugLog('*** ESCAPE (FALLBACK CAPTURE) *** Forcing text mode exit');
      exitTextModeStandard('Escape fallback (capture)');
      // Do NOT prevent default so main handler can still log; state already flipped
    }
  }
}, true); // capture phase


// Set initial fade opacity on .fill when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const fill = document.querySelector('.fill');
  if (fill) {
    fill.classList.add('fade-opacity');
    fill.style.setProperty('--fade-opacity', currentOpacity);
    console.log(`Initial .fill fade opacity set to: ${currentOpacity}`);
  }
  
  // Initialize tracked position (ONE TIME READ to sync with actual position)
  try {
    const bounds = await ipcRenderer.invoke('get-window-bounds');
    trackedWindowPosition.x = bounds.x;
    trackedWindowPosition.y = bounds.y;
    console.log(`Initialized position tracking: x=${trackedWindowPosition.x}, y=${trackedWindowPosition.y}`);
  } catch (error) {
    console.error('Error initializing position tracking:', error);
  }
  
  // Set initial cursor (should be context-menu since no image is loaded yet)
  updateCursor();
  console.log('Initial cursor set');
  
  // Initialize drawing canvas
  initializeDrawingCanvas();
});

// Cursor management for different drag modes
function updateCursor(event) {
  const body = document.body;
  const shiftPressed = event ? event.shiftKey : false;
  const ctrlPressed = event ? event.ctrlKey : false;
  
  if (typeof isDragging !== 'undefined' && isDragging) {
    // Don't change cursor while dragging
    return;
  }
  
  // Check if we have any background image content
  const content = document.querySelector('.content');
  const hasImage = content && getComputedStyle(content).backgroundImage !== 'none';
  
  // Check if mouse is near borders for resize cursors
  if (event && !shiftPressed && !ctrlPressed) {
    const borderCursor = getBorderCursor(event);
    if (borderCursor) {
      body.style.cursor = borderCursor;
      return;
    }
  }
  
  if (!hasImage) {
    // No image loaded yet - show default cursor
    body.style.cursor = 'default';
  } else if (shiftPressed && ctrlPressed) {
    // Both modifiers: grabbing cursor (window and image together)
    body.style.cursor = 'grabbing';
  } else if (shiftPressed) {
    // Shift only: 4-way arrow (window frame only)
    body.style.cursor = 'all-scroll';
  } else if (ctrlPressed) {
    // Ctrl only: hand cursor (image content only)
    body.style.cursor = 'grab';
  } else {
    // No modifiers but has image: precision cursor
    body.style.cursor = 'crosshair';
  }
}

// Function to determine border cursor based on mouse position
function getBorderCursor(event) {
  const borderWidth = 5; // Pixels from edge to show resize cursor
  const rect = document.body.getBoundingClientRect();
  const x = event.clientX;
  const y = event.clientY;
  
  const nearLeft = x <= borderWidth;
  const nearRight = x >= rect.width - borderWidth;
  const nearTop = y <= borderWidth;
  const nearBottom = y >= rect.height - borderWidth;
  
  // Corner cursors
  if (nearTop && nearLeft) return 'nw-resize';
  if (nearTop && nearRight) return 'ne-resize';
  if (nearBottom && nearLeft) return 'sw-resize';
  if (nearBottom && nearRight) return 'se-resize';
  
  // Edge cursors
  if (nearTop || nearBottom) return 'ns-resize';
  if (nearLeft || nearRight) return 'ew-resize';
  
  return null; // Not near a border
}

// Initialize drawing canvas
function initializeDrawingCanvas() {
  drawingCanvas = document.getElementById('drawingCanvas');
  if (drawingCanvas) {
    drawingCtx = drawingCanvas.getContext('2d');
    resizeDrawingCanvas();
    debugLog('*** DRAWING CANVAS INITIALIZED ***');
    console.log(`*** CANVAS DETAILS *** width: ${drawingCanvas.width}, height: ${drawingCanvas.height}`);
    console.log(`*** CONTEXT OK *** drawingCtx exists: ${!!drawingCtx}`);
  } else {
    debugLog('*** ERROR: Drawing canvas not found! ***');
  }
}

// Resize drawing canvas to match window
function resizeDrawingCanvas() {
  if (drawingCanvas) {
    drawingCanvas.width = window.innerWidth;
    drawingCanvas.height = window.innerHeight;
    
    // Set drawing properties
    drawingCtx.strokeStyle = drawingColor;
    drawingCtx.lineWidth = drawingLineWidth;
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
  }
}

// Handle window resize for canvas
window.addEventListener('resize', resizeDrawingCanvas);


ipcRenderer.on('toggle-border', () => {
  console.log('Toggle border event received in renderer');
  const body = document.body;
  if (body.classList.contains('border-hidden')) {
    body.classList.remove('border-hidden');
    console.log('Border turned on (red)');
  } else {
    body.classList.add('border-hidden');
    console.log('Border turned off (transparent)');
  }
});

ipcRenderer.on('reset-scale', () => {
  console.log('Reset scale event received in renderer');
  const content = document.querySelector('.content');
  const backgroundImage = getComputedStyle(content).backgroundImage;
  
  if (backgroundImage && backgroundImage !== 'none' && originalImageWidth > 0) {
    // Reset image scale to 1:1
    currentImageScale = 1.0;
    
    // Reset window scale to 1:1
    currentWindowScale = 1.0;
    
    // Apply original image dimensions
    content.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
    
    // Reset position to initial screenshot alignment
    content.style.backgroundPosition = `${originalPositionX}px ${originalPositionY}px`;
    
    // Update tracking variables
    imageOffset = { x: originalPositionX, y: originalPositionY };
    
    // Reset window to original size and position (if we have them)
    if (originalWindowBounds) {
      ipcRenderer.invoke('set-window-bounds', {
        x: originalWindowBounds.x,
        y: originalWindowBounds.y,
        width: originalWindowBounds.width,
        height: originalWindowBounds.height
      });
      // Update tracked position
      trackedWindowPosition.x = originalWindowBounds.x;
      trackedWindowPosition.y = originalWindowBounds.y;
    } else {
      // Fallback to base size if no original bounds available
      ipcRenderer.invoke('get-window-bounds').then(currentBounds => {
        const newWidth = baseWindowWidth;
        const newHeight = baseWindowHeight;

        // Calculate new position to keep window centered on its current center
        const currentCenterX = currentBounds.x + currentBounds.width / 2;
        const currentCenterY = currentBounds.y + currentBounds.height / 2;
        const newX = Math.floor(currentCenterX - newWidth / 2);
        const newY = Math.floor(currentCenterY - newHeight / 2);

        ipcRenderer.invoke('set-window-bounds', {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        });
        // Update tracked position
        trackedWindowPosition.x = newX;
        trackedWindowPosition.y = newY;
      });
    }
    
    console.log(`Image and window reset to original state (${originalImageWidth}x${originalImageHeight}) at position (${originalPositionX}, ${originalPositionY})`);
    if (originalWindowBounds) {
      console.log(`Window reset to original bounds: ${originalWindowBounds.width}x${originalWindowBounds.height} at (${originalWindowBounds.x}, ${originalWindowBounds.y})`);
    }
  } else {
    console.log('No background image to reset');
  }
});

// Menu-triggered copy event
ipcRenderer.on('menu-copy', async () => {
  console.log('Menu copy event received in renderer');
  // Trigger the same copy functionality as Ctrl+C
  const event = new KeyboardEvent('keydown', {
    key: 'c',
    ctrlKey: true,
    bubbles: true
  });
  document.dispatchEvent(event);
});

// Menu-triggered load file event
ipcRenderer.on('menu-load-file', async () => {
  console.log('Menu load file event received in renderer');
  
  try {
    const result = await ipcRenderer.invoke('load-image-file');
    
    if (result.success) {
      console.log(`Loading image from file: ${result.fileName}`);
      console.log(`Image size: ${result.logicalWidth}x${result.logicalHeight}px`);
      
      // Apply the loaded image as background
      const content = document.querySelector('.content');
      const body = document.querySelector('body');
      content.style.backgroundImage = `url(${result.dataUrl})`;
      content.style.backgroundRepeat = 'no-repeat';
      
      // Initialize sampling canvas for pixel color sampling
      initializeSamplingCanvas(result.dataUrl);
      
      // Automatically turn off border and set content opacity to 100% when loading
      body.style.borderColor = 'transparent';
      content.style.opacity = '1';
      currentOpacity = 1.0;
      console.log('Border turned off and opacity set to 100% for loaded image');
      
      // Update cursor now that we have image content
      updateCursor();
      
      // Get current display scale factor to handle DPI correctly
      const displayInfo = await ipcRenderer.invoke('get-display-info');
      const scaleFactor = displayInfo.scaleFactor;
      
      // For loaded files, the dimensions are actual pixel dimensions, not DPI-adjusted
      // We need to scale them to logical pixels for proper display
      originalImageWidth = Math.round(result.logicalWidth / scaleFactor);
      originalImageHeight = Math.round(result.logicalHeight / scaleFactor);
      currentImageScale = 1.0; // Reset scale to 1:1
      
      console.log(`Loading image: ${result.logicalWidth}x${result.logicalHeight}px actual, ${originalImageWidth}x${originalImageHeight}px logical (scale: ${scaleFactor})`);
      
      // Set background size to logical dimensions for proper DPI handling
      content.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
      
      // Resize window to match image dimensions exactly (no border needed since it's transparent)
      try {
        const currentBounds = await ipcRenderer.invoke('get-window-bounds');
        
        // Since the border is transparent when loading, size window exactly to image dimensions
        const newBounds = {
          x: currentBounds.x,
          y: currentBounds.y,
          width: originalImageWidth,   // Exact image width - no border
          height: originalImageHeight  // Exact image height - no border
        };
        
        console.log(`Resizing window to match loaded image: ${newBounds.width}x${newBounds.height}px`);

        await ipcRenderer.invoke('set-window-bounds', newBounds);

        // Update tracked position to match the new bounds
        trackedWindowPosition.x = newBounds.x;
        trackedWindowPosition.y = newBounds.y;

        // Position the image at (0,0) since there's no visible border
        const initialX = 0;
        const initialY = 0;
        
        console.log(`Positioning loaded image at: ${initialX}px, ${initialY}px (no border, perfect fit)`);
        
        content.style.backgroundPosition = `${initialX}px ${initialY}px`;
        
        // Store original position for reset functionality
        originalPositionX = initialX;
        originalPositionY = initialY;
        
        // Reset image offset to the initial position
        imageOffset = { x: initialX, y: initialY };
        
        // Store the new window bounds as original for reset functionality
        originalWindowBounds = newBounds;
        currentWindowScale = 1.0; // Reset window scale tracking
        
        console.log(`Image loaded successfully from file: ${result.fileName}`);
        
      } catch (error) {
        console.error('Failed to resize window for loaded image:', error);
      }
      
    } else if (result.cancelled) {
      console.log('File load cancelled by user');
    } else {
      console.error('Failed to load image file:', result.error);
    }
  } catch (error) {
    console.error('Error loading image file:', error);
  }
});

// Menu-triggered save file event
ipcRenderer.on('menu-save-file', async () => {
  console.log('Menu save file event received in renderer');
  
  try {
    const result = await ipcRenderer.invoke('save-image-file');
    
    if (result.success) {
      console.log(`Image saved successfully to: ${result.fileName}`);
      console.log(`Saved image size: ${result.imageWidth}x${result.imageHeight}px`);
      console.log(`File path: ${result.filePath}`);
    } else if (result.cancelled) {
      console.log('File save cancelled by user');
    } else {
      console.error('Failed to save image file:', result.error);
    }
  } catch (error) {
    console.error('Error saving image file:', error);
  }
});

// Menu-triggered paste event
ipcRenderer.on('menu-paste', async () => {
  console.log('Menu paste event received in renderer');
  // Trigger the same paste functionality as Ctrl+V
  const event = new KeyboardEvent('keydown', {
    key: 'v',
    ctrlKey: true,
    bubbles: true
  });
  document.dispatchEvent(event);
});

// Menu-triggered crop to current view event
// Replacement crop-to-view function
ipcRenderer.on('crop-to-view', async () => {
  console.log('Crop to current view event received in renderer');
  console.log('originalWindowBounds:', originalWindowBounds);
  console.log('imageOffset:', imageOffset);
  console.log('currentImageScale:', currentImageScale);
  
  try {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Check if this is a screenshot (has originalWindowBounds from capture)
      if (!originalWindowBounds) {
        console.log('Cannot crop: not a screenshot or missing original window bounds');
        return;
      }
      
      // Extract the data URL from the background image
      const dataUrlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (!dataUrlMatch) {
        console.log('Cannot extract image data URL');
        return;
      }
      
      const imageDataUrl = dataUrlMatch[1];
      const borderWidth = 2; // Border area to crop to
      
      console.log('Cropping screenshot to original window border area');
      
      // Create canvas to crop the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Load the current background image
      const img = new Image();
      img.onload = async () => {
        console.log(`Loaded image size: ${img.width}x${img.height}`);
        
        // Get current window bounds to determine what area to crop
        const currentBounds = await ipcRenderer.invoke('get-window-bounds');
        const borderWidth = 2;
        
        // Get current background size and position
        const style = getComputedStyle(content);
        const backgroundSize = style.backgroundSize;
        const backgroundPosition = style.backgroundPosition;
        
        console.log(`Current backgroundSize: ${backgroundSize}`);
        console.log(`Current backgroundPosition: ${backgroundPosition}`);
        console.log(`Current window: ${currentBounds.width}x${currentBounds.height}`);
        
        // Parse background size
        const sizeParts = backgroundSize.split(' ');
        const displayWidth = parseFloat(sizeParts[0]);
        const displayHeight = parseFloat(sizeParts[1]);
        
        // Parse background position  
        const positionParts = backgroundPosition.split(' ');
        const offsetX = parseFloat(positionParts[0]) || 0;
        const offsetY = parseFloat(positionParts[1]) || 0;
        
        console.log(`Image displayed at: ${displayWidth}x${displayHeight}, offset: (${offsetX}, ${offsetY})`);
        
        // Calculate what part of the image is visible in the current window
        const windowContentWidth = currentBounds.width - (borderWidth * 2);
        const windowContentHeight = currentBounds.height - (borderWidth * 2);
        
        // Find visible area bounds within the displayed image
        const visibleLeft = Math.max(0, -offsetX);
        const visibleTop = Math.max(0, -offsetY);
        const visibleRight = Math.min(displayWidth, windowContentWidth - offsetX);
        const visibleBottom = Math.min(displayHeight, windowContentHeight - offsetY);
        
        const visibleWidth = visibleRight - visibleLeft;
        const visibleHeight = visibleBottom - visibleTop;
        
        console.log(`Visible area: ${visibleWidth}x${visibleHeight} at (${visibleLeft}, ${visibleTop}) within displayed image`);
        
        // Calculate scale from displayed size to actual image size
        const scaleX = img.width / displayWidth;
        const scaleY = img.height / displayHeight;
        
        // Calculate crop area in actual image pixels
        const cropX = Math.floor(visibleLeft * scaleX);
        const cropY = Math.floor(visibleTop * scaleY);
        const cropWidth = Math.floor(visibleWidth * scaleX);
        const cropHeight = Math.floor(visibleHeight * scaleY);
        
        console.log(`Cropping from actual image: ${cropWidth}x${cropHeight} at (${cropX}, ${cropY})`);
        console.log(`Scale factors: ${scaleX}, ${scaleY}`);
        
        // Set canvas size to the crop area
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        
        // Draw the cropped portion from the actual image
        ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        
        // Convert to data URL
        const croppedDataUrl = canvas.toDataURL('image/png');
        
        // Update the background image with cropped version
        // The cropped image should fill the visible area and be positioned at 0,0
        content.style.backgroundImage = `url(${croppedDataUrl})`;
        content.style.backgroundSize = `${visibleWidth}px ${visibleHeight}px`;
        content.style.backgroundPosition = '0px 0px';
        content.style.backgroundRepeat = 'no-repeat';
        
        // Update tracking variables
        originalImageWidth = visibleWidth;
        originalImageHeight = visibleHeight;
        originalPositionX = 0;
        originalPositionY = 0;
        imageOffset = { x: 0, y: 0 };
        currentImageScale = 1.0;
        
        console.log(`Crop complete: new image size ${visibleWidth}x${visibleHeight}`);
      };
      
      img.onerror = (error) => {
        console.error('Failed to load image for cropping:', error);
      };
      
      img.src = imageDataUrl;
    } else {
      console.log('No background image to crop');
    }
  } catch (error) {
    console.error('Error cropping to current view:', error);
  }
});
// Menu-triggered transparentize color event
ipcRenderer.on('transparentize-color', async (event, coords) => {
  console.log('Transparentize color event received in renderer at:', coords);
  
  try {
    // Get the image data at the clicked coordinates
    const result = await ipcRenderer.invoke('transparentize-color', coords);
    
    if (result.success) {
      // Create a canvas to process the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Create an image from the captured buffer
      const img = new Image();
      img.onload = () => {
        // Set canvas size to match the captured image
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw the image to canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Get the color at the target pixel (with bounds checking)
        const targetX = Math.max(0, Math.min(result.targetPixel.x, canvas.width - 1));
        const targetY = Math.max(0, Math.min(result.targetPixel.y, canvas.height - 1));
        const pixelIndex = (targetY * canvas.width + targetX) * 4;
        
        if (pixelIndex >= 0 && pixelIndex < data.length - 3) {
          const targetR = data[pixelIndex];
          const targetG = data[pixelIndex + 1];
          const targetB = data[pixelIndex + 2];
          
          console.log(`Target color: RGB(${targetR}, ${targetG}, ${targetB}) at (${targetX}, ${targetY})`);
          
          // Color tolerance for matching (from menu selection or default)
          const tolerance = coords.tolerance || 20; // Use provided tolerance or default to 20
          let pixelsTransparentized = 0;
          
          // Process all pixels
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Calculate color difference
            const colorDiff = Math.sqrt(
              Math.pow(r - targetR, 2) +
              Math.pow(g - targetG, 2) +
              Math.pow(b - targetB, 2)
            );
            
            // If color is within tolerance, make it transparent
            if (colorDiff <= tolerance) {
              data[i + 3] = 0; // Set alpha to 0 (transparent)
              pixelsTransparentized++;
            }
          }
          
          // Put the modified image data back
          ctx.putImageData(imageData, 0, 0);
          
          // Convert canvas to data URL
          const processedDataUrl = canvas.toDataURL('image/png');
          
          // Update the background image
          const body = document.querySelector('body');
          content.style.backgroundImage = `url(${processedDataUrl})`;
          
          // Reset scaling and positioning to fit the new image
          content.style.backgroundSize = `${result.logicalWidth}px ${result.logicalHeight}px`;
          content.style.backgroundPosition = '0px 0px'; // Perfect alignment
          content.style.backgroundRepeat = 'no-repeat';
          
          // Reset image tracking variables
          currentImageScale = 1.0;
          originalImageWidth = result.logicalWidth;
          originalImageHeight = result.logicalHeight;
          originalPositionX = 0;
          originalPositionY = 0;
          imageOffset = { x: 0, y: 0 };
          
          console.log(`Transparentized color RGB(${targetR}, ${targetG}, ${targetB}) with tolerance ${tolerance}`);
          console.log(`Processed image size: ${result.logicalWidth}x${result.logicalHeight}px`);
          console.log(`Pixels transparentized: ${pixelsTransparentized} out of ${data.length / 4}`);
        } else {
          console.error('Target pixel coordinates out of bounds');
        }
      };
      
      img.onerror = (error) => {
        console.error('Failed to load captured image:', error);
      };
      
      // Load the image data
      img.src = `data:image/png;base64,${result.imageBuffer}`;
    } else {
      console.error('Failed to capture image for transparentizing:', result.error);
    }
  } catch (error) {
    console.error('Error transparentizing color:', error);
  }
});

// Menu-triggered custom tolerance transparentize color event
ipcRenderer.on('transparentize-color-custom', async (event, coords) => {
  console.log('Custom tolerance transparentize color event received in renderer at:', coords);
  
  try {
    // Show a prompt for custom tolerance
    const toleranceStr = prompt('Enter color tolerance value (0-100):\n\nLower values = exact color match\nHigher values = broader color range', '20');
    
    if (toleranceStr !== null) {
      const tolerance = parseInt(toleranceStr);
      
      if (!isNaN(tolerance) && tolerance >= 0 && tolerance <= 100) {
        // Add tolerance to coords and process
        const coordsWithTolerance = { ...coords, tolerance: tolerance };
        
        // Trigger the regular transparentize with custom tolerance
        const result = await ipcRenderer.invoke('transparentize-color', coordsWithTolerance);
        
        if (result.success) {
          // Process the image with custom tolerance (reuse the same logic)
          // Create a canvas to process the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Create an image from the captured buffer
          const img = new Image();
          img.onload = () => {
            // Set canvas size to match the captured image
            canvas.width = img.width;
            canvas.height = img.height;
            
            // Draw the image to canvas
            ctx.drawImage(img, 0, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Get the color at the target pixel (with bounds checking)
            const targetX = Math.max(0, Math.min(result.targetPixel.x, canvas.width - 1));
            const targetY = Math.max(0, Math.min(result.targetPixel.y, canvas.height - 1));
            const pixelIndex = (targetY * canvas.width + targetX) * 4;
            
            if (pixelIndex >= 0 && pixelIndex < data.length - 3) {
              const targetR = data[pixelIndex];
              const targetG = data[pixelIndex + 1];
              const targetB = data[pixelIndex + 2];
              
              console.log(`Target color: RGB(${targetR}, ${targetG}, ${targetB}) at (${targetX}, ${targetY})`);
              console.log(`Using custom tolerance: ${tolerance}`);
              
              let pixelsTransparentized = 0;
              
              // Process all pixels
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Calculate color difference
                const colorDiff = Math.sqrt(
                  Math.pow(r - targetR, 2) +
                  Math.pow(g - targetG, 2) +
                  Math.pow(b - targetB, 2)
                );
                
                // If color is within tolerance, make it transparent
                if (colorDiff <= tolerance) {
                  data[i + 3] = 0; // Set alpha to 0 (transparent)
                  pixelsTransparentized++;
                }
              }
              
              // Put the modified image data back
              ctx.putImageData(imageData, 0, 0);
              
              // Convert canvas to data URL
              const processedDataUrl = canvas.toDataURL('image/png');
              
              // Update the background image
              const body = document.querySelector('body');
              content.style.backgroundImage = `url(${processedDataUrl})`;
              
              // Reset scaling and positioning to fit the new image
              content.style.backgroundSize = `${result.logicalWidth}px ${result.logicalHeight}px`;
              content.style.backgroundPosition = '0px 0px'; // Perfect alignment
              content.style.backgroundRepeat = 'no-repeat';
              
              // Reset image tracking variables
              currentImageScale = 1.0;
              originalImageWidth = result.logicalWidth;
              originalImageHeight = result.logicalHeight;
              originalPositionX = 0;
              originalPositionY = 0;
              imageOffset = { x: 0, y: 0 };
              
              console.log(`Transparentized color RGB(${targetR}, ${targetG}, ${targetB}) with custom tolerance ${tolerance}`);
              console.log(`Processed image size: ${result.logicalWidth}x${result.logicalHeight}px`);
              console.log(`Pixels transparentized: ${pixelsTransparentized} out of ${data.length / 4}`);
            } else {
              console.error('Target pixel coordinates out of bounds');
            }
          };
          
          img.onerror = (error) => {
            console.error('Failed to load captured image:', error);
          };
          
          // Load the image data
          img.src = `data:image/png;base64,${result.imageBuffer}`;
        } else {
          console.error('Failed to capture image for custom transparentizing:', result.error);
        }
      } else {
        alert('Please enter a valid number between 0 and 100');
      }
    }
  } catch (error) {
    console.error('Error with custom tolerance transparentizing:', error);
  }
});

// Menu-triggered help event
ipcRenderer.on('show-help', async () => {
  console.log('Show help event received in renderer');
  
  try {
    const result = await ipcRenderer.invoke('show-help-dialog');
    if (result.success) {
      console.log('Help dialog displayed successfully');
    } else {
      console.error('Failed to show help dialog:', result.error);
    }
  } catch (error) {
    console.error('Error showing help dialog:', error);
  }
});

// Menu-triggered invert colors event
ipcRenderer.on('invert-colors', async () => {
  console.log('Invert colors event received in renderer');
  
  try {
    await invertImageColors();
  } catch (error) {
    console.error('Error inverting image colors:', error);
  }
});

// Handle window movement (from border dragging or other window operations)
ipcRenderer.on('window-moved', (event, { deltaX, deltaY }) => {
  // Only adjust image if we're not currently in a custom drag operation
  if (!isDragging) {
    // Adjust image position to compensate for window movement
    // This keeps the image visually stationary when the window is moved by border dragging
    imageOffset.x -= deltaX;
    imageOffset.y -= deltaY;
    
    const content = document.querySelector('.content');
    if (content) {
      content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;
      console.log(`Window moved by border drag: (${deltaX}, ${deltaY}), adjusted image offset: (${imageOffset.x}, ${imageOffset.y})`);
    }
  }
});

// Handle content realignment to top-left (from expand-to-display)
ipcRenderer.on('realign-content-to-top-left', () => {
  try {
    const content = document.querySelector('.content');
    if (content) {
      // Reset content position to top-left (0, 0)
      content.style.backgroundPosition = '0px 0px';
      imageOffset = { x: 0, y: 0 };
      originalPositionX = 0;
      originalPositionY = 0;
      
      console.log('Content realigned to top-left corner');
    }
  } catch (error) {
    console.error('Error realigning content to top-left:', error);
  }
});


// Mouse wheel event to adjust opacity, image scale, or window scale
document.addEventListener('wheel', (event) => {
  console.log('Mouse wheel event detected, deltaY:', event.deltaY, 'ctrlKey:', event.ctrlKey, 'shiftKey:', event.shiftKey);
  event.preventDefault(); // Prevent default scroll behavior
  
  if (event.shiftKey && event.ctrlKey) {
    // Ctrl+Shift+Wheel: Scale both window and content together
    const delta = event.deltaY < 0 ? 1.1 : 0.9; // 10% increment/decrement

    try {
      ipcRenderer.invoke('get-window-bounds').then(currentBounds => {
        const newWidth = Math.max(100, Math.round(currentBounds.width * delta));
        const newHeight = Math.max(100, Math.round(currentBounds.height * delta));

        // Keep window centered during resize
        const newX = currentBounds.x + Math.round((currentBounds.width - newWidth) / 2);
        const newY = currentBounds.y + Math.round((currentBounds.height - newHeight) / 2);

        ipcRenderer.invoke('set-window-bounds', {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        });

        // Update tracked position
        trackedWindowPosition.x = newX;
        trackedWindowPosition.y = newY;

        // Also scale the image content proportionally
        const content = document.querySelector('.content');
        if (content && originalImageWidth && originalImageHeight) {
          // Get current window dimensions before resize to calculate center
          const oldCenterX = currentBounds.width / 2;
          const oldCenterY = currentBounds.height / 2;

          currentImageScale *= delta;
          currentImageScale = Math.max(0.1, Math.min(10.0, currentImageScale));

          const newImageWidth = Math.round(originalImageWidth * currentImageScale);
          const newImageHeight = Math.round(originalImageHeight * currentImageScale);

          // Adjust image position to keep center point fixed during window+content scale
          // Formula: newOffset = (oldOffset - oldCenter) * delta + newCenter
          const newCenterX = newWidth / 2;
          const newCenterY = newHeight / 2;
          imageOffset.x = (imageOffset.x - oldCenterX) * delta + newCenterX;
          imageOffset.y = (imageOffset.y - oldCenterY) * delta + newCenterY;

          content.style.backgroundSize = `${newImageWidth}px ${newImageHeight}px`;
          content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;

          console.log(`Window and content scaled together to: ${(currentImageScale * 100).toFixed(1)}% at (${newX}, ${newY})`);
        } else {
          console.log(`Window scaled to: ${newWidth}x${newHeight}px at (${newX}, ${newY})`);
        }
      });
    } catch (error) {
      console.error('Error scaling window:', error);
    }
  } else if (event.ctrlKey) {
    // Ctrl+Wheel: Scale image content centered on window
    const content = document.querySelector('.content');
    if (!content || !originalImageWidth || !originalImageHeight) {
      console.log('No image content available for scaling');
      return;
    }

    const delta = event.deltaY < 0 ? 1.1 : 0.9; // 10% increment/decrement
    const previousScale = currentImageScale;
    currentImageScale *= delta;
    currentImageScale = Math.max(0.1, Math.min(10.0, currentImageScale)); // Limit scale range

    const newWidth = Math.round(originalImageWidth * currentImageScale);
    const newHeight = Math.round(originalImageHeight * currentImageScale);

    // Get current window dimensions to calculate center point
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const centerX = windowWidth / 2;
    const centerY = windowHeight / 2;

    // Calculate the change in scale
    const scaleDelta = currentImageScale / previousScale;

    // Adjust image position to keep the center point fixed
    // Formula: newOffset = (oldOffset - centerPoint) * scaleDelta + centerPoint
    imageOffset.x = (imageOffset.x - centerX) * scaleDelta + centerX;
    imageOffset.y = (imageOffset.y - centerY) * scaleDelta + centerY;

    content.style.backgroundSize = `${newWidth}px ${newHeight}px`;
    content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;

    console.log(`Image scaled to: ${(currentImageScale * 100).toFixed(1)}% (${newWidth}x${newHeight}px) at position (${imageOffset.x.toFixed(1)}, ${imageOffset.y.toFixed(1)})`);

    updateCursor();
  } else if (event.shiftKey) {
    // Shift+Wheel: Scale window size
    const delta = event.deltaY < 0 ? 1.05 : 0.95; // 5% increment/decrement
    
    try {
      ipcRenderer.invoke('get-window-bounds').then(currentBounds => {
        const newWidth = Math.max(100, Math.round(currentBounds.width * delta));
        const newHeight = Math.max(100, Math.round(currentBounds.height * delta));
        
        // Keep window centered during resize
        const newX = currentBounds.x + Math.round((currentBounds.width - newWidth) / 2);
        const newY = currentBounds.y + Math.round((currentBounds.height - newHeight) / 2);

        ipcRenderer.invoke('set-window-bounds', {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        });

        // Update tracked position
        trackedWindowPosition.x = newX;
        trackedWindowPosition.y = newY;

        console.log(`Window scaled to: ${newWidth}x${newHeight}px at (${newX}, ${newY})`);
      });
    } catch (error) {
      console.error('Error scaling window:', error);
    }
  } else {
    // Normal wheel: Adjust opacity of .content div (which contains the image)
    // Up (deltaY < 0): more opaque, Down (deltaY > 0): more transparent
    const content = document.querySelector('.content');
    
    // Synchronize currentOpacity with actual CSS opacity on first wheel use
    if (content) {
      const actualOpacity = parseFloat(getComputedStyle(content).opacity) || 1.0;
      if (Math.abs(currentOpacity - actualOpacity) > 0.01) {
        console.log(`Synchronizing opacity: ${currentOpacity} → ${actualOpacity}`);
        currentOpacity = actualOpacity;
      }
    }
    
    const delta = event.deltaY < 0 ? 0.05 : -0.05;
    currentOpacity += delta;
    currentOpacity = Math.max(0.05, Math.min(1.0, currentOpacity));
    if (content) {
      content.style.opacity = currentOpacity;
      console.log(`.content opacity adjusted to: ${currentOpacity.toFixed(2)}`);
    }
  }
});

// Double-click event to capture screenshot
document.addEventListener('dblclick', async (event) => {
  const isCtrlHeld = event.ctrlKey;
  console.log(`Double-click detected${isCtrlHeld ? ' with Ctrl' : ''}, capturing screenshot...`);

  try {
    // Request screenshot from main process
    const cropInfo = await ipcRenderer.invoke('capture-screenshot');

    console.log('Received cropInfo:', cropInfo ? 'YES' : 'NO');

    // Validate cropInfo structure before proceeding
    if (!cropInfo) {
      console.error('Screenshot capture returned null - capture failed');
      return;
    }

    if (!cropInfo.fullScreenshot || typeof cropInfo.fullScreenshot !== 'string' || cropInfo.fullScreenshot.length < 100) {
      console.error('Screenshot capture returned invalid data:', {
        hasFullScreenshot: !!cropInfo.fullScreenshot,
        type: typeof cropInfo.fullScreenshot,
        length: cropInfo.fullScreenshot ? cropInfo.fullScreenshot.length : 0
      });
      return;
    }

    if (cropInfo && cropInfo.fullScreenshot) {
      console.log('Full screenshot data length:', cropInfo.fullScreenshot.length);
      console.log('Scale factor:', cropInfo.scaleFactor);
      
      // Use the scale factor from the capture
      const scaleFactor = cropInfo.scaleFactor;
      
      // Apply the FULL screenshot as background image (not cropped)
      const content = document.querySelector('.content');
      content.style.backgroundImage = `url(${cropInfo.fullScreenshot})`;
      content.style.backgroundRepeat = 'no-repeat';
      
      // Scale the image to display at 1:1 scale (actual screen size in CSS pixels)
      // The screenshot is in physical pixels, so we need to scale it down by the scale factor
      const actualScreenWidth = cropInfo.screenshotSize.width / scaleFactor;
      const actualScreenHeight = cropInfo.screenshotSize.height / scaleFactor;
      content.style.backgroundSize = `${actualScreenWidth}px ${actualScreenHeight}px`;
      
      // Store original dimensions for scaling
      originalImageWidth = actualScreenWidth;
      originalImageHeight = actualScreenHeight;
      currentImageScale = 1.0; // Reset scale to 1:1
      
      // Position the image so the window area appears exactly where it was captured
      const initialX = -Math.floor(cropInfo.windowX / scaleFactor);
      const initialY = -Math.floor(cropInfo.windowY / scaleFactor);
      
      content.style.backgroundPosition = `${initialX}px ${initialY}px`;
      
      // Store original position for reset functionality
      originalPositionX = initialX;
      originalPositionY = initialY;
      
      // Reset and set image offset to the initial position
      imageOffset = { x: initialX, y: initialY };
      
      // Store scale factor for future drag calculations
      currentScaleFactor = scaleFactor;
      
      // Store original window bounds from screenshot capture for reset functionality
      if (cropInfo.originalWindowBounds) {
        originalWindowBounds = cropInfo.originalWindowBounds;
        console.log('Stored original window bounds from screenshot:', originalWindowBounds);
      } else {
        // Fallback: capture current window bounds
        originalWindowBounds = await ipcRenderer.invoke('get-window-bounds');
        console.log('Fallback: captured current window bounds:', originalWindowBounds);
      }
      currentWindowScale = 1.0; // Reset window scale tracking

      // CRITICAL: Update tracking states with the captured window bounds
      // This ensures Shift+Arrow and other position operations work correctly after screenshot
      trackedWindowPosition.x = originalWindowBounds.x;
      trackedWindowPosition.y = originalWindowBounds.y;

      // Update main.js windowStates with the actual captured window dimensions
      await ipcRenderer.invoke('set-window-bounds', {
        x: originalWindowBounds.x,
        y: originalWindowBounds.y,
        width: originalWindowBounds.width,
        height: originalWindowBounds.height
      });
      console.log('Updated tracking states with screenshot window bounds:', originalWindowBounds);
      
      console.log(`Screenshot applied successfully!`);
      console.log(`- Scale factor: ${scaleFactor}`);
      console.log(`- Image size: ${actualScreenWidth}x${actualScreenHeight}px`);
      console.log(`- Initial position: ${initialX}, ${initialY}`);
      console.log(`- Screenshot size: ${cropInfo.screenshotSize.width}x${cropInfo.screenshotSize.height}`);
      console.log(`- Original window bounds:`, originalWindowBounds);
      
      // Test if the background image was actually set
      const appliedBg = getComputedStyle(content).backgroundImage;
      console.log('Background image applied:', appliedBg !== 'none' ? 'YES' : 'NO');
      
      // Update cursor now that we have image content
      updateCursor();

      // If Ctrl was held during double-click, trigger auto-save series
      if (isCtrlHeld) {
        console.log('Ctrl+double-click detected - triggering auto-save series');
        try {
          const saveResult = await ipcRenderer.invoke('auto-save-screenshot');
          if (saveResult.success) {
            console.log(`Screenshot auto-saved to: ${saveResult.filePath}`);
          } else if (saveResult.cancelled) {
            console.log('Auto-save cancelled by user');
          } else {
            console.error('Auto-save failed:', saveResult.error);
          }
        } catch (error) {
          console.error('Error during auto-save:', error);
        }
      }

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
let isCombinedDrag = false; // Track if both window and image should move
let imageOffset = { x: 0, y: 0 }; // Track image position offset
let rightClickDragStarted = false; // Track if right-click actually started a drag

// Keep drawing overlay (and any future overlays) aligned with the background image when it pans
function updateOverlayTransforms() {
  if (drawingCanvas) {
    // Translate overlay by same offset as backgroundPosition so annotations remain anchored
    drawingCanvas.style.transform = `translate(${imageOffset.x}px, ${imageOffset.y}px)`;
    drawingCanvas.style.transformOrigin = 'top left';
  }
}

// Add keyboard event listeners for modifier key changes
document.addEventListener('keydown', updateCursor);
document.addEventListener('keyup', updateCursor);

// Add mousemove listener to update cursor based on current modifier state
document.addEventListener('mousemove', (event) => {
  if (!isDragging) {
    updateCursor(event);
  }
});

document.addEventListener('mousedown', async (event) => {
  if (event.button === 0) {
    // Left-click with modifier keys
    const shiftPressed = event.shiftKey;
    const ctrlPressed = event.ctrlKey;
    const altPressed = event.altKey;
    
    // Simplified approach: Only check if we have an image loaded
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    const hasImage = backgroundImage && backgroundImage !== 'none';
    
    // Handle text mode clicks
    if (hasImage && textMode && drawingMode === 'text') {
      console.log(`*** TEXT MODE CLICK DETECTED *** textMode: ${textMode}, drawingMode: ${drawingMode}`);
      
      // In text mode, left click sets text position AND immediately opens text input
      const rect = content.getBoundingClientRect();
      pendingText = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      
      console.log(`*** TEXT POSITION SET *** at (${pendingText.x}, ${pendingText.y}) - Opening text input immediately`);
      
      // Store the mouse position to check for drag vs click
      const textClickStart = { x: event.clientX, y: event.clientY };
      
      // Set up a mouseup listener to detect if this was a click (not drag)
      const handleTextClick = (upEvent) => {
        const dragDistance = Math.sqrt(
          Math.pow(upEvent.clientX - textClickStart.x, 2) + 
          Math.pow(upEvent.clientY - textClickStart.y, 2)
        );
        
        if (dragDistance < 5) { // Small movement = click, not drag
          console.log(`*** TEXT CLICK CONFIRMED *** - Opening text input (textMode: ${textMode}, drawingMode: ${drawingMode})`);
          setTimeout(() => {
            if (pendingText && textMode && drawingMode === 'text') { // Check all conditions
              enterTextInput();
            } else {
              console.log(`*** TEXT INPUT CANCELED *** - Conditions not met: pendingText: ${!!pendingText}, textMode: ${textMode}, drawingMode: ${drawingMode}`);
            }
          }, 10);
        } else {
          console.log('*** TEXT DRAG DETECTED *** - Not opening text input');
          pendingText = null; // Cancel text input
        }
        
        // Remove the temporary listener
        document.removeEventListener('mouseup', handleTextClick);
      };
      
      document.addEventListener('mouseup', handleTextClick);
      
      return; // Don't process as drag
    }
    
    if (!shiftPressed && !ctrlPressed && !altPressed) {
      // No modifiers: Normal window drag (even with image)
      // This allows simple unmodified drag to move the entire window
      // Both modifiers: Combined drag (move window and image together)
      const backgroundImage = getComputedStyle(content).backgroundImage;
      
      if (backgroundImage && backgroundImage !== 'none') {
        isDragging = true;
        isImageDrag = false;
        isCombinedDrag = true;
        rightClickDragStarted = false;
        
        try {
          const windowDragInfo = await ipcRenderer.invoke('start-drag', {
            mouseX: event.clientX,
            mouseY: event.clientY
          });
          
          dragInfo = {
            ...windowDragInfo,
            startX: event.clientX,
            startY: event.clientY,
            initialOffsetX: imageOffset.x,
            initialOffsetY: imageOffset.y
          };
          
          // Set cursor for combined drag
          document.body.style.cursor = 'grabbing';
          
          console.log('Combined window+image drag started:', dragInfo);
        } catch (error) {
          console.error('Failed to start combined drag:', error);
          isDragging = false;
          isCombinedDrag = false;
        }
      } else {
        // No image, just window drag
        isDragging = true;
        isImageDrag = false;
        isCombinedDrag = false;
        
        try {
          dragInfo = await ipcRenderer.invoke('start-drag', {
            mouseX: event.clientX,
            mouseY: event.clientY
          });
          
          // Set cursor for window-only drag
          document.body.style.cursor = 'move';
          
          console.log('Window drag started (no image):', dragInfo);
        } catch (error) {
          console.error('Failed to start window drag:', error);
          isDragging = false;
        }
      }
    } else if (shiftPressed) {
      // Shift only: Window drag with image staying stationary on screen
      isDragging = true;
      isImageDrag = false;
      isCombinedDrag = false;
      
      try {
        const windowDragInfo = await ipcRenderer.invoke('start-drag', {
          mouseX: event.clientX,
          mouseY: event.clientY
        });
        
        // Store initial image offset and window position for counter-movement calculation
        dragInfo = {
          ...windowDragInfo,
          initialOffsetX: imageOffset.x,
          initialOffsetY: imageOffset.y
        };
        
        // Set cursor for shift-only drag (window frame)
        document.body.style.cursor = 'all-scroll';
        
        console.log('Window drag started (image stays stationary):', dragInfo);
      } catch (error) {
        console.error('Failed to start window drag:', error);
        isDragging = false;
      }
    } else if (ctrlPressed) {
      // Ctrl only: Image drag (only if there's a background image)
      const backgroundImage = getComputedStyle(content).backgroundImage;
      
      if (backgroundImage && backgroundImage !== 'none') {
        isDragging = true;
        isImageDrag = true;
        isCombinedDrag = false;
        rightClickDragStarted = false; // Reset flag
        
        dragInfo = {
          startX: event.clientX,
          startY: event.clientY,
          initialOffsetX: imageOffset.x,
          initialOffsetY: imageOffset.y
        };
        
        // Set cursor for ctrl-only drag (image content)
        document.body.style.cursor = 'grabbing';
        
        console.log('Image drag ready');
      }
    }
    // No modifiers: No drag action
  } else if (event.button === 2) {
    // Right-click: Start drawing based on current mode
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Record the start position to detect if this becomes a drag
      rightClickStartPos = { x: event.clientX, y: event.clientY };
      
      // Don't start drawing immediately - wait for mousemove to confirm drag
      // This prevents unwanted artifacts on simple right-clicks
      
      return;
    }
    // If no image, allow normal context menu (don't prevent default)
  }
});

document.addEventListener('mousemove', async (event) => {
  // Check if we should start drawing from a right-click
  if (rightClickStartPos && !isDrawing) {
    const dragDistance = Math.sqrt(
      Math.pow(event.clientX - rightClickStartPos.x, 2) + 
      Math.pow(event.clientY - rightClickStartPos.y, 2)
    );
    
      // Only start drawing if we've moved enough distance
      if (dragDistance >= MIN_DRAG_DISTANCE) {
        console.log(`Starting drawing - drag distance: ${dragDistance}`);
        
        if (drawingMode === 'arrow') {
          startArrowDrawing({ clientX: rightClickStartPos.x, clientY: rightClickStartPos.y });
        } else if (drawingMode === 'box' || drawingMode === 'rounded-box') {
          startBoxDrawing({ clientX: rightClickStartPos.x, clientY: rightClickStartPos.y });
        } else if (drawingMode === 'fill') {
          startFillDrawing({ clientX: rightClickStartPos.x, clientY: rightClickStartPos.y });
        } else if (drawingMode === 'blur') {
          console.log(`*** INITIATING BLUR DRAWING *** at (${rightClickStartPos.x}, ${rightClickStartPos.y})`);
          startBlurDrawing({ clientX: rightClickStartPos.x, clientY: rightClickStartPos.y });
        } else if (drawingMode === 'text') {
          // For text mode, right-click places text at start position
          const content = document.querySelector('.content');
          const rect = content.getBoundingClientRect();
          pendingText = {
            x: rightClickStartPos.x - rect.left,
            y: rightClickStartPos.y - rect.top
          };
          console.log(`Text position set at (${pendingText.x}, ${pendingText.y}) - Press Enter to type`);
        }      rightClickStartPos = null; // Clear the start position
      rightClickDragStarted = true; // Mark that we started a drag
    }
  }
  
  // Handle drawing mode
  if (isDrawing && drawingMode === 'arrow') {
    drawingCurrent = { x: event.clientX, y: event.clientY };
    // Draw preview line during drag
    drawArrow(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, true);
    return; // Don't process other mouse move logic
  } else if (isDrawing && (drawingMode === 'box' || drawingMode === 'rounded-box')) {
    drawingCurrent = { x: event.clientX, y: event.clientY };
    // Draw preview box during drag
    drawBox(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, true);
    return; // Don't process other mouse move logic
  } else if (isDrawing && drawingMode === 'fill') {
    drawingCurrent = { x: event.clientX, y: event.clientY };
    // Draw preview fill rectangle during drag
    drawFillRect(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, true);
    return; // Don't process other mouse move logic
  } else if (isDrawing && drawingMode === 'blur') {
    console.log(`*** BLUR MOUSE MOVE *** isDrawing: ${isDrawing}, drawingMode: ${drawingMode}`);
    drawingCurrent = { x: event.clientX, y: event.clientY };
    // Draw preview blur rectangle during drag
    drawBlurRect(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, true);
    return; // Don't process other mouse move logic
  }
  
  if (isDragging && dragInfo) {
    if (isCombinedDrag) {
      // Combined drag: Move both window and image
      const deltaX = event.clientX - dragInfo.startX;
      const deltaY = event.clientY - dragInfo.startY;
      
      // Only start dragging if mouse moved significantly
      if (!rightClickDragStarted && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        rightClickDragStarted = true;
        console.log('Combined drag started');
      }
      
      if (rightClickDragStarted) {
        // Move the window
        const newX = event.screenX - dragInfo.offsetX;
        const newY = event.screenY - dragInfo.offsetY;
        
        try {
          await ipcRenderer.invoke('do-drag', {
            x: newX,
            y: newY,
            targetWidth: dragInfo.targetWidth,
            targetHeight: dragInfo.targetHeight
          });

          // Update tracked position after successful drag
          trackedWindowPosition.x = newX;
          trackedWindowPosition.y = newY;
        } catch (error) {
          console.error('Failed to drag window in combined mode:', error);
        }

        // Move the image (keeping it in the same relative position within the window)
        // Since the window moved, the image doesn't need to move relative to the window
        // This maintains the traditional behavior where the image moves with the window
      }
    } else if (isImageDrag) {
      // Image-only drag: Move the background image
      const deltaX = event.clientX - dragInfo.startX;
      const deltaY = event.clientY - dragInfo.startY;
      
      // Only start dragging if mouse moved significantly (prevents accidental drag on simple click)
      if (!rightClickDragStarted && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        rightClickDragStarted = true;
        console.log('Image drag started');
      }
      
      if (rightClickDragStarted) {
        imageOffset.x = dragInfo.initialOffsetX + deltaX;
        imageOffset.y = dragInfo.initialOffsetY + deltaY;
        
        content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;
        updateOverlayTransforms();
        
        console.log(`Image offset: ${imageOffset.x}, ${imageOffset.y}`);
      }
    } else {
      // Window-only drag: Move the window but keep image stationary on screen
      const newX = event.screenX - dragInfo.offsetX;
      const newY = event.screenY - dragInfo.offsetY;
      
      // Calculate total window movement from the initial position when drag started
      const totalWindowMoveX = newX - dragInfo.windowX;
      const totalWindowMoveY = newY - dragInfo.windowY;
      
      try {
        await ipcRenderer.invoke('do-drag', {
          x: newX,
          y: newY,
          targetWidth: dragInfo.targetWidth,
          targetHeight: dragInfo.targetHeight
        });

        // Update tracked position after successful drag
        trackedWindowPosition.x = newX;
        trackedWindowPosition.y = newY;

        // Adjust image position in opposite direction to keep it stationary on screen
        // Calculate offset based on total window movement from start, not incremental deltas
        imageOffset.x = dragInfo.initialOffsetX - totalWindowMoveX;
        imageOffset.y = dragInfo.initialOffsetY - totalWindowMoveY;
        
        content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;
        updateOverlayTransforms();
        
        console.log(`Window moved total: (${totalWindowMoveX}, ${totalWindowMoveY}), Image offset: (${imageOffset.x}, ${imageOffset.y})`);
        
      } catch (error) {
        console.error('Failed to drag window:', error);
      }
    }
  }
});

document.addEventListener('mouseup', (event) => {
  // Clear right-click start position if no drawing was started
  if (rightClickStartPos && !isDrawing) {
    rightClickStartPos = null;
    console.log('Right-click released without drawing - allowing context menu');
  }
  
  // Handle drawing mode
  if (isDrawing && drawingMode === 'arrow') {
    // Check if we actually dragged enough to warrant preventing context menu
    const dragDistance = Math.sqrt(
      Math.pow(drawingCurrent.x - drawingStart.x, 2) + 
      Math.pow(drawingCurrent.y - drawingStart.y, 2)
    );
    
    if (dragDistance >= MIN_DRAG_DISTANCE) {
      // Finalize arrow drawing only if we dragged enough
      drawArrow(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, false);
      rightClickDragStarted = true; // Mark that we just finished drawing
      console.log('Arrow drawing completed - context menu temporarily disabled');
    } else {
      // Too small to be a real drawing - allow context menu and clear canvas
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      rightClickDragStarted = false;
    }
    
    // Reset drawing state but keep the mode
    isDrawing = false;
    drawingCanvas.style.pointerEvents = 'none'; // Disable canvas interaction
    
    console.log(`Arrow completed from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y}), distance: ${dragDistance}`);
    return;
  } else if (isDrawing && (drawingMode === 'box' || drawingMode === 'rounded-box')) {
    // Check if we actually dragged enough to warrant preventing context menu
    const dragDistance = Math.sqrt(
      Math.pow(drawingCurrent.x - drawingStart.x, 2) + 
      Math.pow(drawingCurrent.y - drawingStart.y, 2)
    );
    
    if (dragDistance >= MIN_DRAG_DISTANCE) {
      // Finalize box drawing only if we dragged enough
      debugLog(`*** FINALIZING BOX DRAWING *** from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y})`);
      drawBox(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, false);
      rightClickDragStarted = true; // Mark that we just finished drawing
      debugLog('*** BOX DRAWING COMPLETED *** - context menu temporarily disabled');
    } else {
      // Too small to be a real drawing - allow context menu and clear canvas
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      rightClickDragStarted = false;
    }
    
    // Reset drawing state but keep the mode
    isDrawing = false;
    drawingCanvas.style.pointerEvents = 'none'; // Disable canvas interaction
    
    console.log(`Box completed from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y}), distance: ${dragDistance}`);
    return;
  } else if (isDrawing && drawingMode === 'fill') {
    // Check if we actually dragged enough to warrant preventing context menu
    const dragDistance = Math.sqrt(
      Math.pow(drawingCurrent.x - drawingStart.x, 2) + 
      Math.pow(drawingCurrent.y - drawingStart.y, 2)
    );
    
    if (dragDistance >= MIN_DRAG_DISTANCE) {
      // Finalize fill rectangle drawing only if we dragged enough
      debugLog(`*** FINALIZING FILL DRAWING *** from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y})`);
      drawFillRect(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, false);
      rightClickDragStarted = true; // Mark that we just finished drawing
      debugLog('*** FILL DRAWING COMPLETED *** - context menu temporarily disabled');
    } else {
      // Too small to be a real drawing - allow context menu and clear canvas
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      rightClickDragStarted = false;
    }
    
    // Reset drawing state but keep the mode
    isDrawing = false;
    drawingCanvas.style.pointerEvents = 'none'; // Disable canvas interaction
    
    console.log(`Fill completed from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y}), distance: ${dragDistance}`);
    return;
  } else if (isDrawing && drawingMode === 'blur') {
    // Check if we actually dragged enough to warrant preventing context menu
    const dragDistance = Math.sqrt(
      Math.pow(drawingCurrent.x - drawingStart.x, 2) + 
      Math.pow(drawingCurrent.y - drawingStart.y, 2)
    );
    
    if (dragDistance >= MIN_DRAG_DISTANCE) {
      // Finalize blur rectangle drawing only if we dragged enough
      debugLog(`*** FINALIZING BLUR DRAWING *** from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y})`);
      drawBlurRect(drawingStart.x, drawingStart.y, drawingCurrent.x, drawingCurrent.y, false);
      rightClickDragStarted = true; // Mark that we just finished drawing
      debugLog('*** BLUR DRAWING COMPLETED *** - context menu temporarily disabled');
    } else {
      // Too small to be a real drawing - clear canvas
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      rightClickDragStarted = false;
    }
    
    // Reset drawing state but keep the mode
    isDrawing = false;
    drawingCanvas.style.pointerEvents = 'none'; // Disable canvas interaction
    
    console.log(`Blur completed from (${drawingStart.x}, ${drawingStart.y}) to (${drawingCurrent.x}, ${drawingCurrent.y}), distance: ${dragDistance}`);
    return;
  }
  
  if (isDragging) {
    // If this was a window drag, ensure trackedWindowPosition is synced with final position
    if (!isImageDrag) {
      // Get the actual window position after drag completes
      ipcRenderer.invoke('get-window-bounds').then(bounds => {
        trackedWindowPosition.x = bounds.x;
        trackedWindowPosition.y = bounds.y;
        console.log(`Drag ended - synced tracked position to: ${bounds.x}, ${bounds.y}`);
      }).catch(err => {
        console.error('Failed to sync position after drag:', err);
      });
    }

    isDragging = false;
    dragInfo = null;
    console.log(isCombinedDrag ? 'Combined drag ended' : (isImageDrag ? 'Image drag ended' : 'Window drag ended'));
    isImageDrag = false;
    isCombinedDrag = false;
    rightClickDragStarted = false; // Reset flag

    // Reset cursor based on current modifier state
    updateCursor(event);
  }
  
  // Reset context menu availability on any left click
  if (event.button === 0) {
    rightClickDragStarted = false;
    console.log('Left click - context menu re-enabled');
  }
});

// Track right-click double-click for new window creation
let rightClickCount = 0;
let rightClickTimer = null;

// Add mousedown event to track right double-clicks
document.addEventListener('mousedown', (event) => {
  if (event.button === 2) { // Right mouse button
    rightClickCount++;
    
    if (rightClickCount === 1) {
      // Start timer for double-click detection
      rightClickTimer = setTimeout(() => {
        rightClickCount = 0; // Reset after timeout
      }, 300); // 300ms double-click window
    } else if (rightClickCount === 2) {
      // Right double-click detected!
      clearTimeout(rightClickTimer);
      rightClickCount = 0;
      
      console.log('Right double-click detected, creating new window...');
      
      // Send IPC message to create new window
      ipcRenderer.invoke('create-new-window');
      
      // Prevent the context menu from appearing
      event.preventDefault();
      return false;
    }
  }
});

// Handle context menu - restore normal functionality with drawing mode options
document.addEventListener('contextmenu', (event) => {
  // Always allow context menu - let the user decide when they want it
  console.log('Context menu requested');
  
  // Check if we have an image loaded
  const content = document.querySelector('.content');
  const backgroundImage = getComputedStyle(content).backgroundImage;
  
  if (backgroundImage && backgroundImage !== 'none') {
    // If we have an image, check if we just finished drawing
    if (rightClickDragStarted) {
      // Prevent menu if we just finished dragging/drawing
      event.preventDefault();
      console.log('Preventing context menu - just finished drawing');
      rightClickDragStarted = false; // Reset immediately
    } else {
      // Allow normal context menu - we'll add drawing options to the main context menu
      console.log('Allowing context menu with drawing options');
    }
  } else {
    console.log('No image loaded, allowing normal context menu');
  }
});

// COMPREHENSIVE KEYBOARD HANDLER - All shortcuts in one place to avoid conflicts
// CRITICAL: This is the ONLY main keyboard handler - do not add duplicate handlers!
// Use capture phase to ensure we get events before other handlers
document.addEventListener('keydown', async (event) => {
  debugLog(`*** KEYDOWN EVENT *** Key: ${event.key}, Ctrl: ${event.ctrlKey}, Alt: ${event.altKey}, Shift: ${event.shiftKey}`);
  
  // Handle Ctrl+C (copy current view to clipboard at full opacity)
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    console.log('Ctrl+C detected, copying current window view to clipboard...');

    try {
      const success = await ipcRenderer.invoke('copy-to-clipboard');

      if (success) {
        console.log('Current window view successfully copied to clipboard at full opacity!');
      } else {
        console.error('Failed to copy window view to clipboard');
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  }
  
  // Handle Ctrl+V (paste image from clipboard)  
  else if (event.ctrlKey && event.key.toLowerCase() === 'v') {
    event.preventDefault();
    console.log('Ctrl+V detected, pasting image from clipboard...');
    
    try {
      const clipboardData = await ipcRenderer.invoke('paste-from-clipboard');
      
      if (clipboardData) {
        console.log('Image pasted from clipboard successfully');
        console.log(`Image size: ${clipboardData.logicalWidth}x${clipboardData.logicalHeight}px`);
        console.log(`Scale factor: ${clipboardData.scaleFactor || 'unknown'}`);
        
        const content = document.querySelector('.content');
        const body = document.querySelector('body');
        content.style.backgroundImage = `url(${clipboardData.dataUrl})`;
        content.style.backgroundRepeat = 'no-repeat';
        
        // Initialize sampling canvas for pixel color sampling
        initializeSamplingCanvas(clipboardData.dataUrl);
        
        body.style.borderColor = 'transparent';
        content.style.opacity = '1';
        currentOpacity = 1.0;
        console.log('Border turned off and opacity set to 100% for pasted image');
        
        updateCursor();
        
        // Use the logical dimensions which should be DPI-adjusted
        originalImageWidth = clipboardData.logicalWidth;
        originalImageHeight = clipboardData.logicalHeight;
        currentImageScale = 1.0; // Reset scale to 1:1
        
        console.log(`Setting background to logical size: ${originalImageWidth}x${originalImageHeight}px`);
        
        // Set background size to logical image dimensions
        content.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
        
        // Resize window to match image dimensions exactly (no border needed since it's transparent)
        try {
          const currentBounds = await ipcRenderer.invoke('get-window-bounds');
          
          // Since the border is transparent when pasting, size window exactly to image dimensions
          const newBounds = {
            x: currentBounds.x,
            y: currentBounds.y,
            width: originalImageWidth,   // Exact image width - no border
            height: originalImageHeight  // Exact image height - no border
          };
          
          console.log(`Resizing window to match image exactly: ${newBounds.width}x${newBounds.height}px`);

          await ipcRenderer.invoke('set-window-bounds', newBounds);

          // Update tracked position to match the new bounds
          trackedWindowPosition.x = newBounds.x;
          trackedWindowPosition.y = newBounds.y;

          // Position the image at (0,0) since there's no visible border
          const initialX = 0;
          const initialY = 0;
          
          console.log(`Positioning image at: ${initialX}px, ${initialY}px (no border, perfect fit)`);
          
          content.style.backgroundPosition = `${initialX}px ${initialY}px`;
          
          // Store original position for reset functionality
          originalPositionX = initialX;
          originalPositionY = initialY;
          
          // Reset image offset to the initial position
          imageOffset = { x: initialX, y: initialY };
          
          // Store the new window bounds as original for reset functionality
          originalWindowBounds = newBounds;
          currentWindowScale = 1.0; // Reset window scale tracking
          
          console.log(`Window resized to match pasted image perfectly:`);
          console.log(`  Image: ${originalImageWidth}x${originalImageHeight}px`);
          console.log(`  Window: ${newBounds.width}x${newBounds.height}px (exact match - no border)`);
          console.log(`  Image positioned at: (${initialX}, ${initialY}) - perfect alignment`);
          
        } catch (error) {
          console.error('Failed to resize window:', error);
          
          // Fallback: center in current window if resizing fails
          const currentBounds = await ipcRenderer.invoke('get-window-bounds');
          
          const initialX = Math.round((currentBounds.width - originalImageWidth) / 2);
          const initialY = Math.round((currentBounds.height - originalImageHeight) / 2);
          
          content.style.backgroundPosition = `${initialX}px ${initialY}px`;
          originalPositionX = initialX;
          originalPositionY = initialY;
          imageOffset = { x: initialX, y: initialY };
          
          // Store current bounds if resize fails
          originalWindowBounds = currentBounds;
          currentWindowScale = 1.0;
        }
        
        console.log('Image pasted and positioned successfully');
        
        // Initialize drawing system with default settings
        updateBorderColor();
        
      } else {
        console.log('No image found in clipboard');
      }
    } catch (error) {
      console.error('Error pasting from clipboard:', error);
    }
  }
  
  // Handle Ctrl+X (crop to current view)
  else if (event.ctrlKey && event.key.toLowerCase() === 'x') {
    event.preventDefault();
    console.log('Ctrl+X detected, cropping to current view...');
    // Trigger the same crop function as the menu
    ipcRenderer.emit('crop-to-view');
  }
  
  // Handle Ctrl+B (toggle border)
  else if (event.ctrlKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    console.log('Ctrl+B detected, toggling border...');
    try {
      // Check if toggleBorder function exists
      if (typeof toggleBorder === 'function') {
        console.log('toggleBorder function found, calling it...');
        toggleBorder();
        console.log('Border toggle completed');
      } else {
        console.error('toggleBorder function not found!');
      }
    } catch (error) {
      console.error('Error toggling border:', error);
    }
  }
  
  // Handle Ctrl+N (new window)
  else if (event.ctrlKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    console.log('Ctrl+N detected, creating new window...');
    try {
      await ipcRenderer.invoke('create-new-window');
      console.log('New window created');
    } catch (error) {
      console.error('Error creating new window:', error);
    }
  }
  
  // Handle Ctrl+A (expand window to fill current display)
  else if (event.ctrlKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    console.log('Ctrl+A detected, expanding to fill display...');
    try {
      await ipcRenderer.invoke('expand-to-display');
      console.log('Window expanded to fill display');
    } catch (error) {
      console.error('Error expanding to display:', error);
    }
  }
  
  // Handle Ctrl+S (save image)
  else if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    console.log('Ctrl+S detected, saving image...');
    try {
      await ipcRenderer.invoke('save-image');
      console.log('Image save completed');
    } catch (error) {
      console.error('Error saving image:', error);
    }
  }
  
  // Handle Ctrl+F (open image from file)
  else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    console.log('Ctrl+F detected, opening file...');
    try {
      await ipcRenderer.invoke('open-image-file');
      console.log('File open completed');
    } catch (error) {
      console.error('Error opening file:', error);
    }
  }
  
  // Handle Ctrl+G (greyscale)
  else if (event.ctrlKey && event.key.toLowerCase() === 'g') {
    event.preventDefault();
    console.log('Ctrl+G detected, converting to greyscale...');
    try {
      await convertToGreyscale();
      console.log('Greyscale conversion completed');
    } catch (error) {
      console.error('Error converting to greyscale:', error);
    }
  }
  
  // Handle Ctrl+H (minimize to system tray)
  else if (event.ctrlKey && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    console.log('Ctrl+H detected, minimizing to system tray...');
    try {
      await ipcRenderer.invoke('minimize-to-tray');
      console.log('Minimized to system tray');
    } catch (error) {
      console.error('Error minimizing to tray:', error);
    }
  }
  
  // Handle Ctrl+Q (close all windows)
  else if (event.ctrlKey && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    console.log('Ctrl+Q detected, closing all windows...');
    try {
      await ipcRenderer.invoke('close-all-windows');
      console.log('All windows closed');
    } catch (error) {
      console.error('Error closing all windows:', error);
    }
  }
  
  // Handle Ctrl+W (switch to next display)
  else if (event.ctrlKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    console.log('Ctrl+W detected, switching to next display...');
    try {
      await ipcRenderer.invoke('switch-to-next-display');
      console.log('Switched to next display');
    } catch (error) {
      console.error('Error switching to next display:', error);
    }
  }
  
  // Handle Ctrl+I (invert image colors)
  else if (event.ctrlKey && event.key.toLowerCase() === 'i') {
    event.preventDefault();
    console.log('Ctrl+I detected, inverting image colors...');
    try {
      await invertImageColors();
      console.log('Image inversion completed');
    } catch (error) {
      console.error('Error inverting image colors:', error);
    }
  }
  
  // Handle Ctrl+M (black and white)
  else if (event.ctrlKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    console.log('Ctrl+M detected, converting to black and white...');
    try {
      await convertToBlackAndWhite();
      console.log('Black and white conversion completed');
    } catch (error) {
      console.error('Error converting to black and white:', error);
    }
  }
  
  // Handle Ctrl+0 (reset scale)
  else if (event.ctrlKey && event.key === '0') {
    event.preventDefault();
    try {
      await resetContentScale();
      console.log('Content scale reset triggered');
    } catch (error) {
      console.error('Error resetting content scale:', error);
    }
  }
  
  // Handle Ctrl+T (OCR text extraction)
  else if (event.ctrlKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    console.log('Ctrl+T detected, extracting text with OCR...');
    try {
      await extractTextWithOCR();
      console.log('OCR text extraction completed');
    } catch (error) {
      console.error('Error during OCR text extraction:', error);
    }
  }
  
  // Handle Ctrl+Z (undo)
  else if (event.ctrlKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    console.log('Ctrl+Z detected, undoing last operation...');
    try {
      await undoLastOperation();
      console.log('Undo operation completed');
    } catch (error) {
      console.error('Error during undo operation:', error);
    }
  }
  
  // Handle arrow keys for fine positioning
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    if (event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      
      // For Ctrl+Arrow: always 1 pixel movement (precise content nudging)
      // For Shift+Arrow: use device pixel ratio for window movement
      const pixelDelta = event.ctrlKey && !event.shiftKey ? 1 : Math.max(1, Math.round(window.devicePixelRatio));
      
      let deltaX = 0, deltaY = 0;
      switch(event.key) {
        case 'ArrowLeft':
          deltaX = -pixelDelta;
          break;
        case 'ArrowRight':
          deltaX = pixelDelta;
          break;
        case 'ArrowUp':
          deltaY = -pixelDelta;
          break;
        case 'ArrowDown':
          deltaY = pixelDelta;
          break;
      }
      
      console.log(`Arrow key: ${event.key}, deltaX: ${deltaX}, deltaY: ${deltaY}, Ctrl: ${event.ctrlKey}, Shift: ${event.shiftKey}, pixelDelta: ${pixelDelta}`);
      
      try {
        if (event.ctrlKey && event.shiftKey) {
          // Ctrl+Shift+Arrow: Move both window and content
          await adjustWindowPosition(deltaX, deltaY);
          adjustContentPosition(deltaX, deltaY);
        } else if (event.shiftKey && !event.ctrlKey) {
          // Shift+Arrow: Move window only
          await adjustWindowPosition(deltaX, deltaY);
        } else if (event.ctrlKey && !event.shiftKey) {
          // Ctrl+Arrow: Move content only (1 pixel precision)
          adjustContentPosition(deltaX, deltaY);
          console.log(`Content nudged by exactly ${deltaX}, ${deltaY} pixels`);
        }
      } catch (error) {
        console.error('Error adjusting position:', error);
      }
    }
  }
  
  // Handle F1 (show help)
  else if (event.key === 'F1') {
    event.preventDefault();
    console.log('F1 detected, showing help...');
    try {
      // Trigger the same help function as the menu
      const result = await ipcRenderer.invoke('show-help-dialog');
      if (result) {
        console.log('Help dialog displayed successfully');
      } else {
        console.error('Failed to show help dialog:', result.error);
      }
    } catch (error) {
      console.error('Error showing help dialog:', error);
    }
  }
  
  // Handle C (cycle colors) - only when NOT typing in text input
  else if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    // Check if we're currently typing in a text input - if so, don't intercept keys
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      // User is typing in text input - let the keys pass through
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      colorIndex = (colorIndex + 1) % drawingColors.length;
      drawingColor = drawingColors[colorIndex];
      updateBorderColor();
      console.log(`*** COLOR CHANGED *** to: ${drawingColor}`);
    }
  }
  
  // Handle mode switching shortcuts: T, B, R, A (only when image is loaded AND not typing in text input)
  else if (!event.ctrlKey && !event.altKey && !event.shiftKey && event.key !== 'Enter') {
    // Check if we're currently typing in a text input - if so, don't intercept keys
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      // User is typing in text input - let the keys pass through
      return;
    }
    
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      const key = event.key.toLowerCase();
      
      // Handle text size selection (1-5 keys like CSS headings H1-H5)
      if (['1', '2', '3', '4', '5'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        textSizeIndex = parseInt(event.key) - 1; // Convert 1-5 to 0-4 array index
        const sizeLabel = `H${event.key}`;
        const pixelSize = textSizes[textSizeIndex];
        updateBorderColor();
        console.log(`*** TEXT SIZE CHANGED *** to ${sizeLabel} (${pixelSize}px) via ${event.key} key`);
        debugLog(`*** TEXT SIZE SET *** to ${sizeLabel}: ${pixelSize}px`);
      }
      else if (key === 't') {
        // Text mode
        event.preventDefault();
        event.stopPropagation();
        setTextMode(true, 'T key pressed');
        setDrawingMode('text', 'T key pressed');
        document.body.style.cursor = 'text';
        updateBorderColor();
        const currentSizeLabel = `H${textSizeIndex + 1}`;
        const currentPixelSize = textSizes[textSizeIndex];
        debugLog(`*** TEXT MODE ACTIVATED *** via T key - Current size: ${currentSizeLabel} (${currentPixelSize}px) - Click to place text`);
        console.log(`*** TEXT MODE SET *** with size ${currentSizeLabel}: ${currentPixelSize}px - Use keys 1-5 to change size`);
      } else if (key === 's') {
        // Sharp Box mode (changed from B to S key)
        event.preventDefault();
        event.stopPropagation();
        setTextMode(false, 'S key pressed');
        setDrawingMode('box', 'S key pressed');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        debugLog('*** SHARP BOX MODE ACTIVATED *** via S key');
      } else if (key === 'r') {
        // Rounded box mode
        event.preventDefault();
        event.stopPropagation();
        setTextMode(false, 'R key pressed');
        setDrawingMode('rounded-box', 'R key pressed');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        console.log('*** ROUNDED BOX MODE ACTIVATED *** via R key');
      } else if (key === 'a') {
        // Arrow mode
        event.preventDefault();
        event.stopPropagation();
        setTextMode(false, 'A key pressed');
        setDrawingMode('arrow', 'A key pressed');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        console.log('*** ARROW MODE ACTIVATED *** via A key');
      } else if (key === 'f') {
        // Fill/Erase mode
        event.preventDefault();
        event.stopPropagation();
        setTextMode(false, 'F key pressed');
        setDrawingMode('fill', 'F key pressed');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        debugLog('*** FILL MODE ACTIVATED *** via F key - Right-drag to fill areas');
      } else if (key === 'b') {
        // Blur mode for subtle redaction
        event.preventDefault();
        event.stopPropagation();
        setTextMode(false, 'B key pressed');
        setDrawingMode('blur', 'B key pressed');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        debugLog('*** BLUR MODE ACTIVATED *** via B key - Right-drag to blur areas');
        console.log(`*** BLUR MODE SET *** drawingMode: ${drawingMode}, textMode: ${textMode}`);
      }
    }
  }
  
  // Handle Enter (commit drawing or enter text) - ONLY when image is loaded
  else if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;

    debugLog(`*** ENTER KEY PRESSED *** textMode: ${textMode}, pendingText: ${!!pendingText}, drawingMode: ${drawingMode}`);
    debugLog(`*** BACKGROUND IMAGE CHECK *** backgroundImage: ${backgroundImage}`);

    // Only handle Enter for drawing if we have an image loaded
    if (backgroundImage && backgroundImage !== 'none') {
      debugLog('*** IMAGE IS LOADED *** - processing Enter key');
      event.preventDefault();
      event.stopPropagation();

      if (textMode && pendingText) {
        // This case should not happen anymore since clicking immediately opens text input
        debugLog('*** REDUNDANT ENTER IN TEXT MODE *** - Text input should have opened automatically');
      } else if (textMode && !pendingText) {
        // Check if we have text on canvas that needs committing
        debugLog('*** TEXT MODE BRANCH ***');
        const hasTextOnCanvas = checkIfCanvasHasContent();
        if (hasTextOnCanvas) {
          debugLog('*** COMMITTING ALL TEXT TO IMAGE ***');
          commitDrawingToImage();
          // STAY in text mode after committing - user can continue adding text
          // setTextMode(false, 'committing all text to image');  // REMOVED
          // setDrawingMode('arrow', 'exiting text mode after commit');  // REMOVED
          document.body.style.cursor = 'text'; // Keep text cursor
          updateBorderColor();
          debugLog('*** TEXT COMMITTED *** - Still in text mode, click to add more text');
        } else {
          debugLog('*** TEXT MODE ACTIVE *** - Click to place text, Enter to commit when done');
        }
      } else {
        // Check if we have any drawing content (arrows, boxes, etc.) that needs committing
        debugLog('*** NON-TEXT MODE BRANCH ***');
        debugLog(`*** CHECKING FOR DRAWING CONTENT *** drawingMode: ${drawingMode}, isDrawing: ${isDrawing}`);
        const hasDrawingOnCanvas = checkIfCanvasHasContent();
        debugLog(`*** CANVAS CONTENT CHECK *** hasContent: ${hasDrawingOnCanvas}`);
        if (hasDrawingOnCanvas) {
          debugLog('*** COMMITTING DRAWING TO IMAGE ***');
          commitDrawingToImage();
        } else {
          debugLog('*** NO CONTENT TO COMMIT *** - Draw something first');
        }
      }
    } else {
      debugLog('*** NO IMAGE LOADED *** - Enter key ignored');
    }
    // If no image loaded, let Enter key pass through for normal capture functionality
  }

  // Handle Escape (text mode exit OR hide window)
  else if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const activeElement = document.activeElement;

    // If an input is focused, let its own handler handle Escape (prevents double-processing)
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    // If in text mode, exit text mode first
    if (textMode) {
      debugLog('*** ESCAPE KEY PRESSED *** - Exiting text mode (no active input)');
      exitTextModeStandard('Escape key (no active input)');
      // Force state (belt-and-suspenders) in case any async code reverts it
      textMode = false;
      drawingMode = 'arrow';
      console.log(`*** ESCAPE POST-EXIT STATE *** textMode=${textMode}, drawingMode=${drawingMode}`);
      event.preventDefault();
      event.stopPropagation();
    }
    // If not in text mode, hide the window (keeps systray alive)
    else {
      console.log('Escape pressed - hiding window');
      try {
        await ipcRenderer.invoke('hide-current-window');
      } catch (error) {
        console.error('Error hiding window:', error);
      }
      event.preventDefault();
    }
  }
}, false); // Use normal phase instead of capture to avoid interfering with system functions

// Drag and drop support for image files
document.addEventListener('DOMContentLoaded', () => {
  const body = document.querySelector('body');
  
  // Prevent default drag behaviors on the document
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Add visual feedback
    body.style.borderColor = 'blue';
    body.style.borderWidth = '4px';
    body.style.borderStyle = 'dashed';
  });
  
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only remove the visual feedback if we're actually leaving the window
    if (e.clientX <= 0 || e.clientY <= 0 || 
        e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      // Restore original border
      body.style.borderColor = body.style.borderColor === 'transparent' ? 'transparent' : 'red';
      body.style.borderWidth = '2px';
      body.style.borderStyle = 'solid';
    }
  });
  
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Restore original border
    body.style.borderColor = body.style.borderColor === 'transparent' ? 'transparent' : 'red';
    body.style.borderWidth = '2px';
    body.style.borderStyle = 'solid';
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      const file = imageFiles[0]; // Use the first image file
      console.log(`Processing dropped image: ${file.name} (${file.type})`);
      
      try {
        // Read the file as data URL
        const reader = new FileReader();
        reader.onload = async (event) => {
          const dataUrl = event.target.result;
          
          // Create an image to get dimensions
          const img = new Image();
          img.onload = async () => {
            console.log(`Dropped image size: ${img.width}x${img.height}px`);
            
            // Apply the dropped image as background
            content.style.backgroundImage = `url(${dataUrl})`;
            content.style.backgroundRepeat = 'no-repeat';
            
            // Automatically turn off border and set content opacity to 100% when dropping
            const content = document.querySelector('.content');
            body.style.borderColor = 'transparent';
            content.style.opacity = '1';
            currentOpacity = 1.0;
            console.log('Border turned off and opacity set to 100% for dropped image');
            
            // Update cursor now that we have image content
            updateCursor();
            
            
            // Get current display scale factor to handle DPI correctly
            const displayInfo = await ipcRenderer.invoke('get-display-info');
            const scaleFactor = displayInfo.scaleFactor;
            
            // For dropped files, the dimensions are actual pixel dimensions, not DPI-adjusted
            // We need to scale them to logical pixels for proper display
            originalImageWidth = Math.round(img.width / scaleFactor);
            originalImageHeight = Math.round(img.height / scaleFactor);
            currentImageScale = 1.0; // Reset scale to 1:1
            
            console.log(`Dropping image: ${img.width}x${img.height}px actual, ${originalImageWidth}x${originalImageHeight}px logical (scale: ${scaleFactor})`);
            
            // Set background size to logical dimensions for proper DPI handling
            content.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
            
            // Resize window to match image dimensions exactly (no border needed since it's transparent)
            try {
              const currentBounds = await ipcRenderer.invoke('get-window-bounds');
              
              // Since the border is transparent when loading, size window exactly to image dimensions
              const newBounds = {
                x: currentBounds.x,
                y: currentBounds.y,
                width: originalImageWidth,   // Exact image width - no border
                height: originalImageHeight  // Exact image height - no border
              };
              
              console.log(`Resizing window to match dropped image: ${newBounds.width}x${newBounds.height}px`);

              await ipcRenderer.invoke('set-window-bounds', newBounds);

              // Update tracked position
              trackedWindowPosition.x = newBounds.x;
              trackedWindowPosition.y = newBounds.y;

              // Position the image at (0,0) since there's no visible border
              const initialX = 0;
              const initialY = 0;
              
              console.log(`Positioning dropped image at: ${initialX}px, ${initialY}px (no border, perfect fit)`);
              
              content.style.backgroundPosition = `${initialX}px ${initialY}px`;
              
              // Store original position for reset functionality
              originalPositionX = initialX;
              originalPositionY = initialY;
              
              // Reset image offset to the initial position
              imageOffset = { x: initialX, y: initialY };
              
              // Store the new window bounds as original for reset functionality
              originalWindowBounds = newBounds;
              currentWindowScale = 1.0; // Reset window scale tracking
              
              console.log(`Image loaded successfully from dropped file: ${file.name}`);
              
            } catch (error) {
              console.error('Failed to resize window for dropped image:', error);
            }
          };
          
          img.src = dataUrl;
        };
        
        reader.readAsDataURL(file);
        
      } catch (error) {
        console.error('Error processing dropped image:', error);
      }
    } else {
      console.log('No image files found in dropped items');
    }
  });
});

// Helper function to trigger crop to current view
async function triggerCropToCurrentView() {
  try {
    const body = document.querySelector('body');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Get current window bounds
      const currentBounds = await ipcRenderer.invoke('get-window-bounds');
      
      // Get current background properties
      const backgroundSize = getComputedStyle(body).backgroundSize;
      const backgroundPosition = getComputedStyle(body).backgroundPosition;
      const borderStyle = getComputedStyle(body).borderStyle;
      const borderWidth = borderStyle === 'solid' ? 2 : 0; // 2px border or transparent
      
      // Parse background size
      const sizeParts = backgroundSize.split(' ');
      const imageDisplayWidth = parseFloat(sizeParts[0]) || 0;
      const imageDisplayHeight = parseFloat(sizeParts[1]) || imageDisplayWidth; // Handle single value
      
      // Parse background position
      const positionParts = backgroundPosition.split(' ');
      const imageOffsetX = parseFloat(positionParts[0]) || 0;
      const imageOffsetY = parseFloat(positionParts[1]) || 0;
      
      // Calculate the visible area of the image within the current window
      const windowContentWidth = currentBounds.width - (borderWidth * 2);
      const windowContentHeight = currentBounds.height - (borderWidth * 2);
      
      // Find the intersection of the image and the window content area
      const imageLeft = imageOffsetX;
      const imageTop = imageOffsetY;
      const imageRight = imageLeft + imageDisplayWidth;
      const imageBottom = imageTop + imageDisplayHeight;
      
      const viewLeft = borderWidth;
      const viewTop = borderWidth;
      const viewRight = viewLeft + windowContentWidth;
      const viewBottom = viewTop + windowContentHeight;
      
      // Calculate intersection bounds
      const visibleLeft = Math.max(imageLeft, viewLeft);
      const visibleTop = Math.max(imageTop, viewTop);
      const visibleRight = Math.min(imageRight, viewRight);
      const visibleBottom = Math.min(imageBottom, viewBottom);
      
      // Calculate visible dimensions
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      
      if (visibleWidth > 0 && visibleHeight > 0) {
        // Calculate the center of the visible image area relative to the current window
        const visibleCenterX = visibleLeft + (visibleWidth / 2);
        const visibleCenterY = visibleTop + (visibleHeight / 2);
        
        // Calculate the offset adjustments needed
        const offsetX = visibleLeft - borderWidth; // How much to move the window
        const offsetY = visibleTop - borderWidth; // How much to move the window
        
        // Calculate new background position after cropping
        const newBackgroundX = imageOffsetX - visibleLeft + borderWidth;
        const newBackgroundY = imageOffsetY - visibleTop + borderWidth;
        
        // Send crop information to main process
        const cropInfo = {
          visibleWidth: visibleWidth, // Don't add border - we want the exact visible image size
          visibleHeight: visibleHeight, // Don't add border - we want the exact visible image size
          offsetX: offsetX,
          offsetY: offsetY,
          borderWidth: borderWidth,
          newBackgroundX: newBackgroundX,
          newBackgroundY: newBackgroundY,
          visibleCenterX: visibleCenterX, // Center of visible area relative to current window
          visibleCenterY: visibleCenterY  // Center of visible area relative to current window
        };
        
        // Execute the crop
        const result = await ipcRenderer.invoke('crop-to-current-view', cropInfo);
        
        if (result.success) {
          // Update the background position to show the cropped area correctly
          content.style.backgroundPosition = `${newBackgroundX}px ${newBackgroundY}px`;
          
          // Update image offset tracking
          imageOffset = { x: newBackgroundX, y: newBackgroundY };
          
          console.log(`Auto-crop after scaling: window cropped to ${result.newBounds.width}x${result.newBounds.height}`);
        }
      }
    }
  } catch (error) {
    console.error('Error in auto-crop after scaling:', error);
  }
}

// OCR functionality to extract text from visible image portion
// Image color inversion functionality
async function invertImageColors() {
  try {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (!backgroundImage || backgroundImage === 'none') {
      console.log('No image available for color inversion');
      return;
    }
    
    console.log('Starting image color inversion...');
    
    // Get the current background image URL
    const imageUrl = backgroundImage.slice(5, -2); // Remove 'url("' and '")'
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create canvas to process the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size to image size
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Draw the image onto the canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data for pixel manipulation
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Invert each pixel's RGB values (but keep alpha unchanged)
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];       // Red
          data[i + 1] = 255 - data[i + 1]; // Green
          data[i + 2] = 255 - data[i + 2]; // Blue
          // data[i + 3] is alpha, leave unchanged
        }
        
        // Put the modified image data back to canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Convert canvas to data URL
        const invertedDataUrl = canvas.toDataURL('image/png');
        
        // Apply the inverted image as the new background
        content.style.backgroundImage = `url(${invertedDataUrl})`;
        
        updateCursor();
        
        console.log('Image colors inverted successfully');
        
      } catch (error) {
        console.error('Error processing image for inversion:', error);
      }
    };
    
    img.onerror = () => {
      console.error('Failed to load image for inversion');
    };
    
    img.src = imageUrl;
    
  } catch (error) {
    console.error('Error setting up image inversion:', error);
  }
}

// Move window position using tracked coordinates (no system reads)
// CRITICAL: This function eliminates drift by using pure math on tracked values
// NEVER call getBounds() in this function - it breaks the drift-prevention system
async function adjustWindowPosition(deltaX, deltaY) {
  try {
    console.log(`Window move: deltaX=${deltaX}, deltaY=${deltaY}`);
    
    // Update tracked position (pure math, no system reads)
    // CRITICAL: This is the ONLY place that updates tracked position for moves
    trackedWindowPosition.x += deltaX;
    trackedWindowPosition.y += deltaY;
    
    console.log(`New tracked position: x=${trackedWindowPosition.x}, y=${trackedWindowPosition.y}`);
    
    // Send position to main process (one-way: code → screen)
    // CRITICAL: Only pass x,y - main process uses stored constants for width/height
    await ipcRenderer.invoke('set-window-bounds', {
      x: trackedWindowPosition.x,
      y: trackedWindowPosition.y
      // No width/height - main process uses stored constants
    });
    
    console.log(`Window moved by (${deltaX}, ${deltaY})`);
  } catch (error) {
    console.error('Error moving window:', error);
  }
}

// Move content position
function adjustContentPosition(deltaX, deltaY) {
  const content = document.querySelector('.content');
  if (!content) {
    console.log('No .content element found for content adjustment');
    return;
  }
  
  // Get current background position
  const currentBgPos = getComputedStyle(content).backgroundPosition;
  let currentX = 0, currentY = 0;
  
  // Parse background position (could be "0px 0px" or "left top" etc.)
  if (currentBgPos && currentBgPos !== 'initial') {
    const parts = currentBgPos.split(' ');
    if (parts.length >= 2) {
      currentX = parseFloat(parts[0]) || 0;
      currentY = parseFloat(parts[1]) || 0;
    }
  }
  
  // Apply delta
  const newX = currentX + deltaX;
  const newY = currentY + deltaY;
  
  // Update background position
  content.style.backgroundPosition = `${newX}px ${newY}px`;
  
  // Update tracked image offset
  imageOffset.x = newX;
  imageOffset.y = newY;
  
  console.log(`Content background moved by (${deltaX}, ${deltaY}) to (${newX}, ${newY})`);
}

// Convert image to greyscale (Ctrl+G)
async function convertToGreyscale() {
  try {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (!backgroundImage || backgroundImage === 'none') {
      console.log('No image available for greyscale conversion');
      return;
    }
    
    console.log('Converting image to greyscale...');
    
    // Get the current background image URL
    const imageUrl = backgroundImage.slice(5, -2); // Remove 'url("' and '")'
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create canvas to process the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size to image size
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Draw the image onto the canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data for pixel manipulation
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Convert each pixel to greyscale using luminance formula
        for (let i = 0; i < data.length; i += 4) {
          const red = data[i];
          const green = data[i + 1];
          const blue = data[i + 2];
          
          // Calculate luminance (perceived brightness)
          const grey = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
          
          data[i] = grey;     // Red
          data[i + 1] = grey; // Green
          data[i + 2] = grey; // Blue
          // data[i + 3] is alpha, leave unchanged
        }
        
        // Put the modified image data back to canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Convert canvas to data URL
        const greyDataUrl = canvas.toDataURL('image/png');
        
        // Apply the greyscale image as the new background
        content.style.backgroundImage = `url(${greyDataUrl})`;
        
        updateCursor();
        
        console.log('Image converted to greyscale successfully');
        
      } catch (error) {
        console.error('Error processing image for greyscale conversion:', error);
      }
    };
    
    img.onerror = () => {
      console.error('Failed to load image for greyscale conversion');
    };
    
    img.src = imageUrl;
    
  } catch (error) {
    console.error('Error setting up greyscale conversion:', error);
  }
}

// Convert image to black and white with threshold (Ctrl+M)
async function convertToBlackAndWhite() {
  try {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (!backgroundImage || backgroundImage === 'none') {
      console.log('No image available for black and white conversion');
      return;
    }
    
    console.log('Converting image to black and white...');
    
    // Get the current background image URL
    const imageUrl = backgroundImage.slice(5, -2); // Remove 'url("' and '")'
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create canvas to process the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size to image size
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Draw the image onto the canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data for pixel manipulation
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Convert each pixel to black or white using threshold
        const threshold = 128; // Middle threshold
        
        for (let i = 0; i < data.length; i += 4) {
          const red = data[i];
          const green = data[i + 1];
          const blue = data[i + 2];
          
          // Calculate luminance (perceived brightness)
          const grey = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
          
          // Apply threshold: above threshold = white, below = black
          const bw = grey >= threshold ? 255 : 0;
          
          data[i] = bw;     // Red
          data[i + 1] = bw; // Green
          data[i + 2] = bw; // Blue
          // data[i + 3] is alpha, leave unchanged
        }
        
        // Put the modified image data back to canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Convert canvas to data URL
        const bwDataUrl = canvas.toDataURL('image/png');
        
        // Apply the black and white image as the new background
        content.style.backgroundImage = `url(${bwDataUrl})`;
        
        updateCursor();
        
        console.log('Image converted to black and white successfully');
        
      } catch (error) {
        console.error('Error processing image for black and white conversion:', error);
      }
    };
    
    img.onerror = () => {
      console.error('Failed to load image for black and white conversion');
    };
    
    img.src = imageUrl;
    
  } catch (error) {
    console.error('Error setting up black and white conversion:', error);
  }
}

// Toggle border visibility (Ctrl+B)
function toggleBorder() {
  try {
    const body = document.querySelector('body');
    
    console.log(`[${Date.now()}] Border toggle requested`);
    
    // Check current border state using CSS class system
    const hasBorderHidden = body.classList.contains('border-hidden');
    
    console.log(`  Current state: border-hidden class ${hasBorderHidden ? 'present' : 'not present'}`);
    console.log(`  Border is currently: ${hasBorderHidden ? 'OFF' : 'ON'}`);
    
    if (hasBorderHidden) {
      // Border is hidden, show it
      body.classList.remove('border-hidden');
      console.log(`[${Date.now()}] Border turned ON (removed border-hidden class)`);
    } else {
      // Border is visible, hide it
      body.classList.add('border-hidden');
      console.log(`[${Date.now()}] Border turned OFF (added border-hidden class)`);
    }
    
    // Force a small delay and update cursor to ensure changes take effect
    setTimeout(() => {
      updateCursor();
    }, 10);
    
  } catch (error) {
    console.error('Error toggling border:', error);
  }
}

// Reset content scale to 1:1 (Ctrl+0)
async function resetContentScale() {
  try {
    console.log('Resetting content scale to 1:1...');
    
    const content = document.querySelector('.content');
    const imageContainer = document.querySelector('.image-container');
    
    if (!content) {
      console.log('No content element found');
      return;
    }
    
    // Reset background size to original dimensions
    if (originalImageWidth && originalImageHeight) {
      content.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
      currentImageScale = 1.0;
      console.log(`Content scale reset to 1:1 (${originalImageWidth}x${originalImageHeight}px)`);
    }
    
    // Reset image container transform if it exists
    if (imageContainer) {
      imageContainer.style.transform = '';
      console.log('Image container transform reset');
    }
    
    // Reset content position to original
    if (originalPositionX !== undefined && originalPositionY !== undefined) {
      content.style.backgroundPosition = `${originalPositionX}px ${originalPositionY}px`;
      imageOffset = { x: originalPositionX, y: originalPositionY };
      console.log(`Content position reset to (${originalPositionX}, ${originalPositionY})`);
    }
    
    updateCursor();
    
  } catch (error) {
    console.error('Error resetting content scale:', error);
  }
}

// Extract text from current image using OCR (Ctrl+T)
async function extractTextWithOCR() {
  try {
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    // Check if there's an image to process
    if (!backgroundImage || backgroundImage === 'none') {
      console.log('No image available for OCR text extraction');
      alert('No image available for OCR text extraction. Please load an image first.');
      return;
    }
    
    console.log('Starting OCR text extraction process...');
    
    // Show processing cursor
    document.body.style.cursor = 'wait';
    
    try {
      // Process OCR in main process (handles Tesseract.js properly)
      const ocrResult = await ipcRenderer.invoke('extract-text-ocr');
      
      if (!ocrResult.success) {
        throw new Error(ocrResult.error || 'Failed to process OCR');
      }
      
      console.log(`OCR processing completed: ${ocrResult.textLength} characters extracted`);
      
      // Copy the extracted text to clipboard
      const copyResult = await ipcRenderer.invoke('copy-ocr-text', ocrResult.text);
      
      if (copyResult.success) {
        console.log(`OCR: Successfully copied ${copyResult.textLength} characters to clipboard`);
        
        // Show success feedback with text cursor
        document.body.style.cursor = 'text';
        
        // Show a brief notification
        const notification = `OCR Complete!\n${copyResult.textLength} characters copied to clipboard`;
        alert(notification);
        
        // Reset cursor after a delay
        setTimeout(() => {
          updateCursor();
        }, 2000);
        
      } else {
        throw new Error(copyResult.error || 'Failed to copy text to clipboard');
      }
      
    } catch (error) {
      console.error('OCR processing error:', error);
      alert(`OCR Error: ${error.message}`);
    } finally {
      // Reset cursor
      if (document.body.style.cursor === 'wait') {
        updateCursor();
      }
    }
    
  } catch (error) {
    console.error('Error setting up OCR text extraction:', error);
    alert(`OCR Setup Error: ${error.message}`);
    updateCursor();
  }
}

// Undo last operation (Ctrl+Z) - placeholder for future implementation
async function undoLastOperation() {
  try {
    console.log('Undo operation requested - not yet implemented');
    // TODO: Implement undo functionality with operation history
    
  } catch (error) {
    console.error('Error during undo operation:', error);
  }
}

// Handle loading selected area from global screen capture
ipcRenderer.on('load-selected-area', async (event, selectionData) => {
  console.log('Loading selected area:', selectionData);
  
  try {
    const content = document.querySelector('.content');
    
    // Create canvas to crop the selected area from the full screenshot
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Load the full screenshot image
    const img = new Image();
    img.onload = async () => {
      console.log(`Full screenshot loaded: ${img.width}x${img.height}`);
      
      // Calculate scale factor and logical dimensions
      const scaleFactor = selectionData.scaleFactor;
      const logicalScreenWidth = Math.round(img.width / scaleFactor);
      const logicalScreenHeight = Math.round(img.height / scaleFactor);
      
      // Calculate background position to show the selected area in the window
      // The window is positioned at the selection coordinates on screen
      // We need to offset the background so the selected area appears in the window
      const backgroundOffsetX = -selectionData.selectionCoords.left;
      const backgroundOffsetY = -selectionData.selectionCoords.top;
      
      console.log(`Background: ${logicalScreenWidth}x${logicalScreenHeight} at offset (${backgroundOffsetX}, ${backgroundOffsetY})`);
      
      // Set the background image to the full screenshot (not cropped)
      content.style.backgroundImage = `url(${selectionData.screenshot})`;
      content.style.backgroundSize = `${logicalScreenWidth}px ${logicalScreenHeight}px`;
      content.style.backgroundPosition = `${backgroundOffsetX}px ${backgroundOffsetY}px`;
      content.style.backgroundRepeat = 'no-repeat';
      
      // Update tracking variables for the full screenshot
      originalImageWidth = logicalScreenWidth;
      originalImageHeight = logicalScreenHeight;
      originalPositionX = backgroundOffsetX;
      originalPositionY = backgroundOffsetY;
      imageOffset = { x: backgroundOffsetX, y: backgroundOffsetY };
      currentImageScale = 1.0;
      
      // Set original window bounds for proper integration
      const currentBounds = await ipcRenderer.invoke('get-window-bounds');
      originalWindowBounds = {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height
      };

      // CRITICAL: Update tracked position with the actual window position after selection capture
      trackedWindowPosition.x = currentBounds.x;
      trackedWindowPosition.y = currentBounds.y;
      console.log(`Updated trackedWindowPosition after selection: (${currentBounds.x}, ${currentBounds.y})`);

      console.log(`Full screenshot loaded in window - shows selected area but can be repositioned/scaled`);
    };
    
    img.onerror = (error) => {
      console.error('Failed to load screenshot for selected area:', error);
    };
    
    img.src = selectionData.screenshot;
    
    // Initialize drawing system after image is loaded
    setTimeout(() => {
      updateBorderColor();
      console.log('Drawing system initialized with default settings');
    }, 100);
    
  } catch (error) {
    console.error('Error loading selected area:', error);
  }
});

// IPC handlers for drawing mode switching and committing
ipcRenderer.on('set-drawing-mode', (event, mode) => {
  const content = document.querySelector('.content');
  const backgroundImage = getComputedStyle(content).backgroundImage;
  
  console.log(`*** SET DRAWING MODE *** to: ${mode}`);
  
  if (backgroundImage && backgroundImage !== 'none') {
    setDrawingMode(mode, 'IPC set-drawing-mode');
    if (mode === 'text') {
      setTextMode(true, 'IPC set-drawing-mode to text');
      document.body.style.cursor = 'text';
      console.log('*** TEXT MODE ACTIVATED *** - Click anywhere to place and type text');
      console.log('*** TEXT WORKFLOW *** Click → Type → Enter → Repeat... → Final Enter to commit all');
      console.log(`Variables set: textMode=${textMode}, drawingMode=${drawingMode}`);
    } else {
      setTextMode(false, `IPC set-drawing-mode to ${mode}`);
      document.body.style.cursor = 'default';
      console.log(`*** ${mode.toUpperCase()} MODE ACTIVATED ***`);
    }
    updateBorderColor();
    console.log(`Drawing mode changed to: ${mode}`);
  } else {
    console.log('*** NO IMAGE LOADED *** - Cannot set drawing mode');
  }
});

ipcRenderer.on('commit-drawing', () => {
  commitDrawingToImage();
});

// ===== DRAWING SYSTEM =====

// Start arrow drawing
function startArrowDrawing(event) {
  isDrawing = true;
  // DON'T override drawingMode - keep the current mode
  console.log(`*** STARTING ARROW DRAWING *** in mode: ${drawingMode}`);
  drawingStart = { x: event.clientX, y: event.clientY };
  drawingCurrent = { x: event.clientX, y: event.clientY };
  
  // Enable pointer events on canvas for drawing
  drawingCanvas.style.pointerEvents = 'auto';
  
  console.log(`Arrow drawing started at (${drawingStart.x}, ${drawingStart.y})`);
}

// Start text mode (Alt + click)
function startTextMode(event) {
  console.log(`*** TEXT MODE CALLED *** - current mode: ${drawingMode}`);
  // DON'T override drawingMode - keep the current mode
  setDrawingMode('text');
  console.log(`Text mode activated at (${event.clientX}, ${event.clientY})`);
  // TODO: Implement text placement
}

// Draw arrow from start to end point
function drawArrow(startX, startY, endX, endY, preview = false) {
  if (!drawingCtx) return;
  
  // Clear canvas if this is a preview
  if (preview) {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  
  // Set drawing style using current color
  drawingCtx.strokeStyle = drawingColor;
  drawingCtx.fillStyle = drawingColor;
  drawingCtx.lineWidth = drawingLineWidth;
  
  // Draw line
  drawingCtx.beginPath();
  drawingCtx.moveTo(startX, startY);
  drawingCtx.lineTo(endX, endY);
  drawingCtx.stroke();
  
  // Draw arrowhead at start point (where user first clicked)
  const angle = Math.atan2(startY - endY, startX - endX);
  const headlen = 20; // Length of arrowhead
  
  drawingCtx.beginPath();
  drawingCtx.moveTo(startX, startY);
  drawingCtx.lineTo(
    startX - headlen * Math.cos(angle - Math.PI / 6),
    startY - headlen * Math.sin(angle - Math.PI / 6)
  );
  drawingCtx.moveTo(startX, startY);
  drawingCtx.lineTo(
    startX - headlen * Math.cos(angle + Math.PI / 6),
    startY - headlen * Math.sin(angle + Math.PI / 6)
  );
  drawingCtx.stroke();
}

// Start box drawing (right-click)
function startBoxDrawing(event) {
  isDrawing = true;
  // DON'T override drawingMode - keep the current mode (box or rounded-box)
  console.log(`*** STARTING BOX DRAWING *** in mode: ${drawingMode}`);
  drawingStart = { x: event.clientX, y: event.clientY };
  drawingCurrent = { x: event.clientX, y: event.clientY };
  
  // Enable pointer events on canvas for drawing
  drawingCanvas.style.pointerEvents = 'auto';
  
  console.log(`Box drawing started at (${drawingStart.x}, ${drawingStart.y}) in mode: ${drawingMode}`);
}

// Start fill drawing (right-click)
function startFillDrawing(event) {
  isDrawing = true;
  console.log(`*** STARTING FILL DRAWING *** in mode: ${drawingMode}`);
  drawingStart = { x: event.clientX, y: event.clientY };
  drawingCurrent = { x: event.clientX, y: event.clientY };
  
  // Enable pointer events on canvas for drawing
  drawingCanvas.style.pointerEvents = 'auto';
  
  console.log(`Fill drawing started at (${drawingStart.x}, ${drawingStart.y})`);
}

// Start blur drawing (right-click)
function startBlurDrawing(event) {
  isDrawing = true;
  console.log(`*** STARTING BLUR DRAWING *** in mode: ${drawingMode}`);
  console.log(`*** BLUR DRAWING INITIATED *** isDrawing: ${isDrawing}, drawingMode: ${drawingMode}`);
  drawingStart = { x: event.clientX, y: event.clientY };
  drawingCurrent = { x: event.clientX, y: event.clientY };
  
  // Enable pointer events on canvas for drawing
  drawingCanvas.style.pointerEvents = 'auto';
  
  console.log(`Blur drawing started at (${drawingStart.x}, ${drawingStart.y})`);
}

// Draw box from start to end point
function drawBox(startX, startY, endX, endY, preview = false) {
  if (!drawingCtx) return;
  
  // Clear canvas if this is a preview
  if (preview) {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  
  // Set drawing style using current color
  drawingCtx.strokeStyle = drawingColor;
  drawingCtx.lineWidth = drawingLineWidth;
  
  // Calculate rectangle dimensions
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  
  console.log(`Drawing ${drawingMode} from (${startX}, ${startY}) to (${endX}, ${endY})`);
  console.log(`Rectangle bounds: left=${left}, top=${top}, width=${width}, height=${height}`);
  
  if (drawingMode === 'rounded-box') {
    // FORCED rounded rectangle drawing with aggressive debugging
    const radius = Math.max(15, Math.min(40, width / 4, height / 4)); // Ensure visible radius
    console.log(`*** ROUNDED BOX MODE *** radius: ${radius}, width: ${width}, height: ${height}`);
    console.log(`Drawing mode confirmed as: ${drawingMode}`);
    
    // Always use manual method for reliability
    console.log('Using manual rounded rectangle method');
    drawRoundedRectManual(drawingCtx, left, top, width, height, radius);
  } else {
    // Draw regular rectangle
    console.log('Drawing regular box');
    drawingCtx.strokeRect(left, top, width, height);
  }
}

// Helper function to draw rounded rectangle manually
function drawRoundedRectManual(ctx, x, y, width, height, radius) {
  console.log(`*** DRAWING ROUNDED RECT *** x=${x}, y=${y}, w=${width}, h=${height}, r=${radius}`);
  
  ctx.beginPath();
  
  // Move to starting point (top edge, right of top-left corner)
  ctx.moveTo(x + radius, y);
  console.log(`Starting at: ${x + radius}, ${y}`);
  
  // Top edge
  ctx.lineTo(x + width - radius, y);
  // Top-right corner
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  
  // Right edge
  ctx.lineTo(x + width, y + height - radius);
  // Bottom-right corner
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  
  // Bottom edge
  ctx.lineTo(x + radius, y + height);
  // Bottom-left corner
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  
  // Left edge
  ctx.lineTo(x, y + radius);
  // Top-left corner
  ctx.quadraticCurveTo(x, y, x + radius, y);
  
  ctx.closePath();
  
  // Make sure stroke style is set
  ctx.lineWidth = 3; // Thicker line for visibility
  ctx.stroke();
  
  console.log('*** ROUNDED RECT DRAWING COMPLETED ***');
}

// Draw filled rectangle from start to end point (samples corner color)
function drawFillRect(startX, startY, endX, endY, preview = false) {
  if (!drawingCtx) return;
  
  // Clear canvas if this is a preview
  if (preview) {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  
  // Calculate rectangle dimensions
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  
  console.log(`Drawing fill rectangle from (${startX}, ${startY}) to (${endX}, ${endY})`);
  console.log(`Fill rectangle bounds: left=${left}, top=${top}, width=${width}, height=${height}`);
  
  // Sample the background color at the starting drag point (startX, startY)
  console.log(`*** ABOUT TO SAMPLE BACKGROUND COLOR *** at (${startX}, ${startY})`);
  const fillColor = sampleBackgroundColor(startX, startY);
  console.log(`*** SAMPLING COMPLETE *** Got color: ${fillColor}`);
  
  if (preview) {
    // For preview, just draw a stroked rectangle with some transparency
    drawingCtx.strokeStyle = fillColor;
    drawingCtx.lineWidth = 2;
    drawingCtx.setLineDash([5, 5]); // Dashed line for preview
    drawingCtx.strokeRect(left, top, width, height);
    drawingCtx.setLineDash([]); // Reset line dash
    
    // Add a semi-transparent fill to show what will be filled
    drawingCtx.fillStyle = fillColor + '80'; // Add transparency
    drawingCtx.fillRect(left, top, width, height);
  } else {
    // For final drawing, fill the rectangle with the sampled color
    drawingCtx.fillStyle = fillColor;
    drawingCtx.fillRect(left, top, width, height);
    console.log(`*** FILL RECTANGLE COMPLETED *** with color: ${fillColor}`);
  }
}

// Draw blurred rectangle from start to end point (applies blur effect)
function drawBlurRect(startX, startY, endX, endY, preview = false) {
  if (!drawingCtx) return;
  
  // Clear canvas if this is a preview
  if (preview) {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  
  // Calculate rectangle dimensions
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  
  console.log(`Drawing blur rectangle from (${startX}, ${startY}) to (${endX}, ${endY})`);
  console.log(`Blur rectangle bounds: left=${left}, top=${top}, width=${width}, height=${height}`);
  
  if (preview) {
    // For preview, draw a dashed rectangle with blur indication
    drawingCtx.strokeStyle = '#ff0000';
    drawingCtx.lineWidth = 2;
    drawingCtx.setLineDash([5, 5]); // Dashed line for preview
    drawingCtx.strokeRect(left, top, width, height);
    drawingCtx.setLineDash([]); // Reset line dash
    
    // Add a semi-transparent overlay to show what will be blurred
    drawingCtx.fillStyle = 'rgba(128, 128, 128, 0.5)';
    drawingCtx.fillRect(left, top, width, height);
  } else {
    // For final drawing, DON'T draw anything to canvas - just store blur area
    // The commit system will apply the actual blur effect to the background image
    
    // Store blur area for commit processing (needed for actual blur effect)
    if (!drawingCanvas.blurAreas) {
      drawingCanvas.blurAreas = [];
    }
    
    drawingCanvas.blurAreas.push({
      x: left,
      y: top,
      width: width,
      height: height
    });
    
    console.log(`*** BLUR AREA STORED *** areas: ${drawingCanvas.blurAreas.length} (no canvas drawing for final blur)`);
  }
}

// Helper function to apply blur effect to a specific area of the background image
function applyBlurToArea(x, y, width, height) {
  try {
    console.log(`*** APPLYING BLUR TO AREA *** (${x}, ${y}) ${width}x${height}`);
    
    // Get the content element which contains the background image
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Extract the data URL from the CSS background-image property
      const dataUrlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (dataUrlMatch && dataUrlMatch[1]) {
        const dataUrl = dataUrlMatch[1];
        console.log(`Found background image for blur processing`);
        
        // Create a fresh canvas with the background image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.src = dataUrl;
        
        if (img.complete && img.width > 0) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          console.log(`Blur canvas ready: ${img.width}x${img.height}`);
          
          // Transform drawing coordinates to image coordinates
          const blurArea = transformDrawingCoordsToImage(x, y, width, height, content, canvas);
          
          if (blurArea) {
            // Apply blur effect to the specific area
            applyBlurEffect(ctx, canvas, blurArea.x, blurArea.y, blurArea.width, blurArea.height);
            
            // Update the background image with the blurred version
            const blurredDataUrl = canvas.toDataURL('image/png');
            content.style.backgroundImage = `url(${blurredDataUrl})`;
            console.log(`*** BLUR EFFECT APPLIED *** to area successfully`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error applying blur effect:', error);
  }
}

// Helper function to transform drawing coordinates to image coordinates
function transformDrawingCoordsToImage(x, y, width, height, content, canvas) {
  try {
    // Get content properties for coordinate transformation
    const style = getComputedStyle(content);
    const backgroundSize = style.backgroundSize;
    const backgroundPosition = style.backgroundPosition;
    
    // Parse background size (e.g., "1920px 1080px")
    const sizeParts = backgroundSize.split(' ');
    const bgWidth = parseFloat(sizeParts[0]);
    const bgHeight = parseFloat(sizeParts[1]) || bgWidth;
    
    // Parse background position (e.g., "0px 0px")  
    const posParts = backgroundPosition.split(' ');
    const bgPosX = parseFloat(posParts[0]) || 0;
    const bgPosY = parseFloat(posParts[1]) || 0;
    
    // Transform drawing coordinates to image coordinates
    const imageX = x - bgPosX;
    const imageY = y - bgPosY;
    
    // Scale from displayed size to actual canvas size
    const scaleX = canvas.width / bgWidth;
    const scaleY = canvas.height / bgHeight;
    
    const canvasX = Math.floor(imageX * scaleX);
    const canvasY = Math.floor(imageY * scaleY);
    const canvasWidth = Math.floor(width * scaleX);
    const canvasHeight = Math.floor(height * scaleY);
    
    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(canvasX, canvas.width - 1));
    const clampedY = Math.max(0, Math.min(canvasY, canvas.height - 1));
    const clampedWidth = Math.max(1, Math.min(canvasWidth, canvas.width - clampedX));
    const clampedHeight = Math.max(1, Math.min(canvasHeight, canvas.height - clampedY));
    
    console.log(`Blur transform: drawing(${x}, ${y}, ${width}x${height}) -> canvas(${clampedX}, ${clampedY}, ${clampedWidth}x${clampedHeight})`);
    
    return {
      x: clampedX,
      y: clampedY,
      width: clampedWidth,
      height: clampedHeight
    };
  } catch (error) {
    console.error('Error transforming coordinates for blur:', error);
    return null;
  }
}

// Helper function to apply blur effect to a specific area of the canvas
function applyBlurEffect(ctx, canvas, x, y, width, height) {
  try {
    console.log(`Applying blur to canvas area: (${x}, ${y}) ${width}x${height}`);
    
    // Get the image data for the area to blur
    const imageData = ctx.getImageData(x, y, width, height);
    const data = imageData.data;
    
    // Create a simple box blur effect
    const blurRadius = 4; // Reduced from 8 for more subtle blur - good for redaction
    const tempData = new Uint8ClampedArray(data);
    
    // Apply horizontal blur pass
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        
        // Sample pixels in blur radius
        for (let bx = -blurRadius; bx <= blurRadius; bx++) {
          const sx = px + bx;
          if (sx >= 0 && sx < width) {
            const idx = (py * width + sx) * 4;
            r += tempData[idx];
            g += tempData[idx + 1];
            b += tempData[idx + 2];
            a += tempData[idx + 3];
            count++;
          }
        }
        
        const idx = (py * width + px) * 4;
        data[idx] = r / count;
        data[idx + 1] = g / count;
        data[idx + 2] = b / count;
        data[idx + 3] = a / count;
      }
    }
    
    // Copy for vertical pass
    tempData.set(data);
    
    // Apply vertical blur pass
    for (let px = 0; px < width; px++) {
      for (let py = 0; py < height; py++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        
        // Sample pixels in blur radius
        for (let by = -blurRadius; by <= blurRadius; by++) {
          const sy = py + by;
          if (sy >= 0 && sy < height) {
            const idx = (sy * width + px) * 4;
            r += tempData[idx];
            g += tempData[idx + 1];
            b += tempData[idx + 2];
            a += tempData[idx + 3];
            count++;
          }
        }
        
        const idx = (py * width + px) * 4;
        data[idx] = r / count;
        data[idx + 1] = g / count;
        data[idx + 2] = b / count;
        data[idx + 3] = a / count;
      }
    }
    
    // Put the blurred image data back
    ctx.putImageData(imageData, x, y);
    console.log(`Blur effect applied with radius ${blurRadius}`);
    
  } catch (error) {
    console.error('Error applying blur effect:', error);
  }
}

// Helper function to initialize the sampling canvas for pixel color sampling
function initializeSamplingCanvas(dataUrl) {
  if (!dataUrl) return;
  
  console.log('Initializing sampling canvas for pixel color sampling...');
  
  // Reset existing canvas
  window.samplingCanvas = document.createElement('canvas');
  window.samplingCtx = window.samplingCanvas.getContext('2d');
  
  const img = new Image();
  img.onload = function() {
    window.samplingCanvas.width = img.width;
    window.samplingCanvas.height = img.height;
    window.samplingCtx.drawImage(img, 0, 0);
    
    // Store original image dimensions for accurate coordinate transformation
    window.originalImageWidth = img.width;
    window.originalImageHeight = img.height;
    
    console.log(`Sampling canvas ready: ${img.width}x${img.height}`);
    console.log(`Stored original image dimensions: ${window.originalImageWidth}x${window.originalImageHeight}`);
  };
  img.onerror = function() {
    console.error('Failed to load image for sampling canvas');
  };
  img.src = dataUrl;
}

// Helper function to sample background color at a specific point  
function sampleBackgroundColor(x, y) {
  try {
    console.log(`*** SAMPLING PIXEL COLOR *** at coordinates (${x}, ${y})`);
    
    // Get the content element which contains the background image
    const content = document.querySelector('.content');
    const backgroundImage = getComputedStyle(content).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Extract the data URL from the CSS background-image property
      const dataUrlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (dataUrlMatch && dataUrlMatch[1]) {
        const dataUrl = dataUrlMatch[1];
        console.log(`Found background image data URL, length: ${dataUrl.length}`);
        
        // Create a fresh canvas for immediate pixel sampling
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        // Set up the image
        img.src = dataUrl;
        
        // For data URLs, the image loads synchronously
        if (img.complete && img.width > 0) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          console.log(`Canvas ready: ${img.width}x${img.height}`);
          
          // Sample the pixel directly
          return samplePixelFromCanvas(canvas, ctx, x, y, content);
        } else {
          console.log('Image not ready, using white fallback');
          return '#FFFFFF';
        }
      }
    }
    
    console.log(`No background image found, using white fallback`);
    return '#FFFFFF';
  } catch (error) {
    console.error('Error sampling background color:', error);
    return '#FFFFFF';
  }
}

// Helper function to sample from a canvas - simplified coordinate transformation
function samplePixelFromCanvas(canvas, ctx, x, y, content) {
  try {
    // Get content properties for coordinate transformation
    const contentRect = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    const backgroundSize = style.backgroundSize;
    const backgroundPosition = style.backgroundPosition;
    
    console.log(`Content rect: ${contentRect.width}x${contentRect.height}`);
    console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
    console.log(`Background size: ${backgroundSize}`);
    console.log(`Background position: ${backgroundPosition}`);
    
    // Parse background size (e.g., "1920px 1080px")
    const sizeParts = backgroundSize.split(' ');
    const bgWidth = parseFloat(sizeParts[0]);
    const bgHeight = parseFloat(sizeParts[1]) || bgWidth;
    
    // Parse background position (e.g., "0px 0px")  
    const posParts = backgroundPosition.split(' ');
    const bgPosX = parseFloat(posParts[0]) || 0;
    const bgPosY = parseFloat(posParts[1]) || 0;
    
    console.log(`Parsed background: ${bgWidth}x${bgHeight} at (${bgPosX}, ${bgPosY})`);
    
    // Transform mouse coordinates to image coordinates
    // Account for background position offset
    const imageX = x - bgPosX;
    const imageY = y - bgPosY;
    
    // Scale from displayed size to actual canvas size
    const scaleX = canvas.width / bgWidth;
    const scaleY = canvas.height / bgHeight;
    
    const canvasX = Math.floor(imageX * scaleX);
    const canvasY = Math.floor(imageY * scaleY);
    
    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(canvasX, canvas.width - 1));
    const clampedY = Math.max(0, Math.min(canvasY, canvas.height - 1));
    
    console.log(`Transform: mouse(${x}, ${y}) -> image(${imageX}, ${imageY}) -> canvas(${clampedX}, ${clampedY})`);
    
    // Sample the pixel
    const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
    const data = imageData.data;
    const color = `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
    
    console.log(`*** SAMPLED COLOR: ${color} *** RGBA: (${data[0]}, ${data[1]}, ${data[2]}, ${data[3]})`);
    return color;
  } catch (error) {
    console.error('Error sampling pixel from canvas:', error);
    return '#FFFFFF';
  }
}

// Helper function to check if drawing canvas has content
function checkIfCanvasHasContent() {
  debugLog(`*** CHECKING CANVAS CONTENT *** canvas: ${!!drawingCanvas}, ctx: ${!!drawingCtx}`);
  if (!drawingCanvas || !drawingCtx) {
    debugLog('*** NO CANVAS OR CONTEXT ***');
    return false;
  }
  
  debugLog(`*** CANVAS SIZE *** ${drawingCanvas.width}x${drawingCanvas.height}`);
  
  // Get image data from the canvas
  const imageData = drawingCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
  const data = imageData.data;
  
  debugLog(`*** IMAGE DATA LENGTH *** ${data.length} pixels`);
  
  // Check if any pixel has alpha > 0 (not transparent)
  let nonTransparentPixels = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      nonTransparentPixels++;
    }
  }
  
  debugLog(`*** NON-TRANSPARENT PIXELS *** ${nonTransparentPixels}`);
  
  // Also check for stored blur areas
  const hasBlurAreas = drawingCanvas.blurAreas && drawingCanvas.blurAreas.length > 0;
  debugLog(`*** BLUR AREAS *** ${hasBlurAreas ? drawingCanvas.blurAreas.length : 0}`);
  
  return nonTransparentPixels > 0 || hasBlurAreas;
}

// Helper function to update border color to reflect current drawing color
function updateBorderColor() {
  // The border is controlled by CSS ::before pseudo-element, so we need to update CSS
  const existingStyle = document.getElementById('dynamic-border-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  // Create new style element to override the border color
  const style = document.createElement('style');
  style.id = 'dynamic-border-style';
  style.textContent = `
    body::before {
      border-color: ${drawingColor} !important;
    }
  `;
  document.head.appendChild(style);
  
  console.log(`*** BORDER COLOR UPDATED *** to: ${drawingColor} (mode: ${drawingMode})`);
}

// Helper function to accept current drawing and make it permanent
function acceptCurrentDrawing() {
  // Clear any preview drawings and make current drawing permanent
  if (drawingCanvas && drawingCtx) {
    // The drawing is already on the canvas, so just clear the preview state
    isDrawing = false;
    drawingStart = null;
    drawingCurrent = null;
    pendingText = null;
    console.log('Current drawing accepted and made permanent');
  }
}

// Helper function to enter text input mode
function enterTextInput() {
  console.log(`*** ENTER TEXT INPUT *** textMode: ${textMode}, drawingMode: ${drawingMode}, pendingText: ${!!pendingText}`);
  
  if (pendingText) {
    // Clear any existing canvas content first
    if (drawingCtx) {
      // Don't clear the entire canvas, just ensure clean state for text input
    }
    
    // Create a text input overlay at the pending position
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.style.position = 'absolute';
    textInput.style.left = pendingText.x + 'px';
    // Position input box so text appears exactly where it will be drawn
    // Canvas fillText draws from baseline, so we need to adjust for that
  const baseFontSize = textSizes[textSizeIndex];
  // Scale displayed font size to match current image zoom so WYSIWYG reflects final size
  const scaledFontSize = Math.round(baseFontSize * currentImageScale);
  // Align baseline with click position using scaled size
  textInput.style.top = (pendingText.y - scaledFontSize) + 'px';
  textInput.style.fontSize = scaledFontSize + 'px';
    textInput.style.fontWeight = 'bold'; // Match the canvas text style
    textInput.style.fontFamily = 'Arial'; // Match the canvas font family
    textInput.style.color = drawingColor;
    textInput.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; // Much more transparent
    textInput.style.border = '1px solid ' + drawingColor;
    textInput.style.opacity = '0.7'; // Make the entire input semi-transparent
    textInput.style.borderRadius = '2px';
    // Minimal padding for precise alignment
    textInput.style.padding = '1px 3px'; // Very minimal padding to maintain position accuracy
    textInput.style.zIndex = '1000';
    // Scale minimum width with text size
  const minWidth = Math.max(80, scaledFontSize * 2.5); // Scale min width with on-screen font size
    textInput.style.minWidth = minWidth + 'px';
    
    document.body.appendChild(textInput);
    textInput.focus();
    
    // Function to clean up the text input
    const cleanupTextInput = () => {
      if (document.body.contains(textInput)) {
        document.body.removeChild(textInput);
      }
      pendingText = null;
      document.body.style.cursor = 'text';
      console.log('Text input cleaned up');
    };
    
    // Handle blur (clicking outside) - clean up abandoned text input
    textInput.addEventListener('blur', () => {
      // Small delay to allow for Enter key processing
      setTimeout(() => {
        if (document.body.contains(textInput)) {
          console.log('Text input abandoned - cleaning up');
          cleanupTextInput();
        }
      }, 100);
    });
    
    textInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        // Place the text on the canvas (not committed yet)
        const text = textInput.value;
        if (text.trim()) {
          drawTextOnCanvas(pendingText.x, pendingText.y, text);
        }
        cleanupTextInput();
        // KEEP text mode active for more text entry
        console.log(`*** TEXT PLACED *** textMode: ${textMode}, drawingMode: ${drawingMode} - staying in text mode`);
        console.log('Text placed on canvas - click elsewhere for more text, or press Enter to commit all text');
      } else if (event.key === 'Escape') {
        // Cancel current text input AND exit text mode (user requested behavior)
        cleanupTextInput();
        setTextMode(false, 'Escape inside text input - cancel and exit text mode');
        setDrawingMode('arrow', 'Escape inside text input - returning to arrow mode');
        document.body.style.cursor = 'crosshair';
        updateBorderColor();
        console.log('*** TEXT INPUT CANCELED *** - Exited text mode, normal mouse operations restored');
      }
    });
  }
}

// Helper function to draw text on canvas
function drawTextOnCanvas(x, y, text) {
  console.log(`*** DRAWING TEXT *** "${text}" at (${x}, ${y}) with size index ${textSizeIndex}`);
  
  if (drawingCtx) {
    // Use selected text size scaled by currentImageScale so that after commit (which scales down) final size matches chosen size
    const baseFontSize = textSizes[textSizeIndex];
    const scaledFontSize = Math.round(baseFontSize * currentImageScale);
    drawingCtx.font = `bold ${scaledFontSize}px Arial`;
    
    // Simple text drawing - no background, no outline, no shadows
    drawingCtx.fillStyle = drawingColor;
    drawingCtx.fillText(text, x, y);
    
    console.log(`*** TEXT DRAWING COMPLETED *** in color ${drawingColor} at scaled size ${scaledFontSize}px (base ${baseFontSize}px, scale ${currentImageScale.toFixed(2)}) (H${textSizeIndex + 1})`);
  } else {
    console.error('*** TEXT DRAWING FAILED *** - no drawing context');
  }
}

// Function to commit current drawing to the background image
function commitDrawingToImage() {
  const content = document.querySelector('.content');
  const backgroundImage = getComputedStyle(content).backgroundImage;
  
  console.log('*** COMMIT FUNCTION CALLED ***');
  console.log('backgroundImage exists:', backgroundImage !== 'none');
  console.log('drawingCanvas exists:', !!drawingCanvas);
  console.log('drawingCanvas.blurAreas:', drawingCanvas?.blurAreas?.length || 0);
  
  if (backgroundImage && backgroundImage !== 'none' && drawingCanvas) {
    console.log(`*** COMMIT CONDITIONS MET *** Starting commit process`);
    console.log(`*** BLUR AREAS CHECK *** drawingCanvas.blurAreas:`, drawingCanvas.blurAreas);
    
    try {
      // Get the current background image
      const img = new Image();
      img.onload = function() {
        console.log('Original image loaded for commit, size:', img.width, 'x', img.height);
        
        // Create a new canvas using the ORIGINAL image dimensions (not display size)
        const combinedCanvas = document.createElement('canvas');
        const combinedCtx = combinedCanvas.getContext('2d');
        
        // Set canvas size to match the original image dimensions
        combinedCanvas.width = img.width;
        combinedCanvas.height = img.height;
        
        // Draw the original background image at full resolution
        combinedCtx.drawImage(img, 0, 0);
        
        // Get the display dimensions and position of the background FIRST
        const backgroundSize = getComputedStyle(content).backgroundSize;
        const backgroundPosition = getComputedStyle(content).backgroundPosition;
        
        const sizeParts = backgroundSize.split(' ');
        const displayWidth = parseFloat(sizeParts[0]);
        const displayHeight = parseFloat(sizeParts[1]);
        
        const positionParts = backgroundPosition.split(' ');
        const offsetX = parseFloat(positionParts[0]) || 0;
        const offsetY = parseFloat(positionParts[1]) || 0;
        
        // Calculate scaling factors from display size to original image size
        const scaleX = img.width / displayWidth;
        const scaleY = img.height / displayHeight;
        
        console.log('Display size:', displayWidth, 'x', displayHeight);
        console.log('Display position:', offsetX, 'x', offsetY);
        console.log('Original size:', img.width, 'x', img.height);
        console.log('Current image scale:', currentImageScale);
        console.log('Scaling factors - X:', scaleX, 'Y:', scaleY);
        
        // Process any blur areas before applying drawing overlay
        if (drawingCanvas.blurAreas && drawingCanvas.blurAreas.length > 0) {
          console.log(`*** COMMIT: Processing ${drawingCanvas.blurAreas.length} blur areas ***`);
          console.log('Blur areas to process:', drawingCanvas.blurAreas);
          
          for (const blurArea of drawingCanvas.blurAreas) {
            // Transform blur area coordinates to original image coordinates
            const imageBlurArea = {
              x: Math.floor((blurArea.x - offsetX) * scaleX),
              y: Math.floor((blurArea.y - offsetY) * scaleY),
              width: Math.floor(blurArea.width * scaleX),
              height: Math.floor(blurArea.height * scaleY)
            };
            
            // Clamp to image bounds
            imageBlurArea.x = Math.max(0, Math.min(imageBlurArea.x, img.width - 1));
            imageBlurArea.y = Math.max(0, Math.min(imageBlurArea.y, img.height - 1));
            imageBlurArea.width = Math.max(1, Math.min(imageBlurArea.width, img.width - imageBlurArea.x));
            imageBlurArea.height = Math.max(1, Math.min(imageBlurArea.height, img.height - imageBlurArea.y));
            
            console.log(`Applying blur to image area: (${imageBlurArea.x}, ${imageBlurArea.y}) ${imageBlurArea.width}x${imageBlurArea.height}`);
            
            // Apply blur effect directly to the combined canvas
            applyBlurEffect(combinedCtx, combinedCanvas, imageBlurArea.x, imageBlurArea.y, imageBlurArea.width, imageBlurArea.height);
          }
          
          // Clear blur areas after processing
          drawingCanvas.blurAreas = [];
          
          // For blur-only commits, clear the canvas since we don't need visible overlays
          // (blur effect was already applied to the combined canvas above)
          drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
          console.log('*** BLUR AREAS PROCESSED - CANVAS CLEARED ***');
        }
        
        // Check if we still have any visible drawing content to overlay
        const hasVisibleDrawingContent = checkIfCanvasHasContent();
        console.log('*** HAS VISIBLE DRAWING CONTENT AFTER BLUR PROCESSING ***', hasVisibleDrawingContent);
        
        // Only apply drawing overlay if there's visible content remaining
        if (hasVisibleDrawingContent) {
          // Apply transformations to properly place the drawing overlay
          combinedCtx.save();
          
          // First scale to match the original image resolution
          combinedCtx.scale(scaleX, scaleY);
          
          // Then translate to account for background positioning offset
          combinedCtx.translate(-offsetX, -offsetY);
          
          // Draw the overlay canvas
          combinedCtx.drawImage(drawingCanvas, 0, 0);
          
          combinedCtx.restore();
        }
        
        // Convert to data URL and update background
        const newDataUrl = combinedCanvas.toDataURL('image/png');
        content.style.backgroundImage = `url(${newDataUrl})`;
        
        // Clear the drawing canvas
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        
        // Clear any stored blur areas
        if (drawingCanvas.blurAreas) {
          drawingCanvas.blurAreas = [];
        }
        
        console.log('Drawing committed to image successfully with proper scaling and offset');
      };
      
      img.onerror = function(error) {
        console.error('Error loading image for commit:', error);
      };
      
      // Extract the URL from the CSS background-image property
      const urlMatch = backgroundImage.match(/url\(['"]?([^'")]+)['"]?\)/);
      if (urlMatch) {
        console.log('Extracted image URL:', urlMatch[1]);
        img.src = urlMatch[1];
      } else {
        console.error('Could not extract image URL from background-image');
      }
    } catch (error) {
      console.error('Error committing drawing to image:', error);
    }
  } else {
    console.log('Cannot commit - no image or drawing canvas available');
    console.log('  backgroundImage:', backgroundImage);
    console.log('  drawingCanvas:', !!drawingCanvas);
  }
}
