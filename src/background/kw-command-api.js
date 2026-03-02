/**
 * LeadTapp - KW Command API Client
 *
 * Direct API integration with KW Command, bypassing DOM automation for reliability.
 * Endpoints reverse-engineered from DevEyes session analysis.
 *
 * API Gateway: kong.command-api.kw.com
 *
 * Key Endpoints:
 * - /v3/contacts/search - Search contacts with filters
 * - /v3/contacts/{id} - Get contact details
 * - /v3/contacts/{id}/notes - Get/Create contact notes
 * - /tasks/v1/tasks - List tasks
 * - /tasks/v1/tasks/batch - Create tasks
 * - /timeline-events/v2/client-activity/team/{teamId} - Activity timeline
 * - /contact-timeline/{contactId} - Contact timeline
 * - /smartviews-v2/smartviews - Smart views
 * - /deals-manager/api/v2/deals - Deals
 */

class KWCommandAPI {
    constructor() {
        this.baseUrl = 'https://kong.command-api.kw.com';
        this.authToken = null;
        this.orgId = null;
        this.teamId = null;
        this.agentKwuid = null;
        this.isInitialized = false;

        // Client IDs for different services
        this.clientIds = {
            contacts: 'ui-command-contacts',
            tasks: 'ui-command-task-manager',
            dashboard: 'ui-command-dashboard',
            deals: 'ui-command-deals-manager',
            smartplans: 'ui-command-smartplans'
        };

        // Set up auth token interception
        this.setupAuthCapture();
    }

    /**
     * Set up listener to capture auth token from KW Command requests
     */
    setupAuthCapture() {
        // Listen for requests to KW Command to extract auth token
        if (typeof chrome !== 'undefined' && chrome.webRequest) {
            chrome.webRequest.onBeforeSendHeaders.addListener(
                (details) => {
                    if (details.url.includes('kong.command-api.kw.com') ||
                        details.url.includes('command.kw.com')) {

                        const headers = details.requestHeaders || [];
                        for (const header of headers) {
                            const name = header.name.toLowerCase();

                            // Capture auth token
                            if (name === 'authorization') {
                                const newToken = header.value;
                                if (newToken !== this.authToken) {
                                    this.authToken = newToken;
                                    console.log('[KWCommandAPI] Auth token captured');
                                }
                            }

                            // Capture org ID
                            if (name === 'x-kwri-org' && header.value) {
                                this.orgId = header.value;
                            }
                        }
                    }
                },
                { urls: ['*://*.command-api.kw.com/*', '*://*.command.kw.com/*'] },
                ['requestHeaders']
            );
        }
    }

    /**
     * Initialize with captured credentials
     */
    async initialize(credentials = {}) {
        if (credentials.authToken) this.authToken = credentials.authToken;
        if (credentials.orgId) this.orgId = credentials.orgId;
        if (credentials.teamId) this.teamId = credentials.teamId;
        if (credentials.agentKwuid) this.agentKwuid = credentials.agentKwuid;

        // Try to load from storage if not provided
        if (!this.authToken || !this.orgId) {
            try {
                const stored = await chrome.storage.local.get(['kwCommandAuth']);
                if (stored.kwCommandAuth) {
                    this.authToken = stored.kwCommandAuth.token || this.authToken;
                    this.orgId = stored.kwCommandAuth.orgId || this.orgId;
                    this.teamId = stored.kwCommandAuth.teamId || this.teamId;
                    this.agentKwuid = stored.kwCommandAuth.agentKwuid || this.agentKwuid;
                }
            } catch (e) {
                console.warn('[KWCommandAPI] Could not load stored auth:', e);
            }
        }

        this.isInitialized = !!(this.authToken && this.orgId);
        return this.isInitialized;
    }

    /**
     * Save auth credentials to storage
     */
    async saveAuth() {
        try {
            await chrome.storage.local.set({
                kwCommandAuth: {
                    token: this.authToken,
                    orgId: this.orgId,
                    teamId: this.teamId,
                    agentKwuid: this.agentKwuid,
                    savedAt: Date.now()
                }
            });
        } catch (e) {
            console.warn('[KWCommandAPI] Could not save auth:', e);
        }
    }

