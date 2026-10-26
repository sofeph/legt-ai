import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeStatus } from '../types'
import { randomPort, waitForPort } from './ports'

/**
 * Canlı test ortamı: portable XAMPP'ın Apache + MariaDB + PHP'si, WordPress çekirdeği ve Elementor.
 * Hepsi `runtime/` altında durur (scripts/setup-runtime.mjs indirir). Kullanıcının kendi XAMPP
 * kurulumuna, 80/3306 portlarına ya da xampp-control ayarlarına dokunulmaz: her test kendi
 * php.ini / httpd.conf'unu yazar, rastgele portlarla ve geçici bir veri klasörüyle çalışır.
 */
export interface RuntimePaths {
  dir: string
  xampp: string
  mysqlTemplate: string
  wordpress: string
  plugins: string
  browsers: string
}

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name)
/** Apache yapılandırması ters bölü sevmez */
const fwd = (p: string): string => p.replace(/\\/g, '/')

export function runtimePaths(dir: string): RuntimePaths {
  return {
    dir,
    xampp: process.env.LEGT_XAMPP_DIR || join(dir, 'xampp'),
    mysqlTemplate: join(dir, 'mysql-data-template'),
    wordpress: join(dir, 'wordpress'),
    plugins: join(dir, 'plugins'),
    browsers: join(dir, 'browsers')
  }
}

export const binaries = (p: RuntimePaths): { php: string; httpd: string; mysqld: string } => ({
  php: join(p.xampp, 'php', exe('php')),
  httpd: join(p.xampp, 'apache', 'bin', exe('httpd')),
  mysqld: join(p.xampp, 'mysql', 'bin', exe('mysqld'))
})

async function versionFrom(file: string, re: RegExp): Promise<string | null> {
  try {
    return re.exec(await readFile(file, 'utf8'))?.[1] ?? null
  } catch {
    return null
  }
}

export const wpVersion = (wpDir: string): Promise<string | null> => versionFrom(join(wpDir, 'wp-includes', 'version.php'), /\$wp_version\s*=\s*'([^']+)'/)

export async function detectRuntime(dir: string, needElementor: boolean): Promise<RuntimeStatus> {
  const p = runtimePaths(dir)
  const bin = binaries(p)
  const has = (f: string): string | null => (existsSync(f) ? f : null)
  const status: RuntimeStatus = {
    ok: false,
    dir,
    php: has(bin.php),
    httpd: has(bin.httpd),
    mysqld: has(bin.mysqld),
    wordpress: await wpVersion(p.wordpress),
    elementor: await versionFrom(join(p.plugins, 'elementor', 'elementor.php'), /^\s*\*\s*Version:\s*(\S+)/m),
    problems: []
  }
  const setup = 'npm run setup:runtime'
  if (!status.php || !status.httpd || !status.mysqld) status.problems.push(`Portable XAMPP eksik (${p.xampp}): ${setup}`)
  if (!status.wordpress) status.problems.push(`WordPress çekirdeği eksik (${p.wordpress}): ${setup}`)
  if (needElementor && !status.elementor) status.problems.push(`Elementor eksik (${join(p.plugins, 'elementor')}): ${setup}`)
  if (status.mysqld && !existsSync(p.mysqlTemplate) && !existsSync(join(p.xampp, 'mysql', 'data'))) status.problems.push('MariaDB veri şablonu yok: npm run setup:runtime -- --force')
  status.ok = status.problems.length === 0
  return status
}

// ---- Yapılandırma dosyaları ----

const PHP_EXTENSIONS = ['curl', 'exif', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'sodium', 'zip']

