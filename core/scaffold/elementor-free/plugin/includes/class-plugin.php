<?php
/**
 * Widget kategorisi, asset kayıtları ve widget kayıtları.
 *
 * @package {{Prefix}}
 */

namespace {{Prefix}};

if ( ! defined( 'ABSPATH' ) ) exit;

final class Plugin {

	/** @var Plugin|null */
	private static $instance = null;

	/** @var bool */
	private $assets_registered = false;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'elementor/elements/categories_registered', array( $this, 'register_category' ) );
		add_action( 'elementor/widgets/register', array( $this, 'register_widgets' ) );
		add_action( 'elementor/frontend/after_register_styles', array( $this, 'register_assets' ) );
		add_action( 'elementor/frontend/after_register_scripts', array( $this, 'register_assets' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ), 5 );
	}

	/**
	 * Widget listesi (includes/widgets-manifest.php, plan'dan üretilir).
	 *
	 * @return array<int, array{name: string, class: string, file: string, css: string, js: string}>
	 */
	public static function widgets() {
		$widgets = require {{PREFIX}}_EW_PATH . 'includes/widgets-manifest.php';
		return is_array( $widgets ) ? $widgets : array();
	}

	public function register_category( $elements_manager ) {
		$elements_manager->add_category(
			'{{prefix}}',
			array(
				'title' => esc_html__( '{{name}}', '{{textdomain}}' ),
				'icon'  => 'eicon-apps',
			)
		);
	}

	/**
	 * Stiller ve script'ler yalnızca kaydedilir; widget'ın get_style_depends() /
	 * get_script_depends() listesi sayesinde sadece kullanıldığı sayfada yüklenir.
	 */
	public function register_assets() {
		if ( $this->assets_registered ) {
			return;
		}
		$this->assets_registered = true;

		foreach ( self::widgets() as $widget ) {
			if ( ! empty( $widget['css'] ) && file_exists( {{PREFIX}}_EW_PATH . $widget['css'] ) ) {
				wp_register_style( $widget['name'], {{PREFIX}}_EW_URL . $widget['css'], array(), {{PREFIX}}_EW_VERSION );
			}
			if ( ! empty( $widget['js'] ) && file_exists( {{PREFIX}}_EW_PATH . $widget['js'] ) ) {
				wp_register_script( $widget['name'], {{PREFIX}}_EW_URL . $widget['js'], array( 'elementor-frontend' ), {{PREFIX}}_EW_VERSION, true );
			}
		}
	}

	public function register_widgets( $widgets_manager ) {
		foreach ( self::widgets() as $widget ) {
			$file = {{PREFIX}}_EW_PATH . $widget['file'];
			if ( ! file_exists( $file ) ) {
				continue;
			}
			require_once $file;
			if ( class_exists( $widget['class'] ) ) {
				$widgets_manager->register( new $widget['class']() );
			}
		}
	}
}
