export interface ElectronAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  send: (channel: string, data?: unknown) => void;
  invoke: <T = unknown>(channel: string, data?: unknown) => Promise<T>;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
