// Form controls for the plan and kit sheets: labelled text field, number stepper and
// expiry month picker. Same look as the map marker sheet.
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { IconButton, Row, Text } from '@/components/ui';
import { fontFamily, radius, space, typography, useTheme } from '@/theme';

import { addMonths, formatMonth } from './kit';

/** Header "Save" for the form sheets: a bottom button ends up under the keyboard. */
export function SaveButton({ onPress, disabled, testID }: { onPress: () => void; disabled?: boolean; testID: string }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={{ paddingHorizontal: space.sm, opacity: disabled ? 0.4 : 1 }}>
      <Text variant="headline" color="accent">
        {t('actions.save')}
      </Text>
    </Pressable>
  );
}

/**
 * Title + Save for the form sheets. A bottom Save ends up under the keyboard, so it goes in
 * the native header on iOS; Android form sheets show no native header, so there the same
 * row is drawn at the top of the content.
 */
export function SheetHeader({
  title,
  onSave,
  saveDisabled,
  saveTestID,
}: {
  title: string;
  onSave: () => void;
  saveDisabled?: boolean;
  saveTestID: string;
}) {
  const save = <SaveButton testID={saveTestID} onPress={onSave} disabled={saveDisabled} />;
  if (Platform.OS === 'ios') return <Stack.Screen options={{ title, headerRight: () => save }} />;
  return (
    <Row style={{ justifyContent: 'space-between', gap: space.md }}>
      <Stack.Screen options={{ title }} />
      <Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Text>
      {save}
    </Row>
  );
}

/** Without `label` (the section header already names it), pass `accessibilityLabel`. */
export function Field({ label, multiline, ...rest }: TextInputProps & { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {label ? (
        <Text variant="overline" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel={label}
        multiline={multiline}
        {...rest}
        style={[styles.input, multiline && styles.multiline, { backgroundColor: colors.surfaceAlt, color: colors.text, fontFamily }]}
      />
    </View>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max,
  testID,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max: number;
  testID?: string;
}) {
  return (
    <Row style={styles.stepper}>
      <Text variant="headline" style={{ flex: 1 }}>
        {label}
      </Text>
      <IconButton
        testID={testID && `${testID}-minus`}
        icon={Minus}
        size={34}
        accessibilityLabel={`${label} −`}
        disabled={value <= min}
        onPress={() => onChange(value - 1)}
      />
      <Text
        variant="headline"
        tabular
        align="center"
        style={styles.value}
        accessibilityLabel={`${label}: ${value}`}
        testID={testID && `${testID}-value`}>
        {value}
      </Text>
      <IconButton
        testID={testID && `${testID}-plus`}
        icon={Plus}
        size={34}
        accessibilityLabel={`${label} +`}
        disabled={value >= max}
        onPress={() => onChange(value + 1)}
      />
    </Row>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const { t, i18n } = useTranslation('prepare');
  return (
    <Row style={styles.month}>
      <IconButton icon={ChevronLeft} size={36} accessibilityLabel={t('item.prevMonth')} onPress={() => onChange(addMonths(value, -1))} />
      <Text variant="headline" align="center" style={{ flex: 1 }} testID="expiry-month" accessibilityLiveRegion="polite">
        {formatMonth(value, i18n.language)}
      </Text>
      <IconButton icon={ChevronRight} size={36} accessibilityLabel={t('item.nextMonth')} onPress={() => onChange(addMonths(value, 1))} />
    </Row>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: typography.body.fontSize,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  stepper: { paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 52, gap: space.md },
  value: { minWidth: 28 },
  month: { gap: space.md },
});
