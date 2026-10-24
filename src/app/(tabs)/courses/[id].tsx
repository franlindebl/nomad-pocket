import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BookOpen, Check, Circle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, IconBadge, ListGroup, PressableScale, ProgressBar, ProgressRing, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { getResource, loc } from '@/features/catalog';
import { startResourceDownload, useResourceState } from '@/features/catalog/DownloadButton';
import { iconByName } from '@/features/catalog/icons';
import { subjectOf } from '@/features/courses/CourseCard';
import { courseProgress, ensureCourse, getCourse, nextLesson, recordCourseOpen, resetCourse, setLessonDone, useCourses, type CourseState, type Lesson } from '@/features/courses/courses';
import { cancelDownload } from '@/features/downloads/manager';
import { formatMB, formatRelativeDate } from '@/lib/format';
import { space, useTheme, type Hue } from '@/theme';

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('courses');
  const { t: tc } = useTranslation();
  const { colors, hue } = useTheme();
  const insets = useSafeAreaInsets();
  const resource = getResource(id);
  const { installed, download } = useResourceState(id);
  const itemId = installed?.id;
  const version = useCourses((s) => s.version);
  const [course, setCourse] = useState<CourseState | null>(null);
  const [building, setBuilding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!itemId) return;
      let alive = true;
      setBuilding(true);
      ensureCourse(itemId)
        .then((c) => alive && setCourse(c))
        .finally(() => alive && setBuilding(false));
      return () => {
        alive = false;
      };
    }, [itemId]),
  );

  // Progress changes (lesson marks, reset) re-read the stored course state.
  useEffect(() => {
    if (itemId && version) setCourse(getCourse(itemId));
  }, [itemId, version]);
  useFocusEffect(
    useCallback(() => {
      if (itemId) setCourse((c) => (c ? getCourse(itemId) : c));
    }, [itemId]),
  );

  const title = resource ? loc(resource.title) : (installed?.title ?? '');
  const subject = resource ? subjectOf(resource) : undefined;
  const h = hue((subject?.hue ?? 'courses') as Hue);
  const progress = courseProgress(course);

  const open = (lesson: Lesson | null) => {
    if (!itemId) return;
    if (lesson) recordCourseOpen(itemId, lesson.path, lesson.title);
    router.push({ pathname: '/reader/[itemId]', params: lesson ? { itemId, path: lesson.path } : { itemId } });
  };

  const next = course ? nextLesson(course) : null;
  const active = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);

  return (
    <Screen contentStyle={{ paddingTop: insets.top + 56 }} contentInsetAdjustmentBehavior="never">
      <View style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <IconBadge icon={iconByName(subject?.icon)} color={h.fg} size={64} />
          {installed && course?.syllabus.length ? (
            <ProgressRing value={progress} size={64} stroke={6} color={h.fg}>
              <Text variant="footnote" weight="700" tabular>
                {Math.round(progress * 100)}%
              </Text>
            </ProgressRing>
          ) : null}
        </Row>
        {subject ? (
          <Text variant="overline" tint={h.fg}>
            {loc(subject.name)}
          </Text>
        ) : null}
        <Text variant="title1">{title}</Text>
        {resource ? (
          <Text variant="body" color="textSecondary">
            {loc(resource.description)}
          </Text>
        ) : null}
        <Row gap={6}>
          {resource ? <Badge label={tc(`language.${resource.language}`)} /> : null}
          {resource ? <Badge label={formatMB(resource.sizeMB)} /> : null}
          {course?.syllabus.length ? <Badge label={t('lessons', { count: course.syllabus.length })} /> : null}
        </Row>
      </View>

      <View style={{ marginTop: space.xl, gap: space.sm }}>
        {installed ? (
          <>
            {progress >= 1 ? <Badge label={t('completed')} tone="success" icon={Check} /> : null}
            <Button
              title={course?.completed.size ? t('continue') : t('start')}
              size="lg"
              fullWidth
              onPress={() => open(next)}
            />
            {next && course?.completed.size ? (
              <Text variant="footnote" color="textSecondary" align="center" numberOfLines={1}>
                {t('next', { title: next.title })}
              </Text>
            ) : null}
            {course?.lastOpenedAt ? (
              <Text variant="caption" color="textTertiary" align="center">
                {t('lastOpened', { when: formatRelativeDate(course.lastOpenedAt) })}
              </Text>
            ) : null}
          </>
        ) : active && download ? (
          <Card style={{ gap: space.sm }}>
            <ProgressBar value={download.totalBytes ? download.bytesWritten / download.totalBytes : 0} color={h.fg} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" color="textSecondary">
                {tc(`status.${download.status}`)}
              </Text>
              {download.status !== 'processing' ? (
                <Button title={tc('actions.cancel')} variant="ghost" size="sm" onPress={() => cancelDownload(id)} />
              ) : null}
            </Row>
          </Card>
        ) : resource ? (
          <>
            <Button
              title={tc('actions.downloadSize', { size: formatMB(resource.sizeMB) })}
              size="lg"
              fullWidth
              onPress={() => startResourceDownload(resource, tc)}
            />
            <Text variant="footnote" color="textSecondary" align="center">
              {t('downloadToStart')}
            </Text>
          </>
        ) : null}
      </View>

      {installed ? (
        <>
          <SectionHeader
            title={t('syllabus')}
            action={course?.completed.size ? t('reset') : undefined}
            onAction={() =>
              Alert.alert(t('reset'), t('resetConfirm'), [
                { text: tc('actions.cancel'), style: 'cancel' },
                { text: t('reset'), style: 'destructive', onPress: () => resetCourse(installed.id) },
              ])
            }
          />
          {building && !course?.syllabus.length ? (
            <Row style={{ padding: space.lg }}>
              <ActivityIndicator />
              <Text variant="footnote" color="textSecondary">
                {t('building')}
              </Text>
            </Row>
          ) : course?.syllabus.length ? (
            <ListGroup>
              {course.syllabus.map((lesson, index) => {
                const done = course.completed.has(lesson.path);
                return (
                  // The check is a sibling of the lesson button, not inside it, so VoiceOver can reach it.
                  <View key={lesson.path} style={styles.lesson}>
                    <PressableScale
                      testID={`lesson-check-${index + 1}`}
                      haptic="selection"
                      onPress={() => setLessonDone(installed.id, lesson.path, !done)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={done ? t('markUndone') : t('markDone')}>
                      {done ? (
                        <View style={[styles.check, { backgroundColor: h.fg }]}>
                          <Check size={14} color="#fff" strokeWidth={3} />
                        </View>
                      ) : (
                        <Circle size={24} color={colors.border} strokeWidth={2} />
                      )}
                    </PressableScale>
                    <PressableScale
                      testID={`lesson-${index + 1}`}
                      pressedScale={0.99}
                      onPress={() => open(lesson)}
                      onLongPress={() => setLessonDone(installed.id, lesson.path, !done)}
                      style={styles.lessonBody}
                      accessibilityRole="button"
                      accessibilityHint={done ? t('markUndone') : t('markDone')}>
                      <Text variant="caption" color="textTertiary" tabular style={{ width: 26 }}>
                        {index + 1}
                      </Text>
                      <Text variant="callout" color={done ? 'textSecondary' : 'text'} numberOfLines={2} style={{ flex: 1 }}>
                        {lesson.title}
                      </Text>
                    </PressableScale>
                  </View>
                );
              })}
            </ListGroup>
          ) : (
            <Card style={{ gap: space.md }}>
              <Text variant="footnote" color="textSecondary">
                {t('syllabusEmpty')}
              </Text>
              <Button title={t('openCourse')} variant="secondary" icon={BookOpen} onPress={() => open(null)} style={{ alignSelf: 'flex-start' }} />
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  lessonBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: space.lg, paddingVertical: 14 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
