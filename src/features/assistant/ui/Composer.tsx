import { ArrowUp, Library, Mic, Square } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { ChamferFill, CornerTicks, PressableScale, Text } from '@/components/ui';
import { chamfer, fontFamily, monoFamily, space, typography, useTheme } from '@/theme';

import { joinDictation } from '../dictation-core';
import { useDictation } from '../dictation';

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
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const canSend = !!text.trim() && !busy && !blocked && !disabled;
  // What was typed when dictation started: the spoken text goes after it.
  const typed = useRef('');
  const dictation = useDictation((spoken) => setText(joinDictation(typed.current, spoken)));

  const send = () => {
    if (!canSend) return;
    dictation.cancel();
    onSend(text.trim());
    setText('');
  };

  const toggleDictation = () => {
    if (dictation.listening) return dictation.stop();
    typed.current = text;
    dictation.start().catch((e) => console.warn('[dictation] start failed', e));
  };

  // Typing while listening means the person took over: stop and keep their text.
  const edit = (value: string) => {
    dictation.cancel();
    setText(value);
  };

  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
      <TextInput
        value={text}
        onChangeText={edit}
        placeholder={
          dictation.listening ? t('dictation.listening') : useLibrary ? t('composer.placeholderLibrary') : t('composer.placeholder')
        }
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
          style={[
            styles.toggle,
            useLibrary ? { backgroundColor: colors.accentSoft, borderColor: colors.accent } : { backgroundColor: 'transparent', borderColor: colors.outline },
          ]}>
          <Library size={14} color={useLibrary ? colors.accent : colors.textSecondary} strokeWidth={2.2} />
          <Text variant="caption" tint={useLibrary ? colors.accent : colors.textSecondary} style={styles.toggleLabel}>
            {t('composer.useLibrary')}
          </Text>
        </PressableScale>
        <View style={styles.actions}>
          {dictation.available && !disabled ? (
            <PressableScale
              testID="composer-mic"
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={dictation.listening ? t('dictation.stop') : t('dictation.start')}
              accessibilityHint={dictation.listening ? undefined : t('dictation.hint')}
              onPress={toggleDictation}
              pressedScale={0.9}
              style={styles.mic}>
              {dictation.listening ? (
                <View
                  pointerEvents="none"
                  style={[styles.halo, { backgroundColor: colors.accentSoft, transform: [{ scale: 1 + dictation.level * 0.45 }] }]}
                />
              ) : null}
              <View style={[styles.send, { backgroundColor: dictation.listening ? colors.accent : colors.surfaceAlt }]}>
                <Mic size={18} color={dictation.listening ? colors.onAccent : colors.textSecondary} strokeWidth={2.2} />
              </View>
            </PressableScale>
          ) : null}
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
              style={[styles.send, { backgroundColor: canSend ? 'transparent' : colors.surfaceAlt }]}>
              {canSend ? <ChamferFill color={colors.accent} cut={chamfer.sm} /> : null}
              <ArrowUp size={18} color={canSend ? colors.onAccent : colors.textTertiary} strokeWidth={2.5} />
            </PressableScale>
          )}
        </View>
      </View>
      <CornerTicks color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
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
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.md, borderWidth: 1 },
  toggleLabel: { fontFamily: monoFamily, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  send: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 36, height: 36 },
});
