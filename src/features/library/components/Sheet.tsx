import type { ReactNode } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

/** Native page sheet on iOS (swipe to dismiss), full-screen slide-up modal on Android. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}>
      <SafeAreaProvider>
        <SheetBody>{children}</SheetBody>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.body,
        { backgroundColor: colors.bg, paddingTop: Platform.OS === 'ios' ? 0 : insets.top, paddingBottom: Platform.OS === 'ios' ? 0 : insets.bottom },
      ]}>
      {Platform.OS === 'ios' ? <View style={[styles.grabber, { backgroundColor: colors.border }]} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: 6, marginBottom: 2 },
});
