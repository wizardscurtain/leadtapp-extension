/**
 * LeadTapp - Workflow Manager
 *
 * Handles workflow CRUD, recording sessions, and execution orchestration.
 */

// =============================================================================
// State
// =============================================================================

const workflowState = {
    sites: [],
    chains: [],
    recording: null,
    execution: null,
    tabMapping: new Map(), // tabId -> siteId
    pollingIntervals: new Map() // siteId -> intervalId
};

// Known site patterns for auto-detection
const KNOWN_SITES = {
    'slack.com': { name: 'Slack', icon: '💬', color: '#4A154B' },
    'mail.google.com': { name: 'Gmail', icon: '📧', color: '#EA4335' },
    'calendar.google.com': { name: 'Calendar', icon: '📅', color: '#4285F4' },
    'docs.google.com': { name: 'Docs', icon: '📄', color: '#4285F4' },
    'jira': { name: 'Jira', icon: '📋', color: '#0052CC' },
    'github.com': { name: 'GitHub', icon: '🐙', color: '#24292E' },
    'notion.so': { name: 'Notion', icon: '📓', color: '#000000' },
    'trello.com': { name: 'Trello', icon: '📌', color: '#0079BF' },
    'salesforce.com': { name: 'Salesforce', icon: '☁️', color: '#00A1E0' },
    'hubspot.com': { name: 'HubSpot', icon: '🧡', color: '#FF7A59' },
    'console.command.kw.com': { name: 'Command', icon: '🏠', color: '#B40101' },
    'kwcommand.com': { name: 'Command', icon: '🏠', color: '#B40101' },
    'kw.com': { name: 'KW', icon: '🏠', color: '#B40101' },
    'mojo': { name: 'Mojo Dialer', icon: '📞', color: '#00B894' },
    'linkedin.com': { name: 'LinkedIn', icon: '💼', color: '#0077B5' },
    'facebook.com': { name: 'Facebook', icon: '👥', color: '#1877F2' },
    'zillow.com': { name: 'Zillow', icon: '🏘️', color: '#006AFF' },
    'realtor.com': { name: 'Realtor', icon: '🏡', color: '#D92228' },
    'redfin.com': { name: 'Redfin', icon: '🔴', color: '#A02021' }
};

// =============================================================================
// Default KW Command Workflows
// =============================================================================

// Real selectors extracted from KW Command DevEyes analysis:
// Navigation: data-testid="nav-item-contacts", data-testid="nav-item-tasks"
// Buttons: data-testid="kw-menu-button", data-testid="account-menu-button"
// Modals: data-testid="*-modal", data-testid="*-modal-content"
// Text inputs: data-testid="TextArea-component"
// NOTE: Contact detail page selectors need user recording to capture

