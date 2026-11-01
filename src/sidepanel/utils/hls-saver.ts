import { VIDEO_BLOB_MAX_BYTES } from '@shared/constants';
import type { MessageResult } from '@shared/messages';
import { parseHlsMediaPlaylist } from '@shared/video-utils';
import { registerSidePanelObjectUrl } from '../hooks/useBlobStreamBridge';

export interface HlsStreamMergeProgress {
  completedSegments: number;
  totalSegments: number;
  bytesReceived: number;
}

export interface AssembledHlsVodResult {
  objectUrl: string;
  containerExtension: '.mp4' | '.ts';
  totalBytes: number;
  resolvedManifestUrl: string;
}

const MAX_HLS_VOD_SEGMENTS = 800;
const SEGMENT_FETCH_CONCURRENCY = 3;

async function fetchManifestText(
  tabId: number,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // 1. Try page context first when available so same-site cookies/headers match seamlessly
  if (tabId > 0) {
    try {
      const csRes = (await chrome.tabs.sendMessage(tabId, {
        channel: 'WIC_BG_TO_CONTENT',
        type: 'BG_FETCH_TEXT_ON_DEMAND',
        url,
        maxChars: 512_000,
      })) as MessageResult<string> | undefined;
      if (csRes?.ok && csRes.data) {
        return csRes.data;
      }
    } catch {
      // Fall back to direct extension fetch below
    }
  }

  // 2. Extension host-permission fetch (bypasses page CORS on cross-origin CDNs)
  const resp = await fetch(url, { credentials: 'include', signal });
  if (!resp.ok) {
    throw new Error(`プレイリストの取得に失敗しました (HTTP ${resp.status})`);
  }
  const text = await resp.text();
  return text.slice(0, 512_000);
}

/**
 * Strictly user-triggered VOD HLS (`.m3u8`) segment fetcher & merger (`video_mode_design.md` §6.3).
 * Never executes during passive scan or panel open.
 * Supports unencrypted MPEG-TS (`.ts`) and fMP4 (`#EXT-X-MAP` + `.m4s`) VOD streams.
 */
export async function downloadAndAssembleHlsVod(options: {
  tabId: number;
  manifestUrl: string;
  signal: AbortSignal;
  onProgress?: (progress: HlsStreamMergeProgress) => void;
}): Promise<AssembledHlsVodResult> {
  const { tabId, manifestUrl, signal, onProgress } = options;

  let activeManifestUrl = manifestUrl;
  let manifestText = await fetchManifestText(tabId, activeManifestUrl, signal);
  let parsed = parseHlsMediaPlaylist(manifestText, activeManifestUrl);

  // If user clicked merge directly on a Master Playlist, automatically follow highest-res variant once
  if (parsed.isMasterPlaylist) {
    if (parsed.isEncrypted) {
      throw new Error('DRM・暗号化保護されたストリームのため保存できません');
    }
    if (!parsed.bestMasterVariantUrl) {
      throw new Error('マスタープレイリスト内に有効なストリーム候補が見つかりませんでした');
    }
    activeManifestUrl = parsed.bestMasterVariantUrl;
    manifestText = await fetchManifestText(tabId, activeManifestUrl, signal);
    parsed = parseHlsMediaPlaylist(manifestText, activeManifestUrl);
  }

  if (parsed.isEncrypted) {
    throw new Error('暗号化ストリーム（#EXT-X-KEY）のため拡張機能単体では結合保存できません');
  }

  if (parsed.isLiveStream) {
    throw new Error('ライブ配信ストリームのため一括結合保存の対象外です');
  }

  if (parsed.segmentUrls.length === 0) {
    throw new Error('プレイリスト内に有効な動画セグメントが見つかりませんでした');
  }

  if (parsed.segmentUrls.length > MAX_HLS_VOD_SEGMENTS) {
    throw new Error(
      `セグメント数が上限（${MAX_HLS_VOD_SEGMENTS}件 / 検出:${parsed.segmentUrls.length}件）を超えています。yt-dlp コマンドをご利用ください`,
    );
  }

  const orderedUrls = parsed.initSegmentUrl
    ? [parsed.initSegmentUrl, ...parsed.segmentUrls]
    : [...parsed.segmentUrls];

  const totalSegments = orderedUrls.length;
  const buffers = new Array<ArrayBuffer>(totalSegments);
  let nextIndex = 0;
  let completedSegments = 0;
  let bytesReceived = 0;

  onProgress?.({ completedSegments: 0, totalSegments, bytesReceived: 0 });

  const workerCount = Math.min(SEGMENT_FETCH_CONCURRENCY, totalSegments);
  const runWorker = async (): Promise<void> => {
    while (nextIndex < totalSegments) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const currentIdx = nextIndex++;
      const segUrl = orderedUrls[currentIdx];
      if (!segUrl) continue;

      const resp = await fetch(segUrl, { credentials: 'include', signal });
      if (!resp.ok) {
        throw new Error(
          `セグメント ${currentIdx + 1}/${totalSegments} の取得に失敗しました (HTTP ${resp.status})`,
        );
      }

      const buffer = await resp.arrayBuffer();
      bytesReceived += buffer.byteLength;

      if (bytesReceived > VIDEO_BLOB_MAX_BYTES) {
        throw new Error(
          '結合データの合計サイズが上限（1GB）を超えました。yt-dlp コマンドをご利用ください',
        );
      }

      buffers[currentIdx] = buffer;
      completedSegments += 1;

      onProgress?.({
        completedSegments,
        totalSegments,
        bytesReceived,
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const assembledBlob = new Blob(buffers, { type: parsed.mimeType });
  buffers.length = 0;

  const objectUrl = URL.createObjectURL(assembledBlob);
  registerSidePanelObjectUrl(objectUrl);

  return {
    objectUrl,
    containerExtension: parsed.containerExtension,
    totalBytes: bytesReceived,
    resolvedManifestUrl: activeManifestUrl,
  };
}
