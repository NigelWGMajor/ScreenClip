# Building ScreenClip

## Prerequisites

- Node.js (v16 or higher)
- npm
- Windows (for Windows builds)

## Setup

1. Install dependencies:
```bash
npm install
```

## Building Executables

### Windows
```bash
# Build both installer and portable executable
npm run build-win

# Or use the general build command
npm run build
```

This creates:
- `dist/ScreenClip Setup 1.0.0.exe` - Windows installer (NSIS)
- `dist/ScreenClip 1.0.0.exe` - Portable executable
- `dist/win-unpacked/` - Unpacked application folder

### Other Platforms
```bash
# macOS
npm run build-mac

# Linux
npm run build-linux
```

## Output

Built files are placed in the `dist/` directory:

### Windows Files
- **ScreenClip Setup 1.0.0.exe**: Full installer with uninstaller
  - Creates desktop shortcut
  - Creates start menu entry
  - Allows custom installation directory
  - Properly handles updates
  
- **ScreenClip 1.0.0.exe**: Portable executable
  - Single file, no installation required
  - Can be run from USB drives
  - Perfect for testing or portable use

### Running the Executables

#### Installer Version
1. Run `ScreenClip Setup 1.0.0.exe`
2. Follow installation prompts
3. Launch from Start Menu or Desktop shortcut

#### Portable Version
1. Run `ScreenClip 1.0.0.exe` directly
2. No installation required
3. Application runs immediately

## Build Configuration

The build is configured in `package.json` under the `build` section:

- **appId**: `com.screenclip.app`
- **productName**: ScreenClip
- **Output directory**: `dist/`
- **Target platforms**: Windows (x64), macOS (x64/arm64), Linux (x64)

## Features Included in Build

- Multi-window screenshot capture
- DPI-aware scaling
- Clipboard integration
- File load/save operations
- Transparentize color tool
- Crop functionality
- Drag and drop support
- Context menu with all features
- Help system

## Distribution

The built executables are self-contained and include:
- Electron runtime
- Node.js modules
- Application code
- All dependencies

No additional software installation required on target machines.
