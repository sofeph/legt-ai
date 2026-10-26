<?php
/**
 * 404 sayfası.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

get_header();
?>
<main id="primary" class="{{prefix}}-main {{prefix}}-404">
	<div class="{{prefix}}-container">
		<h1><?php esc_html_e( 'Sayfa bulunamadı', '{{textdomain}}' ); ?></h1>
		<p><?php esc_html_e( 'Aradığınız sayfa taşınmış ya da silinmiş olabilir. Aramayı deneyin.', '{{textdomain}}' ); ?></p>
		<?php get_search_form(); ?>
		<p><a class="{{prefix}}-button" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Ana sayfaya dön', '{{textdomain}}' ); ?></a></p>
	</div>
</main>
<?php
get_footer();
