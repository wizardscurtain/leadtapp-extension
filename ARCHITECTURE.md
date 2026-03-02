# LeadTapp - Architecture Document

## Overview

LeadTapp is a Chrome Extension designed for real estate agents (primarily Keller Williams) that provides:
1. **Lead Management** - Display and track leads from CRM systems
2. **Call Feedback** - Record call outcomes and notes
3. **Workflow Automation** - Record and replay browser actions across sites
4. **AI Assistant** - LLM-powered coaching and workflow suggestions
5. **Speech Recognition** - Real-time call coaching and action detection

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHROME EXTENSION                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐ │
│  │   SIDE PANEL     │     │  FLOATING PANEL  │     │    TOP BAR      │ │
│  │  (sidepanel/)    │     │  (floating/)     │     │   (topbar/)     │ │
│  │                  │     │                  │     │                 │ │
│  │  - Leads Tab     │     │  Same UI as      │     │  Compact mode   │ │
│  │  - Dashboard Tab │ ◄──►│  Side Panel      │ ◄──►│  of Side Panel  │ │
│  │  - AI Chat Tab   │     │  (iframe embed)  │     │                 │ │
│  │  - Manage Tab    │     │                  │     │                 │ │
│  │  - Settings Tab  │     │                  │     │                 │ │
│  └────────┬─────────┘     └────────┬─────────┘     └────────┬────────┘ │
│           │                        │                        │          │
│           └────────────────────────┼────────────────────────┘          │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     SERVICE WORKER (Background)                   │  │
│  │                      (background/service-worker.js)               │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                    │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │  │
│  │  │ Workflow Manager │  │   LLM Client    │  │  Speech Handler  │  │  │
│  │  │ (workflow-       │  │ (llm-client.js) │  │ (speech-         │  │  │
│  │  │  manager.js)     │  │                 │  │  handler.js)     │  │  │
│  │  │                  │  │ - OpenAI        │  │                  │  │  │
│  │  │ - Sites          │  │ - Anthropic     │  │ - Coaching Mode  │  │  │
│  │  │ - Workflows      │  │ - Local/Ollama  │  │ - Logging Mode   │  │  │
│  │  │ - Chains         │  │ - MCP           │  │ - Action Detect  │  │  │
│  │  │ - Recording      │  │                 │  │                  │  │  │
│  │  │ - Execution      │  │                 │  │                  │  │  │
│  │  └────────┬─────────┘  └────────┬────────┘  └────────┬─────────┘  │  │
│  │           │                     │                    │            │  │
│  └───────────┼─────────────────────┼────────────────────┼────────────┘  │
│              │                     │                    │               │
│              ▼                     ▼                    ▼               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       CONTENT SCRIPTS                             │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                    │  │
│  │  ┌─────────────────────┐         ┌─────────────────────┐         │  │
│  │  │   recorder.js       │         │    executor.js      │         │  │
│  │  │                     │         │                     │         │  │
│  │  │  Injected on demand │         │  Injected on demand │         │  │
│  │  │  to record user     │         │  to execute         │         │  │
│  │  │  interactions       │         │  workflow actions   │         │  │
│  │  │                     │         │                     │         │  │
│  │  │  - Click events     │         │  - findElement()    │         │  │
│  │  │  - Input events     │         │  - executeClick()   │         │  │
│  │  │  - Submit events    │         │  - executeInput()   │         │  │
│  │  │  - Keypress events  │         │  - captureData()    │         │  │
│  │  └─────────────────────┘         └─────────────────────┘         │  │
│  │                                                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │   KW Command    │  │   LLM APIs      │  │   MCP Server            │ │
│  │   (kwcommand.   │  │                 │  │   (optional)            │ │
│  │    com)         │  │   - OpenAI      │  │                         │ │
│  │                 │  │   - Anthropic   │  │   For tool use and      │ │
│  │   Lead data     │  │   - Ollama      │  │   extended capabilities │ │
│  │   CRM data      │  │                 │  │                         │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
LeadTapp/
├── manifest.json              # Chrome Extension manifest (MV3)
├── package.json               # NPM dependencies (TypeScript, build tools)
├── tsconfig.json              # TypeScript configuration
│
├── src/
│   ├── background/            # Service Worker (Background Scripts)
│   │   ├── service-worker.js  # Main entry point, message routing
│   │   ├── workflow-manager.js # Workflow CRUD, recording, execution
│   │   ├── llm-client.js      # Multi-provider LLM integration
│   │   └── speech-handler.js  # Speech recognition handling
│   │
│   ├── content/               # Content Scripts (Injected into pages)
│   │   ├── recorder.js        # DOM interaction recording
│   │   └── executor.js        # Workflow action execution
│   │
│   ├── sidepanel/             # Chrome Side Panel UI
│   │   ├── sidepanel.html     # Main UI structure
│   │   ├── sidepanel.css      # Styles
│   │   └── sidepanel.js       # UI logic and state
│   │
│   ├── floating/              # Floating Panel Mode
│   │   ├── floating.html      # Embeds sidepanel in draggable container
│   │   └── floating.js        # Drag, resize, collapse logic
│   │
│   ├── topbar/                # Top Bar Mode
│   │   ├── topbar.html        # Compact horizontal layout
│   │   └── topbar.js          # Expand/collapse logic
│   │
│   └── shared/                # Shared Code
│       └── types.ts           # TypeScript type definitions
│
├── assets/
│   └── icons/                 # Extension icons (16, 32, 48, 128px)
│
└── dist/                      # Built/compiled output
```

## Data Flow

### 1. Lead Processing Flow
```
KW Command Website
        │
        ▼
