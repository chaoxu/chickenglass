use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{command, State, WebviewWindow};

use super::context::{run_command, CommandSpec, WindowCommandContext};
use super::state::{PerfState, ProjectRoot};
use crate::services::path::ProjectPathResolver;

const CHECK_PANDOC: CommandSpec =
    CommandSpec::new("tauri.check_pandoc", "tauri.export.check_pandoc", "tauri");
const EXPORT_DOCUMENT: CommandSpec = CommandSpec::new(
    "tauri.export_document",
    "tauri.export.export_document",
    "tauri",
);
const EXPORT_CONTRACT_JSON: &str = include_str!("../../../src/latex/export-contract.json");

#[derive(Clone, Deserialize)]
struct ExportDependencyTool {
    name: String,
    version_args: Vec<String>,
    install_hint: String,
}

#[derive(Deserialize)]
struct ExportResourcePathContract {
    entries: Vec<String>,
    dedupe: bool,
}

#[derive(Deserialize)]
struct ExportTemplateContract {
    default: String,
    builtins: HashMap<String, String>,
}

#[derive(Deserialize)]
struct LatexExportContract {
    templates: ExportTemplateContract,
    args: Vec<String>,
    bibliography_metadata_arg: String,
    pdf_args: Vec<String>,
}

#[derive(Deserialize)]
struct HtmlExportContract {
    args: Vec<String>,
}

#[derive(Deserialize)]
struct ExportContract {
    pandoc_from: String,
    resource_path: ExportResourcePathContract,
    latex: LatexExportContract,
    html: HtmlExportContract,
    dependencies: HashMap<String, Vec<ExportDependencyTool>>,
}

#[derive(Clone, Serialize)]
pub struct ExportToolStatus {
    name: String,
    available: bool,
    version: Option<String>,
    install_hint: String,
    message: Option<String>,
}

#[derive(Serialize)]
pub struct ExportDependencyCheck {
    format: String,
    ok: bool,
    tools: Vec<ExportToolStatus>,
}

/// Check whether export dependencies for a target format are available.
#[command]
pub fn check_pandoc(
    perf: State<'_, PerfState>,
    format: Option<String>,
) -> Result<ExportDependencyCheck, String> {
    run_command(&perf, CHECK_PANDOC, None, || {
        let format = format.unwrap_or_else(|| "html".to_string());
        build_export_dependency_check(&format, check_export_tool)
    })
}

fn export_contract() -> Result<ExportContract, String> {
    serde_json::from_str(EXPORT_CONTRACT_JSON)
        .map_err(|e| format!("Failed to parse export contract: {}", e))
}

fn build_export_dependency_check<F>(
    format: &str,
    mut check_tool: F,
) -> Result<ExportDependencyCheck, String>
where
    F: FnMut(&ExportDependencyTool) -> ExportToolStatus,
{
    let contract = export_contract()?;
    let tools = contract
        .dependencies
        .get(format)
        .ok_or_else(|| format!("Unsupported export format: {}", format))?;
    let statuses: Vec<ExportToolStatus> = tools.iter().map(&mut check_tool).collect();
    let ok = statuses.iter().all(|status| status.available);

    Ok(ExportDependencyCheck {
        format: format.to_string(),
        ok,
        tools: statuses,
    })
}

fn check_export_tool(tool: &ExportDependencyTool) -> ExportToolStatus {
    match Command::new(&tool.name).args(&tool.version_args).output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = stdout
                .lines()
                .chain(stderr.lines())
                .find(|line| !line.trim().is_empty())
                .map(|line| line.trim().to_string());

            ExportToolStatus {
                name: tool.name.clone(),
                available: true,
                version,
                install_hint: tool.install_hint.clone(),
                message: None,
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            ExportToolStatus {
                name: tool.name.clone(),
                available: false,
                version: None,
                install_hint: tool.install_hint.clone(),
                message: Some(if stderr.is_empty() {
                    format!(
                        "{} {} returned a non-zero exit code",
                        tool.name,
                        tool.version_args.join(" ")
                    )
                } else {
                    stderr
                }),
            }
        }
        Err(error) => ExportToolStatus {
            name: tool.name.clone(),
            available: false,
            version: None,
            install_hint: tool.install_hint.clone(),
            message: Some(format!("Failed to run {}: {}", tool.name, error)),
        },
    }
}

