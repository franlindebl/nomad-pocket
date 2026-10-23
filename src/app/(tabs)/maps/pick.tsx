import { router } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListGroup, ListRow, Screen, SearchField, SectionHeader, Text } from '@/components/ui';
import { mapItemId } from '@/features/maps/extraction';
import { groupRegions, regionName } from '@/features/maps/regions';
import { useMapItems } from '@/features/maps/useMapSources';
import { space } from '@/theme';

// A plain scroll view (Screen) rather than a SectionList: inside a formSheet the
// virtualized list did not get a height. ~300 short rows render fine.
export default function RegionPicker() {
  const { t, i18n } = useTranslation('maps');
  const [query, setQuery] = useState('');
  const { regions: installed } = useMapItems();
  const installedIds = useMemo(() => new Set(installed.map((i) => i.id)), [installed]);
  const sections = useMemo(
    () =>
      groupRegions(i18n.language, query, {
        continent: (c) => t(`continent.${c}`),
        subdivisions: (country) => t('picker.subdivisions', { country }),
      }),
    [i18n.language, query, t],
  );

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('picker.search')} />
      {sections.map((section) => (
        <Fragment key={section.key}>
          <SectionHeader title={section.title} />
          <ListGroup>
            {section.data.map((r) => (
              <ListRow
                key={r.id}
                title={regionName(r, i18n.language)}
                subtitle={installedIds.has(mapItemId(r.id)) ? t('common:status.installed') : undefined}
                chevron
                onPress={() => router.push({ pathname: '/maps/download', params: { regionId: r.id } })}
                style={{ minHeight: 48 }}
              />
            ))}
          </ListGroup>
        </Fragment>
      ))}
      {!sections.length ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ marginTop: space.xxl }}>
          {t('picker.noResults', { query })}
        </Text>
      ) : null}
    </Screen>
  );
}
