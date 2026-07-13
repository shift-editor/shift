use std::fmt::Write;

use shift_font::{Axis, AxisLabel};

pub(super) fn generated_stat_fea(axes: &[Axis]) -> Result<Option<String>, String> {
    if !axes.iter().any(|axis| !axis.labels().is_empty()) {
        return Ok(None);
    }

    let mut fea = String::from("table STAT {\n");
    fea.push_str("  ElidedFallbackName {\n    name \"Regular\";\n  };\n");

    for (ordering, axis) in axes.iter().enumerate() {
        writeln!(
            fea,
            "  DesignAxis {} {} {{\n    name \"{}\";\n  }};",
            axis.tag(),
            ordering,
            escape_name(axis.name())?
        )
        .expect("writing to a string cannot fail");
    }

    for axis in axes {
        for label in axis.labels() {
            append_axis_values(&mut fea, axis, label)?;
        }
    }

    fea.push_str("} STAT;\n");
    Ok(Some(fea))
}

fn append_axis_values(fea: &mut String, axis: &Axis, label: &AxisLabel) -> Result<(), String> {
    let mut emitted = false;
    if let Some(range) = &label.range {
        append_axis_value(
            fea,
            axis,
            label,
            &format!(
                "{} {} {}",
                number(label.value),
                number(range.minimum),
                number(range.maximum)
            ),
        )?;
        emitted = true;
    }
    if let Some(linked_value) = label.linked_value {
        append_axis_value(
            fea,
            axis,
            label,
            &format!("{} {}", number(label.value), number(linked_value)),
        )?;
        emitted = true;
    }
    if !emitted {
        append_axis_value(fea, axis, label, &number(label.value))?;
    }

    Ok(())
}

fn append_axis_value(
    fea: &mut String,
    axis: &Axis,
    label: &AxisLabel,
    location: &str,
) -> Result<(), String> {
    writeln!(
        fea,
        "  AxisValue {{\n    location {} {};\n    name \"{}\";",
        axis.tag(),
        location,
        escape_name(&label.name)?
    )
    .expect("writing to a string cannot fail");
    if label.elidable {
        fea.push_str("    flag ElidableAxisValueName;\n");
    }
    fea.push_str("  };\n");
    Ok(())
}

fn number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }

    value.to_string()
}

fn escape_name(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err(format!(
            "STAT names must not contain control characters: {value:?}"
        ));
    }

    Ok(value.replace('\\', "\\\\").replace('"', "\\\""))
}