const DEFAULT_KW_COMMAND_SITE = {
    id: 'site-kwcommand-default',
    name: 'Command',
    domain: 'console.command.kw.com',  // Real domain from DevEyes
    icon: '🏠',
    color: '#B40101',
    workflows: [
        {
            id: 'wf-kw-log-connected',
            name: 'Log Call - Connected',
            description: 'Mark lead as contacted with successful connection',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            // API-first execution: uses kwCommandAPI.logCall() instead of DOM automation
            apiAction: {
                type: 'log_call',
                params: {
                    outcome: 'connected',
                    notesVariable: 'notes'
                }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="log-activity"], .log-activity-btn, button[aria-label*="Log"], .activity-log-trigger',
                    selectorFallbacks: ['.btn-log-call', '[class*="logActivity"]', 'button:contains("Log")'],
                    xpath: '//button[contains(text(), "Log") or contains(@class, "log")]',
                    tagName: 'BUTTON',
                    label: 'Open activity log',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'click',
                    selector: '[data-outcome="connected"], .outcome-connected, input[value="connected"]',
                    selectorFallbacks: ['[class*="connected"]', 'label:contains("Connected")'],
                    xpath: '//input[@value="connected"] | //label[contains(text(), "Connected")]',
                    tagName: 'INPUT',
                    label: 'Select Connected outcome',
                    delay: 200
                },
                {
                    id: 'act-3',
                    type: 'input',
                    selector: '[data-testid="call-notes"], textarea[name="notes"], .notes-input, #call-notes',
                    selectorFallbacks: ['textarea[placeholder*="notes"]', '.activity-notes'],
                    xpath: '//textarea[contains(@placeholder, "note") or contains(@name, "note")]',
                    tagName: 'TEXTAREA',
                    label: 'Enter call notes',
                    value: '',
                    isVariable: true,
                    variableName: 'notes',
                    variableDefault: '',
                    delay: 100
                },
                {
                    id: 'act-4',
                    type: 'click',
                    selector: '[data-testid="save-activity"], button[type="submit"], .save-btn, .btn-primary:contains("Save")',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save activity',
                    delay: 500
                }
            ],
            variables: ['notes'],
            variableDefaults: { notes: '' },
            icon: '✅',
            color: '#22C55E',
            shortcut: 'Alt+1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-log-voicemail',
            name: 'Log Call - Voicemail',
            description: 'Log that a voicemail was left for the lead',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            apiAction: {
                type: 'log_call',
                params: { outcome: 'voicemail' }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="log-activity"], .log-activity-btn, button[aria-label*="Log"]',
                    selectorFallbacks: ['.btn-log-call', '[class*="logActivity"]'],
                    xpath: '//button[contains(text(), "Log") or contains(@class, "log")]',
                    tagName: 'BUTTON',
                    label: 'Open activity log',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'click',
                    selector: '[data-outcome="voicemail"], .outcome-voicemail, input[value="voicemail"]',
                    selectorFallbacks: ['[class*="voicemail"]', 'label:contains("Voicemail")'],
                    xpath: '//input[@value="voicemail"] | //label[contains(text(), "Voicemail")]',
                    tagName: 'INPUT',
                    label: 'Select Voicemail outcome',
                    delay: 200
                },
                {
                    id: 'act-3',
                    type: 'click',
                    selector: '[data-testid="save-activity"], button[type="submit"], .save-btn',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save activity',
                    delay: 500
                }
            ],
            variables: [],
            variableDefaults: {},
            icon: '📱',
            color: '#F59E0B',
            shortcut: 'Alt+2',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-log-no-answer',
            name: 'Log Call - No Answer',
            description: 'Log an unanswered call attempt',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            apiAction: {
                type: 'log_call',
                params: { outcome: 'no_answer' }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="log-activity"], .log-activity-btn, button[aria-label*="Log"]',
                    selectorFallbacks: ['.btn-log-call', '[class*="logActivity"]'],
                    xpath: '//button[contains(text(), "Log") or contains(@class, "log")]',
                    tagName: 'BUTTON',
                    label: 'Open activity log',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'click',
                    selector: '[data-outcome="no-answer"], .outcome-no-answer, input[value="no_answer"]',
                    selectorFallbacks: ['[class*="noAnswer"]', 'label:contains("No Answer")'],
                    xpath: '//input[contains(@value, "no")] | //label[contains(text(), "No Answer")]',
                    tagName: 'INPUT',
                    label: 'Select No Answer outcome',
                    delay: 200
                },
                {
                    id: 'act-3',
                    type: 'click',
                    selector: '[data-testid="save-activity"], button[type="submit"], .save-btn',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save activity',
                    delay: 500
                }
            ],
            variables: [],
            variableDefaults: {},
            icon: '📵',
            color: '#EF4444',
            shortcut: 'Alt+3',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-schedule-callback',
            name: 'Schedule Callback',
            description: 'Set a follow-up callback date and time',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            apiAction: {
                type: 'create_task',
                params: {
                    taskType: 'CALL',
                    name: 'Callback',
                    dateVariable: 'callbackDate',
                    timeVariable: 'callbackTime'
                }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="schedule-task"], .schedule-btn, button[aria-label*="Schedule"], .add-task-btn',
                    selectorFallbacks: ['[class*="schedule"]', 'button:contains("Task")'],
                    xpath: '//button[contains(text(), "Schedule") or contains(text(), "Task")]',
                    tagName: 'BUTTON',
                    label: 'Open scheduler',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'click',
                    selector: '[data-task-type="call"], .task-type-call, input[value="call"]',
                    selectorFallbacks: ['[class*="callTask"]', 'label:contains("Call")'],
                    xpath: '//input[@value="call"] | //label[contains(text(), "Call")]',
                    tagName: 'INPUT',
                    label: 'Select Call task type',
                    delay: 200
                },
                {
                    id: 'act-3',
                    type: 'input',
                    selector: '[data-testid="task-date"], input[type="date"], .date-picker input, #task-date',
                    selectorFallbacks: ['input[name*="date"]', '[class*="datePicker"] input'],
                    xpath: '//input[@type="date" or contains(@name, "date")]',
                    tagName: 'INPUT',
                    label: 'Set callback date',
                    value: '',
                    isVariable: true,
                    variableName: 'callbackDate',
                    variableDefault: '',
                    delay: 100
                },
                {
                    id: 'act-4',
                    type: 'input',
                    selector: '[data-testid="task-time"], input[type="time"], .time-picker input, #task-time',
                    selectorFallbacks: ['input[name*="time"]', '[class*="timePicker"] input'],
                    xpath: '//input[@type="time" or contains(@name, "time")]',
                    tagName: 'INPUT',
                    label: 'Set callback time',
                    value: '',
                    isVariable: true,
                    variableName: 'callbackTime',
                    variableDefault: '09:00',
                    delay: 100
                },
                {
                    id: 'act-5',
                    type: 'click',
                    selector: '[data-testid="save-task"], button[type="submit"], .save-btn',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save callback',
                    delay: 500
                }
            ],
            variables: ['callbackDate', 'callbackTime'],
            variableDefaults: { callbackDate: '', callbackTime: '09:00' },
            icon: '📅',
            color: '#3B82F6',
            shortcut: 'Alt+4',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-set-appointment',
            name: 'Set Appointment',
            description: 'Create an appointment with the lead',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            apiAction: {
                type: 'create_appointment',
                params: {
                    titleVariable: 'appointmentTitle',
                    dateVariable: 'appointmentDate',
                    timeVariable: 'appointmentTime',
                    locationVariable: 'appointmentLocation'
                }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="add-appointment"], .appointment-btn, button[aria-label*="Appointment"]',
                    selectorFallbacks: ['[class*="appointment"]', 'button:contains("Appointment")'],
                    xpath: '//button[contains(text(), "Appointment")]',
                    tagName: 'BUTTON',
                    label: 'Open appointment form',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'input',
                    selector: '[data-testid="appt-title"], input[name="title"], #appointment-title',
                    selectorFallbacks: ['input[placeholder*="title"]', '[class*="appointmentTitle"]'],
                    xpath: '//input[contains(@name, "title") or contains(@placeholder, "title")]',
                    tagName: 'INPUT',
                    label: 'Enter appointment title',
                    value: '',
                    isVariable: true,
                    variableName: 'appointmentTitle',
                    variableDefault: 'Listing Appointment',
                    delay: 100
                },
                {
                    id: 'act-3',
                    type: 'input',
                    selector: '[data-testid="appt-date"], input[type="date"], .date-picker input',
                    selectorFallbacks: ['input[name*="date"]', '[class*="datePicker"] input'],
                    xpath: '//input[@type="date" or contains(@name, "date")]',
                    tagName: 'INPUT',
                    label: 'Set appointment date',
                    value: '',
                    isVariable: true,
                    variableName: 'appointmentDate',
                    variableDefault: '',
                    delay: 100
                },
                {
                    id: 'act-4',
                    type: 'input',
                    selector: '[data-testid="appt-time"], input[type="time"], .time-picker input',
                    selectorFallbacks: ['input[name*="time"]', '[class*="timePicker"] input'],
                    xpath: '//input[@type="time" or contains(@name, "time")]',
                    tagName: 'INPUT',
                    label: 'Set appointment time',
                    value: '',
                    isVariable: true,
                    variableName: 'appointmentTime',
                    variableDefault: '10:00',
                    delay: 100
                },
                {
                    id: 'act-5',
                    type: 'input',
                    selector: '[data-testid="appt-location"], input[name="location"], #appointment-location',
                    selectorFallbacks: ['input[placeholder*="location"]', '[class*="location"]'],
                    xpath: '//input[contains(@name, "location") or contains(@placeholder, "location")]',
                    tagName: 'INPUT',
                    label: 'Enter location',
                    value: '',
                    isVariable: true,
                    variableName: 'appointmentLocation',
                    variableDefault: '',
                    delay: 100
                },
                {
                    id: 'act-6',
                    type: 'click',
                    selector: '[data-testid="save-appointment"], button[type="submit"], .save-btn',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save appointment',
                    delay: 500
                }
            ],
            variables: ['appointmentTitle', 'appointmentDate', 'appointmentTime', 'appointmentLocation'],
            variableDefaults: {
                appointmentTitle: 'Listing Appointment',
                appointmentDate: '',
                appointmentTime: '10:00',
                appointmentLocation: ''
            },
            icon: '🤝',
            color: '#8B5CF6',
            shortcut: 'Alt+5',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-add-note',
            name: 'Add Note',
            description: 'Add a note to the lead record',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            apiAction: {
                type: 'create_note',
                params: {
                    contentVariable: 'noteContent'
                }
            },
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="add-note"], .add-note-btn, button[aria-label*="Note"]',
                    selectorFallbacks: ['[class*="addNote"]', 'button:contains("Note")'],
                    xpath: '//button[contains(text(), "Note")]',
                    tagName: 'BUTTON',
                    label: 'Open note form',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'input',
                    selector: '[data-testid="note-content"], textarea[name="note"], .note-textarea, #note-content',
                    selectorFallbacks: ['textarea[placeholder*="note"]', '.note-input'],
                    xpath: '//textarea[contains(@placeholder, "note") or contains(@name, "note")]',
                    tagName: 'TEXTAREA',
                    label: 'Enter note content',
                    value: '',
                    isVariable: true,
                    variableName: 'noteContent',
                    variableDefault: '',
                    delay: 100
                },
                {
                    id: 'act-3',
                    type: 'click',
                    selector: '[data-testid="save-note"], button[type="submit"], .save-btn',
                    selectorFallbacks: ['button:contains("Save")', '[class*="submit"]'],
                    xpath: '//button[contains(text(), "Save") or @type="submit"]',
                    tagName: 'BUTTON',
                    label: 'Save note',
                    delay: 500
                }
            ],
            variables: ['noteContent'],
            variableDefaults: { noteContent: '' },
            icon: '📝',
            color: '#6366F1',
            shortcut: 'Alt+6',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        },
        {
            id: 'wf-kw-mark-not-interested',
            name: 'Mark Not Interested',
            description: 'Update lead status to not interested',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="lead-status"], .status-dropdown, button[aria-label*="Status"]',
                    selectorFallbacks: ['[class*="statusSelect"]', '.lead-status-btn'],
                    xpath: '//button[contains(text(), "Status") or contains(@class, "status")]',
                    tagName: 'BUTTON',
                    label: 'Open status dropdown',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'click',
                    selector: '[data-status="not-interested"], .status-not-interested, [data-value="not_interested"]',
                    selectorFallbacks: ['[class*="notInterested"]', 'li:contains("Not Interested")'],
                    xpath: '//li[contains(text(), "Not Interested")] | //option[contains(text(), "Not Interested")]',
                    tagName: 'LI',
                    label: 'Select Not Interested',
                    delay: 200
                },
                {
                    id: 'act-3',
                    type: 'click',
                    selector: '[data-testid="confirm-status"], button[type="submit"], .confirm-btn',
                    selectorFallbacks: ['button:contains("Confirm")', 'button:contains("Save")'],
                    xpath: '//button[contains(text(), "Confirm") or contains(text(), "Save")]',
                    tagName: 'BUTTON',
                    label: 'Confirm status change',
                    delay: 500
                }
            ],
            variables: [],
            variableDefaults: {},
            icon: '🚫',
            color: '#DC2626',
            shortcut: 'Alt+7',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: false
        },
        {
            id: 'wf-kw-send-email',
            name: 'Send Follow-up Email',
            description: 'Open email composer with lead email pre-filled',
            siteId: 'site-kwcommand-default',
            url: 'https://console.command.kw.com',
            urlPattern: '/contacts/*',
            actions: [
                {
                    id: 'act-1',
                    type: 'click',
                    selector: '[data-testid="send-email"], .email-btn, button[aria-label*="Email"], a[href^="mailto"]',
                    selectorFallbacks: ['[class*="sendEmail"]', 'button:contains("Email")'],
                    xpath: '//button[contains(text(), "Email")] | //a[starts-with(@href, "mailto")]',
                    tagName: 'BUTTON',
                    label: 'Open email composer',
                    delay: 300
                },
                {
                    id: 'act-2',
                    type: 'input',
                    selector: '[data-testid="email-subject"], input[name="subject"], #email-subject',
                    selectorFallbacks: ['input[placeholder*="subject"]', '[class*="emailSubject"]'],
                    xpath: '//input[contains(@name, "subject") or contains(@placeholder, "subject")]',
                    tagName: 'INPUT',
                    label: 'Enter email subject',
                    value: '',
                    isVariable: true,
                    variableName: 'emailSubject',
                    variableDefault: 'Following up on our conversation',
                    delay: 100
                },
                {
                    id: 'act-3',
                    type: 'input',
                    selector: '[data-testid="email-body"], textarea[name="body"], .email-body, #email-content',
                    selectorFallbacks: ['textarea[placeholder*="message"]', '[class*="emailBody"]'],
                    xpath: '//textarea[contains(@name, "body") or contains(@class, "body")]',
                    tagName: 'TEXTAREA',
                    label: 'Enter email body',
                    value: '',
                    isVariable: true,
                    variableName: 'emailBody',
                    variableDefault: '',
                    delay: 100
                }
            ],
            variables: ['emailSubject', 'emailBody'],
            variableDefaults: {
                emailSubject: 'Following up on our conversation',
                emailBody: ''
            },
            icon: '✉️',
            color: '#0EA5E9',
            shortcut: 'Alt+8',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        }
    ],
    tabId: null,
    lastUrl: 'https://kwcommand.com',
    liveState: {},
    isPolling: false
};

