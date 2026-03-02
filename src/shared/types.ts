/**
 * LeadTapp - Type Definitions
 *
 * Core types for leads, feedback, and agent state.
 */

// =============================================================================
// Lead Types
// =============================================================================

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;

  // Lead metadata
  source: string;
  leadType: LeadType;
  score?: number;
  tier?: 'A+' | 'A' | 'B' | 'C' | 'D';

  // Property info (if applicable)
  propertyType?: string;
  estimatedValue?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;

  // Timing
  assignedAt: string;
  bestCallTime?: string;
  timezone?: string;

  // Additional context
  notes?: string;
  tags?: string[];
  customFields?: Record<string, string>;
}

export type LeadType =
  | 'buyer'
  | 'seller'
  | 'investor'
  | 'renter'
  | 'fsbo'
  | 'expired'
  | 'circle_prospect'
  | 'sphere'
  | 'referral'
  | 'other';

// =============================================================================
// Feedback Types
// =============================================================================

export interface CallFeedback {
  leadId: string;
  agentId: string;
  timestamp: string;

  // Quick pick outcome
  outcome: CallOutcome;

  // Notes
  notes: string;

  // Follow-up
  followUpDate?: string;
  followUpAction?: string;

  // Call duration (if tracked)
  callDuration?: number;
}

export type CallOutcome =
  | 'connected_interested'
  | 'connected_not_interested'
  | 'connected_callback'
  | 'connected_appointment'
  | 'voicemail'
  | 'no_answer'
  | 'wrong_number'
  | 'disconnected'
  | 'do_not_call'
  | 'other';

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected_interested: 'Connected - Interested',
  connected_not_interested: 'Connected - Not Interested',
  connected_callback: 'Connected - Callback Scheduled',
  connected_appointment: 'Connected - Appointment Set!',
  voicemail: 'Left Voicemail',
  no_answer: 'No Answer',
  wrong_number: 'Wrong Number',
  disconnected: 'Number Disconnected',
  do_not_call: 'Do Not Call',
  other: 'Other'
};

export const OUTCOME_COLORS: Record<CallOutcome, string> = {
  connected_interested: '#22c55e',
  connected_not_interested: '#f97316',
  connected_callback: '#3b82f6',
  connected_appointment: '#10b981',
  voicemail: '#8b5cf6',
  no_answer: '#6b7280',
  wrong_number: '#ef4444',
  disconnected: '#dc2626',
  do_not_call: '#991b1b',
  other: '#9ca3af'
};

// =============================================================================
// Agent Types
// =============================================================================

export interface Agent {
  id: string;
  name: string;
  email: string;
  kwUid?: string;
  marketCenter?: string;
  teamName?: string;
}

// =============================================================================
// State Types
// =============================================================================

export interface LeadTappState {
  agent: Agent | null;
  isAuthenticated: boolean;
  currentLead: Lead | null;
  currentLeadIndex: number;
  totalLeads: number;
  sessionStats: SessionStats;
  apiConnected: boolean;
  lastSync: string | null;
}

export interface SessionStats {
  leadsViewed: number;
  callsMade: number;
  appointmentsSet: number;
  callbacksScheduled: number;
  sessionStarted: string;
}

// =============================================================================
// Storage Types
// =============================================================================

export interface StoredFeedback extends CallFeedback {
  lead: Lead;
  synced: boolean;
}

export interface ExportOptions {
  format: 'csv' | 'json';
  includeFields: string[];
  dateRange?: {
    from: string;
    to: string;
  };
  onlySynced?: boolean;
}

// =============================================================================
// API Types
// =============================================================================

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface LeadQueueResponse {
  leads: Lead[];
  total: number;
  remaining: number;
}

export interface FeedbackSubmitResponse {
  success: boolean;
  feedbackId?: string;
  error?: string;
}
