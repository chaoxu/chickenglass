pub(crate) fn should_ignore_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && (segment.starts_with('.') || matches!(segment, "node_modules" | "target"))
}

pub(crate) fn should_ignore_relative_path(relative: &str) -> bool {
    relative.split('/').any(should_ignore_path_segment)
}

#[cfg(test)]
mod tests {
    use super::{should_ignore_path_segment, should_ignore_relative_path};

    #[test]
    fn ignores_hidden_and_generated_segments() {
        assert!(should_ignore_path_segment(".git"));
        assert!(should_ignore_path_segment("node_modules"));
        assert!(should_ignore_path_segment("target"));
        assert!(!should_ignore_path_segment("notes"));

        assert!(should_ignore_relative_path(".git/config"));
        assert!(should_ignore_relative_path("nested/.cache/file.txt"));
        assert!(should_ignore_relative_path("node_modules/pkg/index.js"));
        assert!(should_ignore_relative_path("docs/target/debug.log"));
        assert!(!should_ignore_relative_path("notes/index.md"));
    }

    #[test]
    fn keeps_regular_files_named_like_ignored_directories() {
        assert!(!should_ignore_path_segment("node_modules.txt"));
        assert!(!should_ignore_path_segment("target.md"));
        assert!(!should_ignore_relative_path("notes/node_modules.txt"));
        assert!(!should_ignore_relative_path("docs/target.md"));
    }
}
