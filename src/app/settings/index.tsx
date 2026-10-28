import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Database, GraduationCap, Map, Scale, ShieldCheck, Sparkles, Trash2, Wand2 } from 'lucide-react-native';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, IconBadge, ListGroup, ListRow, ProgressBar, Row, Screen, SectionHeader, Segmented, Switch, Text } from '@/components/ui';
import { searchIndexBytes } from '@/db';
import { removeItem, useItems, type InstalledItem } from '@/features/content/items';
import { clearHistory } from '@/features/library/history';
import { removeCountry, useCountries, type CountryState } from '@/features/maps/countries';
import { getRegion, regionName } from '@/features/maps/regions';
import type { AppLanguage } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { freeBytes, totalBytes } from '@/lib/storage';
import { useSettings, type ThemePreference } from '@/stores/settings';
import { space, useTheme } from '@/theme';

const PRIVACY_URL = 'https://franlindebl.github.io/nomad-pocket/privacy.html';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const s = useSettings();
  const lang = i18n.language;
  const items = useItems();
  const { countries, otherMaps } = useCountries();
  // The map search index too: up to ~1 GB per country, and not part of any item's size.
  const used = items.reduce((sum, i) => sum + i.sizeBytes, 0) + searchIndexBytes();
  const free = freeBytes();
  const total = totalBytes();
  const region = s.country ? getRegion(s.country) : undefined;
  const zims = items.filter((i) => i.kind === 'zim');
  const models = items.filter((i) => i.kind === 'model');

  const toggleContentLang = (l: AppLanguage) => {
    const next = s.contentLanguages.includes(l) ? s.contentLanguages.filter((x) => x !== l) : [...s.contentLanguages, l];
    if (next.length) s.setContentLanguages(next);
  };

  const confirm = (title: string, size: number, onDelete: () => void) =>
    Alert.alert(title, t('deleteConfirm', { title, size: formatBytes(size, undefined, lang) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: onDelete },
    ]);
  const deleteItem = (item: InstalledItem) => confirm(item.title, item.sizeBytes, () => void removeItem(item.id));
  const deleteCountry = (c: CountryState) => confirm(c.title, c.sizeBytes, () => void removeCountry(c));
  const trash = <Trash2 size={18} color={colors.textTertiary} />;

  return (
    <Screen>
      <SectionHeader title={t('general')} style={{ marginTop: space.sm }} />
      <ListGroup>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text variant="headline">{t('language')}</Text>
          <Segmented<AppLanguage>
            value={s.language}
            onChange={s.setLanguage}
            options={[
              { value: 'es', label: 'Español' },
              { value: 'en', label: 'English' },
            ]}
          />
        </View>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text variant="headline">{t('theme')}</Text>
          <Segmented<ThemePreference>
            value={s.theme}
            onChange={s.setTheme}
            options={[
              { value: 'system', label: t('themeSystem') },
              { value: 'light', label: t('themeLight') },
              { value: 'dark', label: t('themeDark') },
            ]}
          />
        </View>
        <ListRow
          testID="settings-country"
          title={t('country')}
          subtitle={region ? regionName(region, i18n.language) : t('countryNone')}
          chevron
          onPress={() => router.push('/settings/country')}
        />
        <ListRow
          title={t('wifiOnly')}
          subtitle={t('wifiOnlyBody')}
          trailing={<Switch value={s.wifiOnly} onValueChange={s.setWifiOnly} accessibilityLabel={t('wifiOnly')} />}
        />
      </ListGroup>

      <SectionHeader title={t('storage')} />
      <ListGroup>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="headline">{t('storageUsed')}</Text>
            <Text variant="headline" tabular>
              {formatBytes(used, undefined, lang)}
            </Text>
          </Row>
          <ProgressBar value={total ? (total - free) / total : 0} />
          <Text variant="footnote" color="textSecondary" tabular>
            {t('storageFree')}: {formatBytes(free, undefined, lang)}
          </Text>
        </View>
        {countries.map((c) => (
          <ListRow
            key={c.regionId}
            title={c.title}
            subtitle={`${t('countryKind')} · ${formatBytes(c.sizeBytes, undefined, lang)}`}
            leading={<IconBadge icon={Map} hue="maps" size={36} />}
            trailing={trash}
            accessibilityHint={t('deleteHint')}
            onPress={() => deleteCountry(c)}
          />
        ))}
        {[...otherMaps, ...zims, ...models].map((item) => (
          <ListRow
            key={item.id}
            title={item.title}
            subtitle={`${t(`kind.${item.kind}`)} · ${formatBytes(item.sizeBytes, undefined, lang)}`}
            leading={
              <IconBadge
                icon={item.kind === 'map' ? Map : item.kind === 'model' ? Sparkles : item.isCourse ? GraduationCap : Database}
                hue={item.kind === 'map' ? 'maps' : item.kind === 'model' ? 'ai' : item.isCourse ? 'education' : 'reference'}
                size={36}
              />
            }
            trailing={trash}
            accessibilityHint={t('deleteHint')}
            onPress={() => deleteItem(item)}
          />
        ))}
      </ListGroup>

      <SectionHeader title={t('advanced')} />
      <ListGroup>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Text variant="headline">{t('contentLanguages')}</Text>
          <Text variant="footnote" color="textSecondary">
            {t('contentLanguagesBody')}
          </Text>
          <Row style={{ marginTop: space.xs }}>
            {(['es', 'en'] as AppLanguage[]).map((l) => (
              <Chip key={l} label={tc(`language.${l}`)} selected={s.contentLanguages.includes(l)} onPress={() => toggleContentLang(l)} />
            ))}
          </Row>
        </View>
        <ListRow
          title={t('clearHistory')}
          leading={<IconBadge icon={Trash2} hue="medicine" size={36} />}
          onPress={() => {
            clearHistory();
            Alert.alert(t('historyCleared'));
          }}
        />
      </ListGroup>

      <SectionHeader title={t('about')} />
      <ListGroup>
        <ListRow title={t('setupAgain')} leading={<IconBadge icon={Wand2} hue="survival" size={36} />} chevron onPress={() => router.push('/onboarding')} />
        <ListRow
          title={t('privacy')}
          leading={<IconBadge icon={ShieldCheck} hue="reference" size={36} />}
          chevron
          onPress={() => WebBrowser.openBrowserAsync(`${PRIVACY_URL}${s.language === 'en' ? '#en' : ''}`)}
        />
        <ListRow
          testID="settings-credits"
          title={t('credits')}
          leading={<IconBadge icon={Scale} hue="reference" size={36} />}
          chevron
          onPress={() => router.push('/settings/credits')}
        />
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Text variant="footnote" color="textSecondary">
            {t('aboutBody')}
          </Text>
          <Text variant="caption" color="textTertiary">
            {t('version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
          </Text>
        </View>
      </ListGroup>
    </Screen>
  );
}
