const { app, BrowserWindow, Menu, ipcMain, screen, nativeImage, desktopCapturer, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    transparent: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile('index.html');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Copy (Ctrl+C)',
      click: () => {
        mainWindow.webContents.send('menu-copy');
      }
    },
    {
      label: 'Paste (Ctrl+V)',
      click: () => {
        mainWindow.webContents.send('menu-paste');
      }
    },
    { type: 'separator' },
    {
      label: 'Load Image from File...',
      click: () => {
        mainWindow.webContents.send('menu-load-file');
      }
    },
    {
      label: 'Save Image to File...',
      click: () => {
        mainWindow.webContents.send('menu-save-file');
      }
    },
    { type: 'separator' },
    {
      label: 'Toggle Border Visibility',
      click: () => {
        mainWindow.webContents.send('toggle-border');
      }
    },
    {
      label: 'Reset Image',
      click: () => {
        mainWindow.webContents.send('reset-scale');
      }
    },
    {
      label: 'Crop to Current View',
      click: () => {
        mainWindow.webContents.send('crop-to-view');
      }
    },
    { type: 'separator' },
    {
      label: 'Open Dev Tools',
      click: () => {
        mainWindow.webContents.openDevTools();
      }
    },
    {
      label: 'Close Window',
      click: () => {
        mainWindow.close();
      }
    }
  ]);

  mainWindow.webContents.on('context-menu', () => {
    contextMenu.popup();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler for screenshot capture
ipcMain.handle('capture-screenshot', async () => {
  try {
    // Get window bounds before hiding
    const windowBounds = mainWindow.getBounds();
    
    // Store original window bounds for reset functionality
    const originalWindowBounds = {
      x: windowBounds.x,
      y: windowBounds.y,
      width: windowBounds.width,
      height: windowBounds.height
    };
    
    // Hide the window temporarily
    mainWindow.hide();
    
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
      mainWindow.show();
      
      return cropInfo;
    } else {
      mainWindow.show();
      throw new Error('No screen sources found');
    }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    mainWindow.show();
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
  const windowBounds = mainWindow.getBounds();
  
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
  // Set both position and size to prevent window from growing
  mainWindow.setBounds({
    x: x,
    y: y,
    width: targetWidth,
    height: targetHeight
  });
});

// IPC handlers for window scaling
ipcMain.handle('get-window-bounds', () => {
  return mainWindow.getBounds();
});

ipcMain.handle('set-window-bounds', (event, { x, y, width, height }) => {
  mainWindow.setBounds({
    x: x,
    y: y,
    width: width,
    height: height
  });
});

// IPC handler for copying current window view to clipboard
ipcMain.handle('copy-to-clipboard', async () => {
  try {
    // Get current window bounds
    const bounds = mainWindow.getBounds();
    
    // Get the current display to get scale factor
    const windowCenterX = bounds.x + bounds.width / 2;
    const windowCenterY = bounds.y + bounds.height / 2;
    const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
    const scaleFactor = currentDisplay.scaleFactor;
    
    // Capture the current window contents excluding the 2px border
    const borderWidth = 2;
    
    // Calculate capture area in logical pixels (capturePage uses logical coordinates)
    const captureArea = {
      x: borderWidth,
      y: borderWidth,
      width: bounds.width - (borderWidth * 2),
      height: bounds.height - (borderWidth * 2)
    };
    
    // Force exact pixel boundaries to prevent rounding accumulation
    captureArea.width = Math.floor(captureArea.width);
    captureArea.height = Math.floor(captureArea.height);
    
    const image = await mainWindow.capturePage(captureArea);
    const imageSize = image.getSize();
    
    // If there's a size mismatch due to DPI scaling, we need to be aware of it
    const expectedDeviceWidth = Math.round(captureArea.width * scaleFactor);
    const expectedDeviceHeight = Math.round(captureArea.height * scaleFactor);
    
    console.log(`Current window content copied to clipboard (excluding ${borderWidth}px border)`);
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
      logicalWidth: captureArea.width,  // This is the actual content size (without border)
      logicalHeight: captureArea.height, // This is the actual content size (without border)
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
ipcMain.handle('load-image-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
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
ipcMain.handle('save-image-file', async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
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
      const bounds = mainWindow.getBounds();
      
      // Get the current display to get scale factor
      const windowCenterX = bounds.x + bounds.width / 2;
      const windowCenterY = bounds.y + bounds.height / 2;
      const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
      const scaleFactor = currentDisplay.scaleFactor;
      
      // Capture the current window contents (full window for save)
      const image = await mainWindow.capturePage();
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
    console.log('Cropping window to current view:', cropInfo);
    
    // Get current window bounds
    const currentBounds = mainWindow.getBounds();
    
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
    mainWindow.setBounds({
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
