use std::{io::Write, path::PathBuf, sync::OnceLock};
static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
pub fn init(directory: PathBuf) {
    let _ = DIRECTORY.set(directory);
}
pub fn error(message: &str) {
    eprintln!("{message}");
    if let Some(directory) = DIRECTORY.get() {
        let path = directory.join("errors.log");
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > 1_000_000) {
            let previous = directory.join("errors.previous.log");
            let _ = std::fs::remove_file(&previous);
            let _ = std::fs::rename(&path, previous);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(
                file,
                "{} {}",
                crate::pos::now(),
                message.replace(['\r', '\n'], " ")
            );
        }
    }
}
