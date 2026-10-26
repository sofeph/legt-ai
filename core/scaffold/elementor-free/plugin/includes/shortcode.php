<?php
/**
 * [{{prefix}}_template id="x"] — Elementor Pro "Template" widget'ı yerine.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

function {{prefix}}_template_shortcode( $atts ) {
	static $depth = 0;

	$atts = shortcode_atts( array( 'id' => 0 ), $atts, '{{prefix}}_template' );
	$id   = absint( $atts['id'] );
	if ( ! $id || 'publish' !== get_post_status( $id ) || $depth > 2 ) {
		return '';
	}

	$depth++;
	if ( did_action( 'elementor/loaded' ) ) {
		$html = \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $id, true );
	} else {
		$html = apply_filters( 'the_content', get_post_field( 'post_content', $id ) );
	}
	$depth--;

	return $html;
}
add_shortcode( '{{prefix}}_template', '{{prefix}}_template_shortcode' );
