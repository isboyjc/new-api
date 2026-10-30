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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import type { TopupInfo } from '../../types'
import { RedemptionCodePurchasePage } from '../redemption-code-purchase-page'

const topupInfo: TopupInfo = {
  enable_online_topup: false,
  enable_stripe_topup: false,
  enable_redemption: true,
  pay_methods: [],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [],
  discount: {},
  topup_link: 'https://payments.example.com/redeem',
}
const i18n = createInstance()

function renderPage() {
  const router = createRouter({
    routeTree: createRootRoute({ component: RedemptionCodePurchasePage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  )
}

describe('RedemptionCodePurchasePage', () => {
  beforeEach(async () => {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: false,
      nsSeparator: false,
      resources: { en, zh },
      interpolation: { escapeValue: false },
    })
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: topupInfo },
    })
  })

  it('embeds the purchase URL and offers the same URL in a separate tab', async () => {
    renderPage()

    const frame = await screen.findByTitle('Redemption code purchase page')
    expect(frame).toHaveAttribute('src', topupInfo.topup_link)
    expect(frame).toHaveClass('flex-1', 'min-h-0', 'w-full')
    expect(frame.getAttribute('sandbox')?.split(' ')).toContain(
      'allow-same-origin'
    )
    const external = screen.getByRole('button', { name: /open in new tab/i })
    expect(external).toHaveAttribute('href', topupInfo.topup_link)
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getByRole('button', { name: 'Back to Wallet' })
    ).toHaveAttribute('href', '/wallet')
  })

  it('keeps same-origin pages isolated from the parent dashboard', async () => {
    const sameOriginLink = new URL('/shop', window.location.href).href
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: { ...topupInfo, topup_link: sameOriginLink },
      },
    })
    renderPage()
    const frame = await screen.findByTitle('Redemption code purchase page')
    expect(frame).toHaveAttribute('src', sameOriginLink)
    expect(frame.getAttribute('sandbox')?.split(' ')).not.toContain(
      'allow-same-origin'
    )
  })

  it.each(['', '   ', 'javascript:alert(1)', 'not-a-url'])(
    'shows the unconfigured state for an unusable purchase URL "%s"',
    async (topupLink) => {
      vi.mocked(api.get).mockResolvedValue({
        data: { success: true, data: { ...topupInfo, topup_link: topupLink } },
      })
      renderPage()
      expect(
        await screen.findByText(
          'The redemption code purchase page is not configured yet.'
        )
      ).toBeVisible()
      expect(
        screen.queryByTitle('Redemption code purchase page')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /open in new tab/i })
      ).not.toBeInTheDocument()
    }
  )

  it('keeps purchase actions unavailable until the configuration loads', async () => {
    let finishLoading: () => void = vi.fn()
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => {
        finishLoading = () =>
          resolve({ data: { success: true, data: topupInfo } })
      })
    )
    renderPage()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading...')
    expect(
      screen.queryByTitle('Redemption code purchase page')
    ).not.toBeInTheDocument()
    await act(async () => {
      finishLoading()
    })
    expect(
      await screen.findByTitle('Redemption code purchase page')
    ).toBeVisible()
  })

  it('keeps purchase unavailable when the server disables redemption', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { ...topupInfo, enable_redemption: false } },
    })
    renderPage()
    expect(
      await screen.findByText(
        'Redemption codes are disabled until the administrator confirms compliance terms.'
      )
    ).toBeVisible()
    expect(
      screen.queryByTitle('Redemption code purchase page')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /open in new tab/i })
    ).not.toBeInTheDocument()
  })

  it.each(['network', 'business'])(
    'offers retry after a %s failure and loads the purchase page after recovery',
    async (failure) => {
      const request = vi.mocked(api.get)
      if (failure === 'network') {
        request.mockRejectedValueOnce(new Error('Connection unavailable'))
      } else {
        request.mockResolvedValueOnce({
          data: { success: false, message: 'Unavailable' },
        })
      }
      renderPage()
      await userEvent.click(
        await screen.findByRole('button', { name: 'Retry' })
      )
      expect(
        await screen.findByTitle('Redemption code purchase page')
      ).toBeVisible()
    }
  )

  it('updates purchase copy and the iframe title when the language changes', async () => {
    renderPage()
    await screen.findByTitle('Redemption code purchase page')
    await act(() => i18n.changeLanguage('zh'))
    expect(screen.getByRole('heading', { name: '兑换码充值' })).toBeVisible()
    expect(screen.getByTitle('兑换码购买页面')).toBeVisible()
  })
})
