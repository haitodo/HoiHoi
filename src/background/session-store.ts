import {
  MAX_ITEMS_PER_TAB,
  MAX_VIDEOS_PER_TAB,
  SESSION_PERSIST_DEBOUNCE_MS,
  STORAGE_KEYS,
} from '@shared/constants';
import type { BackgroundToPanelEvent, SelectionMutation } from '@shared/messages';
import type {
  ImageFormat,
  ImageItem,
  ItemDownloadState,
  MediaMode,
  RawCandidateGroup,
  RawVideoCandidateGroup,
  ScanStatus,
  TabSessionSnapshot,
  VideoItem,
  VideoVariant,
} from '@shared/types';
import { inferImageFormat, pickBestVariantUrl } from '@shared/url-utils';
import {
  classifyVideoDeliveryAndReadiness,
  getActiveVideoVariant,
  inferVideoFormat,
  parseHlsMasterPlaylist,
  pickBestVideoVariantUrl,
} from '@shared/video-utils';

export interface InternalTabSession {
  tabId: number;
  revision: number;
  pageUrl?: string;
  domain?: string;
  pageTitle?: string;
  scanEpoch: number;
  scanStatus: ScanStatus;
  statusMessage?: string;
  itemCounter: number;
  items: ImageItem[];
  itemByPrimaryUrl: Map<string, ImageItem>;
  itemByVariantUrl: Map<string, ImageItem>;
  itemById: Map<string, ImageItem>;
  videoCounter: number;
  videos: VideoItem[];
  videoByPrimaryUrl: Map<string, VideoItem>;
  videoByVariantUrl: Map<string, VideoItem>;
  videoById: Map<string, VideoItem>;
  redirectTargetsBySourceUrl: Map<string, Set<string>>;
  seenOccurrenceKeys: Set<string>;
  selectedIds: Set<string>;
  selectedVideoIds: Set<string>;
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

    for (const item of snap.items || []) {
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

    const videoByPrimaryUrl = new Map<string, VideoItem>();
    const videoByVariantUrl = new Map<string, VideoItem>();
    const videoById = new Map<string, VideoItem>();
    let maxVideoCounter = 0;
    const restoredVideos = snap.videos || [];

    for (const video of restoredVideos) {
      videoByPrimaryUrl.set(video.primaryUrl, video);
      videoById.set(video.itemId, video);
      videoByVariantUrl.set(video.primaryUrl, video);
      for (const v of video.variants) {
        videoByVariantUrl.set(v.url, video);
      }
      const match = /^vid_(\d+)$/.exec(video.itemId);
      if (match?.[1]) {
        maxVideoCounter = Math.max(maxVideoCounter, Number(match[1]));
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
      pageTitle: snap.pageTitle,
      scanEpoch: snap.scanEpoch,
      scanStatus: snap.scanStatus,
      statusMessage: snap.statusMessage,
      itemCounter: maxCounter,
      items: snap.items || [],
      itemByPrimaryUrl,
      itemByVariantUrl,
      itemById,
      videoCounter: maxVideoCounter,
      videos: restoredVideos,
      videoByPrimaryUrl,
      videoByVariantUrl,
      videoById,
      redirectTargetsBySourceUrl: new Map(),
      seenOccurrenceKeys: new Set(),
      selectedIds: new Set(snap.selectedIds || []),
      selectedVideoIds: new Set(snap.selectedVideoIds || []),
      downloads,
      dirty: false,
    });
  }

