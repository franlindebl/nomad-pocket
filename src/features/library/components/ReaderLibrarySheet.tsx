import { Bookmark as BookmarkIcon, History } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Divider, EmptyState, ListRow, Segmented, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { listBookmarks, recentHistory } from '../history';

import { Sheet } from './Sheet';

type Tab = 'bookmarks' | 'history';

type Props = { itemId: string; onClose: () => void; onOpen: (path: string) => void };

/** Bookmarks and reading history of one archive. */
export function ReaderLibrarySheet({ visible, ...props }: Props & { visible: boolean }) {
  // Each opening mounts the content afresh, so it lists what is in the database now: a
  // bookmark removed after the sheet was last open used to stay listed.
  const [opened, setOpened] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpened(opened + 1);
  }
  return (
    <Sheet visible={visible} onClose={props.onClose}>
      <LibraryContent key={opened} {...props} />
    </Sheet>
  );
}

function LibraryContent({ itemId, onClose, onOpen }: Props) {
  const { t, i18n } = useTranslation('reader');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('bookmarks');

  const rows = useMemo(
    () =>
      tab === 'bookmarks'
        ? listBookmarks(itemId).map((b) => ({ key: `b${b.id}`, path: b.path, title: b.title, at: b.createdAt }))
        : recentHistory(100, itemId).map((h) => ({ key: `h${h.id}`, path: h.path, title: h.title, at: h.visitedAt })),
    [tab, itemId],
  );

  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <View style={styles.header}>
        <Text variant="title3">{t('bookmarksHistory')}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
          <Text variant="callout" weight="600">
            {tc('actions.done')}
          </Text>
        </Pressable>
      </View>
      <Segmented<Tab>
        style={styles.segmented}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'bookmarks', label: t('bookmarks') },
          { value: 'history', label: t('history') },
        ]}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        ItemSeparatorComponent={() => <Divider style={{ marginLeft: space.lg }} />}
        renderItem={({ item }) => (
          <ListRow
            title={item.title || item.path}
            subtitle={fmt.format(item.at)}
            leading={tab === 'bookmarks' ? <BookmarkIcon size={18} color={colors.accent} /> : <History size={18} color={colors.textTertiary} />}
            onPress={() => onOpen(item.path)}
          />
        )}
        ListEmptyComponent={
          tab === 'bookmarks' ? (
            <EmptyState icon={BookmarkIcon} title={t('noBookmarks')} body={t('noBookmarksBody')} />
          ) : (
            <EmptyState icon={History} title={t('noHistory')} body={t('noHistoryBody')} />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.gutter, paddingTop: space.lg, paddingBottom: space.md },
  segmented: { marginHorizontal: space.gutter, marginBottom: space.sm },
});
