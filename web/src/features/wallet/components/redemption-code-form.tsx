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
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  CircleCheck,
  ExternalLink,
  Loader2,
  Store,
  Ticket,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'

import { isCardStoreUrl } from '../lib/card-store'
import type { CardStoreConfig } from '../types'

export type RedemptionResult = 'success' | 'error' | null

interface RedemptionCodeFormProps {
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  redemptionResult?: RedemptionResult
  topupLink?: string
  cardStore?: CardStoreConfig
  showCodePurchase: boolean
}

export function RedemptionCodeForm(props: RedemptionCodeFormProps) {
  const { t, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const configuredLink = props.topupLink?.trim() || ''
  const topupLink = isCardStoreUrl(configuredLink) ? configuredLink : ''
  const invalid = props.redemptionResult === 'error'
  const amounts = props.cardStore?.enabled
    ? props.cardStore.amount_options
        .map((option) => ({
          ...option,
          url: option.url.trim() || topupLink,
        }))
        .filter(
          (option) =>
            Number.isFinite(option.amount) &&
            option.amount > 0 &&
            isCardStoreUrl(option.url)
        )
    : []

  return (
    <div className='@container min-w-0'>
      <div className='flex min-w-0 flex-col gap-6'>
        {props.showCodePurchase && (
          <>
            <section
              aria-labelledby='purchase-code-title'
              className='flex min-w-0 flex-col gap-4'
            >
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <h3
                    id='purchase-code-title'
                    className='text-base font-semibold'
                  >
                    {t('Quick Recharge Amounts')}
                  </h3>
                  <Badge variant='secondary' className='rounded-md'>
                    <Store aria-hidden='true' className='size-3' />
                    {t('Card Store Payment')}
                  </Badge>
                </div>
                <Button
                  variant='link'
                  className='h-auto min-h-9 p-0 text-left whitespace-normal'
                  onClick={() => inputRef.current?.focus()}
                >
                  {t('Already have a code? Redeem it now')}
                  <ArrowRight data-icon='inline-end' />
                </Button>
              </div>
              <p className='text-muted-foreground text-sm leading-relaxed'>
                {t(
                  'Choose a code amount to purchase, then paste the code below to add funds.'
                )}
              </p>
              {topupLink ? (
                <div className='space-y-4'>
                  {amounts.length > 0 && (
                    <div className='grid grid-cols-2 gap-3 @2xl:grid-cols-4'>
                      {amounts.map((option) => {
                        const amount = formatCurrencyFromUSD(option.amount, {
                          locale: toIntlLocale(i18n.language),
                          abbreviate: false,
                        })
                        return (
                          <Button
                            key={option.amount}
                            variant='outline'
                            className='hover:border-primary/50 hover:bg-primary/5 h-auto min-h-28 min-w-0 flex-col items-start gap-2 rounded-lg p-4 text-left whitespace-normal'
                            aria-label={t('Purchase {{amount}} code', {
                              amount,
                            })}
                            render={
                              <a
                                href={option.url}
                                target='_blank'
                                rel='noopener noreferrer'
                              />
                            }
                          >
                            <span className='w-full text-xl leading-tight font-semibold break-words tabular-nums'>
                              {amount}
                            </span>
                            <span className='text-muted-foreground w-full text-xs leading-relaxed'>
                              {t('Balance credit')}
                            </span>
                            <span className='text-primary flex w-full items-center justify-between gap-2 text-xs'>
                              {t('Purchase')}
                              <ExternalLink
                                aria-hidden='true'
                                className='size-3.5'
                              />
                            </span>
                          </Button>
                        )
                      })}
                    </div>
                  )}
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button
                      variant={amounts.length ? 'outline' : 'default'}
                      className='h-auto min-h-10 max-w-full rounded-md px-4 py-2 whitespace-normal'
                      render={
                        <a
                          href={topupLink}
                          target='_blank'
                          rel='noopener noreferrer'
                        />
                      }
                    >
                      <Store data-icon='inline-start' />
                      <span className='min-w-0 text-left leading-snug whitespace-normal'>
                        {t('Purchase Redemption Codes')}
                      </span>
                      <ExternalLink
                        data-icon='inline-end'
                        className='ml-auto'
                      />
                    </Button>
                    <Button
                      variant='ghost'
                      className='h-auto min-h-10 max-w-full rounded-md py-2 whitespace-normal'
                      render={<Link to='/wallet/redeem' />}
                    >
                      <Ticket data-icon='inline-start' />
                      {t('Open shop within site')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert role='note'>
                  <AlertDescription>
                    {t(
                      'Code purchases are currently unavailable. You can still redeem an existing code.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <Separator />
          </>
        )}

        <section
          aria-labelledby='redeem-code-title'
          className='flex min-w-0 flex-col gap-4'
        >
          <div className='flex items-center gap-3'>
            <Ticket
              aria-hidden='true'
              className='text-muted-foreground size-4'
            />
            <h3 id='redeem-code-title' className='text-base font-semibold'>
              {t('Redeem to Balance')}
            </h3>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (props.redemptionCode.trim() && !props.redeeming) {
                props.onRedeem()
              }
            }}
          >
            <FieldGroup className='gap-3'>
              <div className='flex flex-col items-start gap-3 @lg:flex-row @lg:items-end'>
                <Field
                  className='min-w-0 flex-1'
                  data-invalid={invalid || undefined}
                  data-disabled={props.redeeming || undefined}
                >
                  <FieldLabel htmlFor='redemption-code'>
                    {t('Redemption Code')}
                  </FieldLabel>
                  <InputGroup className='h-12 rounded-md'>
                    <InputGroupInput
                      ref={inputRef}
                      id='redemption-code'
                      value={props.redemptionCode}
                      onChange={(event) =>
                        props.onRedemptionCodeChange(event.target.value)
                      }
                      placeholder={t('Paste your redemption code')}
                      autoComplete='off'
                      spellCheck={false}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid
                          ? 'redemption-code-error'
                          : 'redemption-code-hint'
                      }
                      disabled={props.redeeming}
                      className='h-12 font-mono text-sm placeholder:font-sans'
                    />
                    <InputGroupAddon>
                      <Ticket aria-hidden='true' />
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Button
                  type='submit'
                  variant={
                    props.redemptionCode.trim() ? 'default' : 'secondary'
                  }
                  disabled={!props.redemptionCode.trim() || props.redeeming}
                  className='h-auto min-h-12 w-full rounded-md px-5 py-3 whitespace-normal @lg:w-auto'
                >
                  {props.redeeming ? (
                    <Loader2
                      data-icon='inline-start'
                      className='animate-spin'
                    />
                  ) : (
                    <CircleCheck data-icon='inline-start' />
                  )}
                  {props.redeeming ? t('Redeeming code...') : t('Redeem')}
                </Button>
              </div>
              <FieldDescription id='redemption-code-hint' className='text-xs'>
                {t(
                  'The redeemed amount will be added to your account balance.'
                )}
              </FieldDescription>
              {invalid && (
                <FieldError id='redemption-code-error'>
                  {t('Redemption failed. Check your code and try again.')}
                </FieldError>
              )}
              {props.redemptionResult === 'success' && (
                <p
                  role='status'
                  className='text-success flex items-start gap-2 text-sm'
                >
                  <CircleCheck
                    aria-hidden='true'
                    className='mt-0.5 size-4 shrink-0'
                  />
                  {t(
                    'Redemption complete. Funds have been added to your balance.'
                  )}
                </p>
              )}
            </FieldGroup>
          </form>
        </section>
      </div>
    </div>
  )
}
