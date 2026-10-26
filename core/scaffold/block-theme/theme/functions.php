<?php
/**
 * {{name}} blok teması fonksiyonları.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( '{{PREFIX}}_THEME_VERSION', '1.0.0' );

function {{prefix}}_setup() {
	load_theme_textdomain( '{{textdomain}}', get_template_directory() . '/languages' );
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'editor-styles' );
	if ( file_exists( get_template_directory() . '/assets/css/theme.css' ) ) {
		add_editor_style( 'assets/css/theme.css' );
	}
}
add_action( 'after_setup_theme', '{{prefix}}_setup' );

function {{prefix}}_enqueue_assets() {
	$css = get_template_directory() . '/assets/css/theme.css';
	if ( file_exists( $css ) ) {
		wp_enqueue_style( '{{prefix}}-theme', get_template_directory_uri() . '/assets/css/theme.css', array(), (string) filemtime( $css ) );
	}

	$js = get_template_directory() . '/assets/js/theme.js';
	if ( file_exists( $js ) ) {
		wp_enqueue_script(
			'{{prefix}}-theme',
			get_template_directory_uri() . '/assets/js/theme.js',
			array(),
			(string) filemtime( $js ),
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	}
}
add_action( 'wp_enqueue_scripts', '{{prefix}}_enqueue_assets' );

function {{prefix}}_pattern_categories() {
	register_block_pattern_category(
		'{{slug}}',
		array( 'label' => esc_html__( '{{name}}', '{{textdomain}}' ) )
	);
}
add_action( 'init', '{{prefix}}_pattern_categories' );
