<?php
/**
 * Template Name: Tam genişlik
 * Template Post Type: page, post
 *
 * Header ve footer ile, kenar boşluğu olmadan tam genişlik içerik.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

get_header();
?>
<main id="primary" class="{{prefix}}-main {{prefix}}-full-width">
	<?php
	while ( have_posts() ) :
		the_post();
		the_content();
	endwhile;
	?>
</main>
<?php
get_footer();
