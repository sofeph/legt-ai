<?php
/**
 * Customizer: aktif header / footer layout'u ve ek CSS.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Yayımlanmış {{prefix}}_layout kayıtları (eklenti yoksa yalnızca "tema varsayılanı").
 *
 * @return array<int, string>
 */
function {{prefix}}_layout_choices() {
	$choices = array( 0 => esc_html__( '— Tema varsayılanı —', '{{textdomain}}' ) );
	if ( ! post_type_exists( '{{prefix}}_layout' ) ) {
		return $choices;
	}
	$posts = get_posts(
		array(
			'post_type'   => '{{prefix}}_layout',
			'post_status' => 'publish',
			'numberposts' => 100,
			'orderby'     => 'title',
			'order'       => 'ASC',
		)
	);
	foreach ( $posts as $post ) {
		$choices[ $post->ID ] = '' !== $post->post_title ? $post->post_title : '#' . $post->ID;
	}
	return $choices;
}

function {{prefix}}_customize_register( $wp_customize ) {
	$wp_customize->add_section(
		'{{prefix}}_layout',
		array(
			'title'       => esc_html__( 'Header / Footer', '{{textdomain}}' ),
			'description' => esc_html__( 'Elementor ile tasarladığınız layout\'u seçin. Seçim yoksa temanın varsayılan header/footer\'ı kullanılır.', '{{textdomain}}' ),
			'priority'    => 30,
		)
	);

	$locations = array(
		'header' => esc_html__( 'Aktif header', '{{textdomain}}' ),
		'footer' => esc_html__( 'Aktif footer', '{{textdomain}}' ),
	);
	foreach ( $locations as $location => $label ) {
		$wp_customize->add_setting(
			'{{prefix}}_active_' . $location,
			array(
				'default'           => 0,
				'sanitize_callback' => 'absint',
			)
		);
		$wp_customize->add_control(
			'{{prefix}}_active_' . $location,
			array(
				'type'    => 'select',
				'section' => '{{prefix}}_layout',
				'label'   => $label,
				'choices' => {{prefix}}_layout_choices(),
			)
		);
	}

	$wp_customize->add_section(
		'{{prefix}}_extra',
		array(
			'title'    => esc_html__( 'Tema ek CSS', '{{textdomain}}' ),
			'priority' => 200,
		)
	);
	$wp_customize->add_setting(
		'{{prefix}}_extra_css',
		array(
			'default'           => '',
			'sanitize_callback' => 'wp_strip_all_tags',
		)
	);
	$wp_customize->add_control(
		'{{prefix}}_extra_css',
		array(
			'type'    => 'textarea',
			'section' => '{{prefix}}_extra',
			'label'   => esc_html__( 'Ek CSS', '{{textdomain}}' ),
		)
	);
}
add_action( 'customize_register', '{{prefix}}_customize_register' );
