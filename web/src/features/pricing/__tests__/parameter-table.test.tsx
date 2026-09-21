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
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ModelDetailsApi } from '../components/model-details-api'
import type { PricingModel, RequestParameter } from '../types'

function renderParameters(parameters: RequestParameter[]) {
  const model = {
    id: 1,
    model_name: 'w3.0-video-spicy',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    supported_endpoint_types: ['openai-video'],
    request_parameters: parameters,
  } as PricingModel

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsApi
        model={model}
        endpointMap={{ 'openai-video': { path: '/v1/videos', method: 'POST' } }}
      />
    </QueryClientProvider>
  )
  const name = screen.getByText(parameters[0].name)
  const row = name.closest('tr')
  if (!row) throw new Error('parameter row is missing')
  return within(row)
}

describe('parameter table', () => {
  it('lists every value an enum accepts and marks the default among them', () => {
    // Which tiers a model accepts is what separates it from its siblings, so
    // showing only the default hides the answer the reader came for.
    const row = renderParameters([
      {
        name: 'resolution',
        type: 'enum',
        enum: ['480p', '720p', '1080p'],
        default: '1080p',
        description: { en: 'Output resolution tier' },
      },
    ])

    expect(row.getByText('480p')).toBeInTheDocument()
    expect(row.getByText('720p')).toBeInTheDocument()
    expect(row.getByText('= 1080p')).toBeInTheDocument()
  })

  it('shows an enum without a default as plain values', () => {
    const row = renderParameters([
      {
        name: 'ratio',
        type: 'enum',
        enum: ['16:9', '9:16'],
        description: { en: 'Aspect ratio' },
      },
    ])

    expect(row.getByText('16:9')).toBeInTheDocument()
    expect(row.getByText('9:16')).toBeInTheDocument()
    expect(row.queryByText('= 16:9')).not.toBeInTheDocument()
  })

  it('keeps showing a default and range for a field with no enum', () => {
    const row = renderParameters([
      {
        name: 'duration',
        type: 'integer',
        default: '5',
        range: '2 ~ 30 | -1',
        description: { en: 'Seconds of video to produce' },
      },
    ])

    expect(row.getByText('5')).toBeInTheDocument()
    expect(row.getByText('2 ~ 30 | -1')).toBeInTheDocument()
  })
})
