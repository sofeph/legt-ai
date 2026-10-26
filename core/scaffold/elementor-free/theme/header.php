<?php
/**
 * Site başlığı. Tasarım Elementor ile yapılan "Header" layout'undan gelir
 * (Görünüm > Özelleştir > Header / Footer); seçim yoksa sade bir yedek header basılır.
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
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link screen-reader-text" href="#primary"><?php esc_html_e( 'İçeriğe geç', '{{textdomain}}' ); ?></a>
<?php if ( ! {{prefix}}_render_layout( 'header' ) ) : ?>
	<header class="{{prefix}}-site-header">
		<div class="{{prefix}}-container {{prefix}}-site-header__inner">
			<div class="{{prefix}}-site-header__brand">
				<?php if ( has_custom_logo() ) : ?>
					<?php the_custom_logo(); ?>
				<?php else : ?>
					<a class="{{prefix}}-site-header__title" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home"><?php bloginfo( 'name' ); ?></a>
				<?php endif; ?>
			</div>
			<nav class="{{prefix}}-site-header__nav" aria-label="<?php esc_attr_e( 'Ana menü', '{{textdomain}}' ); ?>">
				<?php
				wp_nav_menu(
					array(
						'theme_location' => 'primary',
						'container'      => false,
						'menu_class'     => '{{prefix}}-menu',
						'fallback_cb'    => '{{prefix}}_menu_fallback',
						'depth'          => 2,
					)
				);
				?>
			</nav>
		</div>
	</header>
<?php endif; ?>
