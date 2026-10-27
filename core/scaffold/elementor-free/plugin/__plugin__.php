<?php
/**
 * Plugin Name:       {{name}} Elementor Widgets
 * Description:       {{name}} teması için Elementor (Free) widget'ları, header/footer layout'ları ve şablon kısa kodu. Elementor Pro gerektirmez.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            LEGT AI
 * License:           GPL-3.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain:       {{textdomain}}
 * Domain Path:       /languages
 * Elementor tested up to: 3.30.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( '{{PREFIX}}_EW_VERSION', '1.0.0' );
define( '{{PREFIX}}_EW_FILE', __FILE__ );
define( '{{PREFIX}}_EW_PATH', plugin_dir_path( __FILE__ ) );
define( '{{PREFIX}}_EW_URL', plugin_dir_url( __FILE__ ) );
define( '{{PREFIX}}_EW_MIN_ELEMENTOR', '3.5.0' );
define( '{{PREFIX}}_EW_MIN_PHP', '7.4' );

/**
 * Yönetim paneline uyarı ekler.
 *
 * @param string $message Uyarı metni (HTML içerebilir).
 */
function {{prefix}}_ew_admin_notice( $message ) {
	add_action(
		'admin_notices',
		function () use ( $message ) {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}
			printf( '<div class="notice notice-warning is-dismissible"><p>%s</p></div>', wp_kses_post( $message ) );
		}
	);
}

/**
 * Eklentiyi başlatır: PHP ve Elementor sürümünü kontrol eder, widget'ları yükler.
 */
function {{prefix}}_ew_init() {
	load_plugin_textdomain( '{{textdomain}}', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );

	if ( version_compare( PHP_VERSION, {{PREFIX}}_EW_MIN_PHP, '<' ) ) {
		/* translators: %s: gerekli PHP sürümü */
		{{prefix}}_ew_admin_notice( sprintf( esc_html__( '%1$s eklentisi en az PHP %2$s gerektirir.', '{{textdomain}}' ), '<strong>{{name}} Elementor Widgets</strong>', {{PREFIX}}_EW_MIN_PHP ) );
		return;
	}

	// Layout CPT'si ve kısa kod Elementor kapalıyken de kayıtlı kalır; içerik kaybolmaz.
	require_once {{PREFIX}}_EW_PATH . 'includes/layout-cpt.php';
	require_once {{PREFIX}}_EW_PATH . 'includes/shortcode.php';
	require_once {{PREFIX}}_EW_PATH . 'includes/menu.php';
	// Demo içe aktarıcı Elementor kapalıyken de görünür; içeriği kaydeder, eksikliği bildirir.
	require_once {{PREFIX}}_EW_PATH . 'includes/demo-import.php';

	if ( ! did_action( 'elementor/loaded' ) ) {
		{{prefix}}_ew_admin_notice( sprintf( esc_html__( '%1$s eklentisi için %2$s yüklü ve etkin olmalıdır.', '{{textdomain}}' ), '<strong>{{name}} Elementor Widgets</strong>', '<strong>Elementor</strong>' ) );
		return;
	}

	if ( ! defined( 'ELEMENTOR_VERSION' ) || version_compare( ELEMENTOR_VERSION, {{PREFIX}}_EW_MIN_ELEMENTOR, '<' ) ) {
		{{prefix}}_ew_admin_notice( sprintf( esc_html__( '%1$s eklentisi en az Elementor %2$s gerektirir.', '{{textdomain}}' ), '<strong>{{name}} Elementor Widgets</strong>', {{PREFIX}}_EW_MIN_ELEMENTOR ) );
		return;
	}

	require_once {{PREFIX}}_EW_PATH . 'includes/class-plugin.php';
	\{{Prefix}}\Plugin::instance();
}
add_action( 'plugins_loaded', '{{prefix}}_ew_init' );
