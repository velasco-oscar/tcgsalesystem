pub type Result<T> = std::result::Result<T, String>;
pub fn sql(error: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(_, Some(message)) = &error {
        if message.contains("UNIQUE constraint") {
            return "El SKU, categoría o referencia ya existe.".into();
        }
        if message.contains("Existencias") {
            return message.clone();
        }
    }
    crate::logging::error(&format!("SQLite: {error}"));
    "No se pudo completar la operación local. Revisa el registro de errores.".into()
}