// =============================================================================
// Initialization
// =============================================================================

async function initializeWorkflows() {
    const saved = await chrome.storage.local.get(['sites', 'chains', 'defaultsInitialized']);

    if (saved.sites) {
        workflowState.sites = saved.sites;
    }
    if (saved.chains) {
        workflowState.chains = saved.chains;
    }

    // Seed default KW Command workflows on first run
    if (!saved.defaultsInitialized) {
        const hasKwCommand = workflowState.sites.some(s => s.domain === 'kwcommand.com');
        if (!hasKwCommand) {
            workflowState.sites.push({ ...DEFAULT_KW_COMMAND_SITE });
            console.log('[Workflow Manager] Added default KW Command workflows');
        }
        await chrome.storage.local.set({ defaultsInitialized: true });
        await saveWorkflows();
    }

    // Update tab IDs for existing sites
    await refreshTabMapping();

    console.log('[Workflow Manager] Initialized with', workflowState.sites.length, 'sites');
}

async function saveWorkflows() {
    await chrome.storage.local.set({
        sites: workflowState.sites,
        chains: workflowState.chains
    });
}

/**
 * Restore default KW Command workflows
 * @param {boolean} replaceExisting - If true, replaces existing KW Command site entirely
 * @returns {Object} Result with restored workflow count
 */
