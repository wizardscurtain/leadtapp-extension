/**
 * LeadTapp - Floating Panel
 *
 * Injected content script that creates a floating/topbar panel
 * for the extension UI on web pages.
 */

(() => {
  // Prevent double injection
  if (window.__leadtappPanelInjected) return;
  window.__leadtappPanelInjected = true;

  // =============================================================================
  // Constants
  // =============================================================================

  const PANEL_ID = 'leadtapp-floating-panel';
  const FRAME_ID = 'leadtapp-panel-frame';
  const TOPBAR_ID = 'leadtapp-topbar-panel';

  // =============================================================================
  // State
  // =============================================================================

  let currentMode = 'floating';
  let settings = {};
  let panelElement = null;
  let isDragging = false;
  let isResizing = false;
  let dragOffset = { x: 0, y: 0 };

  // =============================================================================
  // Panel Creation
  // =============================================================================

  function createFloatingPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'leadtapp-floating-panel';

    // Header with drag handle and controls
    const header = document.createElement('div');
    header.className = 'sp-panel-header';
    header.innerHTML = `
      <div class="sp-drag-handle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
        <span>LeadTapp</span>
      </div>
      <div class="sp-panel-controls">
        <button class="sp-control-btn sp-btn-minimize" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button class="sp-control-btn sp-btn-dock" title="Dock to side panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
        <button class="sp-control-btn sp-btn-close" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    // Content iframe
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.className = 'sp-panel-frame';
    frame.src = chrome.runtime.getURL('src/sidepanel/sidepanel.html?mode=floating');

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sp-resize-handle';

    panel.appendChild(header);
    panel.appendChild(frame);
    panel.appendChild(resizeHandle);

    // Apply settings
    applyFloatingSettings(panel);

    // Add event listeners
    setupFloatingEvents(panel, header, resizeHandle);

    document.body.appendChild(panel);
    panelElement = panel;

    return panel;
  }

  function createTopbarPanel() {
    const panel = document.createElement('div');
    panel.id = TOPBAR_ID;
    panel.className = 'leadtapp-topbar-panel';
    if (settings.topbarCollapsed) {
      panel.classList.add('collapsed');
    }

    // Header with collapse toggle
    const header = document.createElement('div');
    header.className = 'sp-topbar-header';
    header.innerHTML = `
      <div class="sp-topbar-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
        <span>LeadTapp</span>
      </div>
      <div class="sp-topbar-controls">
        <button class="sp-control-btn sp-btn-collapse" title="Collapse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
        <button class="sp-control-btn sp-btn-dock" title="Dock to side panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
        <button class="sp-control-btn sp-btn-close" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    // Content iframe
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.className = 'sp-topbar-frame';
    frame.src = chrome.runtime.getURL('src/sidepanel/sidepanel.html?mode=topbar');

    // Resize handle at bottom
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sp-topbar-resize';

    panel.appendChild(header);
    panel.appendChild(frame);
    panel.appendChild(resizeHandle);

    // Apply settings
    applyTopbarSettings(panel);

    // Add event listeners
    setupTopbarEvents(panel, header, resizeHandle);

    // Shift page content down
    document.body.style.transition = 'margin-top 0.3s ease';
    document.body.style.marginTop = settings.topbarCollapsed ? '40px' : `${settings.topbarHeight + 40}px`;

    document.body.appendChild(panel);
    panelElement = panel;

    return panel;
  }

  // =============================================================================
  // Settings Application
  // =============================================================================

  function applyFloatingSettings(panel) {
    const { floatingPosition, floatingSize, opacity } = settings;

    // Size
    panel.style.width = `${floatingSize?.width || 380}px`;
    panel.style.height = `${floatingSize?.height || 600}px`;

    // Position
    const pos = floatingPosition || { x: 'right', y: 'center' };
    let left, top;

    switch (pos.x) {
      case 'left': left = '20px'; break;
      case 'center': left = '50%'; panel.style.transform = 'translateX(-50%)'; break;
      case 'right':
      default: left = 'auto'; panel.style.right = '20px'; break;
    }

    switch (pos.y) {
      case 'top': top = '20px'; break;
      case 'bottom': top = 'auto'; panel.style.bottom = '20px'; break;
      case 'center':
      default: top = '50%';
        if (pos.x === 'center') {
          panel.style.transform = 'translate(-50%, -50%)';
        } else {
          panel.style.transform = 'translateY(-50%)';
        }
        break;
    }

    if (left !== 'auto') panel.style.left = left;
    if (top !== 'auto') panel.style.top = top;

    // Opacity
    panel.style.opacity = opacity ?? 1;
  }

  function applyTopbarSettings(panel) {
    const { topbarHeight, topbarCollapsed, opacity } = settings;

    panel.style.setProperty('--topbar-height', `${topbarHeight || 280}px`);
    panel.style.opacity = opacity ?? 1;

    if (topbarCollapsed) {
      panel.classList.add('collapsed');
    }
  }

  // =============================================================================
  // Floating Panel Events
  // =============================================================================

  function setupFloatingEvents(panel, header, resizeHandle) {
    const dragHandle = header.querySelector('.sp-drag-handle');

    // Dragging
    dragHandle.addEventListener('mousedown', startDrag);

    // Resizing
    resizeHandle.addEventListener('mousedown', startResize);

    // Controls
    header.querySelector('.sp-btn-minimize').addEventListener('click', minimizePanel);
    header.querySelector('.sp-btn-dock').addEventListener('click', dockToSidePanel);
    header.querySelector('.sp-btn-close').addEventListener('click', closePanel);

    // Global mouse events
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function startDrag(e) {
    if (!panelElement) return;
    isDragging = true;
    panelElement.classList.add('dragging');

    const rect = panelElement.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    // Clear any transform-based positioning
    panelElement.style.transform = 'none';
    panelElement.style.right = 'auto';
    panelElement.style.bottom = 'auto';

    e.preventDefault();
  }

  function startResize(e) {
    if (!panelElement) return;
    isResizing = true;
    panelElement.classList.add('resizing');
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (!panelElement) return;

    if (isDragging) {
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;

      // Constrain to viewport
      const maxX = window.innerWidth - panelElement.offsetWidth;
      const maxY = window.innerHeight - panelElement.offsetHeight;

      panelElement.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      panelElement.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
    }

    if (isResizing) {
      const rect = panelElement.getBoundingClientRect();
      const width = Math.max(300, e.clientX - rect.left + 10);
      const height = Math.max(400, e.clientY - rect.top + 10);

      panelElement.style.width = `${width}px`;
      panelElement.style.height = `${height}px`;
    }
  }

  function handleMouseUp() {
    if (isDragging) {
      isDragging = false;
      panelElement?.classList.remove('dragging');

      // Save new position
      const rect = panelElement.getBoundingClientRect();
      saveFloatingPosition(rect);
    }

    if (isResizing) {
      isResizing = false;
      panelElement?.classList.remove('resizing');

      // Save new size
      if (panelElement) {
        saveFloatingSize({
          width: panelElement.offsetWidth,
          height: panelElement.offsetHeight
        });
      }
    }
  }

  function minimizePanel() {
    if (!panelElement) return;
    panelElement.classList.toggle('minimized');
  }

  // =============================================================================
  // Topbar Events
  // =============================================================================

  function setupTopbarEvents(panel, header, resizeHandle) {
    // Collapse toggle
    header.querySelector('.sp-btn-collapse').addEventListener('click', toggleTopbarCollapse);
    header.querySelector('.sp-btn-dock').addEventListener('click', dockToSidePanel);
    header.querySelector('.sp-btn-close').addEventListener('click', closePanel);

    // Resize
    let isTopbarResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isTopbarResizing = true;
      startY = e.clientY;
      startHeight = settings.topbarHeight || 280;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isTopbarResizing) return;

      const delta = e.clientY - startY;
      const newHeight = Math.max(150, Math.min(500, startHeight + delta));

      panel.style.setProperty('--topbar-height', `${newHeight}px`);
      document.body.style.marginTop = `${newHeight + 40}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isTopbarResizing) {
        isTopbarResizing = false;

        // Save new height
        const height = parseInt(panel.style.getPropertyValue('--topbar-height')) || 280;
        chrome.runtime.sendMessage({
          type: 'leadtapp/panel/saveSettings',
          settings: { topbarHeight: height }
        });
      }
    });
  }

  function toggleTopbarCollapse() {
    if (!panelElement) return;

    const isCollapsed = panelElement.classList.toggle('collapsed');

    // Update body margin
    if (isCollapsed) {
      document.body.style.marginTop = '40px';
    } else {
      const height = settings.topbarHeight || 280;
      document.body.style.marginTop = `${height + 40}px`;
    }

    // Update collapse icon
    const collapseBtn = panelElement.querySelector('.sp-btn-collapse svg');
    collapseBtn.innerHTML = isCollapsed
      ? '<polyline points="6 9 12 15 18 9"/>'
      : '<polyline points="18 15 12 9 6 15"/>';

    // Save state
    chrome.runtime.sendMessage({
      type: 'leadtapp/panel/saveSettings',
      settings: { topbarCollapsed: isCollapsed }
    });
  }

  // =============================================================================
  // Panel Actions
  // =============================================================================

  function dockToSidePanel() {
    chrome.runtime.sendMessage({
      type: 'leadtapp/panel/setMode',
      mode: 'sidepanel'
    });
    removePanel();
  }

  function closePanel() {
    chrome.runtime.sendMessage({ type: 'leadtapp/panel/close' });
    removePanel();
  }

  function removePanel() {
    if (panelElement) {
      panelElement.remove();
      panelElement = null;
    }

    // Reset body margin if topbar
    if (currentMode === 'topbar') {
      document.body.style.marginTop = '';
      document.body.style.transition = '';
    }

    window.__leadtappPanelInjected = false;
  }

  // =============================================================================
  // Settings Persistence
  // =============================================================================

  function saveFloatingPosition(rect) {
    // Convert pixel position to relative position for storage
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let xPos = 'center';
    let yPos = 'center';

    if (rect.left < viewportWidth * 0.33) xPos = 'left';
    else if (rect.right > viewportWidth * 0.67) xPos = 'right';

    if (rect.top < viewportHeight * 0.33) yPos = 'top';
    else if (rect.bottom > viewportHeight * 0.67) yPos = 'bottom';

    chrome.runtime.sendMessage({
      type: 'leadtapp/panel/saveSettings',
      settings: { floatingPosition: { x: xPos, y: yPos } }
    });
  }

  function saveFloatingSize(size) {
    chrome.runtime.sendMessage({
      type: 'leadtapp/panel/saveSettings',
      settings: { floatingSize: size }
    });
  }

  // =============================================================================
  // Message Handling
  // =============================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'leadtapp/panel/init':
        currentMode = message.mode;
        settings = message.settings || {};

        if (currentMode === 'floating') {
          createFloatingPanel();
        } else if (currentMode === 'topbar') {
          createTopbarPanel();
        }
        sendResponse({ success: true });
        break;

      case 'leadtapp/panel/close':
        removePanel();
        sendResponse({ success: true });
        break;

      case 'leadtapp/panel/updatePosition':
        if (panelElement && currentMode === 'floating') {
          settings.floatingPosition = message.position;
          applyFloatingSettings(panelElement);
        }
        sendResponse({ success: true });
        break;

      case 'leadtapp/panel/updateSize':
        if (panelElement && currentMode === 'floating') {
          settings.floatingSize = message.size;
          panelElement.style.width = `${message.size.width}px`;
          panelElement.style.height = `${message.size.height}px`;
        }
        sendResponse({ success: true });
        break;

      case 'leadtapp/panel/updateCollapsed':
        if (panelElement && currentMode === 'topbar') {
          settings.topbarCollapsed = message.collapsed;
          if (message.collapsed) {
            panelElement.classList.add('collapsed');
            document.body.style.marginTop = '40px';
          } else {
            panelElement.classList.remove('collapsed');
            document.body.style.marginTop = `${settings.topbarHeight + 40}px`;
          }
        }
        sendResponse({ success: true });
        break;

      case 'leadtapp/panel/settingsChanged':
        settings = message.settings;
        if (panelElement) {
          if (currentMode === 'floating') {
            applyFloatingSettings(panelElement);
          } else if (currentMode === 'topbar') {
            applyTopbarSettings(panelElement);
          }
        }
        sendResponse({ success: true });
        break;
    }

    return true; // Keep channel open for async response
  });

  console.log('[LeadTapp] Floating panel script loaded');
})();