    /**
     * Build headers for API request
     */
    getHeaders(clientId = 'contacts', contentType = 'application/json') {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': contentType,
            'x-kwri-client-id': this.clientIds[clientId] || this.clientIds.contacts,
            'x-command-context': 'COMMAND'
        };

        if (this.authToken) {
            headers['Authorization'] = this.authToken;
        }

        if (this.orgId) {
            headers['x-kwri-org'] = this.orgId;
        }

        return headers;
    }

    /**
     * Make API request with error handling
     */
    async request(endpoint, options = {}) {
        if (!this.authToken) {
            throw new Error('Not authenticated. Please log into KW Command first.');
        }

        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        const clientId = options.clientId || 'contacts';

        const fetchOptions = {
            method: options.method || 'GET',
            headers: {
                ...this.getHeaders(clientId, options.contentType),
                ...(options.headers || {})
            }
        };

        if (options.body) {
            fetchOptions.body = typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (response.status === 401) {
                this.authToken = null;
                throw new Error('Authentication expired. Please refresh KW Command page.');
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }

            return await response.text();

        } catch (error) {
            console.error('[KWCommandAPI] Request failed:', error);
            throw error;
        }
    }

    // =========================================================================
    // CONTACTS API
    // =========================================================================

    /**
     * Search contacts with filters
     * @param {Object} params - Search parameters
     * @param {string} params.query - Search query (optional)
     * @param {number} params.limit - Max results (default 25)
     * @param {number} params.offset - Pagination offset
     * @param {string} params.smartviewKey - Smart view key (optional)
     * @param {string} params.sortField - Sort field (default 'firstName')
     * @param {string} params.sortOrder - ASC or DESC
     */
    async searchContacts(params = {}) {
        const body = {
            fields: [
                'owner', 'tags', 'author', 'permissions', 'name', 'emails',
                'phones', 'addresses', 'lastInteractionDates', 'personalInfo',
                'neighborhoods', 'job', 'customFields', 'contactTypes',
                'createdAt', 'updatedAt', 'relationships', 'socialAccounts', 'branding'
            ],
            scope: ['woLeadroute', 'woLeadpool', 'woArchived'],
            sort: {
                sortFields: [params.sortField || 'firstName'],
                sortOrder: params.sortOrder || 'ASC'
            },
            pagination: {
                max: params.limit || 25,
                offset: params.offset || 0
            }
        };

        // Add query filter if provided
        if (params.query) {
            body.query = {
                everything: [{
                    pattern: 'contains',
                    value: params.query
                }]
            };
        }

        // Add smartview if provided
        if (params.smartviewKey) {
            body.smartview = {
                key: params.smartviewKey,
                type: 'system',
                version: 2
            };
        }

        return this.request('/v3/contacts/search', {
            method: 'POST',
            body,
            clientId: 'contacts',
            headers: {
                'Accept': 'application/vnd.kwri.contacts.contact+json;version=3'
            }
        });
    }

    /**
     * Get contact by ID
     */
    async getContact(contactId) {
        return this.request(`/v3/contacts/${contactId}`, {
            clientId: 'contacts',
            headers: {
                'Accept': 'application/vnd.kwri.contacts.contact+json;version=3'
            }
        });
    }

    /**
     * Get contact notes
     */
    async getContactNotes(contactId, sort = -1) {
        return this.request(`/v3/contacts/${contactId}/notes?sort=${sort}`, {
            clientId: 'contacts'
        });
    }

    /**
     * Create contact note (for call logging)
     * @param {string} contactId - Contact ID
     * @param {Object} note - Note data
     * @param {string} note.text - Note text
     * @param {string} note.type - Note type (call, email, meeting, note)
     * @param {string} note.outcome - Call outcome (optional)
     */
    async createContactNote(contactId, note) {
        return this.request(`/v3/contacts/${contactId}/notes`, {
            method: 'POST',
            body: {
                text: note.text,
                type: note.type || 'note',
                outcome: note.outcome,
                createdAt: new Date().toISOString()
            },
            clientId: 'contacts'
        });
    }

    /**
     * Get contact timeline
     */
    async getContactTimeline(contactId) {
        return this.request(`/contact-timeline/${contactId}`, {
            clientId: 'contacts'
        });
    }

    // =========================================================================
    // TASKS API
    // =========================================================================

    /**
     * Get tasks with filters
     * @param {Object} params - Filter parameters
     * @param {string} params.status - Task status (OPEN, COMPLETED, DELETED)
     * @param {string} params.domain - Task domain
     * @param {number} params.limit - Max results
     * @param {number} params.offset - Pagination offset
     */
    async getTasks(params = {}) {
        const queryParams = new URLSearchParams({
            max: params.limit || 20,
            offset: params.offset || 0,
            status: params.status || 'OPEN',
            sortFields: params.sortField || 'createdAt',
            sortOrder: params.sortOrder || 'DESC'
        });

        if (params.domain) {
            queryParams.append('domain', params.domain);
        }

        return this.request(`/tasks/v1/tasks?${queryParams}`, {
            clientId: 'tasks'
        });
    }

    /**
     * Create task(s)
     * @param {Array|Object} tasks - Task or array of tasks
     */
    async createTasks(tasks) {
        const taskArray = Array.isArray(tasks) ? tasks : [tasks];

        const formattedTasks = taskArray.map(task => ({
            domain: task.domain || 'UNLINKED',
            name: task.name || task.title,
            priority: task.priority || 1,
            type: task.type || 'OTHER',
            createdByType: 'AGENT',
            description: task.description || '',
            hyperlinks: task.hyperlinks || [],
            dueDate: task.dueDate || this.getDefaultDueDate(),
            recurrence: task.recurrence || {
                count: 0,
                description: '',
                seriesId: '',
                type: 'CUSTOM',
                cadence: 'DAILY',
                detail: { interval: 1 },
                endAfter: 1000
            },
            assignees: task.assignees || (this.agentKwuid ? [this.agentKwuid] : []),
            contactId: task.contactId
        }));

        return this.request('/tasks/v1/tasks/batch', {
            method: 'POST',
            body: formattedTasks,
            clientId: 'tasks'
        });
    }

    /**
     * Complete a task
     */
    async completeTask(taskId) {
        return this.request(`/tasks/v1/tasks/${taskId}/complete`, {
            method: 'POST',
            clientId: 'tasks'
        });
    }

    /**
     * Get default due date (3 days from now)
     */
    getDefaultDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 3);
        date.setHours(23, 59, 0, 0);
        return date.toISOString().replace('Z', '-0800');
    }

    // =========================================================================
    // ACTIVITY API
    // =========================================================================

    /**
     * Get team activity timeline
     */
    async getTeamActivity() {
        if (!this.teamId) {
            throw new Error('Team ID not set');
        }

        return this.request(`/timeline-events/v2/client-activity/team/${this.teamId}`, {
            method: 'POST',
            clientId: 'dashboard'
        });
    }

    /**
     * Get agent activity
     */
    async getAgentActivity() {
        if (!this.teamId || !this.agentKwuid) {
            throw new Error('Team ID and Agent KWUID required');
        }

        return this.request(
            `/timeline-events/v2/client-activity/hidden-contacts/team/${this.teamId}/agent/${this.agentKwuid}`,
            { clientId: 'dashboard' }
        );
    }

    // =========================================================================
    // SMART VIEWS API
    // =========================================================================

    /**
     * Get smart views
     * @param {string} type - View type (contact, opportunity)
     */
    async getSmartViews(type = 'contact') {
        return this.request(`/smartviews-v2/smartviews?type=${type}`, {
            clientId: 'contacts'
        });
    }

    // =========================================================================
    // DEALS API
    // =========================================================================

    /**
     * Get deals with filters
     */
    async getDeals(params = {}) {
        const queryParams = new URLSearchParams({
            sortBy: params.sortBy || 'updatedAt',
            sortOrder: params.sortOrder || 'desc',
            page: params.page || 1,
            size: params.size || 25
        });

        return this.request(`/deals-manager/api/v2/deals?${queryParams}`, {
            clientId: 'deals'
        });
    }

    /**
     * Get deal activity stats
     */
    async getDealActivityStats(dealOwner = '', teamKwuid = '') {
        return this.request(
            `/deals-manager/api/v1/stats/activity?deal_owner=${dealOwner}&team_kwuid=${teamKwuid}`,
            { clientId: 'deals' }
        );
    }

    // =========================================================================
    // SMART PLANS API
    // =========================================================================

    /**
     * Create smart plan
     */
    async createSmartPlan(plan) {
        return this.request('/v2/smartplans/user-flows/configs', {
            method: 'POST',
            body: {
                data: {
                    attributes: {
                        flow_name: plan.name,
                        flow_category: plan.category || 'contacts',
                        flow_access_type: plan.accessType || 'private',
                        flow_duration: plan.duration || 1,
                        flow_owner_type: 'user'
                    }
                }
            },
            clientId: 'smartplans'
        });
    }

    // =========================================================================
    // WORKFLOW EXECUTION (API-based)
    // =========================================================================

    /**
     * Execute a workflow action via API instead of DOM
     * @param {string} action - Action type
     * @param {Object} data - Action data
     */
    async executeWorkflowAction(action, data) {
        switch (action) {
            case 'log_call':
            case 'log_call_connected':
            case 'log_call_no_answer':
            case 'log_call_voicemail':
                return this.logCall(data);

            case 'create_task':
            case 'schedule_callback':
                return this.createTasks(data);

            case 'search_contact':
                return this.searchContacts(data);

            case 'get_contact':
                return this.getContact(data.contactId);

            default:
                throw new Error(`Unknown workflow action: ${action}`);
        }
    }

    /**
     * Log a call to a contact
     * @param {Object} callData
     * @param {string} callData.contactId - Contact ID
     * @param {string} callData.outcome - Call outcome (connected, no_answer, voicemail, etc.)
     * @param {string} callData.notes - Call notes
     * @param {string} callData.duration - Call duration
     */
    async logCall(callData) {
        if (!callData.contactId) {
            throw new Error('Contact ID required for logging call');
        }

        const outcomeMap = {
            'connected': 'Connected',
            'connected_appointment': 'Connected - Appointment Set',
            'connected_callback': 'Connected - Callback Scheduled',
            'connected_not_interested': 'Connected - Not Interested',
            'no_answer': 'No Answer',
            'voicemail': 'Left Voicemail',
            'wrong_number': 'Wrong Number',
            'busy': 'Busy'
        };

        const noteText = [
            `📞 Call Log - ${outcomeMap[callData.outcome] || callData.outcome}`,
            callData.notes ? `Notes: ${callData.notes}` : null,
            callData.duration ? `Duration: ${callData.duration}` : null,
            `Logged via LeadTapp`
        ].filter(Boolean).join('\n');

        // Create note for call log
        const noteResult = await this.createContactNote(callData.contactId, {
            text: noteText,
            type: 'call',
            outcome: callData.outcome
        });

        // Create follow-up task if callback scheduled
        if (callData.outcome === 'connected_callback' && callData.followUpDate) {
            await this.createTasks({
                name: `Follow-up call`,
                contactId: callData.contactId,
                dueDate: callData.followUpDate,
                type: 'CALL',
                description: callData.notes || 'Scheduled callback from previous call'
            });
        }

        return noteResult;
    }

    /**
     * Check if API is ready for use
     */
    isReady() {
        return !!(this.authToken && this.orgId);
    }

    /**
     * Get current auth status
     */
    getStatus() {
        return {
            isReady: this.isReady(),
            hasToken: !!this.authToken,
            orgId: this.orgId,
            teamId: this.teamId,
            agentKwuid: this.agentKwuid
        };
    }
}

// Create singleton instance
const kwCommandAPI = new KWCommandAPI();

// Export to global scope for service worker
if (typeof self !== 'undefined') {
    self.kwCommandAPI = kwCommandAPI;
}
