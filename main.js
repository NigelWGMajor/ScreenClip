const { app, BrowserWindow, Menu, ipcMain, screen, nativeImage, desktopCapturer, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let windows = []; // Array to track all windows

// Track window position and dimensions to prevent drift
// These are the single source of truth - never read back from system
// CRITICAL: Any changes to position/size MUST go through these variables
// DO NOT use getBounds() during moves - it causes cumulative drift!
const windowStates = new Map(); // windowId -> {x, y, width, height}
const programmaticMoves = new Set(); // Track which windows are being moved programmatically

function createWindow() {
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    transparent: true,
    frame: false,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: false
    }
  });

  // Initialize window state tracking
  // CRITICAL: This is the ONLY place where initial dimensions are set
  windowStates.set(newWindow.id, { x: 100, y: 100, width: 1200, height: 800 });
  
  // Only update tracking when user manually resizes (not during programmatic moves)
  // CRITICAL: This prevents resize events from corrupting our stored state during setBounds()
  newWindow.on('resize', () => {
    // Skip if this is a programmatic move
    if (programmaticMoves.has(newWindow.id)) {
      console.log(`Ignoring resize event for programmatic move on window ${newWindow.id}`);
      return;
    }
    
    const bounds = newWindow.getBounds();
    const state = windowStates.get(newWindow.id);
    if (state) {
      // ONLY update width/height here - never position during manual resize
      state.width = bounds.width;
      state.height = bounds.height;
      console.log(`Window ${newWindow.id} manually resized to: ${bounds.width}x${bounds.height}`);
    }
  });
  
  // Clean up tracking when window closed
  newWindow.on('closed', () => {
    windowStates.delete(newWindow.id);
  });

  newWindow.loadFile('index.html');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Copy (Ctrl+C)',
      click: () => {
        newWindow.webContents.send('menu-copy');
      }
    },
    {
      label: 'Paste (Ctrl+V)',
      click: () => {
        newWindow.webContents.send('menu-paste');
      }
    },
    { type: 'separator' },
    {
      label: 'Load Image from File...',
      click: () => {
        newWindow.webContents.send('menu-load-file');
      }
    },
    {
      label: 'Save Image to File...',
      click: () => {
        newWindow.webContents.send('menu-save-file');
      }
    },
    { type: 'separator' },
    {
      label: 'Toggle Border Visibility',
      click: () => {
        newWindow.webContents.send('toggle-border');
      }
    },
    {
      label: 'Reset Image',
      click: () => {
        newWindow.webContents.send('reset-scale');
      }
    },
    {
      label: 'Crop to Current View',
      click: () => {
        newWindow.webContents.send('crop-to-view');
      }
    },
    {
      label: 'Transparentize Color',
      submenu: [
        {
          label: 'Low Tolerance (5)',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color', { ...coords, tolerance: 5 });
            }
          }
        },
        {
          label: 'Medium Tolerance (15)',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color', { ...coords, tolerance: 15 });
            }
          }
        },
        {
          label: 'Default Tolerance (20)',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color', { ...coords, tolerance: 20 });
            }
          }
        },
        {
          label: 'High Tolerance (35)',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color', { ...coords, tolerance: 35 });
            }
          }
        },
        {
          label: 'Very High Tolerance (50)',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color', { ...coords, tolerance: 50 });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Custom Tolerance...',
          click: () => {
            const coords = newWindow.contextMenuCoords;
            if (coords) {
              newWindow.webContents.send('transparentize-color-custom', coords);
            }
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Invert Colors (Ctrl+I)',
      click: () => {
        newWindow.webContents.send('invert-colors');
      }
    },
    { type: 'separator' },
    {
      label: 'New Window',
      click: () => {
        createWindow();
      }
    },
    {
      label: 'Help',
      click: () => {
        newWindow.webContents.send('show-help');
      }
    },
    {
      label: 'Open Dev Tools',
      click: () => {
        newWindow.webContents.openDevTools();
      }
    },
    {
      label: 'Close Window',
      click: () => {
        newWindow.close();
      }
    },
    {
      label: 'Close All Windows',
      click: () => {
        // Close all windows
        const allWindows = [...windows]; // Create a copy to avoid array modification issues
        allWindows.forEach(window => {
          if (window && !window.isDestroyed()) {
            window.close();
          }
        });
      }
    }
  ]);

  newWindow.webContents.on('context-menu', (event, params) => {
    // params contains x, y coordinates relative to the web contents
    console.log(`Context menu at: (${params.x}, ${params.y}) on window ${newWindow.id}`);
    
    // Store the coordinates for use in menu actions
    newWindow.contextMenuCoords = { x: params.x, y: params.y };
    
    contextMenu.popup();
  });

  newWindow.once('ready-to-show', () => {
    newWindow.show();
  });

  newWindow.on('closed', () => {
    // Remove the window from the windows array
    const index = windows.indexOf(newWindow);
    if (index > -1) {
      windows.splice(index, 1);
    }
    
    // If this was the main window, update the reference
    if (newWindow === mainWindow) {
      mainWindow = windows.length > 0 ? windows[0] : null;
    }
  });

  // Track window movement for image position adjustment
  let lastWindowPosition = null;
  
  newWindow.on('move', () => {
    const currentBounds = newWindow.getBounds();
    
    if (lastWindowPosition) {
      const deltaX = currentBounds.x - lastWindowPosition.x;
      const deltaY = currentBounds.y - lastWindowPosition.y;
      
      // Only notify if the window actually moved
      if (deltaX !== 0 || deltaY !== 0) {
        // Send window movement to renderer for image position adjustment
        newWindow.webContents.send('window-moved', { deltaX, deltaY });
      }
    }
    
    lastWindowPosition = { x: currentBounds.x, y: currentBounds.y };
  });

  // Add the window to the windows array
  windows.push(newWindow);
  
  // Set as main window if it's the first one
  if (!mainWindow) {
    mainWindow = newWindow;
  }
  
  return newWindow;
}