async function restoreDefaultWorkflows(replaceExisting = false) {
    const existingIndex = workflowState.sites.findIndex(s => s.domain === 'kwcommand.com');

    if (existingIndex !== -1) {
        if (replaceExisting) {
            // Replace entire site with defaults
            workflowState.sites[existingIndex] = {
                ...DEFAULT_KW_COMMAND_SITE,
                // Preserve any custom tab state
                tabId: workflowState.sites[existingIndex].tabId,
                lastUrl: workflowState.sites[existingIndex].lastUrl
            };
            console.log('[Workflow Manager] Replaced KW Command site with defaults');
        } else {
            // Merge: add any missing default workflows
            const existingSite = workflowState.sites[existingIndex];
            const existingIds = new Set(existingSite.workflows.map(w => w.id));

            for (const defaultWorkflow of DEFAULT_KW_COMMAND_SITE.workflows) {
                if (!existingIds.has(defaultWorkflow.id)) {
                    existingSite.workflows.push({ ...defaultWorkflow });
                }
            }
            console.log('[Workflow Manager] Merged missing default workflows');
        }
    } else {
        // No existing site - add defaults
        workflowState.sites.push({ ...DEFAULT_KW_COMMAND_SITE });
        console.log('[Workflow Manager] Added default KW Command site');
    }

    await saveWorkflows();

    const kwSite = workflowState.sites.find(s => s.domain === 'kwcommand.com');
    return {
        success: true,
        workflowCount: kwSite?.workflows.length || 0,
        message: replaceExisting ? 'Defaults restored (replaced existing)' : 'Defaults merged with existing'
    };
}

// =============================================================================
// Site Management
// =============================================================================

function detectSiteFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace('www.', '');

        for (const [pattern, info] of Object.entries(KNOWN_SITES)) {
            if (domain.includes(pattern)) {
                return { domain, ...info };
            }
        }

        // Unknown site - generate basic info
        return {
            domain,
            name: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
            icon: '🌐',
            color: '#666666'
        };
    } catch (e) {
        return null;
    }
}

