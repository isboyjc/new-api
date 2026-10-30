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
import { isHttpUrl } from '@/lib/content-format'
import { cn } from '@/lib/utils'

export type RedemptionResult = 'success' | 'error' | null

interface RedemptionCodeFormProps {
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  redemptionResult?: RedemptionResult
  topupLink?: string
  showCodePurchase: boolean
}

export function RedemptionCodeForm(props: RedemptionCodeFormProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const configuredLink = props.topupLink?.trim() || ''
  const topupLink = isHttpUrl(configuredLink) ? configuredLink : ''
  const invalid = props.redemptionResult === 'error'

  return (
    <div className='@container'>
      <div
        className={cn(
          'grid gap-6',
          props.showCodePurchase &&
            '@2xl:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.1fr)] @2xl:gap-8'
        )}
      >
        {props.showCodePurchase && (
          <>
            <section
              aria-labelledby='purchase-code-title'
              className='flex min-w-0 flex-col gap-4'
            >
              <div className='flex items-center gap-3'>
                <Badge
                  variant='outline'
                  className='bg-primary/5 text-primary border-primary/20 size-7 rounded-md p-0'
                >
                  01
                </Badge>
                <h3
                  id='purchase-code-title'
                  className='text-base font-semibold'
                >
                  {t('Purchase Redemption Codes')}
                </h3>
              </div>
              <p className='text-muted-foreground text-sm leading-relaxed'>
                {t(
                  'Choose an amount in the shop and complete your purchase to receive a redemption code.'
                )}
              </p>
              {topupLink ? (
                <div className='flex flex-col gap-2'>
                  <Button
                    className='h-12 w-full rounded-md px-4'
                    onClick={() => inputRef.current?.focus()}
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
                    <ExternalLink data-icon='inline-end' className='ml-auto' />
                  </Button>
                  <Button
                    variant='ghost'
                    className='h-10 w-full rounded-md whitespace-normal'
                    render={<Link to='/wallet/redeem' />}
                  >
                    <Ticket data-icon='inline-start' />
                    {t('Open shop within site')}
                  </Button>
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
              <Button
                variant='link'
                className='h-auto min-h-9 justify-start self-start p-0 text-left whitespace-normal'
                onClick={() => {
                  inputRef.current?.focus()
                }}
              >
                {t('Already have a code? Redeem it now')}
                <ArrowRight data-icon='inline-end' />
              </Button>
            </section>
            <Separator className='@2xl:hidden' />
            <Separator orientation='vertical' className='hidden @2xl:block' />
          </>
        )}

        <section
          aria-labelledby='redeem-code-title'
          className='flex min-w-0 flex-col gap-4'
        >
          <div className='flex items-center gap-3'>
            {props.showCodePurchase && (
              <Badge
                variant='outline'
                className='bg-success/5 text-success border-success/20 size-7 rounded-md p-0'
              >
                02
              </Badge>
            )}
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
            <FieldGroup className='gap-4'>
              <Field
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
                      invalid ? 'redemption-code-error' : 'redemption-code-hint'
                    }
                    disabled={props.redeeming}
                    className='h-12 font-mono text-sm placeholder:font-sans'
                  />
                  <InputGroupAddon>
                    <Ticket aria-hidden='true' />
                  </InputGroupAddon>
                </InputGroup>
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
              </Field>
              <Button
                type='submit'
                variant={props.redemptionCode.trim() ? 'default' : 'secondary'}
                disabled={!props.redemptionCode.trim() || props.redeeming}
                className='h-11 w-full rounded-md px-4'
              >
                {props.redeeming ? (
                  <Loader2 data-icon='inline-start' className='animate-spin' />
                ) : (
                  <CircleCheck data-icon='inline-start' />
                )}
                {props.redeeming ? t('Redeeming code...') : t('Redeem')}
              </Button>
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