// IPC handler for screenshot capture
ipcMain.handle('capture-screenshot', async (event) => {
  try {
    // Get the window that sent this request
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    // Get window bounds before hiding
    const windowBounds = senderWindow.getBounds();
    
    // Store original window bounds for reset functionality
    const originalWindowBounds = {
      x: windowBounds.x,
      y: windowBounds.y,
      width: windowBounds.width,
      height: windowBounds.height
    };
    
    // Hide the window temporarily
    senderWindow.hide();
    
    // Wait a bit for the window to hide
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Get the display that contains the window (not just primary display)
    const windowCenterX = windowBounds.x + windowBounds.width / 2;
    const windowCenterY = windowBounds.y + windowBounds.height / 2;
    const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
    
    const scaleFactor = currentDisplay.scaleFactor;
    const displayBounds = currentDisplay.bounds;
    
    // Get all displays to help identify which screen source we need
    const allDisplays = screen.getAllDisplays();
    const currentDisplayIndex = allDisplays.findIndex(display => 
      display.bounds.x === currentDisplay.bounds.x && 
      display.bounds.y === currentDisplay.bounds.y
    );
    
    console.log(`Window: ${windowBounds.x},${windowBounds.y} ${windowBounds.width}x${windowBounds.height}`);
    console.log(`Current Display: ${displayBounds.x},${displayBounds.y} ${displayBounds.width}x${displayBounds.height}, Scale: ${scaleFactor}`);
    console.log(`Display Index: ${currentDisplayIndex} of ${allDisplays.length} displays`);
    
    // Capture all screens at their native resolution
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { 
        // Request exact display dimensions in physical pixels
        width: Math.floor(displayBounds.width * scaleFactor),
        height: Math.floor(displayBounds.height * scaleFactor)
      }
    });
    
    if (sources.length > 0) {
      // Try to match the screen source to our current display
      let screenSource = sources[0]; // Default fallback
      
      // If we have multiple sources, try to pick the right one
      if (sources.length > 1 && currentDisplayIndex >= 0 && currentDisplayIndex < sources.length) {
        screenSource = sources[currentDisplayIndex];
        console.log(`Using screen source ${currentDisplayIndex} for current display`);
      } else {
        console.log(`Using default screen source 0 (${sources.length} available, index was ${currentDisplayIndex})`);
      }
      
      const fullScreenshot = screenSource.thumbnail;
      
      // Check what we actually got
      const screenshotSize = fullScreenshot.getSize();
      console.log(`Screenshot size: ${screenshotSize.width}x${screenshotSize.height}`);
      console.log(`Display logical size: ${displayBounds.width}x${displayBounds.height}`);
      console.log(`Expected physical size: ${displayBounds.width * scaleFactor}x${displayBounds.height * scaleFactor}`);
      
      // Calculate the ACTUAL scale factor from what we received vs what we expected
      const actualScaleX = screenshotSize.width / displayBounds.width;
      const actualScaleY = screenshotSize.height / displayBounds.height;
      
      // Use the calculated scale factor instead of the reported one
      const actualScale = actualScaleX; // They should be the same for square pixels
      
      console.log(`Reported scale factor: ${scaleFactor}`);
      console.log(`Calculated scale: X=${actualScaleX}, Y=${actualScaleY}`);
      console.log(`Using calculated scale factor: ${actualScale}`);
      
      // Calculate window area using the ACTUAL scale factor from the screenshot
      const cropInfo = {
        windowX: Math.floor((windowBounds.x - displayBounds.x) * actualScale),
        windowY: Math.floor((windowBounds.y - displayBounds.y) * actualScale),
        windowWidth: Math.floor(windowBounds.width * actualScale),
        windowHeight: Math.floor(windowBounds.height * actualScale),
        fullScreenshot: fullScreenshot.toDataURL(),
        scaleFactor: actualScale, // Use the calculated scale factor
        displayBounds: displayBounds,
        screenshotSize: screenshotSize,
        originalWindowBounds: originalWindowBounds // Include original window bounds
      };
      
      console.log(`Crop info: ${cropInfo.windowX},${cropInfo.windowY} ${cropInfo.windowWidth}x${cropInfo.windowHeight}`);
      
      // Show the window again
      senderWindow.show();
      
      return cropInfo;
    } else {
      senderWindow.show();
      throw new Error('No screen sources found');
    }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.show();
    }
    return null;
  }
});

