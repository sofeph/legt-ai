<?php
/**
 * header.php / footer.php yardımcıları.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Customizer'da seçili layout'u Elementor ile basar.
 *
 * @param string $location "header" veya "footer".
 * @return bool Basıldıysa true; false ise çağıran PHP fallback'ini basmalı.
 */
function {{prefix}}_render_layout( $location ) {
	$id = absint( get_theme_mod( '{{prefix}}_active_' . $location, 0 ) );
	if ( ! $id || 'publish' !== get_post_status( $id ) || ! did_action( 'elementor/loaded' ) ) {
		return false;
	}
	if ( is_singular( '{{prefix}}_layout' ) ) {
		return false;
	}
	$html = \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $id, true );
	if ( '' === trim( (string) $html ) ) {
		return false;
	}
	echo $html; // phpcs:ignore WordPress.Security.EscapeOutput -- Elementor çıktısı kendi içinde escape edilir.
	return true;
}

/**
 * Menü atanmamışsa sayfa listesi yerine boş bir menü basar.
 */
function {{prefix}}_menu_fallback() {
	if ( current_user_can( 'edit_theme_options' ) ) {
		echo '<ul class="{{prefix}}-menu"><li><a href="' . esc_url( admin_url( 'nav-menus.php' ) ) . '">' . esc_html__( 'Menü ekle', '{{textdomain}}' ) . '</a></li></ul>';
	}
}

/**
 * Sayfa Elementor ile mi oluşturuldu? (Elementor kapalıyken false)
 *
 * @param int $post_id Yazı ID'si.
 * @return bool
 */
function {{prefix}}_is_built_with_elementor( $post_id ) {
	if ( ! did_action( 'elementor/loaded' ) ) {
		return false;
	}
	$document = \Elementor\Plugin::$instance->documents->get( $post_id );
	return $document && $document->is_built_with_elementor();
}
