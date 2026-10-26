<?php
/**
 * Arama sonuçları.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

get_header();
?>
<main id="primary" class="{{prefix}}-main {{prefix}}-search">
	<div class="{{prefix}}-container">
		<h1>
			<?php
			/* translators: %s: arama terimi */
			printf( esc_html__( '"%s" için sonuçlar', '{{textdomain}}' ), esc_html( get_search_query() ) );
			?>
		</h1>
		<?php get_search_form(); ?>
		<?php if ( have_posts() ) : ?>
			<div class="{{prefix}}-posts">
				<?php
				while ( have_posts() ) :
					the_post();
					?>
					<article id="post-<?php the_ID(); ?>" <?php post_class( '{{prefix}}-card' ); ?>>
						<h2 class="{{prefix}}-card__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
						<div class="{{prefix}}-card__excerpt"><?php the_excerpt(); ?></div>
					</article>
				<?php endwhile; ?>
			</div>
			<?php the_posts_pagination(); ?>
		<?php else : ?>
			<p><?php esc_html_e( 'Sonuç bulunamadı. Farklı kelimelerle tekrar deneyin.', '{{textdomain}}' ); ?></p>
		<?php endif; ?>
	</div>
</main>
<?php
get_footer();
