export type NomadRouteNativeModule = {
  /** Opens a Valhalla actor for a config JSON (reused while the config is the same). */
  open(configJson: string): Promise<void>;
  close(): Promise<void>;
  /** Valhalla actions: request JSON in, response JSON out. Errors read "valhalla <code>: <message>". */
  route(request: string): Promise<string>;
  matrix(request: string): Promise<string>;
};
