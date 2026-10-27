// Görsel benzerlik puanı: kaynak sayfadaki bölümün "parmak izi" (kutular, tipografi, renk) ile üretilen
// temadaki karşılığı karşılaştırılır. Saf hesap; tarayıcıya dokunmaz (tests/visual.test.ts).
//
// Toplam 1500 puan:  piksel 500 · yerleşim 400 · tipografi 250 · renk 200 · içerik 150
// 750 puan (yarısı) geçilemezse hata, 1050 altı uyarıdır.

export const MAX_SCORE = 1500
export const PASS_SCORE = 750
export const GOOD_SCORE = 1050
export const WEIGHTS = { pixel: 500, layout: 400, type: 250, color: 200, content: 150 } as const

/** Sayfadaki görünür bir öğenin ölçüleri (kök öğeye göre koordinatlarla) */
export interface VNode {
  /** Eşleştirme anahtarı: normalize metin; görsellerde sıra numarası (img#1) */
  k: string
  tag: string
  x: number
  y: number
  w: number
  h: number
  fs: number
  fw: number
  lh: number
  ls: number
  color: string
  bg: string
  radius: number
  align: string
  tt: string
  /** Köke göre CSS yolu (otomatik düzeltme seçicisi için) */
  path: string
}

export interface VPrint {
  w: number
  h: number
  bg: string
  items: VNode[]
}

export interface VisualScore {
  total: number
  pixel: number
  layout: number
  type: number
  color: number
  content: number
}

export interface StyleDiff {
  /** Köke göre yol (üretilen sayfadaki öğe) */
  path: string
  key: string
  prop: 'font-size' | 'font-weight' | 'line-height' | 'letter-spacing' | 'color' | 'background-color' | 'border-radius' | 'text-align' | 'text-transform'
  /** Kaynaktaki değer (CSS dizgesi) */
  want: string
  have: string
}

