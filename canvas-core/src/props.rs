// Reads the props of the React components a file defines, so the canvas can offer them like Figma component
// properties: a union of string literals becomes a variant picker, string and number become fields, boolean a switch.
// A component is a function whose name starts with a capital letter and whose first parameter is typed, either
// inline (`{ a }: { a: string }`) or through a type alias or interface in the same file (`Props`, `X & { ... }`).

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Expression, FormalParameters, Function, ObjectPropertyKind, PropertyKey, TSLiteral, TSSignature, TSType, TSTypeName, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::scope::ScopeFlags;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PropType {
    /// One of a fixed set of strings, e.g. `'primary' | 'secondary'`.
    Variant { options: Vec<String> },
    String,
    Number,
    Boolean,
    /// Anything else (a function, a node, an object), shown as code.
    Other { raw: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Prop {
    pub name: String,
    pub optional: bool,
    #[serde(rename = "type")]
    pub ty: PropType,
    /// The default from the parameter's destructuring, as written (`'primary'`, `false`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Component {
    pub name: String,
    pub line: u32,
    pub props: Vec<Prop>,
}

/// The members of a type as written, with type references left unresolved until every alias in the file is known.
#[derive(Default, Clone)]
struct Shape {
    props: Vec<Prop>,
    refs: Vec<String>,
}

struct Collect<'s> {
    src: &'s str,
    types: HashMap<String, Shape>,
    /// Aliases that name a prop type rather than an object, e.g. `type Size = 'sm' | 'md'`.
    aliases: HashMap<String, PropType>,
    /// Keys of object constants, for `keyof typeof TONES`.
    objects: HashMap<String, Vec<String>>,
    found: Vec<(String, u32, Shape, HashMap<String, String>)>,
}

impl<'s> Collect<'s> {
    fn raw(&self, span: oxc_span::Span) -> String {
        self.src[span.start as usize..span.end as usize].to_string()
    }

    /// A string literal's text without its quotes, as written.
    fn unquote(&self, span: oxc_span::Span) -> String {
        self.src[span.start as usize + 1..span.end as usize - 1].to_string()
    }

    fn prop_type(&self, ty: &TSType) -> PropType {
        match ty {
            TSType::TSStringKeyword(_) => PropType::String,
            TSType::TSNumberKeyword(_) => PropType::Number,
            TSType::TSBooleanKeyword(_) => PropType::Boolean,
            TSType::TSLiteralType(l) => match &l.literal {
                TSLiteral::StringLiteral(s) => PropType::Variant { options: vec![self.unquote(s.span)] },
                _ => PropType::Other { raw: self.raw(ty.span()) },
            },
            TSType::TSUnionType(u) => {
                let mut options = Vec::new();
                let mut bools = 0;
                for t in &u.types {
                    match t {
                        TSType::TSLiteralType(l) => match &l.literal {
                            TSLiteral::StringLiteral(s) => options.push(self.unquote(s.span)),
                            TSLiteral::BooleanLiteral(_) => bools += 1,
                            _ => return PropType::Other { raw: self.raw(ty.span()) },
                        },
                        TSType::TSBooleanKeyword(_) => bools += 1,
                        TSType::TSUndefinedKeyword(_) | TSType::TSNullKeyword(_) => {}
                        _ => return PropType::Other { raw: self.raw(ty.span()) },
                    }
                }
                if options.is_empty() && bools > 0 { PropType::Boolean } else if bools > 0 { PropType::Other { raw: self.raw(ty.span()) } } else { PropType::Variant { options } }
            }
            TSType::TSParenthesizedType(p) => self.prop_type(&p.type_annotation),
            _ => PropType::Other { raw: self.raw(ty.span()) },
        }
    }

    fn members(&self, members: &[TSSignature]) -> Vec<Prop> {
        members
            .iter()
            .filter_map(|m| {
                let TSSignature::TSPropertySignature(p) = m else { return None };
                let name = match &p.key {
                    PropertyKey::StaticIdentifier(id) => id.name.to_string(),
                    PropertyKey::StringLiteral(s) => self.unquote(s.span),
                    _ => return None,
                };
                let ty = p.type_annotation.as_ref().map_or(PropType::Other { raw: String::new() }, |t| self.prop_type(&t.type_annotation));
                Some(Prop { name, optional: p.optional, ty, default: None })
            })
            .collect()
    }

    fn shape(&self, ty: &TSType) -> Shape {
        match ty {
            TSType::TSTypeLiteral(l) => Shape { props: self.members(&l.members), refs: vec![] },
            TSType::TSIntersectionType(i) => i.types.iter().fold(Shape::default(), |mut acc, t| {
                let s = self.shape(t);
                acc.props.extend(s.props);
                acc.refs.extend(s.refs);
                acc
            }),
            TSType::TSTypeReference(r) => match &r.type_name {
                TSTypeName::IdentifierReference(id) => Shape { props: vec![], refs: vec![id.name.to_string()] },
                _ => Shape::default(),
            },
            TSType::TSParenthesizedType(p) => self.shape(&p.type_annotation),
            _ => Shape::default(),
        }
    }

    fn component(&mut self, name: &str, at: u32, params: &FormalParameters) {
        if !name.starts_with(|c: char| c.is_ascii_uppercase()) {
            return;
        }
        let Some(first) = params.items.first() else { return };
        let Some(ann) = &first.type_annotation else { return };
        let shape = self.shape(&ann.type_annotation);
        let mut defaults = HashMap::new();
        if let BindingPattern::ObjectPattern(o) = &first.pattern {
            for p in &o.properties {
                let PropertyKey::StaticIdentifier(key) = &p.key else { continue };
                if let BindingPattern::AssignmentPattern(a) = &p.value {
                    defaults.insert(key.name.to_string(), self.raw(a.right.span()));
                }
            }
        }
        self.found.push((name.to_string(), at, shape, defaults));
    }
}

impl<'a, 's> Visit<'a> for Collect<'s> {
    fn visit_ts_type_alias_declaration(&mut self, it: &oxc_ast::ast::TSTypeAliasDeclaration<'a>) {
        let s = self.shape(&it.type_annotation);
        self.types.insert(it.id.name.to_string(), s);
        let t = self.prop_type(&it.type_annotation);
        if !matches!(t, PropType::Other { .. }) {
            self.aliases.insert(it.id.name.to_string(), t);
        }
    }

    fn visit_ts_interface_declaration(&mut self, it: &oxc_ast::ast::TSInterfaceDeclaration<'a>) {
        let mut s = Shape { props: self.members(&it.body.body), refs: vec![] };
        for h in &it.extends {
            if let TSTypeName::IdentifierReference(id) = &h.type_name {
                s.refs.push(id.name.to_string());
            }
        }
        self.types.insert(it.id.name.to_string(), s);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if let Some(id) = &it.id {
            self.component(&id.name.to_string(), it.span.start, &it.params);
        }
        walk::walk_function(self, it, flags);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            let name = id.name.to_string();
            match init {
                Expression::ArrowFunctionExpression(f) => self.component(&name, it.span.start, &f.params),
                Expression::FunctionExpression(f) => self.component(&name, it.span.start, &f.params),
                _ => {
                    let mut e = init;
                    loop {
                        match e {
                            Expression::TSAsExpression(a) => e = &a.expression,
                            Expression::TSSatisfiesExpression(a) => e = &a.expression,
                            _ => break,
                        }
                    }
                    if let Expression::ObjectExpression(o) = e {
                        let keys = o
                            .properties
                            .iter()
                            .filter_map(|p| match p {
                                ObjectPropertyKind::ObjectProperty(p) => match &p.key {
                                    PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
                                    PropertyKey::StringLiteral(l) => Some(self.unquote(l.span)),
                                    _ => None,
                                },
                                _ => None,
                            })
                            .collect();
                        self.objects.insert(name, keys);
                    }
                }
            }
        }
        walk::walk_variable_declarator(self, it);
    }
}

