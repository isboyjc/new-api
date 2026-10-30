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
import { Ticket, Loader2, Receipt, WalletCards } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { WALLET_ONLINE_TOPUP_ENABLED } from '../constants'
import {
  formatCurrency,
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  calculatePresetPricing,
} from '../lib'
import type {
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  CreemProduct,
  WaffoPayMethod,
} from '../types'
import { CreemProductsSection } from './creem-products-section'
import {
  RedemptionCodeForm,
  type RedemptionResult,
} from './redemption-code-form'

interface RechargeFormCardProps {
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  onPaymentMethodSelect: (method: PaymentMethod) => void
  paymentLoading: string | null
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  redemptionResult?: RedemptionResult
  topupLink?: string
  showCodePurchase?: boolean
  showOnlineTopup?: boolean
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
  onOpenBilling?: () => void
  creemProducts?: CreemProduct[]
  enableCreemTopup?: boolean
  onCreemProductSelect?: (product: CreemProduct) => void
  enableWaffoTopup?: boolean
  waffoPayMethods?: WaffoPayMethod[]
  waffoMinTopup?: number
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  enableWaffoPancakeTopup?: boolean
}

export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  onPaymentMethodSelect,
  paymentLoading,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  redemptionResult,
  topupLink,
  showCodePurchase = true,
  showOnlineTopup = WALLET_ONLINE_TOPUP_ENABLED,
  loading,
  priceRatio = 1,
  usdExchangeRate = 1,
  onOpenBilling,
  creemProducts,
  enableCreemTopup,
  onCreemProductSelect,
  enableWaffoTopup,
  waffoPayMethods,
  waffoMinTopup,
  onWaffoMethodSelect,
  enableWaffoPancakeTopup,
}: RechargeFormCardProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())

  useEffect(() => {
    // Empty string must survive, otherwise the field can never be cleared
    setLocalAmount((prev) =>
      prev === '' && topupAmount === 0 ? prev : topupAmount.toString()
    )
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = Number.parseInt(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasConfigurableTopup =
    topupInfo?.enable_online_topup ||
    topupInfo?.enable_stripe_topup ||
    enableWaffoTopup ||
    enableWaffoPancakeTopup
  const hasAnyTopup =
    showOnlineTopup && (hasConfigurableTopup || enableCreemTopup)
  const hasStandardPaymentMethods =
    Array.isArray(topupInfo?.pay_methods) && topupInfo.pay_methods.length > 0
  const hasWaffoPaymentMethods =
    Array.isArray(waffoPayMethods) && waffoPayMethods.length > 0
  const minTopup = getMinTopupAmount(topupInfo)
  const redemptionEnabled = topupInfo?.enable_redemption !== false
  const [rechargeMode, setRechargeMode] = useState<'code' | 'online'>('code')
  let activeRechargeMode = rechargeMode
  if (!hasAnyTopup) activeRechargeMode = 'code'
  else if (!redemptionEnabled) activeRechargeMode = 'online'

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='mt-2 h-4 w-48' />
        </CardHeader>
        <CardContent
          role='status'
          aria-label={t('Loading')}
          className='grid gap-6 p-5 md:grid-cols-2'
        >
          {['purchase', 'redeem'].map((key) => (
            <div key={key} className='flex flex-col gap-4'>
              <Skeleton className='h-6 w-32' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-12 w-full rounded-md' />
              <Skeleton className='h-10 w-full rounded-md' />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  const onlineContent = (
    <div className='space-y-4 sm:space-y-6'>
      {hasConfigurableTopup && (
        <>
          {presetAmounts.length > 0 && (
            <div className='space-y-2.5 sm:space-y-3'>
              <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                {t('Amount')}
              </Label>
              <div className='grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-4'>
                {presetAmounts.map((preset) => {
                  const discount =
                    preset.discount ||
                    topupInfo?.discount?.[preset.value] ||
                    1.0
                  const {
                    displayValue,
                    actualPrice,
                    savedAmount,
                    hasDiscount,
                  } = calculatePresetPricing(
                    preset.value,
                    priceRatio,
                    discount,
                    usdExchangeRate
                  )
                  return (
                    <Button
                      key={preset.value}
                      variant='outline'
                      className={cn(
                        'flex min-h-16 flex-col items-start rounded-lg px-3 py-2.5 text-left whitespace-normal sm:min-h-[72px] sm:p-4',
                        selectedPreset === preset.value
                          ? 'border-foreground bg-foreground/5 dark:border-foreground dark:bg-foreground/10'
                          : 'border-muted'
                      )}
                      onClick={() => onSelectPreset(preset)}
                    >
                      <div className='flex w-full items-center justify-between'>
                        <div className='text-base font-semibold sm:text-lg'>
                          {formatNumber(displayValue)}
                        </div>
                        {hasDiscount && (
                          <div className='text-xs font-medium text-green-600'>
                            {getDiscountLabel(discount, t)}
                          </div>
                        )}
                      </div>
                      <div className='text-muted-foreground mt-1.5 w-full text-xs sm:mt-2'>
                        {hasDiscount && savedAmount > 0 ? (
                          <Trans
                            t={t}
                            i18nKey='Pay {{amount}} <savings>• Save {{saved}}</savings>'
                            values={{
                              amount: formatCurrency(actualPrice),
                              saved: formatCurrency(savedAmount),
                            }}
                            components={{
                              savings: <span className='text-green-600' />,
                            }}
                          />
                        ) : (
                          t('Pay {{amount}}', {
                            amount: formatCurrency(actualPrice),
                          })
                        )}
                      </div>
                    </Button>
                  )
                })}
              </div>
            </div>
          )}

          <div className='space-y-2.5 sm:space-y-3'>
            <Label
              htmlFor='topup-amount'
              className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
            >
              {t('Custom Amount')}
            </Label>
            <div className='grid grid-cols-[minmax(0,1fr)_minmax(110px,0.55fr)] gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
              <Input
                id='topup-amount'
                type='number'
                value={localAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                min={minTopup}
                placeholder={t('Minimum {{amount}}', { amount: minTopup })}
                className='h-9 text-base sm:h-10 sm:text-lg'
              />
              <div className='bg-muted/30 flex min-h-9 items-center justify-between gap-2 rounded-md border px-3 lg:min-w-52'>
                <span className='text-muted-foreground truncate text-xs'>
                  {t('Amount to pay:')}
                </span>
                {calculating ? (
                  <Skeleton className='h-5 w-16' />
                ) : (
                  <span className='text-sm font-semibold'>
                    {formatCurrency(paymentAmount)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className='space-y-2.5 sm:space-y-3'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Payment Method')}
            </Label>
            {hasStandardPaymentMethods ? (
              <div className='grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-3'>
                {topupInfo?.pay_methods?.map((method) => {
                  const minTopup = Math.max(
                    method.min_topup || 0,
                    getMinTopupAmount(topupInfo)
                  )
                  const disabled = minTopup > topupAmount
                  const disabledReason = disabled
                    ? t('Minimum topup amount: {{amount}}', {
                        amount: minTopup,
                      })
                    : undefined
                  const disabledLabel = disabled
                    ? `${t('Minimum:')} ${minTopup}`
                    : undefined

                  const button = (
                    <Button
                      key={method.type}
                      variant='outline'
                      onClick={() => onPaymentMethodSelect(method)}
                      disabled={disabled || !!paymentLoading}
                      title={disabledReason}
                      aria-label={
                        disabledReason
                          ? `${method.name}. ${disabledReason}`
                          : method.name
                      }
                      className='min-h-14 min-w-0 justify-start gap-2 rounded-lg px-3 py-2 text-left'
                    >
                      {paymentLoading === method.type ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        getPaymentIcon(
                          method.type,
                          'h-4 w-4',
                          method.icon,
                          method.name
                        )
                      )}
                      <span className='flex min-w-0 flex-col items-start gap-0.5'>
                        <span className='max-w-full truncate'>
                          {method.name}
                        </span>
                        {disabledLabel && (
                          <span className='text-muted-foreground max-w-full truncate text-[11px] leading-4 font-normal'>
                            {disabledLabel}
                          </span>
                        )}
                      </span>
                    </Button>
                  )

                  return disabled ? (
                    <TooltipProvider key={method.type}>
                      <Tooltip>
                        <TooltipTrigger render={button} />
                        <TooltipContent>{disabledReason}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    button
                  )
                })}
              </div>
            ) : null}
            {!hasStandardPaymentMethods && !hasWaffoPaymentMethods && (
              <Alert>
                <AlertDescription>
                  {t(
                    'No payment methods available. Please contact administrator.'
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {enableWaffoTopup &&
            hasWaffoPaymentMethods &&
            onWaffoMethodSelect && (
              <div className='space-y-2.5 sm:space-y-3'>
                <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Waffo Payment')}
                </Label>
                <div className='grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-3'>
                  {waffoPayMethods?.map((method, index) => {
                    const loadingKey = `waffo-${index}`
                    const methodKey = `${method.payMethodType ?? 'unknown'}-${method.payMethodName ?? method.name}`
                    const waffoMin = waffoMinTopup || 0
                    const belowMin = waffoMin > topupAmount
                    const disabledReason = belowMin
                      ? t('Minimum topup amount: {{amount}}', {
                          amount: waffoMin,
                        })
                      : undefined
                    const disabledLabel = belowMin
                      ? `${t('Minimum:')} ${waffoMin}`
                      : undefined

                    let methodIcon = getPaymentIcon('waffo')
                    if (paymentLoading === loadingKey) {
                      methodIcon = <Loader2 className='h-4 w-4 animate-spin' />
                    } else if (method.icon) {
                      methodIcon = (
                        <img
                          src={method.icon}
                          alt={method.name}
                          className='h-4 w-4 object-contain'
                        />
                      )
                    }

                    const button = (
                      <Button
                        key={methodKey}
                        variant='outline'
                        onClick={() => onWaffoMethodSelect(method, index)}
                        disabled={belowMin || !!paymentLoading}
                        title={disabledReason}
                        aria-label={
                          disabledReason
                            ? `${method.name}. ${disabledReason}`
                            : method.name
                        }
                        className='min-h-14 min-w-0 justify-start gap-2 rounded-lg px-3 py-2 text-left'
                      >
                        {methodIcon}
                        <span className='flex min-w-0 flex-col items-start gap-0.5'>
                          <span className='max-w-full truncate'>
                            {method.name}
                          </span>
                          {disabledLabel && (
                            <span className='text-muted-foreground max-w-full truncate text-[11px] leading-4 font-normal'>
                              {disabledLabel}
                            </span>
                          )}
                        </span>
                      </Button>
                    )

                    return belowMin ? (
                      <TooltipProvider key={methodKey}>
                        <Tooltip>
                          <TooltipTrigger render={button} />
                          <TooltipContent>{disabledReason}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      button
                    )
                  })}
                </div>
              </div>
            )}
        </>
      )}
      {enableCreemTopup &&
        Array.isArray(creemProducts) &&
        creemProducts.length > 0 &&
        onCreemProductSelect && (
          <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Creem Payment')}
            </Label>
            <CreemProductsSection
              products={creemProducts}
              onProductSelect={onCreemProductSelect}
            />
          </div>
        )}
    </div>
  )

  const codeContent = (
    <RedemptionCodeForm
      redemptionCode={redemptionCode}
      onRedemptionCodeChange={onRedemptionCodeChange}
      onRedeem={onRedeem}
      redeeming={redeeming}
      redemptionResult={redemptionResult}
      topupLink={topupLink}
      showCodePurchase={showCodePurchase}
    />
  )

  let rechargeContent = codeContent
  if (!redemptionEnabled) {
    rechargeContent = (
      <div className='space-y-4'>
        {hasAnyTopup && onlineContent}
        <Alert>
          <AlertDescription>
            {t(
              'Redemption codes are disabled until the administrator confirms compliance terms.'
            )}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (redemptionEnabled && hasAnyTopup) {
    rechargeContent = (
      <Tabs
        value={activeRechargeMode}
        onValueChange={(value) => {
          if (value === 'code' || value === 'online') setRechargeMode(value)
        }}
      >
        <TabsList
          variant='line'
          className='grid h-auto w-full grid-cols-2 items-stretch group-data-horizontal/tabs:h-auto sm:w-fit'
        >
          <TabsTrigger
            value='code'
            className='h-auto min-h-11 px-3 py-2 leading-snug whitespace-normal'
          >
            <Ticket data-icon='inline-start' />
            <span className='min-w-0'>{t('Redemption Code Top-up')}</span>
          </TabsTrigger>
          <TabsTrigger
            value='online'
            className='h-auto min-h-11 px-3 py-2 leading-snug whitespace-normal'
          >
            <WalletCards data-icon='inline-start' />
            <span className='min-w-0'>{t('Online Payment')}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value='code' className='mt-6'>
          {codeContent}
        </TabsContent>
        <TabsContent value='online' className='mt-6'>
          {onlineContent}
        </TabsContent>
      </Tabs>
    )
  }

  let description: string | undefined = t(
    'Top up your balance with a redemption code.'
  )
  if (activeRechargeMode === 'online') {
    description = t('Choose an amount and payment method')
  } else if (!showCodePurchase) {
    description = t('Enter your redemption code')
  }
  if (!redemptionEnabled && !hasAnyTopup) description = undefined

  return (
    <TitledCard
      title={t('Add Funds')}
      description={description}
      icon={<WalletCards className='h-4 w-4' />}
      iconTone='success'
      className='rounded-lg'
      titleClassName='tracking-normal'
      headerClassName='rounded-t-lg'
      contentClassName='p-5 sm:p-6'
      disableHoverEffect
      action={
        onOpenBilling ? (
          <Button
            variant='outline'
            size='sm'
            onClick={onOpenBilling}
            className='w-full gap-2 sm:w-auto'
          >
            <Receipt className='h-4 w-4' />
            {t('Order History')}
          </Button>
        ) : null
      }
    >
      {rechargeContent}
    </TitledCard>
  )
}
