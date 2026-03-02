/**
 * LeadTapp - Type Definitions & Data Models
 *
 * Core data structures for the command dashboard system.
 */

// =============================================================================
// Workflow Types
// =============================================================================

/**
 * @typedef {Object} RecordedAction
 * @property {string} id - Unique action ID
 * @property {string} type - Action type: 'click' | 'input' | 'select' | 'scroll' | 'navigate' | 'keypress'
 * @property {string} selector - CSS selector for the target element
 * @property {string[]} selectorFallbacks - Alternative selectors if primary fails
 * @property {string} xpath - XPath as backup selector
 * @property {string} label - Human-readable label (auto-generated or user-defined)
 * @property {string} [value] - Input value (for input/select actions)
 * @property {boolean} isVariable - Whether this is a parameterized input
 * @property {string} [variableName] - Name of the variable if parameterized
 * @property {string} [variableDefault] - Default value for the variable
 * @property {Object} elementSnapshot - Captured element data
 * @property {string} elementSnapshot.tagName
 * @property {string} elementSnapshot.innerText
 * @property {string} elementSnapshot.className
 * @property {Object} elementSnapshot.rect - Bounding rect
 * @property {string} [elementSnapshot.thumbnail] - Base64 thumbnail of element
 * @property {number} timestamp - When action was recorded
 * @property {number} [delay] - Delay before executing (ms)
 */

/**
 * @typedef {Object} Workflow
 * @property {string} id - Unique workflow ID
 * @property {string} name - User-defined workflow name
 * @property {string} description - Optional description
 * @property {string} siteId - Parent site ID
 * @property {string} url - URL where workflow starts (for tab restoration)
 * @property {string} urlPattern - URL pattern for matching (regex)
 * @property {RecordedAction[]} actions - Sequence of actions
 * @property {string[]} variables - List of variable names used
 * @property {Object} variableDefaults - Default values for variables
 * @property {string} icon - Emoji or icon for the workflow
 * @property {string} color - Color for the action button
 * @property {string} shortcut - Optional keyboard shortcut
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} executionCount - Times executed
 * @property {number} lastExecuted - Last execution timestamp
 * @property {boolean} isChainable - Can be part of cross-tab chain
 */

/**
 * @typedef {Object} Site
 * @property {string} id - Unique site ID
 * @property {string} name - Site display name (e.g., "Slack", "Gmail")
 * @property {string} domain - Domain pattern (e.g., "slack.com")
 * @property {string} icon - Favicon or emoji
 * @property {string} color - Brand color
 * @property {Workflow[]} workflows - Workflows for this site
 * @property {number} tabId - Current tab ID if open (null if closed)
 * @property {string} lastUrl - Last known URL
 * @property {Object} liveState - Current polled state
 * @property {boolean} isPolling - Whether live state polling is active
 */

/**
 * @typedef {Object} WorkflowChain
 * @property {string} id - Chain ID
 * @property {string} name - Chain name
 * @property {string} description
 * @property {ChainStep[]} steps - Ordered steps
 * @property {Object} sharedVariables - Variables passed between steps
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ChainStep
 * @property {string} workflowId - Workflow to execute
 * @property {string} siteId - Site context
 * @property {Object} variableMapping - Map workflow vars to chain vars
 * @property {Object} outputCapture - What to capture from this step
 * @property {number} [waitAfter] - Wait time after step (ms)
 * @property {Object} [condition] - Conditional execution
 */

// =============================================================================
// Recording State
// =============================================================================

/**
 * @typedef {Object} RecordingSession
 * @property {boolean} isRecording
 * @property {string} siteId - Site being recorded
 * @property {string} workflowId - Workflow being built
 * @property {number} tabId - Tab being recorded
 * @property {RecordedAction[]} actions - Actions captured so far
 * @property {number} startedAt
 * @property {boolean} isCrossTab - Recording across tabs
 */

// =============================================================================
// Execution State
// =============================================================================

/**
 * @typedef {Object} ExecutionContext
 * @property {string} workflowId
 * @property {string} [chainId]
 * @property {number} currentStep
 * @property {Object} variables - Current variable values
 * @property {Object} capturedOutputs - Outputs captured during execution
 * @property {'running' | 'paused' | 'completed' | 'failed'} status
 * @property {string} [error]
 * @property {number} startedAt
 */

// =============================================================================
// Dashboard State
// =============================================================================

/**
 * @typedef {Object} DashboardState
 * @property {'dashboard' | 'leads' | 'recording' | 'settings'} activeTab
 * @property {string} [activeSiteId] - Currently expanded site
 * @property {string} [activeWorkflowId] - Currently selected workflow
 * @property {RecordingSession} [recording] - Active recording session
 * @property {ExecutionContext} [execution] - Active execution
 * @property {Object} siteStates - Live state per site
 */

// =============================================================================
// Lead Types (existing)
// =============================================================================

/**
 * @typedef {Object} Lead
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 * @property {string} [email]
 * @property {string} [address]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [zip]
 * @property {string} source
 * @property {string} leadType
 * @property {number} [score]
 * @property {string} [tier]
 * @property {string} [propertyType]
 * @property {number} [estimatedValue]
 * @property {string} assignedAt
 * @property {string} [bestCallTime]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} Feedback
 * @property {string} leadId
 * @property {string} outcome
 * @property {string} notes
 * @property {string} [followUpDate]
 * @property {string} timestamp
 */

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(prefix = '') {
    return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function createEmptyWorkflow(siteId, name) {
    return {
        id: generateId('wf-'),
        name,
        description: '',
        siteId,
        url: '',
        urlPattern: '',
        actions: [],
        variables: [],
        variableDefaults: {},
        icon: '⚡',
        color: '#4A90D9',
        shortcut: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        executionCount: 0,
        lastExecuted: null,
        isChainable: true
    };
}

function createEmptySite(domain, name) {
    return {
        id: generateId('site-'),
        name,
        domain,
        icon: '🌐',
        color: '#666',
        workflows: [],
        tabId: null,
        lastUrl: null,
        liveState: {},
        isPolling: false
    };
}

// Export for use in other modules
if (typeof module !== 'undefined') {
    module.exports = { generateId, createEmptyWorkflow, createEmptySite };
}
