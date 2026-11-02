// canvas-core: the source engine behind the Canvas tab. It reads JSON requests, one per line, on stdin and answers
// each with one JSON line on stdout carrying the same id. Design Studio's server and the prototype app's Vite plugin
// each keep one running.
//
//   {"id":1,"cmd":"stamp","path":"/abs/src/A.tsx","label":"src/A.tsx","source":"..."}  -> {"id":1,"code":"..."|null}
//   {"id":2,"cmd":"inspect","path":"/abs/src/A.tsx","line":7,"col":7}                   -> {"id":2,"element":{...}}
//   {"id":3,"cmd":"edit","path":"...","line":7,"col":7,"tag":"Button","op":{...}}      -> {"id":3,"ok":true}
//   {"id":4,"cmd":"props","path":"/abs/src/components/Button.tsx"}                     -> {"id":4,"components":[...]}
//
// inspect, edit and props take an optional "root" (the app's src folder). With it, a path that resolves outside root,
// through `..` or a symlink, or that is not a .tsx/.jsx file, is refused before anything is read or written.
//
// edit writes the file itself, through a temporary file and a rename, so a crash never leaves half a file.

mod jsx;
mod props;

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Req {
    Ping,
    Stamp { path: String, label: String, source: String },
    Inspect { path: String, line: u32, col: u32, root: Option<String> },
    Edit { path: String, line: u32, col: u32, tag: String, op: jsx::Op, root: Option<String> },
    Props { path: String, root: Option<String> },
}

/// The real path of `path` when it is a .tsx or .jsx file inside `root`, else why not.
fn guard(path: &str, root: Option<&str>) -> Result<String, String> {
    let Some(root) = root else { return Ok(path.to_string()) };
    let real = std::fs::canonicalize(path).map_err(|_| format!("No such file: {path}"))?;
    let base = std::fs::canonicalize(root).map_err(|_| format!("No such folder: {root}"))?;
    if !real.starts_with(&base) {
        return Err(format!("Outside the app: {path}"));
    }
    if !matches!(real.extension().and_then(|e| e.to_str()), Some("tsx" | "jsx")) {
        return Err(format!("Not a component file: {path}"));
    }
    real.to_str().map(str::to_string).ok_or_else(|| format!("Bad path: {path}"))
}

fn write_atomic(path: &str, text: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let tmp = p.with_file_name(format!(".{}.ds-tmp", p.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn handle(req: Req) -> Result<Value, String> {
    let read = |path: &str| std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"));
    match req {
        Req::Ping => Ok(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })),
        Req::Stamp { path, label, source } => Ok(json!({ "code": jsx::stamp(&path, &label, &source)? })),
        Req::Inspect { path, line, col, root } => {
            let path = guard(&path, root.as_deref())?;
            Ok(json!({ "element": jsx::inspect(&path, &read(&path)?, line, col)? }))
        }
        Req::Props { path, root } => {
            let path = guard(&path, root.as_deref())?;
            Ok(json!({ "components": props::components(&path, &read(&path)?)? }))
        }
        Req::Edit { path, line, col, tag, op, root } => {
            let path = guard(&path, root.as_deref())?;
            let src = read(&path)?;
            let out = jsx::edit(&path, &src, line, col, &tag, &op)?;
            if out != src {
                write_atomic(&path, &out)?;
            }
            Ok(json!({ "ok": true, "changed": out != src }))
        }
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let raw: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let id = raw.get("id").cloned().unwrap_or(Value::Null);
        let mut out = match serde_json::from_value::<Req>(raw) {
            Ok(req) => handle(req).unwrap_or_else(|e| json!({ "error": e })),
            Err(e) => json!({ "error": format!("Bad request: {e}") }),
        };
        out["id"] = id;
        let _ = writeln!(stdout, "{out}");
        let _ = stdout.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::guard;

    #[test]
    fn guard_refuses_paths_outside_the_app() {
        let dir = std::env::temp_dir().join(format!("ds-guard-{}", std::process::id()));
        let src = dir.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("A.tsx"), "").unwrap();
        std::fs::write(src.join("a.css"), "").unwrap();
        std::fs::write(dir.join("Out.tsx"), "").unwrap();
        std::os::unix::fs::symlink(dir.join("Out.tsx"), src.join("Link.tsx")).unwrap();
        let root = src.to_str().unwrap();
        let p = |n: &str| src.join(n).to_str().unwrap().to_string();
        assert!(guard(&p("A.tsx"), Some(root)).is_ok());
        assert!(guard(&p("a.css"), Some(root)).unwrap_err().starts_with("Not a component"));
        assert!(guard(&p("../Out.tsx"), Some(root)).unwrap_err().starts_with("Outside"));
        assert!(guard(&p("Link.tsx"), Some(root)).unwrap_err().starts_with("Outside"));
        assert!(guard(&p("Missing.tsx"), Some(root)).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