┌───────────────────┐
│  Content Script   │  Scrapes lead data from page
│  (Future: API)    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Service Worker   │  Processes, stores in chrome.storage
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   Side Panel UI   │  Displays lead card, feedback form
└─────────┬─────────┘
          │
          ▼ (User submits feedback)
┌───────────────────┐
│  chrome.storage   │  Persists feedback locally
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   CSV Export      │  Exports for CRM import
└───────────────────┘
```

### 2. Workflow Recording Flow
```
User clicks "Record" in Side Panel
          │
          ▼
┌───────────────────┐
│  Service Worker   │  startRecording(tabId)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  recorder.js      │  Injected into target tab
│  (Content Script) │  Listens for DOM events
└─────────┬─────────┘
          │ (User interacts with page)
          ▼
┌───────────────────┐
│  Event Captured   │  click, input, submit, keypress
│  - Selector gen   │  Multiple selector strategies
│  - XPath gen      │  Fallback options
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Service Worker   │  handleRecordedAction()
│                   │  Stores in workflowState
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Side Panel UI    │  Shows recording indicator, action count
└─────────┬─────────┘
          │ (User clicks "Stop")
          ▼
┌───────────────────┐
│  chrome.storage   │  Workflow saved with site association
└───────────────────┘
```

### 3. Workflow Execution Flow
```
User triggers workflow (button click, keyboard shortcut)
          │
          ▼