function getOrCreateSite(url) {
    const detected = detectSiteFromUrl(url);
    if (!detected) return null;

    let site = workflowState.sites.find(s => s.domain === detected.domain);

    if (!site) {
        site = {
            id: `site-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
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

async function refreshTabMapping() {
    const tabs = await chrome.tabs.query({});

    workflowState.tabMapping.clear();

    for (const tab of tabs) {
        const site = workflowState.sites.find(s =>
            tab.url && tab.url.includes(s.domain)
        );

        if (site) {
            site.tabId = tab.id;
            site.lastUrl = tab.url;
            workflowState.tabMapping.set(tab.id, site.id);
        }
    }
}

// =============================================================================
// Recording Management
// =============================================================================

async function startRecording(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const site = getOrCreateSite(tab.url);

    if (!site) {
        return { success: false, error: 'Cannot record on this page' };
    }

    // Create new workflow
    const workflow = {
        id: `wf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
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

    workflowState.recording = {
        isRecording: true,
        siteId: site.id,
        workflowId: workflow.id,
        tabId,
        actions: [],
        startedAt: Date.now(),
        isCrossTab: false
    };

    // Inject recorder content script
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/recorder.js']
    });

    // Start recording in content script
    await chrome.tabs.sendMessage(tabId, { type: 'leadtapp/recorder/start' });

    return {
        success: true,
        workflowId: workflow.id,
        siteId: site.id,
        siteName: site.name
    };
}

async function stopRecording() {
    if (!workflowState.recording) {
        return { success: false, error: 'No active recording' };
    }

    const { tabId, workflowId, siteId, actions } = workflowState.recording;

    // Stop recording in content script
    let recordedActions = actions;
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'leadtapp/recorder/stop' });
        if (response?.actions) {
            recordedActions = response.actions;
        }
    } catch (e) {
        console.log('[Workflow Manager] Could not stop recorder in tab:', e);
    }

    // Update workflow with recorded actions
    const site = workflowState.sites.find(s => s.id === siteId);
    if (site) {
        const workflow = site.workflows.find(w => w.id === workflowId) || {
            id: workflowId,
            name: 'New Workflow',
            description: '',
            siteId,
            url: (await chrome.tabs.get(tabId).catch(() => ({}))).url || '',
            urlPattern: '',
            actions: recordedActions,
            variables: [],
            variableDefaults: {},
            icon: '⚡',
            color: site.color,
            shortcut: null,
            createdAt: workflowState.recording.startedAt,
            updatedAt: Date.now(),
            executionCount: 0,
            lastExecuted: null,
            isChainable: true
        };

        workflow.actions = recordedActions;
        workflow.updatedAt = Date.now();

        // Auto-generate name from first action
        if (recordedActions.length > 0) {
            workflow.name = recordedActions[0].label || 'New Workflow';
        }

        if (!site.workflows.find(w => w.id === workflowId)) {
            site.workflows.push(workflow);
        }

        await saveWorkflows();
    }

    const result = {
        success: true,
        workflowId,
        actionCount: recordedActions.length,
        actions: recordedActions
    };

    workflowState.recording = null;

    return result;
}

function handleRecordedAction(action) {
    if (!workflowState.recording) return;

    workflowState.recording.actions.push(action);

    // Broadcast to UI
    chrome.runtime.sendMessage({
        type: 'leadtapp/recording/action',
        action,
        count: workflowState.recording.actions.length
    }).catch(() => { }); // Ignore if no listeners
}

// =============================================================================
// Workflow Execution
// =============================================================================

async function executeWorkflow(workflowId, variables = {}) {
    // Find workflow
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

    // ==========================================================================
    // API-First Execution: Try API if available before falling back to DOM
    // ==========================================================================
    if (workflow.apiAction && typeof kwCommandAPI !== 'undefined') {
        const apiReady = kwCommandAPI.isReady();
        console.log('[Workflow Manager] API available, ready:', apiReady, 'action:', workflow.apiAction.type);

        if (apiReady) {
            try {
                // Resolve variable references in params
                const resolvedParams = {};
                for (const [key, value] of Object.entries(workflow.apiAction.params || {})) {
                    if (key.endsWith('Variable')) {
                        // This is a variable reference - get from variables or defaults
                        const varName = value;
                        resolvedParams[key.replace('Variable', '')] =
                            variables[varName] ?? workflow.variableDefaults?.[varName] ?? '';
                    } else {
                        resolvedParams[key] = value;
                    }
                }

                // Merge in any direct variables
                Object.assign(resolvedParams, variables);

                console.log('[Workflow Manager] Executing via API:', workflow.apiAction.type, resolvedParams);

                const apiResult = await kwCommandAPI.executeWorkflowAction(
                    workflow.apiAction.type,
                    resolvedParams
                );

                if (apiResult.success) {
                    // Update workflow stats
                    workflow.executionCount++;
                    workflow.lastExecuted = Date.now();
                    await saveWorkflows();

                    return {
                        success: true,
                        method: 'api',
                        result: apiResult,
                        workflowId,
                        workflowName: workflow.name
                    };
                } else {
                    console.log('[Workflow Manager] API execution returned error, falling back to DOM:', apiResult.error);
                }
            } catch (apiError) {
                console.log('[Workflow Manager] API execution failed, falling back to DOM:', apiError.message);
            }
        } else {
            console.log('[Workflow Manager] API not ready (no auth token), using DOM automation');
        }
    }

    // ==========================================================================
    // DOM Automation Fallback
    // ==========================================================================

    // Find or open the target tab
    let tabId = site.tabId;
    let needsNavigation = false;

    if (tabId) {
        // Check if tab still exists and is on correct domain
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.url.includes(site.domain)) {
                needsNavigation = true;
            }
        } catch (e) {
            tabId = null;
        }
    }

    if (!tabId) {
        // Open new tab
        const tab = await chrome.tabs.create({ url: workflow.url, active: false });
        tabId = tab.id;
        site.tabId = tabId;

        // Wait for page load
        await waitForTabLoad(tabId);
    } else if (needsNavigation) {
        await chrome.tabs.update(tabId, { url: workflow.url });
        await waitForTabLoad(tabId);
    }

    // Inject executor content script
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/executor.js']
    });

    // Wait for executor to be ready
    await new Promise(resolve => setTimeout(resolve, 200));

    // Set execution state
    workflowState.execution = {
        workflowId,
        chainId: null,
        currentStep: 0,
        variables,
        capturedOutputs: {},
        status: 'running',
        error: null,
        startedAt: Date.now()
    };

    // Execute workflow in content script
    try {
        const result = await chrome.tabs.sendMessage(tabId, {
            type: 'leadtapp/executor/workflow',
            workflow,
            variables
        });

        // Update workflow stats
        workflow.executionCount++;
        workflow.lastExecuted = Date.now();
        await saveWorkflows();

        workflowState.execution.status = result.success ? 'completed' : 'failed';
        workflowState.execution.error = result.error;

        return {
            ...result,
            method: 'dom',
            workflowId,
            workflowName: workflow.name
        };

    } catch (error) {
        workflowState.execution.status = 'failed';
        workflowState.execution.error = error.message;

        return { success: false, error: error.message, method: 'dom' };
    }
}

