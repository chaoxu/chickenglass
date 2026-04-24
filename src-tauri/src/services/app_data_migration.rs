use std::fs;
use std::path::Path;

const LEGACY_APP_DATA_DIR_NAME: &str = "com.coflats.desktop";
const MIGRATION_MARKER_FILE: &str = ".coflat-migrated-from-com.coflats.desktop";

pub fn migrate_legacy_app_data_dir(current_app_data_dir: &Path) -> Result<(), String> {
    let Some(parent) = current_app_data_dir.parent() else {
        return Ok(());
    };
    let legacy_app_data_dir = parent.join(LEGACY_APP_DATA_DIR_NAME);
    migrate_legacy_app_data_dir_from_paths(&legacy_app_data_dir, current_app_data_dir)
}

fn migrate_legacy_app_data_dir_from_paths(
    legacy_app_data_dir: &Path,
    current_app_data_dir: &Path,
) -> Result<(), String> {
    if legacy_app_data_dir == current_app_data_dir || !legacy_app_data_dir.is_dir() {
        return Ok(());
    }
    if current_app_data_dir.exists() && !current_app_data_dir.is_dir() {
        return Err(format!(
            "Current app data path is not a directory: {}",
            current_app_data_dir.display()
        ));
    }
    if directory_has_entries(current_app_data_dir)? {
        return Ok(());
    }

    copy_directory_contents(legacy_app_data_dir, current_app_data_dir)?;
    fs::write(
        current_app_data_dir.join(MIGRATION_MARKER_FILE),
        format!(
            "Migrated Coflat app data from {}\n",
            legacy_app_data_dir.display()
        ),
    )
    .map_err(|error| format!("Failed to write app data migration marker: {error}"))?;
    Ok(())
}

fn directory_has_entries(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect app data directory: {error}"))?;
    Ok(entries.next().is_some())
}

fn copy_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read legacy app data directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to read legacy app data entry: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect legacy app data entry: {error}"))?;
        if file_type.is_dir() {
            copy_directory_contents(&source_path, &target_path)?;
        } else if file_type.is_file() || file_type.is_symlink() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Failed to create app data parent: {error}"))?;
            }
            fs::copy(&source_path, &target_path)
                .map_err(|error| format!("Failed to copy legacy app data file: {error}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MIGRATION_MARKER_FILE, migrate_legacy_app_data_dir_from_paths};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("coflat-{label}-{suffix}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn copies_legacy_app_data_when_current_directory_is_missing() {
        let root = create_temp_dir("app-data-migration-missing");
        let legacy = root.join("com.coflats.desktop");
        let current = root.join("com.coflat.desktop");
        fs::create_dir_all(legacy.join("recovery/project")).expect("create legacy app data");
        fs::write(legacy.join("recovery/project/main.json"), "draft").expect("write legacy file");

        migrate_legacy_app_data_dir_from_paths(&legacy, &current).expect("migrate app data");

        assert_eq!(
            fs::read_to_string(current.join("recovery/project/main.json")).unwrap(),
            "draft"
        );
        assert!(current.join(MIGRATION_MARKER_FILE).is_file());
        assert!(legacy.join("recovery/project/main.json").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copies_legacy_app_data_into_empty_current_directory() {
        let root = create_temp_dir("app-data-migration-empty");
        let legacy = root.join("com.coflats.desktop");
        let current = root.join("com.coflat.desktop");
        fs::create_dir_all(&legacy).expect("create legacy app data");
        fs::create_dir_all(&current).expect("create current app data");
        fs::write(legacy.join("settings.json"), "{}").expect("write legacy file");

        migrate_legacy_app_data_dir_from_paths(&legacy, &current).expect("migrate app data");

        assert_eq!(
            fs::read_to_string(current.join("settings.json")).unwrap(),
            "{}"
        );
        assert!(current.join(MIGRATION_MARKER_FILE).is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_overwrite_populated_current_app_data() {
        let root = create_temp_dir("app-data-migration-populated");
        let legacy = root.join("com.coflats.desktop");
        let current = root.join("com.coflat.desktop");
        fs::create_dir_all(&legacy).expect("create legacy app data");
        fs::create_dir_all(&current).expect("create current app data");
        fs::write(legacy.join("settings.json"), "legacy").expect("write legacy file");
        fs::write(current.join("settings.json"), "current").expect("write current file");

        migrate_legacy_app_data_dir_from_paths(&legacy, &current).expect("migrate app data");

        assert_eq!(
            fs::read_to_string(current.join("settings.json")).unwrap(),
            "current"
        );
        assert!(!current.join(MIGRATION_MARKER_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_missing_legacy_app_data() {
        let root = create_temp_dir("app-data-migration-missing-legacy");
        let legacy = root.join("com.coflats.desktop");
        let current = root.join("com.coflat.desktop");

        migrate_legacy_app_data_dir_from_paths(&legacy, &current).expect("migrate app data");

        assert!(!current.exists());
        let _ = fs::remove_dir_all(root);
    }
}
