/**
 * LeadTapp -Background Service Worker
 *
 * Manages lead queue, feedback storage, CSV export, and workflow automation.
 */

console.log('[LeadTapp] Service worker starting...');

// Import workflow manager, LLM client, speech handler, and panel mode manager
try {
    importScripts('workflow-manager.js');
    console.log('[LeadTapp] workflow-manager.js loaded');
} catch (e) {
    console.error('[LeadTapp] Failed to load workflow-manager.js:', e);
}

try {
    importScripts('llm-client.js');
    console.log('[LeadTapp] llm-client.js loaded');
} catch (e) {
    console.error('[LeadTapp] Failed to load llm-client.js:', e);
}

try {
    importScripts('speech-handler.js');
    console.log('[LeadTapp] speech-handler.js loaded');
} catch (e) {
    console.error('[LeadTapp] Failed to load speech-handler.js:', e);
}

try {
    importScripts('panel-mode-manager.js');
    console.log('[LeadTapp] panel-mode-manager.js loaded');
} catch (e) {
    console.error('[LeadTapp] Failed to load panel-mode-manager.js:', e);
}

try {
    importScripts('kw-command-api.js');
    console.log('[LeadTapp] kw-command-api.js loaded');
} catch (e) {
    console.error('[LeadTapp] Failed to load kw-command-api.js:', e);
}

// =============================================================================
// State Management
// =============================================================================
const state = {
    agent: null,
    isAuthenticated: false,
    currentLead: null,
    currentLeadIndex: -1,
    totalLeads: 0,
    sessionStats: {
        leadsViewed: 0,
        callsMade: 0,
        appointmentsSet: 0,
        callbacksScheduled: 0,
        sessionStarted: new Date().toISOString()
    },
    apiConnected: false,
    lastSync: null
};
// Lead queue
let leadQueue = [];
let feedbackRequired = false;

