use crate::settings::StoreSettings;
use rusqlite::{Connection, TransactionBehavior, params};
use std::{
    error::Error,
    fs,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type DbResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
pub const SCHEMA_VERSION: i64 = 3;

pub fn open(path: &Path) -> DbResult<Connection> {
    let mut connection = Connection::open(path)?;
    connection.create_scalar_function(
        "unicode_lower",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC
            | rusqlite::functions::FunctionFlags::SQLITE_INNOCUOUS,
        |context| Ok(context.get::<String>(0)?.to_lowercase()),
    )?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    migrate(&mut connection, path)?;
    let application_id: i64 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    if application_id != crate::backups::APPLICATION_ID {
        return Err("El archivo de datos no pertenece a esta aplicación.".into());
    }
    Ok(connection)
}

fn migrate(connection: &mut Connection, path: &Path) -> DbResult<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(
            "La base de datos pertenece a una versión más reciente de la aplicación.".into(),
        );
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version > 0 {
        backup_before_migration(connection, path, version)?;
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let locked_version: i64 =
        transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if locked_version != version {
        return Err(
            "El esquema cambió durante la preparación. Cierra y vuelve a abrir la aplicación."
                .into(),
        );
    }
    if version == 0 {
        transaction.execute_batch(include_str!("../migrations/001_initial.sql"))?;
    }
    if version < 2 {
        transaction.execute_batch(include_str!("../migrations/002_business_settings.sql"))?;
    }
    if version < 3 {
        transaction.execute_batch(include_str!("../migrations/003_pos.sql"))?;
    }
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

fn backup_before_migration(connection: &Connection, path: &Path, version: i64) -> DbResult<()> {
    let directory = path
        .parent()
        .ok_or("No se encontró la carpeta de datos.")?
        .join("backups");
    fs::create_dir_all(&directory)?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Ruta de datos inválida.")?;
    let backup_path = directory.join(format!("{filename}.before-v{version}-{timestamp}.sqlite3"));
    // Reservar un archivo nuevo para no reemplazar nunca un respaldo existente.
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup_path)?;
    let destination = backup_path.to_str().ok_or("Ruta de respaldo inválida.")?;
    connection.execute("VACUUM INTO ?1", params![destination])?;
    file.sync_all()?;
    let backup =
        Connection::open_with_flags(&backup_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = backup.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err("No se pudo verificar el respaldo previo a la migración.".into());
    }
    Ok(())
}

pub fn store_settings(connection: &Connection) -> rusqlite::Result<StoreSettings> {
    connection.query_row(
        "SELECT store_name, business_sector, currency_code, time_zone FROM app_settings WHERE id = 1",
        [],
        |row| {
            Ok(StoreSettings {
                store_name: row.get(0)?,
                business_sector: row.get(1)?,
                currency_code: row.get(2)?,
                time_zone: row.get(3)?,
            })
        },
    )
}

pub fn update_store_settings(
    connection: &Connection,
    settings: &StoreSettings,
) -> rusqlite::Result<()> {
    let previous = store_settings(connection)?;
    let monetary_data: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM sales)",
        [],
        |row| row.get(0),
    )?;
    if monetary_data && previous.currency_code != settings.currency_code {
        return Err(rusqlite::Error::InvalidParameterName(
            "La moneda no puede cambiarse después de registrar productos u operaciones.".into(),
        ));
    }
    let has_sales: bool =
        connection.query_row("SELECT EXISTS(SELECT 1 FROM sales)", [], |row| row.get(0))?;
    if has_sales && previous.time_zone != settings.time_zone {
        return Err(rusqlite::Error::InvalidParameterName(
            "La zona horaria no puede cambiarse después de registrar ventas.".into(),
        ));
    }
    connection.execute(
        "UPDATE app_settings SET store_name = ?1, business_sector = ?2, currency_code = ?3, time_zone = ?4,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1",
        params![
            settings.store_name,
            settings.business_sector,
            settings.currency_code,
            settings.time_zone
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_is_repeatable_and_preserves_saved_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite3");
        {
            let connection = open(&path).unwrap();
            assert_eq!(store_settings(&connection).unwrap().store_name, "");
            assert_eq!(store_settings(&connection).unwrap().currency_code, "");
            update_store_settings(&connection, &example_settings()).unwrap();
        }
        let connection = open(&path).unwrap();
        assert_eq!(store_settings(&connection).unwrap(), example_settings());
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        let foreign_keys: i64 = connection
            .pragma_query_value(None, "foreign_keys", |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(foreign_keys, 1);
    }

    #[test]
    fn future_schema_is_rejected_without_overwriting_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.sqlite3");
        {
            let connection = open(&path).unwrap();
            update_store_settings(&connection, &example_settings()).unwrap();
            connection.pragma_update(None, "user_version", 999).unwrap();
        }
        assert!(open(&path).is_err());
        let connection = Connection::open(path).unwrap();
        assert_eq!(store_settings(&connection).unwrap(), example_settings());
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 999);
    }

    fn example_settings() -> StoreSettings {
        StoreSettings {
            store_name: "Mi negocio".into(),
            business_sector: "Papelería".into(),
            currency_code: "USD".into(),
            time_zone: "America/Tijuana".into(),
        }
    }

    fn create_version_one(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        connection
            .execute(
                "UPDATE app_settings SET store_name = 'Negocio existente'",
                [],
            )
            .unwrap();
        connection.pragma_update(None, "user_version", 1).unwrap();
    }

    #[test]
    fn upgrades_existing_database_and_preserves_a_valid_pre_migration_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite3");
        create_version_one(&path);
        let connection = open(&path).unwrap();
        let settings = store_settings(&connection).unwrap();
        assert_eq!(settings.store_name, "Negocio existente");
        assert_eq!(settings.business_sector, "");
        assert_eq!(settings.currency_code, "");
        let backups: Vec<_> = fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .collect();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
        let version: i64 = backup
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
        let name: String = backup
            .query_row("SELECT store_name FROM app_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Negocio existente");
        drop(connection);
        open(&path).unwrap();
        assert_eq!(
            fs::read_dir(directory.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn failed_backup_leaves_existing_schema_and_settings_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite3");
        create_version_one(&path);
        fs::write(directory.path().join("backups"), "Impide crear la carpeta").unwrap();
        assert!(open(&path).is_err());
        let connection = Connection::open(&path).unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
        let name: String = connection
            .query_row("SELECT store_name FROM app_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Negocio existente");
    }

    #[test]
    fn failed_settings_update_does_not_save_partial_changes() {
        let directory = tempfile::tempdir().unwrap();
        let connection = open(&directory.path().join("test.sqlite3")).unwrap();
        update_store_settings(&connection, &example_settings()).unwrap();
        let invalid = StoreSettings {
            store_name: "No debe guardarse".into(),
            currency_code: "INVALID".into(),
            ..example_settings()
        };
        assert!(update_store_settings(&connection, &invalid).is_err());
        assert_eq!(store_settings(&connection).unwrap(), example_settings());
    }
}
