// An arrow that points at a place as the phone turns (the compass), for the lost card's nearest town: "that way,
// 7 km". Without a compass it stays drawn against north and says so. The watch runs only while it is on screen.
import { ArrowUp } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { watchScreenHeading } from './heading';

/** Under this change (degrees) the arrow doesn't re-render: the compass jitters by a degree or two. */
const STEP_DEG = 3;

export function TowardArrow({ bearing, label, testID }: { bearing: number; label: string; testID?: string }) {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const [heading, setHeading] = useState<number | null>(null);
  const [noCompass, setNoCompass] = useState(false);

  useEffect(() => {
    let alive = true;
    let sub: { remove: () => void } | null = null;
    watchScreenHeading((h) => {
      if (!alive || !h) return;
      setHeading((prev) => (prev === null || Math.abs(((h.deg - prev + 540) % 360) - 180) >= STEP_DEG ? h.deg : prev));
    })
      .then((s) => {
        if (alive) sub = s;
        else s.remove();
      })
      .catch(() => alive && setNoCompass(true));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  const turn = heading === null ? bearing : bearing - heading;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View accessibilityLabel={label} style={{ width: 44, height: 44, borderWidth: 1, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ transform: [{ rotate: `${turn}deg` }] }}>
          <ArrowUp size={26} color={colors.accent} strokeWidth={2.5} />
        </View>
      </View>
      <Text variant="callout" style={{ flex: 1 }}>
        {label}
        {noCompass || heading === null ? `\n${t('guidance.noCompass')}` : ''}
      </Text>
    </View>
  );
}
