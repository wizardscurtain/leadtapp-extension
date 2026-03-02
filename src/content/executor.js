/**
 * LeadTapp - Action Executor Content Script
 *
 * Injected into pages to execute recorded workflow actions.
 * Handles element finding with fallbacks and action simulation.
 */

(function() {
    'use strict';

    // Prevent double-injection
    if (window.__leadtappExecutor) return;
    window.__leadtappExecutor = true;

    // =============================================================================
    // Element Finding
    // =============================================================================

    /**
     * Find element using multiple selector strategies
     */
    async function findElement(action, timeout = 5000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            // Try primary selector
            let element = querySelectorSafe(action.selector);
            if (element && isInteractable(element)) {
                return element;
            }

            // Try fallbacks
            for (const fallback of (action.selectorFallbacks || [])) {
                element = querySelectorSafe(fallback);
                if (element && isInteractable(element)) {
                    console.log('[LeadTapp Executor] Used fallback selector:', fallback);
                    return element;
                }
            }

            // Try XPath
            if (action.xpath) {
                element = document.evaluate(
                    action.xpath,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;

                if (element && isInteractable(element)) {
                    console.log('[LeadTapp Executor] Used XPath:', action.xpath);
                    return element;
                }
            }

            // Try text-based selector (custom :text() syntax)
            if (action.selector.includes(':text(')) {
                element = findByText(action.selector);
                if (element && isInteractable(element)) {
                    return element;
                }
            }

            // Wait a bit and retry
            await sleep(100);
        }

        return null;
    }

    /**
     * Safe querySelector that handles invalid selectors
     */
    function querySelectorSafe(selector) {
        try {
            // Handle our custom :text() syntax
            if (selector.includes(':text(')) {
                return findByText(selector);
            }
            return document.querySelector(selector);
        } catch (e) {
            console.warn('[LeadTapp Executor] Invalid selector:', selector);
            return null;
        }
    }

    /**
     * Find element by text content
     * Handles selectors like: button:text("Submit")
     */
    function findByText(selector) {
        const match = selector.match(/^(\w+):text\("(.+)"\)$/);
        if (!match) return null;

        const [, tagName, text] = match;
        const elements = document.querySelectorAll(tagName);

        for (const el of elements) {
            if (el.textContent.trim().includes(text)) {
                return el;
            }
        }

        return null;
    }

    /**
     * Check if element is visible and interactable
     */
    function isInteractable(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.pointerEvents === 'none') return false;

        return true;
    }

    // =============================================================================
    // Action Execution
    // =============================================================================

    /**
     * Execute a single action
     */
    async function executeAction(action, variables = {}) {
        console.log('[LeadTapp Executor] Executing:', action.label);

        // Wait for any specified delay
        if (action.delay && action.delay > 0) {
            await sleep(Math.min(action.delay, 2000)); // Cap at 2 seconds
        }

        const element = await findElement(action);

        if (!element) {
            throw new Error(`Element not found: ${action.label} (${action.selector})`);
        }

        // Scroll element into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);

        // Highlight element briefly
        showExecutionFeedback(element);

        switch (action.type) {
            case 'click':
                await executeClick(element);
                break;

            case 'input':
                const inputValue = action.isVariable && variables[action.variableName]
                    ? variables[action.variableName]
                    : action.value;
                await executeInput(element, inputValue);
                break;

            case 'select':
                const selectValue = action.isVariable && variables[action.variableName]
                    ? variables[action.variableName]
                    : action.value;
                await executeSelect(element, selectValue);
                break;

            case 'keypress':
                await executeKeypress(element, action.value);
                break;

            default:
                console.warn('[LeadTapp Executor] Unknown action type:', action.type);
        }

        return { success: true, element };
    }

    /**
     * Simulate a realistic click
     */
    async function executeClick(element) {
        // Focus element first
        element.focus();
        await sleep(50);

        // Dispatch mouse events
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const events = ['mousedown', 'mouseup', 'click'];
        for (const eventType of events) {
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

    /**
     * Simulate realistic typing
     */
    async function executeInput(element, value) {
        element.focus();
        await sleep(50);

        // Clear existing value
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(50);

        // Type character by character for more realistic simulation
        for (const char of value) {
            element.value += char;
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: char
            }));
            await sleep(20 + Math.random() * 30); // Random delay 20-50ms
        }

        // Final change event
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Execute select dropdown change
     */
    async function executeSelect(element, value) {
        element.focus();
        await sleep(50);

        // Find option by value or text
        const option = Array.from(element.options).find(
            opt => opt.value === value || opt.textContent.trim() === value
        );

        if (option) {
            element.value = option.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Execute keypress
     */
    async function executeKeypress(element, key) {
        element.focus();
        await sleep(50);

        const keyMap = {
            'Enter': 13,
            'Escape': 27,
            'Tab': 9,
            'Backspace': 8,
            'Delete': 46
        };

        const keyCode = keyMap[key] || key.charCodeAt(0);

        const events = ['keydown', 'keypress', 'keyup'];
        for (const eventType of events) {
            const event = new KeyboardEvent(eventType, {
                key,
                code: `Key${key.toUpperCase()}`,
                keyCode,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(event);
            await sleep(10);
        }
    }

    // =============================================================================
    // Workflow Execution
    // =============================================================================

    /**
     * Execute a full workflow (sequence of actions)
     */
    async function executeWorkflow(workflow, variables = {}) {
        console.log('[LeadTapp Executor] Starting workflow:', workflow.name);

        const results = [];
        let currentStep = 0;

        for (const action of workflow.actions) {
            try {
                // Notify progress
                chrome.runtime.sendMessage({
                    type: 'leadtapp/executor/progress',
                    workflowId: workflow.id,
                    currentStep,
                    totalSteps: workflow.actions.length,
                    currentAction: action.label
                });

                const result = await executeAction(action, variables);
                results.push({ action: action.id, ...result });
                currentStep++;

                // Small delay between actions
                await sleep(300);

            } catch (error) {
                console.error('[LeadTapp Executor] Action failed:', error);

                chrome.runtime.sendMessage({
                    type: 'leadtapp/executor/error',
                    workflowId: workflow.id,
                    step: currentStep,
                    action: action.label,
                    error: error.message
                });

                return {
                    success: false,
                    completedSteps: currentStep,
                    error: error.message,
                    results
                };
            }
        }

        console.log('[LeadTapp Executor] Workflow completed:', workflow.name);

        return {
            success: true,
            completedSteps: workflow.actions.length,
            results
        };
    }

    // =============================================================================
    // Data Capture (for cross-tab workflows)
    // =============================================================================

    /**
     * Capture data from the page for passing to next step
     */
    function captureData(selectors) {
        const data = {};

        for (const [key, selector] of Object.entries(selectors)) {
            try {
                const element = document.querySelector(selector);
                if (element) {
                    data[key] = element.value || element.textContent.trim();
                }
            } catch (e) {
                console.warn('[LeadTapp Executor] Capture failed for:', key);
            }
        }

        return data;
    }

    /**
     * Get current page state for live polling
     */
    function getPageState(config = {}) {
        const state = {
            url: window.location.href,
            title: document.title,
            timestamp: Date.now()
        };

        // Badge counts (common pattern)
        if (config.badgeSelectors) {
            for (const [name, selector] of Object.entries(config.badgeSelectors)) {
                const el = document.querySelector(selector);
                if (el) {
                    const count = parseInt(el.textContent.trim(), 10);
                    state[name] = isNaN(count) ? el.textContent.trim() : count;
                }
            }
        }

        // Custom data points
        if (config.dataSelectors) {
            for (const [name, selector] of Object.entries(config.dataSelectors)) {
                const el = document.querySelector(selector);
                state[name] = el ? el.textContent.trim() : null;
            }
        }

        return state;
    }

    // =============================================================================
    // Visual Feedback
    // =============================================================================

    function showExecutionFeedback(element) {
        const rect = element.getBoundingClientRect();

        const highlight = document.createElement('div');
        highlight.style.cssText = `
            position: fixed;
            left: ${rect.left - 4}px;
            top: ${rect.top - 4}px;
            width: ${rect.width + 8}px;
            height: ${rect.height + 8}px;
            border: 3px solid #4A90D9;
            border-radius: 4px;
            background: rgba(74, 144, 217, 0.1);
            pointer-events: none;
            z-index: 2147483646;
            transition: opacity 0.3s;
        `;

        document.body.appendChild(highlight);

        setTimeout(() => {
            highlight.style.opacity = '0';
            setTimeout(() => highlight.remove(), 300);
        }, 500);
    }

    // =============================================================================
    // Utilities
    // =============================================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =============================================================================
    // Message Handler
    // =============================================================================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        (async () => {
            switch (message.type) {
                case 'leadtapp/executor/action':
                    try {
                        const result = await executeAction(message.action, message.variables);
                        sendResponse({ success: true, ...result });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message });
                    }
                    break;

                case 'leadtapp/executor/workflow':
                    try {
                        const result = await executeWorkflow(message.workflow, message.variables);
                        sendResponse(result);
                    } catch (error) {
                        sendResponse({ success: false, error: error.message });
                    }
                    break;

                case 'leadtapp/executor/capture':
                    const data = captureData(message.selectors);
                    sendResponse({ success: true, data });
                    break;

                case 'leadtapp/executor/state':
                    const state = getPageState(message.config);
                    sendResponse({ success: true, state });
                    break;

                case 'leadtapp/executor/ping':
                    sendResponse({ success: true, ready: true });
                    break;
            }
        })();
        return true;
    });

    console.log('[LeadTapp Executor] Content script loaded');
})();
