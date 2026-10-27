<?php
/**
 * Widget'lar için WordPress menü yardımcıları: header/footer menüleri
 * Görünüm > Menüler'den yönetilir, widget'a metin gömülmez.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Elementor SELECT kontrolü için seçenekler: boş = tema konumundaki menü.
 *
 * @return array<string,string>
 */
function {{prefix}}_menu_options() {
	$options = array( '' => esc_html__( 'Tema konumundaki menü (otomatik)', '{{textdomain}}' ) );
	foreach ( wp_get_nav_menus() as $menu ) {
		$options[ (string) $menu->term_id ] = $menu->name;
	}
	return $options;
}

/**
 * Menüyü basar. Seçili menü yoksa konumdakini, o da yoksa hiçbir şey basmaz.
 *
 * @param string|int $menu_id  Seçili menü ID'si ('' = konuma bak).
 * @param string     $location Tema menü konumu ('primary' | 'footer').
 * @param string     $class    <ul> sınıfı.
 * @param int        $depth    Derinlik.
 * @return bool Menü basıldıysa true; false ise widget kendi yedek öğelerini basabilir.
 */
function {{prefix}}_render_menu( $menu_id, $location, $class, $depth = 2 ) {
	$args = array(
		'container'   => false,
		'menu_class'  => $class,
		'depth'       => $depth,
		'fallback_cb' => false,
		'echo'        => false,
	);
	if ( $menu_id ) {
		$args['menu'] = (int) $menu_id;
	} elseif ( has_nav_menu( $location ) ) {
		$args['theme_location'] = $location;
	} else {
		return false;
	}
	$html = wp_nav_menu( $args );
	if ( ! $html ) {
		return false;
	}
	echo wp_kses_post( $html );
	return true;
}
