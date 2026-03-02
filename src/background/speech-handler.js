// =============================================================================
// LeadTapp - Speech Recognition Handler
// Provides two modes:
// 1. Coaching Mode - Real-time script suggestions during calls
// 2. Logging Mode - Auto-detect workflow actions from conversation
// =============================================================================

/**
 * @typedef {Object} SpeechConfig
 * @property {'coaching' | 'logging'} mode - Operating mode
 * @property {string} language - Recognition language (default: 'en-US')
 * @property {boolean} continuous - Keep listening after each result
 * @property {boolean} interimResults - Provide partial results
 */

/**
 * @typedef {Object} TranscriptEntry
 * @property {number} timestamp - Unix timestamp
 * @property {string} text - Transcribed text
 * @property {boolean} isFinal - Whether this is a final result
 * @property {number} confidence - Recognition confidence (0-1)
 */

/**
 * @typedef {Object} DetectedAction
 * @property {string} type - Action type (appointment, callback, etc.)
 * @property {string} trigger - Text that triggered detection
 * @property {number} confidence - Detection confidence
 * @property {Object} data - Extracted data (date, time, name, etc.)
 */

class SpeechHandler {
  constructor() {
    this.isListening = false;
    this.mode = 'coaching'; // 'coaching' or 'logging'
    this.transcript = [];
    this.detectedActions = [];
    this.subscribers = new Set();

    // Action detection patterns
    this.actionPatterns = {
      appointment: [
        /(?:schedule|book|set up|make|arrange)\s+(?:an?\s+)?appointment/i,
        /(?:meet|meeting|see you)\s+(?:on|at|next)\s+(\w+)/i,
        /(?:how about|let's do|works for me)\s+(\w+day|\d{1,2}(?:st|nd|rd|th)?)/i,
        /appointment\s+(?:for|on|at)\s+(.+)/i
      ],
      callback: [
        /(?:call|ring)\s+(?:you\s+)?back/i,
        /(?:try|reach)\s+(?:you\s+)?(?:again\s+)?(?:later|tomorrow|next week)/i,
        /(?:better time|good time)\s+(?:to call|for me)/i,
        /(?:call me|contact me)\s+(?:at|on|around)\s+(\d+)/i
      ],
      interested: [
        /(?:sounds|that's)\s+(?:good|great|interesting)/i,
        /(?:tell me|know)\s+more/i,
        /(?:what's|how much|what are)\s+(?:the|your)\s+(?:price|cost|fee|commission)/i,
        /(?:i'm|we're)\s+(?:interested|looking|thinking)/i
      ],
      notInterested: [
        /(?:not|don't|no)\s+(?:interested|thanks|thank you)/i,
        /(?:already|just)\s+(?:sold|listed|have)/i,
        /(?:working with|have)\s+(?:an?\s+)?(?:agent|realtor)/i,
        /(?:please|stop)\s+(?:don't\s+)?call/i
      ],
      objection: [
        /(?:too|very)\s+(?:expensive|high|much)/i,
        /(?:think|need to)\s+(?:about it|discuss|talk)/i,
        /(?:not\s+)?(?:right|good)\s+time/i,
        /(?:market|economy|rates)\s+(?:is|are)\s+(?:bad|terrible|down)/i
      ],
      contact: [
        /(?:my|the)\s+(?:number|phone|email)\s+is/i,
        /(?:reach|contact)\s+me\s+at/i,
        /(?:call|text|email)\s+(?:me\s+)?(?:at|on)?\s*(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i
      ]
    };

    // Coaching prompts based on detected context
    this.coachingPrompts = {
      greeting: "Try: 'Hi, this is [Name] from [Company]. I'm calling about your property at [Address]. Do you have a moment?'",
      appointment: "Great progress! Confirm: date, time, location. Offer: 'I'll send you a calendar invite to confirm.'",
      callback: "Lock it in: 'What time works best for you?' Get specific day and time.",
      objection_price: "Reframe: 'I understand. What price range would work for your situation?'",
      objection_time: "Plant seed: 'No problem. Would it help if I sent some market info for when you're ready?'",
      objection_agent: "Respect it: 'Great to hear you're working with someone. If anything changes, I'd love to help.'",
      closing: "Always end strong: 'Thanks for your time. I'll follow up [when]. Have a great day!'",
      silence: "Fill the gap: Ask an open question about their timeline or motivation."
    };
  }

  /**
   * Start listening with specified mode
   * @param {SpeechConfig} config
   */
  startListening(config = {}) {
    const mergedConfig = {
      mode: config.mode || 'coaching',
      language: config.language || 'en-US',
      continuous: true,
      interimResults: true,
      ...config
    };

    this.mode = mergedConfig.mode;
    this.isListening = true;
    this.transcript = [];
    this.detectedActions = [];

    this.notifySubscribers({
      type: 'state_change',
      state: 'listening',
      mode: this.mode
    });

    return { success: true, mode: this.mode };
  }

  /**
   * Stop listening
   */
  stopListening() {
    this.isListening = false;

    const summary = {
      transcript: [...this.transcript],
      detectedActions: [...this.detectedActions],
      duration: this.transcript.length > 0
        ? (this.transcript[this.transcript.length - 1].timestamp - this.transcript[0].timestamp)
        : 0
    };

    this.notifySubscribers({
      type: 'state_change',
      state: 'stopped',
      summary
    });

    return { success: true, summary };
  }

  /**
   * Process incoming transcript from side panel
   * @param {TranscriptEntry} entry
   */
  processTranscript(entry) {
    this.transcript.push(entry);

    // Detect actions from text
    const actions = this.detectActions(entry.text);
    if (actions.length > 0) {
      this.detectedActions.push(...actions);
      this.notifySubscribers({
        type: 'actions_detected',
        actions,
        transcript: entry
      });
    }

    // In coaching mode, generate real-time suggestions
    if (this.mode === 'coaching') {
      const coaching = this.generateCoaching(entry.text, actions);
      if (coaching) {
        this.notifySubscribers({
          type: 'coaching_suggestion',
          suggestion: coaching,
          transcript: entry
        });
      }
    }

    return { success: true, actions };
  }

  /**
   * Detect workflow actions from text
   * @param {string} text
   * @returns {DetectedAction[]}
   */
  detectActions(text) {
    const detected = [];

    for (const [actionType, patterns] of Object.entries(this.actionPatterns)) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          detected.push({
            type: actionType,
            trigger: match[0],
            confidence: this.calculateConfidence(match, text),
            data: this.extractActionData(actionType, match, text),
            timestamp: Date.now()
          });
          break; // One match per action type
        }
      }
    }

    return detected;
  }

  /**
   * Calculate detection confidence
   */
  calculateConfidence(match, fullText) {
    // Higher confidence for longer matches and clearer context
    const matchLength = match[0].length;
    const textLength = fullText.length;
    const ratio = matchLength / textLength;

    // Base confidence from match quality
    let confidence = Math.min(0.5 + ratio * 0.5, 0.95);

    // Boost for exact phrase matches
    if (match.length > 1 && match[1]) {
      confidence = Math.min(confidence + 0.1, 0.98);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Extract structured data from detected action
   */
  extractActionData(actionType, match, text) {
    const data = {};

    switch (actionType) {
      case 'appointment':
      case 'callback':
        // Try to extract date/time
        const dateMatch = text.match(/(?:on\s+)?(\w+day|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
        const timeMatch = text.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
        if (dateMatch) data.date = dateMatch[1];
        if (timeMatch) data.time = timeMatch[1];
        break;

      case 'contact':
        // Extract phone/email
        const phoneMatch = text.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
        const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (phoneMatch) data.phone = phoneMatch[1];
        if (emailMatch) data.email = emailMatch[1];
        break;
    }

    return data;
  }

  /**
   * Generate real-time coaching suggestion
   */
  generateCoaching(text, detectedActions) {
    const lowerText = text.toLowerCase();

    // Check for specific scenarios
    if (detectedActions.some(a => a.type === 'appointment')) {
      return {
        type: 'success',
        message: this.coachingPrompts.appointment,
        priority: 'high'
      };
    }

    if (detectedActions.some(a => a.type === 'callback')) {
      return {
        type: 'action',
        message: this.coachingPrompts.callback,
        priority: 'high'
      };
    }

    if (detectedActions.some(a => a.type === 'objection')) {
      if (lowerText.includes('expensive') || lowerText.includes('price') || lowerText.includes('cost')) {
        return {
          type: 'objection',
          message: this.coachingPrompts.objection_price,
          priority: 'medium'
        };
      }
      if (lowerText.includes('time') || lowerText.includes('busy')) {
        return {
          type: 'objection',
          message: this.coachingPrompts.objection_time,
          priority: 'medium'
        };
      }
    }

    if (detectedActions.some(a => a.type === 'notInterested')) {
      if (lowerText.includes('agent') || lowerText.includes('realtor')) {
        return {
          type: 'objection',
          message: this.coachingPrompts.objection_agent,
          priority: 'low'
        };
      }
    }

    // Check for conversation state needing guidance
    if (lowerText.includes('hello') || lowerText.includes('hi ') || lowerText.startsWith('hi')) {
      return {
        type: 'tip',
        message: this.coachingPrompts.greeting,
        priority: 'low'
      };
    }

    return null;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isListening: this.isListening,
      mode: this.mode,
      transcriptLength: this.transcript.length,
      detectedActionsCount: this.detectedActions.length,
      lastTranscript: this.transcript[this.transcript.length - 1] || null,
      detectedActions: this.detectedActions
    };
  }

  /**
   * Get full transcript
   */
  getTranscript() {
    return {
      entries: [...this.transcript],
      fullText: this.transcript.map(t => t.text).join(' '),
      duration: this.transcript.length > 0
        ? (this.transcript[this.transcript.length - 1].timestamp - this.transcript[0].timestamp)
        : 0
    };
  }

  /**
   * Subscribe to speech events
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify all subscribers
   */
  notifySubscribers(event) {
    this.subscribers.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error('[SpeechHandler] Subscriber error:', err);
      }
    });
  }

  /**
   * Generate workflow suggestion from detected actions
   */
  suggestWorkflowFromActions() {
    if (this.detectedActions.length === 0) {
      return null;
    }

    // Group actions by type
    const actionCounts = {};
    for (const action of this.detectedActions) {
      actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
    }

    // Determine suggested outcome
    const primaryAction = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])[0];

    const outcomeMap = {
      appointment: 'connected_appointment',
      callback: 'connected_callback',
      interested: 'connected_interested',
      notInterested: 'connected_not_interested',
      objection: 'connected_interested', // Still a conversation
      contact: 'connected_callback'
    };

    return {
      suggestedOutcome: outcomeMap[primaryAction[0]] || 'other',
      confidence: primaryAction[1] / this.detectedActions.length,
      actions: this.detectedActions,
      notes: this.generateAutoNotes()
    };
  }

  /**
   * Generate auto-notes from transcript and actions
   */
  generateAutoNotes() {
    const notes = [];

    // Add action summary
    const actionTypes = [...new Set(this.detectedActions.map(a => a.type))];
    if (actionTypes.length > 0) {
      notes.push(`Detected: ${actionTypes.join(', ')}`);
    }

    // Add extracted data
    for (const action of this.detectedActions) {
      if (action.data.date) notes.push(`Date mentioned: ${action.data.date}`);
      if (action.data.time) notes.push(`Time mentioned: ${action.data.time}`);
      if (action.data.phone) notes.push(`Phone: ${action.data.phone}`);
    }

    // Add key phrases
    const keyPhrases = this.detectedActions
      .slice(0, 3)
      .map(a => `"${a.trigger}"`)
      .join(', ');
    if (keyPhrases) {
      notes.push(`Key phrases: ${keyPhrases}`);
    }

    return notes.join('\n');
  }
}

// Export singleton instance to global scope (for importScripts compatibility)
const speechHandler = new SpeechHandler();
self.speechHandler = speechHandler;