┌───────────────────┐
│  Service Worker   │  executeWorkflow(workflowId, variables)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Find/Open Tab    │  Find existing tab or create new
│  for target site  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  executor.js      │  Injected into target tab
│  (Content Script) │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  For each action: │
│  1. findElement() │  Try primary selector, fallbacks, XPath
│  2. scrollIntoView│  Ensure element visible
│  3. Execute       │  click/input/select/keypress
│  4. Wait          │  Configurable delay
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Report Progress  │  leadtapp/executor/progress messages
│  to Service Worker│
└───────────────────┘
```

## Component Details

### Service Worker (service-worker.js)
The central hub that:
- Routes messages between UI and content scripts
- Manages extension lifecycle
- Handles keyboard shortcuts
- Coordinates between managers

### Workflow Manager (workflow-manager.js)
Core workflow engine:

**State Structure:**
```javascript
workflowState = {
    sites: [],           // Array of Site objects
    chains: [],          // Array of Chain objects (cross-tab workflows)
    recording: null,     // Current recording session
    execution: null,     // Current execution state
    tabMapping: Map,     // tabId -> siteId mapping
    pollingIntervals: Map // siteId -> polling interval
}
```

**Site Object:**
```javascript
{
    id: string,
    name: string,          // e.g., "Command", "Gmail"
    domain: string,        // e.g., "kwcommand.com"
    icon: string,          // Emoji or icon reference
    color: string,         // Brand color
    workflows: Workflow[], // Workflows for this site
    tabId: number | null,  // Current tab if open
    lastUrl: string,
    liveState: object,     // Polled state data
    isPolling: boolean
}
```

**Workflow Object:**
```javascript
{
    id: string,
    name: string,
    description: string,
    siteId: string,
    url: string,           // Start URL
    urlPattern: string,    // Path pattern
    actions: Action[],     // Recorded steps
    variables: string[],   // Variable names
    variableDefaults: {},  // Default values
    icon: string,
    color: string,
    shortcut: string | null,
    createdAt: number,
    updatedAt: number,
    executionCount: number,
    lastExecuted: number | null,
    isChainable: boolean
}
```

**Action Object:**
```javascript
{
    id: string,
    type: 'click' | 'input' | 'select' | 'keypress',
    selector: string,
    selectorFallbacks: string[],
    xpath: string,
    tagName: string,
    label: string,         // Human-readable description
    value?: string,        // For input/select actions
    isVariable?: boolean,
    variableName?: string,
    variableDefault?: string,
    delay?: number
}
```

### LLM Client (llm-client.js)
Multi-provider AI integration:

**Supported Providers:**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude 3)
- Local (Ollama, LM Studio)
- MCP (Model Context Protocol servers)

**Key Methods:**
- `chat(message, options)` - Send message, get response
- `analyzePageForWorkflow(context)` - Suggest automations
- `describeWorkflow(workflow)` - Generate documentation
- `suggestChainConnections(workflows)` - Recommend chains

### Speech Handler (speech-handler.js)
Real-time conversation analysis:

**Modes:**
- **Coaching Mode** - Provides real-time script suggestions
- **Logging Mode** - Detects and logs workflow-relevant actions

**Action Detection Patterns:**
- Appointment scheduling
- Callback requests
- Interest/disinterest signals
- Objection handling
- Contact information extraction

### Content Scripts

**recorder.js:**
- Injected on-demand when recording starts
- Captures click, input, submit, keypress events
- Generates multiple selector strategies
- Sends actions to service worker

**executor.js:**
- Injected on-demand when executing workflows
- Finds elements with fallback strategies
- Simulates realistic user interactions
- Reports progress back to service worker

## Storage Schema

### chrome.storage.local

```javascript
{
    // Workflow Data
    sites: Site[],
    chains: Chain[],

    // Lead/Feedback Data
    feedbackHistory: StoredFeedback[],
    currentLeadIndex: number,
    sessionStats: SessionStats,

    // LLM Configuration
    llmConfig: {
        provider: string,
        apiKey: string,       // Encrypted/stored securely
        baseUrl: string,
        model: string,
        maxTokens: number,
        temperature: number,
        systemPrompt: string
    },
    llmHistory: Message[],

    // User Preferences
    panelMode: 'sidepanel' | 'floating' | 'topbar',
    exportConfig: ExportConfig,
    customFields: CustomField[]
}
```

## Message Protocol

All inter-component communication uses Chrome's message passing with a consistent format:

```javascript
{
    type: 'leadtapp/<component>/<action>',
    // Additional payload...
}
```

**Example Types:**
- `leadtapp/recorder/start`
- `leadtapp/recorder/stop`
- `leadtapp/recorder/action`
- `leadtapp/executor/workflow`
- `leadtapp/executor/progress`
- `leadtapp/llm/chat`
- `leadtapp/speech/transcript`

## Security Considerations

1. **API Keys** - Stored in chrome.storage.local (not synced)
2. **Permissions** - Minimal required permissions in manifest
3. **Content Scripts** - Injected only when needed
4. **External APIs** - All calls use HTTPS
5. **User Data** - Stays local unless explicitly exported

## Performance Considerations

1. **Lazy Loading** - Content scripts injected on-demand
2. **Polling** - Configurable intervals for live state
3. **Storage** - Debounced writes, batch updates
4. **LLM Calls** - Conversation history trimmed at 100 messages
5. **Recording** - Event throttling to prevent excessive captures

## Extension Lifecycle

```
Install/Update
      │
      ▼
┌─────────────────┐
│ Service Worker  │  Initializes managers
│ onInstalled     │  Sets up default state
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Load stored     │  Restores previous session
│ state           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Ready for       │  Responds to messages,
│ user interaction│  keyboard shortcuts
└─────────────────┘
```
