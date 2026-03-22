import { contextBridge, ipcRenderer } from 'electron';

const IpcChannels = {
  FROM_MAIN: 'from-main',
  TO_MAIN: 'to-main',
  GET_APP_VERSION: 'get-app-version',
  GET_PLATFORM: 'get-platform',
  OPEN_FILE_DIALOG: 'open-file-dialog',
  READ_FILE: 'read-file',
  READ_FILE_RANGE: 'read-file-range',
  WRITE_FILE: 'write-file',
  SAVE_DIRECTORY_DIALOG: 'save-directory-dialog',
  OPEN_POINTCLOUD_DIALOG: 'open-pointcloud-dialog',
} as const;

type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

interface ElectronAPI {
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

const SEND_CHANNELS: IpcChannel[] = [IpcChannels.TO_MAIN];
const RECEIVE_CHANNELS: IpcChannel[] = [IpcChannels.FROM_MAIN];
const INVOKE_CHANNELS: IpcChannel[] = [
  IpcChannels.GET_APP_VERSION,
  IpcChannels.GET_PLATFORM,
  IpcChannels.OPEN_FILE_DIALOG,
  IpcChannels.READ_FILE,
  IpcChannels.READ_FILE_RANGE,
  IpcChannels.WRITE_FILE,
  IpcChannels.SAVE_DIRECTORY_DIALOG,
  IpcChannels.OPEN_POINTCLOUD_DIALOG,
];

const electronAPI: ElectronAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  send: (channel: string, data?: unknown) => {
    if (SEND_CHANNELS.includes(channel as IpcChannel)) {
      ipcRenderer.send(channel, data);
    }
  },

  invoke: <T = unknown>(channel: string, data?: unknown): Promise<T> => {
    if (INVOKE_CHANNELS.includes(channel as IpcChannel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (RECEIVE_CHANNELS.includes(channel as IpcChannel)) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        ...args: unknown[]
      ) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
    return () => {};
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
