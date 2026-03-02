/**
 * LeadTapp - Popup Controller
 *
 * Manages lead display, feedback collection, and user interactions.
 */

import type {
  Lead,
  CallOutcome,
  LeadTappState,
  SessionStats
} from '../shared/types';
import { send } from '../shared/messages';

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
  // Progress
  progressFill: document.getElementById('progress-fill') as HTMLDivElement,
  progressText: document.getElementById('progress-text') as HTMLSpanElement,

  // Lead Card
  leadCard: document.getElementById('lead-card') as HTMLElement,
  leadTier: document.getElementById('lead-tier') as HTMLDivElement,
  leadType: document.getElementById('lead-type') as HTMLSpanElement,
  leadSource: document.getElementById('lead-source') as HTMLSpanElement,
  leadScore: document.getElementById('lead-score') as HTMLDivElement,
  leadName: document.getElementById('lead-name') as HTMLHeadingElement,
  leadPhone: document.getElementById('lead-phone') as HTMLAnchorElement,
  leadEmail: document.getElementById('lead-email') as HTMLAnchorElement,
  leadAddress: document.getElementById('lead-address-text') as HTMLSpanElement,
  leadProperty: document.getElementById('lead-property') as HTMLSpanElement,
  leadValue: document.getElementById('lead-value') as HTMLSpanElement,
  leadTime: document.getElementById('lead-time') as HTMLSpanElement,
  leadTags: document.getElementById('lead-tags') as HTMLDivElement,

  // Empty State
  emptyState: document.getElementById('empty-state') as HTMLElement,

  // Feedback
  feedbackSection: document.getElementById('feedback-section') as HTMLElement,
  outcomeButtons: document.querySelectorAll('.outcome-btn') as NodeListOf<HTMLButtonElement>,
  notesInput: document.getElementById('notes-input') as HTMLTextAreaElement,
  followupSection: document.getElementById('followup-section') as HTMLElement,
  followupDate: document.getElementById('followup-date') as HTMLInputElement,

  // Actions
  btnNext: document.getElementById('btn-next') as HTMLButtonElement,
  btnExport: document.getElementById('btn-export') as HTMLButtonElement,
  btnRefresh: document.getElementById('btn-refresh') as HTMLButtonElement,
  btnRefreshEmpty: document.getElementById('btn-refresh-empty') as HTMLButtonElement,

  // Stats
  statCalls: document.getElementById('stat-calls') as HTMLSpanElement,
  statAppointments: document.getElementById('stat-appointments') as HTMLSpanElement,
  statCallbacks: document.getElementById('stat-callbacks') as HTMLSpanElement,

  // Toast
  toast: document.getElementById('toast') as HTMLDivElement,
  toastMessage: document.getElementById('toast-message') as HTMLSpanElement
};

// =============================================================================
// State
// =============================================================================

let currentLead: Lead | null = null;
let selectedOutcome: CallOutcome | null = null;
let currentIndex = 0;
let totalLeads = 0;

// =============================================================================
// Initialization
// =============================================================================

async function init() {
  console.log('[LeadTapp] Initializing popup...');

  // Get current state from background
  const response = await send({ type: 'leadtapp/getState' });

  if (response?.state) {
    const state: LeadTappState = response.state;
    currentLead = state.currentLead;
    currentIndex = state.currentLeadIndex;
    totalLeads = state.totalLeads;
    updateStats(state.sessionStats);
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
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners() {
  // Outcome buttons
  elements.outcomeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const outcome = btn.dataset.outcome as CallOutcome;
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

  // Phone click - track call
  elements.leadPhone.addEventListener('click', () => {
    // Could track call initiation here
  });
}

// =============================================================================
// Lead Display
// =============================================================================

function renderLead(lead: Lead) {
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
  elements.leadPhone.querySelector('span')!.textContent = lead.phone;

  if (lead.email) {
    elements.leadEmail.href = `mailto:${lead.email}`;
    elements.leadEmail.querySelector('span')!.textContent = lead.email;
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

function selectOutcome(outcome: CallOutcome) {
  selectedOutcome = outcome;

  // Update button states
  elements.outcomeButtons.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.outcome === outcome);
  });

  // Show follow-up date for callback/appointment
  if (outcome === 'connected_callback' || outcome === 'connected_appointment') {
    elements.followupSection.classList.remove('hidden');
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
    return;
  }

  // Update stats
  if (feedbackResponse.stats) {
    updateStats(feedbackResponse.stats);
  }

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

function updateStats(stats: SessionStats) {
  elements.statCalls.textContent = stats.callsMade.toString();
  elements.statAppointments.textContent = stats.appointmentsSet.toString();
  elements.statCallbacks.textContent = stats.callbacksScheduled.toString();
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
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

function formatLeadType(type: string): string {
  const map: Record<string, string> = {
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

// =============================================================================
// Bootstrap
// =============================================================================

init();
