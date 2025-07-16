const { app, BrowserWindow, Menu, ipcMain, screen, nativeImage, desktopCapturer } = require('electron');
const path = require('path');

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
        screenshotSize: screenshotSize
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
