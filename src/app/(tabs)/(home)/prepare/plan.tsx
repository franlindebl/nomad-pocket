import { router } from 'expo-router';
import { HeartPulse, MapPin, Phone, Plus, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { IconBadge, IconButton, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { callPhones } from '@/features/maps/call';
import { Field } from '@/features/prepare/components';
import { usePrepare } from '@/features/prepare/store';
import type { EntryKind, MeetingSlot } from '@/features/prepare/types';
import { HEALTH_FEATURES } from '@/lib/health';
import { space, useTheme } from '@/theme';

function AddRow({ title, onPress, testID }: { title: string; onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <ListRow testID={testID} title={title} leading={<Plus size={20} color={colors.accent} />} onPress={onPress} style={{ minHeight: 48 }} />
  );
}

function Footer({ children }: { children: string }) {
  return (
    <Text variant="footnote" color="textSecondary" style={{ marginTop: space.sm, paddingHorizontal: space.xs }}>
      {children}
    </Text>
  );
}

const openEntry = (kind: EntryKind, id?: string) => router.push({ pathname: '/prepare/entry', params: id ? { kind, id } : { kind } });

export default function PlanScreen() {
  const { t } = useTranslation('prepare');
  const { colors } = useTheme();
  const { meeting, contacts, numbers, people, homeNotes, setHomeNotes } = usePrepare();

  const slot = (s: MeetingSlot, icon: LucideIcon) => {
    const point = meeting[s];
    return (
      <ListRow
        key={s}
        testID={`meeting-${s}`}
        title={t(`meeting.${s}`)}
        subtitle={point ? [point.place, point.details].filter(Boolean).join(' · ') : t(`meeting.${s}Hint`)}
        leading={<IconBadge icon={icon} hue={point ? 'maps' : 'neutral'} size={36} />}
        trailing={
          point ? null : (
            <Text variant="footnote" color="textTertiary">
              {t('meeting.notSet')}
            </Text>
          )
        }
        chevron
        onPress={() => router.push({ pathname: '/prepare/meeting', params: { slot: s } })}
      />
    );
  };

  return (
    <Screen automaticallyAdjustKeyboardInsets>
      <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
        {t('plan.intro')}
      </Text>

      <SectionHeader title={t('plan.meeting')} />
      <ListGroup>{[slot('primary', MapPin), slot('secondary', MapPin)]}</ListGroup>

      <SectionHeader title={t('plan.contacts')} />
      <ListGroup>
        {contacts.map((c, i) => (
          <ListRow
            key={c.id}
            title={c.name}
            subtitle={[c.relation, c.phone].filter(Boolean).join(' · ') || undefined}
            chevron={!c.phone}
            onPress={() => openEntry('contact', c.id)}
            trailingAction={
              c.phone ? (
                <IconButton
                  testID={`call-contact-${i}`}
                  icon={Phone}
                  size={36}
                  color={colors.success}
                  accessibilityLabel={t('plan.call', { name: c.name })}
                  onPress={() => callPhones(c.phone)}
                />
              ) : undefined
            }
          />
        ))}
        <AddRow testID="add-contact" title={t('plan.addContact')} onPress={() => openEntry('contact')} />
      </ListGroup>

      <SectionHeader title={t('plan.numbers')} />
      <ListGroup>
        {numbers.map((n) => (
          <ListRow key={n.id} title={n.label} subtitle={n.value || undefined} chevron onPress={() => openEntry('number', n.id)} />
        ))}
        <AddRow testID="add-number" title={t('plan.addNumber')} onPress={() => openEntry('number')} />
      </ListGroup>
      <Footer>{t('plan.numbersFooter')}</Footer>

      {/* Each person's medication, allergies and blood type: health data, not in builds without health features. */}
      {HEALTH_FEATURES ? (
        <>
          <SectionHeader title={t('plan.people')} />
          <ListGroup>
            {people.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={[p.medications, p.allergies, p.bloodType].filter(Boolean).join(' · ') || undefined}
                leading={<IconBadge icon={HeartPulse} hue="medicine" size={36} />}
                chevron
                onPress={() => openEntry('person', p.id)}
              />
            ))}
            <AddRow testID="add-person" title={t('plan.addPerson')} onPress={() => openEntry('person')} />
          </ListGroup>
          <Footer>{t('plan.peopleFooter')}</Footer>
        </>
      ) : null}

      <SectionHeader title={t('plan.homeNotes')} />
      <Field
        testID="home-notes"
        accessibilityLabel={t('plan.homeNotes')}
        value={homeNotes}
        onChangeText={setHomeNotes}
        placeholder={t('plan.homeNotesEmpty')}
        multiline
      />
    </Screen>
  );
}
