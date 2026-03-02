/**
 * LeadTapp - Side Panel Controller
 *
 * Manages lead display, feedback collection, workflow dashboard, and user interactions.
 */

console.log('[LeadTapp] Side panel script loading...');

// =============================================================================
// Message Utilities
// =============================================================================

function send(msg) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(msg, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

// =============================================================================
// Dashboard State
// =============================================================================

let dashboardState = {
    sites: [],
    chains: [],
    recording: null,
    execution: null,
    expandedSites: new Set(),
    expandedChains: new Set(),
    crossTabRecording: false,
    liveStates: new Map() // siteId -> { state, lastUpdate, isPolling }
};

let pendingWorkflow = null; // Workflow awaiting variable input

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
    // Tab Navigation
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Recording Bar
    recordingBar: document.getElementById('recording-bar'),
    recordingCount: document.getElementById('recording-count'),
    btnStopRecording: document.getElementById('btn-stop-recording'),

    // Dashboard
    sitesList: document.getElementById('sites-list'),
    chainsList: document.getElementById('chains-list'),
    emptyDashboard: document.getElementById('empty-dashboard'),
    btnStartRecording: document.getElementById('btn-start-recording'),
    btnRefreshDashboard: document.getElementById('btn-refresh-dashboard'),

    // Variable Modal
    variableModal: document.getElementById('variable-modal'),
    variableInputs: document.getElementById('variable-inputs'),
    modalWorkflowName: document.getElementById('modal-workflow-name'),
    btnCancelVariable: document.getElementById('btn-cancel-variable'),
    btnRunVariable: document.getElementById('btn-run-variable'),

    // Workflow Editor Modal
    workflowEditorModal: document.getElementById('workflow-editor-modal'),
    editorWorkflowName: document.getElementById('editor-workflow-name'),
    editorNameInput: document.getElementById('editor-name-input'),
    editorActionsList: document.getElementById('editor-actions-list'),

    // Progress
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),

    // Lead Card
    leadCard: document.getElementById('lead-card'),
    leadTier: document.getElementById('lead-tier'),
    leadType: document.getElementById('lead-type'),
    leadSource: document.getElementById('lead-source'),
    leadScore: document.getElementById('lead-score'),
    leadName: document.getElementById('lead-name'),
    leadPhone: document.getElementById('lead-phone'),
    leadEmail: document.getElementById('lead-email'),
    leadAddress: document.getElementById('lead-address-text'),
    leadProperty: document.getElementById('lead-property'),
    leadValue: document.getElementById('lead-value'),
    leadTime: document.getElementById('lead-time'),
    leadTags: document.getElementById('lead-tags'),

    // Empty State
    emptyState: document.getElementById('empty-state'),

    // Feedback
    feedbackSection: document.getElementById('feedback-section'),
    outcomeButtons: document.querySelectorAll('.outcome-btn'),
    notesInput: document.getElementById('notes-input'),
    followupSection: document.getElementById('followup-section'),
    followupDate: document.getElementById('followup-date'),

    // Actions
    btnNext: document.getElementById('btn-next'),
    btnExport: document.getElementById('btn-export'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnRefreshEmpty: document.getElementById('btn-refresh-empty'),

    // Stats
    statCalls: document.getElementById('stat-calls'),
    statAppointments: document.getElementById('stat-appointments'),
    statCallbacks: document.getElementById('stat-callbacks'),

    // Toast
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),

    // AI Chat
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    btnSendChat: document.getElementById('btn-send-chat'),
    btnMic: document.getElementById('btn-mic'),
    btnAiSettings: document.getElementById('btn-ai-settings'),
    llmStatusIndicator: document.getElementById('llm-status-indicator'),
    llmStatusText: document.getElementById('llm-status-text'),
    chatSuggestions: document.querySelectorAll('.suggestion-btn'),
    chatWelcome: document.getElementById('chat-welcome'),

    // Speech / Call Listening
    listeningBanner: document.getElementById('listening-banner'),
    listeningModeLabel: document.getElementById('listening-mode-label'),
    btnStopListening: document.getElementById('btn-stop-listening'),
    coachingSuggestion: document.getElementById('coaching-suggestion'),
    coachingText: document.getElementById('coaching-text'),
    btnDismissCoaching: document.getElementById('btn-dismiss-coaching'),
    detectedActions: document.getElementById('detected-actions'),
    detectedActionsList: document.getElementById('detected-actions-list'),
    actionCount: document.getElementById('action-count'),
    btnCreateWorkflow: document.getElementById('btn-create-workflow'),
    hintDefault: document.getElementById('hint-default'),
    hintListening: document.getElementById('hint-listening'),

    // AI Settings Modal
    aiSettingsModal: document.getElementById('ai-settings-modal'),
    llmProviderSelect: document.getElementById('llm-provider'),
    apiKeyInput: document.getElementById('llm-api-key'),
    llmBaseUrlInput: document.getElementById('llm-base-url'),
    localUrlGroup: document.getElementById('local-url-group'),
    modelSelect: document.getElementById('llm-model'),
    temperatureSlider: document.getElementById('llm-temperature'),
    temperatureValue: document.getElementById('temperature-value'),
    maxTokensInput: document.getElementById('llm-max-tokens'),
    systemPromptInput: document.getElementById('llm-system-prompt'),
    btnTestConnection: document.getElementById('btn-test-llm'),
    btnSaveAiSettings: document.getElementById('btn-save-llm'),

    // Speech Settings (in AI Settings Modal)
    speechBackendSelect: document.getElementById('speech-backend'),
    whisperApiKeyInput: document.getElementById('whisper-api-key'),
    whisperKeyGroup: document.getElementById('whisper-key-group'),
    silenceThresholdInput: document.getElementById('silence-threshold'),

    // Panel Mode
    panelModeButtons: document.querySelectorAll('.panel-mode-btn'),
    panelModeInfo: document.querySelector('.panel-mode-info .info-text')
};

// =============================================================================
// State
// =============================================================================

let currentLead = null;
let selectedOutcome = null;
let currentIndex = 0;
let totalLeads = 0;

// Chat State
let chatState = {
    messages: [],
    isConnected: false,
    isLoading: false,
    config: null
};

// Speech Recognition State
let speechState = {
    isListening: false,
    mode: 'coaching', // 'coaching' or 'logging'
    recognition: null,
    detectedActions: [],
    currentCoaching: null
};

// =============================================================================
// Initialization
// =============================================================================

async function init() {
    console.log('[LeadTapp] Initializing side panel...');

    // Get current state from background
    const response = await send({ type: 'leadtapp/getState' });

    if (response?.state) {
        const state = response.state;
        currentLead = state.currentLead;
        currentIndex = state.currentLeadIndex;
        totalLeads = state.totalLeads;
        updateStats(state.sessionStats);
    }

    // Update recording state if present
    if (response?.workflowState?.recording?.isRecording) {
        showRecordingBar(response.workflowState.recording.actions?.length || 0);
    }

    // Update UI
    if (currentLead) {
        renderLead(currentLead);
        showLeadCard();
    } else {
        // Try to get first lead
        await getNextLead();
    }

    updateProgress();
    setupEventListeners();
    setupTabNavigation();
    setupDashboardListeners();
    setupModalListeners();
    setupChatListeners();

    // Load dashboard data
    await refreshDashboard();

    // Initialize chat
    await initializeChat();

    // Initialize panel mode
    await initializePanelMode();
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners() {
    // Outcome buttons
    elements.outcomeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const outcome = btn.dataset.outcome;
            selectOutcome(outcome);
        });
    });

    // Notes input - enable/disable next button
    elements.notesInput.addEventListener('input', validateFeedback);

    // Next button
    elements.btnNext.addEventListener('click', handleNext);

    // Export button
    elements.btnExport.addEventListener('click', handleExport);

    // Refresh buttons
    elements.btnRefresh.addEventListener('click', handleRefresh);
    elements.btnRefreshEmpty?.addEventListener('click', handleRefresh);

    // Listen for keyboard shortcut commands from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'leadtapp/command/next') {
            handleNext();
            sendResponse({ received: true });
        }
        return true;
    });
}

// =============================================================================
// Lead Display
// =============================================================================

function renderLead(lead) {
    // Header
    elements.leadTier.textContent = lead.tier || 'B';
    elements.leadTier.dataset.tier = lead.tier || 'B';
    elements.leadType.textContent = formatLeadType(lead.leadType);
    elements.leadSource.textContent = lead.source;
    elements.leadScore.textContent = lead.score?.toString() || '--';

    // Name
    elements.leadName.textContent = lead.name;

    // Contact
    elements.leadPhone.href = `tel:${lead.phone}`;
    elements.leadPhone.querySelector('span').textContent = lead.phone;

    if (lead.email) {
        elements.leadEmail.href = `mailto:${lead.email}`;
        elements.leadEmail.querySelector('span').textContent = lead.email;
        elements.leadEmail.classList.remove('hidden');
    } else {
        elements.leadEmail.classList.add('hidden');
    }

    // Address
    const addressParts = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean);
    elements.leadAddress.textContent = addressParts.join(', ') || 'No address';

    // Details
    elements.leadProperty.textContent = lead.propertyType || '--';
    elements.leadValue.textContent = lead.estimatedValue
        ? formatCurrency(lead.estimatedValue)
        : '--';
    elements.leadTime.textContent = lead.bestCallTime || '--';

    // Tags
    elements.leadTags.innerHTML = '';
    if (lead.tags && lead.tags.length > 0) {
        lead.tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'lead-tag';
            if (tag.toLowerCase().includes('hot') || tag.toLowerCase().includes('urgent')) {
                tagEl.classList.add('hot');
            }
            tagEl.textContent = tag;
            elements.leadTags.appendChild(tagEl);
        });
    }

    // Reset feedback form
    resetFeedbackForm();
}

function showLeadCard() {
    elements.leadCard.classList.remove('hidden');
    elements.feedbackSection.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
}

function showEmptyState() {
    elements.leadCard.classList.add('hidden');
    elements.feedbackSection.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
}

// =============================================================================
// Feedback Management
// =============================================================================

function selectOutcome(outcome) {
    selectedOutcome = outcome;

    // Update button states
    elements.outcomeButtons.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.outcome === outcome);
    });

    // Show follow-up date for callback/appointment
    if (outcome === 'connected_callback' || outcome === 'connected_appointment') {
        elements.followupSection.classList.remove('hidden');
        // Set default to tomorrow 10am
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        elements.followupDate.value = tomorrow.toISOString().slice(0, 16);
    } else {
        elements.followupSection.classList.add('hidden');
    }

    validateFeedback();
}

function validateFeedback() {
    const hasOutcome = selectedOutcome !== null;
    const hasNotes = elements.notesInput.value.trim().length > 0;

    elements.btnNext.disabled = !(hasOutcome && hasNotes);

    // Visual feedback for notes requirement
    if (hasOutcome && !hasNotes) {
        elements.notesInput.classList.add('error');
    } else {
        elements.notesInput.classList.remove('error');
    }
}

function resetFeedbackForm() {
    selectedOutcome = null;
    elements.notesInput.value = '';
    elements.followupDate.value = '';
    elements.followupSection.classList.add('hidden');
    elements.outcomeButtons.forEach(btn => btn.classList.remove('selected'));
    elements.notesInput.classList.remove('error');
    elements.btnNext.disabled = true;
}

// =============================================================================
// Actions
// =============================================================================

async function handleNext() {
    if (!selectedOutcome || !elements.notesInput.value.trim()) {
        showToast('Please select an outcome and add notes', 'error');
        return;
    }

    elements.btnNext.disabled = true;
    elements.btnNext.querySelector('span').textContent = 'Saving...';

    // Submit feedback
    const feedback = {
        leadId: currentLead?.id || '',
        outcome: selectedOutcome,
        notes: elements.notesInput.value.trim(),
        followUpDate: elements.followupDate.value || undefined
    };

    const feedbackResponse = await send({
        type: 'leadtapp/feedback/submit',
        feedback
    });

    if (!feedbackResponse?.success) {
        showToast(feedbackResponse?.error || 'Failed to save feedback', 'error');
        elements.btnNext.disabled = false;
        elements.btnNext.querySelector('span').textContent = 'Submit & Next Lead';
        return;
    }

    // Update stats
    if (feedbackResponse.stats) {
        updateStats(feedbackResponse.stats);
    }

    // Show success for appointment
    if (selectedOutcome === 'connected_appointment') {
        showToast('Appointment set! Great work!', 'success');
    }

    elements.btnNext.querySelector('span').textContent = 'Submit & Next Lead';

    // Get next lead
    await getNextLead();
}

