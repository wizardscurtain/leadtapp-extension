/**
 * LeadTapp - Background Service Worker
 *
 * Manages lead queue, feedback storage, and CSV export.
 */

import type {
  Lead,
  CallFeedback,
  Agent,
  LeadTappState,
  StoredFeedback,
  SessionStats,
  CallOutcome
} from '../shared/types';

// =============================================================================
// State Management
// =============================================================================

const state: LeadTappState = {
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
let leadQueue: Lead[] = [];
let feedbackRequired = false;

// =============================================================================
// Initialization
// =============================================================================

async function initialize() {
  console.log('[LeadTapp] Initializing...');

  // Load saved state
  const saved = await chrome.storage.local.get([
    'agent',
    'leadQueue',
    'feedbackHistory',
    'sessionStats',
    'currentLeadIndex'
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
  if (!message?.type?.startsWith('leadtapp/')) return;

  handleMessage(message)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));

  return true;
});

async function handleMessage(message: any): Promise<any> {
  switch (message.type) {
    // State
    case 'leadtapp/getState':
      return { state };

    // Leads
    case 'leadtapp/lead/next':
      return await getNextLead();

    case 'leadtapp/lead/refresh':
      loadDemoLeads();
      return { success: true, total: leadQueue.length };

    // Feedback
    case 'leadtapp/feedback/submit':
      return await submitFeedback(message.feedback);

    // Export
    case 'leadtapp/export/csv':
      return await exportToCsv(message.options);

    default:
      return { error: 'Unknown message type' };
  }
}

// =============================================================================
// Lead Management
// =============================================================================

async function getNextLead(): Promise<any> {
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

async function submitFeedback(feedback: Omit<CallFeedback, 'agentId' | 'timestamp'>): Promise<any> {
  if (!feedback.outcome) {
    return { success: false, error: 'Outcome is required' };
  }

  if (!feedback.notes || feedback.notes.trim().length === 0) {
    return { success: false, error: 'Notes are required' };
  }

  const fullFeedback: StoredFeedback = {
    ...feedback,
    agentId: state.agent?.id || 'anonymous',
    timestamp: new Date().toISOString(),
    lead: state.currentLead!,
    synced: false
  };

  // Store feedback
  const stored = await chrome.storage.local.get('feedbackHistory');
  const history: StoredFeedback[] = stored.feedbackHistory || [];
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

async function exportToCsv(options?: any): Promise<any> {
  const stored = await chrome.storage.local.get('feedbackHistory');
  const history: StoredFeedback[] = stored.feedbackHistory || [];

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
// Bootstrap
// =============================================================================

initialize();
