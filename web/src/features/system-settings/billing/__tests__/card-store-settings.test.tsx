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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { BillingSettings } from '..'
import { SettingsPageProvider } from '../../components/settings-page-context'
import { CardStoreSettingsSection } from '../card-store-settings-section'
import { getBillingSectionNavItems } from '../section-registry'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <CardStoreSettingsSection
          config=''
          legacyUrl='https://shop.example.com'
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('textbox', { name: 'Card store URL' })
}

async function renderGateway(
  initialEntry = '/system-settings/billing/payment',
  complianceConfirmed = true
) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        { key: 'TopUpLink', value: 'https://shop.example.com' },
        {
          key: 'payment_setting.compliance_confirmed',
          value: String(complianceConfirmed),
        },
        { key: 'payment_setting.compliance_terms_version', value: 'v1' },
        {
          key: 'card_store_setting.config',
          value: JSON.stringify({
            enabled: true,
            store_url: 'https://shop.example.com',
            amount_options: [{ amount: 5, url: '' }],
          }),
        },
      ],
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  const settings = createRoute({
    getParentRoute: () => auth,
    path: '/system-settings',
    component: Outlet,
  })
  const billing = createRoute({
    path: '/billing/$section',
    getParentRoute: () => settings,
    component: BillingSettings,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      auth.addChildren([settings.addChildren([billing])]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Payment Gateway' })
  await screen.findByRole('tab', { name: 'General' })
  return { router, client }
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

test('inherits the existing shop URL and saves ordered amount links using only the card store setting', async () => {
  await renderSettings()
  expect(
    screen.getByRole('switch', { name: 'Enable card store payment' })
  ).toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
    'https://shop.example.com'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Code face value (USD)' }),
    { target: { value: '10.5' } }
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Product URL' }), {
    target: { value: 'https://shop.example.com/ten' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(
    screen.getAllByRole('spinbutton', { name: 'Code face value (USD)' })[1],
    { target: { value: '50' } }
  )
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Product URL' })[1], {
    target: { value: 'https://shop.example.com/fifty' },
  })
  await userEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1])
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'card_store_setting.config',
      value: JSON.stringify({
        enabled: true,
        store_url: 'https://shop.example.com',
        amount_options: [
          { amount: 50, url: 'https://shop.example.com/fifty' },
          { amount: 10.5, url: 'https://shop.example.com/ten' },
        ],
      }),
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  )
})