fn resolve_export_output_path(
    paths: &ProjectPathResolver,
    output_path: &str,
) -> Result<PathBuf, String> {
    let resolved_path = paths.resolve_project_path(output_path)?;

    if let Some(parent) = resolved_path.parent() {
        if !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
    }

    Ok(resolved_path)
}

fn resolve_export_source_dir(
    paths: &ProjectPathResolver,
    project_root: &Path,
    source_path: &str,
) -> Result<PathBuf, String> {
    if source_path.trim().is_empty() {
        return Ok(project_root.to_path_buf());
    }

    let resolved_source_path = paths.resolve_project_path(source_path)?;
    Ok(resolved_source_path
        .parent()
        .unwrap_or(project_root)
        .to_path_buf())
}

fn build_pandoc_resource_path(project_root: &Path, source_dir: &Path) -> Result<OsString, String> {
    let contract = export_contract()?;
    let mut resource_paths = Vec::new();

    for entry in contract.resource_path.entries {
        let path = match entry.as_str() {
            "source_dir" => source_dir,
            "project_root" => project_root,
            other => {
                return Err(format!(
                    "Unsupported export resource path entry in contract: {}",
                    other
                ));
            }
        };

        if contract.resource_path.dedupe && resource_paths.iter().any(|existing| existing == path) {
            continue;
        }
        resource_paths.push(path.to_path_buf());
    }

    std::env::join_paths(resource_paths)
        .map_err(|e| format!("Failed to construct Pandoc resource path: {}", e))
}

fn latex_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("src")
        .join("latex")
}

