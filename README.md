# ScreenClip

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

A simple screen clipping tool that allows users to capture a portion of their screen and manipulate it within a draggable rectangle.

Allows snipping of screen rectangles to a sizable window.

Simple version using Electron and React.

## Quickstart

Launch from taskbar icon

future: Click and drag to create a rectangle
Drag the rectangle or its edges to surround the portion of interest
Double-click to snap

F1 for help
^c to copy to clipboard
^v to paste from clipboard
^s to save to file
^b to toggle border
^f to open file
^q to close window
^n for new window
^m min/max/restore window
^min/max/restore all windows
^x to close all windows but the latest
^z undo last transparency or fill
^y redo last transparency or fill
tab/shift tab to cycle through windows

|control|only    |shift      |control      |sh+sctrl |
|-------|--------|-----------|-------------|---------|
|arrows |next w  |nudge frame|nudge content|nudge all|
|wheel  |fade    |scale frame|scale content|scale all|
|drag   |move all|pan   frame|pan   content| -       |
|click  |        |           |             |         |
|dclick |snap    |           |snap autosave|         | 
|rclick |context |           |settings     |         |

right-click for context menu
right-click position samples screen for transparency and fill

## Features:

<need to redo>

- hideable border
- drag from anywhere in the rectangle, not just the border
- copy to self
- copy to/fromclipboard
- save to file
- drag from rectangle to other apps (e.g. paint)
- multiple rectangles, each with its own image
- close rectangle or all rectangles
- settings (e.g. border color, border width, opacity)
- scroll to transparentize
- keyboard shortcuts
- snap previous location
- store images
- drag to resize/crop
- allow burst mode to capture layeyered stuff
- tray icon
- auto start with windows
- auto update