use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn project_no_project() -> Self {
        Self::new("project.noProject", "No project folder open")
    }

    pub fn fs_not_found(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self::with_details("fs.notFound", message, details)
    }

    pub fn fs_already_exists(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self::with_details("fs.alreadyExists", message, details)
    }

    pub fn path_escape(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self::with_details("path.escape", message, details)
    }

    pub fn path_resolve(message: impl Into<String>) -> Self {
        Self::new("path.resolve", message)
    }

    pub fn path_not_directory(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self::with_details("path.notDirectory", message, details)
    }

    pub fn export_unsupported_format(
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self::with_details("export.unsupportedFormat", message, details)
    }

    pub fn export_pandoc_unavailable(message: impl Into<String>) -> Self {
        Self::new("export.pandocUnavailable", message)
    }

    pub fn export_pandoc_failed(message: impl Into<String>) -> Self {
        Self::new("export.pandocFailed", message)
    }

    pub fn native_io(message: impl Into<String>) -> Self {
        Self::new("native.io", message)
    }

    pub fn native_error(message: impl Into<String>) -> Self {
        Self::new("native.error", message)
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn fallback_native_errors_use_explicit_constructor() {
        let error = AppError::native_error("File not found: notes.md");

        assert_eq!(error.code, "native.error");
        assert_eq!(error.message, "File not found: notes.md");
    }

    #[test]
    fn serializes_error_contract_for_tauri() {
        let error = AppError::with_details("fs.notFound", "File not found: notes.md", "notes.md");
        let json = serde_json::to_value(&error).expect("serialize AppError");

        assert_eq!(json["code"], "fs.notFound");
        assert_eq!(json["message"], "File not found: notes.md");
        assert_eq!(json["details"], "notes.md");
    }
}
