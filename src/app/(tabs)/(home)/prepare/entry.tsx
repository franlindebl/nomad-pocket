import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type KeyboardTypeOptions, type TextInputProps } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { Field, SheetHeader } from '@/features/prepare/components';
import { usePrepare } from '@/features/prepare/store';
import type { EntryKind, EntryOf } from '@/features/prepare/types';
import { uid } from '@/lib/format';
import { space } from '@/theme';

type FieldDef = { key: string; multiline?: boolean; keyboardType?: KeyboardTypeOptions; autoCapitalize?: TextInputProps['autoCapitalize'] };

// The first field names the entry and is required.
const FIELDS: Record<EntryKind, FieldDef[]> = {
  contact: [
    { key: 'name', autoCapitalize: 'words' },
    { key: 'relation' },
    { key: 'phone', keyboardType: 'phone-pad' },
    { key: 'note', multiline: true },
  ],
  number: [{ key: 'label' }, { key: 'value' }, { key: 'note', multiline: true }],
  person: [
    { key: 'name', autoCapitalize: 'words' },
    { key: 'medications', multiline: true },
    { key: 'allergies' },
    { key: 'bloodType', autoCapitalize: 'characters' },
    { key: 'note', multiline: true },
  ],
};

const LIST = { contact: 'contacts', number: 'numbers', person: 'people' } as const;

export default function EntrySheet() {
  const { t } = useTranslation('prepare');
  const { t: tc } = useTranslation();
  const params = useLocalSearchParams<{ kind: EntryKind; id?: string }>();
  // Own keys only: a deep link with kind=constructor or __proto__ must not reach FIELDS' prototype.
  const kind: EntryKind = typeof params.kind === 'string' && Object.hasOwn(FIELDS, params.kind) ? params.kind : 'contact';
  const fields = FIELDS[kind];
  const existing = usePrepare((s) => (s[LIST[kind]] as { id: string }[]).find((e) => e.id === params.id)) as
    Record<string, string> | undefined;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, existing?.[f.key] ?? ''])),
  );
  const [missing, setMissing] = useState(false);

  const titles: Record<EntryKind, [string, string]> = {
    contact: [t('entry.newContact'), t('entry.editContact')],
    number: [t('entry.newNumber'), t('entry.editNumber')],
    person: [t('entry.newPerson'), t('entry.editPerson')],
  };

  const save = () => {
    const clean = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]));
    if (!clean[fields[0].key]) {
      setMissing(true);
      return;
    }
    usePrepare.getState().saveEntry(kind, { ...clean, id: existing?.id ?? uid() } as EntryOf<typeof kind>);
    router.back();
  };

  // No automaticallyAdjustKeyboardInsets here: in a form sheet it opens scrolled under the native
  // header (first field hidden until dragged). These short forms fit above the keyboard.
  return (
    <Screen contentStyle={{ gap: space.lg, paddingTop: space.lg }}>
      <SheetHeader title={titles[kind][existing ? 1 : 0]} onSave={save} saveTestID="entry-save" />
      {fields.map((f, i) => (
        <Field
          key={f.key}
          testID={`entry-${f.key}`}
          label={t(`fields.${kind}.${f.key}`)}
          placeholder={t(`fields.${kind}.${f.key}Placeholder`)}
          value={values[f.key]}
          onChangeText={(v) => {
            setValues((s) => ({ ...s, [f.key]: v }));
            if (i === 0) setMissing(false);
          }}
          autoFocus={!existing && i === 0}
          multiline={f.multiline}
          keyboardType={f.keyboardType}
          autoCapitalize={f.autoCapitalize ?? 'sentences'}
          returnKeyType={f.multiline ? 'default' : 'next'}
        />
      ))}
      {missing ? (
        <Text variant="footnote" color="danger">
          {t('entry.required')}
        </Text>
      ) : null}
      {existing ? (
        <Button
          title={tc('actions.delete')}
          variant="danger"
          fullWidth
          onPress={() => {
            usePrepare.getState().removeEntry(kind, existing.id);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}
