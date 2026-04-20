use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{State, WebviewWindow, command};

use super::context::{CommandSpec, WindowCommandContext, run_command};
use super::error::{AppError, AppResult};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::{project_relative_path, resolve_project_path};

const CHECK_PANDOC: CommandSpec =
    CommandSpec::new("tauri.check_pandoc", "tauri.export.check_pandoc", "tauri");
const EXPORT_DOCUMENT: CommandSpec = CommandSpec::new(
    "tauri.export_document",
    "tauri.export.export_document",
    "tauri",
);
const LATEX_PANDOC_FROM: &str = "markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark";

/// Check whether Pandoc is installed and return its version string.
#[command]
pub fn check_pandoc(perf: State<'_, PerfState>) -> AppResult<String> {
    run_command(&perf, CHECK_PANDOC, None, || {
        let output = Command::new("pandoc")
            .arg("--version")
            .output()
            .map_err(|e| {
                AppError::export_pandoc_unavailable(format!("Failed to run pandoc: {}", e))
            })?;

        if !output.status.success() {
            return Err(AppError::export_pandoc_unavailable(
                "pandoc --version returned a non-zero exit code",
            ));
        }

        let version = String::from_utf8_lossy(&output.stdout);
        Ok(version
            .lines()
            .next()
            .unwrap_or("pandoc (unknown version)")
            .to_string())
    })
}

/// Export a markdown document to PDF or LaTeX via Pandoc.
fn resolve_export_output_path(project_root: &Path, output_path: &str) -> AppResult<PathBuf> {
    let resolved_path = resolve_project_path(project_root, output_path)?;

    if let Some(parent) = resolved_path.parent() {
        if !parent.exists() {
            return Err(AppError::path_resolve(format!(
                "Output directory does not exist: {}",
                parent.display()
            )));
        }
    }

    Ok(resolved_path)
}

fn resolve_export_source_dir(project_root: &Path, source_path: &str) -> AppResult<PathBuf> {
    let resolved_source_path = resolve_project_path(project_root, source_path)?;
    Ok(resolved_source_path
        .parent()
        .unwrap_or(project_root)
        .to_path_buf())
}

fn build_pandoc_resource_path(project_root: &Path, source_dir: &Path) -> AppResult<OsString> {
    let mut resource_paths = vec![source_dir.to_path_buf()];
    if source_dir != project_root {
        resource_paths.push(project_root.to_path_buf());
    }

    std::env::join_paths(resource_paths).map_err(|e| {
        AppError::native_error(format!("Failed to construct Pandoc resource path: {}", e))
    })
}

fn latex_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("src")
        .join("latex")
}

fn resolve_latex_template(project_root: &Path, template: Option<&str>) -> AppResult<PathBuf> {
    let name = template.unwrap_or("article");
    let latex_dir = latex_dir();
    match name {
        "" | "article" => Ok(latex_dir.join("template").join("article.tex")),
        "lipics" => Ok(latex_dir.join("template").join("lipics.tex")),
        custom => resolve_project_path(project_root, custom),
    }
}

fn bibliography_metadata_value(bibliography: &str) -> Option<String> {
    let file_name = Path::new(bibliography).file_name()?.to_string_lossy();
    Some(
        file_name
            .strip_suffix(".bib")
            .unwrap_or(&file_name)
            .to_string(),
    )
}

fn build_latex_pandoc_args(
    project_root: &Path,
    source_dir: &Path,
    output_path: &Path,
    format: &str,
    template: Option<&str>,
    bibliography: Option<&str>,
) -> AppResult<Vec<String>> {
    let resource_path = build_pandoc_resource_path(project_root, source_dir)?;
    let filter_path = latex_dir().join("filter.lua");
    let template_path = resolve_latex_template(project_root, template)?;
    let mut args = vec![
        format!("--from={}", LATEX_PANDOC_FROM),
        "--to=latex".to_string(),
        "--wrap=preserve".to_string(),
        "--syntax-highlighting=none".to_string(),
        format!("--lua-filter={}", filter_path.to_string_lossy()),
        format!("--template={}", template_path.to_string_lossy()),
        format!("--resource-path={}", resource_path.to_string_lossy()),
        format!("--output={}", output_path.to_string_lossy()),
    ];

    if let Some(metadata) = bibliography.and_then(bibliography_metadata_value) {
        args.push(format!("--metadata=bibliography={}", metadata));
    }

    match format {
        "pdf" => args.push("--pdf-engine=xelatex".to_string()),
        "latex" => {}
        _ => {
            return Err(AppError::export_unsupported_format(
                format!("Unsupported export format: {}", format),
                format,
            ));
        }
    }

    Ok(args)
}

