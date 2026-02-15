/**
 * Provider Logo Component
 * Uses actual provider logos with fallback to styled letters
 */

import { cn } from '@/lib/utils';
import { getProviderDisplayName, getProviderLogoMetadata } from '@/lib/provider-config';

interface ProviderLogoProps {
  provider: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Size configuration */
const SIZE_CONFIG = {
  sm: { container: 'w-6 h-6', icon: 'w-4 h-4', text: 'text-xs' },
  md: { container: 'w-8 h-8', icon: 'w-5 h-5', text: 'text-sm' },
  lg: { container: 'w-12 h-12', icon: 'w-8 h-8', text: 'text-lg' },
};

export function ProviderLogo({ provider, className, size = 'md' }: ProviderLogoProps) {
  const logoMetadata = getProviderLogoMetadata(provider);
  const sizeConfig = SIZE_CONFIG[size];
  const imageSrc = logoMetadata.assetPath;
  const displayName = getProviderDisplayName(provider);

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md',
        imageSrc && 'bg-white p-1',
        sizeConfig.container,
        className
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`${displayName} logo`}
          className={cn(sizeConfig.icon, 'object-contain')}
        />
      ) : (
        <span className={cn('font-semibold', logoMetadata.textClass, sizeConfig.text)}>
          {logoMetadata.letter}
        </span>
      )}
    </div>
  );
}

/** Inline variant for use in text */
export function ProviderLogoInline({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  return <ProviderLogo provider={provider} size="sm" className={className} />;
}
