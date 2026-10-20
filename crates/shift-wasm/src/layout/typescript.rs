//! Generates the editor's TypeScript side of every hot call.
//!
//! For each call, the generated module declares the input and output
//! interfaces, writes the input with a `NumberWriter`, calls the module, and
//! reads the output with a `NumberReader`, all from the [`Kind`]s the Rust
//! layouts describe. Interfaces list only the fields Rust reads, so the
//! editor's own objects satisfy them.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use shift_font::test_support::generated::assert_generated_file;

use super::{EnumKind, Kind, Layout, StructKind};
use crate::anchors::{FollowingComponent, PropagationGlyph};
use crate::decomposition::DecomposedGlyph;
use crate::shaping::{ShapeParagraphs, ShapedRunOutput, ShaperGlyphs};

/// One WebAssembly module and the hot calls it exports, generated into one
/// TypeScript file that imports only that module, so a module the editor
/// loads lazily is never pulled in by another's calls.
struct Module {
    /// The generated file, relative to the repository root.
    output: &'static str,
    /// The package path the generated calls import.
    import: &'static str,
    calls: Vec<Call>,
}

fn modules() -> [Module; 2] {
    [
        Module {
            output: "packages/editor/src/lib/wasm/generated/layouts.ts",
            import: "@shift/wasm",
            calls: calls(),
        },
        Module {
            output: "packages/editor/src/lib/wasm/generated/shapingLayouts.ts",
            import: "@shift/wasm/shaping",
            calls: shaping_calls(),
        },
    ]
}

/// One exported hot call: its JavaScript name and its input and output layouts.
struct Call {
    name: &'static str,
    doc: &'static str,
    input: Kind,
    output: Kind,
}

fn calls() -> Vec<Call> {
    vec![
        Call {
            name: "propagateAnchors",
            doc: "Propagates one glyph's anchors at one location, as export compiles them.",
            input: PropagationGlyph::kind(),
            output: <shift_font::anchor_propagation::PropagatedAnchors as Layout>::kind(),
        },
        Call {
            name: "followAnchors",
            doc: "Places a composite's components after an edit, anchored ones on their anchors.",
            input: Vec::<FollowingComponent>::kind(),
            output: Vec::<shift_font::anchor_attachment::Following>::kind(),
        },
        Call {
            name: "blendDecomposedGlyph",
            doc: "Blends every component occurrence of a decomposed glyph as each master places it, or null when any occurrence's masters don't line up point for point.",
            input: DecomposedGlyph::kind(),
            output: Option::<Vec<Vec<shift_font::placed_blend::BlendedPoint>>>::kind(),
        },
    ]
}

fn shaping_calls() -> Vec<Call> {
    vec![
        Call {
            name: "setShaperGlyphs",
            doc: "Sets how a registered shaper's axes normalize and which glyph each character maps to.",
            input: ShaperGlyphs::kind(),
            output: bool::kind(),
        },
        Call {
            name: "shapeParagraphs",
            doc: "Shapes paragraphs with a registered shaper; a paragraph that cannot be shaped is null.",
            input: ShapeParagraphs::kind(),
            output: Vec::<Option<Vec<ShapedRunOutput>>>::kind(),
        },
    ]
}

#[test]
fn generated_file_wasm_layouts() {
    for module in modules() {
        assert_generated_file(module.output, &render(&module));
    }
}

#[derive(Default)]
struct Named {
    structs: BTreeMap<&'static str, StructKind>,
    enums: BTreeMap<&'static str, EnumKind>,
}

impl Named {
    /// Collects the named layouts `kind` uses.
    ///
    /// # Panics
    ///
    /// Panics when two different layouts share a TypeScript name, which
    /// would otherwise generate one interface for both.
    fn collect(&mut self, kind: &Kind) {
        match kind {
            Kind::List(item) | Kind::Optional(item) => self.collect(item),
            Kind::Struct(layout) => {
                if let Some(existing) = self.structs.get(layout.name) {
                    assert_eq!(
                        fields_signature(existing),
                        fields_signature(layout),
                        "two layouts are named {}",
                        layout.name
                    );
                    return;
                }
                self.structs.insert(layout.name, layout.clone());
                for field in &layout.fields {
                    self.collect(&field.kind);
                }
            }
            Kind::Enum(layout) => {
                self.enums.insert(layout.name, layout.clone());
            }
            Kind::Number | Kind::Flag | Kind::Count | Kind::Name => {}
        }
    }
}

