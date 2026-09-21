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
import { describe, expect, it } from 'vitest'

import { buildSupportedParameters } from '../lib/mock-stats'
import type { PricingModel } from '../types'

function model(overrides: Partial<PricingModel>): PricingModel {
  return {
    id: 1,
    model_name: 'a-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    supported_endpoint_types: [],
    ...overrides,
  } as PricingModel
}

describe('API shape by endpoint', () => {
  it('describes a video model with the video request fields', () => {
    // The model name says nothing useful here; the endpoint it answers on does.
    const params = buildSupportedParameters(
      model({
        model_name: 'w3.0-video-prime-spicy',
        supported_endpoint_types: ['openai-video', 'openai-response'],
      })
    )

    expect(params.map((param) => param.name)).toEqual([
      'prompt',
      'seconds',
      'size',
      'input_reference',
    ])
  })

  it('describes an image model with the image request fields', () => {
    const params = buildSupportedParameters(
      model({
        model_name: 'wan2.6-t2i',
        supported_endpoint_types: ['image-generation'],
      })
    )

    expect(params.map((param) => param.name)).toContain('size')
    expect(params.map((param) => param.name)).not.toContain('temperature')
  })

  it('keeps chat fields for a model served on the chat endpoint', () => {
    const params = buildSupportedParameters(
      model({
        model_name: 'gpt-4o',
        supported_endpoint_types: ['openai'],
      })
    )

    expect(params.map((param) => param.name)).toContain('temperature')
  })

  it('describes a model with the fields its provider declares', () => {
    const params = buildSupportedParameters(
      model({
        model_name: 'w3.0-video-spicy',
        supported_endpoint_types: ['openai-video'],
        request_parameters: [
          {
            name: 'reference_videos',
            type: 'array',
            range: '≤ 5',
            description: { en: 'Reference video URLs', zh: '参考视频 URL' },
          },
          {
            name: 'resolution',
            type: 'enum',
            enum: ['480p', '720p', '1080p'],
            default: '1080p',
            description: { en: 'Output resolution tier', zh: '输出分辨率档位' },
          },
        ],
      }),
      'zh'
    )

    // The generic video table could never name a vendor field like this one.
    expect(params.map((param) => param.name)).toEqual([
      'reference_videos',
      'resolution',
    ])
    expect(params[0].descriptionText).toBe('参考视频 URL')
    expect(params[1].enumValues).toEqual(['480p', '720p', '1080p'])
    expect(params[1].defaultValue).toBe('1080p')
  })

  it('answers in the reading language a provider supplied', () => {
    const declared = {
      model_name: 'w3.0-video-spicy',
      supported_endpoint_types: ['openai-video'],
      request_parameters: [
        {
          name: 'prompt',
          type: 'string' as const,
          description: { en: 'Text description', zh: '文本描述' },
        },
      ],
    }

    expect(
      buildSupportedParameters(model(declared), 'en')[0].descriptionText
    ).toBe('Text description')
    expect(
      buildSupportedParameters(model(declared), 'zh-TW')[0].descriptionText
    ).toBe('文本描述')
  })

  it('falls back to the modality table when a provider declares nothing', () => {
    const params = buildSupportedParameters(
      model({
        model_name: 'w3.0-video-spicy',
        supported_endpoint_types: ['openai-video'],
        request_parameters: [],
      })
    )

    expect(params.map((param) => param.name)).toContain('seconds')
  })

  it('falls back to the model name when the server reports no endpoints', () => {
    const params = buildSupportedParameters(
      model({ model_name: 'sora-2', supported_endpoint_types: [] })
    )

    expect(params.map((param) => param.name)).toContain('prompt')
    expect(params.map((param) => param.name)).not.toContain('temperature')
  })
})
