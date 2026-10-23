import { Download } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, ListGroup, Screen } from '@/components/ui';
import { DownloadRow } from '@/features/downloads/DownloadRow';
import { useActiveDownloads } from '@/features/downloads/manager';
import { space } from '@/theme';

export default function DownloadsScreen() {
  const { t } = useTranslation();
  const downloads = useActiveDownloads();
  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      {downloads.length === 0 ? (
        <EmptyState icon={Download} hue="survival" title={t('downloads.empty')} body={t('downloads.emptyBody')} />
      ) : (
        <ListGroup>
          {downloads.map((d) => (
            <DownloadRow key={d.id} record={d} />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}
