import * as Network from 'expo-network';
import { router } from 'expo-router';
import { CheckCircle2, Database, GraduationCap, Map, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, View } from 'react-native';

import { Button, Card, EmptyState, IconBadge, ListGroup, ListRow, ProgressBar, Row, Screen, Text } from '@/components/ui';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { retryCatalogs } from '@/features/maps/countries';
import {
  clearBlocked,
  dataDateLabel,
  deleteAndUpdate,
  fitsNow,
  startUpdate,
  updateAll,
  UpdatePreflightError,
  useUpdateRun,
  useUpdates,
  type UpdateEntry,
} from '@/features/updates/updates';
import { checkZimEditions, useZimEditions } from '@/features/updates/zim-check';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { space, useTheme } from '@/theme';

/** Newer versions of what is on the phone (docs/CONTENT_UPDATES_PLAN.md): one by one or all at once. */
export default function UpdatesScreen() {
  const { t, i18n } = useTranslation('updates');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const entries = useUpdates();
  const checkedAt = useZimEditions((s) => s.checkedAt);
  const checking = useZimEditions((s) => s.checking);
  const blocked = useUpdateRun((s) => s.blocked);
  const net = Network.useNetworkState();
  const online = net.isInternetReachable ?? net.isConnected ?? true;
  const lang = i18n.language;

  const startable = entries.filter((e) => !e.inFlight && !e.failed);
  const blockedHere = entries.filter((e) => blocked.includes(e.key) && !e.inFlight);

  const checkNow = () => {
    retryCatalogs();
    void checkZimEditions(true);
  };

  const showProblem = (e: unknown) => {
    if (e instanceof UpdatePreflightError) Alert.alert(tc('errors.generic'), t(`problem.${e.problem}`, { needed: formatBytes(e.needed, undefined, lang) }));
    else Alert.alert(tc('errors.generic'), String((e as Error)?.message ?? e));
  };

  const deleteFirst = (e: UpdateEntry) =>
    Alert.alert(t('deleteFirstTitle', { title: e.title }), t('deleteFirstBody', { size: formatBytes(e.bytes, undefined, lang) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      {
        text: t('deleteFirst'),
        style: 'destructive',
        onPress: () => {
          clearBlocked(e.key);
          deleteAndUpdate(e).catch(showProblem);
        },
      },
    ]);

  const noRoom = (e: UpdateEntry) =>
    Alert.alert(
      t('noRoomTitle', { title: e.title }),
      t('noRoomBody', { needed: formatBytes(e.needed, undefined, lang), free: formatBytes(freeBytes(), undefined, lang) }),
      [
        { text: tc('actions.cancel'), style: 'cancel' },
        { text: t('freeSpace'), onPress: () => router.push('/settings') },
        { text: t('deleteFirst'), style: 'destructive', onPress: () => deleteFirst(e) },
      ],
    );

  const act = (e: UpdateEntry) => {
    if (e.inFlight) return;
    if (e.failed) {
      router.push('/downloads');
      return;
    }
    if (!fitsNow(e)) {
      noRoom(e);
      return;
    }
    try {
      startUpdate(e);
      clearBlocked(e.key);
    } catch (err) {
      if (err instanceof NotEnoughStorageError) noRoom(e);
      else showProblem(err);
    }
  };

  const subtitle = (e: UpdateEntry) => {
    if (e.inFlight) return t('updating', { pct: Math.round((e.progress ?? 0) * 100) });
    if (e.failed) return t('failed');
    const size = formatBytes(e.bytes, undefined, lang);
    const from = dataDateLabel(e.installed, lang);
    const to = dataDateLabel(e.latest, lang);
    const what = from && to ? t('row', { from, to, size }) : t('rowNoDate', { size });
    const kind = e.kind === 'country' ? t('kindCountry') : e.isCourse ? t('kindCourse') : null;
    const note = e.broken ? t('broken') : !fitsNow(e) ? t('noRoom') : null;
    return [[kind, what].filter(Boolean).join(' · '), note].filter(Boolean).join('\n');
  };

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      {/* Android form sheets have no native header. */}
      {Platform.OS === 'android' ? (
        <Text variant="title2" style={{ marginBottom: space.lg }}>
          {t('title')}
        </Text>
      ) : null}
      <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs, marginBottom: space.md }}>
        {t('intro')}
      </Text>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.xs, marginBottom: space.lg }}>
        <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} testID="updates-checked">
          {checking ? t('checking') : checkedAt ? t('checkedAt', { when: formatRelativeDate(checkedAt) }) : t('neverChecked')}
        </Text>
        <Button testID="updates-check" title={t('checkNow')} size="sm" variant="secondary" loading={checking} disabled={!online || checking} onPress={checkNow} />
      </Row>

      {entries.length === 0 ? (
        <EmptyState icon={CheckCircle2} hue="survival" title={t('empty')} body={t('emptyBody')} />
      ) : (
        <>
          {blockedHere.length ? (
            <Card style={{ marginBottom: space.md }} testID="updates-blocked">
              <Text variant="footnote" color="textSecondary">
                {t('blocked', { count: blockedHere.length })}
              </Text>
            </Card>
          ) : null}
          <ListGroup>
            {entries.map((e) => (
              <ListRow
                key={e.key}
                testID="update-row"
                title={e.title}
                subtitle={subtitle(e)}
                subtitleLines={3}
                leading={
                  <IconBadge
                    icon={e.kind === 'country' ? Map : e.isCourse ? GraduationCap : Database}
                    hue={e.kind === 'country' ? 'maps' : e.isCourse ? 'education' : 'reference'}
                    size={36}
                  />
                }
                trailing={
                  e.inFlight ? (
                    <ProgressBar value={e.progress ?? 0} style={{ width: 48 }} />
                  ) : (
                    <RefreshCw size={18} color={e.broken || e.urgent ? colors.warning : colors.accent} />
                  )
                }
                accessibilityHint={e.inFlight ? undefined : t('update')}
                onPress={e.inFlight ? undefined : () => act(e)}
              />
            ))}
          </ListGroup>
          {startable.length > 1 ? (
            <View style={{ marginTop: space.lg }}>
              <Button
                testID="updates-all"
                title={t('updateAll', { size: formatBytes(startable.reduce((sum, e) => sum + e.bytes, 0), undefined, lang) })}
                icon={RefreshCw}
                fullWidth
                disabled={!online}
                onPress={() => updateAll(startable)}
              />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
