import { getPermissionsAsync } from 'expo-notifications';
import { BellOff, LocateFixed, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View } from 'react-native';

import { Button, Card, EmptyState, ListGroup, Row, Screen, Text } from '@/components/ui';
import { runAlertsCheck } from '@/features/alerts/check';
import { AlertRow, AlertsDisclaimer, AlertsOffer, useAlertsView } from '@/features/alerts/components';
import { askLocationAgain, askNotificationsAgain } from '@/features/alerts/enable';
import { agoLabel, sourceName } from '@/features/alerts/present';
import { space, useTheme } from '@/theme';

function useNotificationsAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () =>
      void getPermissionsAsync().then(
        (p) => setAllowed(p.granted),
        () => setAllowed(null),
      );
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => sub.remove();
  }, []);
  return allowed;
}

/** Official alerts in force where the person is (docs/ALERTS_PLAN.md): the list, its freshness and the disclaimer. */
export default function AlertsScreen() {
  const { t } = useTranslation('alerts');
  const { colors } = useTheme();
  const { alerts, nearby, pos, sources, now, state } = useAlertsView();
  const allowed = useNotificationsAllowed();
  const [asking, setAsking] = useState(false);

  // Opening the list is a good moment for a fresh fix and check (check.ts skips it if one ran in the last minutes).
  useEffect(() => {
    if (state.enabled) void runAlertsCheck('foreground');
  }, [state.enabled]);

  if (!state.enabled) {
    return (
      <Screen>
        <EmptyState icon={ShieldCheck} hue="survival" title={t('list.off')} body={t('list.offBody')} />
        <AlertsOffer testID="alerts-list-offer" />
      </Screen>
    );
  }

  const names = sources.map(sourceName).join(', ');
  const failed = sources.filter((s) => state.cache.sources[s]?.error);
  const lastRun = state.runs[0];
  const status = state.checking
    ? t('list.checking')
    : state.cache.checkedAt
      ? t('list.updated', { ago: agoLabel(state.cache.checkedAt, now) })
      : t('list.never');

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="footnote" testID="alerts-status">
            {status}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('list.sources', { names })}
          </Text>
        </View>
        <Button
          testID="alerts-refresh"
          title={t('list.refresh')}
          icon={RefreshCw}
          size="sm"
          variant="secondary"
          disabled={state.checking}
          onPress={() => void runAlertsCheck('manual')}
        />
      </Row>

      {lastRun?.offline && !state.checking ? (
        <Text variant="footnote" color="warning" style={{ marginTop: space.sm }}>
          {t('list.offline')}
        </Text>
      ) : failed.length && !state.checking ? (
        <Text variant="footnote" color="warning" style={{ marginTop: space.sm }}>
          {t('list.failed', { names: failed.map(sourceName).join(', ') })}
        </Text>
      ) : null}

      {!pos ? (
        <Card style={{ marginTop: space.md, gap: space.sm }} testID="alerts-no-position">
          <Row gap={space.sm}>
            <LocateFixed size={18} color={colors.accent} />
            <Text variant="headline">{t('list.noPosition')}</Text>
          </Row>
          <Text variant="footnote" color="textSecondary">
            {t('list.noPositionBody')}
          </Text>
          <Button
            title={t('list.usePosition')}
            size="sm"
            loading={asking}
            onPress={async () => {
              setAsking(true);
              await askLocationAgain().finally(() => setAsking(false));
            }}
            style={{ alignSelf: 'flex-start' }}
          />
        </Card>
      ) : null}

      {allowed === false ? (
        <Card style={{ marginTop: space.md, gap: space.sm }} testID="alerts-no-notifications">
          <Row gap={space.sm}>
            <BellOff size={18} color={colors.warning} />
            <Text variant="headline">{t('list.noNotifications')}</Text>
          </Row>
          <Text variant="footnote" color="textSecondary">
            {t('list.noNotificationsBody')}
          </Text>
          <Button
            title={t('list.allowNotifications')}
            size="sm"
            variant="secondary"
            onPress={() => void askNotificationsAgain()}
            style={{ alignSelf: 'flex-start' }}
          />
        </Card>
      ) : null}

      {alerts.length ? (
        <ListGroup style={{ marginTop: space.lg }}>
          {alerts.map((a, i) => (
            <AlertRow key={`${a.source}:${a.id}`} alert={a} pos={pos} testID={`alert-row-${i}`} />
          ))}
        </ListGroup>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          hue="agriculture"
          title={t('list.empty')}
          body={nearby ? t('list.emptyBody', { names }) : undefined}
          style={{ paddingVertical: space.xxl }}
        />
      )}

      <View style={{ marginTop: space.xl, gap: space.md }}>
        <AlertsDisclaimer />
        <Text variant="caption" color="textTertiary">
          {t('list.credits')}
        </Text>
      </View>
    </Screen>
  );
}
