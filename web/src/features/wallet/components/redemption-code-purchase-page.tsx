/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { useTopupInfo } from '../hooks'
import { isCardStoreUrl } from '../lib/card-store'

export function RedemptionCodePurchasePage() {
  const { t } = useTranslation()
  const { topupInfo, loading, error, refetch } = useTopupInfo()
  const configuredLink = topupInfo?.topup_link?.trim() || ''
  const topupLink = isCardStoreUrl(configuredLink) ? configuredLink : ''
  const redemptionEnabled = topupInfo?.enable_redemption !== false
  let iframeSandbox =
    'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
  // External shops need their own origin for module scripts and storage.
  if (topupLink && new URL(topupLink).origin !== window.location.origin) {
    iframeSandbox += ' allow-same-origin'
  }
  let purchaseContent: ReactNode

  if (loading) {
    purchaseContent = (
      <div role='status'>
        <LoadingState />
      </div>
    )
  } else if (error) {
    purchaseContent = <ErrorState onRetry={() => void refetch()} />
  } else if (!redemptionEnabled) {
    purchaseContent = (
      <Alert>
        <AlertDescription>
          {t(
            'Redemption codes are disabled until the administrator confirms compliance terms.'
          )}
        </AlertDescription>
      </Alert>
    )
  } else if (topupLink) {
    purchaseContent = (
      <div className='flex min-h-0 flex-1 flex-col gap-2'>
        <p className='text-muted-foreground shrink-0 px-3 text-sm sm:px-4'>
          {t('Purchase a redemption code here, then redeem it in your wallet.')}
        </p>
        <iframe
          src={topupLink}
          title={t('Redemption code purchase page')}
          sandbox={iframeSandbox}
          className='bg-background min-h-0 w-full flex-1 border-0'
        />
      </div>
    )
  } else {
    purchaseContent = (
      <Alert>
        <AlertDescription>
          {t('The redemption code purchase page is not configured yet.')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <SectionPageLayout
      fixedContent
      stackActionsOnMobile
      contentClassName={
        !loading && !error && redemptionEnabled && topupLink
          ? 'flex flex-col p-0 sm:p-0'
          : undefined
      }
    >
      <SectionPageLayout.Title>
        {t('Redemption Code Top-up')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button variant='outline' render={<Link to='/wallet' />}>
          <ArrowLeft data-icon='inline-start' />
          {t('Back to Wallet')}
        </Button>
        {!loading && !error && redemptionEnabled && topupLink && (
          <Button
            render={
              <a href={topupLink} target='_blank' rel='noopener noreferrer' />
            }
          >
            <ExternalLink data-icon='inline-start' />
            {t('Open in new tab')}
          </Button>
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 w-full flex-col'>
          {purchaseContent}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
