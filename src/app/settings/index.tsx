import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Database, GraduationCap, Map, ShieldCheck, Sparkles, Trash2, Wand2, type LucideIcon } from 'lucide-react-native';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, IconBadge, ListGroup, ListRow, ProgressBar, Row, Screen, SectionHeader, Segmented, Switch, Text } from '@/components/ui';
import { removeItem, useItems, type InstalledItem } from '@/features/content/items';
import { clearHistory } from '@/features/library/history';
import type { AppLanguage } from '@/i18n';
import { formatBytes } from '@/lib/format';
import type { ContentKind } from '@/lib/storage';
import { freeBytes, totalBytes } from '@/lib/storage';
import { useSettings, type ThemePreference } from '@/stores/settings';
import { space, useTheme, type Hue } from '@/theme';

const PRIVACY_URL = 'https://franlindebl.github.io/nomad-pocket/privacy.html';

const KIND_META: Record<ContentKind, { icon: LucideIcon; hue: Hue }> = {
  zim: { icon: Database, hue: 'reference' },
  map: { icon: Map, hue: 'maps' },
  model: { icon: Sparkles, hue: 'ai' },
};

export default function SettingsScreen() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const s = useSettings();
  const items = useItems();
  const used = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const free = freeBytes();
  const total = totalBytes();

  const toggleContentLang = (l: AppLanguage) => {
    const next = s.contentLanguages.includes(l) ? s.contentLanguages.filter((x) => x !== l) : [...s.contentLanguages, l];
    if (next.length) s.setContentLanguages(next);
  };

  const confirmDelete = (item: InstalledItem) =>
    Alert.alert(item.title, t('deleteConfirm', { title: item.title, size: formatBytes(item.sizeBytes) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);

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
      </ListGroup>

      <SectionHeader title={t('downloads')} />
      <ListGroup>
        <ListRow title={t('wifiOnly')} subtitle={t('wifiOnlyBody')} trailing={<Switch value={s.wifiOnly} onValueChange={s.setWifiOnly} />} />
      </ListGroup>

      <SectionHeader title={t('storage')} />
      <ListGroup>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="headline">{t('storageUsed')}</Text>
            <Text variant="headline" tabular>
              {formatBytes(used)}
            </Text>
          </Row>
          <ProgressBar value={total ? (total - free) / total : 0} />
          <Text variant="footnote" color="textSecondary" tabular>
            {t('storageFree')}: {formatBytes(free)}
          </Text>
        </View>
        {items.map((item) => {
          const meta = KIND_META[item.kind];
          return (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={`${t(`kind.${item.kind}`)} · ${formatBytes(item.sizeBytes)}`}
              leading={<IconBadge icon={item.isCourse ? GraduationCap : meta.icon} hue={item.isCourse ? 'education' : meta.hue} size={36} />}
              trailing={<Trash2 size={18} color={colors.textTertiary} />}
              onPress={() => confirmDelete(item)}
            />
          );
        })}
      </ListGroup>

      <SectionHeader title={t('about')} />
      <ListGroup>
        <ListRow
          title={t('setupAgain')}
          leading={<IconBadge icon={Wand2} hue="survival" size={36} />}
          chevron
          onPress={() => router.push('/onboarding')}
        />
        <ListRow
          title={t('clearHistory')}
          leading={<IconBadge icon={Trash2} hue="medicine" size={36} />}
          onPress={() => {
            clearHistory();
            Alert.alert(t('historyCleared'));
          }}
        />
        <ListRow
          title={t('privacy')}
          leading={<IconBadge icon={ShieldCheck} hue="reference" size={36} />}
          chevron
          onPress={() => WebBrowser.openBrowserAsync(`${PRIVACY_URL}${s.language === 'en' ? '#en' : ''}`)}
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
