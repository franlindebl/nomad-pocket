// Local Expo module: libkiwix/libzim bridge + ZimWebView.
// App code should go through src/features/library/zim.ts, not import this directly
// (except the reader, which renders <ZimWebView />).
export * from './src/NomadZim.types';
export { default as NomadZim, isNomadZimAvailable } from './src/NomadZimModule';
export { ZimWebView } from './src/ZimWebView';
