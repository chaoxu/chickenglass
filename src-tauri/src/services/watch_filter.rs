pub(crate) fn should_ignore_relative_path(relative: &str) -> bool {
    relative.starts_with('.')
        || relative.contains("/.")
        || relative.starts_with("node_modules")
        || relative.contains("/node_modules")
        || relative.starts_with("target")
        || relative.contains("/target")
}

#[cfg(test)]
mod tests {
    use super::should_ignore_relative_path;

    #[test]
    fn ignores_hidden_and_generated_relative_paths() {
        assert!(should_ignore_relative_path(".git/config"));
        assert!(should_ignore_relative_path("nested/.cache/file.txt"));
        assert!(should_ignore_relative_path("node_modules/pkg/index.js"));
        assert!(should_ignore_relative_path("target/debug/app"));
        assert!(!should_ignore_relative_path("notes/index.md"));
    }
}
