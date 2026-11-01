import {
  MAX_ITEMS_PER_TAB,
  SESSION_PERSIST_DEBOUNCE_MS,
  STORAGE_KEYS,
} from '@shared/constants';
import type { BackgroundToPanelEvent, SelectionMutation } from '@shared/messages';
import type {
  ImageFormat,
  ImageItem,
  ImageVariant,
  ItemDownloadState,
  RawCandidateGroup,
  ScanStatus,
  TabSessionSnapshot,
} from '@shared/types';
import { inferImageFormat, pickBestVariantUrl } from '@shared/url-utils';

export interface InternalTabSession {
  tabId: number;
  revision: number;
  pageUrl?: string;
  domain?: string;
  scanEpoch: number;
  scanStatus: ScanStatus;
  statusMessage?: string;
  itemCounter: number;
  items: ImageItem[];
  itemByPrimaryUrl: Map<string, ImageItem>;
  itemByVariantUrl: Map<string, ImageItem>;
  itemById: Map<string, ImageItem>;
  seenOccurrenceKeys: Set<string>;
  selectedIds: Set<string>;
  downloads: Map<string, ItemDownloadState>;
  dirty: boolean;
}

export class SessionStore {
  private sessions = new Map<number, InternalTabSession>();
  private hydrated = false;
  private hydratePromise: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistQueue = Promise.resolve();
  private eventListeners: Array<(event: BackgroundToPanelEvent) => void> = [];

