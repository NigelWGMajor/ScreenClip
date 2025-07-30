# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup
```bash
npm install
```

### Development
```bash
npm start                # Start Electron in development mode
```

### Building
```bash
npm run build           # Build for current platform
npm run build-win       # Build Windows installer and portable executable
npm run build-mac       # Build macOS DMG
npm run build-linux     # Build Linux AppImage
npm run dist            # Build without publishing
```

### Build Outputs
- `dist/ScreenClip Setup 1.0.0.exe` - Windows installer (NSIS)
- `dist/ScreenClip 1.0.0.exe` - Portable executable  
- `dist/win-unpacked/` - Unpacked application folder

## Architecture Overview

### Core Technology Stack
- **Electron**: Desktop application framework with transparent, frameless windows
- **Node.js**: Backend functionality for file operations, clipboard, screen capture
- **Vanilla JavaScript**: Frontend with no additional frameworks
- **CSS**: Styling with transparency effects and fade opacity controls

### Application Structure

#### Main Process (`main.js`)
- **Window Management**: Creates and manages multiple transparent, frameless windows
- **Screen Capture**: Multi-monitor screenshot capture with DPI scaling support
- **IPC Handlers**: 20+ handlers for screenshot, clipboard, file operations, window manipulation
- **Context Menu**: Comprehensive right-click menu with all application features
- **Multi-Window Support**: Track and manage multiple concurrent windows

#### Renderer Process (`renderer.js`)
- **Image Manipulation**: Scale, crop, transparentize color with tolerance levels
- **Mouse Controls**: Wheel for opacity/scaling, drag for window/image movement
- **Keyboard Shortcuts**: Ctrl+C/V for clipboard operations
- **Drag & Drop**: Support for image file drops with automatic window resizing
- **Real-time Updates**: Live background image positioning and scaling

#### Key Features Implementation
- **DPI Awareness**: Proper scaling across different monitor configurations
- **Color Transparentization**: Canvas-based pixel manipulation with configurable tolerance
- **Copy-Paste Cycle**: Maintains pixel-perfect accuracy across operations
- **Auto-Crop**: Automatically resize window to fit visible image content
- **Multi-Monitor**: Intelligent display detection and screenshot targeting

### File Structure
```
├── main.js           # Electron main process - window management, IPC
├── renderer.js       # Frontend logic - image manipulation, controls
├── preload.js        # Security bridge (minimal usage due to contextIsolation: false)
├── index.html        # Simple HTML structure with fill div
├── styles.css        # Transparency effects, border controls, fade opacity
├── package.json      # Electron app configuration and build settings
├── README.md         # User documentation and feature overview
└── BUILD.md          # Detailed build instructions and distribution info
```

### Key Implementation Details

#### Screenshot Capture Process
1. Hide current window temporarily
2. Detect target display and scale factor
3. Use `desktopCapturer` with exact physical pixel dimensions
4. Calculate actual vs reported scale factors
5. Position full screenshot relative to window bounds

#### Image Processing Pipeline
- Canvas-based pixel manipulation for transparency effects
- Real-time background-image CSS updates
- Coordinate translation between screen/window/image spaces
- Debounced auto-crop after scaling operations

#### Window State Management
- Track original bounds for reset functionality
- Maintain separate scaling factors for image and window
- Coordinate system translations for multi-monitor setups
- Preserve aspect ratios during resize operations

## Development Notes

- **Context Isolation**: Disabled (`contextIsolation: false`) for direct IPC access
- **Security**: Node integration enabled for file system operations
- **Performance**: Debounced auto-crop prevents excessive window operations
- **Cross-Platform**: Build configurations for Windows, macOS, and Linux
- **DPI Scaling**: Handles high-DPI displays with proper pixel calculations