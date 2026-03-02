# LeadTapp - Function Scope Document

## Overview

This document provides detailed specifications for all functions in the LeadTapp Chrome Extension. Each function includes its purpose, parameters, return values, and implementation requirements.

---

## Table of Contents

1. [Service Worker Functions](#1-service-worker-functions)
2. [Workflow Manager Functions](#2-workflow-manager-functions)
3. [LLM Client Functions](#3-llm-client-functions)
4. [Speech Handler Functions](#4-speech-handler-functions)
5. [Content Script: Recorder Functions](#5-content-script-recorder-functions)
6. [Content Script: Executor Functions](#6-content-script-executor-functions)
7. [Side Panel UI Functions](#7-side-panel-ui-functions)

---

## 1. Service Worker Functions

### File: `src/background/service-worker.js`

#### 1.1 `initializeExtension()`
**Purpose:** Bootstrap the extension on install/update/startup.

**Parameters:** None

**Returns:** `Promise<void>`

**Implementation:**
```javascript
async function initializeExtension() {
    // 1. Initialize workflow manager
    await workflowManager.init();

    // 2. Initialize LLM client
    await LLMClient.init();

    // 3. Load user preferences from storage
    const prefs = await chrome.storage.local.get(['panelMode', 'exportConfig']);

    // 4. Set up keyboard shortcut handlers
    setupKeyboardShortcuts();

    // 5. Set up message listeners
    setupMessageListeners();

    // 6. Log initialization complete
    console.log('[LeadTapp] Extension initialized');
}
```

**Dependencies:** `workflowManager`, `LLMClient`

---

#### 1.2 `setupMessageListeners()`
**Purpose:** Configure Chrome runtime message handlers.

**Parameters:** None

**Returns:** `void`

**Implementation:**
```javascript
function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Route based on message.type prefix
        // 'leadtapp/workflow/*' -> workflowManager
        // 'leadtapp/llm/*' -> LLMClient
        // 'leadtapp/speech/*' -> speechHandler
        // 'leadtapp/ui/*' -> UI state updates

        // Return true for async responses
        return handleMessage(message, sender, sendResponse);
    });
}
```

**Message Types to Handle:**
| Type | Handler | Async |
|------|---------|-------|
| `leadtapp/workflow/start-recording` | `workflowManager.startRecording()` | Yes |
| `leadtapp/workflow/stop-recording` | `workflowManager.stopRecording()` | Yes |
| `leadtapp/workflow/execute` | `workflowManager.executeWorkflow()` | Yes |
| `leadtapp/workflow/get-sites` | `workflowManager.getSites()` | No |
| `leadtapp/workflow/get-chains` | `workflowManager.getChains()` | No |
| `leadtapp/llm/chat` | `LLMClient.chat()` | Yes |
| `leadtapp/llm/configure` | `LLMClient.configure()` | Yes |
| `leadtapp/speech/start` | `speechHandler.startListening()` | No |
| `leadtapp/speech/stop` | `speechHandler.stopListening()` | No |
| `leadtapp/speech/transcript` | `speechHandler.processTranscript()` | No |

---

#### 1.3 `setupKeyboardShortcuts()`
**Purpose:** Register and handle global keyboard shortcuts.

**Parameters:** None

**Returns:** `void`

**Shortcuts to Implement:**
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Toggle side panel |
| `Ctrl+Shift+M` | Cycle panel mode (side → floating → top → side) |
| `Ctrl+Shift+N` | Submit current lead, load next |
| `Ctrl+Shift+R` | Start/stop recording |

**Implementation:**
```javascript
function setupKeyboardShortcuts() {
    chrome.commands.onCommand.addListener((command) => {
        switch (command) {
            case 'toggle-panel':
                toggleSidePanel();
                break;
            case 'cycle-mode':
                cyclePanelMode();
                break;
            case 'next-lead':
                sendMessageToPanel({ type: 'next-lead' });
                break;
            case 'toggle-recording':
                toggleRecording();
                break;
        }
    });
}
```

---

#### 1.4 `toggleSidePanel()`
**Purpose:** Show or hide the Chrome side panel.

**Parameters:** None

**Returns:** `Promise<void>`

**Implementation:**
```javascript
async function toggleSidePanel() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        await chrome.sidePanel.open({ tabId: tab.id });
    }
}
```

---

#### 1.5 `cyclePanelMode()`
**Purpose:** Cycle through available panel display modes.

**Parameters:** None

**Returns:** `Promise<void>`

**Implementation:**
```javascript
async function cyclePanelMode() {
    const { panelMode } = await chrome.storage.local.get('panelMode');
    const modes = ['sidepanel', 'floating', 'topbar'];
    const currentIndex = modes.indexOf(panelMode || 'sidepanel');
    const nextMode = modes[(currentIndex + 1) % modes.length];

    await chrome.storage.local.set({ panelMode: nextMode });

    // Notify all panels of mode change
    chrome.runtime.sendMessage({
        type: 'leadtapp/ui/panel-mode-changed',
        mode: nextMode
    });
}
```

---

## 2. Workflow Manager Functions

### File: `src/background/workflow-manager.js`

#### 2.1 `initializeWorkflows()`
**Purpose:** Load saved workflows from storage on startup.

**Parameters:** None

**Returns:** `Promise<void>`

**Implementation:**
```javascript
async function initializeWorkflows() {
    // 1. Load sites and chains from chrome.storage.local
    const saved = await chrome.storage.local.get(['sites', 'chains']);

    // 2. Populate workflowState
    if (saved.sites) workflowState.sites = saved.sites;
    if (saved.chains) workflowState.chains = saved.chains;

    // 3. Refresh tab mapping for existing sites
    await refreshTabMapping();

    // 4. Log initialization
    console.log('[Workflow Manager] Initialized with', workflowState.sites.length, 'sites');
}
```

---

#### 2.2 `saveWorkflows()`
**Purpose:** Persist current workflow state to storage.

**Parameters:** None

**Returns:** `Promise<void>`

**Implementation:**
```javascript
async function saveWorkflows() {
    await chrome.storage.local.set({
        sites: workflowState.sites,
        chains: workflowState.chains
    });
}
```

**Note:** Should be debounced to prevent excessive writes.

---

#### 2.3 `detectSiteFromUrl(url)`
**Purpose:** Identify a known site from a URL.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `url` | `string` | Full URL to analyze |

**Returns:** `{ domain: string, name: string, icon: string, color: string } | null`

**Implementation:**
```javascript
function detectSiteFromUrl(url) {
    // 1. Parse URL, extract domain without 'www.'
    // 2. Match against KNOWN_SITES patterns
    // 3. Return site info or generate default for unknown sites
    // 4. Return null for invalid URLs
}
```

**Known Sites to Match:**
- `slack.com`, `mail.google.com`, `calendar.google.com`
- `github.com`, `notion.so`, `trello.com`
- `salesforce.com`, `hubspot.com`
- `kwcommand.com`, `kw.com` (Keller Williams)
- `mojo` (Mojo Dialer)
- `zillow.com`, `realtor.com`, `redfin.com`

---

#### 2.4 `getOrCreateSite(url)`
**Purpose:** Get existing site or create new one for URL.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `url` | `string` | URL to get/create site for |

**Returns:** `Site | null`

**Implementation:**
```javascript
function getOrCreateSite(url) {
    // 1. Detect site info from URL
    const detected = detectSiteFromUrl(url);
    if (!detected) return null;

    // 2. Check if site already exists
    let site = workflowState.sites.find(s => s.domain === detected.domain);

    // 3. Create new site if not found
    if (!site) {
        site = {
            id: generateId('site'),
            name: detected.name,
            domain: detected.domain,
            icon: detected.icon,
            color: detected.color,
            workflows: [],
            tabId: null,
            lastUrl: url,
            liveState: {},
            isPolling: false
        };
        workflowState.sites.push(site);
        saveWorkflows();
    }

    return site;
}
```

---

#### 2.5 `startRecording(tabId)`
**Purpose:** Begin recording user interactions in a tab.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `tabId` | `number` | Chrome tab ID to record |

**Returns:** `Promise<{ success: boolean, workflowId?: string, siteId?: string, error?: string }>`

**Implementation:**
```javascript
async function startRecording(tabId) {
    // 1. Get tab info
    const tab = await chrome.tabs.get(tabId);

    // 2. Get or create site
    const site = getOrCreateSite(tab.url);
    if (!site) {
        return { success: false, error: 'Cannot record on this page' };
    }

    // 3. Create new workflow object
    const workflow = {
        id: generateId('wf'),
        name: 'New Workflow',
        description: '',
        siteId: site.id,
        url: tab.url,
        urlPattern: new URL(tab.url).pathname,
        actions: [],
        variables: [],
        variableDefaults: {},
        icon: '⚡',
        color: site.color,
        shortcut: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        executionCount: 0,
        lastExecuted: null,
        isChainable: true
    };

    // 4. Set recording state
    workflowState.recording = {
        isRecording: true,
        siteId: site.id,
        workflowId: workflow.id,
        tabId,
        actions: [],
        startedAt: Date.now(),
        isCrossTab: false
    };

    // 5. Inject recorder content script
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/recorder.js']
    });

    // 6. Send start message to content script
    await chrome.tabs.sendMessage(tabId, { type: 'leadtapp/recorder/start' });

    // 7. Return success
    return {
        success: true,
        workflowId: workflow.id,
        siteId: site.id,
        siteName: site.name
    };
}
```

---

#### 2.6 `stopRecording()`
**Purpose:** End recording session and save workflow.

**Parameters:** None

**Returns:** `Promise<{ success: boolean, workflowId?: string, actionCount?: number, error?: string }>`

**Implementation:**
```javascript
async function stopRecording() {
    // 1. Check if recording is active
    if (!workflowState.recording) {
        return { success: false, error: 'No active recording' };
    }

    // 2. Send stop message to content script
    const { tabId, workflowId, siteId, actions } = workflowState.recording;
    let recordedActions = actions;

    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            type: 'leadtapp/recorder/stop'
        });
        if (response?.actions) {
            recordedActions = response.actions;
        }
    } catch (e) {
        // Tab may be closed
    }

    // 3. Find site and update/add workflow
    const site = workflowState.sites.find(s => s.id === siteId);
    if (site) {
        // Create or update workflow with recorded actions
        // Auto-generate name from first action
        // Add to site.workflows
        // Save to storage
    }

    // 4. Clear recording state
    workflowState.recording = null;

    // 5. Return result
    return {
        success: true,
        workflowId,
        actionCount: recordedActions.length,
        actions: recordedActions
    };
}
```

---

#### 2.7 `handleRecordedAction(action)`
**Purpose:** Process a recorded action from content script.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `action` | `Action` | Recorded action object |

**Returns:** `void`

**Implementation:**
```javascript
function handleRecordedAction(action) {
    // 1. Verify recording is active
    if (!workflowState.recording) return;

    // 2. Add action to current recording
    workflowState.recording.actions.push(action);

    // 3. Broadcast update to UI
    chrome.runtime.sendMessage({
        type: 'leadtapp/recording/action',
        action,
        count: workflowState.recording.actions.length
    }).catch(() => {}); // Ignore if no listeners
}
```

---

#### 2.8 `executeWorkflow(workflowId, variables)`
**Purpose:** Execute a saved workflow with optional variable substitution.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `workflowId` | `string` | ID of workflow to execute |
| `variables` | `object` | Key-value pairs for variable substitution |

**Returns:** `Promise<{ success: boolean, completedSteps?: number, error?: string }>`

**Implementation:**
```javascript
async function executeWorkflow(workflowId, variables = {}) {
    // 1. Find workflow across all sites
    let workflow = null;
    let site = null;

    for (const s of workflowState.sites) {
        const w = s.workflows.find(w => w.id === workflowId);
        if (w) {
            workflow = w;
            site = s;
            break;
        }
    }

    if (!workflow) {
        return { success: false, error: 'Workflow not found' };
    }

    // 2. Find or open target tab
    let tabId = site.tabId;

    if (!tabId) {
        // Create new tab with workflow URL
        const tab = await chrome.tabs.create({ url: workflow.url, active: false });
        tabId = tab.id;
        await waitForTabLoad(tabId);
    }

    // 3. Inject executor content script
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/executor.js']
    });

    // 4. Send workflow to executor
    const result = await chrome.tabs.sendMessage(tabId, {
        type: 'leadtapp/executor/workflow',
        workflow,
        variables
    });

    // 5. Update workflow stats
    workflow.executionCount++;
    workflow.lastExecuted = Date.now();
    await saveWorkflows();

    return result;
}
```

---

#### 2.9 `executeSingleAction(workflowId, actionId, variables)`
**Purpose:** Execute a single action from a workflow.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `workflowId` | `string` | Workflow containing the action |
| `actionId` | `string` | Specific action to execute |
| `variables` | `object` | Variable substitutions |

**Returns:** `Promise<{ success: boolean, error?: string }>`

---

#### 2.10 `executeChain(chainId, initialVariables)`
**Purpose:** Execute a cross-tab workflow chain.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `chainId` | `string` | Chain to execute |
| `initialVariables` | `object` | Starting variables |

**Returns:** `Promise<{ success: boolean, results: StepResult[], failedAt?: number }>`

**Implementation:**
```javascript
async function executeChain(chainId, initialVariables = {}) {
    // 1. Find chain
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    // 2. Merge variables
    const variables = { ...initialVariables, ...chain.sharedVariables };
    const results = [];

    // 3. Execute each step
    for (let i = 0; i < chain.steps.length; i++) {
        const step = chain.steps[i];

        // Check condition
        if (step.condition) {
            const conditionMet = evaluateCondition(step.condition, variables);
            if (!conditionMet) {
                results.push({ step: i, skipped: true });
                continue;
            }
        }

        // Map variables for this step
        const stepVariables = mapVariables(step.variableMapping, variables);

        // Execute workflow
        const result = await executeWorkflow(step.workflowId, stepVariables);
        results.push({ step: i, ...result });

        if (!result.success) {
            return { success: false, failedAt: i, results };
        }

        // Capture outputs if configured
        if (step.outputCapture) {
            const captured = await captureOutputs(step);
            Object.assign(variables, captured);
        }

        // Wait between steps
        if (step.waitAfter) {
            await sleep(step.waitAfter);
        }
    }

    return { success: true, results };
}
```

---

#### 2.11 `evaluateCondition(condition, variables)`
**Purpose:** Evaluate a conditional expression for chain steps.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `condition` | `Condition` | Condition to evaluate |
| `variables` | `object` | Current variable values |

**Returns:** `boolean`

**Condition Object Structure:**
```javascript
{
    variable: string,    // Variable name to check
    operator: string,    // 'eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'exists', 'contains'
    value: any          // Value to compare against
}
```

---

#### 2.12 Chain CRUD Functions

**`createChain(name, description)`**
- Creates new chain with empty steps
- Returns `{ success: boolean, chain: Chain }`

**`updateChain(chainId, updates)`**
- Merges updates into existing chain
- Returns `{ success: boolean, chain: Chain }`

**`deleteChain(chainId)`**
- Removes chain from state
- Returns `{ success: boolean }`

**`addChainStep(chainId, workflowId, options)`**
- Adds workflow as step in chain
- Options: condition, variableMapping, outputCapture, waitAfter
- Returns `{ success: boolean, step: ChainStep }`

**`removeChainStep(chainId, stepId)`**
- Removes step, re-orders remaining
- Returns `{ success: boolean }`

**`reorderChainSteps(chainId, stepIds)`**
- Reorders steps based on new ID array
- Returns `{ success: boolean, chain: Chain }`

---

#### 2.13 Cross-Tab Recording Functions

**`startCrossTabRecording(name)`**
- Creates a chain and starts cross-tab recording mode
- Returns `{ success: boolean, chainId: string }`

**`switchRecordingTab(tabId)`**
- Saves current tab's workflow, starts recording on new tab
- Returns `{ success: boolean, siteId: string }`

**`stopCrossTabRecording()`**
- Saves all workflows, builds chain
- Returns `{ success: boolean, chainId: string, stepCount: number }`

---

#### 2.14 Live State Polling

**`startPolling(siteId, config)`**
- Starts interval-based page state polling
- Config: `{ interval: number, badgeSelectors: {}, dataSelectors: {} }`

**`stopPolling(siteId)`**
- Clears polling interval for site

---

#### 2.15 Workflow CRUD

**`updateWorkflow(workflowId, updates)`**
- Updates workflow properties
- Returns `{ success: boolean, workflow: Workflow }`

**`deleteWorkflow(workflowId)`**
- Removes workflow from site
- Returns `{ success: boolean }`

**`markActionAsVariable(workflowId, actionId, variableName)`**
- Marks action's value as a variable for runtime substitution
- Returns `{ success: boolean }`

---

## 3. LLM Client Functions

### File: `src/background/llm-client.js`

#### 3.1 `init()`
**Purpose:** Initialize LLM client with saved configuration.

**Parameters:** None

**Returns:** `Promise<{ success: boolean, provider: string }>`

---

#### 3.2 `configure(newConfig)`
**Purpose:** Update LLM configuration.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `newConfig` | `LLMConfig` | New configuration values |

**Config Structure:**
```javascript
{
    provider: 'openai' | 'anthropic' | 'local' | 'mcp',
    apiKey: string,
    baseUrl: string,
    model: string,
    maxTokens: number,
    temperature: number,
    systemPrompt: string,
    mcpServerUrl: string
}
```

**Returns:** `Promise<{ success: boolean, config: PublicConfig } | { error: string }>`

---

#### 3.3 `chat(message, options)`
**Purpose:** Send a message and get AI response.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `message` | `string` | User message |
| `options` | `ChatOptions` | Chat configuration |

**Options:**
```javascript
{
    systemPrompt: string,      // Override default system prompt
    includeHistory: boolean,   // Include conversation history (default: true)
    maxHistoryMessages: number, // Limit history (default: 10)
    streaming: boolean,        // Stream response (default: false)
    tools: Tool[],            // Available tools for function calling
    context: object           // Additional context (workflow data, etc.)
}
```

**Returns:** `Promise<ChatResponse>`
```javascript
{
    content: string,
    toolCalls: ToolCall[] | null,
    usage: { prompt_tokens, completion_tokens, total_tokens },
    model: string,
    finishReason: string
}
```

---

#### 3.4 Provider-Specific Chat Functions

**`_chatOpenAI(messages, tools)`**
- Calls OpenAI API (`/v1/chat/completions`)
- Handles tool/function calling format

**`_chatAnthropic(messages, tools)`**
- Calls Anthropic API (`/v1/messages`)
- Converts message format for Claude
- Handles tool_use blocks

**`_chatLocal(messages)`**
- Calls local endpoint (Ollama or OpenAI-compatible)
- Tries Ollama format first, falls back to OpenAI format

**`_chatMCP(messages, tools)`**
- Calls MCP server using JSON-RPC
- Uses `sampling/createMessage` method

---

#### 3.5 `analyzePageForWorkflow(pageContext)`
**Purpose:** Suggest automation workflows for a webpage.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageContext` | `object` | `{ url, title, elements }` |

**Returns:** `Promise<{ success: boolean, suggestions?: object, raw?: string }>`

**Expected Response:**
```javascript
{
    workflows: [
        {
            name: "Workflow Name",
            description: "What it does",
            steps: [
                { action: "click", target: "selector" },
                { action: "input", target: "selector", value: "{{variable}}" }
            ]
        }
    ]
}
```

---

#### 3.6 `describeWorkflow(workflow)`
**Purpose:** Generate natural language description of a workflow.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `workflow` | `Workflow` | Workflow to describe |

**Returns:** `Promise<{ success: boolean, description: string }>`

---

#### 3.7 `suggestChainConnections(workflows)`
**Purpose:** Suggest how workflows could be chained together.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `workflows` | `Workflow[]` | Available workflows |

**Returns:** `Promise<{ success: boolean, suggestions?: object, raw?: string }>`

---

#### 3.8 Conversation Management

**`clearHistory()`**
- Clears conversation history
- Returns `{ success: boolean }`

**`getHistory()`**
- Returns copy of conversation history
- Returns `Message[]`

---

#### 3.9 Provider Discovery

**`listLocalModels()`**
- Queries local server for available models
- Returns `{ success: boolean, models: string[] }`

**`getAvailableProviders()`**
- Returns list of supported providers with their models
- Returns `Provider[]`

---

## 4. Speech Handler Functions

### File: `src/background/speech-handler.js`

#### 4.1 `startListening(config)`
**Purpose:** Begin speech recognition.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `config` | `SpeechConfig` | Configuration options |

**Config:**
```javascript
{
    mode: 'coaching' | 'logging',
    language: string,       // e.g., 'en-US'
    continuous: boolean,
    interimResults: boolean
}
```

**Returns:** `{ success: boolean, mode: string }`

---

#### 4.2 `stopListening()`
**Purpose:** Stop speech recognition and return summary.

**Returns:**
```javascript
{
    success: boolean,
    summary: {
        transcript: TranscriptEntry[],
        detectedActions: DetectedAction[],
        duration: number
    }
}
```

---

#### 4.3 `processTranscript(entry)`
**Purpose:** Process incoming transcript from speech recognition.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `entry` | `TranscriptEntry` | `{ timestamp, text, isFinal, confidence }` |

**Returns:** `{ success: boolean, actions: DetectedAction[] }`

**Side Effects:**
- Adds entry to transcript array
- Detects and stores actions
- Notifies subscribers of actions detected
- In coaching mode, generates and notifies coaching suggestions

---

#### 4.4 `detectActions(text)`
**Purpose:** Detect workflow-relevant actions from text.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | Text to analyze |

**Returns:** `DetectedAction[]`

**Action Types to Detect:**
| Type | Example Patterns |
|------|------------------|
| `appointment` | "schedule an appointment", "meet on Tuesday" |
| `callback` | "call you back", "try again tomorrow" |
| `interested` | "sounds good", "tell me more" |
| `notInterested` | "not interested", "already have an agent" |
| `objection` | "too expensive", "need to think about it" |
| `contact` | "my number is", "reach me at" |

---

#### 4.5 `generateCoaching(text, detectedActions)`
**Purpose:** Generate real-time coaching suggestion.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | Recent transcript |
| `detectedActions` | `DetectedAction[]` | Detected actions |

**Returns:** `CoachingSuggestion | null`
```javascript
{
    type: 'success' | 'action' | 'objection' | 'tip',
    message: string,
    priority: 'high' | 'medium' | 'low'
}
```

---

#### 4.6 `suggestWorkflowFromActions()`
**Purpose:** Generate workflow suggestion based on detected actions.

**Returns:**
```javascript
{
    suggestedOutcome: CallOutcome,
    confidence: number,
    actions: DetectedAction[],
    notes: string
}
```

---

#### 4.7 `subscribe(callback)`
**Purpose:** Subscribe to speech events.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `callback` | `function` | Event handler |

**Returns:** `function` (Unsubscribe function)

**Event Types:**
- `state_change` - Listening started/stopped
- `actions_detected` - Actions found in speech
- `coaching_suggestion` - Coaching tip generated

---

## 5. Content Script: Recorder Functions

### File: `src/content/recorder.js`

#### 5.1 `startRecording()`
**Purpose:** Begin capturing DOM events.

**Implementation:**
- Add event listeners for click, input, submit, keypress
- Create mutation observer for DOM changes
- Initialize recording state

---

#### 5.2 `stopRecording()`
**Purpose:** Stop capturing and return recorded actions.

**Returns:** `{ actions: Action[] }`

---

#### 5.3 `handleClick(event)`
**Purpose:** Capture click interactions.

**Creates Action:**
```javascript
{
    id: generateId('act'),
    type: 'click',
    selector: generateSelector(element),
    selectorFallbacks: generateFallbackSelectors(element),
    xpath: generateXPath(element),
    tagName: element.tagName.toLowerCase(),
    label: generateLabel(element),
    timestamp: Date.now()
}
```

---

#### 5.4 `handleInput(event)`
**Purpose:** Capture input changes (text fields, textareas).

**Creates Action:**
```javascript
{
    type: 'input',
    value: element.value,
    // ... plus selector info
}
```

---

#### 5.5 `handleSubmit(event)`
**Purpose:** Capture form submissions.

---

#### 5.6 `handleKeypress(event)`
**Purpose:** Capture significant key presses (Enter, Tab, Escape).

---

#### 5.7 `generateSelector(element)`
**Purpose:** Generate CSS selector for element.

**Strategy Order:**
1. ID selector if unique
2. data-testid if present
3. name attribute
4. aria-label
5. Combination of tag + classes
6. nth-child path

**Returns:** `string`

---

#### 5.8 `generateFallbackSelectors(element)`
**Purpose:** Generate alternative selectors for resilience.

**Returns:** `string[]` (2-3 fallback selectors)

---

#### 5.9 `generateXPath(element)`
**Purpose:** Generate XPath as ultimate fallback.

**Returns:** `string`

---

#### 5.10 `generateLabel(element)`
**Purpose:** Generate human-readable description of element.

**Strategy:**
1. Use innerText (truncated)
2. Use placeholder/title/aria-label
3. Use tag + class name
4. Default to "Element"

**Returns:** `string`

---

## 6. Content Script: Executor Functions

### File: `src/content/executor.js`

#### 6.1 `findElement(action, timeout)`
**Purpose:** Find DOM element using multiple strategies.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `action` | `Action` | Action containing selectors |
| `timeout` | `number` | Max wait time in ms (default: 5000) |

**Strategy Order:**
1. Primary selector
2. Fallback selectors
3. XPath
4. Text-based selector (`:text()` syntax)

**Returns:** `Promise<Element | null>`

---

#### 6.2 `isInteractable(element)`
**Purpose:** Check if element is visible and clickable.

**Checks:**
- Non-zero bounding rect
- Not `display: none`
- Not `visibility: hidden`
- Not `pointer-events: none`

**Returns:** `boolean`

---

#### 6.3 `executeAction(action, variables)`
**Purpose:** Execute a single workflow action.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `action` | `Action` | Action to execute |
| `variables` | `object` | Variable substitutions |

**Returns:** `Promise<{ success: boolean, element: Element }>`

**Implementation:**
1. Wait for any specified delay
2. Find element using `findElement()`
3. Scroll element into view
4. Show visual feedback
5. Execute based on action type (click/input/select/keypress)

---

#### 6.4 `executeClick(element)`
**Purpose:** Simulate realistic click.

**Implementation:**
```javascript
async function executeClick(element) {
    element.focus();
    await sleep(50);

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Dispatch mousedown, mouseup, click events
    for (const eventType of ['mousedown', 'mouseup', 'click']) {
        const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y
        });
        element.dispatchEvent(event);
        await sleep(10);
    }
}
```

---

#### 6.5 `executeInput(element, value)`
**Purpose:** Simulate realistic typing.

**Implementation:**
```javascript
async function executeInput(element, value) {
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    // Type character by character
    for (const char of value) {
        element.value += char;
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: char
        }));
        await sleep(20 + Math.random() * 30); // Random 20-50ms
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
}
```

---

#### 6.6 `executeSelect(element, value)`
**Purpose:** Change select dropdown value.

---

#### 6.7 `executeKeypress(element, key)`
**Purpose:** Dispatch keyboard events.

---

#### 6.8 `executeWorkflow(workflow, variables)`
**Purpose:** Execute full workflow sequence.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `workflow` | `Workflow` | Workflow to execute |
| `variables` | `object` | Variable values |

**Returns:** `Promise<ExecutionResult>`
```javascript
{
    success: boolean,
    completedSteps: number,
    error?: string,
    results: ActionResult[]
}
```

---

#### 6.9 `captureData(selectors)`
**Purpose:** Extract data from page for cross-tab workflows.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `selectors` | `object` | `{ variableName: 'cssSelector' }` |

**Returns:** `object` (Extracted values)

---

#### 6.10 `getPageState(config)`
**Purpose:** Get current page state for live polling.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `config` | `object` | `{ badgeSelectors, dataSelectors }` |

**Returns:** `PageState`
```javascript
{
    url: string,
    title: string,
    timestamp: number,
    // ... extracted values
}
```

---

#### 6.11 `showExecutionFeedback(element)`
**Purpose:** Visual highlight during execution.

**Implementation:**
- Create overlay div with blue border
- Position over element
- Fade out after 500ms

---

## 7. Side Panel UI Functions

### File: `src/sidepanel/sidepanel.js`

#### 7.1 Lead Management Functions

**`loadNextLead()`**
- Fetches next lead from queue
- Updates UI with lead data

**`submitFeedback(outcome, notes, followUpDate)`**
- Validates required fields
- Sends feedback to service worker
- Advances to next lead

**`updateLeadDisplay(lead)`**
- Populates lead card with data
- Updates tier badge, score, contact info

**`updateStats(stats)`**
- Updates session statistics display

---

#### 7.2 Recording UI Functions

**`toggleRecording()`**
- Starts or stops recording based on state
- Updates recording indicator

**`updateRecordingUI(isRecording, actionCount)`**
- Shows/hides recording bar
- Updates action count

---

#### 7.3 Dashboard Functions

**`loadDashboard()`**
- Fetches sites and workflows
- Renders site cards and workflow lists

**`renderSiteCard(site)`**
- Creates DOM for site with workflows

**`runWorkflow(workflowId)`**
- Opens variable modal if needed
- Executes workflow

**`openWorkflowEditor(workflowId)`**
- Opens modal for editing workflow

---

#### 7.4 Chat UI Functions

**`sendChatMessage(message)`**
- Sends message to LLM client
- Displays response
- Handles streaming if enabled

**`handleSuggestionClick(prompt)`**
- Sends pre-defined suggestion as message

**`updateChatUI(message, isUser)`**
- Appends message to chat container
- Scrolls to bottom

---

#### 7.5 Speech UI Functions

**`toggleListening()`**
- Starts/stops speech recognition
- Updates mic button state

**`showCoachingSuggestion(suggestion)`**
- Displays coaching banner

**`showDetectedActions(actions)`**
- Shows detected actions panel

---

#### 7.6 Settings Functions

**`saveLLMConfig(config)`**
- Validates and saves LLM settings

**`testLLMConnection()`**
- Tests current LLM config
- Shows success/failure

**`clearWorkflows()`**
- Confirms and clears all workflows

**`clearFeedback()`**
- Confirms and clears feedback history

---

#### 7.7 Export Functions

**`exportToCSV()`**
- Builds CSV from feedback history
- Uses configured column mapping
- Triggers download

**`setExportPreset(preset)`**
- Applies CRM-specific column mapping

---

## Utility Functions

### ID Generation
```javascript
function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}
```

### Sleep
```javascript
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Debounce
```javascript
function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}
```

### Wait for Tab Load
```javascript
function waitForTabLoad(tabId, timeout = 10000) {
    return new Promise((resolve) => {
        const listener = (id, changeInfo) => {
            if (id === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 500);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, timeout);
    });
}
```

---

## Error Handling

All async functions should implement consistent error handling:

```javascript
try {
    // ... operation
} catch (error) {
    console.error('[Component] Operation failed:', error);
    return { success: false, error: error.message };
}
```

## Testing Requirements

Each function should have tests for:
1. Happy path execution
2. Edge cases (empty inputs, missing data)
3. Error conditions
4. Timeout handling where applicable

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | Initial | Full function specification |
