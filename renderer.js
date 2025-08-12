console.log('Renderer process loaded');

// Using direct ipcRenderer since contextIsolation is disabled
const { ipcRenderer } = require('electron');

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

// Debounce timer for auto-crop after scaling
let autoCropTimer = null;


// Set initial fade opacity on .fill when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const fill = document.querySelector('.fill');
  if (fill) {
    fill.classList.add('fade-opacity');
    fill.style.setProperty('--fade-opacity', currentOpacity);
    console.log(`Initial .fill fade opacity set to: ${currentOpacity}`);
  }
  
  // Set initial cursor (should be context-menu since no image is loaded yet)
  updateCursor();
  console.log('Initial cursor set');
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
    } else {
      // Fallback to base size if no original bounds available
      ipcRenderer.invoke('get-window-bounds').then(currentBounds => {
        const newWidth = baseWindowWidth;
        const newHeight = baseWindowHeight;
        
        // Calculate new position to keep window centered on its current center
        const currentCenterX = currentBounds.x + currentBounds.width / 2;
        const currentCenterY = currentBounds.y + currentBounds.height / 2;
        const newX = currentCenterX - newWidth / 2;
        const newY = currentCenterY - newHeight / 2;
        
        ipcRenderer.invoke('set-window-bounds', {
          x: Math.floor(newX),
          y: Math.floor(newY),
          width: newWidth,
          height: newHeight
        });
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
        // Get current display scale factor for proper pixel calculations
        const displayInfo = await ipcRenderer.invoke('get-display-info');
        const scaleFactor = displayInfo.scaleFactor;
        
        // Calculate crop area: the original window area within the full screen image
        // The screenshot contains the full window including border, so crop from window position
        // originalWindowBounds is in logical pixels, but the image is in physical pixels
        const cropX = Math.floor(originalWindowBounds.x * scaleFactor);
        const cropY = Math.floor(originalWindowBounds.y * scaleFactor);
        const cropWidth = Math.floor(originalWindowBounds.width * scaleFactor);
        const cropHeight = Math.floor(originalWindowBounds.height * scaleFactor);
        
        console.log(`Original window: ${originalWindowBounds.width}x${originalWindowBounds.height} at (${originalWindowBounds.x}, ${originalWindowBounds.y})`);
        console.log(`Cropping from full screen image: ${cropWidth}x${cropHeight} at (${cropX}, ${cropY}) (physical pixels)`);
        console.log(`Scale factor: ${scaleFactor}`);
        
        // Set canvas size to the crop area (in physical pixels for quality)
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        
        // Draw the cropped portion from the full screen image
        ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        
        // Convert to data URL
        const croppedDataUrl = canvas.toDataURL('image/png');
        
        // Calculate logical dimensions for display - this is the full window size
        const logicalWidth = Math.round(cropWidth / scaleFactor);
        const logicalHeight = Math.round(cropHeight / scaleFactor);
        
        // Update the background image with cropped version
        content.style.backgroundImage = `url(${croppedDataUrl})`;
        content.style.backgroundSize = `${logicalWidth}px ${logicalHeight}px`;
        content.style.backgroundPosition = '0px 0px';
        content.style.backgroundRepeat = 'no-repeat';
        
        // Update tracking variables
        originalImageWidth = logicalWidth;
        originalImageHeight = logicalHeight;
        originalPositionX = 0;
        originalPositionY = 0;
        imageOffset = { x: 0, y: 0 };
        currentImageScale = 1.0;
        
        // Resize window to match cropped content exactly (no additional border needed)
        const newBounds = {
          x: originalWindowBounds.x,
          y: originalWindowBounds.y,
          width: logicalWidth,
          height: logicalHeight
        };
        
        await ipcRenderer.invoke('set-window-bounds', newBounds);
        
        console.log(`Image cropped to window content area: ${logicalWidth}x${logicalHeight}px (logical)`);
        console.log(`Window resized to: ${newBounds.width}x${newBounds.height}px`);
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


// Mouse wheel event to adjust opacity, image scale, or window scale
document.addEventListener('wheel', (event) => {
  console.log('Mouse wheel event detected, deltaY:', event.deltaY, 'ctrlKey:', event.ctrlKey, 'shiftKey:', event.shiftKey);
  event.preventDefault(); // Prevent default scroll behavior
  const app = document.getElementById('app');
  const body = document.body;
  if (event.shiftKey) {
    // ...existing code for window scaling...
    // (leave unchanged)
  } else if (event.ctrlKey) {
    // ...existing code for image scaling...
    // (leave unchanged)
  } else {
    // Normal wheel: Adjust opacity of .content div (which contains the image)
    // Up (deltaY < 0): more opaque, Down (deltaY > 0): more transparent
    const content = document.querySelector('.content');
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
    
    if (shiftPressed && ctrlPressed) {
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
    // Right-click: Keep for context menu only, no dragging
    // (Right-click dragging is now handled by Ctrl+Left-click)
  }
});

document.addEventListener('mousemove', async (event) => {
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
        
        // Adjust image position in opposite direction to keep it stationary on screen
        // Calculate offset based on total window movement from start, not incremental deltas
        imageOffset.x = dragInfo.initialOffsetX - totalWindowMoveX;
        imageOffset.y = dragInfo.initialOffsetY - totalWindowMoveY;
        
        content.style.backgroundPosition = `${imageOffset.x}px ${imageOffset.y}px`;
        
        console.log(`Window moved total: (${totalWindowMoveX}, ${totalWindowMoveY}), Image offset: (${imageOffset.x}, ${imageOffset.y})`);
        
      } catch (error) {
        console.error('Failed to drag window:', error);
      }
    }
  }
});

document.addEventListener('mouseup', (event) => {
  if (isDragging) {
    isDragging = false;
    dragInfo = null;
    console.log(isCombinedDrag ? 'Combined drag ended' : (isImageDrag ? 'Image drag ended' : 'Window drag ended'));
    isImageDrag = false;
    isCombinedDrag = false;
    rightClickDragStarted = false; // Reset flag
    
    // Reset cursor based on current modifier state
    updateCursor(event);
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

// Only prevent context menu if we actually started dragging an image
document.addEventListener('contextmenu', (event) => {
  if (rightClickDragStarted) {
    event.preventDefault(); // Only prevent if we actually dragged
  }
  // Otherwise, allow normal context menu
});

// Keyboard event handler for Ctrl+C (copy) and Ctrl+V (paste) functionality
document.addEventListener('keydown', async (event) => {
  // Check for Ctrl+C (copy current view to clipboard)
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault(); // Prevent default copy behavior
    
    console.log('Ctrl+C detected, copying current window view to clipboard...');
    
    try {
      // Temporarily set content opacity to 1 for the capture
      const content = document.querySelector('.content');
      const originalOpacity = content.style.opacity;
      content.style.opacity = '1';
      
      // Wait a moment for the opacity change to take effect
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Capture current window view to clipboard
      const success = await ipcRenderer.invoke('copy-to-clipboard');
      
      // Restore original opacity
      content.style.opacity = originalOpacity;
      
      if (success) {
        console.log('Current window view successfully copied to clipboard!');
      } else {
        console.error('Failed to copy window view to clipboard');
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      
      // Restore content opacity even if there was an error
      const content = document.querySelector('.content');
      content.style.opacity = currentOpacity;
    }
  }
  // Check for Ctrl+V (paste image from clipboard)
  else if (event.ctrlKey && event.key.toLowerCase() === 'v') {
    event.preventDefault(); // Prevent default paste behavior
    
    console.log('Ctrl+V detected, pasting image from clipboard...');
    
    try {
      // Request image from clipboard
      const clipboardData = await ipcRenderer.invoke('paste-from-clipboard');
      
      if (clipboardData) {
        console.log('Image pasted from clipboard successfully');
        console.log(`Image size: ${clipboardData.logicalWidth}x${clipboardData.logicalHeight}px`);
        console.log(`Scale factor: ${clipboardData.scaleFactor || 'unknown'}`);
        
        // Apply the pasted image as background
        const content = document.querySelector('.content');
        const body = document.querySelector('body');
        content.style.backgroundImage = `url(${clipboardData.dataUrl})`;
        content.style.backgroundRepeat = 'no-repeat';
        
        // Automatically turn off border and set content opacity to 100% when pasting
        body.style.borderColor = 'transparent';
        content.style.opacity = '1';
        currentOpacity = 1.0;
        console.log('Border turned off and opacity set to 100% for pasted image');
        
        // Update cursor now that we have image content
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
        
      } else {
        console.log('No image found in clipboard');
      }
    } catch (error) {
      console.error('Error pasting from clipboard:', error);
    }
  }
});

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
