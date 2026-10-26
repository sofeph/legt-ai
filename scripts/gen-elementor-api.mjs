// Widget_Base ve üst sınıflarının ($this-> ile çağrılabilen) metot listesini kurulu Elementor'dan çıkarır.
// Doğrulayıcı, LLM'in uydurduğu metotları (ör. print_render_attribute) canlı testten önce yakalar.
// Kullanım: npm run setup:runtime (Elementor indirilir) → node scripts/gen-elementor-api.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const el = join(process.env.LEGT_RUNTIME_DIR || join(root, 'runtime'), 'plugins', 'elementor')
const files = ['includes/base/widget-base.php', 'includes/base/element-base.php', 'includes/base/controls-stack.php', 'core/base/base-object.php']

const methods = new Set()
for (const f of files) {
  const src = await readFile(join(el, f), 'utf8')
  for (const m of src.matchAll(/^\s*(?:(?:public|protected|final|abstract|static)\s+)*function\s+&?\s*(\w+)\s*\(/gm)) {
    if (!/\bprivate\s+(?:static\s+)?function\s+$/.test(src.slice(Math.max(0, m.index - 40), m.index + m[0].indexOf('function') + 9))) methods.add(m[1])
  }
}
const version = /Version:\s*(\S+)/.exec(await readFile(join(el, 'elementor.php'), 'utf8'))?.[1] ?? '?'
const out = join(root, 'core', 'validate', 'elementor-widget-api.json')
await writeFile(out, JSON.stringify({ elementor: version, source: files, methods: [...methods].sort() }, null, 2) + '\n')
console.log(`${methods.size} metot (Elementor ${version}) → ${out}`)
