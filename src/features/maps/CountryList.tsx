// Searchable list of countries by continent, the user's country (else the phone's) first. Used by the maps
// picker and the onboarding.
import { getLocales } from 'expo-localization';
import { Check } from 'lucide-react-native';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListGroup, ListRow, SearchField, SectionHeader, Text } from '@/components/ui';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

import { getRegion, groupCountries, regionName } from './regions';

/** The phone's country (from its region setting), if it is one we list. */
export function deviceCountry(): string | null {
  const code = getLocales()[0]?.regionCode?.toLowerCase();
  return code && getRegion(code)?.type === 'country' ? code : null;
}

export function CountryList({
  onPick,
  selected,
  installed,
}: {
  onPick: (regionId: string) => void;
  selected?: string | null;
  installed?: Set<string>;
}) {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const chosen = useSettings((st) => st.country);
  const suggested = useMemo(() => chosen ?? deviceCountry(), [chosen]);
  const sections = useMemo(
    () => groupCountries(i18n.language, query, { continent: (c) => t(`continent.${c}`), suggested: t('picker.suggested') }, suggested),
    [i18n.language, query, t, suggested],
  );

  return (
    <>
      <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('picker.search')} />
      {sections.map((section) => (
        <Fragment key={section.key}>
          <SectionHeader title={section.title} />
          <ListGroup>
            {section.data.map((r) => (
              <ListRow
                key={`${section.key}-${r.id}`}
                testID={`country-${r.id}`}
                title={regionName(r, i18n.language)}
                subtitle={installed?.has(r.id) ? t('common:status.installed') : undefined}
                trailing={selected === r.id ? <Check size={20} color={colors.accent} /> : undefined}
                chevron={selected === undefined}
                accessibilityRole={selected === undefined ? undefined : 'radio'}
                accessibilityState={selected === undefined ? undefined : { selected: selected === r.id }}
                onPress={() => onPick(r.id)}
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
    </>
  );
}
