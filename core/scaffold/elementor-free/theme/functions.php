<?php
/**
 * {{name}} tema fonksiyonları.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( '{{PREFIX}}_THEME_VERSION', '1.0.0' );

function {{prefix}}_setup() {
	load_theme_textdomain( '{{textdomain}}', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support(
		'custom-logo',
		array(
			'height'      => 80,
			'width'       => 240,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ) );

	register_nav_menus(
		array(
			'primary' => esc_html__( 'Ana menü', '{{textdomain}}' ),
			'footer'  => esc_html__( 'Footer menüsü', '{{textdomain}}' ),
		)
	);
}
add_action( 'after_setup_theme', '{{prefix}}_setup' );

function {{prefix}}_content_width() {
	$GLOBALS['content_width'] = apply_filters( '{{prefix}}_content_width', 1200 );
}
add_action( 'after_setup_theme', '{{prefix}}_content_width', 0 );

function {{prefix}}_enqueue_assets() {
	wp_enqueue_style( '{{prefix}}-style', get_stylesheet_uri(), array(), {{PREFIX}}_THEME_VERSION );
	$handle = '{{prefix}}-style';

	$css = get_template_directory() . '/assets/css/theme.css';
	if ( file_exists( $css ) ) {
		wp_enqueue_style( '{{prefix}}-theme', get_template_directory_uri() . '/assets/css/theme.css', array( '{{prefix}}-style' ), (string) filemtime( $css ) );
		$handle = '{{prefix}}-theme';
	}

	$js = get_template_directory() . '/assets/js/theme.js';
	if ( file_exists( $js ) ) {
		wp_enqueue_script( '{{prefix}}-theme', get_template_directory_uri() . '/assets/js/theme.js', array(), (string) filemtime( $js ), true );
	}

	$extra = get_theme_mod( '{{prefix}}_extra_css', '' );
	if ( '' !== trim( $extra ) ) {
		wp_add_inline_style( $handle, wp_strip_all_tags( $extra ) );
	}

	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
		wp_enqueue_script( 'comment-reply' );
	}
}
add_action( 'wp_enqueue_scripts', '{{prefix}}_enqueue_assets' );

/**
 * Widget eklentisi yoksa yöneticiye bilgi verir.
 */
function {{prefix}}_plugin_notice() {
	if ( defined( '{{PREFIX}}_EW_VERSION' ) || ! current_user_can( 'install_plugins' ) ) {
		return;
	}
	echo '<div class="notice notice-info is-dismissible"><p>' . esc_html__( '{{name}} temasının tüm bölümleri için "{{name}} Elementor Widgets" eklentisini ve Elementor\'u yükleyip etkinleştirin.', '{{textdomain}}' ) . '</p></div>';
}
add_action( 'admin_notices', '{{prefix}}_plugin_notice' );

require get_template_directory() . '/inc/customizer.php';
require get_template_directory() . '/inc/template-functions.php';