fn fields_signature(layout: &StructKind) -> String {
    layout
        .fields
        .iter()
        .map(|field| format!("{}:{}", field.name, type_of(&field.kind)))
        .collect::<Vec<_>>()
        .join(",")
}

fn render(module: &Module) -> String {
    let calls = &module.calls;
    // Inputs need writers and outputs readers; every named layout needs its
    // type, whichever way it crosses.
    let mut written = Named::default();
    let mut read = Named::default();
    for call in calls {
        written.collect(&call.input);
        read.collect(&call.output);
    }
    let mut named = Named::default();
    for call in calls {
        named.collect(&call.input);
        named.collect(&call.output);
    }

    let mut out = String::from(
        "// This file is generated from crates/shift-wasm/src/layout/typescript.rs.\n\
         // Run `pnpm generate:from-rust` after changing a layout in crates/shift-wasm.\n\
         // Do not edit this file manually.\n\n",
    );
    let imports = calls
        .iter()
        .map(|call| format!("{} as {}Call", call.name, call.name))
        .collect::<Vec<_>>()
        .join(", ");
    writeln!(out, "import {{ {imports} }} from \"{}\";", module.import).unwrap();
    out.push_str("import { NumberReader, NumberWriter } from \"../numbers\";\n");

    for layout in named.enums.values() {
        render_enum(&mut out, layout);
    }
    for layout in named.structs.values() {
        render_interface(&mut out, layout);
    }
    for call in calls {
        render_call(&mut out, call);
    }
    for layout in written.structs.values() {
        render_write(&mut out, layout);
    }
    for layout in read.structs.values() {
        render_read(&mut out, layout);
    }
    out
}

fn render_doc(out: &mut String, doc: &str, indent: &str) {
    let lines = doc
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    match lines.as_slice() {
        [] => {}
        [line] => writeln!(out, "{indent}/** {line} */").unwrap(),
        lines => {
            writeln!(out, "{indent}/**").unwrap();
            for line in lines {
                writeln!(out, "{indent} * {line}").unwrap();
            }
            writeln!(out, "{indent} */").unwrap();
        }
    }
}

fn render_enum(out: &mut String, layout: &EnumKind) {
    out.push('\n');
    render_doc(out, layout.doc, "");
    let union = layout
        .variants
        .iter()
        .map(|variant| format!("\"{variant}\""))
        .collect::<Vec<_>>()
        .join(" | ");
    writeln!(out, "export type {} = {union};", layout.name).unwrap();
    writeln!(
        out,
        "\nconst {}: readonly {}[] = [{}];",
        variants_const(layout),
        layout.name,
        layout
            .variants
            .iter()
            .map(|variant| format!("\"{variant}\""))
            .collect::<Vec<_>>()
            .join(", ")
    )
    .unwrap();
}

fn render_interface(out: &mut String, layout: &StructKind) {
    out.push('\n');
    render_doc(out, layout.doc, "");
    writeln!(out, "export interface {} {{", layout.name).unwrap();
    for field in &layout.fields {
        render_doc(out, field.doc, "  ");
        let optional = if matches!(field.kind, Kind::Optional(_)) {
            "?"
        } else {
            ""
        };
        writeln!(
            out,
            "  readonly {}{optional}: {};",
            camel(field.name),
            type_of(&field.kind)
        )
        .unwrap();
    }
    out.push_str("}\n");
}

fn render_call(out: &mut String, call: &Call) {
    out.push('\n');
    render_doc(out, call.doc, "");
    let input = type_of(&call.input);
    let output = read_type_of(&call.output);
    writeln!(
        out,
        "export function {}(input: {input}): {output} {{",
        call.name
    )
    .unwrap();
    out.push_str("  const write = NumberWriter.shared();\n");
    write_value(out, &call.input, "input", "  ", 0);
    writeln!(
        out,
        "  const read = new NumberReader({}Call(write.finish()));",
        call.name
    )
    .unwrap();
    writeln!(out, "  return {};", read_value(&call.output)).unwrap();
    out.push_str("}\n");
}

fn render_write(out: &mut String, layout: &StructKind) {
    writeln!(
        out,
        "\nfunction write{name}(write: NumberWriter, value: {name}): void {{",
        name = layout.name
    )
    .unwrap();
    for field in &layout.fields {
        let expr = format!("value.{}", camel(field.name));
        write_value(out, &field.kind, &expr, "  ", 0);
    }
    out.push_str("}\n");
}

