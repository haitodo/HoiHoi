import type {
  ImageItem,
  ItemDownloadState,
  MediaMode,
  RawCandidateGroup,
  RawVideoCandidateGroup,
  ScanStatus,
  TabSessionSnapshot,
  VideoItem,
} from './types';

/**
 * Strongly-typed IPC contracts across the 3 extension contexts:
 *   1. Content Script -> Background SW (`ContentToBackgroundMessage`)
 *   2. Background SW  -> Content Script (`BackgroundToContentMessage`)
 *   3. Side Panel UI  -> Background SW (`PanelToBackgroundMessage`)
 *   4. Background SW  -> Side Panel UI (`BackgroundToPanelEvent`)
 *   5. Extension Port Streaming (`BlobStreamPortMessage`)
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
      pageTitle?: string;
      groups: RawCandidateGroup[];
      videoGroups?: RawVideoCandidateGroup[];
    }
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_SCAN_STATUS';
      scanEpoch: number;
      pageUrl: string;
      pageTitle?: string;
      status: Extract<ScanStatus, 'scanning' | 'watching' | 'limit_reached'>;
    }
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_IMAGE_LOADED_DIMENSIONS';
      scanEpoch: number;
      url: string;
      naturalWidth: number;
      naturalHeight: number;
    }
  | {
      channel: 'WIC_CONTENT_TO_BG';
      type: 'CONTENT_VIDEO_METADATA_LOADED';
      scanEpoch: number;
      url: string;
      videoWidth: number | null;
      videoHeight: number | null;
      durationSec: number | null;
      isLive?: boolean;
      posterUrl?: string;
      isDrmProtected?: boolean;
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
      type: 'BG_PREPARE_VIDEO_BLOB';
      blobUrl: string;
      transferId: string;
      inlineMaxBytes: number;
      absoluteMaxBytes: number;
      recipientPanelId?: string;
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_FETCH_TEXT_ON_DEMAND';
      url: string;
      maxChars: number;
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_RESOLVE_LARGE_DATA_URL';
      largeDataRefId: string;
    }
  | {
      channel: 'WIC_BG_TO_CONTENT';
      type: 'BG_STOP_SCANNER';
      releaseData?: boolean;
    };

export interface ContentPingResponse {
  alive: true;
  pageUrl: string;
  pageTitle?: string;
  scanEpoch: number;
}

/** Event-driven subscriptions. Neither connection sends idle heartbeat messages. */
export interface PanelWatchMessage {
  type: 'PANEL_WATCH_TAB';
  tabId: number | null;
}

export interface ScannerWatchMessage {
  type: 'SCANNER_WATCH';
  scanEpoch: number;
}

export type ScanToolKind = 'dimensions' | 'scroll' | 'pages';

export interface ScanToolProgress {
  tool: ScanToolKind;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  current: number;
  total?: number;
  failed?: number;
  message: string;
}

export interface StartScanToolMessage {
  type: 'START_SCAN_TOOL';
  tabId: number;
  scanEpoch: number;
  tool: ScanToolKind;
}

export interface RunScanToolMessage {
  type: 'RUN_SCAN_TOOL';
  tool: ScanToolKind;
  scanEpoch: number;
  pageUrl: string;
  urls: string[];
  orderStart: number;
}

export interface ScanToolProgressMessage {
  type: 'SCAN_TOOL_PROGRESS';
  progress: ScanToolProgress;
}

