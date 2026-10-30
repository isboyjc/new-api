/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDown, ArrowUp, Plus, Store, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useFieldArray, useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  cardStoreSchema,
  getCardStoreDefaults,
  type CardStoreValues,
} from './lib/card-store-schema'

interface CardStoreSettingsSectionProps {
  config: string
  legacyUrl: string
  active?: boolean
  disabled?: boolean
}

export function CardStoreSettingsSection(props: CardStoreSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const defaults = useMemo(
    () => getCardStoreDefaults(props.config, props.legacyUrl),
    [props.config, props.legacyUrl]
  )
  const savedValuesRef = useRef(defaults)
  const form = useForm<CardStoreValues>({
    resolver: zodResolver(cardStoreSchema) as Resolver<CardStoreValues>,
    defaultValues: defaults,
  })
  const options = useFieldArray({
    control: form.control,
    name: 'amount_options',
  })
  const { isDirty, isSubmitting } = form.formState
  const saving = isSubmitting || updateOption.isPending
  const disabled = saving || props.disabled

  useEffect(() => {
    savedValuesRef.current = defaults
    // Refresh saved values without merging or discarding ordered draft rows.
    if (!form.formState.isDirty) form.reset(defaults)
  }, [defaults, form])

  async function onSubmit(values: CardStoreValues) {
    if (props.disabled) return

    try {
      await updateOption.mutateAsync({
        key: 'card_store_setting.config',
        value: JSON.stringify(values),
      })
      savedValuesRef.current = values
      form.reset(values)
    } catch {
      // The shared mutation displays the error; retain unsaved settings.
    }
  }

  return (
    <SettingsSection title={t('Card Store Payment')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          {props.active !== false && (
            <SettingsPageFormActions
              onSave={form.handleSubmit(onSubmit)}
              onReset={() => form.reset(savedValuesRef.current)}
              isSaving={saving}
              isSaveDisabled={props.disabled || !isDirty}
              isResetDisabled={props.disabled || !isDirty}
            />
          )}
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable card store payment')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Users purchase codes in the card store, then redeem them in their wallet.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='store_url'
            render={({ field }) => (
              <FormItem data-settings-form-span='full'>
                <FormLabel>{t('Card store URL')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='url'
                    placeholder='https://'
                    disabled={disabled}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'External purchase link used by wallet purchases and the embedded shop.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Separator />
          <section
            aria-labelledby='card-store-amounts-title'
            className='min-w-0 space-y-4'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 id='card-store-amounts-title' className='text-sm font-medium'>
                {t('Quick Recharge Amounts')}
              </h3>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled || options.fields.length >= 24}
                onClick={() => options.append({ amount: 0, url: '' })}
              >
                <Plus data-icon='inline-start' />
                {t('Add new amount')}
              </Button>
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Set each code face value in USD. Leave the product URL blank to use the card store URL, or set a direct product link. The store determines the price; the code determines the credited balance.'
              )}
            </p>
            {options.fields.length === 0 && (
              <EmptyState
                icon={Store}
                title={t(
                  'No quick amounts configured. Users can still open the shop.'
                )}
                className='min-h-32 px-4 py-6'
              />
            )}
            {options.fields.map((option, index) => (
              <div
                key={option.id}
                className='grid min-w-0 items-start gap-3 border-b pb-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto]'
              >
                <FormField
                  control={form.control}
                  name={`amount_options.${index}.amount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Code face value (USD)')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min='0.01'
                          max='1000000000'
                          step='any'
                          disabled={disabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`amount_options.${index}.url`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Product URL')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='url'
                          placeholder={t(
                            'Leave blank to use the card store URL'
                          )}
                          disabled={disabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='flex items-center gap-1 sm:pt-6'>
                  {[
                    {
                      label: 'Move up',
                      Icon: ArrowUp,
                      disabled: index === 0,
                      action: () => options.move(index, index - 1),
                    },
                    {
                      label: 'Move down',
                      Icon: ArrowDown,
                      disabled: index === options.fields.length - 1,
                      action: () => options.move(index, index + 1),
                    },
                    {
                      label: 'Remove',
                      Icon: Trash2,
                      disabled: false,
                      action: () => options.remove(index),
                    },
                  ].map(({ label, Icon, disabled: actionDisabled, action }) => (
                    <Tooltip key={label}>
                      <TooltipTrigger
                        render={
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t(label)}
                            disabled={disabled || actionDisabled}
                            onClick={action}
                          >
                            <Icon />
                          </Button>
                        }
                      />
                      <TooltipContent>{t(label)}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