test('invalid amount and unsafe URL show field errors and prevent saving', async () => {
  await renderSettings()
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Product URL' }), {
    target: { value: 'javascript:alert(1)' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(
      screen.getByRole('spinbutton', { name: 'Code face value (USD)' })
    ).toHaveAttribute('aria-invalid', 'true')
  )
  expect(screen.getByRole('textbox', { name: 'Product URL' })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(api.put).not.toHaveBeenCalled()
})

test('saves a blank product link so the quick amount follows the main card store URL', async () => {
  await renderSettings()
  fireEvent.change(screen.getByRole('textbox', { name: 'Card store URL' }), {
    target: { value: 'https://catfk.com/shop/PKJYNA3K' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Code face value (USD)' }),
    { target: { value: '5' } }
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'card_store_setting.config',
      value: JSON.stringify({
        enabled: true,
        store_url: 'https://catfk.com/shop/PKJYNA3K',
        amount_options: [{ amount: 5, url: '' }],
      }),
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('removing the last quick amount retains the shop link and allows disabling card store', async () => {
  await renderSettings()
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(
    screen.getByText(
      'No quick amounts configured. Users can still open the shop.'
    )
  ).toBeVisible()
  await userEvent.click(
    screen.getByRole('switch', { name: 'Enable card store payment' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'card_store_setting.config',
      value: JSON.stringify({
        enabled: false,
        store_url: 'https://shop.example.com',
        amount_options: [],
      }),
    })
  )
})

test('failed save retains edited links and permits retry', async () => {
  await renderSettings()
  vi.mocked(api.put).mockResolvedValueOnce({
    data: { success: false, message: 'Save failed' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Card store URL' }), {
    target: { value: 'https://new.example.com' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )
  expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
    'https://new.example.com'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
})

test('card store is the last gateway tab, preserves drafts and saves independently from existing gateways', async () => {
  await renderGateway()
  expect(
    getBillingSectionNavItems(i18next.t).map((item) => item.url)
  ).not.toContain('/system-settings/billing/card-store')
  const tabs = screen.getAllByRole('tab')
  expect(tabs).toHaveLength(7)
  expect(tabs.at(-1)).toHaveAccessibleName('Card Store Payment')
  fireEvent.change(
    screen.getByRole('spinbutton', {
      name: 'Price (local currency / USD)',
    }),
    { target: { value: '8.5' } }
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Waffo' }))
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Card Store Payment' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() =>
    expect(
      screen.getByRole('tab', { name: 'Card Store Payment' })
    ).toHaveAttribute('aria-selected', 'true')
  )
  const storeUrl = await screen.findByRole('textbox', {
    name: 'Card store URL',
  })
  expect(storeUrl).toHaveValue('https://shop.example.com')
  fireEvent.change(storeUrl, {
    target: { value: 'https://catfk.com/shop/PKJYNA3K' },
  })
  await userEvent.click(screen.getByRole('tab', { name: 'Epay' }))
  expect(screen.getByRole('textbox', { name: 'Epay endpoint' })).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Card Store Payment' }))
  expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
    'https://catfk.com/shop/PKJYNA3K'
  )
  expect(
    screen.queryByRole('button', { name: 'Save all settings' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
  expect(api.put).toHaveBeenLastCalledWith('/api/option/', {
    key: 'card_store_setting.config',
    value: JSON.stringify({
      enabled: true,
      store_url: 'https://catfk.com/shop/PKJYNA3K',
      amount_options: [{ amount: 5, url: '' }],
    }),
  })
  await userEvent.click(screen.getByRole('tab', { name: 'General' }))
  expect(
    screen.getByRole('spinbutton', {
      name: 'Price (local currency / USD)',
    })
  ).toHaveValue(8.5)
  expect(
    screen.queryByRole('button', { name: 'Save Changes' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Save all settings' })
  )
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
  expect(api.put).toHaveBeenLastCalledWith('/api/option/', {
    key: 'Price',
    value: 8.5,
  })
})

test('the card store link opens its tab within Payment Gateway', async () => {
  const { router } = await renderGateway(
    '/system-settings/billing/payment#card-store'
  )
  expect(
    await screen.findByRole('tab', { name: 'Card Store Payment' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
    'https://shop.example.com'
  )
  expect(router.state.location.pathname).toBe(
    '/system-settings/billing/payment'
  )
  expect(router.state.location.hash).toBe('card-store')
})

test.each([
  ['general', 'Save all settings'],
  ['card-store', 'Save Changes'],
])(
  'unconfirmed compliance locks the %s tab and its header save action',
  async (tab, saveLabel) => {
    await renderGateway(`/system-settings/billing/payment#${tab}`, false)
    const tabs = screen.getByRole('tablist').closest('[data-slot="tabs"]')
    expect(tabs).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    if (tab === 'card-store') {
      expect(
        screen.getByRole('textbox', { name: 'Card store URL' })
      ).toBeDisabled()
    }
    expect(api.put).not.toHaveBeenCalled()
  }
)

test('a background settings refresh updates a pristine card store form', async () => {
  const { client } = await renderGateway(
    '/system-settings/billing/payment#card-store'
  )
  await act(async () => {
    client.setQueryData(['system-options'], {
      success: true,
      data: [
        { key: 'payment_setting.compliance_confirmed', value: 'true' },
        { key: 'payment_setting.compliance_terms_version', value: 'v1' },
        {
          key: 'card_store_setting.config',
          value: JSON.stringify({
            enabled: false,
            store_url: 'https://updated.example.com',
            amount_options: [{ amount: 50, url: '' }],
          }),
        },
      ],
    })
  })
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
      'https://updated.example.com'
    )
  )
  expect(
    screen.getByRole('switch', { name: 'Enable card store payment' })
  ).not.toBeChecked()
  expect(
    screen.getByRole('spinbutton', { name: 'Code face value (USD)' })
  ).toHaveValue(50)
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
})

test('a background refresh preserves edited amount rows and reset restores the latest saved configuration', async () => {
  const { client } = await renderGateway(
    '/system-settings/billing/payment#card-store'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(
    screen.getAllByRole('spinbutton', { name: 'Code face value (USD)' })[1],
    {
      target: { value: '20' },
    }
  )
  await userEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1])
  await act(async () => {
    client.setQueryData(['system-options'], {
      success: true,
      data: [
        { key: 'payment_setting.compliance_confirmed', value: 'true' },
        { key: 'payment_setting.compliance_terms_version', value: 'v1' },
        { key: 'payment_setting.compliance_confirmed_by', value: '7' },
        {
          key: 'card_store_setting.config',
          value: JSON.stringify({
            enabled: true,
            store_url: 'https://updated.example.com',
            amount_options: [{ amount: 50, url: '' }],
          }),
        },
      ],
    })
  })
  await screen.findByText('Confirmed at - by user #7')
  expect(
    screen
      .getAllByRole('spinbutton', { name: 'Code face value (USD)' })
      .map((input) => (input as HTMLInputElement).value)
  ).toEqual(['20', '5'])
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByRole('textbox', { name: 'Card store URL' })).toHaveValue(
    'https://updated.example.com'
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Code face value (USD)' })
  ).toHaveValue(50)
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
})

test('an incomplete HTTP URL shows a field error instead of submitting an unusable shop link', async () => {
  await renderSettings()
  fireEvent.change(screen.getByRole('textbox', { name: 'Card store URL' }), {
    target: { value: 'https:shop.example.com' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Card store URL' })
    ).toHaveAttribute('aria-invalid', 'true')
  )
  expect(api.put).not.toHaveBeenCalled()
})

test('an overlong product URL displays the translated link validation message', async () => {
  await renderSettings()
  await userEvent.click(screen.getByRole('button', { name: 'Add new amount' }))
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Code face value (USD)' }),
    {
      target: { value: '5' },
    }
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Product URL' }), {
    target: { value: `https://shop.example.com/${'a'.repeat(2048)}` },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Card store links must be valid HTTP or HTTPS URLs.'
    )
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Product URL' })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(api.put).not.toHaveBeenCalled()
})
