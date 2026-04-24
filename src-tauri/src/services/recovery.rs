use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

const BACKUP_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotExitBackup {
    pub version: u8,
    pub id: String,
    pub project_root: String,
    pub project_key: String,
    pub path: String,
    pub name: String,
    pub content: String,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_hash: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotExitBackupSummary {
    pub id: String,
    pub project_root: String,
    pub project_key: String,
    pub path: String,
    pub name: String,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_hash: Option<String>,
    pub updated_at: u64,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HotExitBackupInput {
    pub project_root: String,
    pub path: String,
    pub name: String,
    pub content: String,
    pub baseline_hash: Option<String>,
}

pub fn write_hot_exit_backup(
    app_data_dir: &Path,
    input: HotExitBackupInput,
) -> Result<HotExitBackupSummary, String> {
    write_hot_exit_backup_at(app_data_dir, input, now_ms()?)
}

fn write_hot_exit_backup_at(
    app_data_dir: &Path,
    input: HotExitBackupInput,
    now_ms: u64,
) -> Result<HotExitBackupSummary, String> {
    validate_non_empty("project root", &input.project_root)?;
    validate_non_empty("path", &input.path)?;
    validate_non_empty("name", &input.name)?;

    let project_key = project_key(&input.project_root);
    let id = backup_id(&input.project_root, &input.path);
    let backup_path = backup_file_path(app_data_dir, &input.project_root, &input.path);
    let created_at = read_backup_file(&backup_path)?
        .map(|backup| backup.created_at)
        .unwrap_or(now_ms);
    let backup = HotExitBackup {
        version: BACKUP_VERSION,
        id,
        project_root: input.project_root,
        project_key,
        path: input.path,
        name: input.name,
        content_hash: hash_hex(&input.content),
        content: input.content,
        baseline_hash: input.baseline_hash,
        created_at,
        updated_at: now_ms,
    };
    let encoded = serde_json::to_vec_pretty(&backup)
        .map_err(|error| format!("Failed to serialize hot-exit backup: {error}"))?;
    write_atomic(&backup_path, &encoded)
        .map_err(|error| format!("Failed to write hot-exit backup: {error}"))?;
    Ok(summary_for_backup(&backup, encoded.len() as u64))
}

pub fn list_hot_exit_backups(
    app_data_dir: &Path,
    project_root: &str,
) -> Result<Vec<HotExitBackupSummary>, String> {
    validate_non_empty("project root", project_root)?;
    let dir = project_backup_dir(app_data_dir, project_root);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!("Failed to list hot-exit backups: {error}"));
        }
    };

    let mut summaries = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read hot-exit backup: {error}"))?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to inspect hot-exit backup: {error}"))?;
        if !metadata.is_file() {
            continue;
        }
        let Some(backup) = read_backup_file(&entry.path())? else {
            continue;
        };
        if backup.version != BACKUP_VERSION || backup.project_key != project_key(project_root) {
            continue;
        }
        summaries.push(summary_for_backup(&backup, metadata.len()));
    }

    summaries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(summaries)
}

pub fn read_hot_exit_backup(
    app_data_dir: &Path,
    project_root: &str,
    path: &str,
) -> Result<Option<HotExitBackup>, String> {
    validate_non_empty("project root", project_root)?;
    validate_non_empty("path", path)?;
    let Some(backup) = read_backup_file(&backup_file_path(app_data_dir, project_root, path))?
    else {
        return Ok(None);
    };
    if backup.version != BACKUP_VERSION
        || backup.project_key != project_key(project_root)
        || backup.id != backup_id(project_root, path)
        || backup.path != path
    {
        return Ok(None);
    }
    Ok(Some(backup))
}

pub fn delete_hot_exit_backup(
    app_data_dir: &Path,
    project_root: &str,
    path: &str,
) -> Result<(), String> {
    validate_non_empty("project root", project_root)?;
    validate_non_empty("path", path)?;
    let file_path = backup_file_path(app_data_dir, project_root, path);
    match fs::remove_file(&file_path) {
        Ok(()) => {
            let _ = fs::remove_dir(project_backup_dir(app_data_dir, project_root));
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to delete hot-exit backup: {error}")),
    }
}

fn read_backup_file(path: &Path) -> Result<Option<HotExitBackup>, String> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read hot-exit backup: {error}")),
    };
    match serde_json::from_slice::<HotExitBackup>(&content) {
        Ok(backup) => Ok(Some(backup)),
        Err(_) => Ok(None),
    }
}