// IPC handler to get display info for DPI scaling
ipcMain.handle('get-display-info', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    scaleFactor: primaryDisplay.scaleFactor,
    bounds: primaryDisplay.bounds
  };
});

// IPC handlers for window dragging with size preservation
ipcMain.handle('start-drag', (event, { mouseX, mouseY }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    throw new Error('Could not find sender window');
  }
  
  const windowBounds = senderWindow.getBounds();
  
  return {
    windowX: windowBounds.x,
    windowY: windowBounds.y,
    offsetX: mouseX,
    offsetY: mouseY,
    targetWidth: windowBounds.width,  // Use current width instead of hardcoded
    targetHeight: windowBounds.height // Use current height instead of hardcoded
  };
});

ipcMain.handle('do-drag', (event, { x, y, targetWidth, targetHeight }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    throw new Error('Could not find sender window');
  }
  
  // Set both position and size to prevent window from growing
  senderWindow.setBounds({
    x: x,
    y: y,
    width: targetWidth,
    height: targetHeight
  });
});

// IPC handlers for window scaling
ipcMain.handle('get-window-bounds', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    throw new Error('Could not find sender window');
  }
  return senderWindow.getBounds();
});

ipcMain.handle('set-window-bounds', (event, { x, y, width, height }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    throw new Error('Could not find sender window');
  }
  
  // CRITICAL: Get tracked state - never use getBounds() here!
  // Reading from system causes drift due to DPI/aliasing issues
  let state = windowStates.get(senderWindow.id);
  if (!state) {
    // Initialize if missing
    state = { x: 100, y: 100, width: 1200, height: 800 };
    windowStates.set(senderWindow.id, state);
  }
  
  // Update tracked state with provided values only
  // CRITICAL: Only change what's explicitly provided
  if (x !== undefined) state.x = x;
  if (y !== undefined) state.y = y;
  if (width !== undefined) state.width = width;
  if (height !== undefined) state.height = height;
  
  console.log(`Setting window bounds from tracked state: x=${state.x}, y=${state.y}, w=${state.width}, h=${state.height}`);
  
  // CRITICAL: Mark as programmatic move to prevent resize event interference
  // Without this, the resize event reads back from system and causes drift!
  programmaticMoves.add(senderWindow.id);
  
  // Apply tracked state to window (one-way: code → screen)
  // CRITICAL: Always use stored values, never system values
  senderWindow.setBounds({
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.round(state.width),
    height: Math.round(state.height)
  });
  
  // Clear programmatic flag after a short delay
  // This allows manual resizes to work normally again
  setTimeout(() => {
    programmaticMoves.delete(senderWindow.id);
  }, 50);
});

