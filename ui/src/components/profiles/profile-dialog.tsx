/**
 * Profile Dialog Component
 * Phase 03: REST API Routes & CRUD
 * Updated: Added model mapping fields for Opus/Sonnet/Haiku
 */

/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateProfile, useUpdateProfile } from '@/hooks/use-profiles';
import type { Profile } from '@/lib/api-client';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const optionalUrlSchema = z
  .string()
  .refine((value) => value.trim().length === 0 || z.string().url().safeParse(value).success, {
    message: 'Invalid URL',
  });

const schema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'Invalid profile name'),
  baseUrl: optionalUrlSchema,
  apiKey: z.string().min(10, 'API key must be at least 10 characters'),
  model: z.string().optional(),
  opusModel: z.string().optional(),
  sonnetModel: z.string().optional(),
  haikuModel: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  profile?: Profile | null;
}

export function ProfileDialog({ open, onClose, profile }: ProfileDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateProfile();
  const updateMutation = useUpdateProfile();
  const [showModelMapping, setShowModelMapping] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    control,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: profile
      ? {
          name: profile.name,
          baseUrl: '',
          apiKey: '',
          model: '',
          opusModel: '',
          sonnetModel: '',
          haikuModel: '',
        }
      : undefined,
  });

  // Watch model field to auto-expand model mapping when custom model is entered
  const modelValue = useWatch({ control, name: 'model' });

  useEffect(() => {
    // Auto-show model mapping if user enters a custom model (not default)
    if (modelValue && modelValue !== DEFAULT_MODEL && modelValue.trim() !== '') {
      setShowModelMapping(true);
    }
  }, [modelValue]);

  // Reset state when dialog opens/closes

  useEffect(() => {
    if (!open) {
      setShowModelMapping(false);
    }
  }, [open]);

  const onSubmit = async (data: FormData) => {
    try {
      if (profile) {
        // Update mode
        await updateMutation.mutateAsync({
          name: profile.name,
          data: {
            baseUrl: data.baseUrl,
            apiKey: data.apiKey,
            model: data.model,
            opusModel: data.opusModel,
            sonnetModel: data.sonnetModel,
            haikuModel: data.haikuModel,
          },
        });
      } else {
        // Create mode
        await createMutation.mutateAsync(data);
      }
      reset();
      onClose();
    } catch (error) {
      // Error is handled by the mutation hooks
      console.error('Failed to save profile:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {profile ? t('profileDialog.editTitle') : t('profileDialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">{t('profileDialog.name')}</Label>
            <Input
              id="name"
              {...register('name')}
              placeholder={t('profileDialog.namePlaceholder')}
              disabled={!!profile}
            />
            {errors.name && <span className="text-xs text-red-500">{errors.name.message}</span>}
          </div>

          <div>
            <Label htmlFor="baseUrl">{t('profileDialog.baseUrl')}</Label>
            <Input
              id="baseUrl"
              {...register('baseUrl')}
              placeholder={t('profileDialog.baseUrlPlaceholder')}
            />
            {errors.baseUrl && (
              <span className="text-xs text-red-500">{errors.baseUrl.message}</span>
            )}
          </div>

          <div>
            <Label htmlFor="apiKey">{t('profileDialog.apiKey')}</Label>
            <Input id="apiKey" type="password" {...register('apiKey')} />
            {errors.apiKey && <span className="text-xs text-red-500">{errors.apiKey.message}</span>}
          </div>

          <div>
            <Label htmlFor="model">{t('profileDialog.defaultModel')}</Label>
            <Input id="model" {...register('model')} placeholder={DEFAULT_MODEL} />
            <p className="text-xs text-muted-foreground mt-1">
              {t('profileDialog.defaultModelHint', { model: DEFAULT_MODEL })}
            </p>
          </div>

          {/* Model Mapping Section */}
          <div className="border rounded-md">
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
              onClick={() => setShowModelMapping(!showModelMapping)}
            >
              <span>{t('profileDialog.modelMappingTitle')}</span>
              {showModelMapping ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>

            {showModelMapping && (
              <div className="p-3 pt-0 space-y-3 border-t">
                <p className="text-xs text-muted-foreground">
                  {t('profileDialog.modelMappingDesc')}
                </p>

                <div>
                  <Label htmlFor="opusModel" className="text-xs">
                    {t('profileDialog.opusModel')}
                  </Label>
                  <Input
                    id="opusModel"
                    {...register('opusModel')}
                    placeholder={modelValue || DEFAULT_MODEL}
                    className="h-8 text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="sonnetModel" className="text-xs">
                    {t('profileDialog.sonnetModel')}
                  </Label>
                  <Input
                    id="sonnetModel"
                    {...register('sonnetModel')}
                    placeholder={modelValue || DEFAULT_MODEL}
                    className="h-8 text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="haikuModel" className="text-xs">
                    {t('profileDialog.haikuModel')}
                  </Label>
                  <Input
                    id="haikuModel"
                    {...register('haikuModel')}
                    placeholder={modelValue || DEFAULT_MODEL}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('profileDialog.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending
                ? t('profileDialog.saving')
                : profile
                  ? t('profileDialog.update')
                  : t('profileDialog.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
