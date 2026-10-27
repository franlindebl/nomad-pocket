import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ListRow, SearchField, Text } from '@/components/ui';
import { creditKey, creditSubtitle, filterCredits, getCredits } from '@/features/credits/licenses';
import { layout, radius, space, useTheme } from '@/theme';

/** Credits › JavaScript packages: ~550 rows, so a searchable FlatList rather than a ListGroup. */
export default function PackagesScreen() {
  const { t } = useTranslation('settings');
  const { colors, scheme } = useTheme();
  const [query, setQuery] = useState('');
  const all = getCredits().js;
  const list = useMemo(() => filterCredits(all, query), [all, query]);
  const border = scheme === 'light' ? colors.border : 'transparent';

  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      initialNumToRender={20}
      ListHeaderComponent={
        <SearchField
          testID="credits-search"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={t('creditsSearch')}
          style={{ marginBottom: space.md }}
        />
      }
      ListEmptyComponent={
        <Text variant="callout" color="textSecondary" align="center" style={{ marginTop: space.xxl }}>
          {t('creditsNoResults', { query })}
        </Text>
      }
      // The rows draw ListGroup's inset card piecewise: FlatList can't wrap them in one.
      renderItem={({ item, index }) => (
        <View
          style={[
            styles.item,
            { backgroundColor: colors.surface, borderColor: border },
            index === 0 && styles.first,
            index === list.length - 1 && styles.last,
          ]}>
          <ListRow
            title={item.name}
            subtitle={creditSubtitle(item)}
            chevron
            onPress={() => router.push({ pathname: '/settings/license', params: { id: creditKey('js', item.id) } })}
          />
        </View>
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separatorWrap, { backgroundColor: colors.surface, borderColor: border }]}>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { ...layout.column, paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.huge },
  item: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  separatorWrap: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