// IPC handler for copying current window view to clipboard
ipcMain.handle('copy-to-clipboard', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    // Get current window bounds
    const bounds = senderWindow.getBounds();
    
    // Get the current display to get scale factor
    const windowCenterX = bounds.x + bounds.width / 2;
    const windowCenterY = bounds.y + bounds.height / 2;
    const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
    const scaleFactor = currentDisplay.scaleFactor;
    
    // Capture the entire window contents including border area
    // This ensures copy-paste cycles maintain exact window dimensions
    const captureArea = {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    };
    
    // Force exact pixel boundaries to prevent rounding accumulation
    captureArea.width = Math.floor(captureArea.width);
    captureArea.height = Math.floor(captureArea.height);
    
    const image = await senderWindow.capturePage(captureArea);
    const imageSize = image.getSize();
    
    // If there's a size mismatch due to DPI scaling, we need to be aware of it
    const expectedDeviceWidth = Math.round(captureArea.width * scaleFactor);
    const expectedDeviceHeight = Math.round(captureArea.height * scaleFactor);
    
    console.log(`Current window content copied to clipboard (including entire window area)`);
    console.log(`Display scale factor: ${scaleFactor}`);
    console.log(`Logical capture area: ${captureArea.width}x${captureArea.height}px at (${captureArea.x}, ${captureArea.y})`);
    console.log(`Captured image size: ${imageSize.width}x${imageSize.height}px`);
    console.log(`Expected device size: ${expectedDeviceWidth}x${expectedDeviceHeight}px`);
    console.log(`Size match: ${imageSize.width === expectedDeviceWidth && imageSize.height === expectedDeviceHeight}`);
    
    // Write to clipboard
    clipboard.writeImage(image);
    
    return {
      success: true,
      scaleFactor: scaleFactor,
      logicalWidth: captureArea.width,  // This is the entire window size (including border area)
      logicalHeight: captureArea.height, // This is the entire window size (including border area)
      capturedWidth: imageSize.width,
      capturedHeight: imageSize.height
    };
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return { success: false };
  }
});

