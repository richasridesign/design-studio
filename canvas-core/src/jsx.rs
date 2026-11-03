// Reads JSX out of a source file with oxc and changes it by exact byte ranges, so everything outside the edited
// element keeps its formatting. Elements are addressed by line and column of their opening `<` (1-based, bytes),
// the same place `stamp` writes into data-ds-src.

use oxc_allocator::Allocator;
use oxc_ast::ast::{JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::Serialize;

pub const ATTR: &str = "data-ds-src";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Value {
    /// A quoted string, editable. `start..end` includes the quotes.
    String { value: String, #[serde(skip)] start: u32, #[serde(skip)] end: u32 },
    /// `{...}`: shown as written, not editable from the inspector.
    Expr { raw: String },
    /// A bare attribute such as `disabled`.
    Bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Attr {
    pub name: String,
    #[serde(flatten)]
    pub value: Value,
    #[serde(skip)]
    pub start: u32,
    #[serde(skip)]
    pub end: u32,
}

#[derive(Debug, Clone)]
enum Child {
    Text { start: u32, end: u32 },
    Element { start: u32, end: u32 },
    Other,
}

#[derive(Debug, Clone)]
pub struct Element {
    pub start: u32,
    /// The end of the whole element, its closing tag included.
    end: u32,
    pub tag: String,
    /// Where new attributes go: after the last attribute, or after the name and type arguments.
    attrs_end: u32,
    name_end: u32,
    open_end: u32,
    close_start: Option<u32>,
    children: Vec<Child>,
    pub attrs: Vec<Attr>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub tag: String,
    pub line: u32,
    pub col: u32,
    pub attrs: Vec<Attr>,
    /// The element's text when it is one plain run of text (or empty), so it can be edited in place.
    pub text: Option<String>,
    pub self_closing: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Op {
    Text { value: String },
    Attr { name: String, value: Option<String> },
    /// A boolean prop: `name` when on, `name={false}` when off (for props that default to on; to fall back to an
    /// off default, remove the attribute instead).
    Flag { name: String, value: bool },
    /// Takes the element out, with its line when it was alone on it.
    Remove,
    /// A copy of the element right after it, on its own line at the same indent.
    Duplicate,
    /// Swaps the element with the element before (-1) or after (1) it in the same parent.
    Move { by: i32 },
    /// Puts the element inside a new `<div className="...">`, one level deeper.
    Wrap { class: String },
    /// A new plain element right after this one: `<p>`, `<span>`, `<div>`, `<h2>` or `<h3>`, with classes and text.
    Add { tag: String, class: String, text: String },
}

/// Tailwind classes only: letters, digits and the few marks class names use.
fn check_class(class: &str) -> Result<(), String> {
    if class.len() > 300 || !class.chars().all(|c| c.is_ascii_alphanumeric() || " -_:./[]#%".contains(c)) {
        return Err("Those are not plain classes".into());
    }
    Ok(())
}

fn class_attr(class: &str) -> String {
    if class.trim().is_empty() { String::new() } else { format!(" className=\"{}\"", class.trim()) }
}

fn check_name(name: &str) -> Result<(), String> {
    if name == ATTR || name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':') {
        return Err(format!("Not an attribute name: {name}"));
    }
    Ok(())
}

struct Collect<'s> {
    src: &'s str,
    out: Vec<Element>,
}

impl<'a, 's> Visit<'a> for Collect<'s> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        let open = &it.opening_element;
        let name_span = open.name.span();
        let name_end = open.type_arguments.as_ref().map_or(name_span.end, |t| t.span.end);
        let mut attrs = Vec::new();
        let mut attrs_end = name_end;
        for item in &open.attributes {
            attrs_end = attrs_end.max(item.span().end);
            let JSXAttributeItem::Attribute(a) = item else { continue };
            let value = match &a.value {
                None => Value::Bool,
                Some(JSXAttributeValue::StringLiteral(s)) => Value::String { value: self.src[s.span.start as usize + 1..s.span.end as usize - 1].to_string(), start: s.span.start, end: s.span.end },
                Some(v) => Value::Expr { raw: self.src[v.span().start as usize..v.span().end as usize].to_string() },
            };
            attrs.push(Attr { name: self.src[a.name.span().start as usize..a.name.span().end as usize].to_string(), value, start: a.span.start, end: a.span.end });
        }
        let children = it
            .children
            .iter()
            .map(|c| match c {
                JSXChild::Text(t) => Child::Text { start: t.span.start, end: t.span.end },
                JSXChild::Element(e) => Child::Element { start: e.span.start, end: e.span.end },
                _ => Child::Other,
            })
            .collect();
        self.out.push(Element {
            start: open.span.start,
            end: it.span.end,
            tag: self.src[name_span.start as usize..name_span.end as usize].to_string(),
            attrs_end,
            name_end,
            open_end: open.span.end,
            close_start: it.closing_element.as_ref().map(|c| c.span.start),
            children,
            attrs,
        });
        walk::walk_jsx_element(self, it);
    }
}

