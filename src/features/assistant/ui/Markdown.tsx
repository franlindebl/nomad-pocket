import { memo, useMemo, type ReactNode } from 'react';
import { Platform, Text as RNText, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

import { parseMarkdown, type Inline } from '../markdown';

type Props = {
  text: string;
  /** Called when an inline [n] citation is tapped. */
  onCite?: (n: number) => void;
  /** Citation numbers that resolve to a source (others render as plain text). */
  citable?: Set<number>;
  /** Show a caret after the text (streaming). */
  caret?: boolean;
};

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

function InlineNodes({ nodes, onCite, citable }: { nodes: Inline[]; onCite?: (n: number) => void; citable?: Set<number> }): ReactNode {
  const { colors } = useTheme();
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'bold':
        return (
          <RNText key={i} style={{ fontWeight: '700' }}>
            <InlineNodes nodes={n.children} onCite={onCite} citable={citable} />
          </RNText>
        );
      case 'italic':
        return (
          <RNText key={i} style={{ fontStyle: 'italic' }}>
            <InlineNodes nodes={n.children} onCite={onCite} citable={citable} />
          </RNText>
        );
      case 'code':
        return (
          <RNText key={i} style={{ fontFamily: mono, fontSize: 14, backgroundColor: colors.surfaceAlt }}>
            {` ${n.text} `}
          </RNText>
        );
      case 'cite': {
        if (citable && !citable.has(n.n)) return `[${n.n}]`;
        return (
          <Text
            key={i}
            onPress={onCite ? () => onCite(n.n) : undefined}
            accessibilityRole="link"
            variant="caption"
            weight="700"
            tint={colors.accent}
            style={{ backgroundColor: colors.accentSoft }}>
            {` ${n.n} `}
          </Text>
        );
      }
    }
  });
}

/** Renders model output with lightweight Markdown and tappable citations. */
export const Markdown = memo(function Markdown({ text, onCite, citable, caret }: Props) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const caretNode = caret ? <Text tint={colors.accent}> ▍</Text> : null;

  return (
    <View style={styles.root}>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        const tail = last ? caretNode : null;
        switch (b.type) {
          case 'heading':
            return (
              <Text key={i} variant={b.level === 1 ? 'title3' : 'headline'} style={i > 0 && { marginTop: space.xs }}>
                <InlineNodes nodes={b.children} onCite={onCite} citable={citable} />
                {tail}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} selectable>
                <InlineNodes nodes={b.children} onCite={onCite} citable={citable} />
                {tail}
              </Text>
            );
          case 'quote':
            return (
              <View key={i} style={[styles.quote, { borderColor: colors.border }]}>
                <Text color="textSecondary">
                  <InlineNodes nodes={b.children} onCite={onCite} citable={citable} />
                  {tail}
                </Text>
              </View>
            );
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: colors.border }]} />;
          case 'code':
            return (
              <ScrollView key={i} horizontal style={[styles.code, { backgroundColor: colors.surfaceAlt }]} contentContainerStyle={{ padding: space.md }}>
                <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 19 }}>
                  {b.text}
                </Text>
              </ScrollView>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.item}>
                    <Text color="textSecondary" tabular style={styles.marker}>
                      {b.ordered ? `${b.start + j}.` : '•'}
                    </Text>
                    <Text selectable style={{ flex: 1 }}>
                      <InlineNodes nodes={item} onCite={onCite} citable={citable} />
                      {last && j === b.items.length - 1 ? tail : null}
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
      {!blocks.length ? caretNode : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: space.sm },
  list: { gap: space.xs },
  item: { flexDirection: 'row', gap: space.sm },
  marker: { minWidth: 18 },
  quote: { borderLeftWidth: 3, paddingLeft: space.md },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  code: { borderRadius: radius.md, borderCurve: 'continuous' },
});
