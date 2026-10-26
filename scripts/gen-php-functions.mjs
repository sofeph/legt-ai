// PHP (portable XAMPP) + WordPress çekirdeği + Elementor'daki global fonksiyon adlarını çıkarır.
// Doğrulayıcı, LLM'in uydurduğu global fonksiyonları (ör. get_reading_time) canlı testten önce yakalar.
// Kullanım: npm run setup:runtime → node scripts/gen-php-functions.mjs
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = process.env.LEGT_RUNTIME_DIR || join(root, 'runtime')
const php = join(runtime, 'xampp', 'php', process.platform === 'win32' ? 'php.exe' : 'php')

const internal = JSON.parse(execFileSync(existsSync(php) ? php : 'php', ['-n', '-r', 'echo json_encode(get_defined_functions()["internal"]);']).toString())
// -n ile yüklenmeyen ama WordPress'in kullandığı eklentiler (mbstring, gd, curl...) de sık çağrılır
const extPrefixes = ['mb_', 'iconv', 'imagecreate', 'image', 'curl_', 'openssl_', 'sodium_', 'exif_', 'finfo_', 'mysqli_', 'gz', 'zip_', 'intl', 'grapheme_', 'normalizer_', 'idn_']

async function walk(dir, out) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (e.name.endsWith('.php')) out.push(p)
  }
  return out
}

const userland = new Set()
for (const base of [join(runtime, 'wordpress', 'wp-includes'), join(runtime, 'wordpress', 'wp-admin', 'includes'), join(runtime, 'plugins', 'elementor')]) {
  if (!existsSync(base)) continue
  for (const f of await walk(base, [])) {
    const src = await readFile(f, 'utf8')
    // Görünürlük anahtarı olmayan her "function x(": global fonksiyonlar, pluggable.php'deki girintili
    // `if ( ! function_exists() ) : function x()` tanımları ve eski tarz metotlar (fazlası zararsız)
    for (const m of src.matchAll(/^[ \t]*function\s+&?\s*(\w+)\s*\(/gm)) userland.add(m[1].toLowerCase())
  }
}
const version = /\$wp_version\s*=\s*'([^']+)'/.exec(await readFile(join(runtime, 'wordpress', 'wp-includes', 'version.php'), 'utf8').catch(() => ''))?.[1] ?? '?'
const out = join(root, 'core', 'validate', 'php-functions.json')
await writeFile(out, JSON.stringify({ wordpress: version, extPrefixes, functions: [...new Set([...internal.map((f) => f.toLowerCase()), ...userland])].sort() }) + '\n')
console.log(`${internal.length} PHP + ${userland.size} WordPress/Elementor fonksiyonu → ${out}`)
