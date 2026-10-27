import { ArrowUp, Library, Square } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { fontFamily, radius, space, typography, useTheme } from '@/theme';

type Props = {
  /** This conversation's answer is being written: the send button stops it. */
  busy: boolean;
  disabled?: boolean;
  /** Another conversation's answer is being written: typing works, sending waits. */
  blocked?: boolean;
  useLibrary: boolean;
  onToggleLibrary: (v: boolean) => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function Composer({ busy, disabled, blocked, useLibrary, onToggleLibrary, onSend, onStop }: Props) {
  const { t } = useTranslation('assistant');
  const { colors, scheme } = useTheme();
  const [text, setText] = useState('');
  const canSend = !!text.trim() && !busy && !blocked && !disabled;

  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <View
      style={[
        styles.box,
        { backgroundColor: colors.surface, borderColor: scheme === 'light' ? colors.border : colors.surfaceAlt, shadowColor: colors.shadow },
      ]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={useLibrary ? t('composer.placeholderLibrary') : t('composer.placeholder')}
        placeholderTextColor={colors.textTertiary}
        multiline
        editable={!disabled}
        submitBehavior="newline"
        accessibilityLabel={t('composer.placeholder')}
        style={[styles.input, { color: colors.text, fontFamily }]}
      />
      <View style={styles.toolbar}>
        <PressableScale
          haptic="selection"
          accessibilityRole="switch"
          accessibilityState={{ checked: useLibrary }}
          accessibilityLabel={t('composer.useLibrary')}
          accessibilityHint={useLibrary ? t('composer.useLibraryOn') : t('composer.useLibraryOff')}
          onPress={() => onToggleLibrary(!useLibrary)}
          style={[styles.toggle, { backgroundColor: useLibrary ? colors.accentSoft : colors.surfaceAlt }]}>
          <Library size={15} color={useLibrary ? colors.accent : colors.textSecondary} strokeWidth={2.2} />
          <Text variant="footnote" weight="600" tint={useLibrary ? colors.accent : colors.textSecondary}>
            {t('composer.useLibrary')}
          </Text>
        </PressableScale>
        {busy ? (
          <PressableScale
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('composer.stop')}
            onPress={onStop}
            pressedScale={0.9}
            style={[styles.send, { backgroundColor: colors.ink }]}>
            <Square size={14} color={colors.onInk} fill={colors.onInk} />
          </PressableScale>
        ) : (
          <PressableScale
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('composer.send')}
            accessibilityState={{ disabled: !canSend }}
            onPress={send}
            pressedScale={0.9}
            style={[styles.send, { backgroundColor: canSend ? colors.ink : colors.surfaceAlt }]}>
            <ArrowUp size={18} color={canSend ? colors.onInk : colors.textTertiary} strokeWidth={2.5} />
          </PressableScale>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  input: {
    fontSize: typography.body.fontSize,
    lineHeight: 22,
    minHeight: 24,
    maxHeight: 140,
    paddingHorizontal: space.xs,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.md, borderRadius: radius.pill },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
