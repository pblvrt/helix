interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
  removeAllListeners(channel: string): void;
  openExternal(url: string): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
