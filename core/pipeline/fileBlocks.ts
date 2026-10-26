export interface FileBlock {
  path: string
  content: string
}

const BLOCK_RE = /<<<FILE\s+([^\s>]+)\s*>>>\r?\n?([\s\S]*?)\r?\n?<<<END>>>/g

/** LLM çıktısından <<<FILE path>>> ... <<<END>>> bloklarını çıkarır; dışındaki her şey atılır */
export function parseFileBlocks(output: string): FileBlock[] {
  return [...output.matchAll(BLOCK_RE)].map((m) => ({ path: m[1].trim(), content: m[2] }))
}

/** Prompt'taki çıktı örneğinin aynen geri yazılması (küçük modellerde sık) */
const PLACEHOLDER_RE = /^\s*\((tam içerik|dosyanın tam ve eksiksiz içeriği|tam ve eksiksiz içerik)\)\s*$/i

function unfence(content: string): string {
  // Bazı modeller içeriği yine de ``` içine alır
  const fenced = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(content.trim())
  return fenced ? fenced[1] : content
}

/**
 * Beklenen dosyanın içeriğini döndürür. Model <<<END>>> yazmayı unuttuysa
 * (stream kesildi, bağlam doldu) ya da yalnızca prompt'taki örneği yankıladıysa null döner;
 * yarım dosya kabul edilmez. Prompt'u yankılayan modellerde son geçerli blok seçilir.
 */
export function extractFile(output: string, expectedPath: string): string | null {
  const blocks = parseFileBlocks(output).filter((b) => b.content.trim() && !PLACEHOLDER_RE.test(unfence(b.content)))
  const matching = blocks.filter((b) => b.path === expectedPath)
  const hit = matching.at(-1) ?? (blocks.length === 1 ? blocks[0] : undefined)
  if (!hit) return null
  return unfence(hit.content).replace(/\s+$/, '') + '\n'
}

/**
 * extractFile + yerel modellerin sık yaptığı biçim kayması: işaretçi yerine tek bir ``` bloğu ya da
 * doğrudan dosya içeriği. Yalnızca çıktının ardından statik doğrulamadan geçirildiği yerlerde
 * (canlı test onarımı) kullanılır; yanıtta birden fazla kod bloğu varsa tahmin yapılmaz.
 */
export function extractFileLenient(output: string, expectedPath: string): string | null {
  const strict = extractFile(output, expectedPath)
  if (strict !== null || output.includes('<<<FILE')) return strict
  const fences = [...output.matchAll(/```[\w-]*\r?\n([\s\S]*?)\r?\n```/g)]
  if (fences.length === 1 && fences[0][1].trim()) return fences[0][1].replace(/\s+$/, '') + '\n'
  if (fences.length > 1) return null
  // Çitsiz yanıt: dosya türünün beklenen başlangıcıyla başlamalı, sondaki yetim ``` atılır
  const body = output.trim().replace(/^```[\w-]*\r?\n/, '').replace(/\r?\n```\s*$/, '')
  const ext = expectedPath.slice(expectedPath.lastIndexOf('.') + 1).toLowerCase()
  const looksRight = ext === 'php' ? /^<\?php\b/.test(body) : ext === 'json' ? /^[{[]/.test(body) : ext === 'html' ? /^<!--\s*wp:/.test(body) : false
  return looksRight ? body + '\n' : null
}
