import Storage from 'expo-sqlite/kv-store';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ALargeSmall,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  History,
  House,
  Search,
  Shuffle,
  TextSearch,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';

import { EmptyState, Text, triggerHaptic } from '@/components/ui';
import { useItems } from '@/features/content/items';
import { ArchiveSearchSheet } from '@/features/library/components/ArchiveSearchSheet';
import { DisclaimerBanner, FindBar, MenuItem, Popover, ReaderToolbar, TextSizeControl } from '@/features/library/components/ReaderChrome';
import { ReaderLibrarySheet } from '@/features/library/components/ReaderLibrarySheet';
import { isBookmarked, recordVisit, toggleBookmark } from '@/features/library/history';
import { pageTitle } from '@/features/library/titles';
import { ensureArchive, randomPath } from '@/features/library/zim';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

import { ZimWebView, type ZimNavigationEvent, type ZimWebViewRef } from '../../../modules/nomad-zim';

type Panel = null | 'text' | 'more';
type SheetKind = null | 'search' | 'library';

const disclaimerKey = (id: string) => `reader.disclaimerDismissed.${id}`;

export default function ReaderScreen() {
  const { itemId, path } = useLocalSearchParams<{ itemId: string; path?: string }>();
  const { t } = useTranslation('reader');
  const { t: tc } = useTranslation();
  const { colors, scheme } = useTheme();
  const item = useItems('zim').find((i) => i.id === itemId);

  const [openState, setOpenState] = useState<{ itemId: string; status: 'ready' | 'error' } | { itemId: null; status: 'loading' }>({
    itemId: null,
    status: 'loading',
  });
  const [nav, setNav] = useState<ZimNavigationEvent | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [finding, setFinding] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const web = useRef<ZimWebViewRef>(null);
  const lastRecorded = useRef<string>('');

  const textScale = useSettings((s) => s.readerTextScale);
  const setTextScale = useSettings((s) => s.setReaderTextScale);
  const textZoom = Math.round((textScale || 1) * 100);

  const medical = !!item?.meta.medical;

  useEffect(() => {
    let alive = true;
    ensureArchive(itemId).then((info) => alive && setOpenState({ itemId, status: info ? 'ready' : 'error' }));
    return () => {
      alive = false;
    };
  }, [itemId]);
  const status = openState.itemId === itemId ? openState.status : 'loading';

  const dismissedBefore = useMemo(() => {
    try {
      return Storage.getItemSync(disclaimerKey(itemId)) === '1';
    } catch {
      return false;
    }
  }, [itemId]);
  const showDisclaimer = medical && !dismissedBefore && !dismissedNow;

  // Android back button walks the page history first.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (sheet || panel || finding) {
          setSheet(null);
          setPanel(null);
          setFinding(false);
          return true;
        }
        if (nav?.canGoBack) {
          web.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [nav?.canGoBack, sheet, panel, finding]),
  );

  const onNavigationChange = (e: { nativeEvent: ZimNavigationEvent }) => {
    // Native event callback: never let an exception escape (it would crash Release builds).
    try {
      const n = e.nativeEvent;
      setNav(n);
      setBookmarked(isBookmarked(itemId, n.path));
      const title = pageTitle(n.title, n.path) || item?.title || n.path;
      const key = `${n.path}\u0000${title}`;
      if (n.path && key !== lastRecorded.current) {
        lastRecorded.current = key;
        recordVisit(itemId, n.path, title);
      }
    } catch (err) {
      console.warn('[reader] navigation event failed', err);
    }
  };

  const go = (p: string) => {
    setSheet(null);
    setPanel(null);
    web.current?.loadPath(p);
  };

  const onBookmark = () => {
    if (!nav?.path) return;
    triggerHaptic('selection');
    setBookmarked(toggleBookmark(itemId, nav.path, pageTitle(nav.title, nav.path) || item?.title || nav.path));
  };

  const onRandom = async () => {
    setPanel(null);
    const p = await randomPath(itemId);
    if (p) web.current?.loadPath(p);
  };

  const dismissDisclaimer = () => {
    setDismissedNow(true);
    try {
      Storage.setItemSync(disclaimerKey(itemId), '1');
    } catch {
      // ignore
    }
  };

  const title = pageTitle(nav?.title, nav?.path) || item?.title || '';

  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon={BookOpen} title={t('notFound')} body={t('notFoundBody')} />
      </View>
    );
  }

  if (status !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: item.title }} />
        {status === 'loading' ? (
          <>
            <ActivityIndicator color={colors.textSecondary} />
            <Text variant="footnote" color="textSecondary" style={{ marginTop: space.sm }}>
              {t('loading')}
            </Text>
          </>
        ) : (
          <EmptyState icon={BookOpen} title={t('openFailed')} body={t('openFailedBody')} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title }} />
      {showDisclaimer ? <DisclaimerBanner text={tc('health.disclaimer')} onDismiss={dismissDisclaimer} /> : null}
      <View style={styles.flex}>
        <ZimWebView
          ref={web}
          style={styles.flex}
          archiveId={itemId}
          path={path ?? ''}
          darkMode={scheme === 'dark'}
          textZoom={textZoom}
          onNavigationChange={onNavigationChange}
        />
        {panel === 'text' ? (
          <Popover onDismiss={() => setPanel(null)}>
            <TextSizeControl percent={textZoom} onChange={(p) => setTextScale(p / 100)} />
          </Popover>
        ) : null}
        {panel === 'more' ? (
          <Popover onDismiss={() => setPanel(null)}>
            <MenuItem icon={House} label={t('mainPage')} onPress={() => go('')} />
            <MenuItem icon={Shuffle} label={t('random')} onPress={onRandom} />
            <MenuItem
              icon={TextSearch}
              label={t('findInPage')}
              onPress={() => {
                setPanel(null);
                setFinding(true);
              }}
            />
            <MenuItem
              icon={History}
              label={t('bookmarksHistory')}
              onPress={() => {
                setPanel(null);
                setSheet('library');
              }}
            />
          </Popover>
        ) : null}
      </View>
      <ReaderToolbar
        actions={[
          { key: 'back', icon: ChevronLeft, label: t('back'), onPress: () => web.current?.goBack(), disabled: !nav?.canGoBack },
          { key: 'forward', icon: ChevronRight, label: t('forward'), onPress: () => web.current?.goForward(), disabled: !nav?.canGoForward },
          { key: 'search', icon: Search, label: t('searchArchive'), onPress: () => setSheet('search') },
          {
            key: 'bookmark',
            icon: bookmarked ? BookmarkCheck : Bookmark,
            label: bookmarked ? t('removeBookmark') : t('bookmark'),
            onPress: onBookmark,
            active: bookmarked,
            disabled: !nav?.path,
          },
          { key: 'text', icon: ALargeSmall, label: t('textSize'), onPress: () => setPanel(panel === 'text' ? null : 'text'), active: panel === 'text' },
          { key: 'more', icon: Ellipsis, label: t('more'), onPress: () => setPanel(panel === 'more' ? null : 'more'), active: panel === 'more' },
        ]}>
        {finding ? (
          <FindBar
            onFind={(text, backwards) => web.current?.findInPage(text, backwards) ?? Promise.resolve({ found: false })}
            onClose={() => {
              setFinding(false);
              web.current?.clearFind();
            }}
          />
        ) : undefined}
      </ReaderToolbar>

      <ArchiveSearchSheet visible={sheet === 'search'} itemId={itemId} title={item.title} onClose={() => setSheet(null)} onOpen={go} />
      <ReaderLibrarySheet visible={sheet === 'library'} itemId={itemId} onClose={() => setSheet(null)} onOpen={go} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
