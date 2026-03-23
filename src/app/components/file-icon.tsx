import {
  File,
  FileText,
  FileCode,
  FileJson,
  BookOpen,
  Settings,
} from "lucide-react";

interface FileIconProps {
  name: string;
  size: number;
  className?: string;
}

export function FileIcon({ name, size, className }: FileIconProps) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "md":
    case "mdx":
    case "txt":
      return <FileText size={size} className={className} />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "py":
    case "go":
    case "css":
    case "html":
      return <FileCode size={size} className={className} />;
    case "json":
      return <FileJson size={size} className={className} />;
    case "bib":
      return <BookOpen size={size} className={className} />;
    case "yaml":
    case "yml":
    case "toml":
    case "csl":
      return <Settings size={size} className={className} />;
    default:
      return <File size={size} className={className} />;
  }
}
