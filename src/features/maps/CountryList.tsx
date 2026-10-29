// Searchable list of countries by continent, the user's country (else the phone's) first. Used by the maps
// picker and the onboarding. ~240 rows in a plain scroll view (a virtualized list got no height inside a
// form sheet) took a second or more to appear on a Mi 9: the first rows render at once, the rest a moment later.
import { getLocales } from 'expo-localization';
import { Check } from 'lucide-react-native';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListGroup, ListRow, SearchField, SectionHeader, Text } from '@/components/ui';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

import { getRegion, groupCountries, regionName } from './regions';

/** Rows drawn in the first frame; the rest follow once the sheet is up. */
const FIRST_ROWS = 30;

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
  const [all, setAll] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAll(true), 350);
    return () => clearTimeout(timer);
  }, []);
  const shown = useMemo(() => {
    if (all || query) return sections;
    let left = FIRST_ROWS;
    const out: typeof sections = [];
    for (const section of sections) {
      if (left <= 0) break;
      out.push({ ...section, data: section.data.slice(0, left) });
      left -= section.data.length;
    }
    return out;
  }, [all, query, sections]);

  return (
    <>
      <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('picker.search')} />
      {shown.map((section) => (
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
