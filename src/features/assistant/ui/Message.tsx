import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { BookOpen, Copy, Flag, Library, RefreshCw, Sparkles } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { showToast } from '@/components/Toast';
import { Button, IconButton, PressableScale, Text } from '@/components/ui';
import { PLAN_SOURCE } from '@/features/prepare/passages';
import { formatPercent } from '../format';
import { radius, space, useTheme } from '@/theme';

import type { ChatMessage, MessageSource, Phase } from '../chats';
import { toPlainText } from '../markdown';
import { clipAnswer, REPORT_EMAIL, reportMailto } from '../report-core';
import { Markdown } from './Markdown';

export function openSource(s: MessageSource) {
  if (s.itemId === PLAN_SOURCE) {
    router.push('/prepare/plan');
    return;
  }
  // A PDF's own title is often a file name: the reader shows the document's name instead.
  router.push({
    pathname: '/reader/[itemId]',
    params: s.page ? { itemId: s.itemId, path: s.path, title: s.title } : { itemId: s.itemId, path: s.path },
  });
}

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const { colors } = useTheme();
  return (
    <View style={styles.userRow}>
      <View style={[styles.userBubble, { backgroundColor: colors.surfaceAlt }]}>
        <Text selectable>{message.content}</Text>
      </View>
    </View>
  );
});

function Avatar() {
  const { hue } = useTheme();
  const ai = hue('ai');
  return (
    <View style={[styles.avatar, { backgroundColor: ai.bg }]} accessibilityElementsHidden>
      <Sparkles size={14} color={ai.fg} strokeWidth={2.2} />
    </View>
  );
}

export function SourceChips({ sources }: { sources: MessageSource[] }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  if (!sources.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" color="textSecondary">
        {t('sources')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsScroll}>
        {sources.map((s) => {
          const label = s.page ? t('sourcePage', { title: s.title, page: s.page }) : s.title;
          return (
            <PressableScale
              key={s.n}
              haptic="selection"
              accessibilityRole="link"
              accessibilityLabel={`${s.n}. ${label}`}
              onPress={() => openSource(s)}
              style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.chipNum, { backgroundColor: colors.accentSoft }]}>
                <Text variant="caption" weight="700" tint={colors.accent} tabular>
                  {s.n}
                </Text>
              </View>
              <BookOpen size={14} color={colors.textSecondary} />
              <Text variant="footnote" weight="600" numberOfLines={1} style={styles.chipTitle}>
                {label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

type AssistantProps = {
  text: string;
  sources: MessageSource[];
  streaming?: boolean;
  phase?: Phase;
  loadProgress?: number;
  /** Shown under an answer given without the library: answer it again searching it. */
  onSearchLibrary?: () => void;
  /** Set only on the last answer of a conversation, when nothing is being written. */
  onRegenerate?: () => void;
  /** Show the copy button (finished answers). */
  copyable?: boolean;
};

export const AssistantMessage = memo(function AssistantMessage({
  text,
  sources,
  streaming,
  phase,
  loadProgress,
  onSearchLibrary,
  onRegenerate,
  copyable,
}: AssistantProps) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const byN = useMemo(() => new Map(sources.map((s) => [s.n, s])), [sources]);
  const citable = useMemo(() => new Set(byN.keys()), [byN]);
  const onCite = (n: number) => {
    const s = byN.get(n);
    if (s) openSource(s);
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(toPlainText(text));
      showToast(t('copied'));
    } catch {
      // The clipboard is not available: nothing useful to tell the user.
    }
  };

  // Opens the user's mail app with the answer; without one, say where to write. Android only: Google Play's
  // AI-generated content policy asks for it, the App Store doesn't (owner's decision, 2026-10-29).
  const report = () => {
    const body = t('report.body', {
      answer: clipAnswer(toPlainText(text)),
      version: Constants.expoConfig?.version ?? '0.0.0',
      platform: `${Platform.OS} ${Platform.Version}`,
    });
    Linking.openURL(reportMailto(t('report.subject'), body)).catch(() => showToast(t('report.noMail', { email: REPORT_EMAIL }), false));
  };

  const waiting = streaming && !text;
  let status = '';
  if (waiting && phase) {
    status =
      phase === 'loading' && loadProgress && loadProgress > 0 && loadProgress < 1
        ? t('phase.loadingProgress', { percent: formatPercent(loadProgress) })
        : t(`phase.${phase}`);
  }

  return (
    <View style={styles.assistantRow}>
      <Avatar />
      <View style={styles.assistantBody}>
        {waiting ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text variant="callout" color="textSecondary">
              {status}
            </Text>
          </View>
        ) : (
          <Markdown text={text} onCite={onCite} citable={citable} caret={streaming} />
        )}
        {!waiting && sources.length ? <SourceChips sources={sources} /> : null}
        {copyable && !streaming && text ? (
          <View style={styles.actions}>
            <IconButton icon={Copy} variant="plain" size={36} accessibilityLabel={t('copy')} onPress={copy} testID="assistant-copy" />
            {onRegenerate ? (
              <IconButton icon={RefreshCw} variant="plain" size={36} accessibilityLabel={t('regenerate')} onPress={onRegenerate} testID="assistant-regenerate" />
            ) : null}
            {Platform.OS === 'android' ? (
              <IconButton icon={Flag} variant="plain" size={36} accessibilityLabel={t('report.label')} onPress={report} testID="assistant-report" />
            ) : null}
          </View>
        ) : null}
        {onSearchLibrary ? (
          <Button
            title={t('searchLibrary')}
            accessibilityLabel={t('searchLibraryHint')}
            icon={Library}
            variant="secondary"
            size="sm"
            onPress={onSearchLibrary}
            style={styles.searchLibrary}
            testID="search-library"
          />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: 48 },
  userBubble: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
    borderCurve: 'continuous',
    maxWidth: '100%',
  },
  assistantRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  assistantBody: { flex: 1, gap: space.md, paddingTop: 2 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  actions: { flexDirection: 'row', gap: space.xs, marginLeft: -space.sm, marginTop: -space.sm },
  searchLibrary: { alignSelf: 'flex-start' },
  chipsScroll: { flexGrow: 0, marginRight: -space.gutter },
  chips: { gap: space.sm, paddingRight: space.gutter },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 5,
    paddingRight: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 260,
  },
  chipNum: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  chipTitle: { flexShrink: 1 },
});