export interface BlobDataUrlResponse {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

export type VideoBlobPrepareResponse =
  | {
      mode: 'inline_data_url';
      dataUrl: string;
      mimeType: string;
      byteLength: number;
    }
  | {
      mode: 'streamed_to_panel';
      transferId: string;
      mimeType: string;
      byteLength: number;
    };

// ============================================================================
// 3. Side Panel UI <-> Background SW & Content Script (Large Blob Bridge)
// ============================================================================

export type BlobStreamPortMessage =
  | {
      type: 'BLOB_STREAM_ACK';
      transferId: string;
      /** -1 = initialized, -2 = completed; otherwise acknowledged chunk index. */
      index: number;
    }
  | {
      type: 'BLOB_STREAM_INIT';
      transferId: string;
      mimeType: string;
      totalBytes: number;
    }
  | {
      type: 'BLOB_STREAM_CHUNK';
      transferId: string;
      index: number;
      base64Chunk: string;
    }
  | {
      type: 'BLOB_STREAM_COMPLETE';
      transferId: string;
    }
  | {
      type: 'BLOB_STREAM_ERROR';
      transferId: string;
      error: string;
    };

export type HttpMediaFetchResponse =
  | {
      mode: 'object_url';
      objectUrl: string;
      finalUrl: string;
      mimeType: string;
      totalBytes: number;
      contentDisposition?: string;
    }
  | {
      mode: 'direct_url_fallback';
      finalUrl: string;
      mimeType?: string;
      totalBytes?: number;
      contentDisposition?: string;
    };

export type PanelInternalRequestMessage = PanelInternalCommand & { recipientPanelId?: string };

type PanelInternalCommand =
  | {
      channel: 'WIC_BG_TO_PANEL_RPC';
      type: 'PANEL_CREATE_OBJECT_URL_FROM_TRANSFER';
      transferId: string;
    }
  | {
      channel: 'WIC_BG_TO_PANEL_RPC';
      type: 'PANEL_FETCH_HTTP_MEDIA_TO_OBJECT_URL';
      mediaMode: MediaMode;
      tabId: number;
      itemId: string;
      transferId: string;
      url: string;
      maxBytes: number;
    }
  | {
      channel: 'WIC_BG_TO_PANEL_RPC';
      type: 'PANEL_ABORT_HTTP_FETCH';
      transferId: string;
    }
  | {
      channel: 'WIC_BG_TO_PANEL_RPC';
      type: 'PANEL_REVOKE_OBJECT_URL';
      objectUrl: string;
    };

// ============================================================================
// 4. Side Panel UI -> Background Service Worker (`chrome.runtime.sendMessage`)
// ============================================================================

export type SelectionMutation =
  | { mode: 'toggle_one'; itemId: string }
  | { mode: 'add_many'; itemIds: string[] }    // Used for "表示中を全選択" (`spec.md` §4.3, MVP-10)
  | { mode: 'remove_many'; itemIds: string[] } // Optional partial deselect
  | { mode: 'clear_all' };                     // Used for "全解除" (clears hidden selections in active mode)

export type PanelToBackgroundMessage = PanelCommand & { panelId?: string };

type PanelCommand =
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
      mediaMode?: MediaMode;
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
      type: 'PANEL_BATCH_SELECT_VARIANTS';
      tabId: number;
      mediaMode?: MediaMode;
      target: 'high_res' | 'display';
      itemIds?: string[];
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
      type: 'PANEL_REPORT_VIDEO_METADATA';
      tabId: number;
      itemId: string;
      variantUrl: string;
      videoWidth: number | null;
      videoHeight: number | null;
      durationSec: number | null;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_RESOLVE_HLS_MANIFEST';
      tabId: number;
      itemId: string;
      manifestUrl: string;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_ENQUEUE_DOWNLOADS';
      tabId: number;
      /** Specific itemIds (`"item_*"` or `"vid_*"`). Triggered strictly by explicit user click. */
      itemIds: string[];
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_CANCEL_DOWNLOAD';
      tabId: number;
      itemId: string;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_SAVE_CAPTURED_FRAME';
      tabId: number;
      dataUrl: string;
      sourceVideoUrl: string;
      timestampSec: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_SAVE_ASSEMBLED_STREAM';
      tabId: number;
      itemId: string;
      objectUrl: string;
      sourceManifestUrl: string;
      containerExtension: '.mp4' | '.ts';
      totalBytes: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_REPORT_HTTP_FETCH_PROGRESS';
      tabId: number;
      itemId: string;
      transferId: string;
      bytesReceived: number;
      totalBytes?: number;
    }
  | {
      channel: 'WIC_PANEL_TO_BG';
      type: 'PANEL_RETRY_FAILED_DOWNLOADS';
      tabId: number;
      mediaMode?: MediaMode;
      /** Specific failed `itemId`s, or omit to retry all retryable failed items in this tab (`spec.md` MVP-16). */
      itemIds?: string[];
    };

// ============================================================================
// 5. Background Service Worker -> Side Panel UI (`chrome.runtime.sendMessage`)
// ============================================================================

/**
 * Delta events pushed from Background to Side Panel.
 * Rule: State-mutating events carry the new `revision` for `tabId`.
 * `EVENT_DOWNLOAD_PROGRESS` is ephemeral (no `storage.session` write, no `revision` bump).
 */
export type BackgroundToPanelEvent =
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_ACTION_CLICKED';
      tabId: number;
      windowId?: number;
    }
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
      type: 'EVENT_VIDEOS_UPSERTED';
      tabId: number;
      revision: number;
      upsertedVideos: VideoItem[];
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
      type: 'EVENT_VIDEO_SELECTION_CHANGED';
      tabId: number;
      revision: number;
      selectedVideoIds: string[];
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_DOWNLOADS_UPDATED';
      tabId: number;
      revision: number;
      updatedDownloads: ItemDownloadState[];
    }
  | {
      channel: 'WIC_BG_TO_PANEL';
      type: 'EVENT_DOWNLOAD_PROGRESS';
      tabId: number;
      updates: Array<{
        itemId: string;
        bytesReceived: number;
        totalBytes?: number;
      }>;
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

export function isBgToPanelRpc(msg: unknown): msg is PanelInternalRequestMessage {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === 'WIC_BG_TO_PANEL_RPC';
}
