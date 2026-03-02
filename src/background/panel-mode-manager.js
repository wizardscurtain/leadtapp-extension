/**
 * LeadTapp - Panel Mode Manager
 *
 * Manages different display modes for the extension UI:
 * - sidepanel: Chrome's native side panel (default)
 * - floating: Draggable floating panel injected into pages
 * - topbar: Horizontal collapsible bar at top of pages
 */

// =============================================================================
// Constants
// =============================================================================

const PANEL_MODES = {
  SIDEPANEL: 'sidepanel',
  FLOATING: 'floating',
  TOPBAR: 'topbar'
};

const STORAGE_KEY = 'leadtapp_panel_settings';

const DEFAULT_SETTINGS = {
  mode: PANEL_MODES.SIDEPANEL,
  floatingPosition: { x: 'right', y: 'center' }, // right/left/center, top/center/bottom
  floatingSize: { width: 380, height: 600 },
  topbarCollapsed: false,
  topbarHeight: 280,
  autoHide: false,
  autoHideDelay: 3000,
  opacity: 1.0,
  alwaysOnTop: true
};

// =============================================================================
// State
// =============================================================================

let currentSettings = { ...DEFAULT_SETTINGS };
let activePanels = new Map(); // tabId -> panel info

// =============================================================================
// Settings Management
// =============================================================================

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      currentSettings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
    }
  } catch (err) {
    console.error('[PanelMode] Failed to load settings:', err);
  }
  return currentSettings;
}

async function saveSettings(updates) {
  currentSettings = { ...currentSettings, ...updates };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: currentSettings });
    // Notify all active panels of settings change
    broadcastSettingsChange();
  } catch (err) {
    console.error('[PanelMode] Failed to save settings:', err);
  }
  return currentSettings;
}

function getSettings() {
  return { ...currentSettings };
}

// =============================================================================
// Panel Mode Switching
// =============================================================================

async function setMode(mode, tabId = null) {
  if (!Object.values(PANEL_MODES).includes(mode)) {
    throw new Error(`Invalid panel mode: ${mode}`);
  }

  const previousMode = currentSettings.mode;
  await saveSettings({ mode });

  // If switching from floating/topbar, close injected panels
  if (previousMode !== PANEL_MODES.SIDEPANEL) {
    await closeInjectedPanels(tabId);
  }

  // If switching to floating/topbar, inject panel into current tab
  if (mode !== PANEL_MODES.SIDEPANEL && tabId) {
    await injectPanel(tabId, mode);
  }

  return { success: true, mode };
}

async function openPanel(tabId) {
  const mode = currentSettings.mode;

  if (mode === PANEL_MODES.SIDEPANEL) {
    // Open native side panel
    try {
      await chrome.sidePanel.open({ tabId });
      return { success: true, mode };
    } catch (err) {
      console.error('[PanelMode] Failed to open side panel:', err);
      return { success: false, error: err.message };
    }
  } else {
    // Inject floating/topbar panel
    return await injectPanel(tabId, mode);
  }
}

async function closePanel(tabId) {
  const mode = currentSettings.mode;

  if (mode === PANEL_MODES.SIDEPANEL) {
    // Can't programmatically close side panel, but we can track state
    return { success: true };
  } else {
    return await closeInjectedPanels(tabId);
  }
}

async function togglePanel(tabId) {
  const isOpen = activePanels.has(tabId);

  if (isOpen) {
    return await closePanel(tabId);
  } else {
    return await openPanel(tabId);
  }
}

// =============================================================================
// Panel Injection
// =============================================================================

async function injectPanel(tabId, mode) {
  try {
    // First inject CSS
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['src/content/styles/floating-panel.css']
    });

    // Then inject JS
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/floating-panel.js']
    });

    // Send initialization message
    await chrome.tabs.sendMessage(tabId, {
      type: 'leadtapp/panel/init',
      mode,
      settings: currentSettings
    });

    // Track active panel
    activePanels.set(tabId, { mode, openedAt: Date.now() });

    return { success: true, mode };
  } catch (err) {
    console.error('[PanelMode] Failed to inject panel:', err);
    return { success: false, error: err.message };
  }
}

async function closeInjectedPanels(tabId = null) {
  if (tabId) {
    // Close specific tab's panel
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'leadtapp/panel/close'
      });
      activePanels.delete(tabId);
    } catch (err) {
      // Tab might be closed or panel not injected
      activePanels.delete(tabId);
    }
  } else {
    // Close all panels
    const tabIds = Array.from(activePanels.keys());
    for (const id of tabIds) {
      try {
        await chrome.tabs.sendMessage(id, {
          type: 'leadtapp/panel/close'
        });
      } catch (err) {
        // Ignore errors for closed tabs
      }
    }
    activePanels.clear();
  }

  return { success: true };
}

// =============================================================================
// Position/Size Management
// =============================================================================

async function updateFloatingPosition(tabId, position) {
  await saveSettings({ floatingPosition: position });

  if (tabId && activePanels.has(tabId)) {
    await chrome.tabs.sendMessage(tabId, {
      type: 'leadtapp/panel/updatePosition',
      position
    });
  }

  return { success: true };
}

async function updateFloatingSize(tabId, size) {
  await saveSettings({ floatingSize: size });

  if (tabId && activePanels.has(tabId)) {
    await chrome.tabs.sendMessage(tabId, {
      type: 'leadtapp/panel/updateSize',
      size
    });
  }

  return { success: true };
}

async function updateTopbarState(tabId, collapsed) {
  await saveSettings({ topbarCollapsed: collapsed });

  if (tabId && activePanels.has(tabId)) {
    await chrome.tabs.sendMessage(tabId, {
      type: 'leadtapp/panel/updateCollapsed',
      collapsed
    });
  }

  return { success: true };
}

// =============================================================================
// Broadcasting
// =============================================================================

function broadcastSettingsChange() {
  const message = {
    type: 'leadtapp/panel/settingsChanged',
    settings: currentSettings
  };

  // Send to all active panels
  activePanels.forEach(async (info, tabId) => {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      // Tab might be closed
      activePanels.delete(tabId);
    }
  });
}

// =============================================================================
// Tab Lifecycle
// =============================================================================

function handleTabRemoved(tabId) {
  activePanels.delete(tabId);
}

function handleTabUpdated(tabId, changeInfo) {
  // Re-inject panel on navigation if it was open
  if (changeInfo.status === 'complete' && activePanels.has(tabId)) {
    const mode = currentSettings.mode;
    if (mode !== PANEL_MODES.SIDEPANEL) {
      injectPanel(tabId, mode);
    }
  }
}

// =============================================================================
// Initialization
// =============================================================================

async function initPanelModeManager() {
  await loadSettings();

  // Listen for tab events
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);

  console.log('[PanelMode] Manager initialized with mode:', currentSettings.mode);
}

// =============================================================================
// Exports
// =============================================================================

// Make available to service worker
self.PanelModeManager = {
  MODES: PANEL_MODES,
  init: initPanelModeManager,
  getSettings,
  saveSettings,
  setMode,
  openPanel,
  closePanel,
  togglePanel,
  updateFloatingPosition,
  updateFloatingSize,
  updateTopbarState,
  isOpen: (tabId) => activePanels.has(tabId)
};
