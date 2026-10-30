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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Wallet } from '..'
import { RedemptionCodePurchasePage } from '../components/redemption-code-purchase-page'
import type { TopupInfo } from '../types'

const i18n = createInstance()
let topupOverrides: Partial<TopupInfo>

async function renderWallet(redeemVisible = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['status'], {
    SidebarModulesAdmin: JSON.stringify({
      personal: { redeem: redeemVisible },
    }),
  })
  const root = createRootRoute({ component: Outlet })
  const wallet = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: Wallet,
  })
  const purchase = createRoute({
    getParentRoute: () => root,
    path: '/wallet/redeem',
    component: RedemptionCodePurchasePage,
  })
  const router = createRouter({
    routeTree: root.addChildren([wallet, purchase]),
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByText('Add Funds')
}

beforeEach(async () => {
  topupOverrides = {}
  vi.stubGlobal('scrollTo', vi.fn())
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    switch (url) {
      case '/api/user/topup/info':
        data = {
          enable_online_topup: false,
          enable_stripe_topup: true,
          enable_redemption: true,
          pay_methods: [{ name: 'Stripe', type: 'stripe' }],
          min_topup: 1,
          stripe_min_topup: 1,
          amount_options: [10],
          discount: {},
          topup_link: 'https://payments.example.com/redeem',
          ...topupOverrides,
        }
        break
      case '/api/user/self':
        data = {
          id: 1,
          quota: 500000,
          used_quota: 0,
          request_count: 0,
          aff_count: 0,
          aff_quota: 0,
          aff_history_quota: 0,
        }
        break
      case '/api/user/aff':
        data = 'test-affiliate'
        break
      case '/api/subscription/plans':
        data = []
        break
      case '/api/subscription/self':
        data = { subscriptions: [], all_subscriptions: [] }
        break
      case '/api/user/topup/self':
        data = { items: [], total: 0 }
        break
      default:
        throw new Error(`Unexpected request: ${url}`)
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/stripe/amount') {
      return { data: { success: true, data: '1.00' } }
    }
    if (url === '/api/user/topup') {
      return { data: { success: true, data: 500000 } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('defaults to code recharge and opens the external shop without leaving the wallet', async () => {
  await renderWallet()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Custom Amount')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Stripe/ })
  ).not.toBeInTheDocument()
  const purchase = screen.getByRole('button', {
    name: 'Purchase Redemption Codes',
  })
  expect(purchase).toHaveAttribute(
    'href',
    'https://payments.example.com/redeem'
  )
  expect(purchase).toHaveAttribute('target', '_blank')
  expect(purchase).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByLabelText('Redemption Code')).toBeVisible()
})

it('opens the embedded shop from the wallet and returns to redeem a pasted code', async () => {
  const user = userEvent.setup()
  await renderWallet()
  expect(
    screen.getByRole('region', { name: 'Redeem to Balance' })
  ).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Open shop within site' })
  )
  expect(
    await screen.findByTitle('Redemption code purchase page')
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Back to Wallet' }))
  await user.type(
    await screen.findByLabelText('Redemption Code'),
    ' CDK-EXAMPLE {Enter}'
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/topup', {
      key: 'CDK-EXAMPLE',
    })
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Redemption Code')).toHaveValue('')
  )
  expect(
    screen.getByText(
      'Redemption complete. Funds have been added to your balance.'
    )
  ).toBeVisible()
})

it('hides online recharge and skips payment quotes even when all providers are configured', async () => {
  topupOverrides = {
    enable_online_topup: true,
    enable_stripe_topup: true,
    enable_creem_topup: true,
    enable_waffo_topup: true,
    enable_waffo_pancake_topup: true,
    creem_products: [
      {
        name: 'Creem Credits',
        productId: 'prod_credits',
        price: 10,
        quota: 5000000,
        currency: 'USD',
      },
    ],
    waffo_pay_methods: [{ name: 'Waffo Card', payMethodType: 'card' }],
  }
  await renderWallet()
  expect(screen.getByLabelText('Redemption Code')).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Custom Amount')).not.toBeInTheDocument()
  expect(
    screen.queryByText('Choose an amount and payment method')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Stripe|Waffo|Creem/ })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('hides code purchase when its admin module is disabled while retaining redemption', async () => {
  await renderWallet(false)
  expect(
    screen.queryByRole('button', { name: 'Purchase Redemption Codes' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Open shop within site' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Code purchases are currently unavailable. You can still redeem an existing code.'
    )
  ).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Redemption Code'), 'MY-CODE')
  expect(screen.getByRole('button', { name: 'Redeem' })).toBeEnabled()
})

it('shows only code recharge when online payments are disabled without an online payment warning', async () => {
  topupOverrides = { enable_stripe_topup: false, pay_methods: [] }
  await renderWallet()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Custom Amount')).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Online topup is not enabled. Please use redemption code or contact administrator.'
    )
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Purchase Redemption Codes' })
  ).toBeVisible()
  expect(screen.getByLabelText('Redemption Code')).toBeVisible()
})

it.each(['', 'javascript:alert(1)'])(
  'keeps redemption available without a purchase action when the shop URL is "%s"',
  async (topupLink) => {
    topupOverrides = { topup_link: topupLink }
    await renderWallet()
    expect(
      screen.getByText(
        'Code purchases are currently unavailable. You can still redeem an existing code.'
      )
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Purchase Redemption Codes' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Redemption Code')).toBeVisible()
  }
)

