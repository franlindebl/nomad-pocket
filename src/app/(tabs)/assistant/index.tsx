import { router, Stack } from 'expo-router';
import { AlertCircle, ChevronDown, Cpu, History, Library, SquarePen, X } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Dimensions, FlatList, ScrollView, StyleSheet, View, type HostInstance } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, IconBadge, IconButton, PressableScale, Row, Text } from '@/components/ui';
import { dismissError, newChat, openSession, regenerateLast, retryLast, searchLibraryFor, sendMessage, stopAnswer, useChat, type ChatMessage, type Streaming } from '@/features/assistant/chats';
import { isErrorKey } from '@/features/assistant/errors';
import { SYSTEM_MODEL_ID } from '@/features/assistant/models';
import { AssistantMessage, UserMessage } from '@/features/assistant/ui/Message';
import { Composer } from '@/features/assistant/ui/Composer';
import { useActiveModel } from '@/features/assistant/useActiveModel';
import { useItems } from '@/features/content/items';
import { useSettings } from '@/stores/settings';
import { layout, radius, space, useTheme } from '@/theme';

type Row_ = { key: string; message?: ChatMessage; streaming?: Streaming };

const STARTERS = ['water', 'burn', 'fire', 'photosynthesis'] as const;

export default function AssistantScreen() {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const model = useActiveModel();
  const libraryItems = useItems('zim');
  const { messages, streaming, error, useLibrary, setUseLibrary, activeSessionId } = useChat();

  const sessionStreaming = streaming?.sessionId === activeSessionId ? streaming : null;
  const rows = useMemo<Row_[]>(() => {
    const out: Row_[] = messages.map((m) => ({ key: m.id, message: m }));
    if (sessionStreaming) out.push({ key: sessionStreaming.messageId, streaming: sessionStreaming });
    return out.reverse();
  }, [messages, sessionStreaming]);

  // Composer rides on top of the keyboard, or of the tab bar when it's closed. The keyboard
  // height is measured from the screen bottom, but on Android the screen ends above the
  // bottom navigation bar: subtract the gap between this view and the window bottom.
  const rootRef = useRef<HostInstance>(null);
  const [bottomGap, setBottomGap] = useState(0);
  const measureGap = useCallback(() => {
    rootRef.current?.measureInWindow((_x, y, _w, h) => setBottomGap(Math.max(0, Dimensions.get('screen').height - (y + h))));
  }, []);
  const bottomStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(insets.bottom, keyboard.height.value - bottomGap) + space.sm,
  }));

  // The latest answer, if it was given without the library, offers to search it.
  const last = messages[messages.length - 1];
  const searchableId = !streaming && useLibrary && libraryItems.length && last?.role === 'assistant' && last.searched === false ? last.id : null;

  const regenerableId = !streaming && last?.role === 'assistant' && messages.length > 1 ? last.id : null;

  const renderItem = useCallback(
    ({ item }: { item: Row_ }) => {
      if (item.streaming) {
        const s = item.streaming;
        return <AssistantMessage text={s.text} sources={s.sources} streaming phase={s.phase} loadProgress={s.loadProgress} />;
      }
      const m = item.message!;
      if (m.role === 'user') return <UserMessage message={m} />;
      return (
        <AssistantMessage
          text={m.content}
          sources={m.sources}
          copyable
          onSearchLibrary={m.id === searchableId ? () => searchLibraryFor(m.id) : undefined}
          onRegenerate={m.id === regenerableId ? () => void regenerateLast() : undefined}
        />
      );
    },
    [searchableId, regenerableId],
  );

  const empty = rows.length === 0;
  const noLibrary = useLibrary && libraryItems.length === 0;

  return (
    <View ref={rootRef} onLayout={measureGap} style={[styles.root, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerTitle: () => <ModelPill name={model.name} />,
          headerLeft: () => (
            <IconButton icon={History} variant="plain" size={36} accessibilityLabel={t('history')} onPress={() => router.push('/assistant/conversations')} />
          ),
          headerRight: () => (
            <IconButton icon={SquarePen} variant="plain" size={36} accessibilityLabel={t('newChat')} onPress={newChat} disabled={empty && !activeSessionId} />
          ),
        }}
      />

      {!model.ready ? (
        <NoModel systemAvailable={model.systemAvailable} />
      ) : empty ? (
        <ScrollView contentContainerStyle={styles.emptyContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.hero}>
            <IconBadge icon={Cpu} hue="ai" size={48} />
            <Text variant="title2" align="center">
              {t('empty.title')}
            </Text>
            <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
              {useLibrary && !noLibrary ? t('empty.bodyLibrary') : t('empty.body')}
            </Text>
          </View>
          {noLibrary ? <NoLibraryCard /> : null}
          <View style={styles.starters}>
            {STARTERS.map((k) => (
              <PressableScale
                key={k}
                haptic="light"
                accessibilityRole="button"
                onPress={() => sendMessage(t(`empty.starters.${k}`))}
                style={[styles.starter, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text variant="callout" numberOfLines={3}>
                  {t(`empty.starters.${k}`)}
                </Text>
              </PressableScale>
            ))}
          </View>
          <Text variant="caption" color="textTertiary" align="center" style={{ maxWidth: 320, alignSelf: 'center' }}>
            {t('empty.disclaimer')}
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={error ? <ErrorBanner code={error} /> : undefined}
        />
      )}

      {model.ready ? (
        <Animated.View style={[styles.composer, bottomStyle]}>
          {streaming && !sessionStreaming ? <AnsweringElsewhere sessionId={streaming.sessionId} /> : null}
          <Composer
            busy={!!sessionStreaming}
            blocked={!!streaming}
            useLibrary={useLibrary}
            onToggleLibrary={setUseLibrary}
            onSend={(q) => sendMessage(q)}
            onStop={() => stopAnswer()}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function ModelPill({ name }: { name: string | null }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={`${t('model')}: ${name ?? t('noModel.action')}`}
      onPress={() => router.push('/assistant/models')}
      style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="footnote" weight="700" numberOfLines={1}>
        {name ?? t('noModel.action')}
      </Text>
      <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2.5} />
    </PressableScale>
  );
}

/** Shown in a conversation while another one's answer is being written: tap to go there. */
function AnsweringElsewhere({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityHint={t('answeringElsewhere.hint')}
      onPress={() => openSession(sessionId)}
      style={[styles.elsewhere, { backgroundColor: colors.surfaceAlt }]}>
      <ActivityIndicator size="small" color={colors.textSecondary} />
      <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
        {t('answeringElsewhere.title')}
      </Text>
      <Text variant="footnote" weight="600" tint={colors.accent}>
        {t('answeringElsewhere.action')}
      </Text>
    </PressableScale>
  );
}

function NoModel({ systemAvailable }: { systemAvailable: boolean }) {
  const { t } = useTranslation('assistant');
  const setAiModelId = useSettings((s) => s.setAiModelId);
  return (
    <ScrollView contentContainerStyle={styles.emptyContent}>
      <View style={styles.hero}>
        <IconBadge icon={Cpu} hue="ai" size={64} />
        <Text variant="title2" align="center">
          {t('noModel.title')}
        </Text>
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 330 }}>
          {systemAvailable ? t('noModel.bodySystem') : t('noModel.body')}
        </Text>
        <View style={{ gap: space.sm, alignSelf: 'stretch', marginTop: space.md }}>
          {systemAvailable ? <Button title={t('noModel.useSystem')} onPress={() => setAiModelId(SYSTEM_MODEL_ID)} fullWidth size="lg" /> : null}
          <Button
            title={t('noModel.action')}
            variant={systemAvailable ? 'secondary' : 'primary'}
            onPress={() => router.push('/assistant/models')}
            fullWidth
            size="lg"
          />
        </View>
      </View>
    </ScrollView>
  );
}

function NoLibraryCard() {
  const { t } = useTranslation('assistant');
  return (
    <Card style={{ gap: space.md }} onPress={() => router.navigate('/library')} accessibilityLabel={t('noLibrary.action')}>
      <Row gap={space.md} align="flex-start">
        <IconBadge icon={Library} hue="reference" size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{t('noLibrary.title')}</Text>
          <Text variant="footnote" color="textSecondary">
            {t('noLibrary.body')}
          </Text>
          <Text variant="footnote" weight="600" color="accent" style={{ marginTop: space.xs }}>
            {t('noLibrary.action')} →
          </Text>
        </View>
      </Row>
    </Card>
  );
}

const NO_RETRY = new Set(['noModel', 'notInstalled', 'systemUnavailable', 'language', 'notReady']);

function ErrorBanner({ code }: { code: string }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const known = isErrorKey(code);
  // Retrying can't help when there is no model to answer or it can't read the language.
  const canRetry = !NO_RETRY.has(code);
  return (
    <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
      <AlertCircle size={18} color={colors.danger} />
      <Text variant="footnote" color="danger" style={{ flex: 1 }}>
        {known ? t(`errors.${code}`) : t('errors.generic', { message: code })}
      </Text>
      {canRetry && (
        <PressableScale onPress={() => void retryLast()} accessibilityRole="button" accessibilityLabel={t('common:actions.retry')} testID="assistant-retry">
          <Text variant="footnote" color="danger" style={{ fontWeight: '600' }}>
            {t('common:actions.retry')}
          </Text>
        </PressableScale>
      )}
      <IconButton icon={X} size={28} variant="plain" color={colors.danger} accessibilityLabel={t('common:actions.close')} onPress={dismissError} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { ...layout.column, paddingHorizontal: space.gutter, paddingVertical: space.lg, gap: space.xxl },
  emptyContent: { ...layout.column, flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.gutter, paddingVertical: space.xl, gap: space.xl },
  hero: { alignItems: 'center', gap: space.md },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  starter: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 64,
    padding: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  composer: { ...layout.column, paddingHorizontal: space.md, paddingTop: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: space.md, borderRadius: radius.pill, maxWidth: 220 },
  elsewhere: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
});
