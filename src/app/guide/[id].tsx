import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Badge, Card, ListGroup, ListRow, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { Markdown } from '@/features/assistant/ui/Markdown';
import { getGuideCard } from '@/features/guide/guide';
import { cardBody, cardNotes, provenance } from '@/features/guide/guide-core';
import { useEmergencyNumber } from '@/features/maps/emergency';
import { space, useTheme } from '@/theme';

/** One card of the emergency guide: its text as the source has it (the local number for a US 911), the notes of ours outside it, and where it comes from. */
export default function GuideCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation('guide');
  const { colors } = useTheme();
  const { number, country } = useEmergencyNumber();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const card = getGuideCard(id);
  if (!card) return <Stack.Screen options={{ title: '' }} />;
  const text = card[lang];
  const notes = cardNotes(card, lang, number, country);
  const notice =
    text.kind === 'own' ? t('ownNotice') : text.kind === 'translation' ? t(text.translatedFrom === 'es' ? 'translationNoticeEs' : 'translationNotice') : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: text.title }} />
      {card.vital ? (
        <View style={{ alignSelf: 'flex-start', marginBottom: space.md }}>
          <Badge label={t('vital')} tone="danger" />
        </View>
      ) : null}
      <Markdown text={cardBody(card, lang, number)} />

      {notes.length ? (
        <Card style={{ marginTop: space.xl, gap: space.sm }} testID="guide-notes">
          <Row gap={space.sm}>
            <Info size={16} color={colors.accent} />
            <Text variant="footnote" weight="600" color="textSecondary">
              {t('noteBy')}
            </Text>
          </Row>
          {notes.map((n) => (
            <Text key={n} variant="callout">
              {n}
            </Text>
          ))}
        </Card>
      ) : null}

      <SectionHeader title={t('source')} />
      <View style={{ gap: space.sm }}>
        {notice ? (
          <Text variant="footnote" weight="600">
            {notice}
          </Text>
        ) : null}
        <Text variant="footnote" color="textSecondary" selectable>
          {provenance(text, lang)}
        </Text>
        {text.sources.map((s) => (
          <Text key={s.url} variant="caption" color="textTertiary" selectable>
            {s.url}
          </Text>
        ))}
        <Text variant="caption" color="textSecondary" selectable>
          {t('licence')}: {text.licence}
        </Text>
      </View>

      {card.see.length ? (
        <>
          <SectionHeader title={t('related')} />
          <ListGroup>
            {card.see.flatMap((sid) => {
              const other = getGuideCard(sid);
              return other
                ? [<ListRow key={sid} title={other[lang].title} chevron onPress={() => router.push({ pathname: '/guide/[id]', params: { id: sid } })} />]
                : [];
            })}
          </ListGroup>
        </>
      ) : null}
    </Screen>
  );
}
