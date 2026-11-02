import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EmptyState, ListGroup, Screen, Text } from '@/components/ui';
import { useCollections } from '@/features/library/collections';
import { OTHER } from '@/features/library/collections-core';
import { ArchiveRow } from '@/features/library/components/ArchiveRow';
import { FolderOpen } from 'lucide-react-native';
import { space } from '@/theme';

/** Archives the catalog doesn't know (imported, or downloaded from Kiwix with no topic of ours). */
export default function OtherFilesScreen() {
  const { t } = useTranslation('library');
  const members = useCollections().find((c) => c.key === OTHER)?.members ?? [];
  return (
    <Screen>
      <View style={{ gap: space.xs, paddingTop: space.md, marginBottom: space.lg }}>
        <Text variant="title2">{t('other')}</Text>
        <Text variant="callout" color="textSecondary">
          {t('otherBody')}
        </Text>
      </View>
      {members.length ? (
        <ListGroup>
          {members.map((item) => (
            <ArchiveRow key={item.id} item={item} />
          ))}
        </ListGroup>
      ) : (
        <EmptyState icon={FolderOpen} title={t('otherEmpty')} />
      )}
    </Screen>
  );
}
