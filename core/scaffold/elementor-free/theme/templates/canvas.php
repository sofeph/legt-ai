<?php
/**
 * Template Name: Boş tuval
 * Template Post Type: page, post
 *
 * Header ve footer olmadan yalnızca içerik (Elementor kapalıyken de çalışır).
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class( '{{prefix}}-canvas' ); ?>>
<?php wp_body_open(); ?>
<?php
while ( have_posts() ) :
	the_post();
	the_content();
endwhile;
?>
<?php wp_footer(); ?>
</body>
</html>
