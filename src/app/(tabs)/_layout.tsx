import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <NativeTabs
      tintColor={colors.accent}
      labelStyle={{ fontFamily: 'Inter', fontWeight: '600' }}
      // iOS gets Liquid Glass for free; on Android match the app palette instead of Material defaults.
      {...(Platform.OS === 'android'
        ? { backgroundColor: colors.surface, indicatorColor: colors.accentSoft, rippleColor: colors.surfacePressed, iconColor: colors.textSecondary }
        : {})}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="maps">
        <NativeTabs.Trigger.Label>{t('tabs.maps')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }} md="local_library" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <NativeTabs.Trigger.Label>{t('tabs.assistant')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sparkles', selected: 'sparkles' }} md="auto_awesome" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
