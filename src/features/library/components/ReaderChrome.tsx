// Reader toolbar, popover panels, find bar and the medical disclaimer banner.
import type { LucideIcon } from 'lucide-react-native';
import { ChevronDown, ChevronUp, Minus, Plus, TriangleAlert, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, PressableScale, Text } from '@/components/ui';
import { fontFamily, radius, space, typography, useTheme } from '@/theme';

export type ToolbarAction = {
  key: string;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
};

/** Keyboard height on iOS, where the screen does not resize for it; 0 when hidden and on Android. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      Keyboard.scheduleLayoutAnimation(e);
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      Keyboard.scheduleLayoutAnimation(e);
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Docked bottom toolbar: evenly spaced icon buttons, safe-area aware. With `children`
 *  (the find bar) it rises above the keyboard. */
export function ReaderToolbar({ actions, children }: { actions: ToolbarAction[]; children?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const paddingBottom = children && keyboard ? keyboard + space.xs : Math.max(insets.bottom - space.md, space.sm);
  return (
    <View style={[styles.toolbar, { backgroundColor: colors.bg, borderTopColor: colors.border, paddingBottom }]}>
      {children ?? (
        <View style={styles.toolbarRow}>
          {actions.map((a) => (
            <IconButton
              key={a.key}
              testID={`reader-${a.key}`}
              icon={a.icon}
              accessibilityLabel={a.label}
              onPress={a.onPress}
              disabled={a.disabled}
              variant="plain"
              size={44}
              color={a.disabled ? colors.textTertiary : a.active ? colors.accent : colors.text}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** Small floating card anchored above the toolbar. */
export function Popover({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const { t } = useTranslation('reader');
  const { colors, scheme } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <PressableScale testID="popover-dismiss" style={StyleSheet.absoluteFill} onPress={onDismiss} pressedScale={1} accessibilityLabel={t('dismiss')} />
      <View
        style={[
          styles.popover,
          { backgroundColor: colors.surface, borderColor: scheme === 'light' ? colors.border : 'transparent', shadowColor: colors.shadow },
        ]}>
        {children}
      </View>
    </View>
  );
}

export function MenuItem({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} pressedScale={0.99} accessibilityRole="menuitem" style={styles.menuItem}>
      <Icon size={20} color={colors.text} />
      <Text variant="callout">{label}</Text>
    </PressableScale>
  );
}

export function TextSizeControl({ percent, onChange }: { percent: number; onChange: (p: number) => void }) {
  const { t } = useTranslation('reader');
  const step = (d: number) => onChange(Math.max(70, Math.min(200, percent + d)));
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" color="textSecondary">
        {t('textSize')}
      </Text>
      <View style={styles.sizeRow}>
        <IconButton icon={Minus} accessibilityLabel={t('smaller')} onPress={() => step(-10)} disabled={percent <= 70} />
        <PressableScale onPress={() => onChange(100)} accessibilityLabel={t('resetSize')} style={styles.sizeValue}>
          <Text variant="headline" tabular>
            {percent}%
          </Text>
        </PressableScale>
        <IconButton icon={Plus} accessibilityLabel={t('larger')} onPress={() => step(10)} disabled={percent >= 200} />
      </View>
    </View>
  );
}

export function FindBar({
  onFind,
  onClose,
  page,
}: {
  onFind: (text: string, backwards: boolean) => Promise<{ found: boolean; matches?: number; active?: number }>;
  onClose: () => void;
  /** Current page: the match count is dropped when it changes (it was for the previous page). */
  page?: string;
}) {
  const { t } = useTranslation('reader');
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ found: boolean; matches?: number; active?: number } | null>(null);
  const [statusPage, setStatusPage] = useState(page);
  if (page !== statusPage) {
    setStatusPage(page);
    setStatus(null);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = (value: string, backwards = false) => {
    if (!value) {
      setStatus(null);
      return;
    }
    onFind(value, backwards).then(setStatus).catch(() => setStatus({ found: false }));
  };

  const onChange = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), 250);
  };

  const label =
    status && text
      ? status.found
        ? status.matches
          ? t('findCount', { active: status.active ?? 1, count: status.matches })
          : ''
        : t('findNone')
      : '';

  return (
    <View style={styles.findRow}>
      <View style={[styles.findField, { backgroundColor: colors.surfaceAlt }]}>
        <TextInput
          autoFocus
          value={text}
          onChangeText={onChange}
          onSubmitEditing={() => run(text)}
          placeholder={t('findPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          submitBehavior="submit"
          style={[styles.findInput, { color: colors.text, fontFamily }]}
        />
        {label ? (
          <Text variant="caption" color="textSecondary" tabular>
            {label}
          </Text>
        ) : null}
      </View>
      <IconButton testID="find-previous" icon={ChevronUp} variant="plain" accessibilityLabel={t('findPrevious')} onPress={() => run(text, true)} disabled={!text} />
      <IconButton testID="find-next" icon={ChevronDown} variant="plain" accessibilityLabel={t('findNext')} onPress={() => run(text)} disabled={!text} />
      <IconButton testID="find-close" icon={X} variant="plain" accessibilityLabel={t('dismiss')} onPress={onClose} />
    </View>
  );
}

export function DisclaimerBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useTranslation('reader');
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.warningSoft }]} accessibilityRole="alert">
      <TriangleAlert size={18} color={colors.warning} style={{ marginTop: 1 }} />
      <Text variant="footnote" style={{ flex: 1 }}>
        {text}
      </Text>
      <IconButton icon={X} variant="plain" size={28} accessibilityLabel={t('dismiss')} onPress={onDismiss} color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.xs, paddingHorizontal: space.sm },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  popover: {
    position: 'absolute',
    right: space.md,
    bottom: space.sm,
    minWidth: 240,
    padding: space.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: space.xs,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.xs },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  sizeValue: { minWidth: 72, alignItems: 'center', paddingVertical: space.sm },
  findRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs },
  findField: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: radius.md, borderCurve: 'continuous', paddingHorizontal: space.md, gap: space.sm },
  findInput: { flex: 1, fontSize: typography.callout.fontSize, paddingVertical: 0 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
});
