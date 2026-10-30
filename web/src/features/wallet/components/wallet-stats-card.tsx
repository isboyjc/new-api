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
import { Activity, BarChart3, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

interface WalletStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
}

export function WalletStatsCard(props: WalletStatsCardProps) {
  const { t } = useTranslation()
  if (props.loading) {
    return (
      <div className='grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-[1.25fr_1fr_1fr]'>
        {['balance', 'usage', 'requests'].map((key) => (
          <div
            key={key}
            className={
              key === 'balance'
                ? 'col-span-2 px-5 py-4 sm:col-span-1'
                : 'min-w-0 px-5 py-4'
            }
          >
            <Skeleton className='h-3.5 w-full' />
            <Skeleton className='mt-2 h-6 w-full sm:h-7' />
            <Skeleton className='mt-1.5 hidden h-3.5 w-24 md:block' />
          </div>
        ))}
      </div>
    )
  }

  const stats: {
    label: string
    value: string
    description: string
    icon: typeof WalletCards
    tone: IconBadgeTone
  }[] = [
    {
      label: t('Total Usage'),
      value: formatQuota(props.user?.used_quota ?? 0),
      description: t('Total consumed quota'),
      icon: BarChart3,
      tone: 'info',
    },
    {
      label: t('API Requests'),
      value: (props.user?.request_count ?? 0).toLocaleString(),
      description: t('Total requests made'),
      icon: Activity,
      tone: 'chart-4',
    },
  ]

  return (
    <section
      aria-label={t('Wallet Overview')}
      className='grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] overflow-hidden rounded-lg border sm:grid-cols-[1.25fr_1fr_1fr]'
    >
      <div className='bg-success/5 row-span-2 flex min-w-0 items-center gap-3 border-r px-3 py-4 sm:row-span-1 sm:gap-4 sm:px-5 sm:py-5'>
        <IconBadge tone='success' size='lg' className='max-sm:hidden'>
          <WalletCards />
        </IconBadge>
        <div className='min-w-0'>
          <div className='text-muted-foreground text-xs font-medium'>
            {t('Current Balance')}
          </div>
          <div className='mt-1 text-3xl font-semibold break-all tabular-nums'>
            {formatQuota(props.user?.quota ?? 0)}
          </div>
        </div>
      </div>
      {stats.map((item, index) => (
        <div
          key={item.label}
          className={
            index === 0
              ? 'col-start-2 grid min-w-0 grid-cols-2 items-center gap-2 border-b px-3 py-3 sm:col-auto sm:block sm:border-r sm:border-b-0 sm:px-5 sm:py-5'
              : 'col-start-2 grid min-w-0 grid-cols-2 items-center gap-2 px-3 py-3 sm:col-auto sm:block sm:px-5 sm:py-5'
          }
        >
          <div className='flex items-center gap-1.5 sm:gap-2.5'>
            <IconBadge tone={item.tone} size='stat' className='max-sm:hidden'>
              <item.icon />
            </IconBadge>
            <div className='text-muted-foreground text-xs font-medium'>
              {item.label}
            </div>
          </div>

          <div className='text-foreground min-w-0 text-right text-base font-semibold break-all tabular-nums sm:mt-2 sm:text-left sm:text-xl'>
            {item.value}
          </div>
          <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
            {item.description}
          </div>
        </div>
      ))}
    </section>
  )
}
