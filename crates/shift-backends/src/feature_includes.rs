//! Inlines `include(...)` statements in imported feature code.
//!
//! Sources often split their features across files, such as
//! `include(features/kern.fea);` beside a `.glyphs` file or
//! `include(../../familyGSUB.fea);` beside a UFO. A Shift document stores the
//! feature text alone, so the included files are read once at import and
//! spliced in; the document then compiles without the original folder.

use std::path::Path;

/// How deep includes may nest, which also stops include cycles.
const MAX_DEPTH: usize = 32;

/// Returns `source` with every `include(path);` outside comments and strings
/// replaced by the file's contents, resolved against `base_dir` as fontc and
/// ufo2ft do (the folder holding the `.glyphs` file or the UFO). Included
/// files are inlined recursively. A statement whose file cannot be read is
/// left as written, so compiling reports it.
pub(crate) fn inline_feature_includes(source: &str, base_dir: &Path) -> String {
    inline(source, base_dir, 0)
}

fn inline(source: &str, base_dir: &Path, depth: usize) -> String {
    let bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len());
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'#' => index = line_end(bytes, index),
            b'"' => index = string_end(bytes, index),
            b'i' if depth < MAX_DEPTH && at_word_start(bytes, index) => {
                let Some(statement) = include_statement(source, index) else {
                    index += 1;
                    continue;
                };
                let Ok(contents) = std::fs::read_to_string(base_dir.join(statement.path)) else {
                    index = statement.end;
                    continue;
                };
                output.push_str(&source[copied..index]);
                output.push_str(&inline(&contents, base_dir, depth + 1));
                if !contents.ends_with('\n') {
                    output.push('\n');
                }
                index = statement.end;
                copied = index;
            }
            _ => index += 1,
        }
    }
    output.push_str(&source[copied..]);
    output
}

struct IncludeStatement<'a> {
    path: &'a str,
    /// Byte offset just past the statement, including its `;` when present.
    end: usize,
}

/// Parses `include ( path ) ;` starting at `start`.
fn include_statement(source: &str, start: usize) -> Option<IncludeStatement<'_>> {
    let rest = source[start..].strip_prefix("include")?;
    let after_keyword = rest.trim_start();
    let inner = after_keyword.strip_prefix('(')?;
    let close = inner.find(')')?;
    let path = inner[..close].trim();
    if path.is_empty() || path.contains('\n') {
        return None;
    }
    let mut end = source.len() - inner.len() + close + 1;
    let tail = &source[end..];
    let trimmed = tail.trim_start_matches([' ', '\t']);
    if trimmed.starts_with(';') {
        end += tail.len() - trimmed.len() + 1;
    }
    Some(IncludeStatement { path, end })
}

fn at_word_start(bytes: &[u8], index: usize) -> bool {
    index == 0
        || !(bytes[index - 1].is_ascii_alphanumeric()
            || matches!(bytes[index - 1], b'_' | b'.' | b'@' | b'\\'))
}

fn line_end(bytes: &[u8], index: usize) -> usize {
    bytes[index..]
        .iter()
        .position(|byte| *byte == b'\n')
        .map_or(bytes.len(), |offset| index + offset)
}

fn string_end(bytes: &[u8], index: usize) -> usize {
    bytes[index + 1..]
        .iter()
        .position(|byte| *byte == b'"')
        .map_or(bytes.len(), |offset| index + offset + 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, path: &str, contents: &str) {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn inlines_includes_relative_to_the_base_directory() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "features/kern.fea", "pos A V -50;\n");
        write(dir.path(), "../shared.fea", "@caps = [A V];");

        let inlined = inline_feature_includes(
            "include(../shared.fea);\nfeature kern {\n    include (features/kern.fea) ;\n} kern;\n",
            dir.path(),
        );

        assert_eq!(
            inlined,
            "@caps = [A V];\n\nfeature kern {\n    pos A V -50;\n\n} kern;\n"
        );
    }

    #[test]
    fn inlines_nested_includes_against_the_same_base_directory() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "features/all.fea",
            "include(features/liga.fea);",
        );
        write(dir.path(), "features/liga.fea", "sub f i by fi;\n");

        assert_eq!(
            inline_feature_includes("include(features/all.fea);", dir.path()),
            "sub f i by fi;\n\n"
        );
    }

    #[test]
    fn leaves_comments_strings_and_unreadable_includes_alone() {
        let dir = tempfile::tempdir().unwrap();
        let source =
            "# include(gone.fea);\nname \"include(x)\";\ninclude(missing.fea);\nmyinclude(x);\n";

        assert_eq!(inline_feature_includes(source, dir.path()), source);
    }

    #[test]
    fn stops_at_include_cycles() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "loop.fea", "include(loop.fea);");

        let inlined = inline_feature_includes("include(loop.fea);", dir.path());

        assert!(inlined.trim_end().ends_with("include(loop.fea);"));
    }
}
