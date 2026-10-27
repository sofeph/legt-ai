import { describe, expect, it } from 'vitest'
import { manualParallelCommand, ollamaEnv } from '@core/ollama/setup'

describe('ollama kurulum yardımcıları', () => {
  it('paralel ajan sayısını 1-10 aralığına sıkıştırıp ortam değişkenlerini üretir', () => {
    expect(ollamaEnv(3)).toEqual({ OLLAMA_NUM_PARALLEL: '3', OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' })
    expect(ollamaEnv(99).OLLAMA_NUM_PARALLEL).toBe('10')
    expect(ollamaEnv(0).OLLAMA_NUM_PARALLEL).toBe('3')
  })
  it('elle komut paralel değeri içerir', () => {
    expect(manualParallelCommand(4)).toContain('OLLAMA_NUM_PARALLEL')
    expect(manualParallelCommand(4)).toContain('4')
  })
})
