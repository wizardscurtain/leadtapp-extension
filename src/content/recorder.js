/**
 * LeadTapp - Workflow Recorder Content Script
 *
 * Injected into pages during recording to capture user interactions.
 * Generates robust selectors and captures element snapshots.
 */

(function() {
    'use strict';

    // Prevent double-injection
    if (window.__leadtappRecorder) return;
    window.__leadtappRecorder = true;

    // =============================================================================
    // State
    // =============================================================================

    let isRecording = false;
    let recordedActions = [];
    let lastActionTime = 0;
    let highlightOverlay = null;

    // =============================================================================
    // Selector Generation
    // =============================================================================

    /**
     * Generate multiple selector strategies for an element
     */
    function generateSelectors(element) {
        const selectors = [];
        const fallbacks = [];

        // Strategy 1: ID (most reliable)
        if (element.id) {
            selectors.push(`#${CSS.escape(element.id)}`);
        }

        // Strategy 2: data-testid or data-cy (test attributes)
        const testId = element.getAttribute('data-testid') ||
                       element.getAttribute('data-cy') ||
                       element.getAttribute('data-test');
        if (testId) {
            selectors.push(`[data-testid="${testId}"]`);
        }

        // Strategy 3: aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            fallbacks.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
        }

        // Strategy 4: Name attribute (for form elements)
        if (element.name) {
            fallbacks.push(`[name="${CSS.escape(element.name)}"]`);
        }

        // Strategy 5: Unique class combination
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(/\s+/).filter(c => c && !c.match(/^(hover|active|focus|selected)/));
            if (classes.length > 0 && classes.length <= 3) {
                const classSelector = '.' + classes.map(c => CSS.escape(c)).join('.');
                if (document.querySelectorAll(classSelector).length === 1) {
                    fallbacks.push(classSelector);
                }
            }
        }

        // Strategy 6: Tag + text content (for buttons/links)
        const text = element.textContent?.trim().slice(0, 50);
        if (text && ['BUTTON', 'A', 'SPAN', 'DIV'].includes(element.tagName)) {
            // This will be used with :contains() polyfill during execution
            fallbacks.push(`${element.tagName.toLowerCase()}:text("${text}")`);
        }

        // Strategy 7: Nth-child path
        const nthPath = getNthChildPath(element);
        if (nthPath) {
            fallbacks.push(nthPath);
        }

        return {
            primary: selectors[0] || fallbacks[0] || getFullPath(element),
            fallbacks: [...selectors.slice(1), ...fallbacks],
            xpath: getXPath(element)
        };
    }

    /**
     * Get nth-child path from body
     */
    function getNthChildPath(element) {
        const path = [];
        let current = element;

        while (current && current !== document.body && path.length < 8) {
            const parent = current.parentElement;
            if (!parent) break;

            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(current) + 1;
            const tagName = current.tagName.toLowerCase();

            path.unshift(`${tagName}:nth-child(${index})`);
            current = parent;
        }

        return path.length > 0 ? path.join(' > ') : null;
    }

    /**
     * Get full CSS path
     */
    function getFullPath(element) {
        const path = [];
        let current = element;

        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector = `#${CSS.escape(current.id)}`;
                path.unshift(selector);
                break;
            }

            if (current.className && typeof current.className === 'string') {
                const classes = current.className.split(/\s+/).slice(0, 2);
                if (classes.length > 0) {
                    selector += '.' + classes.map(c => CSS.escape(c)).join('.');
                }
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }

    /**
     * Generate XPath for element
     */
    function getXPath(element) {
        if (element.id) {
            return `//*[@id="${element.id}"]`;
        }

        const parts = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = current.previousElementSibling;

            while (sibling) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
            }

            const tagName = current.tagName.toLowerCase();
            parts.unshift(`${tagName}[${index}]`);
            current = current.parentElement;
        }

        return '/' + parts.join('/');
    }

    // =============================================================================
    // Element Snapshot
    // =============================================================================

    /**
     * Capture element data for replay and display
     */
    function captureElementSnapshot(element) {
        const rect = element.getBoundingClientRect();

        return {
            tagName: element.tagName.toLowerCase(),
            innerText: (element.innerText || element.textContent || '').slice(0, 100),
            className: element.className,
            id: element.id,
            name: element.name,
            type: element.type,
            placeholder: element.placeholder,
            rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            },
            isVisible: rect.width > 0 && rect.height > 0,
            thumbnail: null // Could add canvas screenshot here
        };
    }

    /**
     * Generate human-readable label for action
     */
    function generateLabel(element, actionType) {
        const text = (element.innerText || element.textContent || '').trim().slice(0, 30);
        const placeholder = element.placeholder || '';
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.title || '';

        const displayText = text || ariaLabel || placeholder || title || element.name || element.tagName.toLowerCase();

        switch (actionType) {
            case 'click':
                return `Click "${displayText}"`;
            case 'input':
                return `Type in "${displayText}"`;
            case 'select':
                return `Select from "${displayText}"`;
            default:
                return `${actionType} on "${displayText}"`;
        }
    }

    // =============================================================================
    // Recording Handlers
    // =============================================================================

    function handleClick(event) {
        if (!isRecording) return;

        const target = event.target;

        // Ignore our own UI elements
        if (target.closest('#leadtapp-recording-bar') ||
            target.closest('#leadtapp-highlight') ||
            target.closest('#leadtapp-tooltip') ||
            target.closest('.sr-step-feedback')) return;

        // Get the actual interactable element (climb up if needed)
        const element = getInteractableElement(target);
        const selectors = generateSelectors(element);
        const snapshot = captureElementSnapshot(element);

        const action = {
            id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            type: 'click',
            selector: selectors.primary,
            selectorFallbacks: selectors.fallbacks,
            xpath: selectors.xpath,
            label: generateLabel(element, 'click'),
            tagName: element.tagName.toLowerCase(),
            elementSnapshot: snapshot,
            timestamp: Date.now(),
            delay: lastActionTime ? Date.now() - lastActionTime : 0,
            isVariable: false
        };

        recordAction(action);
        showClickFeedback(event.clientX, event.clientY);
    }

    function handleInput(event) {
        if (!isRecording) return;

        const element = event.target;

        // Only track actual input elements
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
        if (element.closest('#leadtapp-recording-bar')) return;

        // Debounce input events
        clearTimeout(element.__leadtappInputTimeout);
        element.__leadtappInputTimeout = setTimeout(() => {
            const selectors = generateSelectors(element);
            const snapshot = captureElementSnapshot(element);

            const action = {
                id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                type: element.tagName === 'SELECT' ? 'select' : 'input',
                selector: selectors.primary,
                selectorFallbacks: selectors.fallbacks,
                xpath: selectors.xpath,
                label: generateLabel(element, 'input'),
                tagName: element.tagName.toLowerCase(),
                value: element.value,
                elementSnapshot: snapshot,
                timestamp: Date.now(),
                delay: lastActionTime ? Date.now() - lastActionTime : 0,
                isVariable: false,
                variableName: null,
                variableDefault: element.value
            };

            recordAction(action);
        }, 500);
    }

    function handleKeydown(event) {
        if (!isRecording) return;

        // Capture special key presses (Enter, Escape, Tab, etc.)
        const specialKeys = ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete'];
        if (!specialKeys.includes(event.key)) return;

        const element = event.target;
        if (element.closest('#leadtapp-recording-bar')) return;

        const selectors = generateSelectors(element);
        const snapshot = captureElementSnapshot(element);

        const action = {
            id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            type: 'keypress',
            selector: selectors.primary,
            selectorFallbacks: selectors.fallbacks,
            xpath: selectors.xpath,
            label: `Press ${event.key}`,
            tagName: element.tagName.toLowerCase(),
            value: event.key,
            elementSnapshot: snapshot,
            timestamp: Date.now(),
            delay: lastActionTime ? Date.now() - lastActionTime : 0,
            isVariable: false
        };

        recordAction(action);
    }

    // =============================================================================
    // Recording Control
    // =============================================================================

    function recordAction(action) {
        recordedActions.push(action);
        lastActionTime = action.timestamp;

        // Send to background
        chrome.runtime.sendMessage({
            type: 'leadtapp/recorder/action',
            action
        });

        console.log('[LeadTapp Recorder] Action captured:', action.label);
    }

    function startRecording() {
        isRecording = true;
        recordedActions = [];
        lastActionTime = 0;

        document.addEventListener('click', handleClick, true);
        document.addEventListener('input', handleInput, true);
        document.addEventListener('change', handleInput, true);
        document.addEventListener('keydown', handleKeydown, true);

        showRecordingIndicator();
        console.log('[LeadTapp Recorder] Recording started');
    }

    function stopRecording() {
        isRecording = false;

        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('input', handleInput, true);
        document.removeEventListener('change', handleInput, true);
        document.removeEventListener('keydown', handleKeydown, true);

        hideRecordingIndicator();
        console.log('[LeadTapp Recorder] Recording stopped.', recordedActions.length, 'actions captured');

        return recordedActions;
    }

    // =============================================================================
    // Visual Feedback - Professional Overlay UI
    // =============================================================================

    let recordingBar = null;
    let highlightBox = null;
    let tooltipBox = null;
    let stepCount = 0;

    /**
     * Get the interactable element from a target (climb up to find clickable parent)
     */
    function getInteractableElement(target) {
        let el = target;
        const interactableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];

        while (el && el !== document.body) {
            if (interactableTags.includes(el.tagName)) return el;
            if (el.onclick || el.getAttribute('role') === 'button') return el;
            if (el.getAttribute('tabindex') !== null) return el;
            el = el.parentElement;
        }
        return target;
    }

    /**
     * Create the recording overlay UI elements
     */
    function createOverlayUI() {
        // Recording bar at top
        recordingBar = document.createElement('div');
        recordingBar.id = 'leadtapp-recording-bar';
        recordingBar.innerHTML = `
            <span class="sr-rec-dot"></span>
            <span class="sr-rec-text">RECORDING</span>
            <span class="sr-rec-hint">Click elements to capture • Press <kbd>Esc</kbd> to stop</span>
        `;
        document.body.appendChild(recordingBar);

        // Element highlight box
        highlightBox = document.createElement('div');
        highlightBox.id = 'leadtapp-highlight';
        document.body.appendChild(highlightBox);

        // Selector tooltip
        tooltipBox = document.createElement('div');
        tooltipBox.id = 'leadtapp-tooltip';
        document.body.appendChild(tooltipBox);

        // Add mousemove listener for hover highlight
        document.addEventListener('mousemove', handleMouseMove, true);

        // Add escape key listener
        document.addEventListener('keydown', handleEscapeKey, true);
    }

    /**
     * Remove the recording overlay UI
     */
    function removeOverlayUI() {
        if (recordingBar) {
            recordingBar.remove();
            recordingBar = null;
        }
        if (highlightBox) {
            highlightBox.remove();
            highlightBox = null;
        }
        if (tooltipBox) {
            tooltipBox.remove();
            tooltipBox = null;
        }
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('keydown', handleEscapeKey, true);
    }

    /**
     * Handle mouse movement to highlight hovered elements
     */
    function handleMouseMove(e) {
        if (!isRecording || !highlightBox || !tooltipBox) return;

        // Don't highlight our own UI
        if (e.target.closest('#leadtapp-recording-bar') ||
            e.target.closest('#leadtapp-highlight') ||
            e.target.closest('#leadtapp-tooltip')) {
            highlightBox.style.display = 'none';
            tooltipBox.style.display = 'none';
            return;
        }

        const el = getInteractableElement(e.target);
        const rect = el.getBoundingClientRect();

        // Position highlight
        highlightBox.style.display = 'block';
        highlightBox.style.left = `${rect.left + window.scrollX}px`;
        highlightBox.style.top = `${rect.top + window.scrollY}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;

        // Get short selector for tooltip
        const shortSelector = getShortSelector(el);
        tooltipBox.textContent = shortSelector;
        tooltipBox.style.display = 'block';
        tooltipBox.style.left = `${rect.left + window.scrollX}px`;
        tooltipBox.style.top = `${rect.bottom + window.scrollY + 4}px`;
    }

    /**
     * Get a short selector for tooltip display
     */
    function getShortSelector(el) {
        if (el.id) return `#${el.id}`;
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || '').trim().slice(0, 20);
        if (text) return `${tag}: "${text}${text.length >= 20 ? '...' : ''}"`;
        if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(' ')[0];
            if (cls) return `${tag}.${cls}`;
        }
        return tag;
    }

    /**
     * Handle escape key to stop recording
     */
    function handleEscapeKey(e) {
        if (e.key === 'Escape' && isRecording) {
            e.preventDefault();
            chrome.runtime.sendMessage({ type: 'leadtapp/recorder/stop' });
        }
    }

    /**
     * Show the recording indicator bar
     */
    function showRecordingIndicator() {
        stepCount = 0;
        createOverlayUI();
        console.log('[LeadTapp Recorder] Overlay UI created');
    }

    /**
     * Hide the recording indicator
     */
    function hideRecordingIndicator() {
        removeOverlayUI();
        console.log('[LeadTapp Recorder] Overlay UI removed');
    }

    /**
     * Show step capture feedback at click position
     */
    function showClickFeedback(x, y) {
        stepCount++;

        // Flash the highlight
        if (highlightBox) {
            highlightBox.classList.add('sr-flash');
            setTimeout(() => highlightBox.classList.remove('sr-flash'), 150);
        }

        // Show step number feedback
        const feedback = document.createElement('div');
        feedback.className = 'sr-step-feedback';
        feedback.textContent = `Step ${stepCount} captured`;
        feedback.style.left = `${x + 10}px`;
        feedback.style.top = `${y - 10}px`;
        document.body.appendChild(feedback);

        setTimeout(() => feedback.remove(), 1200);
    }

    // =============================================================================
    // Message Handler
    // =============================================================================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'leadtapp/recorder/start':
                startRecording();
                sendResponse({ success: true });
                break;

            case 'leadtapp/recorder/stop':
                const actions = stopRecording();
                sendResponse({ success: true, actions });
                break;

            case 'leadtapp/recorder/status':
                sendResponse({ isRecording, actionCount: recordedActions.length });
                break;

            case 'leadtapp/recorder/getActions':
                sendResponse({ actions: recordedActions });
                break;
        }
        return true;
    });

    console.log('[LeadTapp Recorder] Content script loaded');
})();
