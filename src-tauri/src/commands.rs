use crate::{backups, db, logging, pos, settings};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub connection: Mutex<Result<Connection, String>>,
    pub directory: PathBuf,
}
fn with_db<T>(
    state: &AppState,
    f: impl FnOnce(&mut Connection) -> pos::Result<T>,
) -> pos::Result<T> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a los datos locales. Reinicia la aplicación.")?;
    let connection = connection.as_mut().map_err(|error| error.clone())?;
    let result = f(connection);
    if let Err(error) = &result {
        logging::error(error);
    }
    result
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    version: &'static str,
    schema_version: i64,
    settings: settings::StoreSettings,
    currencies: &'static [settings::CurrencyOption],
    currency_locked: bool,
    time_zone_locked: bool,
}
#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> pos::Result<AppStatus> {
    with_db(&state, |c| {
        Ok(AppStatus {
            version: env!("CARGO_PKG_VERSION"),
            schema_version: db::SCHEMA_VERSION,
            settings: db::store_settings(c).map_err(pos::sql)?,
            currencies: settings::CURRENCIES,
            currency_locked: c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM sales)",
                    [],
                    |r| r.get(0),
                )
                .map_err(pos::sql)?,
            time_zone_locked: c
                .query_row("SELECT EXISTS(SELECT 1 FROM sales)", [], |r| r.get(0))
                .map_err(pos::sql)?,
        })
    })
}
#[tauri::command]
pub fn save_store_settings(
    settings: settings::StoreSettings,
    state: State<'_, AppState>,
) -> pos::Result<settings::StoreSettings> {
    let validated = settings::validate(settings)?;
    with_db(&state, |c| {
        db::update_store_settings(c, &validated).map_err(|e| match e {
            rusqlite::Error::InvalidParameterName(message) => message,
            error => pos::sql(error),
        })?;
        Ok(validated)
    })
}
#[tauri::command]
pub fn get_product(id: i64, state: State<'_, AppState>) -> pos::Result<pos::Product> {
    with_db(&state, |c| pos::product(c, id))
}
#[tauri::command]
pub fn get_products(
    search: String,
    include_inactive: bool,
    offset: i64,
    state: State<'_, AppState>,
) -> pos::Result<Vec<pos::Product>> {
    with_db(&state, |c| {
        pos::products(c, &search, include_inactive, offset)
    })
}
#[tauri::command]
pub fn save_product(input: pos::ProductInput, state: State<'_, AppState>) -> pos::Result<i64> {
    with_db(&state, |c| pos::save_product(c, input))
}
#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> pos::Result<Vec<pos::Category>> {
    with_db(&state, |c| pos::categories(c))
}
#[tauri::command]
pub fn save_category(id: Option<i64>, name: String, state: State<'_, AppState>) -> pos::Result<()> {
    with_db(&state, |c| pos::save_category(c, id, &name))
}
#[tauri::command]
pub fn get_movements(
    product_id: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> pos::Result<Vec<pos::Movement>> {
    with_db(&state, |c| pos::movements(c, product_id, offset))
}
#[tauri::command]
pub fn record_stock(
    product_id: i64,
    quantity: i64,
    kind: String,
    reason: String,
    state: State<'_, AppState>,
) -> pos::Result<()> {
    with_db(&state, |c| {
        pos::record_stock(c, product_id, quantity, &kind, &reason)
    })
}
#[tauri::command]
pub fn checkout(
    input: pos::Checkout,
    state: State<'_, AppState>,
) -> Result<pos::Sale, CheckoutFailure> {
    let mut connection = state.connection.lock().map_err(|_| CheckoutFailure {
        message: "No se pudo acceder a los datos. Reintenta el mismo cobro.".into(),
        definite: false,
    })?;
    let request_id = input.request_id.clone();
    let connection = connection.as_mut().map_err(|message| CheckoutFailure {
        message: message.clone(),
        definite: false,
    })?;
    pos::checkout(connection, input).map_err(|message| {
        logging::error(&message);
        let definite = connection
            .query_row(
                "SELECT NOT EXISTS(SELECT 1 FROM sales WHERE request_id=?1)",
                rusqlite::params![request_id],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(false);
        CheckoutFailure { message, definite }
    })
}

#[derive(Serialize)]
pub struct CheckoutFailure {
    message: String,
    definite: bool,
}
#[tauri::command]
pub fn cancel_sale(
    id: i64,
    reason: String,
    restocked: bool,
    refunded: bool,
    state: State<'_, AppState>,
) -> pos::Result<pos::Sale> {
    with_db(&state, |c| pos::cancel(c, id, &reason, restocked, refunded))
}
#[tauri::command]
pub fn get_sale(id: i64, state: State<'_, AppState>) -> pos::Result<pos::Sale> {
    with_db(&state, |c| pos::sale(c, id))
}
#[tauri::command]
pub fn get_history(
    period: pos::Period,
    state: State<'_, AppState>,
) -> pos::Result<Vec<pos::SaleSummary>> {
    with_db(&state, |c| pos::history(c, &period))
}
#[tauri::command]
pub fn get_report(period: pos::Period, state: State<'_, AppState>) -> pos::Result<pos::Report> {
    with_db(&state, |c| pos::report(c, &period))
}
fn file_path(file: tauri_plugin_dialog::FilePath) -> pos::Result<PathBuf> {
    file.into_path()
        .map_err(|_| "Selecciona un archivo local.".into())
}
#[tauri::command]
pub async fn export_report(
    app: tauri::AppHandle,
    period: pos::Period,
    state: State<'_, AppState>,
) -> pos::Result<Option<String>> {
    let Some(file) = app
        .dialog()
        .file()
        .set_file_name(format!("ventas-{}-{}.csv", period.from, period.to))
        .add_filter("CSV", &["csv"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file_path(file)?;
    let csv = with_db(&state, |c| pos::report_csv(c, &period))?;
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("Elige un archivo nuevo para exportar: {e}"))?;
    file.write_all(csv.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("No se completó la exportación: {e}"))?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
pub async fn create_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> pos::Result<Option<String>> {
    let Some(file) = app
        .dialog()
        .file()
        .set_file_name(format!(
            "respaldo-{}.sqlite3",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ))
        .add_filter("Respaldo SQLite", &["sqlite3"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file_path(file)?;
    with_db(&state, |c| backups::snapshot(c, &path))?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
pub async fn choose_restore(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> pos::Result<Option<String>> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Respaldo SQLite", &["sqlite3"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file_path(file)?;
    with_db(&state, |c| {
        let source = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(pos::sql)?;
        backups::validate(&source, c)
    })?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
pub async fn restore_backup(
    path: String,
    confirmed: bool,
    state: State<'_, AppState>,
) -> pos::Result<String> {
    if !confirmed {
        return Err("Confirma explícitamente el reemplazo de los datos actuales.".into());
    }
    with_db(&state, |c| {
        backups::restore(c, Path::new(&path), &state.directory).map(|p| p.display().to_string())
    })
}
