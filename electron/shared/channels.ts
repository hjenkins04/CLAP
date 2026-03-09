export const IpcChannels = {
  FROM_MAIN: 'from-main',
  TO_MAIN: 'to-main',
  GET_APP_VERSION: 'get-app-version',
  GET_PLATFORM: 'get-platform',
  OPEN_FILE_DIALOG: 'open-file-dialog',
  READ_FILE: 'read-file',
  WRITE_FILE: 'write-file',
  SAVE_DIRECTORY_DIALOG: 'save-directory-dialog',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
