/**
 * Tab Navigation Component
 * Settings page tab switcher with icons
 */

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Globe,
  Image as ImageIcon,
  Settings2,
  Server,
  KeyRound,
  Brain,
  Archive,
  MessageSquare,
} from 'lucide-react';
import type { SettingsTab } from '../types';
import { useTranslation } from 'react-i18next';

interface TabNavigationProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const { t } = useTranslation();
  const tabs = [
    { value: 'websearch' as const, label: t('settingsTabs.web'), icon: Globe },
    { value: 'image' as const, label: 'Image', icon: ImageIcon },
    { value: 'channels' as const, label: 'Channels', icon: MessageSquare },
    { value: 'globalenv' as const, label: t('settingsTabs.env'), icon: Settings2 },
    { value: 'thinking' as const, label: t('settingsTabs.think'), icon: Brain },
    { value: 'proxy' as const, label: t('settingsTabs.proxy'), icon: Server },
    { value: 'auth' as const, label: t('settingsTabs.auth'), icon: KeyRound },
    { value: 'backups' as const, label: t('settingsTabs.backup'), icon: Archive },
  ] as const;

  return (
    <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as SettingsTab)}>
      <TabsList className="grid w-full grid-cols-8">
        {tabs.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className="gap-1.5 px-2 text-xs">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
