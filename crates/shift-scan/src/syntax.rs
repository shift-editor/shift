//! Small questions about syntax that several kinds ask: is this item a test,
//! what type does this name, what is this name in snake case.

use quote::ToTokens;
use syn::visit_mut::{self, VisitMut};
use syn::{Attribute, Item, Type};

/// Whether an item is test-only: `#[test]` or `#[cfg(test)]`.
pub(crate) fn is_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("test")
            || (attr.path().is_ident("cfg") && attr.to_token_stream().to_string().contains("test"))
    })
}

/// The last segment of a type path, through references: `&mut Font` is
/// `Font`, `shift_font::GlyphId` is `GlyphId`.
pub(crate) fn type_name(ty: &Type) -> Option<String> {
    match ty {
        Type::Reference(reference) => type_name(&reference.elem),
        Type::Path(path) => path
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string()),
        _ => None,
    }
}

/// The type arguments of a path type's last segment: `Result<A, B>` gives
/// `[A, B]`.
pub(crate) fn type_arguments(ty: &Type) -> Vec<&Type> {
    let Type::Path(path) = ty else {
        return Vec::new();
    };
    let Some(syn::PathArguments::AngleBracketed(arguments)) =
        path.path.segments.last().map(|segment| &segment.arguments)
    else {
        return Vec::new();
    };
    arguments
        .args
        .iter()
        .filter_map(|argument| match argument {
            syn::GenericArgument::Type(ty) => Some(ty),
            _ => None,
        })
        .collect()
}

/// `GlyphId` is `glyph_id`.
pub(crate) fn snake_case(name: &str) -> String {
    let mut snake = String::new();
    for (index, character) in name.char_indices() {
        if character.is_uppercase() && index > 0 {
            snake.push('_');
        }
        snake.extend(character.to_lowercase());
    }
    snake
}

/// Whether an item can be named outside its module.
pub(crate) fn is_visible(vis: &syn::Visibility) -> bool {
    !matches!(vis, syn::Visibility::Inherited)
}

/// The lines a span covers, first and last included.
pub(crate) fn line_count(span: proc_macro2::Span) -> usize {
    span.end().line - span.start().line + 1
}

/// Removes test items, so the kinds that look at library code never meet
/// them: `#[cfg(test)]` modules, `#[test]` functions and test-only impls.
pub(crate) fn without_tests(file: &syn::File) -> syn::File {
    let mut code = file.clone();
    TestPruner.visit_file_mut(&mut code);
    code
}

struct TestPruner;

impl VisitMut for TestPruner {
    fn visit_file_mut(&mut self, file: &mut syn::File) {
        file.items.retain(|item| !item_is_test(item));
        visit_mut::visit_file_mut(self, file);
    }

    fn visit_item_mod_mut(&mut self, module: &mut syn::ItemMod) {
        if let Some((_, items)) = &mut module.content {
            items.retain(|item| !item_is_test(item));
        }
        visit_mut::visit_item_mod_mut(self, module);
    }

    fn visit_item_impl_mut(&mut self, item: &mut syn::ItemImpl) {
        item.items.retain(|member| match member {
            syn::ImplItem::Fn(function) => !is_test(&function.attrs),
            _ => true,
        });
        visit_mut::visit_item_impl_mut(self, item);
    }

    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        block.stmts.retain(|stmt| match stmt {
            syn::Stmt::Item(item) => !item_is_test(item),
            _ => true,
        });
        visit_mut::visit_block_mut(self, block);
    }
}

fn item_is_test(item: &Item) -> bool {
    match item {
        Item::Mod(item) => is_test(&item.attrs),
        Item::Fn(item) => is_test(&item.attrs),
        Item::Impl(item) => is_test(&item.attrs),
        Item::Struct(item) => is_test(&item.attrs),
        Item::Enum(item) => is_test(&item.attrs),
        Item::Use(item) => is_test(&item.attrs),
        Item::Const(item) => is_test(&item.attrs),
        Item::Static(item) => is_test(&item.attrs),
        Item::Trait(item) => is_test(&item.attrs),
        Item::Type(item) => is_test(&item.attrs),
        Item::Macro(item) => is_test(&item.attrs),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snake_case_splits_at_capitals() {
        assert_eq!(snake_case("GlyphId"), "glyph_id");
        assert_eq!(snake_case("Glyph"), "glyph");
    }

    #[test]
    fn test_items_are_removed() {
        let file = syn::parse_file(
            "fn kept() {} #[test] fn gone() {} #[cfg(test)] mod tests { fn helper() {} }
             impl A { fn kept() {} #[test] fn gone() {} }",
        )
        .unwrap();
        let code = without_tests(&file).to_token_stream().to_string();
        assert!(code.contains("kept"));
        assert!(!code.contains("gone"));
        assert!(!code.contains("helper"));
    }
}