  onEvent(listener: (event: BackgroundToPanelEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(event: BackgroundToPanelEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WIC] Error in session event listener:', err);
      }
    }
  }

  async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydratePromise) return this.hydratePromise;

    this.hydratePromise = (async () => {
      try {
        const allData = await chrome.storage.session.get(null);
        for (const [key, value] of Object.entries(allData)) {
          if (key.startsWith(STORAGE_KEYS.TAB_SESSION_PREFIX)) {
            const tabId = Number(key.slice(STORAGE_KEYS.TAB_SESSION_PREFIX.length));
            if (!Number.isNaN(tabId) && value && typeof value === 'object') {
              this.restoreSessionFromSnapshot(value as TabSessionSnapshot);
            }
          }
        }
      } catch (err) {
        console.warn('[WIC] Could not hydrate sessions from storage.session:', err);
      } finally {
        this.hydrated = true;
      }
    })();

    return this.hydratePromise;
  }

  private restoreSessionFromSnapshot(snap: TabSessionSnapshot): void {
    const itemByPrimaryUrl = new Map<string, ImageItem>();
    const itemByVariantUrl = new Map<string, ImageItem>();
    const itemById = new Map<string, ImageItem>();
    let maxCounter = 0;

    for (const item of snap.items) {
      itemByPrimaryUrl.set(item.primaryUrl, item);
      itemById.set(item.itemId, item);
      itemByVariantUrl.set(item.primaryUrl, item);
      for (const v of item.variants) {
        itemByVariantUrl.set(v.url, item);
      }
      const match = /^item_(\d+)$/.exec(item.itemId);
      if (match?.[1]) {
        maxCounter = Math.max(maxCounter, Number(match[1]));
      }
    }

    const downloads = new Map<string, ItemDownloadState>();
    if (snap.downloads) {
      for (const [id, state] of Object.entries(snap.downloads)) {
        downloads.set(id, state);
      }
    }

    this.sessions.set(snap.tabId, {
      tabId: snap.tabId,
      revision: snap.revision,
      pageUrl: snap.pageUrl,
      domain: snap.domain,
      scanEpoch: snap.scanEpoch,
      scanStatus: snap.scanStatus,
      statusMessage: snap.statusMessage,
      itemCounter: maxCounter,
      items: snap.items,
      itemByPrimaryUrl,
      itemByVariantUrl,
      itemById,
      seenOccurrenceKeys: new Set(),
      selectedIds: new Set(snap.selectedIds || []),
      downloads,
      dirty: false,
    });
  }

  getOrCreateSession(tabId: number, pageUrl?: string): InternalTabSession {
    let session = this.sessions.get(tabId);
    if (!session) {
      let domain: string | undefined;
      if (pageUrl) {
        try {
          domain = new URL(pageUrl).hostname;
        } catch {}
      }

      session = {
        tabId,
        revision: 0,
        pageUrl,
        domain,
        scanEpoch: 1,
        scanStatus: 'unscanned',
        itemCounter: 0,
        items: [],
        itemByPrimaryUrl: new Map(),
        itemByVariantUrl: new Map(),
        itemById: new Map(),
        seenOccurrenceKeys: new Set(),
        selectedIds: new Set(),
        downloads: new Map(),
        dirty: true,
      };
      this.sessions.set(tabId, session);
      this.schedulePersist();
    }
    return session;
  }

  getSession(tabId: number): InternalTabSession | undefined {
    return this.sessions.get(tabId);
  }

  getSnapshot(tabId: number): TabSessionSnapshot {
    const session = this.getOrCreateSession(tabId);
    return this.buildSnapshot(session);
  }

  private buildSnapshot(session: InternalTabSession): TabSessionSnapshot {
    const downloads: Record<string, ItemDownloadState> = {};
    for (const [k, v] of session.downloads) {
      downloads[k] = v;
    }

    return {
      tabId: session.tabId,
      revision: session.revision,
      pageUrl: session.pageUrl,
      domain: session.domain,
      scanEpoch: session.scanEpoch,
      scanStatus: session.scanStatus,
      statusMessage: session.statusMessage,
      items: [...session.items],
      selectedIds: Array.from(session.selectedIds),
      downloads,
    };
  }

  setScanStatus(
    tabId: number,
    scanStatus: ScanStatus,
    statusMessage?: string,
  ): void {
    const session = this.getOrCreateSession(tabId);
    session.scanStatus = scanStatus;
    session.statusMessage = statusMessage;
    session.revision += 1;
    session.dirty = true;
    this.schedulePersist();

    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SCAN_STATUS_CHANGED',
      tabId,
      revision: session.revision,
      scanStatus,
      statusMessage,
    });
  }

  resetSessionForNewPage(
    tabId: number,
    newPageUrl: string,
    initialStatus: ScanStatus = 'scanning',
  ): InternalTabSession {
    let domain: string | undefined;
    try {
      domain = new URL(newPageUrl).hostname;
    } catch {}

    const session = this.getOrCreateSession(tabId);
    session.pageUrl = newPageUrl;
    session.domain = domain;
    session.scanEpoch += 1;
    session.scanStatus = initialStatus;
    session.items = [];
    session.itemByPrimaryUrl.clear();
    session.itemByVariantUrl.clear();
    session.itemById.clear();
    session.seenOccurrenceKeys.clear();
    session.selectedIds.clear();
    // Keep finished downloads in downloads map so history isn't immediately purged
    session.revision += 1;
    session.dirty = true;
    this.schedulePersist();

    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SESSION_REPLACED',
      tabId,
      snapshot: this.buildSnapshot(session),
    });

    return session;
  }

  mergeCandidateGroups(
    tabId: number,
    scanEpoch: number,
    groups: RawCandidateGroup[],
  ): void {
    const session = this.getOrCreateSession(tabId);
    // Keep scanEpoch synced with the latest seen
    if (scanEpoch > session.scanEpoch) {
      session.scanEpoch = scanEpoch;
    }

    const upsertedMap = new Map<string, ImageItem>();

    for (const group of groups) {
      let item = session.itemByPrimaryUrl.get(group.primaryUrl);

      // Check if any variant or primaryUrl is known (crucial for modal / lightbox instances)
      if (!item) {
        item = session.itemByVariantUrl.get(group.primaryUrl);
        if (!item) {
          for (const v of group.variants) {
            const match = session.itemByVariantUrl.get(v.url);
            if (match) {
              item = match;
              break;
            }
          }
        }
      }

      if (!item) {
        // Enforce MAX_ITEMS_PER_TAB limit
        if (session.items.length >= MAX_ITEMS_PER_TAB) {
          if (session.scanStatus !== 'limit_reached') {
            this.setScanStatus(tabId, 'limit_reached', '検出件数が上限 (2,000件) に達しました');
          }
          break;
        }

        const itemId = `item_${++session.itemCounter}`;
        item = {
          itemId,
          primaryUrl: group.primaryUrl,
          selectedUrl: group.primaryUrl,
          variants: [],
          sources: [],
          occurrenceCount: 0,
          firstSeenOrder: group.domOrder,
        };

        session.items.push(item);
        session.itemByPrimaryUrl.set(group.primaryUrl, item);
        session.itemById.set(itemId, item);
      }

      session.itemByVariantUrl.set(group.primaryUrl, item);

      // Check occurrence key deduplication
      if (!session.seenOccurrenceKeys.has(group.occurrenceKey)) {
        session.seenOccurrenceKeys.add(group.occurrenceKey);
        item.occurrenceCount += 1;
      }

      // Merge variants into item
      for (const rawVar of group.variants) {
        session.itemByVariantUrl.set(rawVar.url, item);

        if (!item.sources.includes(rawVar.source)) {
          item.sources.push(rawVar.source);
        }

        let existingVar = item.variants.find((v) => v.url === rawVar.url);
        if (!existingVar) {
          const format: ImageFormat = inferImageFormat(rawVar.url, rawVar.mimeHint);
          existingVar = {
            url: rawVar.url,
            roles: [rawVar.role],
            descriptors: rawVar.descriptor ? [rawVar.descriptor] : [],
            format,
            naturalWidth: rawVar.naturalWidth,
            naturalHeight: rawVar.naturalHeight,
            largeDataRefId: rawVar.largeDataRefId,
          };
          item.variants.push(existingVar);
        } else {
          if (!existingVar.roles.includes(rawVar.role)) {
            existingVar.roles.push(rawVar.role);
          }
          if (rawVar.descriptor && !existingVar.descriptors.includes(rawVar.descriptor)) {
            existingVar.descriptors.push(rawVar.descriptor);
          }
          if (rawVar.naturalWidth && !existingVar.naturalWidth) {
            existingVar.naturalWidth = rawVar.naturalWidth;
          }
          if (rawVar.naturalHeight && !existingVar.naturalHeight) {
            existingVar.naturalHeight = rawVar.naturalHeight;
          }
        }
      }

      // Automatically select best high-resolution candidate if not manually chosen
      if (!item.manualVariantSelected) {
        item.selectedUrl = pickBestVariantUrl(item.variants);
      }

      upsertedMap.set(item.itemId, item);
    }

    if (upsertedMap.size > 0) {
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_ITEMS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedItems: Array.from(upsertedMap.values()),
        scanStatus: session.scanStatus,
      });
    }
  }

  updateItemDimensions(
    tabId: number,
    url: string,
    width: number,
    height: number,
  ): void {
    const session = this.sessions.get(tabId);
    if (!session) return;

    const modifiedItems: ImageItem[] = [];

    for (const item of session.items) {
      let touched = false;
      for (const variant of item.variants) {
        if (variant.url === url && (!variant.naturalWidth || !variant.naturalHeight)) {
          variant.naturalWidth = width;
          variant.naturalHeight = height;
          touched = true;
        }
      }
      if (touched) {
        modifiedItems.push(item);
      }
    }

    if (modifiedItems.length > 0) {
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_ITEMS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedItems: modifiedItems,
        scanStatus: session.scanStatus,
      });
    }
  }

  selectVariant(tabId: number, itemId: string, variantUrl: string): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    const item = session.itemById.get(itemId);
    if (!item) return false;

    const variant = item.variants.find((v) => v.url === variantUrl);
    if (!variant) return false;

    item.selectedUrl = variantUrl;
    item.manualVariantSelected = true;
    session.revision += 1;
    session.dirty = true;
    this.schedulePersist();

    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_ITEMS_UPSERTED',
      tabId,
      revision: session.revision,
      upsertedItems: [item],
      scanStatus: session.scanStatus,
    });

    return true;
  }

  batchSelectVariants(
    tabId: number,
    target: 'high_res' | 'display',
    itemIds?: string[],
  ): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    const targetSet = itemIds ? new Set(itemIds) : null;
    const modifiedItems: ImageItem[] = [];

    for (const item of session.items) {
      if (targetSet && !targetSet.has(item.itemId)) continue;

      const newUrl =
        target === 'high_res'
          ? pickBestVariantUrl(item.variants)
          : item.primaryUrl;

      if (item.selectedUrl !== newUrl) {
        item.selectedUrl = newUrl;
        item.manualVariantSelected = target === 'display';
        modifiedItems.push(item);
      }
    }

    if (modifiedItems.length > 0) {
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_ITEMS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedItems: modifiedItems,
        scanStatus: session.scanStatus,
      });
    }

    return true;
  }

  updateSelection(tabId: number, mutation: SelectionMutation): string[] {
    const session = this.getOrCreateSession(tabId);

    switch (mutation.mode) {
      case 'toggle_one': {
        if (session.selectedIds.has(mutation.itemId)) {
          session.selectedIds.delete(mutation.itemId);
        } else {
          session.selectedIds.add(mutation.itemId);
        }
        break;
      }
      case 'add_many': {
        for (const id of mutation.itemIds) {
          session.selectedIds.add(id);
        }
        break;
      }
      case 'remove_many': {
        for (const id of mutation.itemIds) {
          session.selectedIds.delete(id);
        }
        break;
      }
      case 'clear_all': {
        session.selectedIds.clear();
        break;
      }
    }

    session.revision += 1;
    session.dirty = true;
    this.schedulePersist();

    const selectedList = Array.from(session.selectedIds);
    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SELECTION_CHANGED',
      tabId,
      revision: session.revision,
      selectedIds: selectedList,
    });

    return selectedList;
  }

  updateDownloadState(tabId: number, state: ItemDownloadState): void {
    const session = this.sessions.get(tabId);
    if (!session) return;

    session.downloads.set(state.itemId, state);
    session.revision += 1;
    session.dirty = true;
    this.schedulePersist();

    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_DOWNLOADS_UPDATED',
      tabId,
      revision: session.revision,
      updatedDownloads: [state],
    });
  }

  removeTab(tabId: number): void {
    this.sessions.delete(tabId);
    chrome.storage.session
      .remove(`${STORAGE_KEYS.TAB_SESSION_PREFIX}${tabId}`)
      .catch(() => {});
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) return;

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistQueue = this.persistQueue.then(async () => {
        const toSave: Record<string, TabSessionSnapshot> = {};
        for (const [tabId, session] of this.sessions) {
          if (session.dirty) {
            toSave[`${STORAGE_KEYS.TAB_SESSION_PREFIX}${tabId}`] = this.buildSnapshot(session);
            session.dirty = false;
          }
        }

        if (Object.keys(toSave).length > 0) {
          try {
            await chrome.storage.session.set(toSave);
          } catch (err) {
            console.warn('[WIC] Failed to persist dirty tab sessions to storage.session:', err);
          }
        }
      });
    }, SESSION_PERSIST_DEBOUNCE_MS);
  }
}

export const sessionStore = new SessionStore();
