const { ipcRenderer } = require('electron');

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
const confirmButton = document.getElementById('confirmButton');

// Listen for screenshot data from main process
ipcRenderer.on('show-screenshot-for-selection', (event, data) => {
  currentScreenshot = data.screenshot;
  displayInfo = data;
  
  screenshot.src = currentScreenshot;
  console.log('Selection interface loaded with screenshot');
  
  console.log('Screenshot loaded for selection');
});

// Handle mouse down - start selection immediately
document.addEventListener('mousedown', (event) => {
  if (event.button === 0) { // Left mouse button
    event.preventDefault(); // Prevent default drag behavior
    
    isSelecting = true;
    startX = event.clientX;
    startY = event.clientY;
    
    // Clear any previous selection
    selectionBounds = null;
    hideConfirmButton();
    
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
    
    console.log(`Selection started immediately at (${startX}, ${startY})`);
  }
});

// Handle mouse move - update selection rectangle
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
    
    // Debug output every 50px of movement to avoid spam
    if (width % 50 < 5 && height % 50 < 5) {
      console.log(`Dragging: ${width}x${height} at (${left}, ${top})`);
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
      
      // Ensure focus is maintained after selection
      document.body.focus();
      
      // Show confirm button as backup
      showConfirmButton(left + width + 10, top);
      
      console.log(`SELECTION SAVED: ${width}x${height} at (${left}, ${top}) - drag to adjust or press Enter to confirm`);
      console.log('selectionBounds:', selectionBounds);
    } else {
      // Too small selection, clear it
      selection.style.display = 'none';
      selectionBounds = null;
      hideConfirmButton();
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
  
  // Close selection window immediately to prevent visual blocking
  console.log('Closing selection window immediately');
  
  // Send selection data back to main process
  const selectionData = {
    left: selectionBounds.left,
    top: selectionBounds.top,
    width: selectionBounds.width,
    height: selectionBounds.height,
    screenshot: currentScreenshot,
    displayBounds: displayInfo.displayBounds,
    scaleFactor: displayInfo.scaleFactor
  };
  
  console.log('Sending selection data to main process...');
  
  // Process selection and close window immediately after
  ipcRenderer.invoke('process-screen-selection', selectionData)
    .then((result) => {
      if (result.success) {
        console.log('Selection processed successfully');
      } else {
        console.error('Failed to process selection:', result.error);
      }
      // Close window regardless of success/failure
      window.close();
    })
    .catch((error) => {
      console.error('Error processing selection:', error);
      // Close window even on error
      window.close();
    });
}

// Keyboard events are now handled by global shortcuts in main process
// This provides better reliability than window-level events
console.log('Keyboard events handled by global shortcuts (Enter/Escape)');

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

// Helper functions for confirm button
function showConfirmButton(x, y) {
  confirmButton.style.display = 'block';
  confirmButton.style.left = Math.min(x, window.innerWidth - 200) + 'px'; // Keep within window
  confirmButton.style.top = y + 'px';
}

function hideConfirmButton() {
  confirmButton.style.display = 'none';
}

// Click handler for confirm button
confirmButton.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  console.log('Confirm button clicked');
  if (selectionBounds) {
    confirmSelection();
  }
});

console.log('Selection interface initialized');