it('keeps online recharge hidden when redemption is disabled', async () => {
  topupOverrides = { enable_redemption: false }
  await renderWallet()
  expect(
    await screen.findByText(
      'Redemption codes are disabled until the administrator confirms compliance terms.'
    )
  ).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Redemption Code')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Custom Amount')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Stripe/ })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('prevents blank submissions and keeps the code after a failed redemption', async () => {
  await renderWallet()
  const input = screen.getByLabelText('Redemption Code')
  const redeem = screen.getByRole('button', { name: 'Redeem' })
  expect(redeem).toBeDisabled()
  await userEvent.type(input, '   ')
  expect(redeem).toBeDisabled()
  await userEvent.clear(input)
  await userEvent.type(input, 'INVALID-CODE')
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: false, message: 'Redemption code not found' },
  })
  await userEvent.click(redeem)
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/topup', {
      key: 'INVALID-CODE',
    })
  )
  expect(input).toHaveValue('INVALID-CODE')
  expect(redeem).toBeEnabled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.getByText('Redemption failed. Check your code and try again.')
  ).toBeVisible()
  await userEvent.type(input, '-CORRECTED')
  expect(input).not.toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.queryByText('Redemption failed. Check your code and try again.')
  ).not.toBeInTheDocument()
})

it('disables redemption while the request is pending and clears the code after success', async () => {
  await renderWallet()
  const input = screen.getByLabelText('Redemption Code')
  await userEvent.type(input, 'PENDING-CODE')
  let completeRedemption: (value: unknown) => void = () => {}
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeRedemption = resolve
      })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Redeem' }))
  expect(input).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Redeeming code...' })
  ).toBeDisabled()
  await userEvent.keyboard('{Enter}')
  expect(
    vi.mocked(api.post).mock.calls.filter(([url]) => url === '/api/user/topup')
  ).toHaveLength(1)
  await act(async () => {
    completeRedemption({ data: { success: true, data: 500000 } })
  })
  expect(input).toBeEnabled()
  expect(input).toHaveValue('')
})

it('shows purchase and business guidance above Add Funds with the QQ contact in announcements and translates it when language changes', async () => {
  await renderWallet()
  const guidance = screen.getByText(
    'Purchase a redemption code, then return to your wallet to add funds.'
  )
  const addFunds = screen.getByText('Add Funds')
  expect(
    guidance.compareDocumentPosition(addFunds) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    screen.getByText(
      'For business payments or invoices, contact customer service. See announcements for the customer service QQ number.'
    )
  ).toBeVisible()
  await act(() => i18n.changeLanguage('zh'))
  expect(
    screen.getByText('充值请先购买兑换码，购买后返回钱包兑换到账。')
  ).toBeVisible()
  expect(
    screen.getByText(
      '对公充值或开票请联系客服，客服 QQ 及联系方式请查看站内公告。'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: '购买兑换码' })).toBeVisible()
})

it('focuses the redemption input when the user already has a code', async () => {
  await renderWallet()
  await userEvent.click(
    screen.getByRole('button', { name: 'Already have a code? Redeem it now' })
  )
  expect(screen.getByLabelText('Redemption Code')).toHaveFocus()
  expect(
    screen.getByRole('region', { name: 'Wallet Overview' })
  ).toHaveTextContent('Current Balance')
})

it('opens order history from the wallet header', async () => {
  await renderWallet()
  await userEvent.click(screen.getByRole('button', { name: 'Order History' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Billing History')
})