async function getNextLead() {
    const response = await send({ type: 'leadtapp/lead/next' });

    if (response?.requiresFeedback) {
        showToast('Please complete feedback before advancing', 'error');
        return;
    }

    if (response?.lead) {
        currentLead = response.lead;
        currentIndex = response.index;
        totalLeads = response.total;
        renderLead(currentLead);
        showLeadCard();
    } else {
        currentLead = null;
        showEmptyState();
    }

    updateProgress();
}

async function handleExport() {
    const response = await send({ type: 'leadtapp/export/csv' });

    if (response?.success) {
        showToast(`Exported ${response.rowCount} leads to CSV`, 'success');
    } else {
        showToast(response?.error || 'Export failed', 'error');
    }
}

async function handleRefresh() {
    const response = await send({ type: 'leadtapp/lead/refresh' });

    if (response?.success) {
        totalLeads = response.total;
        currentIndex = -1;
        await getNextLead();
        showToast('Leads refreshed', 'success');
    }
}

// =============================================================================
// UI Updates
// =============================================================================

function updateProgress() {
    const progress = totalLeads > 0 ? ((currentIndex + 1) / totalLeads) * 100 : 0;
    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `${currentIndex + 1} / ${totalLeads}`;
}

function updateStats(stats) {
    elements.statCalls.textContent = stats.callsMade.toString();
    elements.statAppointments.textContent = stats.appointmentsSet.toString();
    elements.statCallbacks.textContent = stats.callbacksScheduled.toString();
}

function showToast(message, type = 'success') {
    elements.toast.className = `toast ${type}`;
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('hidden');

    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, 3000);
}

// =============================================================================
// Utilities
// =============================================================================

function formatLeadType(type) {
    const map = {
        buyer: 'Buyer',
        seller: 'Seller',
        investor: 'Investor',
        renter: 'Renter',
        fsbo: 'FSBO',
        expired: 'Expired',
        circle_prospect: 'Circle',
        sphere: 'Sphere',
        referral: 'Referral',
        other: 'Other'
    };
    return map[type] || type;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(value);
}

// =============================================================================
// Tab Navigation
// =============================================================================

function setupTabNavigation() {
    elements.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Update button states
    elements.tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update content visibility
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
    });

    // Refresh dashboard when switching to it
    if (tabId === 'dashboard') {
        refreshDashboard();
    }
}

// =============================================================================
// Dashboard Management
// =============================================================================

function setupDashboardListeners() {
    // Start recording button
    elements.btnStartRecording?.addEventListener('click', startRecording);

    // Stop recording button
    elements.btnStopRecording?.addEventListener('click', stopRecording);

    // Refresh dashboard button
    elements.btnRefreshDashboard?.addEventListener('click', refreshDashboard);

    // Listen for execution progress, recording updates, and live state
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'leadtapp/executor/progress') {
            updateExecutionProgress(message);
            sendResponse({ received: true });
        } else if (message.type === 'leadtapp/executor/error') {
            handleExecutionError(message);
            sendResponse({ received: true });
        } else if (message.type === 'leadtapp/recording/action') {
            // Update recording count in real-time
            updateRecordingCount(message.count);
            sendResponse({ received: true });
        } else if (message.type === 'leadtapp/site/state') {
            // Live state update from polling
            handleLiveStateUpdate(message.siteId, message.state);
            sendResponse({ received: true });
        }
        return true;
    });
}

async function refreshDashboard() {
    console.log('[LeadTapp] Refreshing dashboard...');

    const response = await send({ type: 'leadtapp/getDashboardState' });

    if (response) {
        dashboardState.sites = response.sites || [];
        dashboardState.chains = response.chains || [];
        dashboardState.recording = response.recording;
        dashboardState.execution = response.execution;

        renderDashboard();
    }
}

function renderDashboard() {
    const { sites, chains } = dashboardState;

    // Check if we have any workflows
    const hasWorkflows = sites.some(s => s.workflows && s.workflows.length > 0);

    if (!hasWorkflows && chains.length === 0) {
        elements.sitesList.innerHTML = '';
        elements.chainsList.innerHTML = '';
        elements.emptyDashboard?.classList.remove('hidden');
        return;
    }

    elements.emptyDashboard?.classList.add('hidden');

    // Render sites with workflows
    renderSites(sites);

    // Render chains
    renderChains(chains);
}