export async function phpIni(phpDir: string, work: { logs: string; tmp: string }): Promise<string> {
  const extDir = join(phpDir, 'ext')
  // Windows'ta eklentiler ayrı DLL; olmayanı yazarsak PHP her istekte uyarı basar
  const available = existsSync(extDir) ? new Set(await readdir(extDir)) : new Set<string>()
  const exts = PHP_EXTENSIONS.filter((e) => available.has(`php_${e}.dll`) || available.has(`${e}.so`))
  return [
    '[PHP]',
    'engine = On',
    'short_open_tag = Off',
    'memory_limit = 512M',
    'max_execution_time = 120',
    'error_reporting = E_ALL',
    'display_errors = Off',
    'display_startup_errors = Off',
    'log_errors = On',
    `error_log = "${fwd(join(work.logs, 'php-error.log'))}"`,
    'post_max_size = 64M',
    'upload_max_filesize = 64M',
    'allow_url_fopen = On',
    `sys_temp_dir = "${fwd(work.tmp)}"`,
    `upload_tmp_dir = "${fwd(work.tmp)}"`,
    `session.save_path = "${fwd(work.tmp)}"`,
    'date.timezone = UTC',
    ...(available.size ? [`extension_dir = "${fwd(extDir)}"`, ...exts.map((e) => `extension = ${e}`)] : []),
    ''
  ].join('\n')
}

const APACHE_MODULES = ['access_compat', 'alias', 'authz_core', 'authz_host', 'dir', 'env', 'headers', 'log_config', 'mime', 'rewrite', 'setenvif']

export interface HttpdConfInput {
  apacheDir: string
  phpDir: string
  confDir: string
  siteDir: string
  logsDir: string
  port: number
  /** apache/modules içindeki dosyalar (olmayan modül yüklenmez) */
  modules: string[]
  /** php içindeki dosyalar (php8apache2_4.dll / php8ts.dll tespiti için) */
  phpFiles: string[]
}

/** Yalnızca WordPress için gereken en küçük httpd.conf; XAMPP'ın kendi conf/ klasörüne dokunulmaz */
export function httpdConf(i: HttpdConfInput): string {
  const sapi = i.phpFiles.find((f) => /^php\d+apache2_4\.dll$/i.test(f)) ?? i.phpFiles.find((f) => /^libphp\d*\.so$/.test(f))
  if (!sapi) throw new Error(`${i.phpDir} içinde Apache PHP modülü (php*apache2_4.dll) yok`)
  const major = /php(\d+)/.exec(sapi)?.[1] ?? '8'
  const ts = i.phpFiles.find((f) => f.toLowerCase() === `php${major}ts.dll`)
  const mods = APACHE_MODULES.filter((m) => i.modules.includes(`mod_${m}.so`))
  return [
    `ServerRoot "${fwd(i.apacheDir)}"`,
    `Listen 127.0.0.1:${i.port}`,
    `ServerName 127.0.0.1:${i.port}`,
    ...mods.map((m) => `LoadModule ${m}_module modules/mod_${m}.so`),
    ...(ts ? [`LoadFile "${fwd(join(i.phpDir, ts))}"`] : []),
    `LoadModule ${major === '8' ? 'php' : `php${major}`}_module "${fwd(join(i.phpDir, sapi))}"`,
    `PHPIniDir "${fwd(i.confDir)}"`,
    '<FilesMatch "\\.php$">',
    '    SetHandler application/x-httpd-php',
    '</FilesMatch>',
    'TypesConfig conf/mime.types',
    'AddType application/javascript .js',
    'AddType image/svg+xml .svg',
    'AddType font/woff2 .woff2',
    `DocumentRoot "${fwd(i.siteDir)}"`,
    '<Directory />',
    '    AllowOverride None',
    '    Require all denied',
    '</Directory>',
    `<Directory "${fwd(i.siteDir)}">`,
    '    Options FollowSymLinks',
    '    AllowOverride All',
    '    Require all granted',
    '</Directory>',
    'DirectoryIndex index.php index.html',
    `ErrorLog "${fwd(join(i.logsDir, 'apache-error.log'))}"`,
    'LogLevel warn',
    'LogFormat "%h %t \\"%r\\" %>s %b" common',
    `CustomLog "${fwd(join(i.logsDir, 'apache-access.log'))}" common`,
    `PidFile "${fwd(join(i.logsDir, 'httpd.pid'))}"`,
    'EnableSendfile Off',
    'EnableMMAP Off',
    '<IfModule mpm_winnt_module>',
    '    ThreadsPerChild 64',
    '    MaxConnectionsPerChild 0',
    '    AcceptFilter http none',
    '</IfModule>',
    ''
  ].join('\n')
}

