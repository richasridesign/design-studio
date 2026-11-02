// canvas-core: the source engine behind the Canvas tab. It reads JSON requests, one per line, on stdin and answers
// each with one JSON line on stdout carrying the same id. Design Studio's server and the prototype app's Vite plugin
// each keep one running.
//
//   {"id":1,"cmd":"stamp","path":"/abs/src/A.tsx","label":"src/A.tsx","source":"..."}  -> {"id":1,"code":"..."|null}
//   {"id":2,"cmd":"inspect","path":"/abs/src/A.tsx","line":7,"col":7}                   -> {"id":2,"element":{...}}
//   {"id":3,"cmd":"edit","path":"...","line":7,"col":7,"tag":"Button","op":{...}}      -> {"id":3,"ok":true}
//
// edit writes the file itself, through a temporary file and a rename, so a crash never leaves half a file.

mod jsx;

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Req {
    Ping,
    Stamp { path: String, label: String, source: String },
    Inspect { path: String, line: u32, col: u32 },
    Edit { path: String, line: u32, col: u32, tag: String, op: jsx::Op },
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
        Req::Inspect { path, line, col } => Ok(json!({ "element": jsx::inspect(&path, &read(&path)?, line, col)? })),
        Req::Edit { path, line, col, tag, op } => {
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