function renderSites(sites) {
    const sitesWithWorkflows = sites.filter(s => s.workflows && s.workflows.length > 0);

    if (sitesWithWorkflows.length === 0) {
        elements.sitesList.innerHTML = '<p class="empty-text">No workflows recorded yet</p>';
        return;
    }

    elements.sitesList.innerHTML = sitesWithWorkflows.map(site => {
        const isExpanded = dashboardState.expandedSites.has(site.id);
        const workflowCount = site.workflows.length;
        const liveData = dashboardState.liveStates.get(site.id);
        const isPolling = liveData?.isPolling || false;

        // Get state values to display
        const stateEntries = liveData?.state
            ? Object.entries(liveData.state).filter(([key]) => !['url', 'title', 'timestamp'].includes(key))
            : [];

        return `
            <div class="site-card" data-site-id="${site.id}">
                <div class="site-header" onclick="toggleSite('${site.id}')">
                    <div class="site-info">
                        <img class="site-favicon" src="${site.favicon || 'icons/icon-16.png'}" alt="" onerror="this.src='icons/icon-16.png'">
                        <span class="site-name">${escapeHtml(site.name)}</span>
                    </div>
                    <div class="site-meta">
                        <button class="polling-toggle ${isPolling ? 'active' : ''}"
                                data-site-id="${site.id}"
                                onclick="event.stopPropagation(); togglePolling('${site.id}')"
                                title="${isPolling ? 'Stop monitoring' : 'Start live monitoring'}">
                            ${isPolling ? '<span class="pulse-dot"></span> Live' : '<span>📡</span> Monitor'}
                        </button>
                        <span class="workflow-count">${workflowCount} workflow${workflowCount !== 1 ? 's' : ''}</span>
                        <span class="site-chevron">${isExpanded ? '▼' : '▶'}</span>
                    </div>
                </div>
                ${stateEntries.length > 0 ? `
                    <div class="site-live-state">
                        <div class="live-state-values">
                            ${stateEntries.map(([key, value]) => `
                                <span class="state-chip">
                                    <span class="state-key">${escapeHtml(key)}:</span>
                                    <span class="state-value">${escapeHtml(String(value))}</span>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div class="site-workflows ${isExpanded ? '' : 'hidden'}">
                    ${site.workflows.map(wf => renderWorkflowItem(wf, site)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderWorkflowItem(workflow, site) {
    const hasVariables = workflow.actions?.some(a => a.isVariable);
    const actionCount = workflow.actions?.length || 0;
    const icon = getWorkflowIcon(workflow.actions?.[0]?.type);
    const hasCondition = !!workflow.condition;

    // Check condition status if live state exists
    let conditionStatus = '';
    let conditionClass = '';
    if (hasCondition && site) {
        const liveData = dashboardState.liveStates.get(site.id);
        if (liveData?.state) {
            const met = evaluateCondition(workflow.condition, liveData.state);
            conditionStatus = met ? '✓ Ready' : '⏳ Waiting';
            conditionClass = met ? 'condition-ready' : 'condition-waiting';
        } else {
            conditionStatus = '⚪ No data';
            conditionClass = 'condition-nodata';
        }
    }

    return `
        <div class="workflow-item ${conditionClass}" data-workflow-id="${workflow.id}">
            <span class="workflow-icon">${icon}</span>
            <div class="workflow-info">
                <span class="workflow-name">${escapeHtml(workflow.name)}</span>
                <span class="workflow-meta">
                    ${actionCount} step${actionCount !== 1 ? 's' : ''}
                    ${hasCondition ? `<span class="workflow-condition-status ${conditionClass}">${conditionStatus}</span>` : ''}
                </span>
            </div>
            <div class="workflow-actions">
                ${hasVariables ? `
                    <button class="btn-icon" onclick="promptVariables('${workflow.id}')" title="Run with variables">
                        <span>▶</span>
                    </button>
                ` : `
                    <button class="btn-icon" onclick="executeWorkflow('${workflow.id}')" title="Run workflow">
                        <span>▶</span>
                    </button>
                `}
                <button class="btn-icon ${hasCondition ? 'active' : ''}"
                        onclick="editWorkflowCondition('${workflow.id}')"
                        title="${hasCondition ? 'Edit condition' : 'Add condition'}">
                    <span>⚡</span>
                </button>
                <button class="btn-icon" onclick="editWorkflow('${workflow.id}')" title="Edit workflow">
                    <span>✏️</span>
                </button>
                <button class="btn-icon" onclick="deleteWorkflow('${workflow.id}')" title="Delete workflow">
                    <span>🗑️</span>
                </button>
            </div>
        </div>
    `;
}

function getWorkflowIcon(actionType) {
    const icons = {
        'click': '👆',
        'input': '⌨️',
        'select': '📋',
        'keypress': '⏎',
        'navigation': '🌐'
    };
    return icons[actionType] || '⚡';
}

function renderChains(chains) {
    // Add "Create Chain" button at top
    const createBtn = `
        <div class="chain-controls">
            <button class="btn-sm btn-outline" onclick="createNewChain()">
                <span>+</span> Create Chain
            </button>
            <button class="btn-sm btn-outline" onclick="startCrossTabRecording()">
                <span>🎬</span> Record Cross-Tab
            </button>
        </div>
    `;

    if (chains.length === 0) {
        elements.chainsList.innerHTML = createBtn + '<p class="empty-text">No workflow chains created</p>';
        return;
    }

    elements.chainsList.innerHTML = createBtn + chains.map(chain => {
        const stepCount = chain.steps?.length || 0;
        const isExpanded = dashboardState.expandedChains?.has(chain.id);

        return `
            <div class="chain-item ${isExpanded ? 'expanded' : ''}" data-chain-id="${chain.id}">
                <div class="chain-header" onclick="toggleChain('${chain.id}')">
                    <span class="chain-icon">${chain.icon || '🔗'}</span>
                    <div class="chain-info">
                        <span class="chain-name">${escapeHtml(chain.name)}</span>
                        <span class="chain-meta">${stepCount} step${stepCount !== 1 ? 's' : ''} across tabs</span>
                    </div>
                    <div class="chain-actions">
                        <button class="btn-icon" onclick="event.stopPropagation(); executeChain('${chain.id}')" title="Run chain">
                            <span>▶</span>
                        </button>
                        <button class="btn-icon" onclick="event.stopPropagation(); editChain('${chain.id}')" title="Edit chain">
                            <span>✏️</span>
                        </button>
                        <button class="btn-icon" onclick="event.stopPropagation(); deleteChain('${chain.id}')" title="Delete chain">
                            <span>🗑️</span>
                        </button>
                        <span class="chain-chevron">${isExpanded ? '▼' : '▶'}</span>
                    </div>
                </div>
                <div class="chain-steps ${isExpanded ? '' : 'hidden'}">
                    ${renderChainSteps(chain)}
                    <div class="chain-step-add">
                        <button class="btn-sm btn-ghost" onclick="addStepToChain('${chain.id}')">
                            + Add Workflow Step
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderChainSteps(chain) {
    if (!chain.steps || chain.steps.length === 0) {
        return '<p class="empty-text">No steps yet. Add workflows to this chain.</p>';
    }

    return chain.steps.map((step, index) => {
        const workflow = findWorkflowById(step.workflowId);
        const workflowName = workflow?.name || 'Unknown Workflow';

        return `
            <div class="chain-step" data-step-id="${step.id}" draggable="true">
                <span class="step-number">${index + 1}</span>
                <div class="step-info">
                    <span class="step-name">${escapeHtml(workflowName)}</span>
                    ${step.condition ? `<span class="step-condition">if: ${escapeHtml(step.condition)}</span>` : ''}
                </div>
                <div class="step-actions">
                    <button class="btn-icon" onclick="editChainStep('${chain.id}', '${step.id}')" title="Configure step">
                        <span>⚙️</span>
                    </button>
                    <button class="btn-icon" onclick="removeChainStep('${chain.id}', '${step.id}')" title="Remove step">
                        <span>×</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Site expansion toggle
window.toggleSite = function(siteId) {
    if (dashboardState.expandedSites.has(siteId)) {
        dashboardState.expandedSites.delete(siteId);
    } else {
        dashboardState.expandedSites.add(siteId);
    }
    renderDashboard();
};

// =============================================================================
// Recording Controls
// =============================================================================

async function startRecording() {
    console.log('[LeadTapp] Starting recording...');

    const response = await send({ type: 'leadtapp/recorder/start' });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showRecordingBar(0);
    showToast('Recording started. Perform actions in the page.', 'success');
}

async function stopRecording() {
    console.log('[LeadTapp] Stopping recording...');

    const response = await send({ type: 'leadtapp/recorder/stop' });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    hideRecordingBar();

    const actionCount = response?.workflow?.actions?.length || 0;
    if (actionCount > 0) {
        showToast(`Recorded ${actionCount} actions!`, 'success');
        await refreshDashboard();
    } else {
        showToast('No actions recorded', 'error');
    }
}

function showRecordingBar(actionCount) {
    elements.recordingBar?.classList.remove('hidden');
    updateRecordingCount(actionCount);
}

function hideRecordingBar() {
    elements.recordingBar?.classList.add('hidden');
}

function updateRecordingCount(count) {
    if (elements.recordingCount) {
        elements.recordingCount.textContent = `${count} action${count !== 1 ? 's' : ''} recorded`;
    }
}

// =============================================================================
// Workflow Execution
// =============================================================================

window.executeWorkflow = async function(workflowId) {
    console.log('[LeadTapp] Executing workflow:', workflowId);

    showToast('Running workflow...', 'success');

    const response = await send({
        type: 'leadtapp/workflow/execute',
        workflowId,
        variables: {}
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    if (response?.success) {
        showToast('Workflow completed!', 'success');
    }
};

window.promptVariables = function(workflowId) {
    // Find the workflow
    const workflow = findWorkflowById(workflowId);
    if (!workflow) {
        showToast('Workflow not found', 'error');
        return;
    }

    pendingWorkflow = workflow;

    // Get variable actions
    const variableActions = workflow.actions.filter(a => a.isVariable);

    if (variableActions.length === 0) {
        // No variables, just execute
        executeWorkflow(workflowId);
        return;
    }

    // Populate modal
    if (elements.modalWorkflowName) {
        elements.modalWorkflowName.textContent = workflow.name;
    }

    elements.variableInputs.innerHTML = variableActions.map(action => `
        <div class="variable-group">
            <label class="variable-label" for="var-${action.id}">
                ${escapeHtml(action.variableName || action.label)}
            </label>
            <input
                type="text"
                class="variable-input"
                id="var-${action.id}"
                data-action-id="${action.id}"
                data-variable-name="${action.variableName}"
                placeholder="${escapeHtml(action.variableDefault || '')}"
                value="${escapeHtml(action.variableDefault || '')}"
            >
        </div>
    `).join('');

    // Show modal
    elements.variableModal?.classList.remove('hidden');
};

function findWorkflowById(workflowId) {
    for (const site of dashboardState.sites) {
        const workflow = site.workflows?.find(w => w.id === workflowId);
        if (workflow) return workflow;
    }
    return null;
}

// Current workflow being edited
let editingWorkflow = null;
let editingActions = [];

window.editWorkflow = function(workflowId) {
    const workflow = findWorkflowById(workflowId);
    if (!workflow) {
        showToast('Workflow not found', 'error');
        return;
    }

    editingWorkflow = workflow;
    // Deep copy actions to track changes
    editingActions = JSON.parse(JSON.stringify(workflow.actions || []));

    // Populate modal
    elements.editorWorkflowName.textContent = workflow.name;
    elements.editorNameInput.value = workflow.name;
    elements.editorActionsList.innerHTML = renderEditorActions(editingActions);

    // Show modal
    elements.workflowEditorModal.classList.remove('hidden');
};

window.closeWorkflowEditor = function() {
    elements.workflowEditorModal.classList.add('hidden');
    editingWorkflow = null;
    editingActions = [];
};

window.saveWorkflowEdits = async function() {
    if (!editingWorkflow) return;

    const newName = elements.editorNameInput.value.trim();
    if (!newName) {
        showToast('Workflow name is required', 'error');
        return;
    }

    // Collect variable settings from form
    const actionItems = elements.editorActionsList.querySelectorAll('.editor-action-item');
    actionItems.forEach((item, index) => {
        const actionId = item.dataset.actionId;
        const action = editingActions.find(a => a.id === actionId);
        if (!action) return;

        const isVariableCheckbox = item.querySelector('.variable-toggle-checkbox');
        const variableNameInput = item.querySelector('.variable-name-input');
        const variableDefaultInput = item.querySelector('.variable-default-input');

        action.isVariable = isVariableCheckbox?.checked || false;
        action.variableName = variableNameInput?.value || action.label || `Input ${index + 1}`;
        action.variableDefault = variableDefaultInput?.value || '';
    });

    // Send updates to service worker
    const response = await send({
        type: 'leadtapp/workflow/update',
        workflowId: editingWorkflow.id,
        updates: {
            name: newName,
            actions: editingActions
        }
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Workflow saved', 'success');
    closeWorkflowEditor();
    await refreshDashboard();
};

window.toggleActionVariable = function(actionId) {
    const item = document.querySelector(`.editor-action-item[data-action-id="${actionId}"]`);
    const checkbox = item?.querySelector('.variable-toggle-checkbox');
    if (item && checkbox) {
        item.classList.toggle('is-variable', checkbox.checked);
    }
};

function renderEditorActions(actions) {
    if (!actions || actions.length === 0) {
        return '<p class="empty-text">No actions in this workflow</p>';
    }

    return actions.map((action, index) => {
        const typeIcon = getActionTypeIcon(action.type);
        const typeClass = action.type === 'input' ? 'input' : action.type === 'select' ? 'select' : 'click';
        const isVariable = action.isVariable || false;
        const variableName = action.variableName || action.label || `Input ${index + 1}`;
        const variableDefault = action.variableDefault || '';

        return `
            <div class="editor-action-item ${isVariable ? 'is-variable' : ''}" data-action-id="${action.id}">
                <div class="action-type-icon ${typeClass}">${typeIcon}</div>
                <div class="action-details">
                    <span class="action-name">${escapeHtml(action.label || action.type)}</span>
                    <span class="action-selector">${escapeHtml(action.selector?.substring(0, 50) || 'N/A')}</span>
                </div>
                <div class="action-variable-toggle">
                    <label>Variable</label>
                    <label class="toggle-switch">
                        <input type="checkbox" class="variable-toggle-checkbox"
                               ${isVariable ? 'checked' : ''}
                               onchange="toggleActionVariable('${action.id}')">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="variable-config">
                    <div class="variable-config-row">
                        <label>Name:</label>
                        <input type="text" class="variable-name-input" value="${escapeHtml(variableName)}" placeholder="Variable name">
                    </div>
                    <div class="variable-config-row">
                        <label>Default:</label>
                        <input type="text" class="variable-default-input" value="${escapeHtml(variableDefault)}" placeholder="Default value">
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getActionTypeIcon(type) {
    const icons = {
        'click': '👆',
        'input': '⌨️',
        'select': '📋',
        'keypress': '⏎',
        'navigation': '🌐',
        'scroll': '↕️',
        'hover': '👁️'
    };
    return icons[type] || '⚡';
}

window.deleteWorkflow = async function(workflowId) {
    if (!confirm('Delete this workflow?')) return;

    const response = await send({
        type: 'leadtapp/workflow/delete',
        workflowId
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Workflow deleted', 'success');
    await refreshDashboard();
};

window.executeChain = async function(chainId) {
    console.log('[LeadTapp] Executing chain:', chainId);

    showToast('Running workflow chain...', 'success');

    const response = await send({
        type: 'leadtapp/chain/execute',
        chainId,
        variables: {}
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    if (response?.success) {
        showToast('Chain completed!', 'success');
    }
};

// =============================================================================
// Chain Management
// =============================================================================

window.toggleChain = function(chainId) {
    if (dashboardState.expandedChains.has(chainId)) {
        dashboardState.expandedChains.delete(chainId);
    } else {
        dashboardState.expandedChains.add(chainId);
    }
    renderDashboard();
};

window.createNewChain = async function() {
    const name = prompt('Enter chain name:', 'My Workflow Chain');
    if (!name || !name.trim()) return;

    const response = await send({
        type: 'leadtapp/chain/create',
        name: name.trim(),
        description: ''
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Chain created!', 'success');
    await refreshDashboard();

    // Expand the newly created chain
    if (response?.chain?.id) {
        dashboardState.expandedChains.add(response.chain.id);
        renderDashboard();
    }
};

window.editChain = async function(chainId) {
    const chain = dashboardState.chains.find(c => c.id === chainId);
    if (!chain) {
        showToast('Chain not found', 'error');
        return;
    }

    const newName = prompt('Rename chain:', chain.name);
    if (!newName || !newName.trim() || newName.trim() === chain.name) return;

    const response = await send({
        type: 'leadtapp/chain/update',
        chainId,
        updates: { name: newName.trim() }
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Chain renamed!', 'success');
    await refreshDashboard();
};

window.deleteChain = async function(chainId) {
    if (!confirm('Delete this workflow chain? This cannot be undone.')) return;

    const response = await send({
        type: 'leadtapp/chain/delete',
        chainId
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    dashboardState.expandedChains.delete(chainId);
    showToast('Chain deleted', 'success');
    await refreshDashboard();
};

window.addStepToChain = async function(chainId) {
    // Get all available workflows
    const allWorkflows = [];
    for (const site of dashboardState.sites) {
        if (site.workflows) {
            for (const wf of site.workflows) {
                allWorkflows.push({ ...wf, siteName: site.name });
            }
        }
    }

    if (allWorkflows.length === 0) {
        showToast('No workflows available. Record some workflows first.', 'error');
        return;
    }

    // Open workflow picker modal
    const selectedWorkflow = await openWorkflowPickerModal(chainId, allWorkflows);

    if (!selectedWorkflow) return; // User cancelled

    const response = await send({
        type: 'leadtapp/chain/addStep',
        chainId,
        workflowId: selectedWorkflow.id,
        options: {}
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast(`Added "${selectedWorkflow.name}" to chain!`, 'success');
    await refreshDashboard();
};

window.editChainStep = async function(chainId, stepId) {
    const chain = dashboardState.chains.find(c => c.id === chainId);
    const step = chain?.steps?.find(s => s.id === stepId);

    if (!step) {
        showToast('Step not found', 'error');
        return;
    }

    // Open condition editor modal
    const condition = await openConditionEditorModal(chainId, stepId, step.condition || '');

    if (condition === null) return; // User cancelled

    const response = await send({
        type: 'leadtapp/chain/updateStep',
        chainId,
        stepId,
        updates: { condition: condition || null }
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Step updated', 'success');
    await refreshDashboard();
};

window.removeChainStep = async function(chainId, stepId) {
    if (!confirm('Remove this step from the chain?')) return;

    const response = await send({
        type: 'leadtapp/chain/removeStep',
        chainId,
        stepId
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Step removed', 'success');
    await refreshDashboard();
};

// =============================================================================
// Cross-Tab Recording
// =============================================================================

window.startCrossTabRecording = async function() {
    const name = prompt('Enter name for cross-tab workflow chain:', 'Cross-Tab Workflow');
    if (!name || !name.trim()) return;

    const response = await send({
        type: 'leadtapp/crossTab/startRecording',
        name: name.trim()
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    dashboardState.crossTabRecording = true;
    showCrossTabRecordingBar();
    showToast('Cross-tab recording started! Switch tabs and record actions.', 'success');
};

window.switchRecordingTab = async function() {
    const response = await send({
        type: 'leadtapp/crossTab/switchTab'
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    showToast('Switched recording to current tab', 'success');
};

window.stopCrossTabRecording = async function() {
    const response = await send({
        type: 'leadtapp/crossTab/stopRecording'
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    dashboardState.crossTabRecording = false;
    hideCrossTabRecordingBar();

    const stepCount = response?.chain?.steps?.length || 0;
    showToast(`Cross-tab chain saved with ${stepCount} workflows!`, 'success');
    await refreshDashboard();

    // Expand the newly created chain
    if (response?.chain?.id) {
        dashboardState.expandedChains.add(response.chain.id);
        renderDashboard();
    }
};

function showCrossTabRecordingBar() {
    // Update recording bar for cross-tab mode
    if (elements.recordingBar) {
        elements.recordingBar.classList.remove('hidden');
        elements.recordingBar.classList.add('cross-tab-mode');

        // Update button handlers
        if (elements.btnStopRecording) {
            elements.btnStopRecording.textContent = 'Finish Chain';
            elements.btnStopRecording.onclick = stopCrossTabRecording;
        }

        // Add switch tab button if not exists
        let switchBtn = document.getElementById('btn-switch-tab');
        if (!switchBtn && elements.recordingBar) {
            switchBtn = document.createElement('button');
            switchBtn.id = 'btn-switch-tab';
            switchBtn.className = 'btn-sm btn-outline';
            switchBtn.textContent = '+ Add Tab';
            switchBtn.onclick = switchRecordingTab;
            elements.recordingBar.appendChild(switchBtn);
        }
    }

    if (elements.recordingCount) {
        elements.recordingCount.textContent = 'Cross-tab recording active';
    }
}

function hideCrossTabRecordingBar() {
    if (elements.recordingBar) {
        elements.recordingBar.classList.add('hidden');
        elements.recordingBar.classList.remove('cross-tab-mode');

        // Restore normal stop button
        if (elements.btnStopRecording) {
            elements.btnStopRecording.textContent = 'Stop';
            elements.btnStopRecording.onclick = stopRecording;
        }

        // Remove switch tab button
        const switchBtn = document.getElementById('btn-switch-tab');
        if (switchBtn) switchBtn.remove();
    }
}

// =============================================================================
// Variable Modal
// =============================================================================

function setupModalListeners() {
    // Cancel button
    elements.btnCancelVariable?.addEventListener('click', closeVariableModal);

    // Run button
    elements.btnRunVariable?.addEventListener('click', runWithVariables);

    // Close on overlay click
    elements.variableModal?.addEventListener('click', (e) => {
        if (e.target === elements.variableModal || e.target.classList.contains('modal-overlay')) {
            closeVariableModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !elements.variableModal?.classList.contains('hidden')) {
            closeVariableModal();
        }
    });
}

function closeVariableModal() {
    elements.variableModal?.classList.add('hidden');
    pendingWorkflow = null;
}

async function runWithVariables() {
    if (!pendingWorkflow) return;

    // Collect variable values
    const variables = {};
    const inputs = elements.variableInputs.querySelectorAll('.variable-input');

    inputs.forEach(input => {
        const varName = input.dataset.variableName;
        if (varName) {
            variables[varName] = input.value;
        }
    });

    closeVariableModal();

    showToast('Running workflow...', 'success');

    const response = await send({
        type: 'leadtapp/workflow/execute',
        workflowId: pendingWorkflow.id,
        variables
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    if (response?.success) {
        showToast('Workflow completed!', 'success');
    }
}

// =============================================================================
// Execution Progress
// =============================================================================

function updateExecutionProgress(message) {
    const { workflowId, currentStep, totalSteps, currentAction } = message;
    console.log(`[LeadTapp] Execution progress: ${currentStep + 1}/${totalSteps} - ${currentAction}`);

    // Could add a progress indicator here
}

function handleExecutionError(message) {
    const { workflowId, step, action, error } = message;
    console.error(`[LeadTapp] Execution error at step ${step}: ${error}`);
    showToast(`Workflow failed: ${error}`, 'error');
}

// =============================================================================
// Utility Functions
// =============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================================================
// AI Chat
// =============================================================================

function setupChatListeners() {
    // Send button
    elements.btnSendChat?.addEventListener('click', handleSendMessage);

    // Enter key in input (shift+enter for newline)
    elements.chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-resize textarea
    elements.chatInput?.addEventListener('input', autoResizeTextarea);

    // AI Settings button
    elements.btnAiSettings?.addEventListener('click', openAiSettingsModal);

    // Suggestion buttons
    elements.chatSuggestions?.forEach(btn => {
        btn.addEventListener('click', () => {
            const suggestion = btn.textContent.trim();
            if (elements.chatInput) {
                elements.chatInput.value = suggestion;
                elements.chatInput.focus();
                autoResizeTextarea();
            }
        });
    });

    // AI Settings Modal
    elements.btnSaveAiSettings?.addEventListener('click', saveAiSettings);
    elements.btnCancelAiSettings?.addEventListener('click', closeAiSettingsModal);
    elements.btnTestConnection?.addEventListener('click', testLlmConnection);

    // Temperature slider
    elements.temperatureSlider?.addEventListener('input', () => {
        if (elements.temperatureValue) {
            elements.temperatureValue.textContent = elements.temperatureSlider.value;
        }
    });

    // Provider select - update model name placeholder
    elements.llmProviderSelect?.addEventListener('change', updateModelPlaceholder);

    // Close modal on overlay click
    elements.aiSettingsModal?.addEventListener('click', (e) => {
        if (e.target === elements.aiSettingsModal || e.target.classList.contains('modal-overlay')) {
            closeAiSettingsModal();
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !elements.aiSettingsModal?.classList.contains('hidden')) {
            closeAiSettingsModal();
        }
        // Also stop listening on Escape
        if (e.key === 'Escape' && speechState.isListening) {
            stopSpeechRecognition();
        }
    });

    // Mic button - toggle speech recognition
    elements.btnMic?.addEventListener('click', toggleSpeechRecognition);

    // Stop listening button
    elements.btnStopListening?.addEventListener('click', stopSpeechRecognition);

    // Dismiss coaching suggestion
    elements.btnDismissCoaching?.addEventListener('click', () => {
        elements.coachingSuggestion?.classList.add('hidden');
        speechState.currentCoaching = null;
    });

    // Create workflow from detected actions
    elements.btnCreateWorkflow?.addEventListener('click', createWorkflowFromDetectedActions);
}

async function initializeChat() {
    console.log('[LeadTapp] Initializing chat...');

    // Load LLM config
    const configResponse = await send({ type: 'leadtapp/llm/getConfig' });

    if (configResponse?.config) {
        chatState.config = configResponse.config;
        populateSettingsForm(configResponse.config);
    }

    // Check LLM status
    await checkLlmStatus();
}

async function checkLlmStatus() {
    const statusResponse = await send({ type: 'leadtapp/llm/status' });

    chatState.isConnected = statusResponse?.connected || false;
    updateLlmStatusUI(chatState.isConnected, statusResponse?.provider);
}

function updateLlmStatusUI(connected, provider) {
    if (elements.llmStatusIndicator) {
        elements.llmStatusIndicator.classList.toggle('connected', connected);
    }

    if (elements.llmStatusText) {
        if (connected && provider) {
            elements.llmStatusText.textContent = `Connected to ${provider}`;
        } else {
            elements.llmStatusText.textContent = 'Not configured';
        }
    }
}

async function handleSendMessage() {
    const message = elements.chatInput?.value?.trim();
    if (!message || chatState.isLoading) return;

    // Clear input and reset height
    if (elements.chatInput) {
        elements.chatInput.value = '';
        elements.chatInput.style.height = 'auto';
    }

    // Hide welcome state
    if (elements.chatWelcome) {
        elements.chatWelcome.classList.add('hidden');
    }

    // Add user message
    addMessageToChat('user', message);
    chatState.messages.push({ role: 'user', content: message });

    // Show typing indicator
    chatState.isLoading = true;
    showTypingIndicator();

    try {
        // Send to LLM
        const response = await send({
            type: 'leadtapp/llm/chat',
            messages: chatState.messages
        });

        // Hide typing indicator
        hideTypingIndicator();
        chatState.isLoading = false;

        if (response?.error) {
            addMessageToChat('assistant', `Error: ${response.error}`, true);
            return;
        }

        if (response?.content) {
            addMessageToChat('assistant', response.content);
            chatState.messages.push({ role: 'assistant', content: response.content });
        }
    } catch (err) {
        hideTypingIndicator();
        chatState.isLoading = false;
        addMessageToChat('assistant', `Error: ${err.message}`, true);
    }
}

function addMessageToChat(role, content, isError = false) {
    if (!elements.chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}${isError ? ' error' : ''}`;

    const avatarEl = document.createElement('div');
    avatarEl.className = 'message-avatar';
    avatarEl.textContent = role === 'user' ? 'U' : 'AI';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    // Simple markdown-like formatting
    const formattedContent = formatMessageContent(content);
    contentEl.innerHTML = formattedContent;

    messageEl.appendChild(avatarEl);
    messageEl.appendChild(contentEl);

    elements.chatMessages.appendChild(messageEl);

    // Scroll to bottom
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function formatMessageContent(content) {
    if (!content) return '';

    // Escape HTML first
    let formatted = escapeHtml(content);

    // Code blocks
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold and italic
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}

function showTypingIndicator() {
    if (!elements.chatMessages) return;

    // Remove existing indicator if any
    hideTypingIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant';
    indicator.id = 'typing-indicator';

    indicator.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;

    elements.chatMessages.appendChild(indicator);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function autoResizeTextarea() {
    if (!elements.chatInput) return;

    elements.chatInput.style.height = 'auto';
    const maxHeight = 120;
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, maxHeight) + 'px';
}

// =============================================================================
// AI Settings Modal
// =============================================================================

async function openAiSettingsModal() {
    elements.aiSettingsModal?.classList.remove('hidden');

    // Load current config
    if (chatState.config) {
        populateSettingsForm(chatState.config);
    }

    // Load speech config
    await loadSpeechSettings();

    // Set up speech backend change listener
    elements.speechBackendSelect?.addEventListener('change', updateSpeechBackendUI);
    updateSpeechBackendUI();
}

function closeAiSettingsModal() {
    elements.aiSettingsModal?.classList.add('hidden');
    resetTestButton();
}

function populateSettingsForm(config) {
    if (elements.llmProviderSelect) {
        elements.llmProviderSelect.value = config.provider || 'openai';
    }
    if (elements.apiKeyInput) {
        elements.apiKeyInput.value = config.apiKey || '';
    }
    if (elements.modelNameInput) {
        elements.modelNameInput.value = config.model || '';
    }
    if (elements.temperatureSlider) {
        elements.temperatureSlider.value = config.temperature ?? 0.7;
    }
    if (elements.temperatureValue) {
        elements.temperatureValue.textContent = (config.temperature ?? 0.7).toString();
    }
    if (elements.maxTokensInput) {
        elements.maxTokensInput.value = config.maxTokens || 2048;
    }
    if (elements.systemPromptInput) {
        elements.systemPromptInput.value = config.systemPrompt || '';
    }

    updateModelPlaceholder();
}

function updateModelPlaceholder() {
    if (!elements.modelNameInput || !elements.llmProviderSelect) return;

    const provider = elements.llmProviderSelect.value;
    const placeholders = {
        openai: 'gpt-4o',
        anthropic: 'claude-3-5-sonnet-20241022',
        local: 'llama3.2',
        mcp: 'server-name/tool'
    };

    elements.modelNameInput.placeholder = placeholders[provider] || 'Model name';
}

async function saveAiSettings() {
    const config = {
        provider: elements.llmProviderSelect?.value || 'openai',
        apiKey: elements.apiKeyInput?.value?.trim() || '',
        model: elements.modelNameInput?.value?.trim() || '',
        temperature: parseFloat(elements.temperatureSlider?.value) || 0.7,
        maxTokens: parseInt(elements.maxTokensInput?.value) || 2048,
        systemPrompt: elements.systemPromptInput?.value?.trim() || ''
    };

    const response = await send({
        type: 'leadtapp/llm/setConfig',
        config
    });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    // Save speech settings alongside LLM settings
    const speechSaved = await saveSpeechSettings();
    if (!speechSaved) {
        showToast('AI settings saved, but speech settings failed', 'warning');
    }

    chatState.config = config;
    showToast('AI settings saved', 'success');
    closeAiSettingsModal();

    // Check status with new config
    await checkLlmStatus();
}

async function testLlmConnection() {
    const config = {
        provider: elements.llmProviderSelect?.value || 'openai',
        apiKey: elements.apiKeyInput?.value?.trim() || '',
        model: elements.modelNameInput?.value?.trim() || ''
    };

    if (!config.apiKey && config.provider !== 'local') {
        showToast('API key required', 'error');
        return;
    }

    // Update button state
    if (elements.btnTestConnection) {
        elements.btnTestConnection.disabled = true;
        elements.btnTestConnection.textContent = 'Testing...';
        elements.btnTestConnection.classList.remove('success', 'error');
    }

    const response = await send({
        type: 'leadtapp/llm/test',
        config
    });

    if (elements.btnTestConnection) {
        elements.btnTestConnection.disabled = false;

        if (response?.success) {
            elements.btnTestConnection.textContent = 'Connected!';
            elements.btnTestConnection.classList.add('success');
        } else {
            elements.btnTestConnection.textContent = 'Failed';
            elements.btnTestConnection.classList.add('error');
            showToast(response?.error || 'Connection failed', 'error');
        }
    }
}

function resetTestButton() {
    if (elements.btnTestConnection) {
        elements.btnTestConnection.disabled = false;
        elements.btnTestConnection.textContent = 'Test Connection';
        elements.btnTestConnection.classList.remove('success', 'error');
    }
}

// =============================================================================
// Speech Settings (Call Listening Configuration)
// =============================================================================

/**
 * Load speech recognition settings from storage and populate form
 */
async function loadSpeechSettings() {
    try {
        const result = await chrome.storage.local.get('speechConfig');
        const speechConfig = result.speechConfig || {
            backend: 'webspeech',
            openaiApiKey: '',
            silenceThresholdMs: 2000
        };

        // Populate form fields
        if (elements.speechBackendSelect) {
            elements.speechBackendSelect.value = speechConfig.backend || 'webspeech';
        }
        if (elements.whisperApiKeyInput) {
            elements.whisperApiKeyInput.value = speechConfig.openaiApiKey || '';
        }
        if (elements.silenceThresholdInput) {
            elements.silenceThresholdInput.value = speechConfig.silenceThresholdMs || 2000;
        }

        console.log('[LeadTapp] Speech settings loaded:', speechConfig.backend);
    } catch (err) {
        console.error('[LeadTapp] Failed to load speech settings:', err);
    }
}

/**
 * Update speech backend UI based on selection
 * Shows/hides Whisper API key field
 */
function updateSpeechBackendUI() {
    const backend = elements.speechBackendSelect?.value || 'webspeech';

    if (elements.whisperKeyGroup) {
        if (backend === 'whisper') {
            elements.whisperKeyGroup.classList.remove('hidden');
        } else {
            elements.whisperKeyGroup.classList.add('hidden');
        }
    }
}

/**
 * Save speech recognition settings to storage
 * Also reconfigures SpeechRecognitionManager if active
 */
async function saveSpeechSettings() {
    const speechConfig = {
        backend: elements.speechBackendSelect?.value || 'webspeech',
        openaiApiKey: elements.whisperApiKeyInput?.value?.trim() || '',
        silenceThresholdMs: parseInt(elements.silenceThresholdInput?.value) || 2000
    };

    // If Whisper selected but no dedicated key, try to use main LLM key if provider is OpenAI
    if (speechConfig.backend === 'whisper' && !speechConfig.openaiApiKey) {
        const provider = elements.llmProviderSelect?.value;
        const llmKey = elements.apiKeyInput?.value?.trim();
        if (provider === 'openai' && llmKey) {
            speechConfig.openaiApiKey = llmKey;
        }
    }

    try {
        await chrome.storage.local.set({ speechConfig });
        console.log('[LeadTapp] Speech settings saved:', speechConfig.backend);

        // Reconfigure speech recognition manager if it exists
        if (typeof speechRecognitionManager !== 'undefined' && speechRecognitionManager) {
            speechRecognitionManager.configure(speechConfig);
        }

        return true;
    } catch (err) {
        console.error('[LeadTapp] Failed to save speech settings:', err);
        return false;
    }
}

// =============================================================================
// Speech Recognition / Call Listening
// Uses SpeechRecognitionManager from speech-recognition.js
// Supports: Web Speech API (free, real-time) + OpenAI Whisper (high accuracy)
// =============================================================================

/**
 * Initialize speech recognition with SpeechRecognitionManager
 * This connects the robust speech-recognition.js module to the UI
 */
async function initSpeechRecognition() {
    // Check if SpeechRecognitionManager is available (loaded from speech-recognition.js)
    if (!window.speechRecognitionManager) {
        console.warn('[LeadTapp] SpeechRecognitionManager not loaded');
        elements.btnMic?.classList.add('hidden');
        return null;
    }

    const manager = window.speechRecognitionManager;

    // Load speech configuration from storage
    const { speechConfig = {} } = await chrome.storage.local.get('speechConfig');

    // Configure with stored settings
    manager.configure({
        backend: speechConfig.backend || 'webspeech',
        openaiApiKey: speechConfig.openaiApiKey || null,
        mode: 'coaching',
        silenceThresholdMs: speechConfig.silenceThresholdMs || 2000
    });

    // Set up transcript callback
    manager.onTranscript = async (entry) => {
        console.log('[LeadTapp] Transcript received:', entry.text.substring(0, 50) + '...');

        // Only process final results to reduce noise
        if (entry.isFinal) {
            // Send to service worker for processing
            const response = await send({
                type: 'leadtapp/speech/transcript',
                text: entry.text,
                timestamp: entry.timestamp,
                isFinal: true,
                confidence: entry.confidence,
                speaker: 'agent'
            });

            // Handle coaching suggestions
            if (response?.coaching) {
                showCoachingSuggestion(response.coaching);
            }

            // Handle detected actions
            if (response?.detectedActions) {
                speechState.detectedActions = response.detectedActions;
                updateDetectedActionsUI();
            }
        }
    };

    // Set up error callback
    manager.onError = (error) => {
        console.error('[LeadTapp] Speech recognition error:', error);

        if (error === 'not-allowed' || error.includes?.('denied')) {
            showToast('Microphone access denied. Please allow microphone access.', 'error');
            speechState.isListening = false;
            updateSpeechUI();
        } else if (error !== 'no-speech' && error !== 'aborted') {
            showToast(`Speech error: ${error}`, 'error');
        }
    };

    // Set up state change callback
    manager.onStateChange = (state) => {
        console.log('[LeadTapp] Speech state changed:', state);
        speechState.isListening = (state === 'listening');
        updateSpeechUI();
    };

    console.log('[LeadTapp] Speech recognition initialized:', manager.getState());
    return manager;
}

/**
 * Toggle speech recognition on/off
 */
async function toggleSpeechRecognition() {
    if (speechState.isListening) {
        stopSpeechRecognition();
    } else {
        startSpeechRecognition();
    }
}

/**
 * Start speech recognition using SpeechRecognitionManager
 */
async function startSpeechRecognition() {
    // Initialize recognition if not done
    if (!speechState.recognition) {
        speechState.recognition = await initSpeechRecognition();
    }

    if (!speechState.recognition) {
        showToast('Speech recognition not supported in this browser', 'error');
        return;
    }

    try {
        // Determine mode based on context
        speechState.mode = 'coaching';
        speechState.detectedActions = [];

        // Start listening with the manager
        const result = await speechState.recognition.startListening({
            mode: speechState.mode
        });

        if (!result.success) {
            showToast(result.error || 'Failed to start listening', 'error');
            return;
        }

        speechState.isListening = true;
        updateSpeechUI();

        // Show backend info
        const backend = result.backend === 'whisper' ? 'Whisper AI' : 'Web Speech';
        console.log('[LeadTapp] Started speech recognition with', backend, 'in', speechState.mode, 'mode');
    } catch (e) {
        console.error('[LeadTapp] Failed to start speech recognition:', e);
        showToast('Failed to start listening: ' + e.message, 'error');
    }
}

/**
 * Stop speech recognition using SpeechRecognitionManager
 */
async function stopSpeechRecognition() {
    if (speechState.recognition) {
        speechState.recognition.stopListening();
    }

    speechState.isListening = false;

    // Notify service worker
    await send({ type: 'leadtapp/speech/stop' });

    // Generate auto-notes if we have detected actions
    if (speechState.detectedActions.length > 0) {
        const notesResponse = await send({ type: 'leadtapp/speech/generateNotes' });
        if (notesResponse?.notes) {
            showToast(`Call notes ready: ${speechState.detectedActions.length} actions detected`, 'success');
        }
    }

    updateSpeechUI();
    console.log('[LeadTapp] Speech recognition stopped');
}

/**
 * Update UI to reflect speech state
 */
function updateSpeechUI() {
    const isListening = speechState.isListening;

    // Mic button state
    if (elements.btnMic) {
        elements.btnMic.classList.toggle('listening', isListening);
        elements.btnMic.title = isListening ? 'Stop listening' : 'Start listening (call coaching)';
    }

    // Listening banner
    if (elements.listeningBanner) {
        elements.listeningBanner.classList.toggle('hidden', !isListening);
    }

    // Mode label
    if (elements.listeningModeLabel) {
        elements.listeningModeLabel.textContent =
            speechState.mode === 'coaching' ? 'Coaching Mode' : 'Logging Mode';
    }

    // Input hints
    if (elements.hintDefault && elements.hintListening) {
        elements.hintDefault.classList.toggle('hidden', isListening);
        elements.hintListening.classList.toggle('hidden', !isListening);
    }

    // Hide coaching when not listening
    if (!isListening && elements.coachingSuggestion) {
        elements.coachingSuggestion.classList.add('hidden');
    }
}

/**
 * Show coaching suggestion from AI
 */
function showCoachingSuggestion(suggestion) {
    if (!suggestion || !elements.coachingSuggestion || !elements.coachingText) {
        return;
    }

    speechState.currentCoaching = suggestion;
    elements.coachingText.textContent = suggestion;
    elements.coachingSuggestion.classList.remove('hidden');

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
        if (speechState.currentCoaching === suggestion) {
            elements.coachingSuggestion?.classList.add('hidden');
        }
    }, 10000);
}

/**
 * Update detected actions UI
 */
function updateDetectedActionsUI() {
    if (!elements.detectedActions || !elements.detectedActionsList || !elements.actionCount) {
        return;
    }

    const actions = speechState.detectedActions;

    if (actions.length === 0) {
        elements.detectedActions.classList.add('hidden');
        return;
    }

    elements.detectedActions.classList.remove('hidden');
    elements.actionCount.textContent = actions.length;

    // Build action tags
    elements.detectedActionsList.innerHTML = actions.map(action => `
        <span class="detected-action-tag">
            <span class="action-type">${escapeHtml(action.type)}</span>
            ${action.value ? `<span class="action-value">${escapeHtml(action.value)}</span>` : ''}
        </span>
    `).join('');
}

/**
 * Create a workflow from detected actions
 */
async function createWorkflowFromDetectedActions() {
    if (speechState.detectedActions.length === 0) {
        showToast('No actions detected to create workflow', 'warning');
        return;
    }

    // Get suggested workflow from service worker
    const response = await send({ type: 'leadtapp/speech/generateNotes' });

    if (response?.suggestedWorkflow) {
        // Add to chat as a message for user to review
        const workflowSummary = response.suggestedWorkflow;
        addMessage('assistant', `Based on your call, here's a suggested workflow:\n\n${workflowSummary}\n\nWould you like me to create this workflow?`);

        // Clear detected actions
        speechState.detectedActions = [];
        updateDetectedActionsUI();

        // Clear transcript in service worker
        await send({ type: 'leadtapp/speech/clearTranscript' });
    } else {
        showToast('Could not generate workflow', 'error');
    }
}

// =============================================================================
// Panel Mode Management
// =============================================================================

const PANEL_MODE_DESCRIPTIONS = {
    sidepanel: 'Native Chrome side panel. Most stable, persists across tabs.',
    floating: 'Draggable window that stays on top. Move freely, resize as needed.',
    topbar: 'Collapsible bar at top of page. Click to expand, minimal footprint.'
};

/**
 * Initialize panel mode UI and load current setting
 */
async function initializePanelMode() {
    console.log('[LeadTapp] Initializing panel mode...');

    // Get current mode from service worker
    const response = await send({ type: 'leadtapp/panel/getSettings' });
    const currentMode = response?.settings?.mode || 'sidepanel';

    // Update UI to reflect current mode
    updatePanelModeUI(currentMode);

    // Set up click handlers for mode buttons
    setupPanelModeListeners();
}

/**
 * Set up event listeners for panel mode buttons
 */
function setupPanelModeListeners() {
    elements.panelModeButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.mode;
            if (!mode) return;

            await setPanelMode(mode);
        });
    });
}

/**
 * Update panel mode button states and info text
 */
function updatePanelModeUI(activeMode) {
    // Update button states
    elements.panelModeButtons.forEach(btn => {
        const isActive = btn.dataset.mode === activeMode;
        btn.classList.toggle('active', isActive);
    });

    // Update description text
    if (elements.panelModeInfo) {
        elements.panelModeInfo.textContent = PANEL_MODE_DESCRIPTIONS[activeMode] || '';
    }
}

/**
 * Change the panel mode
 */
async function setPanelMode(mode) {
    console.log('[LeadTapp] Setting panel mode to:', mode);

    // Update UI immediately for responsiveness
    updatePanelModeUI(mode);

    // Send to service worker to save and apply
    const response = await send({
        type: 'leadtapp/panel/setMode',
        mode: mode
    });

    if (response?.success) {
        showToast(`Panel mode set to ${mode}`, 'success');

        // If switching away from sidepanel, the service worker will handle
        // closing this panel and opening the new mode
        if (mode !== 'sidepanel') {
            showToast('Opening in new mode...', 'info');
        }
    } else {
        showToast(`Failed to set panel mode: ${response?.error || 'Unknown error'}`, 'error');
        // Revert UI on failure
        const currentResponse = await send({ type: 'leadtapp/panel/getSettings' });
        updatePanelModeUI(currentResponse?.settings?.mode || 'sidepanel');
    }
}

// =============================================================================
// Live State Polling
// =============================================================================

/**
 * Handle incoming live state updates from polling
 */
function handleLiveStateUpdate(siteId, state) {
    dashboardState.liveStates.set(siteId, {
        state,
        lastUpdate: Date.now(),
        isPolling: true
    });

    // Update the UI to reflect new state
    updateSiteStateDisplay(siteId);
    updateWorkflowConditionStates(siteId);
}

/**
 * Update the site card to show live state
 */
function updateSiteStateDisplay(siteId) {
    const siteCard = document.querySelector(`.site-card[data-site-id="${siteId}"]`);
    if (!siteCard) return;

    const liveData = dashboardState.liveStates.get(siteId);
    if (!liveData) return;

    // Find or create state display element
    let stateDisplay = siteCard.querySelector('.site-live-state');
    if (!stateDisplay) {
        const siteHeader = siteCard.querySelector('.site-header');
        stateDisplay = document.createElement('div');
        stateDisplay.className = 'site-live-state';
        siteHeader.parentNode.insertBefore(stateDisplay, siteHeader.nextSibling);
    }

    // Render state values
    const stateEntries = Object.entries(liveData.state)
        .filter(([key]) => !['url', 'title', 'timestamp'].includes(key));

    if (stateEntries.length > 0) {
        stateDisplay.innerHTML = `
            <div class="live-state-values">
                ${stateEntries.map(([key, value]) => `
                    <span class="state-chip">
                        <span class="state-key">${escapeHtml(key)}:</span>
                        <span class="state-value">${escapeHtml(String(value))}</span>
                    </span>
                `).join('')}
            </div>
        `;
        stateDisplay.classList.remove('hidden');
    }
}

/**
 * Update workflow items to show condition status
 */
function updateWorkflowConditionStates(siteId) {
    const site = dashboardState.sites.find(s => s.id === siteId);
    if (!site?.workflows) return;

    const liveData = dashboardState.liveStates.get(siteId);
    if (!liveData) return;

    site.workflows.forEach(workflow => {
        const wfEl = document.querySelector(`.workflow-item[data-workflow-id="${workflow.id}"]`);
        if (!wfEl) return;

        // Check if workflow has conditions
        if (workflow.condition) {
            const conditionMet = evaluateCondition(workflow.condition, liveData.state);
            wfEl.classList.toggle('condition-ready', conditionMet);
            wfEl.classList.toggle('condition-waiting', !conditionMet);

            // Update status indicator
            let statusEl = wfEl.querySelector('.workflow-condition-status');
            if (!statusEl) {
                statusEl = document.createElement('span');
                statusEl.className = 'workflow-condition-status';
                wfEl.querySelector('.workflow-info')?.appendChild(statusEl);
            }
            statusEl.textContent = conditionMet ? '✓ Ready' : '⏳ Waiting';
            statusEl.className = `workflow-condition-status ${conditionMet ? 'ready' : 'waiting'}`;
        }
    });
}

/**
 * Evaluate a condition against live state
 */
function evaluateCondition(condition, state) {
    if (!condition || !condition.field) return true;

    const value = state[condition.field];
    if (value === undefined || value === null) return false;

    switch (condition.operator) {
        case 'equals':
            return String(value) === String(condition.value);
        case 'notEquals':
            return String(value) !== String(condition.value);
        case 'gt':
            return Number(value) > Number(condition.value);
        case 'gte':
            return Number(value) >= Number(condition.value);
        case 'lt':
            return Number(value) < Number(condition.value);
        case 'lte':
            return Number(value) <= Number(condition.value);
        case 'contains':
            return String(value).includes(condition.value);
        case 'exists':
            return true;
        default:
            return true;
    }
}

/**
 * Toggle polling for a site
 */
window.togglePolling = async function(siteId) {
    const liveData = dashboardState.liveStates.get(siteId);
    const isCurrentlyPolling = liveData?.isPolling || false;

    if (isCurrentlyPolling) {
        await send({ type: 'leadtapp/polling/stop', siteId });
        dashboardState.liveStates.set(siteId, {
            ...liveData,
            isPolling: false
        });
        updatePollingButton(siteId, false);
        showToast('Live monitoring stopped', 'info');
    } else {
        await send({
            type: 'leadtapp/polling/start',
            siteId,
            config: getPollingConfig(siteId)
        });
        dashboardState.liveStates.set(siteId, {
            state: liveData?.state || {},
            lastUpdate: Date.now(),
            isPolling: true
        });
        updatePollingButton(siteId, true);
        showToast('Live monitoring started', 'success');
    }
};

/**
 * Get polling configuration for a site
 */
function getPollingConfig(siteId) {
    const site = dashboardState.sites.find(s => s.id === siteId);

    // Default config - can be extended with site-specific selectors
    const config = {
        interval: site?.pollingInterval || 5000,
        badgeSelectors: site?.badgeSelectors || {},
        dataSelectors: site?.dataSelectors || {}
    };

    // Auto-detect common badge patterns if none configured
    if (Object.keys(config.badgeSelectors).length === 0) {
        config.badgeSelectors = {
            'notifications': '[data-notification-count], .notification-badge, .badge-count',
            'unread': '.unread-count, [data-unread]'
        };
    }

    return config;
}

/**
 * Update polling button state
 */
function updatePollingButton(siteId, isPolling) {
    const btn = document.querySelector(`.polling-toggle[data-site-id="${siteId}"]`);
    if (!btn) return;

    btn.classList.toggle('active', isPolling);
    btn.innerHTML = isPolling
        ? '<span class="pulse-dot"></span> Live'
        : '<span>📡</span> Monitor';
}

/**
 * Open condition editor for a workflow
 */
window.editWorkflowCondition = async function(workflowId) {
    const workflow = findWorkflowById(workflowId);
    if (!workflow) return;

    const site = findSiteForWorkflow(workflowId);
    const liveData = dashboardState.liveStates.get(site?.id);

    // Build available fields from live state
    const availableFields = liveData?.state
        ? Object.keys(liveData.state).filter(k => !['url', 'title', 'timestamp'].includes(k))
        : [];

    // Show condition editor modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
        <div class="modal-content">
            <div class="modal-header">
                <h3>Set Condition for "${escapeHtml(workflow.name)}"</h3>
                <button class="btn-icon" onclick="this.closest('.modal').remove()">✕</button>
            </div>
            <div class="modal-body">
                <p class="editor-hint">Run this workflow automatically when a condition is met.</p>

                <div class="condition-editor">
                    <div class="condition-row">
                        <label>When field:</label>
                        <select id="condition-field" class="variable-input">
                            <option value="">Select field...</option>
                            ${availableFields.map(f => `
                                <option value="${escapeHtml(f)}" ${workflow.condition?.field === f ? 'selected' : ''}>
                                    ${escapeHtml(f)}
                                </option>
                            `).join('')}
                            <option value="_custom">Custom selector...</option>
                        </select>
                    </div>

                    <div class="condition-row">
                        <label>Operator:</label>
                        <select id="condition-operator" class="variable-input">
                            <option value="equals" ${workflow.condition?.operator === 'equals' ? 'selected' : ''}>equals</option>
                            <option value="notEquals" ${workflow.condition?.operator === 'notEquals' ? 'selected' : ''}>not equals</option>
                            <option value="gt" ${workflow.condition?.operator === 'gt' ? 'selected' : ''}>greater than</option>
                            <option value="gte" ${workflow.condition?.operator === 'gte' ? 'selected' : ''}>≥</option>
                            <option value="lt" ${workflow.condition?.operator === 'lt' ? 'selected' : ''}>less than</option>
                            <option value="lte" ${workflow.condition?.operator === 'lte' ? 'selected' : ''}>≤</option>
                            <option value="contains" ${workflow.condition?.operator === 'contains' ? 'selected' : ''}>contains</option>
                            <option value="exists" ${workflow.condition?.operator === 'exists' ? 'selected' : ''}>exists</option>
                        </select>
                    </div>

                    <div class="condition-row">
                        <label>Value:</label>
                        <input type="text" id="condition-value" class="variable-input"
                               value="${escapeHtml(workflow.condition?.value || '')}"
                               placeholder="Target value">
                    </div>

                    <div class="condition-row">
                        <label>
                            <input type="checkbox" id="condition-autorun" ${workflow.condition?.autoRun ? 'checked' : ''}>
                            Auto-run when condition is met
                        </label>
                    </div>
                </div>

                ${availableFields.length === 0 ? `
                    <p class="warning-text">
                        ⚠️ No live state data available. Start monitoring on this site first.
                    </p>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="clearWorkflowCondition('${workflowId}'); this.closest('.modal').remove();">
                    Clear Condition
                </button>
                <button class="btn-primary" onclick="saveWorkflowCondition('${workflowId}'); this.closest('.modal').remove();">
                    Save Condition
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

/**
 * Save workflow condition from modal
 */
window.saveWorkflowCondition = async function(workflowId) {
    const field = document.getElementById('condition-field')?.value;
    const operator = document.getElementById('condition-operator')?.value;
    const value = document.getElementById('condition-value')?.value;
    const autoRun = document.getElementById('condition-autorun')?.checked;

    if (!field) {
        showToast('Please select a field', 'error');
        return;
    }

    const condition = { field, operator, value, autoRun };

    const response = await send({
        type: 'leadtapp/workflow/update',
        workflowId,
        updates: { condition }
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        showToast('Condition saved', 'success');
        await refreshDashboard();
    }
};

/**
 * Clear workflow condition
 */
window.clearWorkflowCondition = async function(workflowId) {
    const response = await send({
        type: 'leadtapp/workflow/update',
        workflowId,
        updates: { condition: null }
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        showToast('Condition cleared', 'success');
        await refreshDashboard();
    }
};

/**
 * Find site that contains a workflow
 */
function findSiteForWorkflow(workflowId) {
    return dashboardState.sites.find(site =>
        site.workflows?.some(wf => wf.id === workflowId)
    );
}

// =============================================================================
// Manage Tab - Lead Management & Export
// =============================================================================

/**
 * Manage tab state
 */
const manageState = {
    leads: [],
    customFields: [],
    exportConfig: {
        mapping: {},
        preset: 'custom'
    },
    editingLead: null,
    searchQuery: ''
};

/**
 * Initialize manage tab when switched to
 */
async function loadManageTab() {
    await Promise.all([
        loadLeadHistory(),
        loadCustomFields(),
        loadExportConfig()
    ]);
    refreshExportPreview();
}

/**
 * Load lead history from storage
 */
async function loadLeadHistory() {
    const response = await send({ type: 'leadtapp/leads/getAll' });
    manageState.leads = response?.leads || [];
    renderLeadTable();
}

/**
 * Render lead history table
 */
function renderLeadTable() {
    const tbody = document.getElementById('lead-table-body');
    const emptyState = document.getElementById('lead-table-empty');
    const countEl = document.getElementById('lead-history-count');
    if (!tbody) return;

    const query = manageState.searchQuery.toLowerCase();
    const filtered = manageState.leads.filter(lead => {
        if (!query) return true;
        const searchable = [
            lead.name, lead.phone, lead.email, lead.address,
            lead.status, lead.outcome, ...(lead.tags || [])
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(query);
    });

    // Update count
    if (countEl) {
        countEl.textContent = `${manageState.leads.length} lead${manageState.leads.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.querySelector('p').textContent = query
                ? 'No leads match your search'
                : 'No leads have been called yet.';
        }
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = filtered.map(lead => `
        <tr data-lead-id="${lead.id}">
            <td>${escapeHtml(lead.name || 'Unknown')}</td>
            <td>${escapeHtml(lead.phone || '-')}</td>
            <td>
                ${lead.callCount > 0 ? `
                    <button class="call-count-badge" onclick="openCallHistoryModal('${lead.id}')" title="View call history">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.574 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                        ${lead.callCount}
                    </button>
                ` : '<span class="no-calls">—</span>'}
            </td>
            <td>
                <span class="lead-status status-${(lead.outcome || lead.status || 'new').toLowerCase().replace(/\s+/g, '-')}">
                    ${escapeHtml(lead.outcome || lead.status || 'New')}
                </span>
            </td>
            <td>
                <div class="lead-tags">
                    ${(lead.tags || []).slice(0, 3).map(tag => `
                        <span class="lead-tag">${escapeHtml(tag)}</span>
                    `).join('')}
                    ${(lead.tags || []).length > 3 ? `<span class="lead-tag-more">+${lead.tags.length - 3}</span>` : ''}
                </div>
            </td>
            <td>
                <button class="btn-icon" onclick="openLeadEditModal('${lead.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

/**
 * Search leads
 */
window.searchLeads = function(query) {
    manageState.searchQuery = query;
    renderLeadTable();
};

/**
 * Load custom fields configuration
 */
async function loadCustomFields() {
    const response = await send({ type: 'leadtapp/customFields/get' });
    // Response contains { config: customFieldsConfig } where config has customFields array
    manageState.customFields = response?.config?.customFields || [];
    renderCustomFields();
}

/**
 * Render custom fields list
 */
function renderCustomFields() {
    const container = document.getElementById('custom-fields-list');
    if (!container) return;

    if (manageState.customFields.length === 0) {
        container.innerHTML = '<p class="empty-fields">No custom fields defined</p>';
        return;
    }

    // Custom fields use key/label from service worker
    container.innerHTML = manageState.customFields.map(field => `
        <div class="custom-field-item" data-field-id="${field.key}">
            <div class="field-info">
                <span class="field-name">${escapeHtml(field.label || field.name)}</span>
                <span class="field-type">${escapeHtml(field.type)}</span>
            </div>
            <div class="field-actions">
                <button class="btn-icon danger" onclick="removeCustomField('${field.key}')" title="Remove">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Open add custom field modal
 */
window.openAddFieldModal = function() {
    const modal = document.getElementById('add-field-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('new-field-name')?.focus();
    }
};

/**
 * Close add custom field modal
 */
window.closeAddFieldModal = function() {
    const modal = document.getElementById('add-field-modal');
    if (modal) {
        modal.classList.add('hidden');
        // Clear inputs
        const keyInput = document.getElementById('new-field-key');
        const labelInput = document.getElementById('new-field-label');
        const typeSelect = document.getElementById('new-field-type');
        const optionsInput = document.getElementById('new-field-options');
        const crmInput = document.getElementById('new-field-crm');
        if (keyInput) keyInput.value = '';
        if (labelInput) labelInput.value = '';
        if (typeSelect) typeSelect.value = 'text';
        if (optionsInput) optionsInput.value = '';
        if (crmInput) crmInput.value = '';
        // Hide options group
        document.getElementById('field-options-group')?.classList.add('hidden');
    }
};

/**
 * Save new custom field
 */
window.saveNewField = async function() {
    const key = document.getElementById('new-field-key')?.value?.trim();
    const label = document.getElementById('new-field-label')?.value?.trim();
    const type = document.getElementById('new-field-type')?.value || 'text';
    const optionsRaw = document.getElementById('new-field-options')?.value || '';
    const crmColumn = document.getElementById('new-field-crm')?.value?.trim();

    if (!key) {
        showToast('Please enter a field key', 'error');
        return;
    }

    if (!label) {
        showToast('Please enter a display label', 'error');
        return;
    }

    // Sanitize key - no spaces, lowercase
    const sanitizedKey = key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const field = {
        key: sanitizedKey,
        label: label,
        type,
        crm: crmColumn || sanitizedKey,
        options: type === 'select' ? optionsRaw.split('\n').map(o => o.trim()).filter(Boolean) : []
    };

    const response = await send({
        type: 'leadtapp/customFields/add',
        field
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        showToast('Custom field added', 'success');
        closeAddFieldModal();
        await loadCustomFields();
        await loadExportConfig(); // Refresh column mapper
    }
};

/**
 * Remove custom field
 */
window.removeCustomField = async function(fieldId) {
    if (!confirm('Remove this custom field? Data in this field will be preserved on existing leads.')) {
        return;
    }

    const response = await send({
        type: 'leadtapp/customFields/remove',
        fieldKey: fieldId
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        showToast('Custom field removed', 'success');
        await loadCustomFields();
    }
};

/**
 * Load export configuration
 */
async function loadExportConfig() {
    const response = await send({ type: 'leadtapp/export/getConfig' });
    // Response contains { config: exportMapping, presets: crmPresets }
    manageState.exportConfig = {
        mapping: response?.config || {},
        preset: 'custom',
        presets: response?.presets || {}
    };
    renderColumnMapper();

    // Set preset selector
    const presetSelect = document.getElementById('crm-preset-select');
    if (presetSelect) {
        presetSelect.value = manageState.exportConfig.preset || 'custom';
    }
}

/**
 * Render column mapper
 */
function renderColumnMapper() {
    const container = document.getElementById('column-list');
    if (!container) return;

    // Standard fields
    const standardFields = [
        { id: 'name', label: 'Name' },
        { id: 'phone', label: 'Phone' },
        { id: 'email', label: 'Email' },
        { id: 'address', label: 'Address' },
        { id: 'status', label: 'Status' },
        { id: 'notes', label: 'Notes' },
        { id: 'tags', label: 'Tags' },
        { id: 'calledAt', label: 'Called At' },
        { id: 'outcome', label: 'Call Outcome' }
    ];

    // Combine with custom fields (using key/label from service worker)
    const allFields = [
        ...standardFields,
        ...manageState.customFields.map(f => ({ id: f.key, label: f.label || f.name, custom: true }))
    ];

    const mapping = manageState.exportConfig.mapping || {};

    container.innerHTML = allFields.map(field => `
        <div class="column-map-row">
            <span class="source-field ${field.custom ? 'custom' : ''}">${escapeHtml(field.label)}</span>
            <span class="map-arrow">→</span>
            <input type="text"
                   class="csv-column-input"
                   data-field-id="${field.id}"
                   value="${escapeHtml(mapping[field.id] || field.label)}"
                   placeholder="${escapeHtml(field.label)}"
                   onchange="updateColumnMapping('${field.id}', this.value)">
            <label class="include-toggle">
                <input type="checkbox"
                       data-field-id="${field.id}"
                       ${mapping[field.id] !== false ? 'checked' : ''}
                       onchange="toggleColumnInclude('${field.id}', this.checked)">
                <span>Include</span>
            </label>
        </div>
    `).join('');
}

/**
 * Update column mapping
 */
window.updateColumnMapping = async function(fieldId, csvColumn) {
    manageState.exportConfig.mapping[fieldId] = csvColumn || fieldId;
    await saveExportConfig();
    refreshExportPreview();
};

/**
 * Toggle column inclusion
 */
window.toggleColumnInclude = async function(fieldId, include) {
    if (!include) {
        manageState.exportConfig.mapping[fieldId] = false;
    } else {
        // Restore default name if was excluded
        // Check if it's a custom field (custom fields use 'key' property)
        const customField = manageState.customFields.find(f => f.key === fieldId);
        const defaultName = customField
            ? customField.label || customField.key
            : fieldId.charAt(0).toUpperCase() + fieldId.slice(1).replace(/_/g, ' ');
        manageState.exportConfig.mapping[fieldId] = defaultName;
    }
    await saveExportConfig();
    refreshExportPreview();
};

/**
 * Apply CRM preset
 */
window.applyPreset = async function(presetId) {
    const response = await send({
        type: 'leadtapp/export/applyPreset',
        presetId: presetId
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        // Response contains { success, mapping, preset }
        manageState.exportConfig.mapping = response.mapping || {};
        manageState.exportConfig.preset = presetId;
        renderColumnMapper();
        refreshExportPreview();
        showToast(`Applied ${presetId === 'custom' ? 'custom' : presetId} preset`, 'success');
    }
};

/**
 * Save export configuration
 */
async function saveExportConfig() {
    await send({
        type: 'leadtapp/export/setMapping',
        mapping: manageState.exportConfig.mapping
    });
}

/**
 * Refresh export preview
 */
function refreshExportPreview() {
    const thead = document.getElementById('preview-headers');
    const tbody = document.getElementById('preview-body');
    const section = document.getElementById('export-preview-section');
    if (!thead || !tbody) return;

    const mapping = manageState.exportConfig.mapping || {};

    // Get included columns - if no mapping set, use defaults
    let columns;
    if (Object.keys(mapping).length === 0) {
        // Default columns
        columns = [
            { fieldId: 'name', csvName: 'Name' },
            { fieldId: 'phone', csvName: 'Phone' },
            { fieldId: 'email', csvName: 'Email' },
            { fieldId: 'address', csvName: 'Address' },
            { fieldId: 'outcome', csvName: 'Outcome' },
            { fieldId: 'tags', csvName: 'Tags' }
        ];
    } else {
        columns = Object.entries(mapping)
            .filter(([_, value]) => value !== false)
            .map(([fieldId, csvName]) => ({
                fieldId,
                csvName: typeof csvName === 'string' ? csvName : fieldId
            }));
    }

    if (columns.length === 0 || manageState.leads.length === 0) {
        thead.innerHTML = '<tr><th>No data</th></tr>';
        tbody.innerHTML = '<tr><td class="empty-preview">No leads to preview</td></tr>';
        return;
    }

    // Show first 3 leads as preview
    const previewLeads = manageState.leads.slice(0, 3);

    thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col.csvName)}</th>`).join('')}</tr>`;

    tbody.innerHTML = previewLeads.map(lead => `
        <tr>
            ${columns.map(col => {
                let value = lead[col.fieldId];
                if (Array.isArray(value)) value = value.join(', ');
                if (col.fieldId === 'calledAt' && value) {
                    value = new Date(value).toLocaleString();
                }
                return `<td>${escapeHtml(value || '')}</td>`;
            }).join('')}
        </tr>
    `).join('');
}

/**
 * Export leads to CSV
 */
window.exportLeadsCsv = async function() {
    if (manageState.leads.length === 0) {
        showToast('No leads to export', 'error');
        return;
    }

    const response = await send({ type: 'leadtapp/export/csv' });

    if (response?.error) {
        showToast(response.error, 'error');
        return;
    }

    // Create and download CSV file
    const blob = new Blob([response.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${manageState.leads.length} leads`, 'success');
};

/**
 * Open lead edit modal
 */
window.openLeadEditModal = async function(leadId) {
    const lead = manageState.leads.find(l => l.id === leadId);
    if (!lead) {
        showToast('Lead not found', 'error');
        return;
    }

    manageState.editingLead = lead;

    const modal = document.getElementById('lead-edit-modal');
    const fieldsContainer = document.getElementById('lead-edit-fields');
    const nameSpan = document.querySelector('#lead-edit-modal .modal-header span');
    if (!modal || !fieldsContainer) return;

    // Update modal header
    if (nameSpan) nameSpan.textContent = lead.name || 'Lead';

    // Build form fields
    const statusOptions = ['New', 'Contacted', 'Interested', 'Not Interested', 'Callback', 'Closed'];
    const outcomeOptions = ['No Answer', 'Left Voicemail', 'Spoke - Interested', 'Spoke - Not Interested', 'Wrong Number', 'Callback Scheduled', 'Meeting Set', 'Disqualified'];

    let html = `
        <div class="form-row">
            <div class="form-group">
                <label class="field-label">Name</label>
                <input type="text" id="edit-lead-name" class="variable-input" value="${escapeHtml(lead.name || '')}">
            </div>
            <div class="form-group">
                <label class="field-label">Phone</label>
                <input type="text" id="edit-lead-phone" class="variable-input" value="${escapeHtml(lead.phone || '')}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="field-label">Email</label>
                <input type="email" id="edit-lead-email" class="variable-input" value="${escapeHtml(lead.email || '')}">
            </div>
            <div class="form-group">
                <label class="field-label">Address</label>
                <input type="text" id="edit-lead-address" class="variable-input" value="${escapeHtml(lead.address || '')}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="field-label">Status</label>
                <select id="edit-lead-status" class="variable-input">
                    ${statusOptions.map(opt =>
                        `<option value="${opt.toLowerCase().replace(/\s+/g, '_')}" ${(lead.status || 'new') === opt.toLowerCase().replace(/\s+/g, '_') ? 'selected' : ''}>${opt}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="field-label">Call Outcome</label>
                <select id="edit-lead-outcome" class="variable-input">
                    <option value="">Select outcome...</option>
                    ${outcomeOptions.map(opt =>
                        `<option value="${opt}" ${lead.outcome === opt ? 'selected' : ''}>${opt}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="field-label">Notes</label>
            <textarea id="edit-lead-notes" class="variable-input" rows="3" placeholder="Add call notes...">${escapeHtml(lead.notes || '')}</textarea>
        </div>
        <div class="form-group">
            <label class="field-label">Tags (comma separated)</label>
            <input type="text" id="edit-lead-tags" class="variable-input" value="${escapeHtml((lead.tags || []).join(', '))}" placeholder="hot lead, callback, etc.">
        </div>
    `;

    // Add custom fields if any (using key/label from service worker)
    if (manageState.customFields.length > 0) {
        html += `<div class="custom-fields-section"><h4>Custom Fields</h4>`;
        html += manageState.customFields.map(field => {
            const fieldKey = field.key;
            const value = lead[fieldKey] || '';
            let input = '';

            switch (field.type) {
                case 'textarea':
                    input = `<textarea id="edit-${fieldKey}" class="variable-input" rows="2">${escapeHtml(value)}</textarea>`;
                    break;
                case 'select':
                    input = `
                        <select id="edit-${fieldKey}" class="variable-input">
                            <option value="">Select...</option>
                            ${(field.options || []).map(opt =>
                                `<option value="${escapeHtml(opt)}" ${value === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`
                            ).join('')}
                        </select>
                    `;
                    break;
                case 'tags':
                    input = `<input type="text" id="edit-${fieldKey}" class="variable-input" value="${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}" placeholder="tag1, tag2, ...">`;
                    break;
                default:
                    input = `<input type="text" id="edit-${fieldKey}" class="variable-input" value="${escapeHtml(value)}">`;
            }

            return `
                <div class="form-group">
                    <label class="field-label">${escapeHtml(field.label || field.name)}</label>
                    ${input}
                </div>
            `;
        }).join('');
        html += `</div>`;
    }

    fieldsContainer.innerHTML = html;
    modal.classList.remove('hidden');
};

/**
 * Close lead edit modal
 */
window.closeLeadEditModal = function() {
    const modal = document.getElementById('lead-edit-modal');
    if (modal) {
        modal.classList.add('hidden');
        manageState.editingLead = null;
    }
};

/**
 * Save lead edits
 */
window.saveLeadEdits = async function() {
    if (!manageState.editingLead) return;

    const updates = {
        name: document.getElementById('edit-lead-name')?.value?.trim(),
        phone: document.getElementById('edit-lead-phone')?.value?.trim(),
        email: document.getElementById('edit-lead-email')?.value?.trim(),
        address: document.getElementById('edit-lead-address')?.value?.trim(),
        status: document.getElementById('edit-lead-status')?.value,
        outcome: document.getElementById('edit-lead-outcome')?.value || '',
        notes: document.getElementById('edit-lead-notes')?.value?.trim(),
        tags: (document.getElementById('edit-lead-tags')?.value || '')
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
    };

    // Collect custom field values
    for (const field of manageState.customFields) {
        const input = document.getElementById(`edit-${field.key}`);
        if (input) {
            updates[field.key] = input.value?.trim() || '';
        }
    }

    const response = await send({
        type: 'leadtapp/lead/update',
        leadId: manageState.editingLead.id,
        updates
    });

    if (response?.error) {
        showToast(response.error, 'error');
    } else {
        showToast('Lead updated', 'success');
        closeLeadEditModal();
        await loadLeadHistory();
        refreshExportPreview();
    }
};

// ===========================================================================
// Call History Modal
// ===========================================================================

/**
 * Open call history modal for a lead
 */
window.openCallHistoryModal = function(leadId) {
    const lead = manageState.leads.find(l => l.id === leadId);
    if (!lead) {
        showToast('Lead not found', 'error');
        return;
    }

    manageState.viewingLeadHistory = lead;

    const modal = document.getElementById('call-history-modal');
    const nameEl = document.getElementById('call-history-lead-name');
    const contentEl = document.getElementById('call-history-content');

    if (!modal || !contentEl) return;

    nameEl.textContent = lead.name || 'Unknown';

    const callHistory = lead.callHistory || [];

    if (callHistory.length === 0) {
        contentEl.innerHTML = `
            <div class="no-call-history">
                <p>No call history for this lead.</p>
            </div>
        `;
    } else {
        contentEl.innerHTML = `
            <div class="call-history-list">
                ${callHistory.map((call, idx) => {
                    const date = new Date(call.timestamp);
                    const formattedDate = date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    });
                    const formattedTime = date.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit'
                    });

                    return `
                        <div class="call-history-item ${idx === 0 ? 'most-recent' : ''}">
                            <div class="call-header">
                                <span class="lead-status status-${(call.outcome || 'unknown').toLowerCase().replace(/\s+/g, '-')}">
                                    ${escapeHtml(call.outcome || 'No outcome')}
                                </span>
                                <span class="call-date">${formattedDate} at ${formattedTime}</span>
                            </div>
                            ${call.notes ? `
                                <div class="call-notes">
                                    <strong>Notes:</strong> ${escapeHtml(call.notes)}
                                </div>
                            ` : ''}
                            ${call.followUpDate ? `
                                <div class="call-followup">
                                    <strong>Follow-up:</strong> ${new Date(call.followUpDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </div>
                            ` : ''}
                            ${call.tags && call.tags.length > 0 ? `
                                <div class="call-tags">
                                    ${call.tags.map(tag => `<span class="lead-tag">${escapeHtml(tag)}</span>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    modal.classList.remove('hidden');
};

/**
 * Close call history modal
 */
window.closeCallHistoryModal = function() {
    const modal = document.getElementById('call-history-modal');
    if (modal) {
        modal.classList.add('hidden');
        manageState.viewingLeadHistory = null;
    }
};

/**
 * Open lead edit modal from call history modal
 */
window.openLeadEditModalFromHistory = function() {
    const lead = manageState.viewingLeadHistory;
    if (lead) {
        closeCallHistoryModal();
        openLeadEditModal(lead.id);
    }
};

/**
 * Hook into tab navigation to load manage tab
 */
function setupManageTabHook() {
    // Tab navigation
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            if (tab.dataset.tab === 'manage') {
                await loadManageTab();
            }
        });
    });

    // Export button
    document.getElementById('btn-export-leads')?.addEventListener('click', exportLeadsCsv);

    // Add field button
    document.getElementById('btn-add-field')?.addEventListener('click', openAddFieldModal);

    // Refresh preview button
    document.getElementById('btn-refresh-preview')?.addEventListener('click', () => {
        refreshExportPreview();
        showToast('Preview refreshed', 'success');
    });

    // Lead search input
    document.getElementById('lead-search-input')?.addEventListener('input', (e) => {
        searchLeads(e.target.value);
    });

    // CRM Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            // Update active state
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Apply preset
            await applyPreset(btn.dataset.preset);
        });
    });

    // Field type selector - show/hide options
    document.getElementById('new-field-type')?.addEventListener('change', (e) => {
        const optionsGroup = document.getElementById('field-options-group');
        if (optionsGroup) {
            if (e.target.value === 'select') {
                optionsGroup.classList.remove('hidden');
            } else {
                optionsGroup.classList.add('hidden');
            }
        }
    });
}

// Initialize manage tab hook after DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupManageTabHook);
} else {
    setupManageTabHook();
}

// =============================================================================
// Workflow Picker Modal
// =============================================================================

// State for workflow picker
let workflowPickerState = {
    chainId: null,
    workflows: [],
    resolve: null
};

/**
 * Open workflow picker modal
 * @param {string} chainId - The chain to add the workflow to
 * @param {Array} workflows - Available workflows to pick from
 * @returns {Promise<Object|null>} - Selected workflow or null if cancelled
 */
window.openWorkflowPickerModal = function(chainId, workflows) {
    return new Promise((resolve) => {
        workflowPickerState.chainId = chainId;
        workflowPickerState.workflows = workflows;
        workflowPickerState.resolve = resolve;

        const modal = document.getElementById('workflow-picker-modal');
        const listContainer = document.getElementById('workflow-picker-list');
        const emptyState = document.getElementById('workflow-picker-empty');

        if (!modal || !listContainer) return resolve(null);

        if (workflows.length === 0) {
            listContainer.classList.add('hidden');
            emptyState?.classList.remove('hidden');
        } else {
            listContainer.classList.remove('hidden');
            emptyState?.classList.add('hidden');

            listContainer.innerHTML = workflows.map((wf, index) => `
                <div class="workflow-picker-item" onclick="selectWorkflowFromPicker(${index})">
                    <div class="picker-icon" style="background: ${wf.color || '#f1f3f4'}">
                        ${wf.icon || '⚡'}
                    </div>
                    <div class="picker-info">
                        <div class="picker-name">${escapeHtml(wf.name)}</div>
                        <div class="picker-site">${escapeHtml(wf.siteName || 'Unknown site')}</div>
                    </div>
                </div>
            `).join('');
        }

        modal.classList.remove('hidden');
    });
};

/**
 * Select a workflow from the picker
 */
window.selectWorkflowFromPicker = function(index) {
    const workflow = workflowPickerState.workflows[index];
    if (workflow && workflowPickerState.resolve) {
        workflowPickerState.resolve(workflow);
    }
    closeWorkflowPickerModal();
};

/**
 * Close workflow picker modal
 */
window.closeWorkflowPickerModal = function() {
    const modal = document.getElementById('workflow-picker-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    // Resolve with null if closed without selection
    if (workflowPickerState.resolve) {
        workflowPickerState.resolve(null);
    }
    workflowPickerState = { chainId: null, workflows: [], resolve: null };
};

// =============================================================================
// Condition Editor Modal
// =============================================================================

// State for condition editor
let conditionEditorState = {
    chainId: null,
    stepId: null,
    currentCondition: '',
    resolve: null
};

/**
 * Open condition editor modal
 * @param {string} chainId - The chain ID
 * @param {string} stepId - The step ID
 * @param {string} currentCondition - Current condition value
 * @returns {Promise<string|null>} - New condition or null if cancelled
 */
window.openConditionEditorModal = function(chainId, stepId, currentCondition) {
    return new Promise((resolve) => {
        conditionEditorState.chainId = chainId;
        conditionEditorState.stepId = stepId;
        conditionEditorState.currentCondition = currentCondition || '';
        conditionEditorState.resolve = resolve;

        const modal = document.getElementById('condition-editor-modal');
        const input = document.getElementById('condition-input');

        if (!modal || !input) return resolve(null);

        input.value = currentCondition || '';
        modal.classList.remove('hidden');
        input.focus();
    });
};

/**
 * Set condition from example click
 */
window.setConditionExample = function(example) {
    const input = document.getElementById('condition-input');
    if (input) {
        input.value = example;
        input.focus();
    }
};

/**
 * Save the condition
 */
window.saveCondition = function() {
    const input = document.getElementById('condition-input');
    const value = input?.value?.trim() || '';

    if (conditionEditorState.resolve) {
        conditionEditorState.resolve(value);
    }
    closeConditionEditorModal();
};

/**
 * Close condition editor modal
 */
window.closeConditionEditorModal = function() {
    const modal = document.getElementById('condition-editor-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    // Resolve with null if closed without saving
    if (conditionEditorState.resolve) {
        conditionEditorState.resolve(null);
    }
    conditionEditorState = { chainId: null, stepId: null, currentCondition: '', resolve: null };
};

// Handle Enter key in condition input
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.id === 'condition-input') {
        e.preventDefault();
        saveCondition();
    }
    if (e.key === 'Escape') {
        const workflowModal = document.getElementById('workflow-picker-modal');
        const conditionModal = document.getElementById('condition-editor-modal');
        if (workflowModal && !workflowModal.classList.contains('hidden')) {
            closeWorkflowPickerModal();
        }
        if (conditionModal && !conditionModal.classList.contains('hidden')) {
            closeConditionEditorModal();
        }
    }
});

// =============================================================================
// Bootstrap
// =============================================================================

console.log('[LeadTapp] Starting side panel bootstrap...');
init()
    .then(() => console.log('[LeadTapp] Side panel initialized successfully'))
    .catch((error) => console.error('[LeadTapp] Side panel initialization failed:', error));
