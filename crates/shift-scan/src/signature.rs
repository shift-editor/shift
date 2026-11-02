//! Kinds read off names and signatures: `get_*` lookups, `*_iter` twins,
//! `with_*` constructors, id parameters named for their value, generic type
//! suffixes, tuple returns and id accessors that clone.

use std::path::Path;

use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{FnArg, Pat, ReturnType, Signature, Type};

use crate::finding::{Finding, Kind, Report};
use crate::syntax;

/// Constructors whose `with_` names what they take, not a field they set.
const CONSTRUCTORS: [&str; 2] = ["with_id", "with_capacity"];
/// `get_` names the standard collections use, which a wrapper keeps.
const COLLECTION_GETTERS: [&str; 4] = ["get_mut", "get_or_", "get_index", "get_unchecked"];
/// Type name endings that say nothing about the concept.
const GENERIC_SUFFIXES: [&str; 3] = ["Data", "Info", "State"];

/// Where a function is declared, which decides what its name may be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Owner {
    /// A free function or a method of an inherent impl.
    Own,
    /// A trait's own declaration or default.
    TraitDeclaration,
    /// A method of `impl Trait for T`: the trait chose its name and shape.
    TraitImpl,
}

/// Walks one file's library code (tests already removed).
pub(crate) struct SignatureScan<'a> {
    report: Report<'a>,
    owner: Owner,
    in_inherent_impl: bool,
}

/// The findings of this module's kinds in one file's library code.
pub(crate) fn findings(path: &Path, code: &syn::File) -> Vec<Finding> {
    let mut scan = SignatureScan {
        report: Report::new(path),
        owner: Owner::Own,
        in_inherent_impl: false,
    };
    scan.visit_file(code);
    scan.report.found
}

impl<'a> SignatureScan<'a> {
    fn check(&mut self, sig: &Signature, visible: bool, block: Option<&syn::Block>) {
        let name = sig.ident.to_string();
        let span = sig.ident.span();
        if self.owner != Owner::TraitImpl {
            let collection_getter = COLLECTION_GETTERS
                .iter()
                .any(|getter| name.starts_with(getter));
            if visible && name.starts_with("get_") && !collection_getter {
                let detail = format!("{name}: a lookup is the noun, `{}`", &name[4..]);
                self.report.add(Kind::GetPrefix, span, detail);
            }
            if visible && name.ends_with("_iter") {
                let detail = format!("{name}: the plural is the collection; iterate it");
                self.report.add(Kind::IterSuffix, span, detail);
            }
            self.check_tuple_return(sig);
        }
        let has_receiver = sig.receiver().is_some();
        let is_builder_name = name.starts_with("with_") && !CONSTRUCTORS.contains(&name.as_str());
        if self.in_inherent_impl && !has_receiver && is_builder_name {
            let detail = format!("{name} constructs without `self`: `new(..).{name}(..)`");
            self.report.add(Kind::CtorWithPrefix, span, detail);
        }
        for input in &sig.inputs {
            self.check_id_param(input);
        }
        if let Some(block) = block {
            self.check_id_accessor(sig, block);
        }
    }

    fn check_tuple_return(&mut self, sig: &Signature) {
        let ReturnType::Type(_, output) = &sig.output else {
            return;
        };
        let wrapped = match syntax::type_name(output).as_deref() {
            Some("Result" | "Option") => syntax::type_arguments(output).first().copied(),
            _ => None,
        };
        let Some(Type::Tuple(tuple)) = wrapped.or(Some(output)) else {
            return;
        };
        if tuple.elems.len() < 2 {
            return;
        }
        let detail = format!(
            "{} returns a {}-tuple: name the type",
            sig.ident,
            tuple.elems.len()
        );
        self.report.add(Kind::TupleReturn, sig.ident.span(), detail);
    }

