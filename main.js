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
    
    // Get the primary display with proper DPI scaling
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor;
    const displayBounds = primaryDisplay.bounds;
    
    // Calculate actual pixel dimensions for full screen capture
    const fullWidth = Math.floor(displayBounds.width * scaleFactor);
    const fullHeight = Math.floor(displayBounds.height * scaleFactor);
    
    console.log(`Window: ${windowBounds.x},${windowBounds.y} ${windowBounds.width}x${windowBounds.height}`);
    console.log(`Display: ${displayBounds.width}x${displayBounds.height}, Scale: ${scaleFactor}`);
    console.log(`Full capture: ${fullWidth}x${fullHeight}`);
    
    // Capture full screen
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { 
        width: fullWidth, 
        height: fullHeight 
      }
    });
    
    if (sources.length > 0) {
      const fullScreenshot = sources[0].thumbnail;
      
      // Calculate window area in actual pixels accounting for DPI
      const cropInfo = {
        windowX: Math.floor((windowBounds.x - displayBounds.x) * scaleFactor),
        windowY: Math.floor((windowBounds.y - displayBounds.y) * scaleFactor),
        windowWidth: Math.floor(windowBounds.width * scaleFactor),
        windowHeight: Math.floor(windowBounds.height * scaleFactor),
        fullScreenshot: fullScreenshot.toDataURL()
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
