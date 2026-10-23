import { router } from 'expo-router';
import { MessagesSquare, SquarePen, Trash2 } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button, EmptyState, IconButton, ListGroup, ListRow, SectionHeader } from '@/components/ui';
import { deleteSession, newChat, openSession, refreshSessions, useChat, type ChatSession } from '@/features/assistant/chats';
import { formatChatDate } from '@/features/assistant/format';
import { space, useTheme } from '@/theme';

export default function ConversationsScreen() {
  const { t } = useTranslation('assistant');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const sessions = useChat((s) => s.sessions);
  const activeId = useChat((s) => s.activeSessionId);

  useEffect(() => {
    refreshSessions();
  }, []);

  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = sessions.filter((s) => s.updatedAt >= startOfDay);
  const earlier = sessions.filter((s) => s.updatedAt < startOfDay);

  const confirmDelete = (s: ChatSession) =>
    Alert.alert(t('conversations.delete'), t('conversations.deleteConfirm', { title: s.title }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => deleteSession(s.id) },
    ]);

  const open = (id: string) => {
    openSession(id);
    router.back();
  };

  const row = (s: ChatSession) => (
    <ListRow
      key={s.id}
      title={s.title}
      subtitle={[formatChatDate(s.updatedAt), s.preview?.replace(/\s+/g, ' ')].filter(Boolean).join(' · ')}
      titleLines={1}
      subtitleLines={1}
      style={s.id === activeId ? { backgroundColor: colors.surfaceAlt } : undefined}
      onPress={() => open(s.id)}
      onLongPress={() => confirmDelete(s)}
      trailing={<IconButton icon={Trash2} size={32} variant="plain" color={colors.textTertiary} accessibilityLabel={t('conversations.delete')} onPress={() => confirmDelete(s)} />}
    />
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Button
        title={t('newChat')}
        icon={SquarePen}
        onPress={() => {
          newChat();
          router.back();
        }}
        fullWidth
      />
      {!sessions.length ? (
        <EmptyState icon={MessagesSquare} hue="ai" title={t('conversations.empty')} body={t('conversations.emptyBody')} />
      ) : (
        <View>
          {today.length ? (
            <>
              <SectionHeader title={t('conversations.today')} />
              <ListGroup>{today.map(row)}</ListGroup>
            </>
          ) : null}
          {earlier.length ? (
            <>
              <SectionHeader title={t('conversations.earlier')} />
              <ListGroup>{earlier.map(row)}</ListGroup>
            </>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingBottom: space.huge },
});
