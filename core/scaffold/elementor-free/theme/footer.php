<?php
/**
 * Site altbilgisi. Tasarım Elementor ile yapılan "Footer" layout'undan gelir;
 * seçim yoksa sade bir yedek footer basılır.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

if ( ! {{prefix}}_render_layout( 'footer' ) ) : ?>
	<footer class="{{prefix}}-site-footer">
		<div class="{{prefix}}-container {{prefix}}-site-footer__inner">
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'footer',
					'container'      => false,
					'menu_class'     => '{{prefix}}-menu {{prefix}}-menu--footer',
					'fallback_cb'    => false,
					'depth'          => 1,
				)
			);
			?>
			<p class="{{prefix}}-site-footer__copy">&copy; <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?></p>
		</div>
	</footer>
<?php endif; ?>
<?php wp_footer(); ?>
</body>
</html>
