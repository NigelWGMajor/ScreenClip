const { app, BrowserWindow, Menu, ipcMain } = require('electron');
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
      contextIsolation: true,
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