fn render_read(out: &mut String, layout: &StructKind) {
    writeln!(
        out,
        "\nfunction read{name}(read: NumberReader): {name} {{",
        name = layout.name
    )
    .unwrap();
    out.push_str("  return {\n");
    for field in &layout.fields {
        writeln!(
            out,
            "    {}: {},",
            camel(field.name),
            read_value(&field.kind)
        )
        .unwrap();
    }
    out.push_str("  };\n}\n");
}

fn write_value(out: &mut String, kind: &Kind, expr: &str, indent: &str, depth: usize) {
    match kind {
        Kind::Number => writeln!(out, "{indent}write.number({expr});").unwrap(),
        Kind::Flag => writeln!(out, "{indent}write.flag({expr});").unwrap(),
        Kind::Count => writeln!(out, "{indent}write.count({expr});").unwrap(),
        Kind::Name => writeln!(out, "{indent}write.name({expr});").unwrap(),
        Kind::Struct(layout) => {
            writeln!(out, "{indent}write{}(write, {expr});", layout.name).unwrap();
        }
        Kind::Enum(layout) => writeln!(
            out,
            "{indent}write.count({}.indexOf({expr}));",
            variants_const(layout)
        )
        .unwrap(),
        Kind::List(item) => {
            let name = format!("item{depth}");
            writeln!(out, "{indent}write.count({expr}.length);").unwrap();
            writeln!(out, "{indent}for (const {name} of {expr}) {{").unwrap();
            write_value(out, item, &name, &format!("{indent}  "), depth + 1);
            writeln!(out, "{indent}}}").unwrap();
        }
        Kind::Optional(item) => {
            writeln!(out, "{indent}write.flag({expr} != null);").unwrap();
            writeln!(out, "{indent}if ({expr} != null) {{").unwrap();
            write_value(out, item, expr, &format!("{indent}  "), depth);
            writeln!(out, "{indent}}}").unwrap();
        }
    }
}

fn read_value(kind: &Kind) -> String {
    match kind {
        Kind::Number => "read.number()".into(),
        Kind::Flag => "read.flag()".into(),
        Kind::Count => "read.count()".into(),
        Kind::Name => "read.name()".into(),
        Kind::Struct(layout) => format!("read{}(read)", layout.name),
        Kind::Enum(layout) => format!(
            "{}[read.count()] ?? \"{}\"",
            variants_const(layout),
            layout.variants[0]
        ),
        Kind::List(item) => format!("read.list(() => {})", read_value(item)),
        Kind::Optional(item) => format!("read.flag() ? {} : null", read_value(item)),
    }
}

/// The TypeScript type a caller passes.
fn type_of(kind: &Kind) -> String {
    match kind {
        Kind::Number | Kind::Count => "number".into(),
        Kind::Flag => "boolean".into(),
        Kind::Name => "string".into(),
        Kind::Struct(layout) => layout.name.into(),
        Kind::Enum(layout) => layout.name.into(),
        Kind::List(item) => match item.as_ref() {
            // `readonly` and `|` bind looser than `[]`.
            Kind::List(_) | Kind::Optional(_) => format!("readonly ({})[]", type_of(item)),
            item => format!("readonly {}[]", type_of(item)),
        },
        Kind::Optional(item) => format!("{} | null", type_of(item)),
    }
}

/// The TypeScript type a decoded value has: lists come back mutable.
fn read_type_of(kind: &Kind) -> String {
    match kind {
        Kind::List(item) => match item.as_ref() {
            // `readonly` and `|` bind looser than `[]`.
            Kind::List(_) | Kind::Optional(_) => format!("({})[]", type_of(item)),
            item => format!("{}[]", type_of(item)),
        },
        kind => type_of(kind),
    }
}

fn variants_const(layout: &EnumKind) -> String {
    let mut name = String::new();
    for (index, character) in layout.name.char_indices() {
        if character.is_uppercase() && index > 0 {
            name.push('_');
        }
        name.push(character.to_ascii_uppercase());
    }
    name.push_str("_VARIANTS");
    name
}

/// Converts a Rust field name to its TypeScript property name.
fn camel(name: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for character in name.chars() {
        if character == '_' {
            upper = true;
        } else if upper {
            out.push(character.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(character);
        }
    }
    out
}
