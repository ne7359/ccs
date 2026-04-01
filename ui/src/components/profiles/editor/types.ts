/**
 * Types for Profile Editor
 */

import type { CliTarget, CliproxyBridgeMetadata, ImageAnalysisStatus } from '@/lib/api-client';

export interface Settings {
  env?: Record<string, string>;
  ccs_image?: {
    native_read?: boolean;
  };
}

export interface SettingsResponse {
  profile: string;
  settings: Settings;
  mtime: number;
  path: string;
  cliproxyBridge?: CliproxyBridgeMetadata | null;
  imageAnalysisStatus?: ImageAnalysisStatus | null;
}

export interface ProfileEditorProps {
  profileName: string;
  profileTarget?: CliTarget;
  onDelete?: () => void;
  onHasChangesUpdate?: (hasChanges: boolean) => void;
}