    fn check_id_param(&mut self, input: &FnArg) {
        let FnArg::Typed(typed) = input else {
            return;
        };
        let Pat::Ident(name) = &*typed.pat else {
            return;
        };
        let Some(id_type) = syntax::type_name(&typed.ty) else {
            return;
        };
        let Some(noun) = id_type.strip_suffix("Id").filter(|noun| !noun.is_empty()) else {
            return;
        };
        let noun = syntax::snake_case(noun);
        let last_word = noun.rsplit('_').next().unwrap_or(&noun);
        let name = name.ident.to_string();
        if name == noun || name == last_word {
            let detail = format!("`{name}: {id_type}` names the value; call it `{noun}_id`");
            self.report.add(Kind::IdParamName, typed.pat.span(), detail);
        }
    }

    fn check_id_accessor(&mut self, sig: &Signature, block: &syn::Block) {
        let lends_self = sig
            .receiver()
            .is_some_and(|receiver| receiver.reference.is_some());
        let name = sig.ident.to_string();
        let is_id_name = name == "id" || name.ends_with("_id");
        let ReturnType::Type(_, output) = &sig.output else {
            return;
        };
        let returns_owned_id = !matches!(**output, Type::Reference(_))
            && syntax::type_name(output).is_some_and(|ty| ty.ends_with("Id"));
        if !(lends_self && is_id_name && returns_owned_id) {
            return;
        }
        let mut clones = Clones::default();
        clones.visit_block(block);
        if clones.found {
            let detail = format!("{name} clones the id on every call: return `&` it");
            self.report
                .add(Kind::OwnedIdAccessor, sig.ident.span(), detail);
        }
    }

    fn check_type_name(&mut self, ident: &syn::Ident) {
        let name = ident.to_string();
        let suffix = GENERIC_SUFFIXES
            .iter()
            .find(|suffix| name.len() > suffix.len() && name.ends_with(*suffix));
        if let Some(suffix) = suffix {
            let detail = format!("{name}: `{suffix}` says nothing; name the concept");
            self.report.add(Kind::GenericSuffix, ident.span(), detail);
        }
    }
}

/// Whether a body calls `.clone()` or `Arc::clone`.
#[derive(Default)]
struct Clones {
    found: bool,
}

impl<'ast> Visit<'ast> for Clones {
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        self.found |= call.method == "clone";
        visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_path(&mut self, path: &'ast syn::ExprPath) {
        self.found |= path
            .path
            .segments
            .last()
            .is_some_and(|segment| segment.ident == "clone");
        visit::visit_expr_path(self, path);
    }
}

