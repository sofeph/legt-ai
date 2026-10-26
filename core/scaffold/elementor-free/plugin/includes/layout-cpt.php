<?php
/**
 * Header / footer / bölüm layout'ları için CPT (Elementor Pro Theme Builder yerine).
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

function {{prefix}}_register_layout_cpt() {
	register_post_type(
		'{{prefix}}_layout',
		array(
			'labels'              => array(
				'name'          => esc_html__( 'Layout\'lar', '{{textdomain}}' ),
				'singular_name' => esc_html__( 'Layout', '{{textdomain}}' ),
				'add_new_item'  => esc_html__( 'Yeni layout ekle', '{{textdomain}}' ),
				'edit_item'     => esc_html__( 'Layout\'u düzenle', '{{textdomain}}' ),
				'menu_name'     => esc_html__( '{{name}} Layout\'ları', '{{textdomain}}' ),
			),
			'public'              => true,
			'publicly_queryable'  => true,
			'exclude_from_search' => true,
			'show_in_nav_menus'   => false,
			'show_in_rest'        => true,
			'has_archive'         => false,
			'rewrite'             => false,
			'menu_icon'           => 'dashicons-layout',
			'supports'            => array( 'title', 'editor', 'revisions' ),
		)
	);
	add_post_type_support( '{{prefix}}_layout', 'elementor' );
}
add_action( 'init', '{{prefix}}_register_layout_cpt' );

/**
 * Layout önizlemesi/düzenlemesi boş tuvalde açılır; aktif header içinde header'ın
 * kendini tekrar basması (sonsuz döngü) engellenir.
 */
function {{prefix}}_layout_template( $template ) {
	if ( is_singular( '{{prefix}}_layout' ) && defined( 'ELEMENTOR_PATH' ) ) {
		$canvas = ELEMENTOR_PATH . 'modules/page-templates/templates/canvas.php';
		if ( file_exists( $canvas ) ) {
			return $canvas;
		}
	}
	return $template;
}
add_filter( 'template_include', '{{prefix}}_layout_template', 99 );