  getOrCreateSession(tabId: number, pageUrl?: string, pageTitle?: string): InternalTabSession {
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
        pageTitle,
        scanEpoch: 1,
        scanStatus: 'unscanned',
        itemCounter: 0,
        items: [],
        itemByPrimaryUrl: new Map(),
        itemByVariantUrl: new Map(),
        itemById: new Map(),
        videoCounter: 0,
        videos: [],
        videoByPrimaryUrl: new Map(),
        videoByVariantUrl: new Map(),
        videoById: new Map(),
        redirectTargetsBySourceUrl: new Map(),
        seenOccurrenceKeys: new Set(),
        selectedIds: new Set(),
        selectedVideoIds: new Set(),
        downloads: new Map(),
        dirty: true,
      };
      this.sessions.set(tabId, session);
      this.schedulePersist();
    } else if (pageTitle && !session.pageTitle) {
      session.pageTitle = pageTitle;
      session.dirty = true;
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
      pageTitle: session.pageTitle,
      scanEpoch: session.scanEpoch,
      scanStatus: session.scanStatus,
      statusMessage: session.statusMessage,
      items: [...session.items],
      videos: [...session.videos],
      selectedIds: Array.from(session.selectedIds),
      selectedVideoIds: Array.from(session.selectedVideoIds),
      downloads,
    };
  }

  updatePageTitle(tabId: number, pageTitle: string): void {
    if (!pageTitle) return;
    const session = this.getOrCreateSession(tabId);
    if (session.pageTitle !== pageTitle) {
      session.pageTitle = pageTitle;
      session.dirty = true;
      this.schedulePersist();
    }
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
    pageTitle?: string,
  ): InternalTabSession {
    let domain: string | undefined;
    try {
      domain = new URL(newPageUrl).hostname;
    } catch {}

    const session = this.getOrCreateSession(tabId);
    session.pageUrl = newPageUrl;
    session.domain = domain;
    session.pageTitle = pageTitle;
    session.scanEpoch += 1;
    session.scanStatus = initialStatus;
    session.items = [];
    session.itemByPrimaryUrl.clear();
    session.itemByVariantUrl.clear();
    session.itemById.clear();
    session.videos = [];
    session.videoByPrimaryUrl.clear();
    session.videoByVariantUrl.clear();
    session.videoById.clear();
    session.redirectTargetsBySourceUrl.clear();
    session.seenOccurrenceKeys.clear();
    session.selectedIds.clear();
    session.selectedVideoIds.clear();
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
    pageTitle?: string,
  ): void {
    const session = this.getOrCreateSession(tabId);
    if (scanEpoch > session.scanEpoch) {
      session.scanEpoch = scanEpoch;
    }
    if (pageTitle && (!session.pageTitle || session.pageTitle !== pageTitle)) {
      session.pageTitle = pageTitle;
      session.dirty = true;
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

      if (!session.seenOccurrenceKeys.has(group.occurrenceKey)) {
        session.seenOccurrenceKeys.add(group.occurrenceKey);
        item.occurrenceCount += 1;
      }

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

  mergeVideoCandidateGroups(
    tabId: number,
    scanEpoch: number,
    videoGroups: RawVideoCandidateGroup[],
    pageUrl?: string,
    pageTitle?: string,
  ): void {
    if (videoGroups.length === 0) return;

    const session = this.getOrCreateSession(tabId, pageUrl, pageTitle);
    if (scanEpoch > session.scanEpoch) {
      session.scanEpoch = scanEpoch;
    }
    if (pageUrl && !session.pageUrl) {
      session.pageUrl = pageUrl;
      try {
        session.domain = new URL(pageUrl).hostname;
      } catch {}
    }
    if (pageTitle && (!session.pageTitle || session.pageTitle !== pageTitle)) {
      session.pageTitle = pageTitle;
      session.dirty = true;
    }

    const upsertedVideos = new Map<string, VideoItem>();

    for (const group of videoGroups) {
      let video = session.videoByPrimaryUrl.get(group.primaryUrl);

      if (!video) {
        video = session.videoByVariantUrl.get(group.primaryUrl);
        if (!video) {
          for (const v of group.variants) {
            const match = session.videoByVariantUrl.get(v.url);
            if (match) {
              video = match;
              break;
            }
          }
        }
      }

      if (!video) {
        if (session.videos.length >= MAX_VIDEOS_PER_TAB) {
          break;
        }

        const itemId = `vid_${++session.videoCounter}`;
        video = {
          itemId,
          primaryUrl: group.primaryUrl,
          selectedUrl: group.primaryUrl,
          variants: [],
          sources: [],
          durationSec: group.durationSec,
          isLive: group.isLive,
          posterUrl: group.posterUrl,
          occurrenceCount: 0,
          firstSeenOrder: group.domOrder,
        };

        session.videos.push(video);
        session.videoByPrimaryUrl.set(group.primaryUrl, video);
        session.videoById.set(itemId, video);
      } else {
        // Enrich metadata passively when DOM/OGP/JSON-LD supplements an earlier network entry
        if (group.durationSec && !video.durationSec) {
          video.durationSec = group.durationSec;
        }
        if (group.isLive !== undefined && video.isLive === undefined) {
          video.isLive = group.isLive;
        }
        if (group.posterUrl && (!video.posterUrl || video.posterUrl.startsWith('data:'))) {
          video.posterUrl = group.posterUrl;
        }
      }

      session.videoByVariantUrl.set(group.primaryUrl, video);

      if (!session.seenOccurrenceKeys.has(group.occurrenceKey)) {
        session.seenOccurrenceKeys.add(group.occurrenceKey);
        video.occurrenceCount += 1;
      }

      for (const rawVar of group.variants) {
        session.videoByVariantUrl.set(rawVar.url, video);

        if (!video.sources.includes(rawVar.source)) {
          video.sources.push(rawVar.source);
        }

        const format = inferVideoFormat(rawVar.url, rawVar.mimeHint);
        const { deliveryType, readiness, blockReason } = classifyVideoDeliveryAndReadiness({
          url: rawVar.url,
          format,
          pageUrl: session.pageUrl,
          isDrmProtected: rawVar.isDrmProtected,
          isMseStream: rawVar.isMseStream,
        });

        let existingVar = video.variants.find((v) => v.url === rawVar.url);
        if (!existingVar) {
          existingVar = {
            url: rawVar.url,
            format,
            deliveryType,
            readiness,
            blockReason,
            roles: [rawVar.role],
            descriptors: rawVar.descriptor ? [rawVar.descriptor] : [],
            videoWidth: rawVar.videoWidth,
            videoHeight: rawVar.videoHeight,
            fileSizeBytes: rawVar.fileSizeBytes ?? null,
            largeDataRefId: rawVar.largeDataRefId,
          };
          video.variants.push(existingVar);
        } else {
          if (!existingVar.roles.includes(rawVar.role)) {
            existingVar.roles.push(rawVar.role);
          }
          if (rawVar.descriptor && !existingVar.descriptors.includes(rawVar.descriptor)) {
            existingVar.descriptors.push(rawVar.descriptor);
          }
          if (existingVar.format === 'unknown' && format !== 'unknown') {
            existingVar.format = format;
          }
          if (rawVar.videoWidth && !existingVar.videoWidth) {
            existingVar.videoWidth = rawVar.videoWidth;
          }
          if (rawVar.videoHeight && !existingVar.videoHeight) {
            existingVar.videoHeight = rawVar.videoHeight;
          }
          if (rawVar.fileSizeBytes && !existingVar.fileSizeBytes) {
            existingVar.fileSizeBytes = rawVar.fileSizeBytes;
          }
          if (rawVar.isDrmProtected || rawVar.isMseStream) {
            existingVar.deliveryType = deliveryType;
            existingVar.readiness = readiness;
            existingVar.blockReason = blockReason;
          }
        }
      }

      if (!video.manualVariantSelected) {
        video.selectedUrl = pickBestVideoVariantUrl(video.variants);
      }

      // If currently selected video became blocked (e.g. DRM detected), clean up selection
      const activeVar = getActiveVideoVariant(video.variants, video.selectedUrl);
      if (activeVar && activeVar.readiness !== 'ready' && session.selectedVideoIds.has(video.itemId)) {
        session.selectedVideoIds.delete(video.itemId);
      }

      upsertedVideos.set(video.itemId, video);
    }

    if (upsertedVideos.size > 0) {
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_VIDEOS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedVideos: Array.from(upsertedVideos.values()),
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

  updateVideoMetadata(
    tabId: number,
    params: {
      url: string;
      videoWidth?: number | null;
      videoHeight?: number | null;
      durationSec?: number | null;
      isLive?: boolean;
      posterUrl?: string;
      fileSizeBytes?: number | null;
      isDrmProtected?: boolean;
      isMseStream?: boolean;
    },
  ): void {
    const session = this.sessions.get(tabId);
    if (!session) return;

    const modifiedVideos: VideoItem[] = [];
    let selectionChanged = false;
    const redirectTargets = session.redirectTargetsBySourceUrl.get(params.url);

    for (const video of session.videos) {
      let touched = false;
      for (const variant of video.variants) {
        if (variant.url === params.url || redirectTargets?.has(variant.url)) {
          if (params.videoWidth && !variant.videoWidth) {
            variant.videoWidth = params.videoWidth;
            touched = true;
          }
          if (params.videoHeight && !variant.videoHeight) {
            variant.videoHeight = params.videoHeight;
            touched = true;
          }
          if (params.fileSizeBytes && !variant.fileSizeBytes) {
            variant.fileSizeBytes = params.fileSizeBytes;
            touched = true;
          }
          if (params.isDrmProtected || params.isMseStream) {
            const nextClass = classifyVideoDeliveryAndReadiness({
              url: variant.url,
              format: variant.format,
              pageUrl: session.pageUrl,
              isDrmProtected: params.isDrmProtected,
              isMseStream: params.isMseStream,
            });
            if (
              variant.deliveryType !== nextClass.deliveryType ||
              variant.readiness !== nextClass.readiness
            ) {
              variant.deliveryType = nextClass.deliveryType;
              variant.readiness = nextClass.readiness;
              variant.blockReason = nextClass.blockReason;
              touched = true;
            }
          }
        }
      }

      if (touched || video.primaryUrl === params.url || video.selectedUrl === params.url) {
        if (params.durationSec && !video.durationSec) {
          video.durationSec = params.durationSec;
          touched = true;
        }
        if (params.isLive !== undefined && video.isLive === undefined) {
          video.isLive = params.isLive;
          touched = true;
        }
        if (params.posterUrl && !video.posterUrl) {
          video.posterUrl = params.posterUrl;
          touched = true;
        }
      }

      if (touched) {
        if (!video.manualVariantSelected) {
          video.selectedUrl = pickBestVideoVariantUrl(video.variants);
        }
        const activeVar = getActiveVideoVariant(video.variants, video.selectedUrl);
        if (activeVar && activeVar.readiness !== 'ready' && session.selectedVideoIds.has(video.itemId)) {
          session.selectedVideoIds.delete(video.itemId);
          selectionChanged = true;
        }
        modifiedVideos.push(video);
      }
    }

    if (modifiedVideos.length > 0) {
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_VIDEOS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedVideos: modifiedVideos,
        scanStatus: session.scanStatus,
      });

      if (selectionChanged) {
        session.revision += 1;
        this.emitEvent({
          channel: 'WIC_BG_TO_PANEL',
          type: 'EVENT_VIDEO_SELECTION_CHANGED',
          tabId,
          revision: session.revision,
          selectedVideoIds: Array.from(session.selectedVideoIds),
        });
      }
    }
  }

  /**
   * Merges a video URL observed via `chrome.webRequest` response headers into an active tab session.
   * Links post-redirect CDN URLs (e.g. `www47.tokyomotion.net/.../3741005.mp4`) back into the
   * originating `<video><source>` item via `redirectChainUrls` without duplicating cards.
   */
  mergeNetworkDetectedVideo(
    tabId: number,
    params: {
      url: string;
      redirectChainUrls?: string[];
      mimeHint?: string;
      fileSizeBytes?: number | null;
    },
  ): void {
    const session = this.sessions.get(tabId);
    if (
      !session ||
      session.scanStatus === 'unscanned' ||
      session.scanStatus === 'restricted' ||
      session.scanStatus === 'stale'
    ) {
      return;
    }

    const chainUrls = params.redirectChainUrls ?? [];
    for (const srcUrl of chainUrls) {
      let set = session.redirectTargetsBySourceUrl.get(srcUrl);
      if (!set) {
        set = new Set();
        session.redirectTargetsBySourceUrl.set(srcUrl, set);
      }
      set.add(params.url);
    }

    // Look up an existing VideoItem by final URL or any URL in the redirect chain
    let matchedVideo =
      session.videoByVariantUrl.get(params.url) ?? session.videoByPrimaryUrl.get(params.url);
    let sourceVariant: VideoVariant | undefined;

    if (!matchedVideo) {
      for (const hopUrl of chainUrls) {
        const candidate =
          session.videoByVariantUrl.get(hopUrl) ?? session.videoByPrimaryUrl.get(hopUrl);
        if (candidate) {
          matchedVideo = candidate;
          sourceVariant = candidate.variants.find((v) => v.url === hopUrl);
          break;
        }
      }
    } else if (chainUrls.length > 0) {
      for (const hopUrl of chainUrls) {
        const found = matchedVideo.variants.find((v) => v.url === hopUrl);
        if (found) {
          sourceVariant = found;
          break;
        }
      }
    }

    if (matchedVideo) {
      const format = inferVideoFormat(params.url, params.mimeHint);
      const { deliveryType, readiness, blockReason } = classifyVideoDeliveryAndReadiness({
        url: params.url,
        format,
        pageUrl: session.pageUrl,
      });

      let modified = false;
      if (!matchedVideo.sources.includes('network-header')) {
        matchedVideo.sources.push('network-header');
        modified = true;
      }

      if (sourceVariant && params.fileSizeBytes && !sourceVariant.fileSizeBytes) {
        sourceVariant.fileSizeBytes = params.fileSizeBytes;
        modified = true;
      }

      session.videoByVariantUrl.set(params.url, matchedVideo);
      const existingVar = matchedVideo.variants.find((v) => v.url === params.url);
      if (!existingVar) {
        matchedVideo.variants.push({
          url: params.url,
          format,
          deliveryType,
          readiness,
          blockReason,
          roles: ['network'],
          descriptors: sourceVariant ? [...sourceVariant.descriptors] : [],
          videoWidth: sourceVariant?.videoWidth ?? null,
          videoHeight: sourceVariant?.videoHeight ?? null,
          fileSizeBytes: params.fileSizeBytes ?? null,
        });
        modified = true;
      } else {
        if (!existingVar.roles.includes('network')) {
          existingVar.roles.push('network');
          modified = true;
        }
        if (existingVar.format === 'unknown' && format !== 'unknown') {
          existingVar.format = format;
          modified = true;
        }
        if (params.fileSizeBytes && !existingVar.fileSizeBytes) {
          existingVar.fileSizeBytes = params.fileSizeBytes;
          modified = true;
        }
        if (sourceVariant) {
          for (const desc of sourceVariant.descriptors) {
            if (!existingVar.descriptors.includes(desc)) {
              existingVar.descriptors.push(desc);
              modified = true;
            }
          }
        }
      }

      if (modified) {
        if (!matchedVideo.manualVariantSelected) {
          matchedVideo.selectedUrl = pickBestVideoVariantUrl(matchedVideo.variants);
        }
        session.revision += 1;
        session.dirty = true;
        this.schedulePersist();

        this.emitEvent({
          channel: 'WIC_BG_TO_PANEL',
          type: 'EVENT_VIDEOS_UPSERTED',
          tabId,
          revision: session.revision,
          upsertedVideos: [matchedVideo],
          scanStatus: session.scanStatus,
        });
      }
      return;
    }

    // No existing VideoItem matched — create a new network-detected video group
    const nextOrder = session.videos.length + session.items.length + 1;
    this.mergeVideoCandidateGroups(tabId, session.scanEpoch, [
      {
        occurrenceKey: `net::header::${params.url}`,
        primaryUrl: params.url,
        domOrder: nextOrder,
        durationSec: null,
        variants: [
          {
            url: params.url,
            role: 'network',
            source: 'network-header',
            mimeHint: params.mimeHint,
            videoWidth: null,
            videoHeight: null,
            fileSizeBytes: params.fileSizeBytes ?? null,
          },
        ],
      },
    ]);
  }

  /**
   * Merges resolution variants parsed on-demand from an HLS Master `.m3u8` manifest.
   */
  applyParsedHlsManifest(
    tabId: number,
    itemId: string,
    manifestUrl: string,
    manifestText: string,
  ): { addedCount: number; isDrmEncrypted: boolean } {
    const session = this.sessions.get(tabId);
    if (!session) return { addedCount: 0, isDrmEncrypted: false };

    const video = session.videoById.get(itemId);
    if (!video) return { addedCount: 0, isDrmEncrypted: false };

    const parsed = parseHlsMasterPlaylist(manifestText, manifestUrl);
    let addedCount = 0;

    if (parsed.isDrmEncrypted) {
      for (const v of video.variants) {
        if (v.url === manifestUrl) {
          v.deliveryType = 'drm_protected';
          v.readiness = 'blocked';
          v.blockReason = '暗号化 (DRM / SAMPLE-AES) されたストリームのため保存できません';
        }
      }
    }

    for (const pv of parsed.variants) {
      session.videoByVariantUrl.set(pv.url, video);
      let existing = video.variants.find((v) => v.url === pv.url);
      if (!existing) {
        const cls = classifyVideoDeliveryAndReadiness({
          url: pv.url,
          format: 'hls',
          pageUrl: session.pageUrl,
          isDrmProtected: parsed.isDrmEncrypted,
        });
        const newVariant: VideoVariant = {
          url: pv.url,
          format: 'hls',
          deliveryType: cls.deliveryType,
          readiness: cls.readiness,
          blockReason: cls.blockReason,
          roles: ['manifest-variant'],
          descriptors: [pv.descriptor],
          videoWidth: pv.width,
          videoHeight: pv.height,
          fileSizeBytes: null,
          bitrateBps: pv.bandwidthBps,
        };
        video.variants.push(newVariant);
        addedCount++;
      }
    }

    if (addedCount > 0 || parsed.isDrmEncrypted) {
      if (!video.manualVariantSelected && parsed.variants[0]) {
        video.selectedUrl = parsed.variants[0].url;
      }
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_VIDEOS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedVideos: [video],
        scanStatus: session.scanStatus,
      });
    }

    return { addedCount, isDrmEncrypted: parsed.isDrmEncrypted };
  }

  selectVariant(tabId: number, itemId: string, variantUrl: string): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    if (itemId.startsWith('vid_')) {
      const video = session.videoById.get(itemId);
      if (!video) return false;
      const variant = video.variants.find((v) => v.url === variantUrl);
      if (!variant) return false;

      video.selectedUrl = variantUrl;
      video.manualVariantSelected = true;
      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_VIDEOS_UPSERTED',
        tabId,
        revision: session.revision,
        upsertedVideos: [video],
        scanStatus: session.scanStatus,
      });

      if (variant.readiness !== 'ready' && session.selectedVideoIds.has(itemId)) {
        session.selectedVideoIds.delete(itemId);
        session.revision += 1;
        this.emitEvent({
          channel: 'WIC_BG_TO_PANEL',
          type: 'EVENT_VIDEO_SELECTION_CHANGED',
          tabId,
          revision: session.revision,
          selectedVideoIds: Array.from(session.selectedVideoIds),
        });
      }
      return true;
    }

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
    mediaMode: MediaMode = 'image',
  ): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    const targetSet = itemIds ? new Set(itemIds) : null;

    if (mediaMode === 'video') {
      const modifiedVideos: VideoItem[] = [];
      for (const video of session.videos) {
        if (targetSet && !targetSet.has(video.itemId)) continue;
        const newUrl =
          target === 'high_res'
            ? pickBestVideoVariantUrl(video.variants)
            : video.primaryUrl;
        if (video.selectedUrl !== newUrl) {
          video.selectedUrl = newUrl;
          video.manualVariantSelected = target === 'display';
          modifiedVideos.push(video);
        }
      }

      if (modifiedVideos.length > 0) {
        session.revision += 1;
        session.dirty = true;
        this.schedulePersist();

        this.emitEvent({
          channel: 'WIC_BG_TO_PANEL',
          type: 'EVENT_VIDEOS_UPSERTED',
          tabId,
          revision: session.revision,
          upsertedVideos: modifiedVideos,
          scanStatus: session.scanStatus,
        });
      }
      return true;
    }

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

  updateSelection(
    tabId: number,
    mutation: SelectionMutation,
    mediaMode: MediaMode = 'image',
  ): string[] {
    const session = this.getOrCreateSession(tabId);

    const isVideoMode =
      mediaMode === 'video' ||
      (mutation.mode === 'toggle_one' && mutation.itemId.startsWith('vid_'));

    if (isVideoMode) {
      const canSelectVideo = (id: string): boolean => {
        const video = session.videoById.get(id);
        if (!video) return false;
        const activeVar = getActiveVideoVariant(video.variants, video.selectedUrl);
        return Boolean(activeVar && activeVar.readiness === 'ready');
      };

      switch (mutation.mode) {
        case 'toggle_one': {
          if (session.selectedVideoIds.has(mutation.itemId)) {
            session.selectedVideoIds.delete(mutation.itemId);
          } else if (canSelectVideo(mutation.itemId)) {
            session.selectedVideoIds.add(mutation.itemId);
          }
          break;
        }
        case 'add_many': {
          for (const id of mutation.itemIds) {
            if (canSelectVideo(id)) {
              session.selectedVideoIds.add(id);
            }
          }
          break;
        }
        case 'remove_many': {
          for (const id of mutation.itemIds) {
            session.selectedVideoIds.delete(id);
          }
          break;
        }
        case 'clear_all': {
          session.selectedVideoIds.clear();
          break;
        }
      }

      session.revision += 1;
      session.dirty = true;
      this.schedulePersist();

      const selectedVideoList = Array.from(session.selectedVideoIds);
      this.emitEvent({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_VIDEO_SELECTION_CHANGED',
        tabId,
        revision: session.revision,
        selectedVideoIds: selectedVideoList,
      });

      return selectedVideoList;
    }

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

  /**
   * Emits live byte progress for in-flight video downloads without bumping revision
   * or thrashing `chrome.storage.session`.
   */
  emitDownloadProgress(
    tabId: number,
    updates: Array<{ itemId: string; bytesReceived: number; totalBytes?: number }>,
  ): void {
    if (updates.length === 0) return;
    const session = this.sessions.get(tabId);
    if (session) {
      for (const u of updates) {
        const existing = session.downloads.get(u.itemId);
        if (existing && existing.status === 'in_progress') {
          existing.bytesReceived = u.bytesReceived;
          if (u.totalBytes && u.totalBytes > 0) {
            existing.totalBytes = u.totalBytes;
          }
        }
      }
    }

    this.emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_DOWNLOAD_PROGRESS',
      tabId,
      updates,
    });
  }

  getAllTrackedTabIds(): number[] {
    return Array.from(this.sessions.keys());
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