// Custom fields and export configuration
let customFieldsConfig = {
    // Default fields (always available)
    defaultFields: [
        { key: 'firstName', label: 'First Name', type: 'text', crm: 'first_name' },
        { key: 'lastName', label: 'Last Name', type: 'text', crm: 'last_name' },
        { key: 'phone', label: 'Phone', type: 'phone', crm: 'phone' },
        { key: 'email', label: 'Email', type: 'email', crm: 'email' },
        { key: 'address', label: 'Address', type: 'text', crm: 'address' },
        { key: 'city', label: 'City', type: 'text', crm: 'city' },
        { key: 'state', label: 'State', type: 'text', crm: 'state' },
        { key: 'zip', label: 'Zip', type: 'text', crm: 'zip' },
        { key: 'leadType', label: 'Lead Type', type: 'select', options: ['buyer', 'seller', 'investor', 'renter'], crm: 'lead_type' },
        { key: 'source', label: 'Lead Source', type: 'text', crm: 'lead_source' },
        { key: 'score', label: 'Score', type: 'number', crm: 'score' },
        { key: 'tier', label: 'Tier', type: 'select', options: ['A+', 'A', 'B', 'C'], crm: 'tier' },
        { key: 'propertyType', label: 'Property Type', type: 'text', crm: 'property_type' },
        { key: 'estimatedValue', label: 'Est. Value', type: 'currency', crm: 'estimated_value' },
        { key: 'budget', label: 'Budget', type: 'currency', crm: 'budget' },
        { key: 'bestCallTime', label: 'Best Call Time', type: 'text', crm: 'best_call_time' },
        { key: 'tags', label: 'Tags', type: 'tags', crm: 'tags' }
    ],
    // Call outcome fields
    outcomeFields: [
        { key: 'callOutcome', label: 'Call Outcome', type: 'select', options: ['no_answer', 'voicemail', 'connected_callback', 'connected_appt', 'not_interested', 'wrong_number'], crm: 'call_outcome' },
        { key: 'callNotes', label: 'Call Notes', type: 'textarea', crm: 'call_notes' },
        { key: 'callDate', label: 'Call Date', type: 'datetime', crm: 'call_date' },
        { key: 'followUpDate', label: 'Follow Up Date', type: 'date', crm: 'follow_up_date' },
        { key: 'callDuration', label: 'Call Duration', type: 'text', crm: 'call_duration' },
        { key: 'disposition', label: 'Disposition', type: 'text', crm: 'disposition' }
    ],
    // User-defined custom fields
    customFields: [],
    // Export column mapping (for CRM imports)
    exportMapping: {},
    // CRM presets
    crmPresets: {
        'kw_command': {
            name: 'Keller Williams Command',
            mapping: {
                'First Name': 'firstName',
                'Last Name': 'lastName',
                'Mobile Phone': 'phone',
                'Email': 'email',
                'Street Address': 'address',
                'City': 'city',
                'State': 'state',
                'Zip Code': 'zip',
                'Lead Type': 'leadType',
                'Source': 'source',
                'Tags': 'tags'
            }
        },
        'follow_up_boss': {
            name: 'Follow Up Boss',
            mapping: {
                'firstName': 'firstName',
                'lastName': 'lastName',
                'phones[0].value': 'phone',
                'emails[0].value': 'email',
                'addresses[0].street': 'address',
                'addresses[0].city': 'city',
                'addresses[0].state': 'state',
                'addresses[0].code': 'zip',
                'source': 'source',
                'tags': 'tags'
            }
        },
        'sierra': {
            name: 'Sierra Interactive',
            mapping: {
                'first_name': 'firstName',
                'last_name': 'lastName',
                'phone': 'phone',
                'email': 'email',
                'address': 'address',
                'city': 'city',
                'state': 'state',
                'zip': 'zip',
                'lead_type': 'leadType',
                'lead_source': 'source',
                'notes': 'callNotes'
            }
        },
        'custom': {
            name: 'Custom Mapping',
            mapping: {}
        }
    }
};
// =============================================================================
// Initialization
// =============================================================================
async function initialize() {
    console.log('[LeadTapp] Initializing...');

    // Initialize workflow manager
    if (typeof workflowManager !== 'undefined' && workflowManager.init) {
        await workflowManager.init();
        console.log('[LeadTapp] Workflow manager initialized');
    }

    // Initialize LLM client
    if (typeof LLMClient !== 'undefined' && LLMClient.init) {
        await LLMClient.init();
        console.log('[LeadTapp] LLM client initialized');
    }

    // Initialize panel mode manager
    if (typeof PanelModeManager !== 'undefined' && PanelModeManager.init) {
        await PanelModeManager.init();
        console.log('[LeadTapp] Panel mode manager initialized');
    }

    // Load saved state
    const saved = await chrome.storage.local.get([
        'agent',
        'leadQueue',
        'feedbackHistory',
        'sessionStats',
        'currentLeadIndex',
        'customFieldsConfig'
    ]);
    if (saved.agent) {
        state.agent = saved.agent;
        state.isAuthenticated = true;
    }
    if (saved.leadQueue) {
        leadQueue = saved.leadQueue;
        state.totalLeads = leadQueue.length;
    }
    if (saved.currentLeadIndex !== undefined && saved.currentLeadIndex >= 0) {
        state.currentLeadIndex = saved.currentLeadIndex;
        state.currentLead = leadQueue[state.currentLeadIndex] || null;
    }
    if (saved.sessionStats) {
        state.sessionStats = saved.sessionStats;
    }
    // Load custom fields config
    if (saved.customFieldsConfig) {
        customFieldsConfig.customFields = saved.customFieldsConfig.customFields || [];
        customFieldsConfig.exportMapping = saved.customFieldsConfig.exportMapping || {};
        if (saved.customFieldsConfig.crmPresets?.custom) {
            customFieldsConfig.crmPresets.custom = saved.customFieldsConfig.crmPresets.custom;
        }
    }
    // Load demo leads if queue is empty
    if (leadQueue.length === 0) {
        loadDemoLeads();
    }
    console.log('[LeadTapp] Initialized with', leadQueue.length, 'leads');
}
// =============================================================================
// Demo Leads (for testing)
// =============================================================================
function loadDemoLeads() {
    leadQueue = [
        {
            id: 'lead-001',
            name: 'Sarah Mitchell',
            phone: '(512) 555-0147',
            email: 'sarah.mitchell@email.com',
            address: '4521 Oak Valley Dr',
            city: 'Austin',
            state: 'TX',
            zip: '78745',
            source: 'Zillow',
            leadType: 'seller',
            score: 87,
            tier: 'A',
            propertyType: 'Single Family',
            estimatedValue: 485000,
            assignedAt: new Date().toISOString(),
            bestCallTime: '10am-2pm',
            tags: ['motivated', 'relocating']
        },
        {
            id: 'lead-002',
            name: 'Michael Chen',
            phone: '(512) 555-0293',
            email: 'mchen.realestate@gmail.com',
            address: '892 Riverside Blvd',
            city: 'Round Rock',
            state: 'TX',
            zip: '78664',
            source: 'Facebook',
            leadType: 'buyer',
            score: 72,
            tier: 'B',
            propertyType: 'Single Family',
            estimatedValue: 350000,
            assignedAt: new Date().toISOString(),
            bestCallTime: 'Evenings',
            tags: ['first-time-buyer']
        },
        {
            id: 'lead-003',
            name: 'Jennifer Rodriguez',
            phone: '(737) 555-0184',
            email: 'j.rodriguez@work.com',
            address: '1105 Sunset Canyon',
            city: 'Cedar Park',
            state: 'TX',
            zip: '78613',
            source: 'Referral',
            leadType: 'seller',
            score: 94,
            tier: 'A+',
            propertyType: 'Single Family',
            estimatedValue: 625000,
            assignedAt: new Date().toISOString(),
            bestCallTime: 'Mornings',
            tags: ['hot-lead', 'downsizing', 'referral']
        },
        {
            id: 'lead-004',
            name: 'David Thompson',
            phone: '(512) 555-0321',
            email: 'dthompson@email.com',
            address: '3344 Meadow Lane',
            city: 'Pflugerville',
            state: 'TX',
            zip: '78660',
            source: 'KW Website',
            leadType: 'investor',
            score: 68,
            tier: 'B',
            propertyType: 'Multi-Family',
            estimatedValue: 890000,
            assignedAt: new Date().toISOString(),
            bestCallTime: 'Anytime',
            tags: ['investor', 'cash-buyer']
        },
        {
            id: 'lead-005',
            name: 'Amanda Wilson',
            phone: '(512) 555-0456',
            email: 'amanda.w@outlook.com',
            address: '7890 Lakewood Dr',
            city: 'Leander',
            state: 'TX',
            zip: '78641',
            source: 'Open House',
            leadType: 'buyer',
            score: 81,
            tier: 'A',
            propertyType: 'Single Family',
            estimatedValue: 420000,
            assignedAt: new Date().toISOString(),
            bestCallTime: 'Afternoons',
            tags: ['pre-approved', 'urgent']
        }
    ];
    state.totalLeads = leadQueue.length;
    state.currentLeadIndex = 0;
    state.currentLead = leadQueue[0];
    saveState();
}
// =============================================================================
// Message Handlers
// =============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith('leadtapp/'))
        return;
    handleMessage(message, sender)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    return true;
});
async function handleMessage(message, sender) {
    switch (message.type) {
        // =========================================================================
        // State
        // =========================================================================
        case 'leadtapp/getState':
            return {
                state,
                workflowState: workflowManager?.getState() || null
            };

        case 'leadtapp/getDashboardState':
            return {
                sites: workflowManager?.getSites() || [],
                chains: workflowManager?.getChains() || [],
                recording: workflowManager?.getState()?.recording || null,
                execution: workflowManager?.getState()?.execution || null
            };

        // =========================================================================
        // Leads (existing functionality)
        // =========================================================================
        case 'leadtapp/lead/next':
            return await getNextLead();
        case 'leadtapp/lead/refresh':
            loadDemoLeads();
            return { success: true, total: leadQueue.length };

        // =========================================================================
        // Feedback (existing functionality)
        // =========================================================================
        case 'leadtapp/feedback/submit':
            return await submitFeedback(message.feedback);

        // =========================================================================
        // Export (existing functionality)
        // =========================================================================
        case 'leadtapp/export/csv':
            return await exportToCsv(message.options);

        // =========================================================================
        // Recording
        // =========================================================================
        case 'leadtapp/recorder/start':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
            if (currentTab.length === 0) return { error: 'No active tab' };
            return await workflowManager.startRecording(currentTab[0].id);

        case 'leadtapp/recorder/stop':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.stopRecording();

        case 'leadtapp/recorder/action':
            // Action recorded by content script
            if (workflowManager) {
                workflowManager.handleRecordedAction(message.action);
            }
            return { success: true };

        case 'leadtapp/recorder/status':
            const recordingState = workflowManager?.getState()?.recording;
            return {
                isRecording: !!recordingState?.isRecording,
                actionCount: recordingState?.actions?.length || 0
            };

        // =========================================================================
        // Workflow Execution
        // =========================================================================
        case 'leadtapp/workflow/execute':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.executeWorkflow(message.workflowId, message.variables || {});

        case 'leadtapp/workflow/executeAction':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.executeSingleAction(
                message.workflowId,
                message.actionId,
                message.variables || {}
            );

        // =========================================================================
        // Workflow CRUD
        // =========================================================================
        case 'leadtapp/workflow/update':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.updateWorkflow(message.workflowId, message.updates);

        case 'leadtapp/workflow/delete':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.deleteWorkflow(message.workflowId);

        case 'leadtapp/workflow/restore-defaults':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.restoreDefaultWorkflows(message.replaceExisting || false);

        case 'leadtapp/workflow/get-defaults':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return { workflows: workflowManager.getDefaultWorkflows() };

        case 'leadtapp/workflow/markVariable':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.markActionAsVariable(
                message.workflowId,
                message.actionId,
                message.variableName
            );

        // =========================================================================
        // Sites
        // =========================================================================
        case 'leadtapp/sites/get':
            return { sites: workflowManager?.getSites() || [] };

        case 'leadtapp/sites/refresh':
            if (workflowManager) {
                await workflowManager.refreshTabMapping();
            }
            return { sites: workflowManager?.getSites() || [] };

        // =========================================================================
        // Chains (Cross-tab workflows)
        // =========================================================================
        case 'leadtapp/chains/get':
            return { chains: workflowManager?.getChains() || [] };

        case 'leadtapp/chain/create':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.createChain(message.name, message.description);

        case 'leadtapp/chain/update':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.updateChain(message.chainId, message.updates);

        case 'leadtapp/chain/delete':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.deleteChain(message.chainId);

        case 'leadtapp/chain/execute':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.executeChain(message.chainId, message.variables || {});

        // Chain step management
        case 'leadtapp/chain/addStep':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.addChainStep(message.chainId, message.workflowId, message.options || {});

        case 'leadtapp/chain/removeStep':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.removeChainStep(message.chainId, message.stepId);

        case 'leadtapp/chain/reorderSteps':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.reorderChainSteps(message.chainId, message.stepIds);

        case 'leadtapp/chain/updateStep':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return workflowManager.updateChainStep(message.chainId, message.stepId, message.updates);

        // Cross-tab recording
        case 'leadtapp/crossTab/startRecording':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.startCrossTabRecording(message.name);

        case 'leadtapp/crossTab/switchTab':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            const targetTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            if (!targetTab) return { error: 'No target tab' };
            return await workflowManager.switchRecordingTab(targetTab);

        case 'leadtapp/crossTab/stopRecording':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            return await workflowManager.stopCrossTabRecording();

        // =========================================================================
        // Live State Polling
        // =========================================================================
        case 'leadtapp/polling/start':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            await workflowManager.startPolling(message.siteId, message.config || {});
            return { success: true };

        case 'leadtapp/polling/stop':
            if (!workflowManager) return { error: 'Workflow manager not initialized' };
            workflowManager.stopPolling(message.siteId);
            return { success: true };

        // =========================================================================
        // Execution Progress (from executor content script)
        // =========================================================================
        case 'leadtapp/executor/progress':
        case 'leadtapp/executor/error':
            // Broadcast to UI
            chrome.runtime.sendMessage(message).catch(() => {});
            return { success: true };

        // =========================================================================
        // LLM Integration
        // =========================================================================
        case 'leadtapp/llm/chat':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.chat(message.message, message.options || {});

        case 'leadtapp/llm/configure':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.configure(message.config);

        case 'leadtapp/llm/getConfig':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return { config: LLMClient.getPublicConfig() };

        case 'leadtapp/llm/clearHistory':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return LLMClient.clearHistory();

        case 'leadtapp/llm/getHistory':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return { history: LLMClient.getHistory() };

        case 'leadtapp/llm/getProviders':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return { providers: LLMClient.getAvailableProviders() };

        case 'leadtapp/llm/listLocalModels':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.listLocalModels();

        // =========================================================================
        // Speech / Call Listening
        // =========================================================================
        case 'leadtapp/speech/start':
            if (typeof speechHandler === 'undefined') {
                return { error: 'Speech handler not initialized' };
            }
            return speechHandler.startListening({
                mode: message.mode || 'coaching',
                leadContext: message.leadContext || null
            });

        case 'leadtapp/speech/stop':
            if (typeof speechHandler === 'undefined') {
                return { error: 'Speech handler not initialized' };
            }
            return speechHandler.stopListening();

        case 'leadtapp/speech/transcript':
            if (typeof speechHandler === 'undefined') {
                return { error: 'Speech handler not initialized' };
            }
            return speechHandler.processTranscript({
                text: message.text,
                timestamp: message.timestamp || Date.now(),
                isFinal: message.isFinal || false,
                speaker: message.speaker || 'unknown'
            });

        case 'leadtapp/speech/getState':
            if (typeof speechHandler === 'undefined') {
                return {
                    isListening: false,
                    mode: 'coaching',
                    detectedActions: [],
                    coachingSuggestion: null
                };
            }
            return {
                isListening: speechHandler.isListening,
                mode: speechHandler.mode,
                detectedActions: speechHandler.detectedActions,
                coachingSuggestion: speechHandler.currentCoaching,
                transcriptLength: speechHandler.transcript.length
            };

        case 'leadtapp/speech/generateNotes':
            if (typeof speechHandler === 'undefined') {
                return { error: 'Speech handler not initialized' };
            }
            return {
                notes: speechHandler.generateAutoNotes(),
                suggestedWorkflow: speechHandler.suggestWorkflowFromActions()
            };

        case 'leadtapp/speech/clearTranscript':
            if (typeof speechHandler === 'undefined') {
                return { error: 'Speech handler not initialized' };
            }
            speechHandler.transcript = [];
            speechHandler.detectedActions = [];
            return { success: true };

        // LLM Workflow Helpers
        case 'leadtapp/llm/analyzePageForWorkflow':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.analyzePageForWorkflow(message.pageContext);

        case 'leadtapp/llm/describeWorkflow':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.describeWorkflow(message.workflow);

        case 'leadtapp/llm/suggestChainConnections':
            if (!LLMClient) return { error: 'LLM client not initialized' };
            return await LLMClient.suggestChainConnections(message.workflows);

        // =========================================================================
        // Panel Mode Management
        // =========================================================================
        case 'leadtapp/panel/getSettings':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            return { settings: PanelModeManager.getSettings() };

        case 'leadtapp/panel/saveSettings':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            await PanelModeManager.saveSettings(message.settings);
            return { success: true };

        case 'leadtapp/panel/setMode':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const modeTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.setMode(message.mode, modeTab);

        case 'leadtapp/panel/open':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const openTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.openPanel(openTab);

        case 'leadtapp/panel/close':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const closeTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.closePanel(closeTab);

        case 'leadtapp/panel/toggle':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const toggleTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.togglePanel(toggleTab);

        case 'leadtapp/panel/updatePosition':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const posTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.updateFloatingPosition(posTab, message.position);

        case 'leadtapp/panel/updateSize':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const sizeTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.updateFloatingSize(sizeTab, message.size);

        case 'leadtapp/panel/updateTopbarState':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const topbarTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return await PanelModeManager.updateTopbarState(topbarTab, message.collapsed, message.height);

        case 'leadtapp/panel/getModes':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            return { modes: PanelModeManager.MODES };

        case 'leadtapp/panel/isOpen':
            if (typeof PanelModeManager === 'undefined') {
                return { error: 'Panel mode manager not initialized' };
            }
            const checkTab = message.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            return { isOpen: PanelModeManager.isOpen(checkTab) };

        // =========================================================================
        // Lead Management & Custom Fields
        // =========================================================================
        case 'leadtapp/lead/update':
            return await updateLead(message.leadId, message.updates);

        case 'leadtapp/lead/addTag':
            return await addLeadTag(message.leadId, message.tag);

        case 'leadtapp/lead/removeTag':
            return await removeLeadTag(message.leadId, message.tag);

        case 'leadtapp/lead/getAll':
            return await getAllLeadsWithFeedback();

        case 'leadtapp/customFields/get':
            return { config: customFieldsConfig };

        case 'leadtapp/customFields/add':
            return await addCustomField(message.field);

        case 'leadtapp/customFields/remove':
            return await removeCustomField(message.fieldKey);

        case 'leadtapp/customFields/update':
            return await updateCustomField(message.fieldKey, message.updates);

        case 'leadtapp/export/getConfig':
            return { config: customFieldsConfig.exportMapping, presets: customFieldsConfig.crmPresets };

        case 'leadtapp/export/setMapping':
            return await setExportMapping(message.mapping);

        case 'leadtapp/export/applyPreset':
            return await applyExportPreset(message.presetId);

        case 'leadtapp/export/csv':
            return await exportFlexibleCsv(message.options);

        case 'leadtapp/export/preview':
            return await previewExport(message.options);

        // =========================================================================
        // KW Command API (Direct API calls instead of DOM automation)
        // =========================================================================
        case 'leadtapp/api/status':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized', isReady: false };
            }
            return kwCommandAPI.getStatus();

        case 'leadtapp/api/initialize':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            const initialized = await kwCommandAPI.initialize(message.credentials || {});
            return { success: initialized, status: kwCommandAPI.getStatus() };

        case 'leadtapp/api/contacts/search':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.searchContacts(message.params || {});

        case 'leadtapp/api/contacts/get':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getContact(message.contactId);

        case 'leadtapp/api/contacts/notes':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getContactNotes(message.contactId);

        case 'leadtapp/api/contacts/createNote':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.createContactNote(message.contactId, message.note);

        case 'leadtapp/api/contacts/logCall':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.logCall(message.callData);

        case 'leadtapp/api/tasks/get':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getTasks(message.params || {});

        case 'leadtapp/api/tasks/create':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.createTasks(message.tasks);

        case 'leadtapp/api/tasks/complete':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.completeTask(message.taskId);

        case 'leadtapp/api/activity/team':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getTeamActivity();

        case 'leadtapp/api/smartviews/get':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getSmartViews(message.type || 'contact');

        case 'leadtapp/api/deals/get':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.getDeals(message.params || {});

        case 'leadtapp/api/workflow/execute':
            if (typeof kwCommandAPI === 'undefined') {
                return { error: 'KW Command API not initialized' };
            }
            return await kwCommandAPI.executeWorkflowAction(message.action, message.data);

        default:
            return { error: 'Unknown message type' };
    }
}
// =============================================================================
// Lead Management
// =============================================================================
async function getNextLead() {
    // Check if feedback is required before advancing
    if (feedbackRequired && state.currentLeadIndex >= 0) {
        return {
            error: 'Feedback required before advancing',
            requiresFeedback: true,
            lead: state.currentLead,
            index: state.currentLeadIndex,
            total: state.totalLeads
        };
    }
    // Advance to next lead
    const nextIndex = state.currentLeadIndex + 1;
    if (nextIndex >= leadQueue.length) {
        return {
            lead: null,
            index: state.currentLeadIndex,
            total: state.totalLeads,
            message: 'No more leads in queue'
        };
    }
    state.currentLeadIndex = nextIndex;
    state.currentLead = leadQueue[nextIndex];
    state.sessionStats.leadsViewed++;
    feedbackRequired = true;
    await saveState();
    return {
        lead: state.currentLead,
        index: state.currentLeadIndex,
        total: state.totalLeads
    };
}
// =============================================================================
// Feedback Management
// =============================================================================
async function submitFeedback(feedback) {
    if (!feedback.outcome) {
        return { success: false, error: 'Outcome is required' };
    }
    if (!feedback.notes || feedback.notes.trim().length === 0) {
        return { success: false, error: 'Notes are required' };
    }
    const fullFeedback = {
        ...feedback,
        agentId: state.agent?.id || 'anonymous',
        timestamp: new Date().toISOString(),
        lead: state.currentLead,
        synced: false
    };
    // Store feedback
    const stored = await chrome.storage.local.get('feedbackHistory');
    const history = stored.feedbackHistory || [];
    history.push(fullFeedback);
    await chrome.storage.local.set({ feedbackHistory: history });
    // Update stats
    state.sessionStats.callsMade++;
    if (feedback.outcome === 'connected_appointment') {
        state.sessionStats.appointmentsSet++;
    }
    if (feedback.outcome === 'connected_callback') {
        state.sessionStats.callbacksScheduled++;
    }
    // Allow advancing to next lead
    feedbackRequired = false;
    await saveState();
    return {
        success: true,
        canAdvance: true,
        stats: state.sessionStats
    };
}
// =============================================================================
// CSV Export
// =============================================================================
async function exportToCsv(options) {
    const stored = await chrome.storage.local.get('feedbackHistory');
    const history = stored.feedbackHistory || [];
    if (history.length === 0) {
        return { success: false, error: 'No feedback to export' };
    }
    // CSV headers for Keller Williams Command import
    const headers = [
        'First Name',
        'Last Name',
        'Phone',
        'Email',
        'Address',
        'City',
        'State',
        'Zip',
        'Lead Type',
        'Lead Source',
        'Call Outcome',
        'Call Notes',
        'Call Date',
        'Follow Up Date',
        'Tags'
    ];
    const rows = history.map(fb => {
        const nameParts = fb.lead.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        return [
            firstName,
            lastName,
            fb.lead.phone,
            fb.lead.email || '',
            fb.lead.address || '',
            fb.lead.city || '',
            fb.lead.state || '',
            fb.lead.zip || '',
            fb.lead.leadType,
            fb.lead.source,
            fb.outcome,
            fb.notes.replace(/"/g, '""'),
            fb.timestamp,
            fb.followUpDate || '',
            (fb.lead.tags || []).join(';')
        ];
    });
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const filename = `leadtapp_export_${new Date().toISOString().split('T')[0]}.csv`;
    await chrome.downloads.download({
        url,
        filename,
        saveAs: true
    });
    return {
        success: true,
        filename,
        rowCount: rows.length
    };
}

// =============================================================================
// Lead Update Functions
// =============================================================================
async function updateLead(leadId, updates) {
    // Find lead in queue
    const leadIndex = leadQueue.findIndex(l => l.id === leadId);
    if (leadIndex === -1) {
        return { success: false, error: 'Lead not found' };
    }

    // Update lead fields
    leadQueue[leadIndex] = { ...leadQueue[leadIndex], ...updates, updatedAt: Date.now() };

    // If this is the current lead, update state
    if (state.currentLead?.id === leadId) {
        state.currentLead = leadQueue[leadIndex];
    }

    // Also update any existing feedback for this lead
    const stored = await chrome.storage.local.get('feedbackHistory');
    const history = stored.feedbackHistory || [];
    const feedbackIndex = history.findIndex(fb => fb.lead?.id === leadId);
    if (feedbackIndex !== -1) {
        history[feedbackIndex].lead = { ...history[feedbackIndex].lead, ...updates };
        await chrome.storage.local.set({ feedbackHistory: history });
    }

    await saveState();
    return { success: true, lead: leadQueue[leadIndex] };
}

async function addLeadTag(leadId, tag) {
    const leadIndex = leadQueue.findIndex(l => l.id === leadId);
    if (leadIndex === -1) {
        return { success: false, error: 'Lead not found' };
    }

    const lead = leadQueue[leadIndex];
    lead.tags = lead.tags || [];
    if (!lead.tags.includes(tag)) {
        lead.tags.push(tag);
        lead.updatedAt = Date.now();
        await saveState();
    }

    return { success: true, tags: lead.tags };
}

async function removeLeadTag(leadId, tag) {
    const leadIndex = leadQueue.findIndex(l => l.id === leadId);
    if (leadIndex === -1) {
        return { success: false, error: 'Lead not found' };
    }

    const lead = leadQueue[leadIndex];
    lead.tags = (lead.tags || []).filter(t => t !== tag);
    lead.updatedAt = Date.now();
    await saveState();

    return { success: true, tags: lead.tags };
}

async function getAllLeadsWithFeedback() {
    const stored = await chrome.storage.local.get('feedbackHistory');
    const feedbackHistory = stored.feedbackHistory || [];

    // Create a map of lead ID to ALL feedback records (call history)
    const feedbackMap = new Map();
    feedbackHistory.forEach(fb => {
        if (fb.lead?.id) {
            if (!feedbackMap.has(fb.lead.id)) {
                feedbackMap.set(fb.lead.id, []);
            }
            feedbackMap.get(fb.lead.id).push({
                outcome: fb.outcome,
                notes: fb.notes,
                timestamp: fb.timestamp,
                followUpDate: fb.followUpDate,
                tags: fb.tags || [],
                agentId: fb.agentId
            });
        }
    });

    // Merge leads with their complete call history
    const leadsWithFeedback = leadQueue.map(lead => {
        const callHistory = feedbackMap.get(lead.id) || [];
        // Sort by timestamp descending (most recent first)
        callHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Get the most recent call for summary display
        const latestCall = callHistory[0] || null;

        return {
            ...lead,
            // Latest outcome/notes for table display
            outcome: latestCall?.outcome || lead.outcome || '',
            notes: latestCall?.notes || lead.notes || '',
            // Complete call history for detail view
            callHistory,
            callCount: callHistory.length,
            // Merge tags from lead and all calls
            tags: [...new Set([
                ...(lead.tags || []),
                ...callHistory.flatMap(c => c.tags || [])
            ])]
        };
    });

    return { success: true, leads: leadsWithFeedback, total: leadsWithFeedback.length };
}

// =============================================================================
// Custom Fields Functions
// =============================================================================
async function addCustomField(field) {
    if (!field.key || !field.label) {
        return { success: false, error: 'Field key and label are required' };
    }

    // Check for duplicate keys
    const existingKeys = [
        ...customFieldsConfig.defaultFields.map(f => f.key),
        ...customFieldsConfig.outcomeFields.map(f => f.key),
        ...customFieldsConfig.customFields.map(f => f.key)
    ];

    if (existingKeys.includes(field.key)) {
        return { success: false, error: 'Field key already exists' };
    }

    const newField = {
        key: field.key,
        label: field.label,
        type: field.type || 'text',
        crm: field.crm || field.key,
        options: field.options || null,
        isCustom: true,
        createdAt: Date.now()
    };

    customFieldsConfig.customFields.push(newField);
    await chrome.storage.local.set({ customFieldsConfig });

    return { success: true, field: newField, config: customFieldsConfig };
}

async function removeCustomField(fieldKey) {
    const index = customFieldsConfig.customFields.findIndex(f => f.key === fieldKey);
    if (index === -1) {
        return { success: false, error: 'Custom field not found' };
    }

    customFieldsConfig.customFields.splice(index, 1);
    await chrome.storage.local.set({ customFieldsConfig });

    return { success: true, config: customFieldsConfig };
}

async function updateCustomField(fieldKey, updates) {
    const field = customFieldsConfig.customFields.find(f => f.key === fieldKey);
    if (!field) {
        return { success: false, error: 'Custom field not found' };
    }

    Object.assign(field, updates);
    await chrome.storage.local.set({ customFieldsConfig });

    return { success: true, field, config: customFieldsConfig };
}

// =============================================================================
// Export Configuration Functions
// =============================================================================
async function setExportMapping(mapping) {
    customFieldsConfig.exportMapping = mapping;
    await chrome.storage.local.set({ customFieldsConfig });
    return { success: true, mapping };
}

async function applyExportPreset(presetId) {
    const preset = customFieldsConfig.crmPresets[presetId];
    if (!preset) {
        return { success: false, error: 'Preset not found' };
    }

    customFieldsConfig.exportMapping = { ...preset.mapping };
    customFieldsConfig.activePreset = presetId;
    await chrome.storage.local.set({ customFieldsConfig });

    return { success: true, mapping: customFieldsConfig.exportMapping, preset };
}

async function previewExport(options = {}) {
    const stored = await chrome.storage.local.get('feedbackHistory');
    const history = stored.feedbackHistory || [];

    if (history.length === 0) {
        return { success: false, error: 'No data to export' };
    }

    // Get active columns based on current mapping
    const columns = getExportColumns(options);
    const sampleRows = history.slice(0, 3).map(fb => buildExportRow(fb, columns));

    return {
        success: true,
        columns,
        sampleRows,
        totalRows: history.length
    };
}

function getExportColumns(options = {}) {
    const columns = [];
    const mapping = options.mapping || customFieldsConfig.exportMapping;

    // Default fields
    customFieldsConfig.defaultFields.forEach(field => {
        if (mapping[field.key] !== false) { // Include unless explicitly disabled
            columns.push({
                key: field.key,
                label: mapping[field.key]?.label || field.label,
                crm: mapping[field.key]?.crm || field.crm,
                type: field.type
            });
        }
    });

    // Outcome fields
    customFieldsConfig.outcomeFields.forEach(field => {
        if (mapping[field.key] !== false) {
            columns.push({
                key: field.key,
                label: mapping[field.key]?.label || field.label,
                crm: mapping[field.key]?.crm || field.crm,
                type: field.type
            });
        }
    });

    // Custom fields
    customFieldsConfig.customFields.forEach(field => {
        if (mapping[field.key] !== false) {
            columns.push({
                key: field.key,
                label: mapping[field.key]?.label || field.label,
                crm: mapping[field.key]?.crm || field.crm,
                type: field.type,
                isCustom: true
            });
        }
    });

    return columns;
}

function buildExportRow(feedback, columns) {
    const lead = feedback.lead || {};
    const row = {};

    columns.forEach(col => {
        let value = '';

        // Check lead data first
        if (col.key === 'firstName') {
            const nameParts = (lead.name || '').split(' ');
            value = nameParts[0] || '';
        } else if (col.key === 'lastName') {
            const nameParts = (lead.name || '').split(' ');
            value = nameParts.slice(1).join(' ') || '';
        } else if (col.key in lead) {
            value = lead[col.key];
        }
        // Check outcome data
        else if (col.key === 'callOutcome') {
            value = feedback.outcome || '';
        } else if (col.key === 'callNotes') {
            value = feedback.notes || '';
        } else if (col.key === 'callDate') {
            value = feedback.timestamp || '';
        } else if (col.key === 'followUpDate') {
            value = feedback.followUpDate || '';
        } else if (col.key === 'agentNotes') {
            value = feedback.agentNotes || '';
        } else if (col.key === 'callTags') {
            value = (feedback.tags || lead.tags || []).join(';');
        }
        // Check for custom field data
        else if (lead.customFields && col.key in lead.customFields) {
            value = lead.customFields[col.key];
        } else if (feedback.customFields && col.key in feedback.customFields) {
            value = feedback.customFields[col.key];
        }

        // Format arrays
        if (Array.isArray(value)) {
            value = value.join(';');
        }

        row[col.crm || col.key] = value || '';
    });

    return row;
}

async function exportFlexibleCsv(options = {}) {
    const stored = await chrome.storage.local.get('feedbackHistory');
    const history = stored.feedbackHistory || [];

    if (history.length === 0) {
        return { success: false, error: 'No feedback data to export' };
    }

    // Get columns based on mapping
    const columns = getExportColumns(options);

    // Build headers (use CRM field names for import compatibility)
    const useCrmHeaders = options.useCrmHeaders !== false;
    const headers = columns.map(col => useCrmHeaders ? (col.crm || col.label) : col.label);

    // Build rows
    const rows = history.map(fb => {
        const rowData = buildExportRow(fb, columns);
        return columns.map(col => {
            const value = rowData[col.crm || col.key] || '';
            // Escape quotes for CSV
            return String(value).replace(/"/g, '""');
        });
    });

    // Build CSV content
    const csvContent = [
        headers.map(h => `"${h}"`).join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Generate filename
    const presetName = customFieldsConfig.activePreset || 'custom';
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = options.filename || `leadtapp_${presetName}_export_${dateStr}.csv`;

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
        url,
        filename,
        saveAs: options.saveAs !== false
    });

    return {
        success: true,
        filename,
        rowCount: rows.length,
        columnCount: columns.length,
        columns: columns.map(c => c.label)
    };
}

// =============================================================================
// Persistence
// =============================================================================
async function saveState() {
    await chrome.storage.local.set({
        agent: state.agent,
        leadQueue,
        currentLeadIndex: state.currentLeadIndex,
        sessionStats: state.sessionStats
    });
}
// =============================================================================
// Side Panel Handler
// =============================================================================
console.log('[LeadTapp] Setting up side panel handlers...');

chrome.action.onClicked.addListener((tab) => {
    console.log('[LeadTapp] Extension icon clicked, opening side panel for window:', tab.windowId);
    chrome.sidePanel.open({ windowId: tab.windowId })
        .then(() => console.log('[LeadTapp] Side panel opened successfully'))
        .catch((error) => console.error('[LeadTapp] Failed to open side panel:', error));
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log('[LeadTapp] Side panel behavior set successfully'))
    .catch((error) => console.error('[LeadTapp] Side panel behavior error:', error));

console.log('[LeadTapp] Side panel handlers registered');

// =============================================================================
// Keyboard Commands
// =============================================================================
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-sidepanel') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            // Use panel mode manager if available
            if (typeof PanelModeManager !== 'undefined') {
                await PanelModeManager.togglePanel(tab.id);
            } else {
                chrome.sidePanel.open({ windowId: tab.windowId });
            }
        }
    } else if (command === 'next-lead') {
        // Send message to side panel to trigger next lead
        chrome.runtime.sendMessage({ type: 'leadtapp/command/next' });
    } else if (command === 'start-recording') {
        // Toggle workflow recording
        const recordingState = workflowManager?.getState()?.recording;
        if (recordingState?.isRecording) {
            const result = await workflowManager.stopRecording();
            chrome.runtime.sendMessage({
                type: 'leadtapp/recording/stopped',
                ...result
            }).catch(() => {});
        } else {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                const result = await workflowManager.startRecording(tab.id);
                chrome.runtime.sendMessage({
                    type: 'leadtapp/recording/started',
                    ...result
                }).catch(() => {});
            }
        }
    } else if (command === 'cycle-panel-mode') {
        // Cycle through panel modes: sidepanel → floating → topbar → sidepanel
        if (typeof PanelModeManager !== 'undefined') {
            const settings = PanelModeManager.getSettings();
            const modes = Object.values(PanelModeManager.MODES);
            const currentIndex = modes.indexOf(settings.mode);
            const nextIndex = (currentIndex + 1) % modes.length;
            const nextMode = modes[nextIndex];

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await PanelModeManager.setMode(nextMode, tab.id);
                // Notify UI of mode change
                chrome.runtime.sendMessage({
                    type: 'leadtapp/panel/modeChanged',
                    mode: nextMode
                }).catch(() => {});
            }
        }
    }
});

// =============================================================================
// Bootstrap
// =============================================================================
console.log('[LeadTapp] Starting bootstrap...');
initialize()
    .then(() => console.log('[LeadTapp] Bootstrap complete - service worker ready'))
    .catch((error) => console.error('[LeadTapp] Bootstrap failed:', error));
