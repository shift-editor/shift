pub fn glyph_id_for_name(name: &str) -> String {
    stable_id("glyph", name)
}

pub fn source_id_for_name(name: &str) -> String {
    stable_id("source", name)
}

pub fn axis_id_for_tag(tag: &str) -> String {
    stable_id("axis", tag)
}

fn stable_id(prefix: &str, label: &str) -> String {
    let mut id = String::with_capacity(prefix.len() + label.len() + 1);
    id.push_str(prefix);
    id.push('_');

    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            id.push(ch);
        } else {
            id.push('_');
        }
    }

    while id.contains("__") {
        id = id.replace("__", "_");
    }

    id.trim_end_matches('_').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_ids_keep_ascii_names_readable() {
        assert_eq!(glyph_id_for_name("Aacute"), "glyph_Aacute");
        assert_eq!(source_id_for_name("Bold Italic"), "source_Bold_Italic");
        assert_eq!(axis_id_for_tag("wght"), "axis_wght");
    }
}
