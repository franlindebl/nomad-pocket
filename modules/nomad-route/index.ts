// Local Expo module: offline road routing with Valhalla over routing packs on the device.
// App code goes through src/features/maps/routing.ts, not this module directly.
export * from './src/NomadRoute.types';
export { default as NomadRoute, isNomadRouteAvailable } from './src/NomadRouteModule';