export interface Comparison {
  score: VisualScore
  diffs: StyleDiff[]
  missing: string[]
  extra: number
  matched: number
  /** Yerleşim sapması en büyük öğeler (rapor / onarım istemi için) */
  worst: { key: string; dx: number; dy: number; dw: number; dh: number }[]
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** sapma tolerans içinde 1; max'ta 0; arası doğrusal */
export function ramp(dev: number, tol: number, max: number): number {
  const d = Math.abs(dev)
  if (!Number.isFinite(d)) return 0
  return d <= tol ? 1 : clamp01(1 - (d - tol) / (max - tol))
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(c: string): Rgba | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(c)
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { r: +m[1], g: +m[2], b: +m[3], a }
}

const transparent = (c: Rgba | null): boolean => !c || c.a < 0.05

function colorDistance(a: Rgba, b: Rgba): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/** İki renk dizgesinin benzerliği 0..1 (saydam = saydam → 1) */
export function colorSimilarity(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (transparent(ca) && transparent(cb)) return 1
  if (transparent(ca) !== transparent(cb)) return 0
  return ramp(colorDistance(ca!, cb!), 12, 150)
}

const lineHeightPx = (n: VNode): number => (Number.isFinite(n.lh) && n.lh > 0 ? n.lh : n.fs * 1.2)

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Kaynak öğelerini üretilenlerle metne göre sırayla eşleştirir */
export function matchNodes(src: VNode[], gen: VNode[]): { pairs: [VNode, VNode][]; missing: VNode[]; extra: number } {
  const pool = new Map<string, VNode[]>()
  for (const g of gen) pool.set(g.k, [...(pool.get(g.k) ?? []), g])
  const pairs: [VNode, VNode][] = []
  const missing: VNode[] = []
  for (const s of src) {
    const list = pool.get(s.k)
    const g = list?.shift()
    if (g) pairs.push([s, g])
    else missing.push(s)
  }
  let extra = 0
  for (const list of pool.values()) extra += list.length
  return { pairs, missing, extra }
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`

/**
 * Kaynak ve üretilen parmak izini karşılaştırır. `pixel` (0..1) tarayıcıda hesaplanan piksel benzerliğidir;
 * verilmezse kalan bileşenler 1500'e ölçeklenir.
 */
export function compare(src: VPrint, gen: VPrint, pixel: number | null): Comparison {
  const { pairs, missing, extra } = matchNodes(src.items, gen.items)
  const diffs: StyleDiff[] = []
  const worst: Comparison['worst'] = []

  const layout: number[] = []
  const type: number[] = []
  const color: number[] = []
  for (const [s, g] of pairs) {
    const dx = g.x - s.x
    const dy = g.y - s.y
    const dw = g.w - s.w
    const dh = g.h - s.h
    const l = mean([ramp(dx, 4, 120), ramp(dy, 8, 300), ramp(dw, 6, Math.max(40, s.w * 0.4)), ramp(dh, 6, Math.max(40, s.h * 0.6))])
    layout.push(l)
    if (l < 0.6) worst.push({ key: s.k, dx, dy, dw, dh })

    const isImage = s.k.startsWith('img#')
    if (!isImage) {
      const t = [
        ramp(g.fs - s.fs, 0.5, 8),
        ramp(g.fw - s.fw, 100, 500),
        ramp(lineHeightPx(g) - lineHeightPx(s), 2, 14),
        ramp((g.ls || 0) - (s.ls || 0), 0.3, 3),
        g.align === s.align ? 1 : 0,
        g.tt === s.tt ? 1 : 0
      ]
      type.push((t[0] * 3 + t[1] * 2 + t[2] * 2 + t[3] + t[4] + t[5]) / 10)
      const note = (prop: StyleDiff['prop'], want: string, have: string): void => {
        diffs.push({ path: g.path, key: s.k, prop, want, have })
      }
      if (t[0] < 1) note('font-size', px(s.fs), px(g.fs))
      if (t[1] < 1) note('font-weight', String(s.fw), String(g.fw))
      if (t[2] < 1 && Number.isFinite(s.lh) && s.lh > 0) note('line-height', px(s.lh), px(g.lh))
      if (t[3] < 1) note('letter-spacing', px(s.ls || 0), px(g.ls || 0))
      if (t[4] < 1) note('text-align', s.align, g.align)
      if (t[5] < 1) note('text-transform', s.tt, g.tt)
      const c = colorSimilarity(s.color, g.color)
      if (c < 1) note('color', s.color, g.color)
      const b = colorSimilarity(s.bg, g.bg)
      if (b < 1) note('background-color', s.bg, g.bg)
      const r = ramp(g.radius - s.radius, 2, 20)
      if (r < 1) note('border-radius', px(s.radius), px(g.radius))
      color.push(c * 0.5 + b * 0.35 + r * 0.15)
    } else {
      const b = colorSimilarity(s.bg, g.bg)
      const r = ramp(g.radius - s.radius, 2, 20)
      if (r < 1) diffs.push({ path: g.path, key: s.k, prop: 'border-radius', want: px(s.radius), have: px(g.radius) })
      color.push(b * 0.5 + r * 0.5)
    }
  }

  // Kökün kendisi: yükseklik ve arka plan
  const rootLayout = ramp(gen.h - src.h, 10, Math.max(60, src.h * 0.5))
  const rootBg = colorSimilarity(src.bg, gen.bg)
  const layoutScore = pairs.length ? mean(layout) * 0.75 + rootLayout * 0.25 : rootLayout * 0.25
  const typeScore = type.length ? mean(type) : pairs.length ? 1 : 0
  const colorScore = color.length ? mean(color) * 0.85 + rootBg * 0.15 : rootBg * 0.15

  const total = src.items.length
  const coverage = total ? pairs.length / total : 1
  const clutter = total ? Math.min(1, extra / total) : 0
  const content = clamp01(coverage * (1 - 0.3 * clutter))

  const parts = { layout: layoutScore, type: typeScore, color: colorScore, content }
  const weights: Record<string, number> = { layout: WEIGHTS.layout, type: WEIGHTS.type, color: WEIGHTS.color, content: WEIGHTS.content }
  let sum = 0
  let used = 0
  const out = { pixel: 0, layout: 0, type: 0, color: 0, content: 0 }
  for (const [k, v] of Object.entries(parts)) {
    out[k as keyof typeof parts] = Math.round(v * weights[k])
    sum += v * weights[k]
    used += weights[k]
  }
  if (pixel !== null) {
    out.pixel = Math.round(clamp01(pixel) * WEIGHTS.pixel)
    sum += clamp01(pixel) * WEIGHTS.pixel
    used += WEIGHTS.pixel
  }
  const totalScore = Math.round((sum / used) * MAX_SCORE)
  worst.sort((a, b) => Math.abs(b.dy) + Math.abs(b.dh) + Math.abs(b.dx) + Math.abs(b.dw) - (Math.abs(a.dy) + Math.abs(a.dh) + Math.abs(a.dx) + Math.abs(a.dw)))

  return {
    score: { total: totalScore, ...out },
    diffs,
    missing: missing.map((m) => m.k),
    extra,
    matched: pairs.length,
    worst: worst.slice(0, 5)
  }
}

/** Piksel farkı (0..1 ortalama kanal farkı) → benzerlik 0..1 */
export function pixelSimilarity(meanAbsDiff: number): number {
  return clamp01(1 - meanAbsDiff / 0.25)
}

/** Ağırlıklı ortalama (boş liste → 0) */
export function weightedMean(items: { value: number; weight: number }[]): number {
  const w = items.reduce((a, b) => a + b.weight, 0)
  return w ? items.reduce((a, b) => a + b.value * b.weight, 0) / w : 0
}

export type Verdict = 'pass' | 'warn' | 'fail'
export const verdict = (score: number): Verdict => (score < PASS_SCORE ? 'fail' : score < GOOD_SCORE ? 'warn' : 'pass')

/** "title { font-size: 48px }" biçiminde kısa özet (onarım istemi için) */
export function describeComparison(c: Comparison): string {
  const lines: string[] = []
  const b = c.score
  lines.push(`Puan ${b.total}/${MAX_SCORE} (piksel ${b.pixel}/${WEIGHTS.pixel}, yerleşim ${b.layout}/${WEIGHTS.layout}, tipografi ${b.type}/${WEIGHTS.type}, renk ${b.color}/${WEIGHTS.color}, içerik ${b.content}/${WEIGHTS.content})`)
  if (c.missing.length) lines.push(`Üretilen sayfada bulunmayan ${c.missing.length} öğe: ${c.missing.slice(0, 6).map((k) => JSON.stringify(k.slice(0, 40))).join(', ')}`)
  if (c.extra) lines.push(`Kaynakta olmayan ${c.extra} fazla öğe var`)
  for (const w of c.worst) lines.push(`Yerleşim ${JSON.stringify(w.key.slice(0, 40))}: x ${Math.round(w.dx)}px, y ${Math.round(w.dy)}px, genişlik ${Math.round(w.dw)}px, yükseklik ${Math.round(w.dh)}px sapma (üretilen − kaynak)`)
  for (const d of c.diffs.slice(0, 12)) lines.push(`${JSON.stringify(d.key.slice(0, 40))} ${d.prop}: kaynakta ${d.want}, üretilende ${d.have}`)
  return lines.join('\n')
}
