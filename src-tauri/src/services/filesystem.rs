use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use same_file::Handle as FileHandle;
use serde::Serialize;

use crate::commands::state::ProjectRootEntry;

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
    if path.exists() {
        return Err(format!("File already exists: {}", relative_path));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(path, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create '{}': {}", relative_path, e))
}

pub fn create_directory(path: &Path, relative_path: &str) -> Result<(), String> {
    if path.exists() {
        return Err(format!("Directory already exists: {}", relative_path));
    }
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory '{}': {}", relative_path, e))
}

pub fn rename_path(
    old_path: &Path,
    old_relative_path: &str,
    new_path: &Path,
    new_relative_path: &str,
) -> Result<(), String> {
    if new_path.exists() {
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
    if path.is_dir() {
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
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {}", e))?;
        }
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    fs::write(path, &bytes)
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
        .map(|n| n.to_string_lossy().to_string())
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

fn write_existing_file_with_handle(
    path: &Path,
    expected: &FileHandle,
    content: &str,
) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(false)
        .open(path)?;
    let actual = FileHandle::from_file(file.try_clone()?)?;
    if &actual != expected {
        return Err(std::io::Error::other(format!(
            "File changed before write: {}",
            path.display()
        )));
    }
    file.set_len(0)?;
    file.write_all(content.as_bytes())
}

fn read_directory_children(dir: &Path, relative_path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    let mut children = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        if is_hidden_entry(&file_name) {
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

fn is_hidden_entry(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
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
        let file_name = entry.file_name().to_string_lossy().to_string();

        if is_hidden_entry(&file_name) {
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
        FileEntry, install_project_root, list_children, write_existing_file,
        write_existing_file_with_handle,
    };
    use crate::commands::state::ProjectRootEntry;
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
    fn write_existing_file_overwrites_existing_content() {
        let dir = create_temp_dir("write-existing");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();

        write_existing_file(&file, "new").unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "new");

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

        let _ = fs::remove_dir_all(&dir);
    }
}
