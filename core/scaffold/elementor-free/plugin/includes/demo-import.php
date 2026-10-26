<?php
/**
 * Tek tıkla demo içe aktarma: demo/*.json → ana sayfa, header/footer layout'ları,
 * Customizer seçimi, ana menü ve Elementor global renk/font'ları.
 *
 * Görünüm > {{name}} Demo sayfasından, etkinleştirme bildiriminden ya da WP-CLI ile:
 *   wp {{prefix}} demo-import [--no-front-page] [--no-menu] [--no-kit]
 *
 * Tekrar çalıştırılabilir: daha önce içe aktarılan kayıtlar silinmez, güncellenir.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( '{{PREFIX}}_DEMO_META', '_{{prefix}}_demo' );

/**
 * İçe aktarılacak demo dosyaları (anahtar → yol). Olmayanlar atlanır.
 *
 * @return array<string, string>
 */
function {{prefix}}_demo_files() {
	$files = array();
	foreach ( array( 'home', 'header', 'footer' ) as $key ) {
		$path = {{PREFIX}}_EW_PATH . 'demo/' . $key . '.json';
		if ( file_exists( $path ) ) {
			$files[ $key ] = $path;
		}
	}
	return $files;
}

/**
 * Elementor şablon JSON'unu okur: { "version", "title", "type", "content": [...], "page_settings": {...} }
 *
 * @param string $path Dosya yolu.
 * @return array|WP_Error
 */
function {{prefix}}_demo_read( $path ) {
	$data = json_decode( (string) file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) {
		/* translators: 1: dosya adı, 2: JSON hatası */
		return new WP_Error( 'json', sprintf( esc_html__( '%1$s okunamadı: %2$s', '{{textdomain}}' ), basename( $path ), json_last_error_msg() ) );
	}
	$content = isset( $data['content'] ) ? $data['content'] : ( isset( $data[0] ) ? $data : null );
	if ( ! is_array( $content ) || empty( $content ) ) {
		/* translators: %s: dosya adı */
		return new WP_Error( 'empty', sprintf( esc_html__( '%s içinde "content" dizisi yok ya da boş.', '{{textdomain}}' ), basename( $path ) ) );
	}
	$data['content'] = $content;
	return $data;
}

/**
 * Eksik ya da yinelenen eleman kimliklerini yeniler (Elementor her öğe için benzersiz id ister),
 * kullanılan widget türlerini toplar.
 *
 * @param array $elements Elementor eleman ağacı.
 * @param array $seen     Görülen kimlikler.
 * @param array $types    Kullanılan widget türleri.
 * @return array
 */
function {{prefix}}_demo_prepare( $elements, &$seen, &$types ) {
	$out = array();
	foreach ( $elements as $el ) {
		if ( ! is_array( $el ) || empty( $el['elType'] ) ) {
			continue;
		}
		$id = isset( $el['id'] ) ? (string) $el['id'] : '';
		while ( '' === $id || isset( $seen[ $id ] ) ) {
			$id = substr( md5( uniqid( '', true ) ), 0, 7 );
		}
		$seen[ $id ]  = true;
		$el['id']     = $id;
		$el['isInner'] = ! empty( $el['isInner'] );
		if ( empty( $el['settings'] ) || ! is_array( $el['settings'] ) ) {
			$el['settings'] = array();
		}
		if ( 'widget' === $el['elType'] && ! empty( $el['widgetType'] ) ) {
			$types[ $el['widgetType'] ] = true;
		}
		$el['elements'] = {{prefix}}_demo_prepare( isset( $el['elements'] ) && is_array( $el['elements'] ) ? $el['elements'] : array(), $seen, $types );
		$out[]          = $el;
	}
	return $out;
}

/**
 * Demo kaydını oluşturur ya da (daha önce içe aktarıldıysa) günceller.
 *
 * @return int|WP_Error Yazı kimliği.
 */