async function executeSingleAction(workflowId, actionId, variables = {}) {
    // Find workflow and action
    let workflow = null;
    let action = null;
    let site = null;

    for (const s of workflowState.sites) {
        const w = s.workflows.find(w => w.id === workflowId);
        if (w) {
            workflow = w;
            site = s;
            action = w.actions.find(a => a.id === actionId);
            break;
        }
    }

    if (!action) {
        return { success: false, error: 'Action not found' };
    }

    // Get tab
    let tabId = site.tabId;
    if (!tabId) {
        // Find tab with matching domain
        const tabs = await chrome.tabs.query({ url: `*://*.${site.domain}/*` });
        if (tabs.length > 0) {
            tabId = tabs[0].id;
            site.tabId = tabId;
        } else {
            return { success: false, error: 'No tab open for this site' };
        }
    }

    // Inject executor and execute
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/executor.js']
    });

    return await chrome.tabs.sendMessage(tabId, {
        type: 'leadtapp/executor/action',
        action,
        variables
    });
}

// =============================================================================
// Cross-Tab Workflow Chains
// =============================================================================

async function executeChain(chainId, initialVariables = {}) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    const variables = { ...initialVariables, ...chain.sharedVariables };
    const results = [];

    workflowState.execution = {
        workflowId: null,
        chainId,
        currentStep: 0,
        variables,
        capturedOutputs: {},
        status: 'running',
        error: null,
        startedAt: Date.now()
    };

    for (let i = 0; i < chain.steps.length; i++) {
        const step = chain.steps[i];
        workflowState.execution.currentStep = i;

        // Check condition
        if (step.condition) {
            const conditionMet = evaluateCondition(step.condition, variables);
            if (!conditionMet) {
                results.push({ step: i, skipped: true, reason: 'Condition not met' });
                continue;
            }
        }

        // Map variables for this step
        const stepVariables = {};
        if (step.variableMapping) {
            for (const [workflowVar, chainVar] of Object.entries(step.variableMapping)) {
                stepVariables[workflowVar] = variables[chainVar];
            }
        }

        // Execute workflow
        const result = await executeWorkflow(step.workflowId, stepVariables);
        results.push({ step: i, ...result });

        if (!result.success) {
            workflowState.execution.status = 'failed';
            workflowState.execution.error = result.error;
            return { success: false, failedAt: i, results };
        }

        // Capture outputs
        if (step.outputCapture) {
            const site = workflowState.sites.find(s => s.id === step.siteId);
            if (site?.tabId) {
                try {
                    const captureResult = await chrome.tabs.sendMessage(site.tabId, {
                        type: 'leadtapp/executor/capture',
                        selectors: step.outputCapture
                    });
                    Object.assign(variables, captureResult.data);
                    workflowState.execution.capturedOutputs[i] = captureResult.data;
                } catch (e) {
                    console.warn('[Workflow Manager] Output capture failed:', e);
                }
            }
        }

        // Wait if specified
        if (step.waitAfter) {
            await new Promise(resolve => setTimeout(resolve, step.waitAfter));
        }
    }

    workflowState.execution.status = 'completed';
    return { success: true, results };
}

function evaluateCondition(condition, variables) {
    // Simple condition evaluation
    // condition: { variable: 'count', operator: 'gt', value: 0 }
    const value = variables[condition.variable];

    switch (condition.operator) {
        case 'eq': return value === condition.value;
        case 'ne': return value !== condition.value;
        case 'gt': return value > condition.value;
        case 'lt': return value < condition.value;
        case 'gte': return value >= condition.value;
        case 'lte': return value <= condition.value;
        case 'exists': return value !== undefined && value !== null;
        case 'contains': return String(value).includes(condition.value);
        default: return true;
    }
}

// =============================================================================
// Live State Polling
// =============================================================================

