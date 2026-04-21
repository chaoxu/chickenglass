use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use same_file::Handle as FileHandle;
use serde::Serialize;

use super::path_filter::should_ignore_path_segment;
use crate::commands::state::ProjectRootEntry;
use crate::services::path::file_name_to_frontend_string;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A file or directory entry for the sidebar tree.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

pub fn install_project_root(
    roots: &mut HashMap<String, ProjectRootEntry>,
    window_label: &str,
    path: PathBuf,
    generation: u64,
) -> bool {
    if matches!(
        roots.get(window_label),
        Some(existing) if existing.generation > generation
    ) {
        return false;
    }

    roots.insert(
        window_label.to_string(),
        ProjectRootEntry { generation, path },
    );
    true
}

pub fn read_text_file(path: &Path, relative_path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read '{}': {}", relative_path, e))
}

pub fn write_text_file(path: &Path, relative_path: &str, content: &str) -> Result<(), String> {
    write_existing_file(path, content).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("File not found: {}", relative_path),
        _ => format!("Failed to write '{}': {}", relative_path, e),
    })
}

pub fn create_text_file(
    path: &Path,
    relative_path: &str,
    content: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    write_new_file(path, content.unwrap_or_default().as_bytes()).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("File already exists: {}", relative_path),
        _ => format!("Failed to create '{}': {}", relative_path, e),
    })
}

pub fn create_directory(path: &Path, relative_path: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::create_dir(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => {
            format!("Directory already exists: {}", relative_path)
        }
        _ => format!("Failed to create directory '{}': {}", relative_path, e),
    })
}

pub fn rename_path(
    old_path: &Path,
    old_relative_path: &str,
    new_path: &Path,
    new_relative_path: &str,
) -> Result<(), String> {
    if new_path.symlink_metadata().is_ok() {
        return Err(format!("File already exists: {}", new_relative_path));
    }
    fs::rename(old_path, new_path).map_err(|e| {
        format!(
            "Failed to rename '{}' to '{}': {}",
            old_relative_path, new_relative_path, e
        )
    })
}

pub fn delete_path(path: &Path, relative_path: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect '{}': {}", relative_path, e))?;
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to delete directory '{}': {}", relative_path, e))
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to delete '{}': {}", relative_path, e))
    }
}

pub fn write_binary_file(
    path: &Path,
    relative_path: &str,
    data_base64: &str,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    write_binary_bytes(path, &bytes)
        .map_err(|e| format!("Failed to write binary file '{}': {}", relative_path, e))
}

pub fn read_binary_file(path: &Path, relative_path: &str) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|e| format!("Failed to read binary file '{}': {}", relative_path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

pub fn list_tree(project_root: &Path) -> Result<FileEntry, String> {
    let name = project_root
        .file_name()
        .map(|n| file_name_to_frontend_string(n, "Project root name"))
        .transpose()?
        .unwrap_or_else(|| "project".to_string());
    build_tree(project_root, &name, "")
}

pub fn list_children(dir: &Path, relative_path: &str) -> Result<Vec<FileEntry>, String> {
    read_directory_children(dir, relative_path)
}

fn write_existing_file(path: &Path, content: &str) -> std::io::Result<()> {
    let expected = FileHandle::from_path(path)?;
    write_existing_file_with_handle(path, &expected, content)
}

fn write_new_file(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(content)
}

fn write_binary_bytes(path: &Path, content: &[u8]) -> std::io::Result<()> {
    match FileHandle::from_path(path) {
        Ok(expected) => write_existing_file_bytes_with_handle(path, &expected, content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => write_new_file(path, content),
        Err(error) => Err(error),
    }
}

fn write_existing_file_with_handle(
    path: &Path,
    expected: &FileHandle,
    content: &str,
) -> std::io::Result<()> {
    write_existing_file_bytes_with_handle(path, expected, content.as_bytes())
}

fn write_existing_file_bytes_with_handle(
    path: &Path,
    expected: &FileHandle,
    content: &[u8],
) -> std::io::Result<()> {
    let temp_path = write_same_directory_temp_file(path, content)?;
    let actual = match FileHandle::from_path(path) {
        Ok(actual) => actual,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };
    if &actual != expected {
        let _ = fs::remove_file(&temp_path);
        return Err(std::io::Error::other(format!(
            "File changed before write: {}",
            path.display()
        )));
    }

    match fs::rename(&temp_path, path) {
        Ok(()) => sync_parent_directory(path),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn write_same_directory_temp_file(path: &Path, content: &[u8]) -> std::io::Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Path has no parent: {}", path.display()),
        )
    })?;
    let mut last_error = None;

    for _ in 0..100 {
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(
            ".coflat-write-{}-{}.tmp",
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
        drop(file);
        return Ok(temp_path);
    }

    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Failed to create atomic write temp file",
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

fn read_directory_children(dir: &Path, relative_path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    let mut children = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = file_name_to_frontend_string(&entry.file_name(), "Directory entry name")?;

        if should_ignore_path_segment(&file_name) {
            continue;
        }

        let child_path = if relative_path.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", relative_path, file_name)
        };

        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        children.push(FileEntry {
            name: file_name,
            path: child_path,
            is_directory: file_type.is_dir(),
            children: None,
        });
    }

    sort_entries(&mut children);
    Ok(children)
}

fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.cmp(&b.name)
        }
    });
}

fn build_tree(dir: &Path, name: &str, relative_path: &str) -> Result<FileEntry, String> {
    let mut children = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = file_name_to_frontend_string(&entry.file_name(), "Directory entry name")?;

        if should_ignore_path_segment(&file_name) {
            continue;
        }

        let child_path = if relative_path.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", relative_path, file_name)
        };

        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            children.push(build_tree(&entry.path(), &file_name, &child_path)?);
        } else {
            children.push(FileEntry {
                name: file_name,
                path: child_path,
                is_directory: false,
                children: None,
            });
        }
    }

    sort_entries(&mut children);

    Ok(FileEntry {
        name: name.to_string(),
        path: relative_path.to_string(),
        is_directory: true,
        children: Some(children),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        FileEntry, create_text_file, delete_path, install_project_root, list_children, rename_path,
        write_binary_file, write_existing_file, write_existing_file_with_handle,
    };
    use crate::commands::state::ProjectRootEntry;
    use base64::Engine;
    use same_file::Handle as FileHandle;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    fn atomic_temp_paths(dir: &std::path::Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .expect("read temp dir")
            .filter_map(|entry| {
                let path = entry.expect("read temp entry").path();
                let name = path.file_name()?.to_str()?;
                name.starts_with(".coflat-write-").then_some(path)
            })
            .collect()
    }

    #[test]
    fn rejects_stale_project_root_generations() {
        let mut roots = HashMap::from([(
            "main".to_string(),
            ProjectRootEntry {
                generation: 4,
                path: PathBuf::from("/tmp/project-b"),
            },
        )]);

        let installed =
            install_project_root(&mut roots, "main", PathBuf::from("/tmp/project-a"), 3);

        assert!(!installed);
        assert_eq!(
            roots.get("main").map(|entry| entry.path.clone()),
            Some(PathBuf::from("/tmp/project-b")),
        );
    }

    #[test]
    fn replaces_project_root_with_newer_generation() {
        let mut roots = HashMap::from([(
            "main".to_string(),
            ProjectRootEntry {
                generation: 1,
                path: PathBuf::from("/tmp/project-a"),
            },
        )]);

        let installed =
            install_project_root(&mut roots, "main", PathBuf::from("/tmp/project-b"), 2);

        assert!(installed);
        let entry = roots.get("main").expect("project root entry");
        assert_eq!(entry.generation, 2);
        assert_eq!(entry.path, PathBuf::from("/tmp/project-b"));
    }

    #[test]
    fn file_entry_serializes_as_camel_case() {
        let entry = FileEntry {
            name: "docs".to_string(),
            path: "docs".to_string(),
            is_directory: true,
            children: Some(vec![FileEntry {
                name: "note.md".to_string(),
                path: "docs/note.md".to_string(),
                is_directory: false,
                children: None,
            }]),
        };
        let json = serde_json::to_value(&entry).expect("serialize FileEntry");
        assert_eq!(json["isDirectory"], true);
        assert_eq!(json["children"][0]["isDirectory"], false);
        assert!(json.get("is_directory").is_none());
    }

    #[test]
    fn read_directory_children_returns_shallow_sorted_entries() {
        let tmp = std::env::temp_dir().join("coflat-test-list-children");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("alpha")).unwrap();
        fs::create_dir_all(tmp.join("beta")).unwrap();
        fs::create_dir_all(tmp.join(".hidden")).unwrap();
        fs::create_dir_all(tmp.join("node_modules")).unwrap();
        fs::write(tmp.join("readme.md"), "hi").unwrap();
        fs::write(tmp.join("alpha/nested.md"), "nested").unwrap();

        let result = list_children(&tmp, "").unwrap();

        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta", "readme.md"]);

        assert!(result[0].is_directory);
        assert!(result[1].is_directory);
        assert!(!result[2].is_directory);

        assert!(result[0].children.is_none());
        assert!(result[1].children.is_none());

        assert_eq!(result[0].path, "alpha");
        assert_eq!(result[2].path, "readme.md");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn read_directory_children_builds_relative_paths_for_subdirs() {
        let tmp = std::env::temp_dir().join("coflat-test-list-children-sub");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("deep")).unwrap();
        fs::write(tmp.join("note.md"), "n").unwrap();

        let result = list_children(&tmp, "docs").unwrap();

        assert_eq!(result[0].name, "deep");
        assert_eq!(result[0].path, "docs/deep");
        assert_eq!(result[1].name, "note.md");
        assert_eq!(result[1].path, "docs/note.md");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn read_directory_children_keeps_regular_files_named_like_ignored_directories() {
        let dir = create_temp_dir("list-children-named-like-ignored");
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::create_dir_all(dir.join("target")).unwrap();
        fs::write(dir.join("node_modules.txt"), "nm").unwrap();
        fs::write(dir.join("target.md"), "t").unwrap();

        let result = list_children(&dir, "").unwrap();
        let names: Vec<&str> = result.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, vec!["node_modules.txt", "target.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn list_children_rejects_non_utf8_entry_names() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let dir = create_temp_dir("list-children-nonutf8");
        let file_name = OsString::from_vec(vec![b'b', b'a', b'd', 0x80]);
        fs::write(dir.join(PathBuf::from(file_name)), "x").unwrap();

        let err = match list_children(&dir, "") {
            Ok(_) => panic!("non-utf8 entry names should fail"),
            Err(err) => err,
        };
        assert!(err.contains("Directory entry name is not valid UTF-8"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_existing_file_overwrites_existing_content() {
        let dir = create_temp_dir("write-existing");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();

        write_existing_file(&file, "new").unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert!(atomic_temp_paths(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_existing_file_does_not_recreate_deleted_target() {
        let dir = create_temp_dir("write-existing-race");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();
        let expected = FileHandle::from_path(&file).unwrap();

        fs::remove_file(&file).unwrap();

        let err = write_existing_file_with_handle(&file, &expected, "new")
            .expect_err("should fail for deleted file");
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        assert!(!file.exists(), "deleted file must not be recreated");
        assert!(atomic_temp_paths(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_existing_file_rejects_replaced_target() {
        let dir = create_temp_dir("write-existing-replaced");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();
        let expected = FileHandle::from_path(&file).unwrap();

        fs::remove_file(&file).unwrap();
        fs::write(&file, "replacement").unwrap();

        let err = write_existing_file_with_handle(&file, &expected, "new")
            .expect_err("should fail for replaced file");
        assert_eq!(err.kind(), std::io::ErrorKind::Other);
        assert_eq!(fs::read_to_string(&file).unwrap(), "replacement");
        assert!(atomic_temp_paths(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_text_file_does_not_overwrite_existing_file() {
        let dir = create_temp_dir("create-existing");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();

        let err = create_text_file(&file, "note.md", Some("new")).expect_err("should fail");

        assert!(err.contains("File already exists"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "old");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_binary_file_creates_missing_file() {
        let dir = create_temp_dir("write-binary-missing");
        let file = dir.join("image.bin");
        let encoded = base64::engine::general_purpose::STANDARD.encode([4, 5, 6]);

        write_binary_file(&file, "image.bin", &encoded).unwrap();

        assert_eq!(fs::read(&file).unwrap(), vec![4, 5, 6]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_binary_file_atomically_overwrites_existing_file() {
        let dir = create_temp_dir("write-binary-existing");
        let file = dir.join("image.bin");
        fs::write(&file, [1, 2, 3]).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode([4, 5, 6, 7]);

        write_binary_file(&file, "image.bin", &encoded).unwrap();

        assert_eq!(fs::read(&file).unwrap(), vec![4, 5, 6, 7]);
        assert!(atomic_temp_paths(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn delete_path_removes_symlink_entry_not_target_directory() {
        let root = create_temp_dir("delete-symlink-root");
        let outside = create_temp_dir("delete-symlink-outside");
        let target_file = outside.join("target.md");
        let link = root.join("linked-dir");
        fs::write(&target_file, "target").unwrap();
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        delete_path(&link, "linked-dir").unwrap();

        assert!(!link.exists());
        assert!(target_file.exists());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn rename_path_moves_symlink_entry_not_target() {
        let root = create_temp_dir("rename-symlink-root");
        let outside = create_temp_dir("rename-symlink-outside");
        let target_file = outside.join("target.md");
        let old_link = root.join("old-link.md");
        let new_link = root.join("new-link.md");
        fs::write(&target_file, "target").unwrap();
        std::os::unix::fs::symlink(&target_file, &old_link).unwrap();

        rename_path(&old_link, "old-link.md", &new_link, "new-link.md").unwrap();

        assert!(!old_link.exists());
        assert!(
            new_link
                .symlink_metadata()
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(target_file.exists());
        assert_eq!(fs::read_to_string(&target_file).unwrap(), "target");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn rename_path_treats_dangling_destination_symlink_as_existing() {
        let root = create_temp_dir("rename-dangling-dest");
        let source = root.join("source.md");
        let destination = root.join("dest.md");
        fs::write(&source, "source").unwrap();
        std::os::unix::fs::symlink(root.join("missing.md"), &destination).unwrap();

        let err = rename_path(&source, "source.md", &destination, "dest.md")
            .expect_err("dangling symlink destination should block rename");

        assert!(err.contains("File already exists"));
        assert!(source.exists());
        assert!(destination.symlink_metadata().is_ok());

        let _ = fs::remove_dir_all(&root);
    }
}