/// Props of `name`'s shape with its references resolved; a reference to a type outside the file (React's
/// ButtonHTMLAttributes, say) adds nothing, since those props are the platform's, not the design system's.
fn resolve(types: &HashMap<String, Shape>, shape: &Shape, depth: u32, out: &mut Vec<Prop>) {
    for p in &shape.props {
        if !out.iter().any(|o| o.name == p.name) {
            out.push(p.clone());
        }
    }
    if depth > 8 {
        return;
    }
    for r in &shape.refs {
        if let Some(s) = types.get(r) {
            resolve(types, s, depth + 1, out);
        }
    }
}

pub fn components(path: &str, src: &str) -> Result<Vec<Component>, String> {
    let source_type = SourceType::from_path(path).map_err(|_| format!("Not a script file: {path}"))?;
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, src, source_type).parse();
    if ret.fatal_error || ret.diagnostics.has_errors() {
        return Err(format!("Could not parse {path}"));
    }
    let mut c = Collect { src, types: HashMap::new(), aliases: HashMap::new(), objects: HashMap::new(), found: Vec::new() };
    c.visit_program(&ret.program);
    Ok(c.found
        .iter()
        .map(|(name, at, shape, defaults)| {
            let mut props = Vec::new();
            resolve(&c.types, shape, 0, &mut props);
            for p in &mut props {
                if let PropType::Other { raw } = &p.ty {
                    if let Some(t) = c.aliases.get(raw.as_str()) {
                        p.ty = t.clone();
                    } else if let Some(keys) = raw.strip_prefix("keyof typeof ").and_then(|n| c.objects.get(n.trim())) {
                        p.ty = PropType::Variant { options: keys.clone() };
                    }
                }
                p.default = defaults.get(&p.name).cloned();
            }
            Component { name: name.clone(), line: crate::jsx::line_col(src, *at).0, props }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_variants_defaults_and_aliases() {
        let src = r#"
import type { ButtonHTMLAttributes } from 'react';
type Size = 'sm' | 'md';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; size?: Size; label: string; on?: boolean | undefined };
export function Button({ variant = 'primary', size = 'md', ...rest }: Props) { return <button {...rest} />; }
export const Badge = ({ tone }: { tone: 'success' | 'danger'; count?: number }) => <span />;
function helper(x: { a: string }) { return x; }
"#;
        let cs = components("A.tsx", src).unwrap();
        assert_eq!(cs.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Button", "Badge"]);
        let b = &cs[0];
        let variant = b.props.iter().find(|p| p.name == "variant").unwrap();
        assert_eq!(variant.ty, PropType::Variant { options: vec!["primary".into(), "secondary".into()] });
        assert_eq!(variant.default.as_deref(), Some("'primary'"));
        // `size?: Size` names an alias declared in the same file, which is followed to its options.
        assert_eq!(b.props.iter().find(|p| p.name == "size").unwrap().ty, PropType::Variant { options: vec!["sm".into(), "md".into()] });
        assert_eq!(b.props.iter().find(|p| p.name == "label").unwrap().ty, PropType::String);
        assert_eq!(b.props.iter().find(|p| p.name == "on").unwrap().ty, PropType::Boolean);
        assert_eq!(cs[1].props.iter().find(|p| p.name == "count").unwrap().ty, PropType::Number);
    }

    #[test]
    fn follows_interfaces_and_extends() {
        let src = "const TONES = { info: 'x', 'warn-ing': 'y' } as const;\ninterface Base { tone?: 'a' | 'b' }\ninterface P extends Base { title: string; t2?: keyof typeof TONES }\nexport function Card(p: P) { return null; }";
        let cs = components("A.tsx", src).unwrap();
        let names: Vec<_> = cs[0].props.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["title", "t2", "tone"]);
        assert_eq!(cs[0].props[1].ty, PropType::Variant { options: vec!["info".into(), "warn-ing".into()] });
    }
}
