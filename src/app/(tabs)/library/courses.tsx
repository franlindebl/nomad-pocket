import { useFocusEffect } from 'expo-router';
import { GraduationCap } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, Chip, IconBadge, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { catalog, courseResources, getResource, loc } from '@/features/catalog';
import { splitByLanguage, useOtherLanguage } from '@/features/catalog/editions';
import { iconByName } from '@/features/catalog/icons';
import { useItems } from '@/features/content/items';
import { CourseCard } from '@/features/courses/CourseCard';
import { useCollections } from '@/features/library/collections';
import { COURSES } from '@/features/library/collections-core';
import { CollectionCount } from '@/features/library/components/CollectionCount';
import { courseProgress, getCourse, useCourses } from '@/features/courses/courses';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

export default function CoursesScreen() {
  const { t } = useTranslation('courses');
  const langs = useSettings((s) => s.contentLanguages);
  const installed = useItems('zim').filter((i) => i.isCourse);
  const version = useCourses((s) => s.version);
  const [subject, setSubject] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const collection = useCollections().find((c) => c.key === COURSES);
  const other = useOtherLanguage();

  // Progress depends on reader history, which changes outside this screen.
  useFocusEffect(useCallback(() => setTick((n) => n + 1), []));
  void version;

  const available = courseResources(langs);
  const subjects = catalog.courseSubjects.filter((s) => available.some((r) => r.subject === s.slug));
  const filtered = subject ? available.filter((r) => r.subject === subject) : available;
  // The same course in another language goes last, under "Other languages" (features/catalog/editions.ts).
  const [notInstalled, otherLanguages] = splitByLanguage(
    filtered.filter((r) => !installed.some((i) => i.catalogId === r.id)),
    other,
  );

  return (
    <Screen title={t('common:tabs.courses')}>
      {collection ? <CollectionCount collection={collection} /> : null}
      <SectionHeader title={t('myCourses')} />
      {installed.length ? (
        <View style={{ gap: space.md }}>
          {installed.map((item) => {
            const resource = getResource(item.catalogId ?? item.id) ?? {
              id: item.id,
              title: { es: item.title, en: item.title },
              description: { es: item.description ?? '', en: item.description ?? '' },
              language: (item.language as 'es' | 'en') ?? 'en',
              url: '',
              sizeMB: item.sizeBytes / 1e6,
              version: item.version ?? '',
              category: 'courses',
              isCourse: true,
            };
            const course = getCourse(item.id);
            return <CourseCard key={item.id} resource={resource} progress={courseProgress(course)} lessons={course?.syllabus.length} wide />;
          })}
        </View>
      ) : (
        <Card style={styles.empty}>
          <IconBadge icon={GraduationCap} hue="education" size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">{t('myCoursesEmpty')}</Text>
            <Text variant="footnote" color="textSecondary">
              {t('myCoursesEmptyBody')}
            </Text>
          </View>
        </Card>
      )}

      <SectionHeader title={t('explore')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chips}>
        <Chip label={t('all')} selected={!subject} onPress={() => setSubject(null)} />
        {subjects.map((s) => (
          <Chip key={s.slug} label={loc(s.name)} icon={iconByName(s.icon)} selected={subject === s.slug} onPress={() => setSubject(s.slug)} />
        ))}
      </ScrollView>
      <Row style={{ flexWrap: 'wrap', marginTop: space.md }} gap={space.md} align="stretch">
        {notInstalled.map((r) => (
          <CourseCard key={r.id} resource={r} wide />
        ))}
      </Row>
      {otherLanguages.length ? (
        <>
          <SectionHeader title={t('library:otherLanguages')} />
          <Text variant="footnote" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
            {t('library:otherLanguagesBody')}
          </Text>
          <Row style={{ flexWrap: 'wrap', marginTop: space.md }} gap={space.md} align="stretch">
            {otherLanguages.map((r) => (
              <CourseCard key={r.id} resource={r} wide />
            ))}
          </Row>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  bleed: { marginHorizontal: -space.gutter },
  chips: { paddingHorizontal: space.gutter, gap: space.sm },
});
