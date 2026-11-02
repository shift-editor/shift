//! A `collect` that names `Vec` where the type is already fixed: a struct
//! field, a call argument, a function's tail or `return`, or the receiver of
//! `.into_boxed_slice()`. There, plain `.collect()` (or collecting straight
//! into `Box<[_]>`) says the same with less.
//!
//! A `let` binding and a chain that goes on (`.join(", ")`) need the
//! turbofish, and are not reported.

use syn::{Expr, ExprMethodCall, GenericArgument, Type};

/// Where a turbofished `collect` was found.
#[derive(Clone, Copy)]
pub(crate) enum KnownType {
    Field,
    Argument,
    Returned,
    Boxed,
}

impl KnownType {
    pub(crate) fn describe(self) -> &'static str {
        match self {
            Self::Field => "as a field, whose type `collect()` infers",
            Self::Argument => "as an argument, whose type `collect()` infers",
            Self::Returned => "as the return value, whose type `collect()` infers",
            Self::Boxed => "only to call `into_boxed_slice`: collect into `Box<[_]>`",
        }
    }
}

/// A turbofished `collect` at a position whose type is known.
pub(crate) struct Turbofish<'a> {
    pub(crate) call: &'a ExprMethodCall,
    pub(crate) known: KnownType,
}

/// The turbofished `collect`s directly inside `expr` at a position whose
/// type is known. `?` hides the type from inference, so it is followed
/// only to `into_boxed_slice`.
pub(crate) fn redundant_turbofish(expr: &Expr) -> Vec<Turbofish<'_>> {
    let positions: Vec<(&Expr, KnownType)> = match expr {
        Expr::Struct(literal) => literal
            .fields
            .iter()
            .map(|field| (&field.expr, KnownType::Field))
            .collect(),
        Expr::Call(call) => call
            .args
            .iter()
            .map(|argument| (argument, KnownType::Argument))
            .collect(),
        Expr::MethodCall(call) if call.method == "into_boxed_slice" => {
            let receiver = match &*call.receiver {
                Expr::Try(attempt) => &*attempt.expr,
                receiver => receiver,
            };
            vec![(receiver, KnownType::Boxed)]
        }
        Expr::MethodCall(call) => call
            .args
            .iter()
            .map(|argument| (argument, KnownType::Argument))
            .collect(),
        Expr::Return(returned) => returned
            .expr
            .iter()
            .map(|value| (&**value, KnownType::Returned))
            .collect(),
        _ => Vec::new(),
    };
    positions
        .into_iter()
        .filter_map(|(value, known)| {
            Some(Turbofish {
                call: collects_vec(value)?,
                known,
            })
        })
        .collect()
}

/// The turbofished `collect` a function body ends with, if any.
pub(crate) fn redundant_tail(block: &syn::Block) -> Option<&ExprMethodCall> {
    match block.stmts.last()? {
        syn::Stmt::Expr(tail, None) => collects_vec(tail),
        _ => None,
    }
}

/// `expr` as a `collect::<Vec<…>>()` or `collect::<Result<Vec<…>, …>>()`.
fn collects_vec(expr: &Expr) -> Option<&ExprMethodCall> {
    let Expr::MethodCall(call) = expr else {
        return None;
    };
    let target = call.turbofish.as_ref()?.args.first()?;
    let GenericArgument::Type(target) = target else {
        return None;
    };
    (call.method == "collect" && names_vec(target)).then_some(call)
}

/// `Vec<…>` or `Result<Vec<…>, …>`.
fn names_vec(ty: &Type) -> bool {
    let Type::Path(path) = ty else {
        return false;
    };
    let Some(last) = path.path.segments.last() else {
        return false;
    };
    if last.ident == "Vec" {
        return true;
    }
    let syn::PathArguments::AngleBracketed(arguments) = &last.arguments else {
        return false;
    };
    last.ident == "Result"
        && matches!(arguments.args.first(), Some(GenericArgument::Type(ok)) if names_vec(ok))
}
