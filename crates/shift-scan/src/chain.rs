use syn::Expr;

/// The method calls of one chain, outermost last: `a.iter().map(f).collect()`
/// is `iter`, `map`, `collect`. `?` and field access continue a chain.
pub(crate) struct MethodChain<'a> {
    pub(crate) methods: Vec<String>,
    /// Every receiver inside the chain, so the scan doesn't report it again.
    pub(crate) receivers: Vec<&'a Expr>,
}

impl<'a> MethodChain<'a> {
    pub(crate) fn of(outermost: &'a Expr) -> Self {
        let mut methods = Vec::new();
        let mut receivers = Vec::new();
        let mut expr = outermost;
        loop {
            let inner = match expr {
                Expr::MethodCall(call) => {
                    methods.push(call.method.to_string());
                    &*call.receiver
                }
                Expr::Try(attempt) => &*attempt.expr,
                Expr::Field(field) => &*field.base,
                _ => break,
            };
            receivers.push(inner);
            expr = inner;
        }
        methods.reverse();
        Self { methods, receivers }
    }

    pub(crate) fn steps(&self) -> usize {
        self.methods.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn methods(source: &str) -> Vec<String> {
        let expr: Expr = syn::parse_str(source).unwrap();
        MethodChain::of(&expr).methods
    }

    #[test]
    fn reads_calls_in_order_through_try_and_fields() {
        assert_eq!(
            methods("font.glyphs()?.iter().map(f).collect()"),
            ["glyphs", "iter", "map", "collect"]
        );
        assert_eq!(methods("self.layers.first().cloned()"), ["first", "cloned"]);
    }
}