#[command]
pub fn export_document(
    window: WebviewWindow,
    root: State<'_, ProjectRoot>,
    perf: State<'_, PerfState>,
    content: String,
    format: String,
    output_path: String,
    source_path: String,
    template: Option<String>,
    bibliography: Option<String>,
) -> AppResult<String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        EXPORT_DOCUMENT,
        Some(&output_path),
        |project_root| {
            let output_path = resolve_export_output_path(&project_root, &output_path)?;
            let source_dir = resolve_export_source_dir(&project_root, &source_path)?;
            let args = build_latex_pandoc_args(
                &project_root,
                &source_dir,
                &output_path,
                &format,
                template.as_deref(),
                bibliography.as_deref(),
            )?;

            let mut child = Command::new("pandoc")
                .args(&args)
                .current_dir(&source_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    AppError::export_pandoc_unavailable(format!("Failed to start pandoc: {}", e))
                })?;

            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(content.as_bytes()).map_err(|e| {
                    AppError::native_io(format!("Failed to write to pandoc stdin: {}", e))
                })?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| AppError::native_io(format!("Failed to wait for pandoc: {}", e)))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::export_pandoc_failed(format!(
                    "Pandoc failed: {}",
                    stderr
                )));
            }

            project_relative_path(&project_root, &output_path)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        LATEX_PANDOC_FROM, bibliography_metadata_value, build_latex_pandoc_args,
        build_pandoc_resource_path, resolve_export_output_path, resolve_export_source_dir,
        resolve_latex_template,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("coflat-{prefix}-{unique}-{counter}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn resolves_relative_output_paths_within_project_root() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("docs");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let output_path =
            resolve_export_output_path(&project_root, "docs/out.pdf").expect("resolve output");

        assert_eq!(output_path, docs_dir.join("out.pdf"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_relative_paths_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");

        let error = resolve_export_output_path(&project_root, "../out.pdf")
            .expect_err("path traversal should fail");

        assert_eq!(error.code, "path.escape");
        assert!(error.message.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_absolute_paths_outside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let outside_root = create_temp_dir("export-outside");
        let outside_path = outside_root.join("out.pdf");

        let error =
            resolve_export_output_path(&project_root, outside_path.to_str().expect("utf-8 path"))
                .expect_err("absolute path outside root should fail");

        assert_eq!(error.code, "path.escape");
        assert!(error.message.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
        fs::remove_dir_all(&outside_root).expect("remove outside root");
    }

    #[test]
    fn resolves_source_directory_from_the_document_path() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("notes");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let source_dir =
            resolve_export_source_dir(&project_root, "notes/main.md").expect("resolve source dir");

        assert_eq!(source_dir, docs_dir);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn includes_document_dir_and_project_root_in_pandoc_resource_path() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("notes");
        fs::create_dir_all(&docs_dir).expect("create docs dir");

        let resource_path =
            build_pandoc_resource_path(&project_root, &docs_dir).expect("resource path");
        let paths: Vec<PathBuf> = std::env::split_paths(&resource_path).collect();

        assert_eq!(paths, vec![docs_dir.clone(), project_root.clone()]);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn avoids_duplicate_root_entries_in_pandoc_resource_path() {
        let project_root = create_temp_dir("export-root");

        let resource_path =
            build_pandoc_resource_path(&project_root, &project_root).expect("resource path");
        let paths: Vec<PathBuf> = std::env::split_paths(&resource_path).collect();

        assert_eq!(paths, vec![project_root.clone()]);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn resolves_builtin_latex_templates_from_repo_assets() {
        let project_root = create_temp_dir("export-root");

        let article =
            resolve_latex_template(&project_root, Some("article")).expect("article template");
        let lipics =
            resolve_latex_template(&project_root, Some("lipics")).expect("lipics template");

        assert!(article.ends_with("src/latex/template/article.tex"));
        assert!(lipics.ends_with("src/latex/template/lipics.tex"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn resolves_custom_latex_templates_inside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let template_dir = project_root.join("templates");
        fs::create_dir_all(&template_dir).expect("create template dir");

        let template = resolve_latex_template(&project_root, Some("templates/custom.tex"))
            .expect("custom template");

        assert_eq!(template, template_dir.join("custom.tex"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_custom_latex_templates_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");

        let error = resolve_latex_template(&project_root, Some("../template.tex"))
            .expect_err("path traversal should fail");

        assert_eq!(error.code, "path.escape");
        assert!(error.message.contains("escapes project root"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn derives_bibliography_metadata_from_the_file_name() {
        assert_eq!(
            bibliography_metadata_value("refs/project.bib"),
            Some("project".to_string())
        );
        assert_eq!(
            bibliography_metadata_value("refs/project"),
            Some("project".to_string())
        );
    }

    #[test]
    fn builds_canonical_latex_pandoc_args() {
        let project_root = create_temp_dir("export-root");
        let source_dir = project_root.join("notes");
        fs::create_dir_all(&source_dir).expect("create source dir");
        let output_path = project_root.join("out.tex");

        let args = build_latex_pandoc_args(
            &project_root,
            &source_dir,
            &output_path,
            "latex",
            Some("lipics"),
            Some("refs/project.bib"),
        )
        .expect("pandoc args");

        assert_eq!(args[0], format!("--from={}", LATEX_PANDOC_FROM));
        assert!(args.contains(&"--to=latex".to_string()));
        assert!(args.contains(&"--wrap=preserve".to_string()));
        assert!(args.contains(&"--syntax-highlighting=none".to_string()));
        assert!(args.iter().any(|arg| arg.ends_with("src/latex/filter.lua")));
        assert!(
            args.iter()
                .any(|arg| arg.ends_with("src/latex/template/lipics.tex"))
        );
        assert!(args.iter().any(|arg| arg.starts_with("--resource-path=")));
        assert!(args.iter().any(|arg| arg.starts_with("--output=")));
        assert!(args.contains(&"--metadata=bibliography=project".to_string()));
        assert!(!args.contains(&"--pdf-engine=xelatex".to_string()));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn adds_pdf_engine_for_pdf_export() {
        let project_root = create_temp_dir("export-root");
        let output_path = project_root.join("out.pdf");

        let args = build_latex_pandoc_args(
            &project_root,
            &project_root,
            &output_path,
            "pdf",
            None,
            None,
        )
        .expect("pandoc args");

        assert!(args.contains(&"--pdf-engine=xelatex".to_string()));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }
}