function {{prefix}}_demo_upsert( $key, $title, $post_type, $data, $template_type ) {
	$existing = get_posts(
		array(
			'post_type'      => $post_type,
			'post_status'    => 'any',
			'meta_key'       => {{PREFIX}}_DEMO_META,
			'meta_value'     => $key,
			'posts_per_page' => 1,
			'fields'         => 'ids',
		)
	);
	$postarr = array(
		'post_title'   => $title,
		'post_type'    => $post_type,
		'post_status'  => 'publish',
		'post_content' => '',
	);
	if ( $existing ) {
		$postarr['ID'] = (int) $existing[0];
	}
	$id = $existing ? wp_update_post( $postarr, true ) : wp_insert_post( $postarr, true );
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	update_post_meta( $id, {{PREFIX}}_DEMO_META, $key );
	update_post_meta( $id, '_elementor_edit_mode', 'builder' );
	update_post_meta( $id, '_elementor_template_type', $template_type );
	update_post_meta( $id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.5.0' );
	update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $data['content'] ) ) );
	if ( ! empty( $data['page_settings'] ) && is_array( $data['page_settings'] ) ) {
		update_post_meta( $id, '_elementor_page_settings', $data['page_settings'] );
	}
	return (int) $id;
}

/**
 * Tema etkin olmasa bile {{name}} temasının ayarına yazar (tema sonra etkinleştirilebilir).
 */
function {{prefix}}_demo_set_theme_mod( $name, $value ) {
	if ( get_stylesheet() === '{{slug}}' ) {
		set_theme_mod( $name, $value );
		return;
	}
	$mods          = get_option( 'theme_mods_{{slug}}', array() );
	$mods          = is_array( $mods ) ? $mods : array();
	$mods[ $name ] = $value;
	update_option( 'theme_mods_{{slug}}', $mods );
}

/**
 * Plan token'larından Elementor global renk ve fontları (Site Ayarları) doldurur.
 *
 * @return bool Kit bulunduysa true.
 */
function {{prefix}}_demo_apply_kit() {
	$kit_id = (int) get_option( 'elementor_active_kit' );
	if ( ! $kit_id || ! get_post( $kit_id ) ) {
		return false;
	}
	$tokens   = require {{PREFIX}}_EW_PATH . 'includes/demo-data.php';
	$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
	$settings = is_array( $settings ) ? $settings : array();
	$titles   = array(
		'primary'   => 'Primary',
		'secondary' => 'Secondary',
		'text'      => 'Text',
		'accent'    => 'Accent',
	);

	$colors = array();
	foreach ( $titles as $id => $title ) {
		if ( ! empty( $tokens['colors'][ $id ] ) ) {
			$colors[] = array(
				'_id'   => $id,
				'title' => $title,
				'color' => $tokens['colors'][ $id ],
			);
		}
	}
	if ( $colors ) {
		$settings['system_colors'] = $colors;
	}

	$fonts = array(
		'primary'   => $tokens['fonts']['heading'],
		'secondary' => $tokens['fonts']['heading'],
		'text'      => $tokens['fonts']['body'],
		'accent'    => $tokens['fonts']['body'],
	);
	$typography = array();
	foreach ( $fonts as $id => $family ) {
		if ( '' !== $family ) {
			$typography[] = array(
				'_id'                    => $id,
				'title'                  => $titles[ $id ],
				'typography_typography'  => 'custom',
				'typography_font_family' => $family,
			);
		}
	}
	if ( $typography ) {
		$settings['system_typography'] = $typography;
	}

	update_post_meta( $kit_id, '_elementor_page_settings', $settings );
	return true;
}

/**
 * Ana menüyü oluşturur (yoksa) ve temanın "primary" konumuna atar.
 */
function {{prefix}}_demo_menu( $home_id ) {
	$name = '{{name}}';
	$menu = wp_get_nav_menu_object( $name );
	$id   = $menu ? (int) $menu->term_id : wp_create_nav_menu( $name );
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	if ( ! $menu && $home_id ) {
		wp_update_nav_menu_item(
			$id,
			0,
			array(
				'menu-item-title'     => esc_html__( 'Ana Sayfa', '{{textdomain}}' ),
				'menu-item-object'    => 'page',
				'menu-item-object-id' => $home_id,
				'menu-item-type'      => 'post_type',
				'menu-item-status'    => 'publish',
			)
		);
	}
	$locations            = get_stylesheet() === '{{slug}}' ? get_theme_mod( 'nav_menu_locations', array() ) : array();
	$locations            = is_array( $locations ) ? $locations : array();
	$locations['primary'] = $id;
	{{prefix}}_demo_set_theme_mod( 'nav_menu_locations', $locations );
	return $id;
}