async function startPolling(siteId, config) {
    const site = workflowState.sites.find(s => s.id === siteId);
    if (!site) return;

    // Stop existing polling
    stopPolling(siteId);

    site.isPolling = true;

    const intervalId = setInterval(async () => {
        if (!site.tabId) {
            await refreshTabMapping();
            if (!site.tabId) return;
        }

        try {
            // Inject executor if needed
            await chrome.scripting.executeScript({
                target: { tabId: site.tabId },
                files: ['src/content/executor.js']
            }).catch(() => { });

            const response = await chrome.tabs.sendMessage(site.tabId, {
                type: 'leadtapp/executor/state',
                config
            });

            if (response?.success) {
                site.liveState = response.state;

                // Broadcast state update
                chrome.runtime.sendMessage({
                    type: 'leadtapp/site/state',
                    siteId,
                    state: response.state
                }).catch(() => { });
            }
        } catch (e) {
            // Tab might be closed or navigated away
        }
    }, config.interval || 5000);

    workflowState.pollingIntervals.set(siteId, intervalId);
}

function stopPolling(siteId) {
    const intervalId = workflowState.pollingIntervals.get(siteId);
    if (intervalId) {
        clearInterval(intervalId);
        workflowState.pollingIntervals.delete(siteId);
    }

    const site = workflowState.sites.find(s => s.id === siteId);
    if (site) {
        site.isPolling = false;
    }
}

// =============================================================================
// Chain CRUD
// =============================================================================

function createChain(name, description = '') {
    const chain = {
        id: `chain-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        name,
        description,
        steps: [],
        sharedVariables: {},
        icon: '🔗',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        executionCount: 0,
        lastExecuted: null
    };

    workflowState.chains.push(chain);
    saveWorkflows();

    return { success: true, chain };
}

function updateChain(chainId, updates) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    Object.assign(chain, updates, { updatedAt: Date.now() });
    saveWorkflows();
    return { success: true, chain };
}

function deleteChain(chainId) {
    const index = workflowState.chains.findIndex(c => c.id === chainId);
    if (index < 0) {
        return { success: false, error: 'Chain not found' };
    }

    workflowState.chains.splice(index, 1);
    saveWorkflows();
    return { success: true };
}

function addChainStep(chainId, workflowId, options = {}) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    // Find workflow to get site info
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

    const step = {
        id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        workflowId,
        siteId: site.id,
        siteName: site.name,
        workflowName: workflow.name,
        order: chain.steps.length,
        condition: options.condition || null,
        variableMapping: options.variableMapping || {},
        outputCapture: options.outputCapture || null,
        waitAfter: options.waitAfter || 500
    };

    chain.steps.push(step);
    chain.updatedAt = Date.now();
    saveWorkflows();

    return { success: true, step };
}

function removeChainStep(chainId, stepId) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    const index = chain.steps.findIndex(s => s.id === stepId);
    if (index < 0) {
        return { success: false, error: 'Step not found' };
    }

    chain.steps.splice(index, 1);
    // Re-order remaining steps
    chain.steps.forEach((step, i) => step.order = i);
    chain.updatedAt = Date.now();
    saveWorkflows();

    return { success: true };
}

function reorderChainSteps(chainId, stepIds) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    const reorderedSteps = [];
    for (const stepId of stepIds) {
        const step = chain.steps.find(s => s.id === stepId);
        if (step) {
            step.order = reorderedSteps.length;
            reorderedSteps.push(step);
        }
    }

    chain.steps = reorderedSteps;
    chain.updatedAt = Date.now();
    saveWorkflows();

    return { success: true, chain };
}

function updateChainStep(chainId, stepId, updates) {
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        return { success: false, error: 'Chain not found' };
    }

    const step = chain.steps.find(s => s.id === stepId);
    if (!step) {
        return { success: false, error: 'Step not found' };
    }

    Object.assign(step, updates);
    chain.updatedAt = Date.now();
    saveWorkflows();

    return { success: true, step };
}

// =============================================================================
// Cross-Tab Recording
// =============================================================================

async function startCrossTabRecording(name) {
    const chain = createChain(name || 'New Cross-Tab Workflow');

    workflowState.recording = {
        isRecording: true,
        siteId: null,
        workflowId: null,
        tabId: null,
        actions: [],
        startedAt: Date.now(),
        isCrossTab: true,
        chainId: chain.chain.id,
        currentTabWorkflow: null,
        tabWorkflows: []
    };

    return {
        success: true,
        chainId: chain.chain.id,
        chainName: chain.chain.name
    };
}

async function switchRecordingTab(tabId) {
    if (!workflowState.recording?.isCrossTab) {
        return { success: false, error: 'Not in cross-tab recording mode' };
    }

    const tab = await chrome.tabs.get(tabId);
    const site = getOrCreateSite(tab.url);

    if (!site) {
        return { success: false, error: 'Cannot record on this page' };
    }

    // Save current tab's workflow if exists
    if (workflowState.recording.currentTabWorkflow) {
        workflowState.recording.tabWorkflows.push({
            ...workflowState.recording.currentTabWorkflow,
            actions: [...workflowState.recording.actions]
        });
        workflowState.recording.actions = [];
    }

    // Create new workflow for this tab
    const workflow = {
        id: `wf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        name: `Step on ${site.name}`,
        description: '',
        siteId: site.id,
        url: tab.url,
        urlPattern: new URL(tab.url).pathname,
        actions: [],
        variables: [],
        variableDefaults: {},
        icon: site.icon,
        color: site.color,
        shortcut: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        executionCount: 0,
        lastExecuted: null,
        isChainable: true
    };

    workflowState.recording.siteId = site.id;
    workflowState.recording.workflowId = workflow.id;
    workflowState.recording.tabId = tabId;
    workflowState.recording.currentTabWorkflow = workflow;

    // Inject recorder
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/recorder.js']
    });

    await chrome.tabs.sendMessage(tabId, { type: 'leadtapp/recorder/start' });

    return {
        success: true,
        siteId: site.id,
        siteName: site.name,
        workflowId: workflow.id
    };
}

