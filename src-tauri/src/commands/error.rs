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
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
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

    pub fn from_message(message: impl Into<String>) -> Self {
        let message = message.into();
        let code = classify_error_message(&message);
        Self::new(code, message)
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::from_message(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::from_message(message)
    }
}

fn classify_error_message(message: &str) -> &'static str {
    if message == "No project folder open" {
        return "project.noProject";
    }
    if message.starts_with("File not found:")
        || (message.contains("No such file or directory") && !message.contains("pandoc"))
    {
        return "fs.notFound";
    }
    if message.starts_with("File already exists:")
        || message.starts_with("Directory already exists:")
    {
        return "fs.alreadyExists";
    }
    if message.contains("escapes project root") {
        return "path.escape";
    }
    if message.starts_with("Cannot resolve path")
        || message.starts_with("Cannot canonicalize")
        || message.starts_with("Cannot inspect")
    {
        return "path.resolve";
    }
    if message.starts_with("Unsupported export format:") {
        return "export.unsupportedFormat";
    }
    if message.starts_with("Failed to run pandoc:")
        || message.starts_with("Failed to start pandoc:")
        || message == "pandoc --version returned a non-zero exit code"
    {
        return "export.pandocUnavailable";
    }
    if message.starts_with("Pandoc failed:") {
        return "export.pandocFailed";
    }
    if message.starts_with("Not a directory:") {
        return "path.notDirectory";
    }
    if message.starts_with("Failed to") {
        return "native.io";
    }
    "native.error"
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn classifies_common_command_errors_with_stable_codes() {
        let cases = [
            ("File not found: notes.md", "fs.notFound"),
            (
                "Cannot resolve path 'missing.md': No such file or directory",
                "fs.notFound",
            ),
            ("File already exists: notes.md", "fs.alreadyExists"),
            ("Directory already exists: docs", "fs.alreadyExists"),
            ("Path '../secret.md' escapes project root", "path.escape"),
            ("Cannot resolve path: invalid", "path.resolve"),
            (
                "Cannot canonicalize root: permission denied",
                "path.resolve",
            ),
            ("Cannot inspect notes.md: permission denied", "path.resolve"),
            (
                "Unsupported export format: html",
                "export.unsupportedFormat",
            ),
            (
                "Failed to run pandoc: No such file or directory",
                "export.pandocUnavailable",
            ),
            (
                "Failed to start pandoc: No such file or directory",
                "export.pandocUnavailable",
            ),
            (
                "pandoc --version returned a non-zero exit code",
                "export.pandocUnavailable",
            ),
            ("Pandoc failed: unknown option", "export.pandocFailed"),
            ("Not a directory: /tmp/file.md", "path.notDirectory"),
            ("Failed to write file: permission denied", "native.io"),
        ];

        for (message, code) in cases {
            assert_eq!(AppError::from_message(message).code, code);
        }
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
