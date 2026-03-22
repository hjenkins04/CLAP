export const IpcChannels = {
  FROM_MAIN: 'from-main',
  TO_MAIN: 'to-main',
  GET_APP_VERSION: 'get-app-version',
  GET_PLATFORM: 'get-platform',
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_POINTCLOUD_DIALOG: 'open-pointcloud-dialog',
  READ_FILE: 'read-file',
  READ_FILE_RANGE: 'read-file-range',
  WRITE_FILE: 'write-file',
  SAVE_DIRECTORY_DIALOG: 'save-directory-dialog',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