export function wpConfig(o: { dbPort: number; siteUrl: string; debugLog: string; salt: () => string }): string {
  const keys = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']
  const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return [
    '<?php',
    '// LEGT AI canlı test sitesi — her testte yeniden yazılır.',
    "define( 'DB_NAME', 'legt_wp' );",
    "define( 'DB_USER', 'root' );",
    "define( 'DB_PASSWORD', '' );",
    `define( 'DB_HOST', '127.0.0.1:${o.dbPort}' );`,
    "define( 'DB_CHARSET', 'utf8mb4' );",
    "define( 'DB_COLLATE', '' );",
    ...keys.map((k) => `define( '${k}', ${q(o.salt())} );`),
    "$table_prefix = 'wp_';",
    `define( 'WP_HOME', ${q(o.siteUrl)} );`,
    `define( 'WP_SITEURL', ${q(o.siteUrl)} );`,
    "define( 'WP_DEBUG', true );",
    `define( 'WP_DEBUG_LOG', ${q(fwd(o.debugLog))} );`,
    "define( 'WP_DEBUG_DISPLAY', false );",
    "@ini_set( 'display_errors', '0' );",
    "define( 'WP_ENVIRONMENT_TYPE', 'local' );",
    "define( 'DISABLE_WP_CRON', true );",
    "define( 'AUTOMATIC_UPDATER_DISABLED', true );",
    "define( 'WP_AUTO_UPDATE_CORE', false );",
    // Çevrim dışı: WordPress ve eklentiler dışarı istek atmaz
    "define( 'WP_HTTP_BLOCK_EXTERNAL', true );",
    "define( 'FS_METHOD', 'direct' );",
    "if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', __DIR__ . '/' );",
    "require_once ABSPATH . 'wp-settings.php';",
    ''
  ].join('\n')
}

// ---- Süreçler ----

/** Windows'ta Apache alt süreç açar; tüm ağaç kapatılmazsa port açık kalır */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
}

const live = new Set<WpServer>()

/** Uygulama kapanırken çağrılır; yetim httpd/mysqld kalmasın */
export function stopAllServers(): void {
  for (const s of live) s.stopSync()
}

export interface WpServerOptions {
  paths: RuntimePaths
  /** Geçici çalışma klasörü (site, veritabanı, loglar); OneDrive vb. senkron klasörlerin dışında */
  workDir: string
  log?: (line: string) => void
  signal?: AbortSignal
}

/**
 * Bir projenin test sitesi: Apache + MariaDB rastgele portlarda, WordPress `workDir/site` altında.
 * Veritabanı her `start()`'ta şablondan sıfırlanır; tema/eklenti dosyaları `sync` ile kopyalanır.
 */
export class WpServer {
  httpPort = 0
  dbPort = 0
  private procs: ChildProcess[] = []
  private logStreams: WriteStream[] = []
  readonly site: string
  readonly logs: string
  readonly conf: string
  readonly tmp: string
  readonly data: string

  constructor(private opts: WpServerOptions) {
    this.site = join(opts.workDir, 'site')
    this.logs = join(opts.workDir, 'logs')
    this.conf = join(opts.workDir, 'conf')
    this.tmp = join(opts.workDir, 'tmp')
    this.data = join(opts.workDir, 'mysql')
  }

  get url(): string {
    return `http://127.0.0.1:${this.httpPort}`
  }