/**
 * Demo içeriğini içe aktarır.
 *
 * @param array $args front_page, menu, kit (varsayılan hepsi true).
 * @return array{created: string[], warnings: string[], errors: string[], home: int}
 */
function {{prefix}}_demo_import( $args = array() ) {
	$args   = wp_parse_args(
		$args,
		array(
			'front_page' => true,
			'menu'       => true,
			'kit'        => true,
		)
	);
	$report = array(
		'created'  => array(),
		'warnings' => array(),
		'errors'   => array(),
		'home'     => 0,
	);
	$files  = {{prefix}}_demo_files();
	if ( ! $files ) {
		$report['errors'][] = esc_html__( 'Eklentinin demo/ klasöründe JSON dosyası yok.', '{{textdomain}}' );
		return $report;
	}
	if ( ! did_action( 'elementor/loaded' ) && ! defined( 'ELEMENTOR_VERSION' ) ) {
		$report['warnings'][] = esc_html__( 'Elementor etkin değil: içerik kaydedildi ama Elementor etkinleşene kadar görünmez.', '{{textdomain}}' );
	}

	$known = array();
	foreach ( (array) require {{PREFIX}}_EW_PATH . 'includes/widgets-manifest.php' as $w ) {
		$known[ $w['name'] ] = true;
	}
	$seen = array();
	$ids  = array();
	foreach ( $files as $key => $path ) {
		$data = {{prefix}}_demo_read( $path );
		if ( is_wp_error( $data ) ) {
			$report['errors'][] = $data->get_error_message();
			continue;
		}
		$types           = array();
		$data['content'] = {{prefix}}_demo_prepare( $data['content'], $seen, $types );
		foreach ( array_keys( $types ) as $type ) {
			if ( 0 === strpos( $type, '{{prefix}}-' ) && ! isset( $known[ $type ] ) ) {
				/* translators: 1: dosya adı, 2: widget adı */
				$report['errors'][] = sprintf( esc_html__( '%1$s bilinmeyen widget kullanıyor: %2$s', '{{textdomain}}' ), basename( $path ), $type );
			}
		}
		if ( ! $types ) {
			/* translators: %s: dosya adı */
			$report['warnings'][] = sprintf( esc_html__( '%s hiç widget içermiyor.', '{{textdomain}}' ), basename( $path ) );
		}

		$is_layout = 'home' !== $key;
		$title     = ! empty( $data['title'] ) ? sanitize_text_field( $data['title'] ) : ( $is_layout ? ucfirst( $key ) : esc_html__( 'Ana Sayfa', '{{textdomain}}' ) );
		$id        = {{prefix}}_demo_upsert( $key, $title, $is_layout ? '{{prefix}}_layout' : 'page', $data, $is_layout ? 'wp-post' : 'wp-page' );
		if ( is_wp_error( $id ) ) {
			$report['errors'][] = basename( $path ) . ': ' . $id->get_error_message();
			continue;
		}
		$ids[ $key ]         = $id;
		$report['created'][] = sprintf( '%s → #%d', basename( $path ), $id );
		if ( $is_layout ) {
			{{prefix}}_demo_set_theme_mod( '{{prefix}}_active_' . $key, $id );
		} elseif ( locate_template( 'templates/full-width.php' ) ) {
			update_post_meta( $id, '_wp_page_template', 'templates/full-width.php' );
		}
	}

	if ( ! empty( $ids['home'] ) ) {
		$report['home'] = $ids['home'];
		if ( $args['front_page'] ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $ids['home'] );
			$report['created'][] = esc_html__( 'Ana sayfa statik ön sayfa yapıldı', '{{textdomain}}' );
		}
		if ( $args['menu'] ) {
			$menu = {{prefix}}_demo_menu( $ids['home'] );
			if ( is_wp_error( $menu ) ) {
				$report['warnings'][] = $menu->get_error_message();
			} else {
				$report['created'][] = esc_html__( 'Ana menü oluşturuldu ve atandı', '{{textdomain}}' );
			}
		}
	}

	if ( $args['kit'] ) {
		if ( {{prefix}}_demo_apply_kit() ) {
			$report['created'][] = esc_html__( 'Elementor global renk ve fontları ayarlandı', '{{textdomain}}' );
		} else {
			$report['warnings'][] = esc_html__( 'Elementor kit\'i bulunamadı; global renkler ayarlanmadı.', '{{textdomain}}' );
		}
	}

	// Elementor CSS önbelleği yeni içerikle yeniden üretilsin
	if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
		\Elementor\Plugin::$instance->files_manager->clear_cache();
	}
	if ( ! $report['errors'] ) {
		update_option( '{{prefix}}_demo_imported', time() );
	}
	return $report;
}

