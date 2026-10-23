import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, IconBadge, ProgressBar, Row, Text } from '@/components/ui';
import { catalog, loc, type CatalogResource } from '@/features/catalog';
import { DownloadButton, LanguageTag } from '@/features/catalog/DownloadButton';
import { iconByName } from '@/features/catalog/icons';
import { formatMB } from '@/lib/format';
import { radius, space, useTheme, type Hue } from '@/theme';

export function subjectOf(r: CatalogResource) {
  return catalog.courseSubjects.find((s) => s.slug === r.subject);
}

export function CourseCard({ resource, progress, lessons, wide }: { resource: CatalogResource; progress?: number; lessons?: number; wide?: boolean }) {
  const { t } = useTranslation('courses');
  const { hue } = useTheme();
  const subject = subjectOf(resource);
  const h = hue((subject?.hue ?? 'courses') as Hue);
  return (
    <Card
      padded={false}
      style={wide ? styles.wide : styles.card}
      onPress={() => router.push({ pathname: '/courses/[id]', params: { id: resource.id } })}
      accessibilityLabel={loc(resource.title)}>
      <View style={[styles.band, { backgroundColor: h.bg }]}>
        <IconBadge icon={iconByName(subject?.icon)} color={h.fg} size={44} />
        {subject ? (
          <Text variant="overline" tint={h.fg}>
            {loc(subject.name)}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <Row gap={6}>
          <Text variant="headline" numberOfLines={2} style={{ flexShrink: 1 }}>
            {loc(resource.title)}
          </Text>
          <LanguageTag language={resource.language} />
        </Row>
        <Text variant="footnote" color="textSecondary" numberOfLines={2}>
          {loc(resource.description)}
        </Text>
        {progress !== undefined ? (
          <View style={{ gap: 6, marginTop: space.xs }}>
            <ProgressBar value={progress} color={h.fg} />
            <Text variant="caption" color="textSecondary" tabular>
              {t('percent', { value: Math.round(progress * 100) })}
              {lessons ? ` · ${t('lessons', { count: lessons })}` : ''}
            </Text>
          </View>
        ) : (
          <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
            <Text variant="caption" color="textTertiary" tabular>
              {formatMB(resource.sizeMB)}
            </Text>
            <DownloadButton resource={resource} onOpen={() => router.push({ pathname: '/courses/[id]', params: { id: resource.id } })} />
          </Row>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: 240 },
  wide: { alignSelf: 'stretch' },
  band: { height: 96, padding: space.lg, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'flex-start', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  body: { padding: space.lg, gap: space.xs },
});
