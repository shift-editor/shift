//! Export refuses a font whose components carry conditions: no compiled or
//! source format holds them yet, and drawing them everywhere would be wrong.

use shift_backends::{
    ConditionalComponentRef, ExportError, ExportFormat, FontExportRequest, FontExporter,
    VariableComponents,
};
use shift_font::test_support::conditions_font;
use shift_font::{Condition, Font, SetComponentCondition};

fn conditional(glyph: &str, position: usize, base: &str) -> ConditionalComponentRef {
    ConditionalComponentRef {
        glyph: glyph.to_owned(),
        position,
        base: base.to_owned(),
    }
}

/// The components export refuses in `font` when compiling it, or what it
/// did instead.
fn refused(
    font: &Font,
    variable_components: VariableComponents,
) -> Result<Vec<ConditionalComponentRef>, String> {
    let exporter = FontExporter::new().with_variable_components(variable_components);
    match exporter.compile_ttf(font) {
        Err(ExportError::ComponentConditions(conditions)) => Ok(conditions.0),
        Err(other) => Err(other.to_string()),
        Ok(_) => Err("the font compiled".to_owned()),
    }
}

#[test]
fn compiling_refuses_every_conditional_component_with_or_without_varc() {
    let expected = [
        conditional("H", 1, "bar"),
        conditional("H", 2, "dot"),
        conditional("H", 3, "bar"),
        conditional("mid", 1, "bar"),
    ];
    let font = conditions_font();

    assert_eq!(
        refused(&font, VariableComponents::Decompose),
        Ok(expected.to_vec())
    );
    assert_eq!(
        refused(&font, VariableComponents::Varc),
        Ok(expected.to_vec())
    );
}

#[test]
fn the_refusal_names_each_component() {
    let error = FontExporter::new()
        .compile_ttf(&conditions_font())
        .expect_err("conditional components are refused");

    assert_eq!(
        error.to_string(),
        "component conditions can't be exported yet; remove the condition from \
         H: component 1 (bar), H: component 2 (dot), H: component 3 (bar), mid: component 1 (bar)"
    );
}

#[test]
fn source_exports_refuse_them_before_writing_anything() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let path = directory.path().join("Conditions.designspace");
    let result = FontExporter::new().export(
        &conditions_font(),
        FontExportRequest {
            path,
            format: ExportFormat::Designspace,
        },
    );

    assert!(matches!(result, Err(ExportError::ComponentConditions(_))));
    let written = std::fs::read_dir(directory.path())
        .expect("the directory is readable")
        .count();
    assert_eq!(written, 0);
}

#[test]
fn a_font_whose_conditions_are_cleared_compiles() {
    let mut font = conditions_font();
    let conditional: Vec<_> = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .flat_map(|layer| {
            layer
                .components_iter()
                .filter(|component| !component.condition().is_always())
                .map(|component| (layer.id(), component.id()))
        })
        .collect();
    for (layer_id, component_id) in conditional {
        let clear = SetComponentCondition {
            layer_id,
            component_id,
            condition: Condition::always(),
        };
        font.apply_intents(&clear.into())
            .expect("the condition is cleared");
    }

    let compiled = FontExporter::new()
        .compile_ttf(&font)
        .map(|_| ())
        .map_err(|error| error.to_string());
    assert_eq!(compiled, Ok(()));
}

#[test]
fn a_preview_compiles_them_drawn_everywhere_and_lists_them() {
    let preview = FontExporter::new()
        .compile_preview_ttf(&conditions_font())
        .map(|preview| (preview.bytes.is_empty(), preview.drawn_everywhere))
        .map_err(|error| error.to_string());

    assert_eq!(
        preview,
        Ok((
            false,
            vec![
                conditional("H", 1, "bar"),
                conditional("H", 2, "dot"),
                conditional("H", 3, "bar"),
                conditional("mid", 1, "bar"),
            ]
        ))
    );
}

#[test]
fn static_export_refuses_them() {
    let mut font = conditions_font();
    let location = font
        .axes()
        .iter()
        .map(|axis| (axis.id(), axis.default()))
        .collect();
    let instance = shift_font::NamedInstance::new("Regular".to_owned(), location, None);
    font.set_named_instances(vec![instance])
        .expect("the instance is valid");
    let directory = tempfile::tempdir().expect("a temporary directory");

    let result = FontExporter::new().export_static_instances_with(
        &font,
        directory.path(),
        &shift_backends::BinaryEncodings::ttf(),
    );

    assert!(matches!(result, Err(ExportError::ComponentConditions(_))));
}
