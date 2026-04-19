pub fn is_ignored_entry_name(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target")
}

pub fn is_ignored_relative_path(relative: &str) -> bool {
    relative
        .split('/')
        .filter(|segment| !segment.is_empty())
        .any(is_ignored_entry_name)
}

#[cfg(test)]
mod tests {
    use super::{is_ignored_entry_name, is_ignored_relative_path};

    #[test]
    fn ignores_generated_and_hidden_entry_names_only_by_segment() {
        assert!(is_ignored_entry_name(".hidden"));
        assert!(is_ignored_entry_name("node_modules"));
        assert!(is_ignored_entry_name("target"));

        assert!(!is_ignored_entry_name("node_modules-old"));
        assert!(!is_ignored_entry_name("targeted.md"));
        assert!(!is_ignored_entry_name("notes.md"));
    }

    #[test]
    fn ignores_relative_paths_by_path_segment() {
        assert!(is_ignored_relative_path(".git/config"));
        assert!(is_ignored_relative_path("nested/.cache/file.txt"));
        assert!(is_ignored_relative_path("node_modules/pkg/index.js"));
        assert!(is_ignored_relative_path("docs/node_modules/pkg/index.js"));
        assert!(is_ignored_relative_path("target/debug/app"));
        assert!(is_ignored_relative_path("docs/target/debug/app"));

        assert!(!is_ignored_relative_path("node_modules-old/pkg/index.js"));
        assert!(!is_ignored_relative_path(
            "docs/node_modules-old/pkg/index.js"
        ));
        assert!(!is_ignored_relative_path("targeted.md"));
        assert!(!is_ignored_relative_path("docs/targeted.md"));
        assert!(!is_ignored_relative_path("notes/index.md"));
    }
}
