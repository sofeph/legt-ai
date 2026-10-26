<?php
/**
 * LEGT AI canlı test kurulumu (PHP CLI). WP-CLI gerektirmez.
 *
 * Kullanım: php setup.php config.json
 *
 * Veritabanını sıfırlar, WordPress'i kurar, temayı ve eklentileri etkinleştirir,
 * test sayfalarını oluşturur. Son satırda "@@LEGT@@{json}" basar; ölümcül hata olsa bile
 * (kapanış fonksiyonu) hata dosya/satır bilgisiyle birlikte basılır.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '0' );

$legt_cfg   = json_decode( (string) file_get_contents( $argv[1] ), true );
$legt_stage = 'config';
$legt_out   = array(
	'ok'       => false,
	'stage'    => '',
	'errors'   => array(),
	'warnings' => array(),
	'pages'    => array(),
);

register_shutdown_function(
	function () {
		global $legt_out, $legt_stage;
		$e = error_get_last();
		if ( $e && in_array( $e['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR ), true ) ) {
			$legt_out['ok']       = false;
			$legt_out['errors'][] = array(
				'stage'   => $legt_stage,
				'message' => $e['message'],
				'file'    => $e['file'],
				'line'    => $e['line'],
			);
		}
		$legt_out['stage'] = $legt_stage;
		echo "\n@@LEGT@@" . json_encode( $legt_out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n";
	}
);

set_exception_handler(
	function ( $ex ) {
		global $legt_out, $legt_stage;
		$legt_out['errors'][] = array(
			'stage'   => $legt_stage,
			'message' => get_class( $ex ) . ': ' . $ex->getMessage() . "\n" . $ex->getTraceAsString(),
			'file'    => $ex->getFile(),
			'line'    => $ex->getLine(),
		);
		exit( 1 );
	}
);

if ( ! is_array( $legt_cfg ) ) {
	throw new RuntimeException( 'Yapılandırma okunamadı: ' . $argv[1] );
}

// ---- Veritabanı ----
$legt_stage = 'db';
mysqli_report( MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT );
$legt_db = new mysqli( '127.0.0.1', 'root', '', '', (int) $legt_cfg['dbPort'] );
$legt_db->query( 'DROP DATABASE IF EXISTS `legt_wp`' );
$legt_db->query( 'CREATE DATABASE `legt_wp` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci' );
$legt_db->close();

// ---- WordPress kurulumu ----
$legt_stage = 'install';
$legt_url   = parse_url( $legt_cfg['siteUrl'] );
$_SERVER['HTTP_HOST']       = $legt_url['host'] . ':' . $legt_url['port'];
$_SERVER['SERVER_NAME']     = $legt_url['host'];
$_SERVER['SERVER_PORT']     = (string) $legt_url['port'];
$_SERVER['REQUEST_URI']     = '/';
$_SERVER['REQUEST_METHOD']  = 'GET';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
define( 'WP_INSTALLING', true );
require rtrim( $legt_cfg['abspath'], '/\\' ) . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

wp_install( $legt_cfg['title'], 'admin', 'admin@example.test', false, '', $legt_cfg['adminPass'], '' );
// Düz bağlantılar: test sitesinde .htaccess yazılmaz (WordPress kurulumda kalıcı bağlantıları açabiliyor)
global $wp_rewrite;
$wp_rewrite->set_permalink_structure( '' );
$wp_rewrite->flush_rules( false );
update_option( 'blogdescription', 'LEGT AI test' );
$legt_out['wpVersion'] = get_bloginfo( 'version' );

/** Elementor öğe kimliği; tarayıcı tarafı bu kimliklerle bölümü bulur */
function legt_el( $id, $type, $settings, $children, $extra = array() ) {
	return array_merge(
		array(
			'id'       => $id,
			'elType'   => $type,
			'settings' => empty( $settings ) ? new stdClass() : $settings,
			'elements' => $children,
			'isInner'  => false,
		),
		$extra
	);
}