  get debugLog(): string {
    return join(this.logs, 'debug.log')
  }

  get running(): boolean {
    return this.procs.length > 0 && this.procs.every((p) => p.exitCode === null)
  }

  private log(line: string): void {
    this.opts.log?.(line)
  }

  /** WordPress çekirdeği yoksa ya da sürümü değiştiyse kopyalar (tema/eklentiler hariç) */
  async prepareCore(): Promise<string | null> {
    const want = await wpVersion(this.opts.paths.wordpress)
    const have = await wpVersion(this.site)
    if (want && want === have) return want
    this.log(`WordPress ${want} test sitesine kopyalanıyor…`)
    await rm(this.site, { recursive: true, force: true })
    await cp(this.opts.paths.wordpress, this.site, { recursive: true })
    return want
  }

  /** Tema / eklenti klasörünü test sitesine (yeniden) kopyalar */
  async syncDir(src: string, kind: 'themes' | 'plugins', name: string): Promise<void> {
    const dest = join(this.site, 'wp-content', kind, name)
    await rm(dest, { recursive: true, force: true })
    if (existsSync(src)) await cp(src, dest, { recursive: true })
  }

  /** Test ortamı mu-plugin'i (çevrim dışı, güncelleme denetimi yok) */
  async installMuPlugin(src: string): Promise<void> {
    const dir = join(this.site, 'wp-content', 'mu-plugins')
    await mkdir(dir, { recursive: true })
    await cp(src, join(dir, 'legt-test.php'))
  }

  async ensurePlugin(slug: string): Promise<void> {
    const dest = join(this.site, 'wp-content', 'plugins', slug)
    if (!existsSync(dest)) await cp(join(this.opts.paths.plugins, slug), dest, { recursive: true })
  }

