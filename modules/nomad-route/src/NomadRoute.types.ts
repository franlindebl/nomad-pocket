export type NomadRouteNativeModule = {
  /**
   * Opens a Valhalla actor for a config JSON, reused while the config and its tile extract
   * file are the same (a pack file replaced at the same path is reopened).
   */
  open(configJson: string): Promise<void>;
  /** Releases the actor and its mmap of the pack file: call it before deleting or replacing a pack. */
  close(): Promise<void>;
  /** Valhalla actions: request JSON in, response JSON out. Errors read "valhalla <code>: <message>". */
  route(request: string): Promise<string>;
  matrix(request: string): Promise<string>;
};
