<?php
/**
 * Ana şablon: tekil sayfa/yazı ve arşivler.
 *
 * @package {{Prefix}}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

get_header();
?>
<main id="primary" class="{{prefix}}-main">
	<?php if ( have_posts() ) : ?>
		<?php if ( is_singular() ) : ?>
			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<article id="post-<?php the_ID(); ?>" <?php post_class( '{{prefix}}-entry' ); ?>>
					<?php if ( ! {{prefix}}_is_built_with_elementor( get_the_ID() ) ) : ?>
						<div class="{{prefix}}-container">
							<?php the_title( '<h1 class="{{prefix}}-entry__title">', '</h1>' ); ?>
							<?php if ( has_post_thumbnail() ) : ?>
								<div class="{{prefix}}-entry__thumb"><?php the_post_thumbnail( 'large' ); ?></div>
							<?php endif; ?>
							<div class="{{prefix}}-entry__content"><?php the_content(); ?></div>
							<?php wp_link_pages(); ?>
						</div>
						<?php
						if ( comments_open() || get_comments_number() ) {
							comments_template();
						}
						?>
					<?php else : ?>
						<?php the_content(); ?>
					<?php endif; ?>
				</article>
			<?php endwhile; ?>
		<?php else : ?>
			<div class="{{prefix}}-container">
				<?php if ( is_archive() ) : ?>
					<?php the_archive_title( '<h1 class="{{prefix}}-archive__title">', '</h1>' ); ?>
				<?php endif; ?>
				<div class="{{prefix}}-posts">
					<?php
					while ( have_posts() ) :
						the_post();
						?>
						<article id="post-<?php the_ID(); ?>" <?php post_class( '{{prefix}}-card' ); ?>>
							<?php if ( has_post_thumbnail() ) : ?>
								<a class="{{prefix}}-card__thumb" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'medium_large' ); ?></a>
							<?php endif; ?>
							<h2 class="{{prefix}}-card__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
							<div class="{{prefix}}-card__excerpt"><?php the_excerpt(); ?></div>
						</article>
					<?php endwhile; ?>
				</div>
				<?php the_posts_pagination(); ?>
			</div>
		<?php endif; ?>
	<?php else : ?>
		<div class="{{prefix}}-container">
			<p><?php esc_html_e( 'Gösterilecek içerik bulunamadı.', '{{textdomain}}' ); ?></p>
			<?php get_search_form(); ?>
		</div>
	<?php endif; ?>
</main>
<?php
get_footer();
