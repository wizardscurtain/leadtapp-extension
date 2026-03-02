/**
 * LeadTapp - Message Contracts
 *
 * Type-safe message passing between extension components.
 */

import type {
  Lead,
  CallFeedback,
  Agent,
  LeadTappState,
  StoredFeedback,
  ExportOptions,
  ApiConfig
} from './types';

const PREFIX = 'leadtapp/';

// =============================================================================
// State Messages
// =============================================================================

export interface MsgGetState {
  type: `${typeof PREFIX}getState`;
}

export interface MsgStateResponse {
  type: `${typeof PREFIX}state`;
  state: LeadTappState;
}

// =============================================================================
// Lead Messages
// =============================================================================

export interface MsgGetNextLead {
  type: `${typeof PREFIX}lead/next`;
}

export interface MsgLeadResponse {
  type: `${typeof PREFIX}lead/current`;
  lead: Lead | null;
  index: number;
  total: number;
}

export interface MsgRefreshLeads {
  type: `${typeof PREFIX}lead/refresh`;
}

// =============================================================================
// Feedback Messages
// =============================================================================

export interface MsgSubmitFeedback {
  type: `${typeof PREFIX}feedback/submit`;
  feedback: Omit<CallFeedback, 'agentId' | 'timestamp'>;
}

export interface MsgFeedbackResponse {
  type: `${typeof PREFIX}feedback/response`;
  success: boolean;
  canAdvance: boolean;
  error?: string;
}

// =============================================================================
// Export Messages
// =============================================================================

export interface MsgExportData {
  type: `${typeof PREFIX}export/csv`;
  options?: ExportOptions;
}

export interface MsgExportResponse {
  type: `${typeof PREFIX}export/response`;
  success: boolean;
  filename?: string;
  rowCount?: number;
  error?: string;
}

// =============================================================================
// Config Messages
// =============================================================================

export interface MsgSetConfig {
  type: `${typeof PREFIX}config/set`;
  config: Partial<ApiConfig>;
}

// =============================================================================
// Union Types
// =============================================================================

export type OutgoingMessage =
  | MsgGetState
  | MsgGetNextLead
  | MsgRefreshLeads
  | MsgSubmitFeedback
  | MsgExportData
  | MsgSetConfig;

export type IncomingMessage =
  | MsgStateResponse
  | MsgLeadResponse
  | MsgFeedbackResponse
  | MsgExportResponse;

// =============================================================================
// Message Utilities
// =============================================================================

const runtime = (globalThis as any).chrome?.runtime || {
  sendMessage: (_m: any, cb: Function) => cb && cb(undefined),
  onMessage: { addListener: () => {} }
};

export function send<T extends OutgoingMessage>(msg: T): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(msg, (response: any) => {
        if (runtime.lastError) {
          reject(new Error(runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function onMessage(handler: (msg: IncomingMessage, sender?: chrome.runtime.MessageSender) => void | Promise<any>) {
  runtime.onMessage.addListener((msg: any, sender: any, sendResponse: Function) => {
    if (msg?.type?.startsWith('leadtapp/')) {
      const result = handler(msg as IncomingMessage, sender);
      if (result instanceof Promise) {
        result.then(sendResponse).catch(err => sendResponse({ error: err.message }));
        return true;
      }
    }
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
