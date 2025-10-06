const { ipcRenderer } = require('electron');

// Logging suppression for selection window
const DEBUG = false; // flip to true to re-enable selection window diagnostics
const __origLog = console.log.bind(console);
console.log = (...args) => { if (DEBUG) __origLog(...args); };


let isSelecting = false;
let startX = 0;
let startY = 0;
let currentScreenshot = null;
let displayInfo = null;
let selectionBounds = null; // Store the current selection bounds
let isConfirming = false; // Prevent double confirmation

const screenshot = document.getElementById('screenshot');
const overlay = document.getElementById('overlay');
const selection = document.getElementById('selection');

// Listen for screenshot data from main process
ipcRenderer.on('show-screenshot-for-selection', (event, data) => {
  currentScreenshot = data.screenshot;
  displayInfo = data;
  
  screenshot.src = currentScreenshot;
  console.log('Selection interface loaded with screenshot');
  
  console.log('Screenshot loaded for selection');
});

// Reset selection state (called when window is reused)
function resetSelection() {
  console.log('Resetting selection interface state');
  isSelecting = false;
  startX = 0;
  startY = 0;
  selectionBounds = null;
  isConfirming = false;
  selection.style.display = 'none';
  selection.classList.remove('selectable');
  document.body.style.cursor = 'crosshair';
}

// Helper function to check if a point is within the selection rectangle
function isPointInSelection(x, y, bounds) {
  return x >= bounds.left &&
         x <= bounds.left + bounds.width &&
         y >= bounds.top &&
         y <= bounds.top + bounds.height;
}

// Handle mouse down - check if clicking inside existing selection or start new selection
document.addEventListener('mousedown', (event) => {
  if (event.button === 0) { // Left mouse button
    event.preventDefault(); // Prevent default drag behavior
    
    console.log(`Mouse down at (${event.clientX}, ${event.clientY})`);
    console.log('Current selectionBounds:', selectionBounds);
    console.log('Selection classList:', selection.classList.toString());
    console.log('Selection display:', selection.style.display);
    console.log('Selection pointer-events:', getComputedStyle(selection).pointerEvents);
    
    // If we have an existing selection and click is inside it, confirm the selection
    if (selectionBounds && isPointInSelection(event.clientX, event.clientY, selectionBounds)) {
      console.log(`Click INSIDE selection at (${event.clientX}, ${event.clientY}) - confirming selection`);
      console.log('Calling confirmSelection...');
      event.stopPropagation(); // Prevent any other handlers
      confirmSelection();
      return; // Don't start new selection
    }
    
    console.log(`Click OUTSIDE selection at (${event.clientX}, ${event.clientY}) - starting new selection`);
    
    // Start new selection (clicking outside existing selection or no selection exists)
    isSelecting = true;
    startX = event.clientX;
    startY = event.clientY;
    
    // Clear any previous selection
    selectionBounds = null;
    selection.classList.remove('selectable');
    
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
    
    console.log(`New selection started at (${startX}, ${startY})`);
  }
});

// Handle mouse move - update selection rectangle and cursor
document.addEventListener('mousemove', (event) => {
  if (isSelecting) {
    event.preventDefault();
    
    const currentX = event.clientX;
    const currentY = event.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
    selection.style.display = 'block'; // Ensure it's visible during drag
    
    // Debug output every 50px of movement to avoid spam
    if (width % 50 < 5 && height % 50 < 5) {
      console.log(`Dragging: ${width}x${height} at (${left}, ${top})`);
    }
  } else {
    // Not dragging - check if cursor is over existing selection for feedback
    if (selectionBounds && isPointInSelection(event.clientX, event.clientY, selectionBounds)) {
      document.body.style.cursor = 'pointer'; // Show clickable cursor
    } else {
      document.body.style.cursor = 'crosshair'; // Default selection cursor
    }
  }
});

// Handle mouse up - end current drag (but don't finalize selection)
document.addEventListener('mouseup', (event) => {
  console.log(`Mouse up at (${event.clientX}, ${event.clientY}), isSelecting: ${isSelecting}`);
  
  if (isSelecting && event.button === 0) {
    event.preventDefault();
    isSelecting = false;
    
    const endX = event.clientX;
    const endY = event.clientY;
    
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    console.log(`Final selection: ${width}x${height} at (${left}, ${top})`);
    
    // Only keep selection if it's meaningful (at least 10x10 pixels)
    if (width >= 10 && height >= 10) {
      // Store the selection bounds for double-click detection
      selectionBounds = { left, top, width, height };
      
      // Ensure the selection rectangle stays visible
      selection.style.left = left + 'px';
      selection.style.top = top + 'px';
      selection.style.width = width + 'px';
      selection.style.height = height + 'px';
      selection.style.display = 'block';
      
      // Make selection clickable after drag completes
      selection.classList.add('selectable');
      
      // Ensure focus is maintained after selection
      document.body.focus();
      
      console.log(`SELECTION SAVED: ${width}x${height} at (${left}, ${top}) - click inside to confirm, click outside to redrag`);
      console.log('selectionBounds:', selectionBounds);
    } else {
      // Too small selection, clear it
      selection.style.display = 'none';
      selection.classList.remove('selectable');
      selectionBounds = null;
      console.log('Selection too small, cleared');
    }
  }
});

// Double-click functionality removed - Enter key is the primary confirmation method

// Common function to confirm selection
function confirmSelection() {
  if (isConfirming) {
    console.log('Confirmation already in progress - ignoring duplicate call');
    return;
  }
  
  if (!selectionBounds) {
    console.log('No selection to confirm');
    return;
  }
  
  isConfirming = true;
  console.log(`Confirming selection: ${selectionBounds.width}x${selectionBounds.height} at (${selectionBounds.left}, ${selectionBounds.top})`);
  
  // Send selection data back to main process
  const selectionData = {
    left: selectionBounds.left,
    top: selectionBounds.top,
    width: selectionBounds.width,
    height: selectionBounds.height,
    screenshot: currentScreenshot,
    displayBounds: displayInfo.displayBounds,
    scaleFactor: displayInfo.scaleFactor,
    isFirstCapture: true // Let main process determine this based on window count
  };
  
  console.log('Sending selection data to main process...');

  // Send selection data to main process (fire and forget)
  ipcRenderer.invoke('process-screen-selection', selectionData)
    .then((result) => {
      if (result.success) {
        console.log('Selection processed successfully');
      } else {
        console.error('Failed to process selection:', result.error);
      }
    })
    .catch((error) => {
      console.error('Error processing selection:', error);
    });

  // Close window immediately after sending data (don't wait for processing)
  // This prevents the window from receiving more clicks while processing
  console.log('Closing selection window immediately');
  window.close();
}

// Handle Escape key locally in this window to avoid global shortcut conflicts
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    console.log('Escape pressed in selection window - closing');
    event.preventDefault();
    window.close();
  }
});
console.log('Local Escape key handler registered for selection window');

// Handle context menu
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  
  // Send context menu request to main process
  ipcRenderer.invoke('show-selection-context-menu', {
    x: event.screenX,
    y: event.screenY,
    hasSelection: !!selectionBounds
  });
});

// Simple window load handler
window.addEventListener('load', () => {
  console.log('Selection window loaded and ready for keyboard input');
});

console.log('Selection interface initialized');

// Add click handler directly to the selection element
selection.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  console.log('Selection div clicked directly');
  if (selectionBounds && selection.classList.contains('selectable')) {
    confirmSelection();
  }
});