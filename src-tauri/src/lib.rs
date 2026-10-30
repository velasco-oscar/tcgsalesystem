mod backups;
mod catalog;
#[cfg(test)]
mod catalog_tests;
mod commands;
mod db;
mod errors;
mod logging;
mod models;
mod pos;
#[cfg(test)]
mod pos_tests;
mod repository;
mod settings;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mut directory = app.path().app_local_data_dir()?;
            // Desarrollo y producción nunca comparten la base de datos.
            if cfg!(debug_assertions) {
                directory.push("development");
            }
            std::fs::create_dir_all(&directory)?;
            logging::init(directory.clone());
            let connection = db::open(&directory.join("tcg-pos.sqlite3"))
                .map_err(|error| {
                    logging::error(&format!("No se pudo abrir la base: {error}"));
                    format!("No se pudieron abrir los datos locales. No se permite operar hasta resolver el problema. Detalle: {error}")
                });
            app.manage(AppState {
                connection: Mutex::new(connection),
                directory,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::save_store_settings,
            commands::get_products,
            commands::get_product,
            commands::save_product,
            commands::get_categories,
            commands::save_category,
            commands::delete_category,
            commands::get_movements,
            commands::record_stock,
            commands::checkout,
            commands::cancel_sale,
            commands::get_sale,
            commands::get_history,
            commands::get_report,
            commands::export_report,
            commands::create_backup,
            commands::choose_restore,
            commands::restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar TCG POS");
}
