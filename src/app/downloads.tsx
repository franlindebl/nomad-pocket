import { Download } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Platform } from 'react-native';

import { EmptyState, ListGroup, Screen, Text } from '@/components/ui';
import { DownloadRow } from '@/features/downloads/DownloadRow';
import { groupDownloads } from '@/features/downloads/groups';
import { useActiveDownloads } from '@/features/downloads/manager';
import { space } from '@/theme';

export default function DownloadsScreen() {
  const { t } = useTranslation();
  const downloads = groupDownloads(useActiveDownloads());
  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      {/* Android form sheets have no native header. */}
      {Platform.OS === 'android' ? (
        <Text variant="title2" style={{ marginBottom: space.lg }}>
          {t('downloads.title')}
        </Text>
      ) : null}
      {downloads.length === 0 ? (
        <EmptyState icon={Download} hue="survival" title={t('downloads.empty')} body={t('downloads.emptyBody')} />
      ) : (
        <ListGroup>
          {downloads.map((d) => (
            <DownloadRow key={d.id} entry={d} />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}
