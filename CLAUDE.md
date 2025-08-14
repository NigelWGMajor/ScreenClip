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

## Critical Implementation Lessons

### Mouse Wheel Fade System Architecture
**Problem**: Original implementation faded a black `.fill` background instead of the actual image, creating darkening overlay effects.

**Solution**: Restructured HTML with layered opacity control:
- `body` → Border (always visible, uses `opacity: 0` for toggle instead of `display: none`)  
- `.content` → Screenshot image (fadeable with mouse wheel)
- `.fill` → Mouse hit detection (minimum 5% opacity, never fades)

**Key Insight**: Border must be in separate element from fadeable content to prevent interference.

### Screenshot Positioning & Copy-Paste Registration
**Problem**: Images drifted 2px up/left on paste operations due to inconsistent capture areas.

**Root Cause**: Copy captured `window - 4px` (excluding border) but paste created window sized to captured image.

**Solution**: 
- **Copy captures entire window** (including border area) → No size mismatch
- **Paste positions at `0px, 0px`** → Perfect alignment  
- **Border toggle uses `opacity: 0`** instead of `transparent` → Clean on/off behavior

**Critical Rule**: Copy-paste cycles must maintain identical dimensions for zero drift.

### DPI Scaling in File Operations
**Problem**: Saved images had correct DPI resolution, but loading applied DPI scaling twice, causing oversized images.

**Root Cause**: 
- **Save**: Captures at physical pixels (DPI-adjusted)
- **Load**: Treated saved dimensions as logical pixels, reapplying DPI scaling

**Solution**: Divide loaded image dimensions by `scaleFactor` to convert physical → logical pixels.

**Formula**: `logicalSize = physicalPixels / scaleFactor`

### Image Cropping Implementation  
**Problem**: Crop-to-view only resized window instead of actually cropping image content.

**Solution**: Canvas-based image cropping:
1. Extract data URL from background image
2. Calculate crop coordinates: `originalWindowBounds.x/y * scaleFactor` 
3. Use canvas `drawImage()` to extract window area from full screen
4. Replace background with cropped image data URL

**Critical Detail**: Don't add border offsets - screenshot already includes full window content.

### Border Offset Anti-Pattern
**Anti-Pattern**: Adding/subtracting `borderWidth` offsets in positioning calculations.

**Correct Approach**: 
- Screenshots capture **entire window including border**
- Position calculations use **exact window coordinates** 
- No compensation needed for border thickness

**Rule**: Border offsets cause pixel-perfect alignment issues. Use actual window bounds.

## CRITICAL: DO NOT BREAK EXISTING SYSTEMS

⚠️ **WARNING: The following systems are working correctly and are extremely fragile. DO NOT MODIFY unless explicitly requested:**

### Image Scaling & Positioning Systems (DO NOT TOUCH)
- **`imageOffset` tracking**: Global position state management
- **`backgroundPosition` calculations**: CSS positioning logic  
- **`backgroundSize` scaling logic**: DPI-aware image sizing
- **`currentImageScale` tracking**: Scale factor management
- **Mouse wheel scaling**: Center-point scaling calculations
- **Drag & pan operations**: Position delta calculations

### DPI & Coordinate Systems (DO NOT TOUCH)
- **`scaleFactor` calculations**: Display DPI handling
- **Physical/logical pixel conversions**: Screen coordinate translations
- **Window bounds tracking**: Position state management
- **Multi-monitor positioning**: Display-aware coordinate systems

### Copy-Paste & Screenshot Pipeline (DO NOT TOUCH)
- **Screenshot capture positioning**: Pixel-perfect alignment systems
- **Image offset compensation**: Drift prevention mechanisms
- **Border handling**: Opacity vs display toggles
- **Window resize logic**: Dimension tracking

### General Rules for Modifications
1. **Only modify the specific code block requested**
2. **Never touch tracking variables unless explicitly asked**
3. **Do not refactor working positioning/scaling logic**
4. **Test screenshot, crop, pan, and scale after any changes**
5. **If something breaks, revert immediately**

**Remember**: These systems took significant effort to get pixel-perfect. Small changes can cause cascading failures in positioning, scaling, and DPI handling.

## Development Notes

- **Context Isolation**: Disabled (`contextIsolation: false`) for direct IPC access
- **Security**: Node integration enabled for file system operations  
- **Performance**: Debounced auto-crop prevents excessive window operations
- **Cross-Platform**: Build configurations for Windows, macOS, and Linux
- **DPI Scaling**: Handles high-DPI displays with proper pixel calculations
- **Positioning**: All coordinates use window bounds directly - no border compensations

## Key Architectural Principles

- **IMPORTANT**: In this application, all properties related to positions, scale, size and the like are persisted, and these values are only adjusted when an operation requires them to change. The state in the application is always the source of truth, the direction of data flow is always TO the physical display. No changes to the code should disturb or duplicate this state unnecessarily.