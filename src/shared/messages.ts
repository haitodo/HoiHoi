import type {
  ImageItem,
  ItemDownloadState,
  RawCandidateGroup,
  ScanStatus,
  TabSessionSnapshot,
} from './types';

/**
 * Strongly-typed IPC contracts across the 3 extension contexts:
 *   1. Content Script -> Background SW (`ContentToBackgroundMessage`)
 *   2. Background SW  -> Content Script (`BackgroundToContentMessage`)
 *   3. Side Panel UI  -> Background SW (`PanelToBackgroundMessage`)
 *   4. Background SW  -> Side Panel UI (`BackgroundToPanelEvent`)
 *
 * All messages carry a `channel` discriminator so listeners ignore unrelated messages cleanly.
 */

export type MessageResult<T = undefined> =
  | ([T] extends [undefined] ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string; code?: string };

// ============================================================================
// 1. Content Script -> Background Service Worker (`chrome.runtime.sendMessage`)
// ============================================================================

export type ContentToBackgroundMessage =
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_SCAN_BATCH';
      scanEpoch: number;
      pageUrl: string;
      groups: RawCandidateGroup[];
    }
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_SCAN_STATUS';
      scanEpoch: number;
      pageUrl: string;
      status: Extract<ScanStatus, 'scanning' | 'watching' | 'limit_reached'>;
    }
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_IMAGE_LOADED_DIMENSIONS';
      scanEpoch: number;
      url: string;
      naturalWidth: number;
      naturalHeight: number;
    };

// ============================================================================
// 2. Background Service Worker -> Content Script (`chrome.tabs.sendMessage`)
// ============================================================================

export type BackgroundToContentMessage =
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_PING_CONTENT';
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_START_OR_RESCAN';
      scanEpoch: number;
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_FETCH_BLOB_AS_DATA_URL';
      blobUrl: string;
      maxBytes: number;
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_RESOLVE_LARGE_DATA_URL';
      largeDataRefId: string;
    };

export interface ContentPingResponse {
  alive: true;
  pageUrl: string;
  scanEpoch: number;
}

export interface BlobDataUrlResponse {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

// ============================================================================
// 3. Side Panel UI -> Background Service Worker (`chrome.runtime.sendMessage`)
// ============================================================================

export type SelectionMutation =
  | { mode: 'toggle_one'; itemId: string }
  | { mode: 'add_many'; itemIds: string[] }    // Used for "表示中を全選択" (`spec.md` §4.3, MVP-10)
  | { mode: 'remove_many'; itemIds: string[] } // Optional partial deselect
  | { mode: 'clear_all' };                     // Used for "全解除" (clears hidden selections too)

export type PanelToBackgroundMessage =
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_GET_TAB_SESSION';
      tabId: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_TRIGGER_RESCAN';
      tabId: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_UPDATE_SELECTION';
      tabId: number;
      mutation: SelectionMutation;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_SELECT_VARIANT';
      tabId: number;
      itemId: string;
      variantUrl: string;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_REPORT_THUMB_DIMENSIONS';
      tabId: number;
      itemId: string;
      variantUrl: string;
      naturalWidth: number;
      naturalHeight: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_ENQUEUE_DOWNLOADS';
      tabId: number;
      /** Specific itemIds (single card download or current `selectedIds` for batch download). */
      itemIds: string[];
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_RETRY_FAILED_DOWNLOADS';
      tabId: number;
      /** Specific failed `itemId`s, or omit to retry all retryable failed items in this tab (`spec.md` MVP-16). */
      itemIds?: string[];
    };

// ============================================================================
// 4. Background Service Worker -> Side Panel UI (`chrome.runtime.sendMessage`)
// ============================================================================

/**
 * Delta events pushed from Background to Side Panel.
 * Rule: Each event carries the new `revision` for `tabId`. If Side Panel observes
 * `event.revision !== localRevision + 1`, it MUST call `PANEL_GET_TAB_SESSION`
 * to self-heal any missed messages (`design.md` §6.1).
 */
export type BackgroundToPanelEvent =
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_SESSION_REPLACED';
      tabId: number;
      snapshot: TabSessionSnapshot;
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_ITEMS_UPSERTED';
      tabId: number;
      revision: number;
      upsertedItems: ImageItem[];
      scanStatus: ScanStatus;
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_SCAN_STATUS_CHANGED';
      tabId: number;
      revision: number;
      scanStatus: ScanStatus;
      statusMessage?: string;
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_SELECTION_CHANGED';
      tabId: number;
      revision: number;
      selectedIds: string[];
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_DOWNLOADS_UPDATED';
      tabId: number;
      revision: number;
      updatedDownloads: ItemDownloadState[];
    };

// Type guards for message routing
export function isContentToBgMessage(msg: unknown): msg is ContentToBackgroundMessage {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === 'WIC_CONTENT_TO_BG';
}

export function isBgToContentMessage(msg: unknown): msg is BackgroundToContentMessage {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === 'WIC_BG_TO_CONTENT';
}

export function isPanelToBgMessage(msg: unknown): msg is PanelToBackgroundMessage {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === 'WIC_PANEL_TO_BG';
}

export function isBgToPanelEvent(msg: unknown): msg is BackgroundToPanelEvent {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === 'WIC_BG_TO_PANEL';
}