// ---- Yönetim paneli ----

function {{prefix}}_demo_admin_menu() {
	add_theme_page(
		esc_html__( '{{name}} Demo', '{{textdomain}}' ),
		esc_html__( '{{name}} Demo', '{{textdomain}}' ),
		'edit_theme_options',
		'{{prefix}}-demo',
		'{{prefix}}_demo_admin_page'
	);
}
add_action( 'admin_menu', '{{prefix}}_demo_admin_menu' );

function {{prefix}}_demo_admin_page() {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}
	$report = get_transient( '{{prefix}}_demo_report' );
	delete_transient( '{{prefix}}_demo_report' );
	$files    = {{prefix}}_demo_files();
	$imported = get_option( '{{prefix}}_demo_imported' );
	?>
	<div class="wrap">
		<h1><?php echo esc_html__( '{{name}} Demo İçeriği', '{{textdomain}}' ); ?></h1>
		<p><?php echo esc_html__( 'Ana sayfayı, header ve footer layout\'larını, ana menüyü ve Elementor global renk/font ayarlarını tek tıkla oluşturur. Tekrar çalıştırılırsa aynı kayıtlar güncellenir.', '{{textdomain}}' ); ?></p>
		<?php if ( is_array( $report ) ) : ?>
			<?php foreach ( array( 'errors' => 'error', 'warnings' => 'warning', 'created' => 'success' ) as $key => $class ) : ?>
				<?php if ( ! empty( $report[ $key ] ) ) : ?>
					<div class="notice notice-<?php echo esc_attr( $class ); ?>"><ul>
						<?php foreach ( $report[ $key ] as $line ) : ?>
							<li><?php echo esc_html( $line ); ?></li>
						<?php endforeach; ?>
					</ul></div>
				<?php endif; ?>
			<?php endforeach; ?>
			<?php if ( ! empty( $report['home'] ) ) : ?>
				<p><a class="button" href="<?php echo esc_url( get_permalink( $report['home'] ) ); ?>"><?php echo esc_html__( 'Siteyi görüntüle', '{{textdomain}}' ); ?></a></p>
			<?php endif; ?>
		<?php endif; ?>
		<p><?php echo esc_html__( 'Dosyalar:', '{{textdomain}}' ); ?> <code><?php echo esc_html( $files ? implode( ', ', array_map( 'basename', $files ) ) : '—' ); ?></code></p>
		<?php if ( $imported ) : ?>
			<p><em>
			<?php
			/* translators: %s: tarih */
			printf( esc_html__( 'Son içe aktarma: %s', '{{textdomain}}' ), esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $imported ) ) );
			?>
			</em></p>
		<?php endif; ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="{{prefix}}_demo_import">
			<?php wp_nonce_field( '{{prefix}}_demo_import' ); ?>
			<p><label><input type="checkbox" name="front_page" value="1" checked> <?php echo esc_html__( 'Ana sayfayı statik ön sayfa yap', '{{textdomain}}' ); ?></label></p>
			<p><label><input type="checkbox" name="menu" value="1" checked> <?php echo esc_html__( 'Ana menüyü oluştur', '{{textdomain}}' ); ?></label></p>
			<p><label><input type="checkbox" name="kit" value="1" checked> <?php echo esc_html__( 'Elementor global renk ve fontlarını ayarla', '{{textdomain}}' ); ?></label></p>
			<?php submit_button( $imported ? esc_html__( 'Demo içeriğini yeniden içe aktar', '{{textdomain}}' ) : esc_html__( 'Demo içeriğini içe aktar', '{{textdomain}}' ), 'primary', 'submit', true, $files ? array() : array( 'disabled' => 'disabled' ) ); ?>
		</form>
	</div>
	<?php
}