fn resolve_latex_template(
    paths: &ProjectPathResolver,
    template: Option<&str>,
) -> Result<PathBuf, String> {
    let contract = export_contract()?;
    let name = template.unwrap_or(&contract.latex.templates.default);
    let latex_dir = latex_dir();
    if name.is_empty() {
        let default_template = contract
            .latex
            .templates
            .builtins
            .get(&contract.latex.templates.default)
            .ok_or_else(|| "Default LaTeX template is missing from export contract".to_string())?;
        return Ok(latex_dir.join(default_template));
    }
    match contract.latex.templates.builtins.get(name) {
        Some(relative_path) => Ok(latex_dir.join(relative_path)),
        None => paths.resolve_project_path(name),
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
    paths: &ProjectPathResolver,
    project_root: &Path,
    source_dir: &Path,
    output_path: &Path,
    format: &str,
    template: Option<&str>,
    bibliography: Option<&str>,
) -> Result<Vec<String>, String> {
    let contract = export_contract()?;
    let resource_path = build_pandoc_resource_path(project_root, source_dir)?;
    let filter_path = latex_dir().join("filter.lua");
    let template_path = resolve_latex_template(paths, template)?;
    let filter_path = filter_path.to_string_lossy().to_string();
    let template_path = template_path.to_string_lossy().to_string();
    let resource_path = resource_path.to_string_lossy().to_string();
    let output_path = output_path.to_string_lossy().to_string();
    let values = [
        ("latex_filter_path", filter_path.as_str()),
        ("latex_template_path", template_path.as_str()),
        ("output_path", output_path.as_str()),
        ("pandoc_from", contract.pandoc_from.as_str()),
        ("resource_path", resource_path.as_str()),
    ];
    let mut args = render_pandoc_args(&contract.latex.args, &values);

    if let Some(metadata) = bibliography.and_then(bibliography_metadata_value) {
        args.push(render_pandoc_arg(
            &contract.latex.bibliography_metadata_arg,
            &[("bibliography_metadata", metadata.as_str())],
        ));
    }

    match format {
        "pdf" => args.extend(contract.latex.pdf_args),
        "latex" => {}
        _ => {
            return Err(format!("Unsupported export format: {}", format));
        }
    }

    Ok(args)
}

fn build_html_pandoc_args(
    project_root: &Path,
    source_dir: &Path,
    output_path: &Path,
) -> Result<Vec<String>, String> {
    let contract = export_contract()?;
    let resource_path = build_pandoc_resource_path(project_root, source_dir)?;
    let resource_path = resource_path.to_string_lossy().to_string();
    let output_path = output_path.to_string_lossy().to_string();
    Ok(render_pandoc_args(
        &contract.html.args,
        &[
            ("output_path", output_path.as_str()),
            ("pandoc_from", contract.pandoc_from.as_str()),
            ("resource_path", resource_path.as_str()),
        ],
    ))
}

fn render_pandoc_args(templates: &[String], values: &[(&str, &str)]) -> Vec<String> {
    templates
        .iter()
        .map(|template| render_pandoc_arg(template, values))
        .collect()
}

fn render_pandoc_arg(template: &str, values: &[(&str, &str)]) -> String {
    let value_by_key: HashMap<&str, &str> = values.iter().copied().collect();
    let mut rendered = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(open_index) = rest.find('{') {
        rendered.push_str(&rest[..open_index]);
        let after_open = &rest[open_index + 1..];
        let Some(close_index) = after_open.find('}') else {
            rendered.push_str(&rest[open_index..]);
            return rendered;
        };
        let key = &after_open[..close_index];
        if !key.is_empty() && key.chars().all(|c| c == '_' || c.is_ascii_lowercase()) {
            rendered.push_str(value_by_key.get(key).copied().unwrap_or(""));
            rest = &after_open[close_index + 1..];
        } else {
            rendered.push('{');
            rest = after_open;
        }
    }
    rendered.push_str(rest);
    rendered
}

fn build_pandoc_args(
    paths: &ProjectPathResolver,
    project_root: &Path,
    source_dir: &Path,
    output_path: &Path,
    format: &str,
    template: Option<&str>,
    bibliography: Option<&str>,
) -> Result<Vec<String>, String> {
    match format {
        "pdf" | "latex" => build_latex_pandoc_args(
            paths,
            project_root,
            source_dir,
            output_path,
            format,
            template,
            bibliography,
        ),
        "html" => build_html_pandoc_args(project_root, source_dir, output_path),
        _ => Err(format!("Unsupported export format: {}", format)),
    }
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
) -> Result<String, String> {
    WindowCommandContext::new(&window, &root, &perf).run(
        EXPORT_DOCUMENT,
        Some(&output_path),
        |project_root| {
            let paths = ProjectPathResolver::new(project_root)?;
            let project_root = paths.resolve_project_path("")?;
            let output_path = resolve_export_output_path(&paths, &output_path)?;
            let source_dir = resolve_export_source_dir(&paths, &project_root, &source_path)?;
            let dependency_check = build_export_dependency_check(&format, check_export_tool)?;
            if !dependency_check.ok {
                let missing_tools = dependency_check
                    .tools
                    .iter()
                    .filter(|tool| !tool.available)
                    .map(|tool| tool.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!(
                    "Missing export dependencies for {} export: {}",
                    format, missing_tools
                ));
            }
            let args = build_pandoc_args(
                &paths,
                &project_root,
                &source_dir,
                &output_path,
                &format,
                template.as_deref(),
                bibliography.as_deref(),
            )?;

            let mut child = map_err_str!(
                Command::new("pandoc")
                    .args(&args)
                    .current_dir(&source_dir)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn(),
                "Failed to start pandoc: {}"
            )?;

            if let Some(ref mut stdin) = child.stdin {
                map_err_str!(
                    stdin.write_all(content.as_bytes()),
                    "Failed to write to pandoc stdin: {}"
                )?;
            }

            let output = map_err_str!(child.wait_with_output(), "Failed to wait for pandoc: {}")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Pandoc failed: {}", stderr));
            }

            paths.project_relative_path(&output_path)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        bibliography_metadata_value, build_export_dependency_check, build_html_pandoc_args,
        build_latex_pandoc_args, build_pandoc_args, build_pandoc_resource_path, export_contract,
        render_pandoc_arg, resolve_export_output_path, resolve_export_source_dir,
        resolve_latex_template, ExportToolStatus,
    };
    use crate::services::path::ProjectPathResolver;
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

    fn assert_rejects_unsafe_project_path(error: &str) {
        assert!(
            error.contains("escapes project root")
                || error.contains("must be relative to project root")
                || error.contains("cannot contain . or .. components"),
            "got: {error}",
        );
    }

    fn pandoc_from() -> String {
        export_contract().expect("export contract").pandoc_from
    }

    #[test]
    fn resolves_relative_output_paths_within_project_root() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("docs");
        fs::create_dir_all(&docs_dir).expect("create docs dir");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let output_path =
            resolve_export_output_path(&paths, "docs/out.pdf").expect("resolve output");

        assert_eq!(output_path, docs_dir.join("out.pdf"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_relative_paths_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = resolve_export_output_path(&paths, "../out.pdf")
            .expect_err("path traversal should fail");

        assert_rejects_unsafe_project_path(&error);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_absolute_paths_outside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let outside_root = create_temp_dir("export-outside");
        let outside_path = outside_root.join("out.pdf");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = resolve_export_output_path(&paths, outside_path.to_str().expect("utf-8 path"))
            .expect_err("absolute path outside root should fail");

        assert_rejects_unsafe_project_path(&error);

        fs::remove_dir_all(&project_root).expect("remove project root");
        fs::remove_dir_all(&outside_root).expect("remove outside root");
    }

    #[test]
    fn resolves_source_directory_from_the_document_path() {
        let project_root = create_temp_dir("export-root");
        let docs_dir = project_root.join("notes");
        fs::create_dir_all(&docs_dir).expect("create docs dir");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let source_dir = resolve_export_source_dir(&paths, &project_root, "notes/main.md")
            .expect("resolve source dir");

        assert_eq!(source_dir, docs_dir);

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn uses_project_root_when_source_path_is_empty() {
        let project_root = create_temp_dir("export-root");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let source_dir =
            resolve_export_source_dir(&paths, &project_root, "").expect("resolve source dir");

        assert_eq!(source_dir, project_root);

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
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let article = resolve_latex_template(&paths, Some("article")).expect("article template");
        let lipics = resolve_latex_template(&paths, Some("lipics")).expect("lipics template");

        assert!(article.ends_with("src/latex/template/article.tex"));
        assert!(lipics.ends_with("src/latex/template/lipics.tex"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn resolves_custom_latex_templates_inside_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let template_dir = project_root.join("templates");
        fs::create_dir_all(&template_dir).expect("create template dir");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let template =
            resolve_latex_template(&paths, Some("templates/custom.tex")).expect("custom template");

        assert_eq!(template, template_dir.join("custom.tex"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_custom_latex_templates_that_escape_the_project_root() {
        let project_root = create_temp_dir("export-root");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = resolve_latex_template(&paths, Some("../template.tex"))
            .expect_err("path traversal should fail");

        assert_rejects_unsafe_project_path(&error);

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
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let args = build_latex_pandoc_args(
            &paths,
            &project_root,
            &source_dir,
            &output_path,
            "latex",
            Some("lipics"),
            Some("refs/project.bib"),
        )
        .expect("pandoc args");

        assert_eq!(args[0], format!("--from={}", pandoc_from()));
        assert!(args.contains(&"--to=latex".to_string()));
        assert!(args.contains(&"--wrap=preserve".to_string()));
        assert!(args.contains(&"--syntax-highlighting=none".to_string()));
        assert!(args.iter().any(|arg| arg.ends_with("src/latex/filter.lua")));
        assert!(args
            .iter()
            .any(|arg| arg.ends_with("src/latex/template/lipics.tex")));
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
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let args = build_latex_pandoc_args(
            &paths,
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

    #[test]
    fn builds_canonical_html_pandoc_args() {
        let project_root = create_temp_dir("export-root");
        let source_dir = project_root.join("notes");
        fs::create_dir_all(&source_dir).expect("create source dir");
        let output_path = project_root.join("out.html");

        let args =
            build_html_pandoc_args(&project_root, &source_dir, &output_path).expect("html args");

        assert_eq!(args[0], format!("--from={}", pandoc_from()));
        assert!(args.contains(&"--to=html5".to_string()));
        assert!(args.contains(&"--standalone".to_string()));
        assert!(args.contains(&"--wrap=preserve".to_string()));
        assert!(args.contains(&"--katex".to_string()));
        assert!(args.contains(&"--section-divs".to_string()));
        assert!(args.contains(&"--filter=pandoc-crossref".to_string()));
        assert!(args.contains(&"--citeproc".to_string()));
        assert!(args.contains(&"--metadata=link-citations=true".to_string()));
        assert!(args.iter().any(|arg| arg.starts_with("--resource-path=")));
        assert!(args.iter().any(|arg| arg.starts_with("--output=")));
        assert!(!args.iter().any(|arg| arg.starts_with("--template=")));
        assert!(!args.iter().any(|arg| arg.starts_with("--lua-filter=")));
        assert!(!args.contains(&"--pdf-engine=xelatex".to_string()));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn dispatches_html_export_to_html_pandoc_args() {
        let project_root = create_temp_dir("export-root");
        let output_path = project_root.join("out.html");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let args = build_pandoc_args(
            &paths,
            &project_root,
            &project_root,
            &output_path,
            "html",
            Some("lipics"),
            Some("refs/project.bib"),
        )
        .expect("pandoc args");

        assert!(args.contains(&"--to=html5".to_string()));
        assert!(!args.iter().any(|arg| arg.ends_with("src/latex/filter.lua")));
        assert!(!args
            .iter()
            .any(|arg| arg.ends_with("src/latex/template/lipics.tex")));
        assert!(!args.contains(&"--metadata=bibliography=project".to_string()));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn rejects_unsupported_export_formats() {
        let project_root = create_temp_dir("export-root");
        let output_path = project_root.join("out.docx");
        let paths = ProjectPathResolver::new(&project_root).expect("build path resolver");

        let error = build_pandoc_args(
            &paths,
            &project_root,
            &project_root,
            &output_path,
            "docx",
            None,
            None,
        )
        .expect_err("unsupported format should fail");

        assert!(error.contains("Unsupported export format: docx"));

        fs::remove_dir_all(&project_root).expect("remove project root");
    }

    #[test]
    fn renders_pandoc_arg_without_resubstituting_placeholder_like_values() {
        let rendered = render_pandoc_arg(
            "--resource-path={resource_path}",
            &[
                ("output_path", "/tmp/out.html"),
                ("resource_path", "/tmp/{output_path}"),
            ],
        );

        assert_eq!(rendered, "--resource-path=/tmp/{output_path}");
    }

    #[test]
    fn preflights_html_export_dependencies_from_the_shared_contract() {
        let check = build_export_dependency_check("html", |tool| ExportToolStatus {
            name: tool.name.clone(),
            available: tool.name == "pandoc",
            version: None,
            install_hint: tool.install_hint.clone(),
            message: None,
        })
        .expect("dependency check");

        assert!(!check.ok);
        let missing_tools: Vec<&str> = check
            .tools
            .iter()
            .filter(|tool| !tool.available)
            .map(|tool| tool.name.as_str())
            .collect();
        assert_eq!(missing_tools, vec!["pandoc-crossref"]);
    }

    #[test]
    fn preflights_pdf_export_dependencies_from_the_shared_contract() {
        let check = build_export_dependency_check("pdf", |tool| ExportToolStatus {
            name: tool.name.clone(),
            available: tool.name == "pandoc",
            version: None,
            install_hint: tool.install_hint.clone(),
            message: None,
        })
        .expect("dependency check");

        assert!(!check.ok);
        let missing_tools: Vec<&str> = check
            .tools
            .iter()
            .filter(|tool| !tool.available)
            .map(|tool| tool.name.as_str())
            .collect();
        assert_eq!(missing_tools, vec!["xelatex"]);
    }
}