function legt_widget_row( $w ) {
	$widget = legt_el( $w['elId'], 'widget', array(), array(), array( 'widgetType' => $w['widget'] ) );
	$column = legt_el( $w['elId'] . 'c', 'column', array( '_column_size' => 100 ), array( $widget ) );
	return legt_el( $w['elId'] . 's', 'section', array(), array( $column ) );
}

function legt_elementor_post( $title, $type, $widgets, $template_type ) {
	$id = wp_insert_post(
		array(
			'post_title'  => $title,
			'post_type'   => $type,
			'post_status' => 'publish',
			'post_content' => '',
		),
		true
	);
	if ( is_wp_error( $id ) ) {
		throw new RuntimeException( $id->get_error_message() );
	}
	$data = array_map( 'legt_widget_row', $widgets );
	update_post_meta( $id, '_elementor_edit_mode', 'builder' );
	update_post_meta( $id, '_elementor_template_type', $template_type );
	update_post_meta( $id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.20.0' );
	update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
	return $id;
}

// ---- Test sayfaları (eklentiler etkinleşmeden önce; eklenti çökse bile sayfalar hazır olsun) ----
$legt_stage = 'content';
$legt_pages = &$legt_out['pages'];
$legt_pages['home']     = home_url( '/' );
$legt_pages['post']     = get_permalink( 1 );
$legt_pages['search']   = home_url( '/?s=lorem' );
$legt_pages['notFound'] = home_url( '/?p=987654' );

if ( 'elementor-free' === $legt_cfg['mode'] ) {
	$el                   = $legt_cfg['elementor'];
	$test_id              = legt_elementor_post( 'LEGT Test', 'page', $el['content'], 'wp-page' );
	$legt_pages['test']   = get_permalink( $test_id );
	$legt_pages['editor'] = admin_url( 'post.php?post=' . $test_id . '&action=elementor' );
	$layout_type          = $legt_cfg['prefix'] . '_layout';
	foreach ( array( 'header', 'footer' ) as $loc ) {
		if ( ! empty( $el[ $loc ] ) ) {
			$legt_out[ $loc . 'Layout' ] = legt_elementor_post( ucfirst( $loc ), $layout_type, array( $el[ $loc ] ), 'page' );
		}
	}
	update_option( 'elementor_onboarded', true );
	update_option( 'elementor_cpt_support', array( 'page', 'post', $layout_type ) );
	update_option( 'elementor_disable_color_schemes', 'yes' );
	update_option( 'elementor_disable_typography_schemes', 'yes' );
	update_option( 'elementor_tracker_notice', '1' );
	update_option( 'elementor_allow_tracking', 'no' );
} else {
	$blocks = '';
	foreach ( $legt_cfg['block']['patterns'] as $p ) {
		$blocks .= '<!-- wp:group {"className":"' . $p['probe'] . '","layout":{"type":"default"}} -->' . "\n"
			. '<div class="wp-block-group ' . $p['probe'] . '"><!-- wp:pattern {"slug":"' . $p['slug'] . '"} /--></div>' . "\n"
			. '<!-- /wp:group -->' . "\n\n";
	}
	$test_id = wp_insert_post(
		array(
			'post_title'   => 'LEGT Test',
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_content' => wp_slash( $blocks ),
		),
		true
	);
	if ( is_wp_error( $test_id ) ) {
		throw new RuntimeException( $test_id->get_error_message() );
	}
	$legt_pages['test']   = get_permalink( $test_id );
	$legt_pages['editor'] = admin_url( 'site-editor.php' );
}

// ---- Tema ----
$legt_stage = 'theme';
$theme      = wp_get_theme( $legt_cfg['theme'] );
if ( ! $theme->exists() || $theme->errors() ) {
	$legt_out['errors'][] = array(
		'stage'   => 'theme',
		'message' => 'Tema geçersiz: ' . ( $theme->errors() ? $theme->errors()->get_error_message() : 'bulunamadı' ),
		'file'    => get_theme_root() . '/' . $legt_cfg['theme'] . '/style.css',
		'line'    => 1,
	);
} else {
	switch_theme( $legt_cfg['theme'] );
	foreach ( array( 'header', 'footer' ) as $loc ) {
		if ( ! empty( $legt_out[ $loc . 'Layout' ] ) ) {
			set_theme_mod( $legt_cfg['prefix'] . '_active_' . $loc, (int) $legt_out[ $loc . 'Layout' ] );
		}
	}
}

// ---- Eklentiler (en son; ölümcül hata kapanışta raporlanır) ----
foreach ( $legt_cfg['plugins'] as $plugin ) {
	$legt_stage = 'plugin:' . $plugin;
	ob_start();
	// silent = false: etkinleştirme kancaları çalışsın (Elementor varsayılan Kit'i burada oluşturur)
	$r      = activate_plugin( $plugin, '', false, false );
	$output = trim( (string) ob_get_clean() );
	if ( is_wp_error( $r ) ) {
		$legt_out['errors'][] = array(
			'stage'   => $legt_stage,
			'message' => 'Eklenti etkinleştirilemedi: ' . $r->get_error_message() . ( $output ? "\n" . $output : '' ),
			'file'    => WP_PLUGIN_DIR . '/' . $plugin,
			'line'    => 1,
		);
	} elseif ( '' !== $output ) {
		$legt_out['warnings'][] = array(
			'stage'   => $legt_stage,
			'message' => 'Etkinleştirmede beklenmeyen çıktı: ' . substr( $output, 0, 500 ),
			'file'    => WP_PLUGIN_DIR . '/' . $plugin,
			'line'    => 1,
		);
	}
}
delete_transient( 'elementor_activation_redirect' );

// ---- Demo içe aktarıcı (Elementor eklentisi): kullanıcının çalıştıracağı kodun kendisi test edilir ----
if ( 'elementor-free' === $legt_cfg['mode'] && $legt_cfg['plugins'] ) {
	$legt_stage = 'demo';
	$plugin     = end( $legt_cfg['plugins'] );
	$fn         = $legt_cfg['prefix'] . '_demo_import';
	$file       = WP_PLUGIN_DIR . '/' . dirname( $plugin ) . '/includes/demo-import.php';
	if ( is_plugin_active( $plugin ) && ! function_exists( $fn ) && file_exists( $file ) ) {
		// plugins_loaded bu CLI sürecinde zaten geçti; eklentinin yüklediği dosyayı elle dahil et
		require_once $file;
	}
	if ( is_plugin_active( $plugin ) && function_exists( $fn ) ) {
		// Ön sayfa değiştirilmez: ana sayfa (blog) kontrolleri aynı kalsın
		$legt_out['demo'] = $fn( array( 'front_page' => false, 'menu' => true, 'kit' => true ) );
		if ( ! empty( $legt_out['demo']['home'] ) ) {
			$legt_pages['demo'] = get_permalink( $legt_out['demo']['home'] );
		}
		// Test sayfasının header/footer widget kontrolleri test layout'larıyla yapılır
		foreach ( array( 'header', 'footer' ) as $loc ) {
			if ( ! empty( $legt_out[ $loc . 'Layout' ] ) ) {
				set_theme_mod( $legt_cfg['prefix'] . '_active_' . $loc, (int) $legt_out[ $loc . 'Layout' ] );
			}
		}
	} elseif ( is_plugin_active( $plugin ) ) {
		$legt_out['warnings'][] = array(
			'stage'   => 'demo',
			'message' => 'Demo içe aktarıcı bulunamadı: ' . $fn . '()',
			'file'    => $file,
			'line'    => 1,
		);
	}
}

$legt_stage     = 'done';
$legt_out['ok'] = empty( $legt_out['errors'] );
