import { router, Stack } from 'expo-router';
import { AlertCircle, ChevronDown, Cpu, History, Library, SquarePen, X } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, FlatList, ScrollView, StyleSheet, View, type HostInstance } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, IconBadge, IconButton, PressableScale, Row, Text } from '@/components/ui';
import { dismissError, newChat, sendMessage, stopAnswer, useChat, type ChatMessage, type Streaming } from '@/features/assistant/chats';
import { SYSTEM_MODEL_ID } from '@/features/assistant/models';
import { AssistantMessage, UserMessage } from '@/features/assistant/ui/Message';
import { Composer } from '@/features/assistant/ui/Composer';
import { useActiveModel } from '@/features/assistant/useActiveModel';
import { useItems } from '@/features/content/items';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

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

  const sessionStreaming = streaming && (streaming.sessionId === activeSessionId || !activeSessionId) ? streaming : null;
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

  const renderItem = useCallback(({ item }: { item: Row_ }) => {
    if (item.streaming) {
      const s = item.streaming;
      return <AssistantMessage text={s.text} sources={s.sources} streaming phase={s.phase} loadProgress={s.loadProgress} />;
    }
    const m = item.message!;
    return m.role === 'user' ? <UserMessage message={m} /> : <AssistantMessage text={m.content} sources={m.sources} />;
  }, []);

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
          <Composer
            busy={!!streaming}
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

function ErrorBanner({ code }: { code: string }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const known = ['noModel', 'notInstalled', 'systemUnavailable'].includes(code);
  return (
    <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
      <AlertCircle size={18} color={colors.danger} />
      <Text variant="footnote" color="danger" style={{ flex: 1 }}>
        {known ? t(`errors.${code}`) : t('errors.generic', { message: code })}
      </Text>
      <IconButton icon={X} size={28} variant="plain" color={colors.danger} accessibilityLabel={t('common:actions.close')} onPress={dismissError} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: space.gutter, paddingVertical: space.lg, gap: space.xxl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.gutter, paddingVertical: space.xl, gap: space.xl },
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
  composer: { paddingHorizontal: space.md, paddingTop: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: space.md, borderRadius: radius.pill, maxWidth: 220 },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
});