function {{prefix}}_demo_handle_import() {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		wp_die( esc_html__( 'Bu işlem için yetkiniz yok.', '{{textdomain}}' ), 403 );
	}
	check_admin_referer( '{{prefix}}_demo_import' );
	$report = {{prefix}}_demo_import(
		array(
			'front_page' => ! empty( $_POST['front_page'] ),
			'menu'       => ! empty( $_POST['menu'] ),
			'kit'        => ! empty( $_POST['kit'] ),
		)
	);
	set_transient( '{{prefix}}_demo_report', $report, 300 );
	wp_safe_redirect( admin_url( 'themes.php?page={{prefix}}-demo' ) );
	exit;
}
add_action( 'admin_post_{{prefix}}_demo_import', '{{prefix}}_demo_handle_import' );

/**
 * Henüz içe aktarılmadıysa yöneticiye demo sayfasını hatırlatır.
 */
function {{prefix}}_demo_admin_notice() {
	if ( get_option( '{{prefix}}_demo_imported' ) || get_option( '{{prefix}}_demo_notice_dismissed' ) || ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}
	$screen = get_current_screen();
	if ( $screen && 'appearance_page_{{prefix}}-demo' === $screen->id ) {
		return;
	}
	$dismiss = wp_nonce_url( admin_url( 'admin-post.php?action={{prefix}}_demo_dismiss' ), '{{prefix}}_demo_dismiss' );
	printf(
		'<div class="notice notice-info"><p>%1$s <a class="button button-primary" href="%2$s">%3$s</a> <a href="%4$s">%5$s</a></p></div>',
		esc_html__( '{{name}}: demo içeriğini (ana sayfa, header, footer, menü) tek tıkla içe aktarabilirsiniz.', '{{textdomain}}' ),
		esc_url( admin_url( 'themes.php?page={{prefix}}-demo' ) ),
		esc_html__( 'Demo içeriği', '{{textdomain}}' ),
		esc_url( $dismiss ),
		esc_html__( 'Gizle', '{{textdomain}}' )
	);
}
add_action( 'admin_notices', '{{prefix}}_demo_admin_notice' );

function {{prefix}}_demo_dismiss() {
	if ( current_user_can( 'edit_theme_options' ) && check_admin_referer( '{{prefix}}_demo_dismiss' ) ) {
		update_option( '{{prefix}}_demo_notice_dismissed', 1 );
	}
	wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url() );
	exit;
}
add_action( 'admin_post_{{prefix}}_demo_dismiss', '{{prefix}}_demo_dismiss' );

// ---- WP-CLI ----

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Demo içeriğini içe aktarır.
	 *
	 * [--no-front-page]
	 * : Ana sayfayı statik ön sayfa yapma.
	 *
	 * [--no-menu]
	 * : Ana menüyü oluşturma.
	 *
	 * [--no-kit]
	 * : Elementor global renk/fontlarına dokunma.
	 */
	\WP_CLI::add_command(
		'{{prefix}} demo-import',
		function ( $args, $assoc ) {
			$report = {{prefix}}_demo_import(
				array(
					'front_page' => \WP_CLI\Utils\get_flag_value( $assoc, 'front-page', true ),
					'menu'       => \WP_CLI\Utils\get_flag_value( $assoc, 'menu', true ),
					'kit'        => \WP_CLI\Utils\get_flag_value( $assoc, 'kit', true ),
				)
			);
			foreach ( $report['created'] as $line ) {
				\WP_CLI::log( $line );
			}
			foreach ( $report['warnings'] as $line ) {
				\WP_CLI::warning( $line );
			}
			if ( $report['errors'] ) {
				\WP_CLI::error( implode( "\n", $report['errors'] ) );
			}
			\WP_CLI::success( 'Demo içeriği içe aktarıldı.' );
		}
	);
}
