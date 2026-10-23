import { requireNativeView } from 'expo';
import { forwardRef, useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';

import type { ZimWebViewProps, ZimWebViewRef } from './NomadZim.types';

type NativeHandle = ZimWebViewRef;

const NativeZimWebView: ComponentType<ZimWebViewProps & { ref?: Ref<NativeHandle> }> = requireNativeView('NomadZim');

/**
 * Renders archive content natively (WKURLSchemeHandler on iOS,
 * shouldInterceptRequest on Android). Commands are exposed through the ref.
 */
export const ZimWebView = forwardRef<ZimWebViewRef, ZimWebViewProps>(function ZimWebView(props, ref) {
  const native = useRef<NativeHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      goBack: () => native.current?.goBack() ?? Promise.resolve(),
      goForward: () => native.current?.goForward() ?? Promise.resolve(),
      reload: () => native.current?.reload() ?? Promise.resolve(),
      loadPath: (path) => native.current?.loadPath(path) ?? Promise.resolve(),
      setTextZoom: (p) => native.current?.setTextZoom(p) ?? Promise.resolve(),
      setDarkMode: (on) => native.current?.setDarkMode(on) ?? Promise.resolve(),
      findInPage: (text, backwards = false) => native.current?.findInPage(text, backwards) ?? Promise.resolve({ found: false }),
      clearFind: () => native.current?.clearFind() ?? Promise.resolve(),
    }),
    [],
  );
  return <NativeZimWebView {...props} ref={native} />;
});
