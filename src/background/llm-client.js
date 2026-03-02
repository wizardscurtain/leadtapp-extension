/**
 * LeadTapp - LLM Integration Client
 *
 * Multi-provider LLM client supporting:
 * - OpenAI API (GPT-4, GPT-3.5)
 * - Anthropic API (Claude)
 * - Local/Custom endpoints (Ollama, LM Studio, etc.)
 * - MCP Client integration for tool use
 */

const LLMClient = {
    // ==========================================================================
    // State
    // ==========================================================================
    config: {
        provider: 'openai',        // 'openai' | 'anthropic' | 'local' | 'mcp'
        apiKey: null,
        baseUrl: null,             // Custom endpoint for local models
        model: null,               // Provider-specific model ID
        maxTokens: 2048,
        temperature: 0.7,
        systemPrompt: null,
        mcpServerUrl: null,        // MCP server endpoint
    },

    conversationHistory: [],
    isInitialized: false,

    // Provider-specific defaults
    PROVIDERS: {
        openai: {
            baseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-4-turbo-preview',
            models: ['gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo'],
        },
        anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            defaultModel: 'claude-3-sonnet-20240229',
            models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        },
        local: {
            baseUrl: 'http://localhost:11434/api',  // Ollama default
            defaultModel: 'llama2',
            models: [],  // Populated dynamically
        },
        mcp: {
            baseUrl: null,  // Configured per setup
            defaultModel: 'default',
            models: [],
        }
    },

    // ==========================================================================
    // Initialization
    // ==========================================================================
    async init() {
        console.log('[LLMClient] Initializing...');

        // Load saved config
        const saved = await chrome.storage.local.get('llmConfig');
        if (saved.llmConfig) {
            this.config = { ...this.config, ...saved.llmConfig };
        }

        // Load conversation history
        const history = await chrome.storage.local.get('llmHistory');
        if (history.llmHistory) {
            this.conversationHistory = history.llmHistory;
        }

        this.isInitialized = true;
        console.log('[LLMClient] Initialized with provider:', this.config.provider);
        return { success: true, provider: this.config.provider };
    },

    // ==========================================================================
    // Configuration
    // ==========================================================================
    async configure(newConfig) {
        // Validate required fields per provider
        const provider = newConfig.provider || this.config.provider;

        if (provider === 'openai' || provider === 'anthropic') {
            if (!newConfig.apiKey && !this.config.apiKey) {
                return { error: 'API key required for ' + provider };
            }
        }

        this.config = { ...this.config, ...newConfig };

        // Set defaults if model not specified
        if (!this.config.model) {
            this.config.model = this.PROVIDERS[provider]?.defaultModel;
        }

        // Save to storage
        await chrome.storage.local.set({ llmConfig: this.config });

        console.log('[LLMClient] Configuration updated:', {
            provider: this.config.provider,
            model: this.config.model,
            hasApiKey: !!this.config.apiKey
        });

        return { success: true, config: this.getPublicConfig() };
    },

    getPublicConfig() {
        // Return config without sensitive data
        return {
            provider: this.config.provider,
            model: this.config.model,
            maxTokens: this.config.maxTokens,
            temperature: this.config.temperature,
            hasApiKey: !!this.config.apiKey,
            baseUrl: this.config.baseUrl,
            systemPrompt: this.config.systemPrompt,
        };
    },

    // ==========================================================================
    // Chat Completion
    // ==========================================================================
    async chat(message, options = {}) {
        if (!this.isInitialized) {
            await this.init();
        }

        const {
            systemPrompt = this.config.systemPrompt,
            includeHistory = true,
            maxHistoryMessages = 10,
            streaming = false,
            tools = null,           // For function calling / tool use
            context = null,         // Additional context (workflow data, etc.)
        } = options;

        // Build messages array
        const messages = [];

        // Add system prompt
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        // Add context if provided
        if (context) {
            messages.push({
                role: 'system',
                content: `Current context:\n${JSON.stringify(context, null, 2)}`
            });
        }

        // Add conversation history
        if (includeHistory && this.conversationHistory.length > 0) {
            const historySlice = this.conversationHistory.slice(-maxHistoryMessages);
            messages.push(...historySlice);
        }

        // Add current message
        messages.push({ role: 'user', content: message });

        try {
            let response;

            switch (this.config.provider) {
                case 'openai':
                    response = await this._chatOpenAI(messages, tools);
                    break;
                case 'anthropic':
                    response = await this._chatAnthropic(messages, tools);
                    break;
                case 'local':
                    response = await this._chatLocal(messages);
                    break;
                case 'mcp':
                    response = await this._chatMCP(messages, tools);
                    break;
                default:
                    return { error: 'Unknown provider: ' + this.config.provider };
            }

            // Store in history
            this.conversationHistory.push({ role: 'user', content: message });
            this.conversationHistory.push({ role: 'assistant', content: response.content });

            // Trim history if too long
            if (this.conversationHistory.length > 100) {
                this.conversationHistory = this.conversationHistory.slice(-50);
            }

            // Save history
            await chrome.storage.local.set({ llmHistory: this.conversationHistory });

            return response;

        } catch (error) {
            console.error('[LLMClient] Chat error:', error);
            return { error: error.message || 'Chat request failed' };
        }
    },

    // ==========================================================================
    // Provider-Specific Implementations
    // ==========================================================================
    async _chatOpenAI(messages, tools) {
        const url = (this.config.baseUrl || this.PROVIDERS.openai.baseUrl) + '/chat/completions';

        const body = {
            model: this.config.model || this.PROVIDERS.openai.defaultModel,
            messages: messages,
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
        };

        // Add tools if provided
        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters || {}
                }
            }));
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0];

        return {
            content: choice?.message?.content || '',
            toolCalls: choice?.message?.tool_calls || null,
            usage: data.usage,
            model: data.model,
            finishReason: choice?.finish_reason
        };
    },

    async _chatAnthropic(messages, tools) {
        const url = (this.config.baseUrl || this.PROVIDERS.anthropic.baseUrl) + '/messages';

        // Convert messages format for Anthropic
        const systemContent = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const chatMessages = messages.filter(m => m.role !== 'system');

        const body = {
            model: this.config.model || this.PROVIDERS.anthropic.defaultModel,
            max_tokens: this.config.maxTokens,
            messages: chatMessages,
        };

        if (systemContent) {
            body.system = systemContent;
        }

        // Add tools if provided
        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters || { type: 'object', properties: {} }
            }));
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
        }

        const data = await response.json();

        // Extract content
        let content = '';
        let toolUse = null;

        for (const block of data.content || []) {
            if (block.type === 'text') {
                content += block.text;
            } else if (block.type === 'tool_use') {
                toolUse = {
                    id: block.id,
                    name: block.name,
                    input: block.input
                };
            }
        }

        return {
            content,
            toolCalls: toolUse ? [toolUse] : null,
            usage: data.usage,
            model: data.model,
            finishReason: data.stop_reason
        };
    },

    async _chatLocal(messages) {
        const baseUrl = this.config.baseUrl || this.PROVIDERS.local.baseUrl;

        // Try Ollama format first
        try {
            const response = await fetch(`${baseUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.config.model || 'llama2',
                    messages: messages,
                    stream: false,
                    options: {
                        temperature: this.config.temperature
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    content: data.message?.content || data.response || '',
                    model: data.model,
                    finishReason: 'stop'
                };
            }
        } catch (e) {
            // Try OpenAI-compatible format (LM Studio, etc.)
        }

        // OpenAI-compatible format fallback
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.config.model,
                messages: messages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature
            })
        });

        if (!response.ok) {
            throw new Error(`Local model error: ${response.status}`);
        }

        const data = await response.json();
        return {
            content: data.choices?.[0]?.message?.content || '',
            model: data.model,
            finishReason: data.choices?.[0]?.finish_reason
        };
    },

    async _chatMCP(messages, tools) {
        if (!this.config.mcpServerUrl) {
            throw new Error('MCP server URL not configured');
        }

        // Build MCP-compatible request
        const request = {
            jsonrpc: '2.0',
            method: 'sampling/createMessage',
            params: {
                messages: messages.map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: { type: 'text', text: m.content }
                })),
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
            },
            id: Date.now()
        };

        const response = await fetch(this.config.mcpServerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            throw new Error(`MCP server error: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'MCP error');
        }

        return {
            content: data.result?.content?.text || '',
            model: data.result?.model || 'mcp',
            finishReason: data.result?.stopReason || 'end_turn'
        };
    },

    // ==========================================================================
    // Workflow-Specific Helpers
    // ==========================================================================

    /**
     * Analyze a webpage and suggest workflow actions
     */
    async analyzePageForWorkflow(pageContext) {
        const prompt = `Analyze this webpage and suggest automation actions:

URL: ${pageContext.url}
Title: ${pageContext.title}
Interactive Elements: ${JSON.stringify(pageContext.elements, null, 2)}

Suggest a list of useful automation workflows for this page. For each workflow:
1. Give it a clear name
2. Describe what it does
3. List the steps (clicks, inputs, etc.)

Format your response as JSON:
{
  "workflows": [
    {
      "name": "Workflow Name",
      "description": "What it does",
      "steps": [
        { "action": "click", "target": "selector or description" },
        { "action": "input", "target": "selector", "value": "{{variable_name}}" }
      ]
    }
  ]
}`;

        const response = await this.chat(prompt, {
            systemPrompt: 'You are a workflow automation expert. Analyze webpages and suggest useful automation workflows. Always respond with valid JSON.',
            includeHistory: false
        });

        // Parse JSON from response
        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return { success: true, suggestions: JSON.parse(jsonMatch[0]) };
            }
        } catch (e) {
            console.warn('[LLMClient] Failed to parse workflow suggestions:', e);
        }

        return { success: true, raw: response.content };
    },

    /**
     * Generate natural language description of a recorded workflow
     */
    async describeWorkflow(workflow) {
        const prompt = `Describe this recorded browser workflow in natural language:

Workflow Name: ${workflow.name}
Site: ${workflow.domain}
Actions:
${workflow.actions.map((a, i) => `${i + 1}. ${a.type} on ${a.selector} (${a.label || a.tagName})`).join('\n')}

Provide:
1. A one-sentence summary
2. A detailed step-by-step description
3. Suggested improvements or variations`;

        const response = await this.chat(prompt, {
            systemPrompt: 'You are a helpful assistant that describes browser automation workflows clearly and concisely.',
            includeHistory: false
        });

        return { success: true, description: response.content };
    },

    /**
     * Smart chain builder - suggest how to connect workflows
     */
    async suggestChainConnections(workflows) {
        const prompt = `Given these recorded workflows, suggest how they could be chained together:

Workflows:
${workflows.map(w => `- ${w.name} (${w.domain}): ${w.actions.length} steps`).join('\n')}

Suggest chain combinations that would be useful. Consider:
1. Data flow between steps (what outputs become inputs)
2. Logical sequence of operations
3. Error handling and conditional branching

Format as JSON:
{
  "suggestedChains": [
    {
      "name": "Chain Name",
      "description": "What this chain accomplishes",
      "steps": ["workflow_id_1", "workflow_id_2"],
      "dataMapping": { "step2.input": "step1.output" }
    }
  ]
}`;

        const response = await this.chat(prompt, {
            systemPrompt: 'You are a workflow automation expert specializing in cross-application integrations.',
            includeHistory: false
        });

        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return { success: true, suggestions: JSON.parse(jsonMatch[0]) };
            }
        } catch (e) {
            console.warn('[LLMClient] Failed to parse chain suggestions:', e);
        }

        return { success: true, raw: response.content };
    },

    // ==========================================================================
    // Conversation Management
    // ==========================================================================
    clearHistory() {
        this.conversationHistory = [];
        chrome.storage.local.set({ llmHistory: [] });
        return { success: true };
    },

    getHistory() {
        return [...this.conversationHistory];
    },

    // ==========================================================================
    // Provider Discovery
    // ==========================================================================
    async listLocalModels() {
        try {
            const baseUrl = this.config.baseUrl || this.PROVIDERS.local.baseUrl;
            const response = await fetch(`${baseUrl}/tags`);

            if (response.ok) {
                const data = await response.json();
                return { success: true, models: data.models || [] };
            }
        } catch (e) {
            // Ollama not available
        }

        return { success: false, models: [], error: 'Could not connect to local model server' };
    },

    getAvailableProviders() {
        return Object.keys(this.PROVIDERS).map(key => ({
            id: key,
            name: key.charAt(0).toUpperCase() + key.slice(1),
            models: this.PROVIDERS[key].models,
            defaultModel: this.PROVIDERS[key].defaultModel,
            requiresApiKey: key === 'openai' || key === 'anthropic'
        }));
    }
};

// Export for use in service worker
if (typeof self !== 'undefined') {
    self.LLMClient = LLMClient;
}