// IPC handler for pasting image from clipboard
ipcMain.handle('paste-from-clipboard', async () => {
  try {
    // Read image from clipboard
    const image = clipboard.readImage();
    
    if (!image.isEmpty()) {
      // Get the current display scale factor (same logic as copy handler)
      const bounds = mainWindow.getBounds();
      const windowCenterX = bounds.x + bounds.width / 2;
      const windowCenterY = bounds.y + bounds.height / 2;
      const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
      const scaleFactor = currentDisplay.scaleFactor;
      
      // Get image size in device pixels
      const imageSize = image.getSize();
      
      // Convert to data URL
      const buffer = image.toPNG();
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      
      console.log('Image pasted from clipboard');
      console.log(`Image size: ${imageSize.width}x${imageSize.height}px`);
      console.log(`Current display scale factor: ${scaleFactor}`);
      
      // For our copy-paste cycle, we need to preserve exact logical dimensions
      // The issue is that capturePage might capture at slightly different sizes due to rounding
      // We should use the image size as-is if the scale factor is close to 1.0, 
      // otherwise calculate logical size
      let logicalWidth, logicalHeight;
      
      if (Math.abs(scaleFactor - 1.0) < 0.01) {
        // For 100% DPI displays, use image size directly
        logicalWidth = imageSize.width;
        logicalHeight = imageSize.height;
        console.log('Using direct image size for 100% DPI display');
      } else {
        // For high-DPI displays, calculate logical size but round consistently
        logicalWidth = Math.round(imageSize.width / scaleFactor);
        logicalHeight = Math.round(imageSize.height / scaleFactor);
        console.log('Calculating logical size for high-DPI display');
      }
      
      console.log(`Final logical size: ${logicalWidth}x${logicalHeight}px`);
      
      return {
        dataUrl: dataUrl,
        logicalWidth: logicalWidth,
        logicalHeight: logicalHeight,
        scaleFactor: scaleFactor
      };
    } else {
      console.log('No image found in clipboard');
      return null;
    }
  } catch (error) {
    console.error('Failed to paste from clipboard:', error);
    return null;
  }
});