impl<'ast> Visit<'ast> for SignatureScan<'_> {
    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        let visible = syntax::is_visible(&function.vis);
        let (owner, inherent) = (self.owner, self.in_inherent_impl);
        self.owner = Owner::Own;
        self.in_inherent_impl = false;
        self.check(&function.sig, visible, Some(&function.block));
        visit::visit_item_fn(self, function);
        (self.owner, self.in_inherent_impl) = (owner, inherent);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        let (owner, inherent) = (self.owner, self.in_inherent_impl);
        self.in_inherent_impl = item.trait_.is_none();
        self.owner = if self.in_inherent_impl {
            Owner::Own
        } else {
            Owner::TraitImpl
        };
        visit::visit_item_impl(self, item);
        (self.owner, self.in_inherent_impl) = (owner, inherent);
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        let visible = syntax::is_visible(&method.vis);
        self.check(&method.sig, visible, Some(&method.block));
        visit::visit_impl_item_fn(self, method);
    }

    fn visit_item_trait(&mut self, item: &'ast syn::ItemTrait) {
        let owner = self.owner;
        self.owner = Owner::TraitDeclaration;
        let visible = syntax::is_visible(&item.vis);
        for member in &item.items {
            if let syn::TraitItem::Fn(method) = member {
                self.check(&method.sig, visible, method.default.as_ref());
            }
        }
        visit::visit_item_trait(self, item);
        self.owner = owner;
    }

    fn visit_item_struct(&mut self, item: &'ast syn::ItemStruct) {
        self.check_type_name(&item.ident);
        visit::visit_item_struct(self, item);
    }

    fn visit_item_enum(&mut self, item: &'ast syn::ItemEnum) {
        self.check_type_name(&item.ident);
        visit::visit_item_enum(self, item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(source: &str) -> Vec<(Kind, String)> {
        let code = syn::parse_file(source).unwrap();
        super::findings(Path::new("lib.rs"), &code)
            .into_iter()
            .map(|finding| (finding.kind, finding.detail))
            .collect()
    }

    #[test]
    fn a_public_get_prefix_and_iter_suffix_are_reported() {
        let found = findings(
            "impl Contour { pub fn get_point(&self) {} pub fn points_iter(&self) {} fn get_cached(&self) {} pub fn get_mut(&mut self) {} }",
        );
        assert_eq!(
            found,
            [
                (
                    Kind::GetPrefix,
                    "get_point: a lookup is the noun, `point`".to_string()
                ),
                (
                    Kind::IterSuffix,
                    "points_iter: the plural is the collection; iterate it".to_string()
                ),
            ]
        );
    }

    #[test]
    fn a_trait_impl_keeps_the_names_its_trait_chose() {
        let found = findings("impl Lookup for Font { fn get_glyph(&self) -> (A, B) {} }");
        assert!(found.is_empty());
    }

    #[test]
    fn a_with_constructor_without_self_is_reported() {
        let found = findings(
            "impl GlyphLayer {
                 pub fn with_width(id: LayerId, width: f64) -> Self {}
                 pub fn with_id(id: LayerId) -> Self {}
                 pub fn with_name(mut self, name: &str) -> Self {}
             }",
        );
        assert_eq!(
            found,
            [(
                Kind::CtorWithPrefix,
                "with_width constructs without `self`: `new(..).with_width(..)`".to_string()
            )]
        );
    }

    #[test]
    fn an_id_parameter_named_for_its_value_is_reported() {
        let found = findings(
            "fn advance(glyph: GlyphId, base: GlyphId, glyph_id: GlyphId, id: GlyphId, source: &KerningSourceId) {}",
        );
        assert_eq!(
            found,
            [
                (
                    Kind::IdParamName,
                    "`glyph: GlyphId` names the value; call it `glyph_id`".to_string()
                ),
                (
                    Kind::IdParamName,
                    "`source: KerningSourceId` names the value; call it `kerning_source_id`"
                        .to_string()
                ),
            ]
        );
    }

    #[test]
    fn a_generic_type_suffix_is_reported() {
        let found = findings("struct FontData; enum LoadState { A } struct Glyph; struct State;");
        let kinds: Vec<_> = found.into_iter().map(|(kind, _)| kind).collect();
        assert_eq!(kinds, [Kind::GenericSuffix, Kind::GenericSuffix]);
    }

    #[test]
    fn a_tuple_return_is_reported_bare_or_wrapped() {
        let found = findings(
            "fn shape() -> (Text, Option<String>) {}
             fn split() -> Result<(A, B), E> {}
             fn unit() -> () {}
             fn named() -> Result<Shaped, E> {}",
        );
        assert_eq!(
            found,
            [
                (
                    Kind::TupleReturn,
                    "shape returns a 2-tuple: name the type".to_string()
                ),
                (
                    Kind::TupleReturn,
                    "split returns a 2-tuple: name the type".to_string()
                ),
            ]
        );
    }

    #[test]
    fn an_id_accessor_that_clones_is_reported() {
        let found = findings(
            "impl Point {
                 pub fn id(&self) -> PointId { self.id.clone() }
                 pub fn source_id(&self) -> SourceId { self.source_id }
                 pub fn contour_id(&self) -> &ContourId { &self.contour_id }
             }",
        );
        assert_eq!(
            found,
            [(
                Kind::OwnedIdAccessor,
                "id clones the id on every call: return `&` it".to_string()
            )]
        );
    }
}
