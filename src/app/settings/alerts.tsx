import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ListGroup, ListRow, Screen, SectionHeader, Segmented, Switch, Text } from '@/components/ui';
import type { Level } from '@/features/alerts/alerts-core';
import { AlertsDisclaimer, useAlertsView } from '@/features/alerts/components';
import { disableAlerts, enableAlerts } from '@/features/alerts/enable';
import { agoLabel, formatWhen, sourceName } from '@/features/alerts/present';
import { pushActive } from '@/features/alerts/push-register';
import { savePrefs, type Run } from '@/features/alerts/state';
import { space } from '@/theme';

/** Settings › Official alerts: the switch, what notifies, the position used, the sources, instant alerts, recent checks. */
export default function AlertsSettingsScreen() {
  const { t } = useTranslation('alerts');
  const { pos, sources, now, state } = useAlertsView();
  const [busy, setBusy] = useState(false);
  // Re-read each render (the minute clock re-renders): fresh registration and a healthy server.
  const instant = !!state.push && pushActive(now);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await enableAlerts();
      else await disableAlerts();
    } finally {
      setBusy(false);
    }
  };

  const runLine = (r: Run) =>
    [
      t(`settings.trigger.${r.trigger}`),
      r.offline ? t('settings.runOffline') : t('settings.runOk', { count: r.ok.length }),
      r.failed.length ? t('settings.runFailed', { names: r.failed.map(sourceName).join(', ') }) : '',
      r.notified ? t('settings.runNotified', { count: r.notified }) : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen>
      <ListGroup>
        <ListRow
          title={t('settings.enabled')}
          subtitle={t('settings.enabledBody')}
          subtitleLines={4}
          trailing={
            <Switch
              value={state.enabled}
              onValueChange={(v) => !busy && void toggle(v)}
              accessibilityLabel={t('settings.enabled')}
              testID="alerts-settings-switch"
            />
          }
        />
      </ListGroup>

      {state.enabled ? (
        <>
          <SectionHeader title={t('settings.level')} />
          <ListGroup>
            <View style={{ padding: space.lg, gap: space.md }}>
              <Segmented<Level>
                value={state.prefs.minLevel}
                onChange={(minLevel) => savePrefs({ minLevel })}
                options={[
                  { value: 'yellow', label: t('levelChip.yellow') },
                  { value: 'orange', label: t('levelChip.orange') },
                  { value: 'red', label: t('levelChip.red') },
                ]}
              />
              <Text variant="footnote" color="textSecondary">
                {t('settings.levelBody')}
              </Text>
            </View>
            <ListRow
              title={t('settings.quakes')}
              subtitle={t('settings.quakesBody')}
              subtitleLines={3}
              trailing={
                <Switch
                  value={state.prefs.quakes}
                  onValueChange={(quakes) => savePrefs({ quakes })}
                  accessibilityLabel={t('settings.quakes')}
                />
              }
            />
          </ListGroup>

          <SectionHeader title={t('settings.position')} />
          <ListGroup>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Text variant="headline">
                {pos && state.position ? t('settings.positionAt', { ago: agoLabel(state.position.at, now) }) : t('settings.positionNone')}
              </Text>
              <Text variant="footnote" color="textSecondary">
                {t('settings.positionBody')}
              </Text>
            </View>
          </ListGroup>

          <SectionHeader title={t('settings.sources')} />
          <ListGroup>
            {sources.map((s) => {
              const c = state.cache.sources[s];
              return (
                <ListRow
                  key={s}
                  title={sourceName(s)}
                  subtitle={c?.error ? c.error : c?.fetchedAt ? t('list.updated', { ago: agoLabel(c.fetchedAt, now) }) : t('list.never')}
                />
              );
            })}
          </ListGroup>

          <SectionHeader title={t('settings.push')} />
          <ListGroup>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Text variant="headline">{instant ? t('settings.pushOn') : t('settings.pushOff')}</Text>
              <Text variant="footnote" color="textSecondary">
                {instant ? t('settings.pushOnBody') : t('settings.backgroundBody')}
              </Text>
            </View>
          </ListGroup>

          <SectionHeader title={t('settings.runs')} />
          <ListGroup>
            {state.runs.length ? (
              state.runs
                .slice(0, 12)
                .map((r) => <ListRow key={`${r.at}-${r.trigger}`} title={formatWhen(r.at, now)} subtitle={runLine(r)} />)
            ) : (
              <View style={{ padding: space.lg }}>
                <Text variant="footnote" color="textSecondary">
                  {t('settings.runsEmpty')}
                </Text>
              </View>
            )}
          </ListGroup>
        </>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <AlertsDisclaimer />
      </View>
    </Screen>
  );
}
