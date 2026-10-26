<?php
/**
 * Plugin Name: LEGT AI test ortamı
 * Description: Yalnızca LEGT AI canlı test sitesinde yüklüdür. Çevrim dışı çalışır, güncelleme denetimlerini kapatır.
 */

// Güncelleme denetimleri dışarı bağlanamadığı için her admin isteğinde debug.log'a uyarı yazar
remove_action( 'admin_init', '_maybe_update_core' );
remove_action( 'admin_init', '_maybe_update_plugins' );
remove_action( 'admin_init', '_maybe_update_themes' );
remove_action( 'wp_version_check', 'wp_version_check' );
remove_action( 'wp_update_plugins', 'wp_update_plugins' );
remove_action( 'wp_update_themes', 'wp_update_themes' );
remove_action( 'init', 'wp_schedule_update_checks' );
add_filter( 'pre_site_transient_update_core', '__return_null' );
add_filter( 'pre_site_transient_update_plugins', '__return_null' );
add_filter( 'pre_site_transient_update_themes', '__return_null' );
add_filter( 'automatic_updater_disabled', '__return_true' );

// Elementor: karşılama sihirbazı ve kullanım verisi bildirimi testleri bölmesin
add_filter( 'elementor/admin/onboarding/is_enabled', '__return_false' );
add_filter( 'pre_option_elementor_tracker_notice', function () { return '1'; } );

// Tema kancalarının çağrıldığını tarayıcı tarafı bu işaretlerden anlar (Elementor önizlemesi wp_footer'a muhtaç)
if ( ! is_admin() ) {
	add_action( 'wp_head', function () { echo "<!-- legt:wp_head -->\n"; }, 1 );
	add_action( 'wp_body_open', function () { echo "<!-- legt:wp_body_open -->\n"; }, 1 );
	add_action( 'wp_footer', function () { echo "<!-- legt:wp_footer -->\n"; }, 9999 );
}
