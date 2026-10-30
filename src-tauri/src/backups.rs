use crate::{db, pos};
use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub const APPLICATION_ID: i64 = 1_413_695_312;
pub fn unique_path(directory: &Path, prefix: &str, extension: &str) -> pos::Result<PathBuf> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(directory.join(format!("{prefix}-{stamp}.{extension}")))
}
pub fn snapshot(c: &Connection, path: &Path) -> pos::Result<()> {
    // Nunca sobrescribir un archivo elegido o un respaldo anterior.
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("No se pudo crear el archivo: {e}"))?;
    if let Err(e) = c.backup(rusqlite::MAIN_DB, path, None) {
        let _ = fs::remove_file(path);
        return Err(pos::sql(e));
    }
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}
fn schema(c: &Connection) -> pos::Result<Vec<(String, String, String)>> {
    c.prepare("SELECT type,name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").map_err(pos::sql)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(pos::sql)?.collect::<rusqlite::Result<_>>().map_err(pos::sql)
}
pub fn validate(c: &Connection, reference: &Connection) -> pos::Result<()> {
    c.pragma_update(None, "trusted_schema", false)
        .map_err(pos::sql)?;
    let app: i64 = c
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .map_err(pos::sql)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(pos::sql)?;
    if app != APPLICATION_ID {
        return Err("El archivo no es un respaldo de esta aplicación.".into());
    }
    if version != db::SCHEMA_VERSION {
        return Err(format!(
            "Respaldo incompatible: versión {version}; esta aplicación requiere {}.",
            db::SCHEMA_VERSION
        ));
    }
    if schema(c)? != schema(reference)? {
        return Err("El esquema del respaldo no coincide con esta versión.".into());
    }
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(pos::sql)?;
    if integrity != "ok"
        || c.prepare("PRAGMA foreign_key_check")
            .map_err(pos::sql)?
            .exists([])
            .map_err(pos::sql)?
    {
        return Err("El respaldo contiene errores de integridad.".into());
    }
    let inconsistent:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM products p WHERE p.stock != coalesce((SELECT sum(quantity) FROM stock_movements m WHERE m.product_id=p.id),0)) OR EXISTS(SELECT 1 FROM sales s WHERE s.total != coalesce((SELECT sum(quantity*price) FROM sale_items i WHERE i.sale_id=s.id),0)) OR EXISTS(SELECT 1 FROM cancellations x JOIN sales s ON s.id=x.sale_id WHERE x.refund!=s.total OR x.method!=s.method)",[],|r|r.get(0)).map_err(pos::sql)?;
    if inconsistent {
        return Err("El respaldo contiene saldos o importes inconsistentes.".into());
    }
    let settings = db::store_settings(c).map_err(pos::sql)?;
    if !settings.currency_code.is_empty() {
        crate::settings::validate(settings)?;
    }
    Ok(())
}
pub fn restore(c: &mut Connection, source: &Path, data_directory: &Path) -> pos::Result<PathBuf> {
    let backup_dir = data_directory.join("backups");
    let staged_path = unique_path(data_directory, "restore-staging", "sqlite3")?;
    let result = (|| {
        let source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "No se pudo abrir el respaldo. Selecciona un archivo SQLite válido.")?;
        source
            .pragma_update(None, "trusted_schema", false)
            .map_err(pos::sql)?;
        // Mantener un snapshot propio: el archivo elegido no puede cambiar entre validación y reemplazo.
        snapshot(&source, &staged_path)?;
        let staged = Connection::open_with_flags(&staged_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(pos::sql)?;
        validate(&staged, c)?;
        let recovery = unique_path(&backup_dir, "before-restore", "sqlite3")?;
        snapshot(c, &recovery)?;
        // El mutex de AppState excluye todos los casos de uso y no quedan statements activos.
        // Backup usa una transacción SQLite; el destino se revierte si falla antes de finalizar.
        let applied = (|| {
            rusqlite::backup::Backup::new(&staged, c)
                .map_err(pos::sql)?
                .run_to_completion(100, Duration::from_millis(5), None)
                .map_err(pos::sql)?;
            validate(c, &staged)
        })();
        if let Err(error) = applied {
            c.restore(
                rusqlite::MAIN_DB,
                &recovery,
                None::<fn(rusqlite::backup::Progress)>,
            )
            .map_err(|e| {
                format!(
                    "{error} No se pudo recuperar automáticamente: {e}. Respaldo seguro: {}",
                    recovery.display()
                )
            })?;
            return Err(format!(
                "No se restauró el archivo; se recuperaron los datos anteriores. {error}"
            ));
        }
        c.pragma_update(None, "foreign_keys", true)
            .map_err(pos::sql)?;
        Ok(recovery)
    })();
    let _ = fs::remove_file(staged_path);
    result
}
