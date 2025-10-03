# ScreenClip

A powerful screen clipping and annotation tool that allows users to capture, annotate, and manipulate screen content with a comprehensive drawing system.

## Quick Start

### Development
```bash
npm install
npm start
```

### Building Executable
```bash
npm run build-win    # Creates installer and portable .exe
```

See [BUILD.md](BUILD.md) for detailed build instructions.

## Description

ScreenClip is an advanced screen capture tool with professional annotation capabilities. Capture any portion of your screen and enhance it with arrows, boxes, rounded rectangles, and text annotations. The intuitive keyboard shortcuts and persistent drawing modes make annotation fast and efficient.

## Key Features

### 🎯 Screen Capture
- **Global Shortcut**: `Win+Esc` to capture any screen area
- **Multi-display Support**: Works across multiple monitors
- **Precise Selection**: Drag to select exact screen regions
- **Instant Activation**: Minimizes to system tray for quick access

### ✏️ Drawing & Annotation System
- **Arrow Annotations**: Point to important elements with professional arrows
- **Rectangle Shapes**: Draw clean boxes for highlighting areas
- **Rounded Rectangles**: Stylish rounded corner boxes
- **Text Annotations**: Add text labels anywhere on the image
- **Fill Tool**: Erase or fill rectangular areas with background colors
- **Color Cycling**: 8 colors available (red, orange, yellow, green, blue, grey, white, black)

### ⌨️ Keyboard Shortcuts

#### Drawing Mode Shortcuts
- **`T`** - Text mode (click to place text)
- **`B`** - Box mode (drag to draw rectangles)
- **`R`** - Rounded box mode (drag to draw rounded rectangles)
- **`A`** - Arrow mode (drag to draw arrows)
- **`F`** - Fill mode (drag to fill rectangles with corner pixel color)
- **`C`** - Cycle through colors
- **`Enter`** - Commit drawings to image

#### System Shortcuts
- **`Ctrl+C`** - Copy current view to clipboard
- **`Ctrl+V`** - Paste image from clipboard
- **`Ctrl+S`** - Save image to file
- **`Ctrl+F`** - Open image file
- **`Ctrl+B`** - Toggle border visibility
- **`Ctrl+X`** - Crop to current view
- **`F1`** - Show help

### 🎨 Advanced Drawing Features
- **Persistent Text Mode**: Add multiple text entries without re-selecting mode
- **Immediate Text Input**: Click and start typing instantly
- **Smart Fill Tool**: Fill rectangular areas using corner pixel color for seamless erasing
- **Visual Feedback**: Border color changes to match drawing color
- **Professional Quality**: High-DPI support with proper scaling
- **Smart Commit**: Drawings merge seamlessly with background images

### 🖱️ Mouse Controls

#### Drawing Operations
- **Right-click + Drag**: Draw shapes (arrows, boxes, rounded boxes, fill rectangles)
- **Left-click (Text Mode)**: Place text input
- **Mouse Wheel**: Adjust opacity
- **Shift + Mouse Wheel**: Scale window frame
- **Ctrl + Mouse Wheel**: Scale image content

#### Movement & Positioning
- **Left-click + Drag**: Move entire window
- **Shift + Drag**: Move window frame only
- **Ctrl + Drag**: Move image content only
- **Ctrl + Shift + Drag**: Move window and content together

## Workflow Examples

### Quick Text Annotation
1. Capture screen with `Win+Esc`
2. Press `T` for text mode
3. Click anywhere → type text → `Enter`
4. Click elsewhere → type more text → `Enter`
5. Press `Enter` to commit all text to image

### Shape Highlighting
1. Press `B` for box mode or `R` for rounded boxes
2. Right-click and drag to draw rectangles
3. Press `C` to change colors
4. Press `Enter` to commit drawings

### Professional Arrows
1. Press `A` for arrow mode
2. Right-click and drag to draw arrows (arrowhead at start point)
3. Press `Enter` to commit

## Image Manipulation

### File Operations
- **Drag & Drop**: Drop image files directly onto the window
- **Clipboard Integration**: Full copy/paste support
- **Save Options**: Save annotated images to PNG/JPEG
- **Multiple Windows**: Open multiple images simultaneously

### Image Effects
- **`Ctrl+G`** - Convert to greyscale
- **`Ctrl+I`** - Invert colors  
- **`Ctrl+M`** - Convert to black & white
- **`Ctrl+0`** - Reset scale to 1:1

### Advanced Features
- **Color Transparency**: Right-click context menu with tolerance options
- **Window Management**: `Ctrl+N` new window, `Ctrl+W` switch displays
- **Auto-crop**: `Ctrl+X` crops to current visible area
- **OCR Text Extraction**: `Ctrl+T` extracts text from images

## System Integration

- **System Tray**: Runs minimized in system tray
- **Global Shortcuts**: Always available regardless of active application
- **Multi-monitor**: Automatic display detection and positioning
- **Windows Integration**: Native file dialogs and clipboard support

## Technical Features

- **High-DPI Support**: Perfect scaling on high-resolution displays
- **Memory Efficient**: Optimized canvas rendering and image handling
- **No Drift**: Advanced positioning system prevents window drift
- **Performance**: Smooth real-time drawing and preview
- **Cross-platform Ready**: Electron-based for future platform support

## Development & Testing

### Quick Demo Test Sequence
1. **Start**: `npm install` → `npm start`
2. **App minimizes to system tray**
3. **Capture**: `Win+Esc` → drag selection area
4. **Annotate**: 
   - Press `T` → click → type text → `Enter`
   - Press `B` → right-click drag → draw box
   - Press `R` → right-click drag → draw rounded box  
   - Press `A` → right-click drag → draw arrow
   - Press `C` → cycle colors
5. **Commit**: Press `Enter` to commit all drawings
6. **Effects**: `Ctrl+I` invert, `Ctrl+B` toggle border
7. **Scaling**: Mouse wheel for opacity, `Shift+wheel` for frame, `Ctrl+wheel` for content

### Project Structure
- **main.js**: Electron main process, window management, IPC handlers
- **renderer.js**: Drawing system, keyboard shortcuts, image manipulation
- **index.html**: Canvas overlay and basic DOM structure
- **styles.css**: Window styling and border effects
- **selection.html/js**: Screen selection interface

### Building Distribution
See [BUILD.md](BUILD.md) for:
- Windows installer creation
- Portable executable generation
- Code signing setup
- Distribution packaging

---

**ScreenClip** - Professional screen capture and annotation made simple.