pub fn parse(path: &str, src: &str) -> Result<Vec<Element>, String> {
    let source_type = SourceType::from_path(path).map_err(|_| format!("Not a script file: {path}"))?;
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, src, source_type).parse();
    if ret.fatal_error || ret.diagnostics.has_errors() {
        let first = ret.diagnostics.errors().next().map(|e| e.to_string()).unwrap_or_default();
        return Err(format!("Could not parse {path}: {first}"));
    }
    let mut c = Collect { src, out: Vec::new() };
    c.visit_program(&ret.program);
    Ok(c.out)
}

/// 1-based line and byte column of a byte offset.
pub fn line_col(src: &str, at: u32) -> (u32, u32) {
    let before = &src.as_bytes()[..at as usize];
    let line = before.iter().filter(|&&b| b == b'\n').count() as u32 + 1;
    let line_start = before.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    (line, at - line_start as u32 + 1)
}

fn offset_of(src: &str, line: u32, col: u32) -> Option<u32> {
    if line == 0 || col == 0 {
        return None;
    }
    let mut start = 0usize;
    for _ in 1..line {
        start += src[start..].find('\n')? + 1;
    }
    let at = start + col as usize - 1;
    (at <= src.len()).then_some(at as u32)
}

fn is_fragment(tag: &str) -> bool {
    tag == "Fragment" || tag.ends_with(".Fragment")
}

/// Adds data-ds-src="file:line:col" to every element that does not have one. Insertions stay on their line, so
/// line numbers in the browser match the file. Returns None when nothing changed.
pub fn stamp(path: &str, label: &str, src: &str) -> Result<Option<String>, String> {
    if !src.contains('<') {
        return Ok(None);
    }
    let els = parse(path, src)?;
    let mut inserts: Vec<(u32, String)> = els
        .iter()
        .filter(|e| !is_fragment(&e.tag) && !e.attrs.iter().any(|a| a.name == ATTR))
        .map(|e| {
            let (l, c) = line_col(src, e.start);
            (e.name_end, format!(" {ATTR}=\"{label}:{l}:{c}\""))
        })
        .collect();
    if inserts.is_empty() {
        return Ok(None);
    }
    inserts.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = src.to_string();
    for (at, text) in inserts {
        out.insert_str(at as usize, &text);
    }
    Ok(Some(out))
}

fn find<'e>(els: &'e [Element], src: &str, line: u32, col: u32, tag: Option<&str>) -> Result<&'e Element, String> {
    let at = offset_of(src, line, col).ok_or("That line is not in the file any more")?;
    let el = els.iter().find(|e| e.start == at).ok_or("The element moved in the file. Select it again")?;
    if let Some(t) = tag {
        if el.tag != t {
            return Err(format!("The file changed: line {line} is now <{}>, not <{t}>. Select it again", el.tag));
        }
    }
    Ok(el)
}

fn plain_text(el: &Element, src: &str) -> Option<(u32, u32, String)> {
    let close = el.close_start?;
    let mut text: Option<(u32, u32)> = None;
    for c in &el.children {
        match c {
            Child::Other | Child::Element { .. } => return None,
            Child::Text { start, end } => {
                let raw = &src[*start as usize..*end as usize];
                if raw.trim().is_empty() {
                    continue;
                }
                if text.is_some() {
                    return None;
                }
                let lead = (raw.len() - raw.trim_start().len()) as u32;
                let trail = (raw.len() - raw.trim_end().len()) as u32;
                text = Some((start + lead, end - trail));
            }
        }
    }
    match text {
        Some((s, e)) => Some((s, e, src[s as usize..e as usize].split_whitespace().collect::<Vec<_>>().join(" "))),
        None => Some((el.open_end, close, String::new())),
    }
}