  private spawnLogged(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
    const out = createWriteStream(join(this.logs, `${name}.out.log`), { flags: 'a' })
    this.logStreams.push(out)
    const child = spawn(cmd, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.pipe(out, { end: false })
    child.stderr?.pipe(out, { end: false })
    child.once('exit', (code) => this.log(`${name} kapandı (kod ${code})`))
    this.procs.push(child)
    return child
  }

  private env(): NodeJS.ProcessEnv {
    const phpDir = join(this.opts.paths.xampp, 'php')
    const sep = process.platform === 'win32' ? ';' : ':'
    // PHP eklentilerinin bağımlı DLL'leri (libssh2, icu...) php/ klasöründe
    return { ...process.env, PATH: `${phpDir}${sep}${process.env.PATH ?? ''}`, PHPRC: this.conf, TMP: this.tmp, TEMP: this.tmp }
  }

  async start(): Promise<void> {
    const { paths, signal } = this.opts
    const bin = binaries(paths)
    await this.stop()
    await rm(this.logs, { recursive: true, force: true })
    await Promise.all([this.logs, this.conf, this.tmp].map((d) => mkdir(d, { recursive: true })))

    // MariaDB: her testte temiz veri klasörü
    await rm(this.data, { recursive: true, force: true })
    const template = existsSync(paths.mysqlTemplate) ? paths.mysqlTemplate : join(paths.xampp, 'mysql', 'data')
    await cp(template, this.data, { recursive: true })

    const phpDir = join(paths.xampp, 'php')
    const apacheDir = join(paths.xampp, 'apache')
    await writeFile(join(this.conf, 'php.ini'), await phpIni(phpDir, { logs: this.logs, tmp: this.tmp }))
    const [modules, phpFiles] = await Promise.all([readdir(join(apacheDir, 'modules')).catch(() => []), readdir(phpDir)])

    // Rastgele port; nadiren başka bir süreç araya girerse yeni portla yeniden denenir
    for (let attempt = 1; ; attempt++) {
      this.dbPort = await randomPort()
      this.httpPort = await randomPort([this.dbPort])
      const env = this.env()
      const mysqld = this.spawnLogged('mysqld', bin.mysqld, [
        '--no-defaults',
        `--basedir=${join(paths.xampp, 'mysql')}`,
        `--datadir=${this.data}`,
        `--port=${this.dbPort}`,
        '--bind-address=127.0.0.1',
        // Yalnızca 127.0.0.1'de, rastgele portta, geçici veriyle: yetki tablosu gereksiz
        '--skip-grant-tables',
        '--skip-name-resolve',
        '--skip-log-bin',
        '--innodb-flush-log-at-trx-commit=2',
        '--character-set-server=utf8mb4',
        '--collation-server=utf8mb4_unicode_ci',
        '--console'
      ], env)
      await writeFile(
        join(this.conf, 'httpd.conf'),
        httpdConf({ apacheDir, phpDir, confDir: this.conf, siteDir: this.site, logsDir: this.logs, port: this.httpPort, modules, phpFiles })
      )
      const httpd = this.spawnLogged('httpd', bin.httpd, ['-f', join(this.conf, 'httpd.conf'), '-d', apacheDir], env)
      try {
        await Promise.all([
          waitForPort(this.dbPort, { timeoutMs: 30000, alive: () => mysqld.exitCode === null, signal }),
          waitForPort(this.httpPort, { timeoutMs: 30000, alive: () => httpd.exitCode === null, signal })
        ])
        this.log(`MariaDB 127.0.0.1:${this.dbPort}, Apache ${this.url}`)
        live.add(this)
        return
      } catch (e) {
        await this.stop()
        if (signal?.aborted || attempt >= 3) {
          const tail = await this.tailLogs()
          throw new Error(`Sunucular başlatılamadı: ${(e as Error).message}${tail ? `\n${tail}` : ''}`)
        }
        this.log(`Başlatma denemesi ${attempt} başarısız (${(e as Error).message}), yeni portlarla tekrar…`)
      }
    }
  }

  async tailLogs(lines = 15): Promise<string> {
    const parts: string[] = []
    for (const f of ['mysqld.out.log', 'httpd.out.log', 'apache-error.log']) {
      const txt = await readFile(join(this.logs, f), 'utf8').catch(() => '')
      if (txt.trim()) parts.push(`--- ${f}\n${txt.trim().split('\n').slice(-lines).join('\n')}`)
    }
    return parts.join('\n')
  }

  /** PHP CLI (aynı php.ini ile) */
  runPhp(script: string, args: string[], timeoutMs = 120000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const bin = binaries(this.opts.paths)
    return new Promise((resolve, reject) => {
      const child = spawn(bin.php, ['-c', join(this.conf, 'php.ini'), script, ...args], { env: this.env(), windowsHide: true, cwd: this.site })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
      const timer = setTimeout(() => {
        killTree(child)
        reject(new Error(`PHP betiği ${timeoutMs / 1000} sn'de bitmedi: ${script}`))
      }, timeoutMs)
      const onAbort = (): void => killTree(child)
      this.opts.signal?.addEventListener('abort', onAbort, { once: true })
      child.once('error', (e) => (clearTimeout(timer), reject(e)))
      child.once('close', (code) => {
        clearTimeout(timer)
        this.opts.signal?.removeEventListener('abort', onAbort)
        resolve({ code, stdout, stderr })
      })
    })
  }

  stopSync(): void {
    for (const p of this.procs) killTree(p)
    this.procs = []
    for (const s of this.logStreams) s.end()
    this.logStreams = []
    live.delete(this)
  }

  async stop(): Promise<void> {
    const procs = this.procs
    this.stopSync()
    // Windows'ta dosya kilitleri süreç tamamen kapanınca kalkar
    await Promise.all(procs.map((p) => (p.exitCode !== null ? Promise.resolve() : new Promise<void>((r) => p.once('exit', () => r())))).map((p) => Promise.race([p, new Promise((r) => setTimeout(r, 5000))])))
  }
}
