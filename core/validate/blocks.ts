import type { ValidationIssue } from '../types'
import { lineAt } from './common'

const BLOCK_COMMENT_RE = /<!--\s+(\/)?wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)(?:\s+(\{[\s\S]*?\}))?\s+(\/)?-->/g
const HEX_RE = /(?<![&\w])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g

/** Pattern dosyalarında JSON içindeki PHP'yi nötr bir string'e çevirir */
function neutralizePhp(s: string): string {
  return s.replace(/<\?(?:php\b|=)[\s\S]*?\?>/g, (m) => 'X'.repeat(m.length))
}

/** Blok yorumlarının JSON geçerliliği + açılış/kapanış dengesi */
export function checkBlockMarkup(src: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const text = neutralizePhp(src)
  const stack: { name: string; line: number }[] = []
  for (const m of text.matchAll(BLOCK_COMMENT_RE)) {
    const [whole, closing, rawName, json, selfClosing] = m
    const name = rawName.includes('/') ? rawName : `core/${rawName}`
    const line = lineAt(src, m.index ?? 0)
    if (json) {
      try {
        JSON.parse(json)
      } catch (e) {
        issues.push({ rule: 'block-json', message: `Blok yorumu JSON'u geçersiz (${(e as Error).message}): ${whole.slice(0, 120)}`, line })
      }
    }
    if (selfClosing) continue
    if (closing) {
      const top = stack.pop()
      if (!top) issues.push({ rule: 'block-balance', message: `Açılmamış blok kapatıldı: wp:${rawName}`, line })
      else if (top.name !== name) {
        issues.push({ rule: 'block-balance', message: `Blok kapanış sırası hatalı: wp:${top.name.replace('core/', '')} (satır ${top.line}) beklenirken /wp:${rawName} bulundu`, line })
      }
    } else stack.push({ name, line })
  }
  for (const open of stack) {
    issues.push({ rule: 'block-balance', message: `Açılan blok kapanmadı: wp:${open.name.replace('core/', '')} (satır ${open.line})`, line: open.line })
  }
  return issues
}

/** Blok işaretlemesinde ham hex renk (yalnızca style özniteliği, <style> ve blok JSON'u içinde aranır) */
export function checkRawHex(src: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const zones: { start: number; text: string }[] = []
  for (const m of src.matchAll(/style\s*=\s*("[^"]*"|'[^']*')/g)) zones.push({ start: m.index ?? 0, text: m[0] })
  for (const m of src.matchAll(/<style[\s\S]*?<\/style>/g)) zones.push({ start: m.index ?? 0, text: m[0] })
  for (const m of src.matchAll(BLOCK_COMMENT_RE)) if (m[3]) zones.push({ start: m.index ?? 0, text: m[0] })
  const seen = new Set<number>()
  for (const z of zones) {
    for (const h of z.text.matchAll(HEX_RE)) {
      const at = z.start + (h.index ?? 0)
      if (seen.has(at)) continue
      seen.add(at)
      issues.push({ rule: 'raw-hex', message: `Ham hex renk kullanılmış: ${h[0]}, preset slug'ı kullan`, line: lineAt(src, at) })
    }
  }
  return issues
}

export function checkNoPhp(src: string): ValidationIssue[] {
  const m = /<\?(php\b|=)/.exec(src)
  return m ? [{ rule: 'no-php', message: 'Şablon/parça dosyasında PHP bulundu', line: lineAt(src, m.index) }] : []
}

export function checkPatternHeader(src: string, slug: string): ValidationIssue[] {
  const head = /^\s*<\?php\s*\/\*\*([\s\S]*?)\*\//.exec(src)
  if (!head) return [{ rule: 'pattern-header', message: 'Pattern başlık yorumu (<?php /** Title: ... */) eksik', line: 1 }]
  const issues: ValidationIssue[] = []
  if (!/^\s*\*?\s*Title:\s*\S/m.test(head[1])) issues.push({ rule: 'pattern-header', message: 'Pattern başlığında Title: eksik', line: 1 })
  const s = /^\s*\*?\s*Slug:\s*(\S+)/m.exec(head[1])
  if (!s) issues.push({ rule: 'pattern-header', message: 'Pattern başlığında Slug: eksik', line: 1 })
  else if (!s[1].startsWith(`${slug}/`)) issues.push({ rule: 'pattern-header', message: `Pattern slug'ı "${slug}/" ile başlamalı: ${s[1]}`, line: 1 })
  return issues
}