pub fn inspect(path: &str, src: &str, line: u32, col: u32) -> Result<Info, String> {
    let els = parse(path, src)?;
    let el = find(&els, src, line, col, None)?;
    Ok(Info {
        tag: el.tag.clone(),
        line,
        col,
        attrs: el.attrs.iter().filter(|a| a.name != ATTR).cloned().collect(),
        text: plain_text(el, src).map(|t| t.2),
        self_closing: el.close_start.is_none(),
    })
}

fn quote_attr(v: &str) -> String {
    if v.contains('"') || v.contains('\n') || v.contains('\\') {
        format!("{{{}}}", serde_json::to_string(v).unwrap())
    } else {
        format!("\"{v}\"")
    }
}

fn quote_text(v: &str) -> String {
    if v.contains(['{', '}', '<', '>']) {
        format!("{{{}}}", serde_json::to_string(v).unwrap())
    } else {
        v.to_string()
    }
}

/// The spaces and tabs before `at` on its line.
fn indent(src: &str, at: u32) -> &str {
    let line = src[..at as usize].rfind('\n').map_or(0, |i| i + 1);
    let lead = &src[line..at as usize];
    &lead[..lead.len() - lead.trim_start().len()]
}

/// `start..end` widened to its whole line (and the line break) when nothing else is on that line.
fn whole_line(src: &str, start: u32, end: u32) -> (u32, u32) {
    let before = src[..start as usize].rfind('\n').map_or(0, |i| i + 1);
    let after = src[end as usize..].find('\n').map_or(src.len(), |i| end as usize + i);
    if src[before..start as usize].trim().is_empty() && src[end as usize..after].trim().is_empty() && after < src.len() {
        (before as u32, after as u32 + 1)
    } else {
        (start, end)
    }
}

/// The element next to `el` among its parent's children, skipping only blank text; code in between stops it.
fn sibling(els: &[Element], src: &str, el: &Element, by: i32) -> Result<(u32, u32), String> {
    let parent = els.iter().find(|p| p.children.iter().any(|c| matches!(c, Child::Element { start, .. } if *start == el.start)));
    let kids = &parent.ok_or("This element is not inside another element here. Ask Claude to move it")?.children;
    let i = kids.iter().position(|c| matches!(c, Child::Element { start, .. } if *start == el.start)).unwrap() as i32;
    let mut j = i + by.signum();
    while j >= 0 && (j as usize) < kids.len() {
        match &kids[j as usize] {
            Child::Element { start, end } => return Ok((*start, *end)),
            Child::Text { start, end } if src[*start as usize..*end as usize].trim().is_empty() => j += by.signum(),
            _ => return Err("Text or code sits next to it. Ask Claude to move it".into()),
        }
    }
    Err(if by < 0 { "It is already first".into() } else { "It is already last".into() })
}