// IPC handler for loading image from file
ipcMain.handle('load-image-file', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    const result = await dialog.showOpenDialog(senderWindow, {
      title: 'Load Image File',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
        { name: 'PNG Files', extensions: ['png'] },
        { name: 'JPEG Files', extensions: ['jpg', 'jpeg'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      console.log(`Loading image from: ${filePath}`);
      
      // Read the file and convert to data URL
      const imageBuffer = fs.readFileSync(filePath);
      const image = nativeImage.createFromBuffer(imageBuffer);
      const imageSize = image.getSize();
      const dataUrl = image.toDataURL();
      
      console.log(`Loaded image: ${imageSize.width}x${imageSize.height}px`);
      
      return {
        success: true,
        dataUrl: dataUrl,
        logicalWidth: imageSize.width,
        logicalHeight: imageSize.height,
        fileName: path.basename(filePath)
      };
    } else {
      console.log('User cancelled file selection');
      return { success: false, cancelled: true };
    }
  } catch (error) {
    console.error('Failed to load image file:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for saving current view to file
ipcMain.handle('save-image-file', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    const result = await dialog.showSaveDialog(senderWindow, {
      title: 'Save Image File',
      defaultPath: 'screenshot.png',
      filters: [
        { name: 'PNG Files', extensions: ['png'] },
        { name: 'JPEG Files', extensions: ['jpg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      const filePath = result.filePath;
      console.log(`Saving image to: ${filePath}`);
      
      // Get current window bounds for capturing
      const bounds = senderWindow.getBounds();
      
      // Get the current display to get scale factor
      const windowCenterX = bounds.x + bounds.width / 2;
      const windowCenterY = bounds.y + bounds.height / 2;
      const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
      const scaleFactor = currentDisplay.scaleFactor;
      
      // Capture the current window contents (full window for save)
      const image = await senderWindow.capturePage();
      const imageSize = image.getSize();
      
      // Write to file
      const imageBuffer = image.toPNG();
      fs.writeFileSync(filePath, imageBuffer);
      
      console.log(`Image saved successfully: ${imageSize.width}x${imageSize.height}px`);
      console.log(`File: ${filePath}`);
      
      return {
        success: true,
        filePath: filePath,
        fileName: path.basename(filePath),
        imageWidth: imageSize.width,
        imageHeight: imageSize.height
      };
    } else {
      console.log('User cancelled save operation');
      return { success: false, cancelled: true };
    }
  } catch (error) {
    console.error('Failed to save image file:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for cropping window to current view
ipcMain.handle('crop-to-current-view', async (event, cropInfo) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    console.log('Cropping window to current view:', cropInfo);
    
    // Get current window bounds
    const currentBounds = senderWindow.getBounds();
    
    // Calculate the new window size
    // cropInfo contains: visibleWidth, visibleHeight, offsetX, offsetY, borderWidth, visibleCenterX, visibleCenterY
    const newWidth = Math.max(100, Math.round(cropInfo.visibleWidth + (cropInfo.borderWidth * 2)));  // Add border space back
    const newHeight = Math.max(100, Math.round(cropInfo.visibleHeight + (cropInfo.borderWidth * 2))); // Add border space back
    
    // Calculate the center of the visible image area in screen coordinates
    const currentVisibleCenterX = currentBounds.x + cropInfo.visibleCenterX;
    const currentVisibleCenterY = currentBounds.y + cropInfo.visibleCenterY;
    
    // Position the new window so its center aligns with the visible image center
    const newX = currentVisibleCenterX - (newWidth / 2);
    const newY = currentVisibleCenterY - (newHeight / 2);
    
    console.log(`Current window: ${currentBounds.width}x${currentBounds.height} at (${currentBounds.x}, ${currentBounds.y})`);
    console.log(`Visible image center: (${cropInfo.visibleCenterX}, ${cropInfo.visibleCenterY}) relative to window`);
    console.log(`Visible image center in screen coords: (${currentVisibleCenterX}, ${currentVisibleCenterY})`);
    console.log(`New window: ${newWidth}x${newHeight} at (${newX}, ${newY}) - centered on visible image`);
    console.log(`Crop offset: (${cropInfo.offsetX}, ${cropInfo.offsetY}), border: ${cropInfo.borderWidth}px`);
    
    // Set the new window bounds
    senderWindow.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: newWidth,
      height: newHeight
    });
    
    return {
      success: true,
      newBounds: { x: newX, y: newY, width: newWidth, height: newHeight }
    };
  } catch (error) {
    console.error('Failed to crop window:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for transparentizing color at coordinates
ipcMain.handle('transparentize-color', async (event, coords) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    console.log(`Transparentizing color at coordinates: (${coords.x}, ${coords.y})`);
    
    // Get current window bounds
    const bounds = senderWindow.getBounds();
    
    // Get the current display to get scale factor
    const windowCenterX = bounds.x + bounds.width / 2;
    const windowCenterY = bounds.y + bounds.height / 2;
    const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
    const scaleFactor = currentDisplay.scaleFactor;
    
    // Capture the current window contents excluding the border
    const borderWidth = 2;
    const captureArea = {
      x: borderWidth,
      y: borderWidth,
      width: bounds.width - (borderWidth * 2),
      height: bounds.height - (borderWidth * 2)
    };
    
    const image = await senderWindow.capturePage(captureArea);
    const imageBuffer = image.toPNG();
    
    // Calculate the pixel coordinates within the captured image
    // coords are relative to the window, we need to adjust for the border
    const pixelX = Math.floor((coords.x - borderWidth) * scaleFactor);
    const pixelY = Math.floor((coords.y - borderWidth) * scaleFactor);
    
    console.log(`Capture area: ${captureArea.width}x${captureArea.height} at (${captureArea.x}, ${captureArea.y})`);
    console.log(`Scale factor: ${scaleFactor}`);
    console.log(`Pixel coordinates in image: (${pixelX}, ${pixelY})`);
    
    return {
      success: true,
      imageBuffer: imageBuffer.toString('base64'),
      targetPixel: { x: pixelX, y: pixelY },
      scaleFactor: scaleFactor,
      logicalWidth: captureArea.width,
      logicalHeight: captureArea.height
    };
  } catch (error) {
    console.error('Failed to transparentize color:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for custom tolerance transparentize
ipcMain.handle('get-custom-tolerance', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    const result = await dialog.showMessageBox(senderWindow, {
      type: 'question',
      title: 'Custom Tolerance',
      message: 'Enter color tolerance value (0-100):',
      detail: 'Lower values = exact color match\nHigher values = broader color range',
      buttons: ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      inputText: '20' // Default value
    });
    
    if (result.response === 1) {
      // For now, we'll use a simple prompt in the renderer
      return { success: true, showPrompt: true };
    } else {
      return { success: false, cancelled: true };
    }
  } catch (error) {
    console.error('Failed to get custom tolerance:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for creating new window from renderer
ipcMain.handle('create-new-window', async (event) => {
  try {
    console.log('Creating new window from renderer request...');
    const newWindow = createWindow();
    return { success: true, windowId: newWindow.id };
  } catch (error) {
    console.error('Failed to create new window:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for closing all windows
ipcMain.handle('close-all-windows', async (event) => {
  try {
    console.log('Closing all windows...');
    const allWindows = [...windows]; // Create a copy to avoid array modification issues
    let closedCount = 0;
    
    allWindows.forEach(window => {
      if (window && !window.isDestroyed()) {
        window.close();
        closedCount++;
      }
    });
    
    console.log(`Closed ${closedCount} windows`);
    return { success: true, closedCount: closedCount };
  } catch (error) {
    console.error('Failed to close all windows:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for showing help dialog
ipcMain.handle('show-help-dialog', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      throw new Error('Could not find sender window');
    }
    
    const result = await dialog.showMessageBox(senderWindow, {
      type: 'info',
      title: 'ScreenClip Help',
      message: 'ScreenClip - Advanced Screenshot Tool',
      detail: `FEATURES:
• Screenshot Capture: Takes screenshots excluding the window
• Multi-Monitor Support: Works across different displays with proper DPI scaling
• Image Editing: Load, save, copy, and paste images
• Scaling & Positioning: Zoom and move images with mouse controls
• Crop to View: Resize window to fit visible image content
• Transparentize Color: Remove backgrounds by clicking on colors
• Drag & Drop: Drop image files directly onto the window

CONTROLS:
• Mouse Wheel: Adjust window opacity (0-100%)
• Ctrl + Mouse Wheel: Scale image content (10%-500%)
• Shift + Mouse Wheel: Scale entire window (30%-500%)
• Shift + Left Click + Drag: Move window only (image stays stationary on screen)
• Ctrl + Left Click + Drag: Move image content only
• Shift + Ctrl + Left Click + Drag: Move window and image together
• Middle Click + Drag: Pan/move image within window (deprecated - use Ctrl+Drag)
• Right Click: Open context menu with all features
• Right Double-Click: Create new window
• Left Double-Click: Capture screenshot
• Ctrl+C: Copy current view to clipboard
• Ctrl+V: Paste image from clipboard
• Ctrl+I: Invert image colors (helps with OCR on dark backgrounds)

CONTEXT MENU:
• Copy/Paste: Clipboard operations with DPI awareness
• Load/Save: File operations for images
• Toggle Border: Show/hide red window border
• Reset Image: Return to original size and position
• Crop to Current View: Fit window to visible image
• Transparentize Color: Remove backgrounds with tolerance control
  - Multiple tolerance levels from precise to broad matching
  - Custom tolerance input for exact control
• Invert Colors (Ctrl+I): Invert image colors for better contrast
• New Window: Create additional window for parallel workflows
• Close Window: Close current window
• Close All Windows: Close all open ScreenClip windows

TRANSPARENTIZE TOLERANCE GUIDE:
• Low (5): Very precise color matching
• Medium (15): Good for clean graphics
• Default (20): General purpose setting
• High (35): Good for anti-aliased images
• Very High (50): Broad color matching
• Custom: Enter any value 0-100

AUTO-CROP FEATURE:
Window automatically crops to image content after scaling operations
(debounced to prevent performance issues)

TIPS:
• Use low tolerance for solid color backgrounds
• Use high tolerance for gradients or anti-aliased edges
• The tool preserves exact pixel accuracy across copy-paste cycles
• All operations work correctly across different DPI displays`,
      buttons: ['Close'],
      defaultId: 0
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to show help dialog:', error);
    return { success: false, error: error.message };
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
