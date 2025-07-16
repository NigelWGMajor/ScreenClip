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

ipcRenderer.on('reset-scale', () => {
  console.log('Reset scale event received in renderer');
  const body = document.querySelector('body');
  const backgroundImage = getComputedStyle(body).backgroundImage;
  
  if (backgroundImage && backgroundImage !== 'none' && originalImageWidth > 0) {
    // Reset image scale to 1:1
    currentImageScale = 1.0;
    
    // Reset window scale to 1:1
    currentWindowScale = 1.0;
    
    // Apply original image dimensions
    body.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
    
    // Reset position to initial screenshot alignment
    body.style.backgroundPosition = `${originalPositionX}px ${originalPositionY}px`;
    
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
      const body = document.querySelector('body');
      body.style.backgroundImage = `url(${result.dataUrl})`;
      body.style.backgroundRepeat = 'no-repeat';
      
      // Automatically turn off border and set opacity to 100% when loading
      body.style.borderColor = 'transparent';
      body.style.opacity = '1';
      currentOpacity = 1.0;
      console.log('Border turned off and opacity set to 100% for loaded image');
      
      // Use the loaded image dimensions
      originalImageWidth = result.logicalWidth;
      originalImageHeight = result.logicalHeight;
      currentImageScale = 1.0; // Reset scale to 1:1
      
      console.log(`Setting background to loaded image size: ${originalImageWidth}x${originalImageHeight}px`);
      
      // Set background size to image dimensions
      body.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
      
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
        
        body.style.backgroundPosition = `${initialX}px ${initialY}px`;
        
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
ipcRenderer.on('crop-to-view', async () => {
  console.log('Crop to current view event received in renderer');
  
  try {
    const body = document.querySelector('body');
    const backgroundImage = getComputedStyle(body).backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      // Get current window bounds
      const currentBounds = await ipcRenderer.invoke('get-window-bounds');
      
      // Get current background properties
      const backgroundSize = getComputedStyle(body).backgroundSize;
      const backgroundPosition = getComputedStyle(body).backgroundPosition;
      const borderStyle = getComputedStyle(body).borderStyle;
      const borderWidth = borderStyle === 'solid' ? 2 : 0; // 2px border or transparent
      
      console.log(`Current window: ${currentBounds.width}x${currentBounds.height}`);
      console.log(`Background size: ${backgroundSize}`);
      console.log(`Background position: ${backgroundPosition}`);
      console.log(`Border width: ${borderWidth}px`);
      
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
      
      console.log(`Image bounds: ${imageLeft}, ${imageTop} to ${imageRight}, ${imageBottom}`);
      console.log(`View bounds: ${viewLeft}, ${viewTop} to ${viewRight}, ${viewBottom}`);
      console.log(`Visible area: ${visibleLeft}, ${visibleTop} to ${visibleRight}, ${visibleBottom}`);
      console.log(`Visible size: ${visibleWidth}x${visibleHeight}`);
      
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
        
        console.log(`Visible center: (${visibleCenterX}, ${visibleCenterY}) relative to current window`);
        console.log(`Crop info:`, cropInfo);
        
        // Execute the crop
        const result = await ipcRenderer.invoke('crop-to-current-view', cropInfo);
        
        if (result.success) {
          // Update the background position to show the cropped area correctly
          body.style.backgroundPosition = `${newBackgroundX}px ${newBackgroundY}px`;
          
          // Update image offset tracking
          imageOffset = { x: newBackgroundX, y: newBackgroundY };
          
          console.log(`Window cropped successfully to ${result.newBounds.width}x${result.newBounds.height}`);
          console.log(`New background position: ${newBackgroundX}px, ${newBackgroundY}px`);
        } else {
          console.error('Failed to crop window:', result.error);
        }
      } else {
        console.log('No visible image area to crop to');
      }
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
          body.style.backgroundImage = `url(${processedDataUrl})`;
          
          // Reset scaling and positioning to fit the new image
          body.style.backgroundSize = `${result.logicalWidth}px ${result.logicalHeight}px`;
          body.style.backgroundPosition = '2px 2px'; // Account for border
          body.style.backgroundRepeat = 'no-repeat';
          
          // Reset image tracking variables
          currentImageScale = 1.0;
          originalImageWidth = result.logicalWidth;
          originalImageHeight = result.logicalHeight;
          originalPositionX = 2;
          originalPositionY = 2;
          imageOffset = { x: 2, y: 2 };
          
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
              body.style.backgroundImage = `url(${processedDataUrl})`;
              
              // Reset scaling and positioning to fit the new image
              body.style.backgroundSize = `${result.logicalWidth}px ${result.logicalHeight}px`;
              body.style.backgroundPosition = '2px 2px'; // Account for border
              body.style.backgroundRepeat = 'no-repeat';
              
              // Reset image tracking variables
              currentImageScale = 1.0;
              originalImageWidth = result.logicalWidth;
              originalImageHeight = result.logicalHeight;
              originalPositionX = 2;
              originalPositionY = 2;
              imageOffset = { x: 2, y: 2 };
              
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

// Mouse wheel event to adjust opacity, image scale, or window scale
document.addEventListener('wheel', (event) => {
  console.log('Mouse wheel event detected, deltaY:', event.deltaY, 'ctrlKey:', event.ctrlKey, 'shiftKey:', event.shiftKey);
  event.preventDefault(); // Prevent default scroll behavior
  
  const body = document.querySelector('body');
  
  if (event.shiftKey) {
    // Shift+Wheel: Scale entire window around mouse position
    const scaleDelta = event.deltaY > 0 ? -0.1 : 0.1; // Scroll down decreases scale, up increases
    const newWindowScale = Math.max(0.3, Math.min(5.0, currentWindowScale + scaleDelta));
    
    if (newWindowScale !== currentWindowScale) {
      // Get mouse position relative to screen
      const mouseScreenX = event.screenX;
      const mouseScreenY = event.screenY;
      
      // Get current window position first to calculate scaling from current size
      ipcRenderer.invoke('get-window-bounds').then(windowBounds => {
        // Calculate scale ratio
        const scaleRatio = newWindowScale / currentWindowScale;
        
        // Calculate new window dimensions based on CURRENT window size, not base size
        const newWidth = Math.floor(windowBounds.width * scaleRatio);
        const newHeight = Math.floor(windowBounds.height * scaleRatio);
        
        // Calculate mouse position relative to current window
        const mouseRelativeX = mouseScreenX - windowBounds.x;
        const mouseRelativeY = mouseScreenY - windowBounds.y;
        
        // Calculate the same relative position in the new scaled window
        const newMouseRelativeX = mouseRelativeX * scaleRatio;
        const newMouseRelativeY = mouseRelativeY * scaleRatio;
        
        // Calculate new window position to keep mouse point stationary
        const newWindowX = mouseScreenX - newMouseRelativeX;
        const newWindowY = mouseScreenY - newMouseRelativeY;
        
        // Update window scale tracking
        currentWindowScale = newWindowScale;
        
        // Scale the background image proportionally if it exists
        if (originalImageWidth > 0) {
          // Calculate the current displayed image size (original * current image scale)
          const currentDisplayedWidth = originalImageWidth * currentImageScale;
          const currentDisplayedHeight = originalImageHeight * currentImageScale;
          
          // Scale the displayed image size by the window scale
          const scaledImageWidth = currentDisplayedWidth * newWindowScale;
          const scaledImageHeight = currentDisplayedHeight * newWindowScale;
          body.style.backgroundSize = `${scaledImageWidth}px ${scaledImageHeight}px`;
          
          // Get current background position to scale it proportionally
          const currentPosition = getComputedStyle(body).backgroundPosition;
          const positionParts = currentPosition.split(' ');
          const currentX = parseFloat(positionParts[0]) || 0;
          const currentY = parseFloat(positionParts[1]) || 0;
          
          // Scale the current position by the window scale ratio
          const scaledPositionX = currentX * scaleRatio;
          const scaledPositionY = currentY * scaleRatio;
          body.style.backgroundPosition = `${scaledPositionX}px ${scaledPositionY}px`;
          
          // Update image offset tracking
          imageOffset = { x: scaledPositionX, y: scaledPositionY };
        }
        
        // Apply new window bounds
        ipcRenderer.invoke('set-window-bounds', {
          x: Math.floor(newWindowX),
          y: Math.floor(newWindowY),
          width: newWidth,
          height: newHeight
        });
        
        // Debounced auto-crop: only trigger after mouse wheel action has stopped
        if (autoCropTimer) {
          clearTimeout(autoCropTimer);
        }
        autoCropTimer = setTimeout(() => {
          triggerCropToCurrentView();
          autoCropTimer = null;
        }, 500); // Wait 500ms after last scroll event
        
        console.log(`Window scale adjusted to: ${currentWindowScale.toFixed(1)}x (${newWidth}x${newHeight})`);
      });
    }
  } else if (event.ctrlKey) {
    // Ctrl+Wheel: Adjust image scale centered on mouse position
    const scaleDelta = event.deltaY > 0 ? -0.1 : 0.1; // Scroll down decreases scale, up increases
    const newScale = Math.max(0.1, Math.min(5.0, currentImageScale + scaleDelta));
    
    // Check if we have a background image to scale
    const backgroundImage = getComputedStyle(body).backgroundImage;
    if (backgroundImage && backgroundImage !== 'none' && originalImageWidth > 0 && newScale !== currentImageScale) {
      
      // Get current background position
      const currentPosition = getComputedStyle(body).backgroundPosition;
      const positionParts = currentPosition.split(' ');
      const currentX = parseFloat(positionParts[0]) || 0;
      const currentY = parseFloat(positionParts[1]) || 0;
      
      // Calculate mouse position relative to the element
      const rect = body.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      // Calculate the point on the image that's under the mouse cursor
      const imagePointX = mouseX - currentX;
      const imagePointY = mouseY - currentY;
      
      // Calculate scale factor change
      const scaleRatio = newScale / currentImageScale;
      
      // Apply new scale to original dimensions
      const newWidth = originalImageWidth * newScale;
      const newHeight = originalImageHeight * newScale;
      
      // Calculate new background position to keep the same point under the mouse
      const newImagePointX = imagePointX * scaleRatio;
      const newImagePointY = imagePointY * scaleRatio;
      const newX = mouseX - newImagePointX;
      const newY = mouseY - newImagePointY;
      
      // Update the background
      body.style.backgroundSize = `${newWidth}px ${newHeight}px`;
      body.style.backgroundPosition = `${newX}px ${newY}px`;
      
      // Update tracking variables
      currentImageScale = newScale;
      imageOffset = { x: newX, y: newY };
      
      console.log(`Image scale adjusted to: ${currentImageScale.toFixed(1)}x (${newWidth.toFixed(0)}x${newHeight.toFixed(0)}) centered on mouse`);
    }
  } else {
    // Normal wheel: Adjust opacity
    const delta = event.deltaY > 0 ? -0.05 : 0.05; // Scroll down decreases opacity, up increases
    
    currentOpacity += delta;

    // Clamp opacity between 0.05 and 0.95
    currentOpacity = Math.max(0.05, Math.min(0.95, currentOpacity));
    
    // Apply opacity to the entire body (affects both background color and background image)
    body.style.opacity = currentOpacity;
    
    console.log(`Opacity adjusted to: ${currentOpacity.toFixed(2)}`);
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
      const body = document.querySelector('body');
      body.style.backgroundImage = `url(${cropInfo.fullScreenshot})`;
      body.style.backgroundRepeat = 'no-repeat';
      
      // Scale the image to display at 1:1 scale (actual screen size in CSS pixels)
      // The screenshot is in physical pixels, so we need to scale it down by the scale factor
      const actualScreenWidth = cropInfo.screenshotSize.width / scaleFactor;
      const actualScreenHeight = cropInfo.screenshotSize.height / scaleFactor;
      body.style.backgroundSize = `${actualScreenWidth}px ${actualScreenHeight}px`;
      
      // Store original dimensions for scaling
      originalImageWidth = actualScreenWidth;
      originalImageHeight = actualScreenHeight;
      currentImageScale = 1.0; // Reset scale to 1:1
      
      // Position the image so the window area appears centered initially
      // Apply a manual 2px compensation to counteract the consistent offset (move up and left)
      const initialX = -Math.floor(cropInfo.windowX / scaleFactor) - 2;
      const initialY = -Math.floor(cropInfo.windowY / scaleFactor) - 2;
      
      body.style.backgroundPosition = `${initialX}px ${initialY}px`;
      
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
      // Temporarily set opacity to 1 for the capture
      const body = document.querySelector('body');
      const originalOpacity = body.style.opacity;
      body.style.opacity = '1';
      
      // Wait a moment for the opacity change to take effect
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Capture current window view to clipboard
      const success = await ipcRenderer.invoke('copy-to-clipboard');
      
      // Restore original opacity
      body.style.opacity = originalOpacity;
      
      if (success) {
        console.log('Current window view successfully copied to clipboard!');
      } else {
        console.error('Failed to copy window view to clipboard');
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      
      // Restore opacity even if there was an error
      const body = document.querySelector('body');
      body.style.opacity = currentOpacity;
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
        const body = document.querySelector('body');
        body.style.backgroundImage = `url(${clipboardData.dataUrl})`;
        body.style.backgroundRepeat = 'no-repeat';
        
        // Automatically turn off border and set opacity to 100% when pasting
        body.style.borderColor = 'transparent';
        body.style.opacity = '1';
        currentOpacity = 1.0;
        console.log('Border turned off and opacity set to 100% for pasted image');
        
        // Use the logical dimensions which should be DPI-adjusted
        originalImageWidth = clipboardData.logicalWidth;
        originalImageHeight = clipboardData.logicalHeight;
        currentImageScale = 1.0; // Reset scale to 1:1
        
        console.log(`Setting background to logical size: ${originalImageWidth}x${originalImageHeight}px`);
        
        // Set background size to logical image dimensions
        body.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
        
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
          
          body.style.backgroundPosition = `${initialX}px ${initialY}px`;
          
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
          
          body.style.backgroundPosition = `${initialX}px ${initialY}px`;
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
            body.style.backgroundImage = `url(${dataUrl})`;
            body.style.backgroundRepeat = 'no-repeat';
            
            // Automatically turn off border and set opacity to 100% when dropping
            body.style.borderColor = 'transparent';
            body.style.opacity = '1';
            currentOpacity = 1.0;
            console.log('Border turned off and opacity set to 100% for dropped image');
            
            // Use the dropped image dimensions
            originalImageWidth = img.width;
            originalImageHeight = img.height;
            currentImageScale = 1.0; // Reset scale to 1:1
            
            console.log(`Setting background to dropped image size: ${originalImageWidth}x${originalImageHeight}px`);
            
            // Set background size to image dimensions
            body.style.backgroundSize = `${originalImageWidth}px ${originalImageHeight}px`;
            
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
              
              body.style.backgroundPosition = `${initialX}px ${initialY}px`;
              
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
    const backgroundImage = getComputedStyle(body).backgroundImage;
    
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
          body.style.backgroundPosition = `${newBackgroundX}px ${newBackgroundY}px`;
          
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
