// The two signature shapes of the "Precisión" look: corner marks on panels and a diagonal cut on the
// corner of the most important controls. React Native has no clip-path, so the cut is an SVG fill that
// measures its box; until the first layout it draws a plain rectangle, so nothing flashes empty.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { chamfer, useTheme } from '@/theme';

/** Two small L marks (top-left and bottom-right) over a panel's 1 px border. Render as the last child. */
export function CornerTicks({ color, size = 9, inset = -1 }: { color?: string; size?: number; inset?: number }) {
  const { colors } = useTheme();
  const c = color ?? colors.tick;
  const t = 1.5;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: inset, left: inset, right: inset, bottom: inset }]}>
      <View style={[styles.mark, { top: 0, left: 0, width: size, height: t, backgroundColor: c }]} />
      <View style={[styles.mark, { top: 0, left: 0, width: t, height: size, backgroundColor: c }]} />
      <View style={[styles.mark, { bottom: 0, right: 0, width: size, height: t, backgroundColor: c }]} />
      <View style={[styles.mark, { bottom: 0, right: 0, width: t, height: size, backgroundColor: c }]} />
    </View>
  );
}

type Corner = 'topRight' | 'bottomRight';

function cutPath(w: number, h: number, c: number, corner: Corner) {
  return corner === 'topRight' ? `M0 0H${w - c}L${w} ${c}V${h}H0Z` : `M0 0H${w}V${h - c}L${w - c} ${h}H0Z`;
}

/** Background with one corner cut on the diagonal. Render as the first child of a transparent box. */
export function ChamferFill({ color, cut = chamfer.sm, corner = 'topRight' }: { color: string; cut?: number; corner?: Corner }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, !size && { backgroundColor: color }]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      }}>
      {size && size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Path d={cutPath(size.w, size.h, Math.min(cut, size.w / 2, size.h / 2), corner)} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute' },
});
