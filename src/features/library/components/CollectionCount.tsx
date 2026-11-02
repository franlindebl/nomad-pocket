// "4 of 18 on your phone · 167 MB" over slanted segments: how much of a collection you have, at the top of
// its screen (the Library's list shows the same count, smaller).
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ProgressBar, Text } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { space, useTheme } from '@/theme';

import type { Collection } from '../collections';

export function CollectionCount({ collection }: { collection: Collection }) {
  const { t } = useTranslation('library');
  const { colors } = useTheme();
  const { have, total, members } = collection;
  if (!total) return null;
  const bytes = members.reduce((s, m) => s + m.sizeBytes, 0);
  return (
    <View style={{ gap: space.sm, marginTop: space.xs }}>
      <Text variant="overline" color={have ? 'text' : 'textSecondary'} tabular>
        {have ? t('haveOnDevice', { have, total, size: formatBytes(bytes) }) : t('noneOnDevice', { total })}
      </Text>
      <ProgressBar
        value={have / total}
        segments={total <= 24 ? total : undefined}
        gap={3}
        height={5}
        trackColor={colors.outline}
        style={{ maxWidth: 260, paddingHorizontal: 0 }}
      />
    </View>
  );
}
