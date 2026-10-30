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
import { z } from 'zod'

import { isCardStoreUrl } from '@/features/wallet/lib/card-store'
import type { CardStoreConfig } from '@/features/wallet/types'

const urlSchema = z.string().trim()

export const cardStoreSchema = z
  .object({
    enabled: z.boolean(),
    store_url: urlSchema,
    amount_options: z
      .array(
        z.object({
          amount: z.coerce
            .number()
            .positive(
              'Card store amounts must be greater than 0 and no more than 1,000,000,000 USD.'
            )
            .max(
              1e9,
              'Card store amounts must be greater than 0 and no more than 1,000,000,000 USD.'
            ),
          url: urlSchema.refine(
            (value) => value === '' || isCardStoreUrl(value),
            { message: 'Card store links must be valid HTTP or HTTPS URLs.' }
          ),
        })
      )
      .max(24, 'Configure up to 24 quick amounts.'),
  })
  .superRefine((value, context) => {
    if (
      (value.enabled || value.store_url) &&
      !isCardStoreUrl(value.store_url)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['store_url'],
        message: 'Card store links must be valid HTTP or HTTPS URLs.',
      })
    }
    const amounts = new Set<number>()
    value.amount_options.forEach((option, index) => {
      if (amounts.has(option.amount)) {
        context.addIssue({
          code: 'custom',
          path: ['amount_options', index, 'amount'],
          message: 'Quick amounts must be unique.',
        })
      }
      amounts.add(option.amount)
    })
  })

export type CardStoreValues = z.infer<typeof cardStoreSchema>

export function getCardStoreDefaults(
  value: string,
  legacyUrl: string
): CardStoreConfig {
  if (value) {
    try {
      return cardStoreSchema.parse(JSON.parse(value))
    } catch {
      return { enabled: false, store_url: '', amount_options: [] }
    }
  }
  const storeUrl = legacyUrl.trim()
  return {
    enabled: isCardStoreUrl(storeUrl),
    store_url: storeUrl,
    amount_options: [],
  }
}