fn summary_for_backup(backup: &HotExitBackup, bytes: u64) -> HotExitBackupSummary {
    HotExitBackupSummary {
        id: backup.id.clone(),
        project_root: backup.project_root.clone(),
        project_key: backup.project_key.clone(),
        path: backup.path.clone(),
        name: backup.name.clone(),
        content_hash: backup.content_hash.clone(),
        baseline_hash: backup.baseline_hash.clone(),
        updated_at: backup.updated_at,
        bytes,
    }
}

fn backup_file_path(app_data_dir: &Path, project_root: &str, path: &str) -> PathBuf {
    project_backup_dir(app_data_dir, project_root)
        .join(format!("{}.json", backup_id(project_root, path)))
}

fn project_backup_dir(app_data_dir: &Path, project_root: &str) -> PathBuf {
    app_data_dir
        .join("recovery")
        .join(project_key(project_root))
}

fn backup_id(project_root: &str, path: &str) -> String {
    hash_hex(&format!("{project_root}\0{path}"))
}

fn project_key(project_root: &str) -> String {
    hash_hex(project_root)
}

fn hash_hex(input: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for unit in input.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn validate_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("Hot-exit backup {label} cannot be empty"));
    }
    Ok(())
}

fn now_ms() -> Result<u64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System time before Unix epoch: {error}"))?;
    Ok(duration.as_millis() as u64)
}

fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Path has no parent: {}", path.display()),
        )
    })?;
    fs::create_dir_all(parent)?;
    let temp_path = write_temp_file(parent, content)?;
    match fs::rename(&temp_path, path) {
        Ok(()) => sync_parent_directory(path),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn write_temp_file(parent: &Path, content: &[u8]) -> std::io::Result<PathBuf> {
    let mut last_error = None;
    for _ in 0..100 {
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".coflat-recovery-{}-{}.tmp",
            std::process::id(),
            counter
        ));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
                continue;
            }
            Err(error) => return Err(error),
        };
        if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        return Ok(temp_path);
    }
    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Failed to create recovery temp file",
        )
    }))
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        HotExitBackup, HotExitBackupInput, HotExitBackupSummary, delete_hot_exit_backup,
        list_hot_exit_backups, read_hot_exit_backup, summary_for_backup, write_hot_exit_backup_at,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    const HOT_EXIT_BACKUP_CONTRACT_JSON: &str =
        include_str!("../../../tests/contracts/hot-exit-backups.contract.json");

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    fn backup_input(project_root: &str, path: &str, content: &str) -> HotExitBackupInput {
        HotExitBackupInput {
            project_root: project_root.to_string(),
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            content: content.to_string(),
            baseline_hash: Some("baseline".to_string()),
        }
    }

    fn contract_record(name: &str) -> Value {
        let contract: Value = serde_json::from_str(HOT_EXIT_BACKUP_CONTRACT_JSON)
            .expect("parse hot-exit backup contract");
        contract
            .get(name)
            .unwrap_or_else(|| panic!("missing contract record: {name}"))
            .clone()
    }

    #[test]
    fn hot_exit_backup_serde_contract_matches_typescript_contract() {
        let expected = contract_record("backup");
        let backup: HotExitBackup = serde_json::from_value(expected.clone()).unwrap();

        assert_eq!(serde_json::to_value(&backup).unwrap(), expected);

        let mut without_baseline = backup;
        without_baseline.baseline_hash = None;
        let expected_without_baseline = serde_json::to_value(&without_baseline).unwrap();
        assert!(expected_without_baseline.get("baselineHash").is_none());
        let decoded_without_baseline: HotExitBackup =
            serde_json::from_value(expected_without_baseline).unwrap();
        assert_eq!(decoded_without_baseline.baseline_hash, None);
    }

    #[test]
    fn hot_exit_backup_summary_serde_contract_matches_typescript_contract() {
        let backup: HotExitBackup = serde_json::from_value(contract_record("backup")).unwrap();
        let expected = contract_record("summary");
        let bytes = expected
            .get("bytes")
            .and_then(Value::as_u64)
            .expect("summary contract bytes");
        let summary = summary_for_backup(&backup, bytes);

        assert_eq!(serde_json::to_value(&summary).unwrap(), expected);

        let mut without_baseline = backup;
        without_baseline.baseline_hash = None;
        let summary_without_baseline: HotExitBackupSummary =
            summary_for_backup(&without_baseline, bytes);
        let expected_without_baseline = serde_json::to_value(&summary_without_baseline).unwrap();
        assert!(expected_without_baseline.get("baselineHash").is_none());
    }

    #[test]
    fn writes_reads_lists_and_deletes_backup() {
        let dir = create_temp_dir("recovery-roundtrip");
        let input = backup_input("/project", "notes/main.md", "draft");

        let summary = write_hot_exit_backup_at(&dir, input.clone(), 100).unwrap();

        assert_eq!(summary.path, "notes/main.md");
        assert_eq!(summary.name, "main.md");
        assert_eq!(summary.updated_at, 100);
        assert!(summary.bytes > 0);

        let backup = read_hot_exit_backup(&dir, "/project", "notes/main.md")
            .unwrap()
            .expect("backup exists");
        assert_eq!(backup.content, "draft");
        assert_eq!(backup.created_at, 100);
        assert_eq!(backup.updated_at, 100);

        let summaries = list_hot_exit_backups(&dir, "/project").unwrap();
        assert_eq!(summaries, vec![summary]);

        delete_hot_exit_backup(&dir, "/project", "notes/main.md").unwrap();
        assert!(
            read_hot_exit_backup(&dir, "/project", "notes/main.md")
                .unwrap()
                .is_none()
        );
        assert!(list_hot_exit_backups(&dir, "/project").unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwriting_backup_preserves_created_at_and_updates_content() {
        let dir = create_temp_dir("recovery-overwrite");

        write_hot_exit_backup_at(&dir, backup_input("/project", "main.md", "first"), 100).unwrap();
        let summary =
            write_hot_exit_backup_at(&dir, backup_input("/project", "main.md", "second"), 250)
                .unwrap();

        let backup = read_hot_exit_backup(&dir, "/project", "main.md")
            .unwrap()
            .expect("backup exists");
        assert_eq!(backup.content, "second");
        assert_eq!(backup.created_at, 100);
        assert_eq!(backup.updated_at, 250);
        assert_eq!(summary.updated_at, 250);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_roots_are_isolated() {
        let dir = create_temp_dir("recovery-project-isolation");
        write_hot_exit_backup_at(&dir, backup_input("/project-a", "main.md", "a"), 100).unwrap();
        write_hot_exit_backup_at(&dir, backup_input("/project-b", "main.md", "b"), 200).unwrap();

        let a = list_hot_exit_backups(&dir, "/project-a").unwrap();
        let b = list_hot_exit_backups(&dir, "/project-b").unwrap();

        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_ne!(a[0].project_key, b[0].project_key);
        assert_eq!(a[0].updated_at, 100);
        assert_eq!(b[0].updated_at, 200);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_ignores_corrupt_json() {
        let dir = create_temp_dir("recovery-corrupt");
        let summary =
            write_hot_exit_backup_at(&dir, backup_input("/project", "main.md", "draft"), 100)
                .unwrap();
        let project_dir = dir.join("recovery").join(summary.project_key.clone());
        fs::write(project_dir.join("corrupt.json"), "{not json").unwrap();

        let summaries = list_hot_exit_backups(&dir, "/project").unwrap();

        assert_eq!(summaries, vec![summary]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_missing_backup_is_ok() {
        let dir = create_temp_dir("recovery-delete-missing");

        delete_hot_exit_backup(&dir, "/project", "missing.md").unwrap();

        let _ = fs::remove_dir_all(&dir);
    }
}
