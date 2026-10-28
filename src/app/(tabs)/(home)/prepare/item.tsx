import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button, ListGroup, Row, Screen, Switch, Text } from '@/components/ui';
import { Field, MonthPicker, SheetHeader } from '@/features/prepare/components';
import { addMonths, formatMonth, KIT, monthOf, reminderDate } from '@/features/prepare/kit';
import { removeCustomItem, setExpiry } from '@/features/prepare/reminders';
import { getKitEntry, usePrepare } from '@/features/prepare/store';
import { uid } from '@/lib/format';
import { space } from '@/theme';

export default function KitItemSheet() {
  const { t, i18n } = useTranslation('prepare');
  const { t: tc } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const def = KIT.find((d) => d.id === params.id) ?? null;
  const custom = usePrepare((s) => s.custom.find((c) => c.id === params.id)) ?? null;
  const isNew = !def && !custom;
  const entry = params.id ? getKitEntry(params.id) : null;

  const [name, setName] = useState(custom?.name ?? '');
  const [have, setHave] = useState(entry?.have ?? isNew);
  const [expires, setExpires] = useState<string | null>(entry?.expires ?? null);
  const [note, setNote] = useState(entry?.note ?? '');

  const title = def ? t(`kit.items.${def.id}.title`) : custom?.name || t('item.new');
  const reminderAt = expires ? reminderDate(expires, new Date()) : null;

  const save = async () => {
    const finalName = name.trim();
    if (!def && !finalName) return;
    const { setKitEntry, addCustom, renameCustom } = usePrepare.getState();
    const id = def?.id ?? custom?.id ?? `custom-${uid()}`;
    if (isNew) addCustom(id, finalName);
    else if (custom && finalName !== custom.name) renameCustom(id, finalName);
    setKitEntry(id, { have, note: note.trim() });
    router.back();
    if (expires !== (entry?.expires ?? null)) {
      const allowed = await setExpiry(id, expires);
      if (!allowed) Alert.alert(t('item.expiry'), t('item.notificationsOff'));
    }
  };

  // No automaticallyAdjustKeyboardInsets here: in a form sheet it opens scrolled under the native
  // header (first field hidden until dragged). These short forms fit above the keyboard.
  return (
    <Screen contentStyle={{ gap: space.lg, paddingTop: space.lg }}>
      <SheetHeader title={title} onSave={save} saveDisabled={!def && !name.trim()} saveTestID="item-save" />
      {def ? (
        <Text variant="callout" color="textSecondary">
          {t(`kit.items.${def.id}.hint`)}
        </Text>
      ) : (
        <Field
          testID="item-name"
          label={t('item.name')}
          placeholder={t('item.namePlaceholder')}
          value={name}
          onChangeText={setName}
          autoFocus={isNew}
        />
      )}

      <ListGroup>
        <Row style={{ paddingHorizontal: space.lg, minHeight: 52 }}>
          <Text variant="headline" style={{ flex: 1 }}>
            {t('item.have')}
          </Text>
          <Switch value={have} onValueChange={setHave} accessibilityLabel={t('item.have')} />
        </Row>
      </ListGroup>

      <View style={{ gap: space.sm }}>
        <Text variant="overline" color="textSecondary">
          {t('item.expiry')}
        </Text>
        {expires ? (
          <View style={{ gap: space.sm }}>
            <MonthPicker value={expires} onChange={setExpires} />
            {reminderAt ? (
              <Text variant="footnote" color="textSecondary" align="center">
                {t('item.reminder', { month: formatMonth(monthOf(reminderAt), i18n.language) })}
              </Text>
            ) : null}
            <Button
              title={t('item.removeExpiry')}
              variant="ghost"
              size="sm"
              onPress={() => setExpires(null)}
              style={{ alignSelf: 'center' }}
            />
          </View>
        ) : (
          <Button
            testID="item-add-expiry"
            title={t('item.addExpiry')}
            variant="secondary"
            onPress={() => setExpires(addMonths(monthOf(new Date()), 12))}
            fullWidth
          />
        )}
      </View>

      <Field label={t('item.note')} placeholder={t('item.notePlaceholder')} value={note} onChangeText={setNote} multiline />

      {custom ? (
        <Button
          title={tc('actions.delete')}
          variant="danger"
          fullWidth
          onPress={() => {
            void removeCustomItem(custom.id);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}