async function stopCrossTabRecording() {
    if (!workflowState.recording?.isCrossTab) {
        return { success: false, error: 'Not in cross-tab recording mode' };
    }

    const { chainId, tabId, tabWorkflows, currentTabWorkflow, actions } = workflowState.recording;

    // Stop recording in current tab
    if (tabId) {
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'leadtapp/recorder/stop' });
        } catch (e) {
            console.log('[Workflow Manager] Could not stop recorder in tab:', e);
        }
    }

    // Save current tab's workflow
    if (currentTabWorkflow) {
        currentTabWorkflow.actions = actions;
        tabWorkflows.push(currentTabWorkflow);
    }

    // Save all workflows and add as chain steps
    const chain = workflowState.chains.find(c => c.id === chainId);
    if (!chain) {
        workflowState.recording = null;
        return { success: false, error: 'Chain not found' };
    }

    for (const wf of tabWorkflows) {
        if (wf.actions.length === 0) continue;

        // Add workflow to its site
        const site = workflowState.sites.find(s => s.id === wf.siteId);
        if (site) {
            site.workflows.push(wf);
        }

        // Add step to chain
        chain.steps.push({
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            workflowId: wf.id,
            siteId: wf.siteId,
            siteName: site?.name || 'Unknown',
            workflowName: wf.name,
            order: chain.steps.length,
            condition: null,
            variableMapping: {},
            outputCapture: null,
            waitAfter: 500
        });
    }

    chain.updatedAt = Date.now();
    await saveWorkflows();

    const result = {
        success: true,
        chainId,
        chainName: chain.name,
        stepCount: chain.steps.length,
        workflowCount: tabWorkflows.filter(w => w.actions.length > 0).length
    };

    workflowState.recording = null;

    return result;
}

// =============================================================================
// Workflow CRUD
// =============================================================================

function updateWorkflow(workflowId, updates) {
    for (const site of workflowState.sites) {
        const workflow = site.workflows.find(w => w.id === workflowId);
        if (workflow) {
            Object.assign(workflow, updates, { updatedAt: Date.now() });
            saveWorkflows();
            return { success: true, workflow };
        }
    }
    return { success: false, error: 'Workflow not found' };
}

function deleteWorkflow(workflowId) {
    for (const site of workflowState.sites) {
        const index = site.workflows.findIndex(w => w.id === workflowId);
        if (index >= 0) {
            site.workflows.splice(index, 1);
            saveWorkflows();
            return { success: true };
        }
    }
    return { success: false, error: 'Workflow not found' };
}

function markActionAsVariable(workflowId, actionId, variableName) {
    for (const site of workflowState.sites) {
        const workflow = site.workflows.find(w => w.id === workflowId);
        if (workflow) {
            const action = workflow.actions.find(a => a.id === actionId);
            if (action) {
                action.isVariable = true;
                action.variableName = variableName;
                action.variableDefault = action.value;

                if (!workflow.variables.includes(variableName)) {
                    workflow.variables.push(variableName);
                }
                workflow.variableDefaults[variableName] = action.value;

                saveWorkflows();
                return { success: true };
            }
        }
    }
    return { success: false, error: 'Action not found' };
}

// =============================================================================
// Utilities
// =============================================================================

function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const listener = (id, changeInfo) => {
            if (id === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 500); // Extra delay for JS to initialize
            }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Timeout fallback
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 10000);
    });
}

// =============================================================================
// Tab Event Listeners
// =============================================================================

chrome.tabs.onRemoved.addListener((tabId) => {
    const siteId = workflowState.tabMapping.get(tabId);
    if (siteId) {
        const site = workflowState.sites.find(s => s.id === siteId);
        if (site) {
            site.tabId = null;
        }
        workflowState.tabMapping.delete(tabId);
        stopPolling(siteId);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const site = workflowState.sites.find(s => tab.url?.includes(s.domain));
        if (site) {
            site.tabId = tabId;
            site.lastUrl = tab.url;
            workflowState.tabMapping.set(tabId, site.id);
        }
    }
});

// =============================================================================
// Exports
// =============================================================================

// Make functions available globally for service worker
if (typeof globalThis !== 'undefined') {
    globalThis.workflowManager = {
        init: initializeWorkflows,
        getState: () => workflowState,
        getSites: () => workflowState.sites,
        getChains: () => workflowState.chains,
        startRecording,
        stopRecording,
        handleRecordedAction,
        executeWorkflow,
        executeSingleAction,
        executeChain,
        startPolling,
        stopPolling,
        updateWorkflow,
        deleteWorkflow,
        markActionAsVariable,
        refreshTabMapping,
        // Chain management
        createChain,
        updateChain,
        deleteChain,
        addChainStep,
        removeChainStep,
        reorderChainSteps,
        updateChainStep,
        // Cross-tab recording
        startCrossTabRecording,
        switchRecordingTab,
        stopCrossTabRecording,
        // Default workflows
        restoreDefaultWorkflows,
        getDefaultWorkflows: () => DEFAULT_KW_COMMAND_SITE.workflows
    };
}
