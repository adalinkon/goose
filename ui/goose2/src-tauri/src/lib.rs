mod commands;
mod services;
mod types;

use services::distro_bundle::DistroBundleState;
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .targets([tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                )])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        ;

    #[cfg(feature = "app-test-driver")]
    let builder = builder.plugin(tauri_plugin_app_test_driver::init());

    builder
        .setup(|app| {
            app.manage(DistroBundleState::new(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::acp::get_goose_serve_url,
            commands::acp::get_goose_serve_host_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
