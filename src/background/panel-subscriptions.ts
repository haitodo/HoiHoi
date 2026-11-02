import type { PanelWatchMessage } from '@shared/messages';

/** Tracks each panel separately so closing/switching one window cannot stop another. */
export class PanelSubscriptions {
  private readonly targets = new Map<chrome.runtime.Port, number | null>();

  constructor(private readonly onChange: (tabIds: Set<number>) => void) {}

  add(port: chrome.runtime.Port): void {
    this.targets.set(port, null);
    port.onMessage.addListener((message: PanelWatchMessage) => {
      if (message?.type !== 'PANEL_WATCH_TAB') return;
      const tabId = Number.isInteger(message.tabId) && (message.tabId ?? -1) > 0
        ? message.tabId : null;
      if (this.targets.get(port) === tabId) return;
      this.targets.set(port, tabId);
      this.onChange(this.getTabIds());
    });
    port.onDisconnect.addListener(() => {
      this.targets.delete(port);
      this.onChange(this.getTabIds());
    });
  }

  getTabIds(): Set<number> {
    return new Set(Array.from(this.targets.values()).filter((id): id is number => id !== null));
  }

  watches(tabId: number): boolean {
    return Array.from(this.targets.values()).includes(tabId);
  }
}