/// The source after one inspector edit. The element is found again by position and tag; if it is gone or
/// different the edit is refused and nothing is written.
pub fn edit(path: &str, src: &str, line: u32, col: u32, tag: &str, op: &Op) -> Result<String, String> {
    let els = parse(path, src)?;
    let el = find(&els, src, line, col, Some(tag))?;
    let (start, end, text) = match op {
        Op::Remove => {
            let (s, e) = whole_line(src, el.start, el.end);
            (s, e, String::new())
        }
        Op::Duplicate => {
            let piece = &src[el.start as usize..el.end as usize];
            (el.end, el.end, format!("\n{}{piece}", indent(src, el.start)))
        }
        Op::Wrap { class } => {
            check_class(class)?;
            let pad = indent(src, el.start);
            let piece = src[el.start as usize..el.end as usize].replace('\n', "\n  ");
            (el.start, el.end, format!("<div{}>\n{pad}  {piece}\n{pad}</div>", class_attr(class)))
        }
        Op::Add { tag, class, text } => {
            check_class(class)?;
            if !["p", "span", "div", "h2", "h3"].contains(&tag.as_str()) {
                return Err(format!("Not an element that can be added here: {tag}"));
            }
            let inner = quote_text(text.trim());
            (el.end, el.end, format!("\n{}<{tag}{}>{inner}</{tag}>", indent(src, el.start), class_attr(class)))
        }
        Op::Move { by } => {
            let other = sibling(&els, src, el, *by)?;
            let (a, b) = if el.start < other.0 { ((el.start, el.end), other) } else { (other, (el.start, el.end)) };
            let text = format!("{}{}{}", &src[b.0 as usize..b.1 as usize], &src[a.1 as usize..b.0 as usize], &src[a.0 as usize..a.1 as usize]);
            (a.0, b.1, text)
        }
        Op::Text { value } => {
            let (s, e, _) = plain_text(el, src).ok_or("This element's text is mixed with other elements. Ask Claude to change it")?;
            (s, e, quote_text(value.trim()))
        }
        Op::Flag { name, value } => {
            check_name(name)?;
            let text = if *value { name.clone() } else { format!("{name}={{false}}") };
            match el.attrs.iter().find(|a| &a.name == name) {
                Some(a) if matches!(a.value, Value::Expr { ref raw } if raw != "{true}" && raw != "{false}") => {
                    return Err(format!("{name} is set by code. Ask Claude to change it"));
                }
                Some(a) => (a.start, a.end, text),
                None => (el.attrs_end, el.attrs_end, format!(" {text}")),
            }
        }
        Op::Attr { name, value } => {
            check_name(name)?;
            match (el.attrs.iter().find(|a| &a.name == name), value) {
                (Some(a), None) => {
                    // Remove it with the space before it.
                    let mut s = a.start as usize;
                    while s > 0 && src.as_bytes()[s - 1].is_ascii_whitespace() {
                        s -= 1;
                    }
                    (s as u32, a.end, String::new())
                }
                (Some(a), Some(v)) => match &a.value {
                    Value::String { start, end, .. } => (*start, *end, quote_attr(v)),
                    Value::Bool => (a.start, a.end, format!("{name}={}", quote_attr(v))),
                    Value::Expr { .. } => return Err(format!("{name} is set by code. Ask Claude to change it")),
                },
                (None, None) => return Ok(src.to_string()),
                (None, Some(v)) => (el.attrs_end, el.attrs_end, format!(" {name}={}", quote_attr(v))),
            }
        }
    };
    let mut out = String::with_capacity(src.len() + text.len());
    out.push_str(&src[..start as usize]);
    out.push_str(&text);
    out.push_str(&src[end as usize..]);
    // Never hand back something that no longer parses.
    parse(path, &out).map_err(|e| format!("The edit would break the file, so it was not saved. {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "export function Users() {\n  return (\n    <div className=\"p-4\">\n      <h1>\n        Users\n      </h1>\n      <Button variant=\"primary\" disabled {...rest}>Invite</Button>\n      <>{list.map((u) => <Row key={u.id} />)}</>\n    </div>\n  );\n}\n";

    #[test]
    fn stamp_keeps_lines_and_skips_fragments() {
        let out = stamp("a.tsx", "src/a.tsx", SRC).unwrap().unwrap();
        assert_eq!(out.lines().count(), SRC.lines().count());
        assert!(out.contains("<div data-ds-src=\"src/a.tsx:3:5\" className=\"p-4\">"));
        assert!(out.contains("<Button data-ds-src=\"src/a.tsx:7:7\" variant"));
        assert!(out.contains("<Row data-ds-src=\"src/a.tsx:8:26\" key"));
        assert!(!out.contains("<data-ds-src"));
        // Stamping twice changes nothing.
        assert!(stamp("a.tsx", "src/a.tsx", &out).unwrap().is_none());
    }

    #[test]
    fn edits_change_only_their_range() {
        let t = edit("a.tsx", SRC, 4, 7, "h1", &Op::Text { value: "People".into() }).unwrap();
        assert_eq!(t, SRC.replace("        Users\n", "        People\n"));
        let a = edit("a.tsx", SRC, 7, 7, "Button", &Op::Attr { name: "variant".into(), value: Some("outline".into()) }).unwrap();
        assert_eq!(a, SRC.replace("variant=\"primary\"", "variant=\"outline\""));
        let add = edit("a.tsx", SRC, 7, 7, "Button", &Op::Attr { name: "size".into(), value: Some("sm".into()) }).unwrap();
        assert!(add.contains("{...rest} size=\"sm\">Invite"));
        let rm = edit("a.tsx", SRC, 7, 7, "Button", &Op::Attr { name: "disabled".into(), value: None }).unwrap();
        assert!(rm.contains("variant=\"primary\" {...rest}>"));
        let flag = |name: &str, value: bool| edit("a.tsx", SRC, 7, 7, "Button", &Op::Flag { name: name.into(), value }).unwrap();
        assert!(flag("disabled", false).contains("variant=\"primary\" disabled={false} {...rest}>"));
        assert!(flag("loading", true).contains("{...rest} loading>Invite"));
        let off = edit("a.tsx", &flag("disabled", false), 7, 7, "Button", &Op::Flag { name: "disabled".into(), value: true }).unwrap();
        assert_eq!(off, SRC);
        let q = edit("a.tsx", SRC, 4, 7, "h1", &Op::Text { value: "a < b".into() }).unwrap();
        assert!(q.contains("{\"a < b\"}"));
    }

    #[test]
    fn removes_duplicates_and_moves_elements() {
        let rm = edit("a.tsx", SRC, 4, 7, "h1", &Op::Remove).unwrap();
        assert_eq!(rm, SRC.replace("      <h1>\n        Users\n      </h1>\n", ""));
        let dup = edit("a.tsx", SRC, 7, 7, "Button", &Op::Duplicate).unwrap();
        let b = "<Button variant=\"primary\" disabled {...rest}>Invite</Button>";
        assert_eq!(dup, SRC.replace(b, &format!("{b}\n      {b}")));
        let down = edit("a.tsx", SRC, 4, 7, "h1", &Op::Move { by: 1 }).unwrap();
        assert!(down.find("<Button").unwrap() < down.find("<h1>").unwrap());
        assert_eq!(edit("a.tsx", &down, 4, 7, "Button", &Op::Move { by: 1 }).unwrap(), SRC);
        assert!(edit("a.tsx", SRC, 4, 7, "h1", &Op::Move { by: -1 }).is_err());
        let wrapped = edit("a.tsx", SRC, 7, 7, "Button", &Op::Wrap { class: "flex gap-2".into() }).unwrap();
        assert!(wrapped.contains("      <div className=\"flex gap-2\">\n        <Button"));
        assert!(wrapped.contains("</Button>\n      </div>\n      <>"));
        let added = edit("a.tsx", SRC, 4, 7, "h1", &Op::Add { tag: "p".into(), class: "text-sm".into(), text: "New text".into() }).unwrap();
        assert!(added.contains("      </h1>\n      <p className=\"text-sm\">New text</p>\n      <Button"));
        assert!(edit("a.tsx", SRC, 4, 7, "h1", &Op::Add { tag: "script".into(), class: String::new(), text: String::new() }).is_err());
        assert!(edit("a.tsx", SRC, 4, 7, "h1", &Op::Wrap { class: "a\" onClick={x}".into() }).is_err());
        // Taking out the root of a return would break the file, so it is refused.
        assert!(edit("a.tsx", SRC, 3, 5, "div", &Op::Remove).is_err());
    }

    #[test]
    fn refuses_when_the_file_moved_on() {
        assert!(edit("a.tsx", SRC, 4, 7, "Button", &Op::Text { value: "x".into() }).is_err());
        assert!(edit("a.tsx", SRC, 5, 7, "h1", &Op::Text { value: "x".into() }).is_err());
        assert!(edit("a.tsx", SRC, 3, 5, "div", &Op::Text { value: "x".into() }).is_err());
        assert!(edit("a.tsx", SRC, 3, 5, "div", &Op::Attr { name: "a=b".into(), value: Some("x".into()) }).is_err());
        assert!(edit("a.tsx", "const x = <div>", 1, 11, "div", &Op::Text { value: "x".into() }).is_err());
    }
}
