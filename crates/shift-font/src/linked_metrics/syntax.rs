//! Parsing a metrics key's text into an expression.
//!
//! ```text
//! key    = "=" ["="] expr      -- "==" makes it local to this source
//!        | expr                -- bare Glyphs form, such as `n`
//! expr   = term   (("+" | "-") term)*
//! term   = factor (("*" | "/") factor)*
//! factor = "-" factor | atom
//! atom   = number | ref | "(" expr ")" | func "(" args ")"
//! ref    = ["|"] [name] ["@" ["-"] number]
//! func   = "lsb" | "rsb" | "width" | "min" | "max" | "round"
//! ```
//!
//! Glyph names may contain `-` (`A-cy`), which is also subtraction. A word is
//! a glyph name when the font has a glyph by that name; otherwise it is split
//! at its last `-` whose two sides both read as names or numbers, so `=A-cy`
//! is the glyph `A-cy` and `=n-10` is `n` minus ten. Parsing therefore takes
//! the font's glyph names.

use super::MetricsKeyError;
use crate::GlyphName;

/// A parsed metrics key.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedMetricsKey {
    pub scope: KeyScope,
    pub body: KeyBody,
}

/// Which sources a key was written for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyScope {
    /// `=…` or a bare key: every source.
    EverySource,
    /// `==…`: this source only.
    ThisSource,
}

impl KeyScope {
    /// The sources `text` is written for, read off its prefix alone.
    pub fn of(text: &str) -> Self {
        Self::split(text).0
    }

    /// The scope and the expression after its prefix.
    fn split(text: &str) -> (Self, &str) {
        let trimmed = text.trim();
        if let Some(rest) = trimmed.strip_prefix("==") {
            return (Self::ThisSource, rest);
        }
        if let Some(rest) = trimmed.strip_prefix('=') {
            return (Self::EverySource, rest);
        }
        (Self::EverySource, trimmed)
    }
}

/// What a key computes.
#[derive(Clone, Debug, PartialEq)]
pub enum KeyBody {
    Expr(Expr),
    /// `=+25` or `=-10`: an offset on Glyphs' automatic alignment, which
    /// Shift does not evaluate yet.
    AutoOffset(f64),
}

/// An arithmetic expression over glyph measurements.
#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Number(f64),
    Measure(Measure),
    Negate(Box<Self>),
    Binary {
        op: BinaryOp,
        left: Box<Self>,
        right: Box<Self>,
    },
    Call {
        function: Function,
        args: Vec<Self>,
    },
    Round(Box<Self>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
}

/// `min` and `max`, which take one or more values. `round` parses to
/// [`Expr::Round`], and the side functions to [`Measure`]s.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Function {
    Min,
    Max,
}

/// One measurement of a glyph.
#[derive(Clone, Debug, PartialEq)]
pub struct Measure {
    /// The glyph measured; `None` is the glyph the key belongs to.
    pub glyph: Option<GlyphName>,
    pub side: MeasureSide,
    /// Measure a sidebearing this far above the baseline, not at the
    /// outline's extreme.
    pub at: Option<f64>,
}

/// Which metric a [`Measure`] reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeasureSide {
    /// The metric the key sets: `n`.
    Same,
    /// The other sidebearing from the one the key sets: `|n`, `|`.
    Opposite,
    Left,
    Right,
    Width,
}

/// Parses `text` against a font whose glyph names `has_glyph` answers for.
///
/// # Errors
///
/// Returns [`MetricsKeyError::Syntax`] for text that is not a key and
/// [`MetricsKeyError::UnknownGlyph`] for a name the font has no glyph for.
pub fn parse(
    text: &str,
    has_glyph: &impl Fn(&str) -> bool,
) -> Result<ParsedMetricsKey, MetricsKeyError> {
    let (scope, body_text) = KeyScope::split(text);

    let tokens = tokenize(body_text, has_glyph)?;
    if let [sign @ (Token::Plus | Token::Minus), Token::Number(offset)] = tokens.as_slice() {
        let offset = if *sign == Token::Minus {
            -offset
        } else {
            *offset
        };
        return Ok(ParsedMetricsKey {
            scope,
            body: KeyBody::AutoOffset(offset),
        });
    }

    let mut parser = Parser { tokens, next: 0 };
    let expr = parser.expr()?;
    if let Some(token) = parser.peek() {
        return Err(syntax(format!("unexpected {token} after the expression")));
    }
    Ok(ParsedMetricsKey {
        scope,
        body: KeyBody::Expr(expr),
    })
}

fn syntax(message: impl Into<String>) -> MetricsKeyError {
    MetricsKeyError::Syntax(message.into())
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Name(String),
    Function(FunctionName),
    Plus,
    Minus,
    Star,
    Slash,
    Bar,
    At,
    Comma,
    Open,
    Close,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FunctionName {
    Lsb,
    Rsb,
    Width,
    Min,
    Max,
    Round,
}

impl FunctionName {
    const ALL: [Self; 6] = [
        Self::Lsb,
        Self::Rsb,
        Self::Width,
        Self::Min,
        Self::Max,
        Self::Round,
    ];

    fn as_str(self) -> &'static str {
        match self {
            Self::Lsb => "lsb",
            Self::Rsb => "rsb",
            Self::Width => "width",
            Self::Min => "min",
            Self::Max => "max",
            Self::Round => "round",
        }
    }

    fn parse(word: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|function| function.as_str() == word)
    }
}

impl std::fmt::Display for Token {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(value) => write!(formatter, "`{value}`"),
            Self::Name(name) => write!(formatter, "`{name}`"),
            Self::Function(function) => write!(formatter, "`{}`", function.as_str()),
            Self::Plus => formatter.write_str("`+`"),
            Self::Minus => formatter.write_str("`-`"),
            Self::Star => formatter.write_str("`*`"),
            Self::Slash => formatter.write_str("`/`"),
            Self::Bar => formatter.write_str("`|`"),
            Self::At => formatter.write_str("`@`"),
            Self::Comma => formatter.write_str("`,`"),
            Self::Open => formatter.write_str("`(`"),
            Self::Close => formatter.write_str("`)`"),
        }
    }
}

fn is_name_start(character: char) -> bool {
    character.is_alphabetic() || character == '_'
}

fn is_name_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '.' | '-')
}

fn tokenize(text: &str, has_glyph: &impl Fn(&str) -> bool) -> Result<Vec<Token>, MetricsKeyError> {
    let mut tokens = Vec::new();
    let mut rest = text;
    while let Some(character) = rest.chars().next() {
        if character.is_whitespace() {
            rest = &rest[character.len_utf8()..];
            continue;
        }

        if character.is_ascii_digit() || character == '.' {
            let length = rest
                .find(|c: char| !(c.is_ascii_digit() || c == '.'))
                .unwrap_or(rest.len());
            tokens.push(Token::Number(number(&rest[..length])?));
            rest = &rest[length..];
            continue;
        }

        if is_name_start(character) {
            let length = rest.find(|c: char| !is_name_char(c)).unwrap_or(rest.len());
            let word = &rest[..length];
            rest = &rest[length..];
            let calls = rest.trim_start().starts_with('(');
            tokens.extend(word_tokens(word, calls, has_glyph)?);
            continue;
        }

        let token = match character {
            '+' => Token::Plus,
            '-' => Token::Minus,
            '*' => Token::Star,
            '/' => Token::Slash,
            '|' => Token::Bar,
            '@' => Token::At,
            ',' => Token::Comma,
            '(' => Token::Open,
            ')' => Token::Close,
            _ => return Err(syntax(format!("unexpected `{character}`"))),
        };
        tokens.push(token);
        rest = &rest[character.len_utf8()..];
    }
    Ok(tokens)
}

fn number(text: &str) -> Result<f64, MetricsKeyError> {
    text.parse()
        .map_err(|_| syntax(format!("`{text}` is not a number")))
}

/// The tokens a word stands for: a glyph name, a function when `calls`, or
/// pieces joined by subtraction when the word itself is neither.
fn word_tokens(
    word: &str,
    calls: bool,
    has_glyph: &impl Fn(&str) -> bool,
) -> Result<Vec<Token>, MetricsKeyError> {
    split_word(word, calls, has_glyph).ok_or_else(|| {
        if calls {
            syntax(format!("`{word}` is not a function"))
        } else {
            MetricsKeyError::UnknownGlyph(word.to_owned())
        }
    })
}

fn split_word(word: &str, calls: bool, has_glyph: &impl Fn(&str) -> bool) -> Option<Vec<Token>> {
    if let Some(token) = whole_word(word, calls, has_glyph) {
        return Some(vec![token]);
    }

    word.rmatch_indices('-').find_map(|(index, _)| {
        let (left, right) = (&word[..index], &word[index + 1..]);
        let left = split_word(left, false, has_glyph)?;
        let right = split_word(right, calls, has_glyph)?;
        Some(
            left.into_iter()
                .chain([Token::Minus])
                .chain(right)
                .collect(),
        )
    })
}

fn whole_word(word: &str, calls: bool, has_glyph: &impl Fn(&str) -> bool) -> Option<Token> {
    if word.is_empty() {
        return None;
    }
    if calls {
        return FunctionName::parse(word).map(Token::Function);
    }
    if has_glyph(word) {
        return Some(Token::Name(word.to_owned()));
    }
    // A split leaves digits on the right of a `-`, as in `n-10`.
    if !word.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    word.parse().ok().map(Token::Number)
}

struct Parser {
    tokens: Vec<Token>,
    next: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.next)
    }

    fn take(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.next).cloned();
        self.next += 1;
        token
    }

    fn eat(&mut self, expected: &Token) -> bool {
        if self.peek() != Some(expected) {
            return false;
        }
        self.next += 1;
        true
    }

    fn expect(&mut self, expected: &Token) -> Result<(), MetricsKeyError> {
        if self.eat(expected) {
            return Ok(());
        }
        Err(match self.peek() {
            Some(found) => syntax(format!("expected {expected}, found {found}")),
            None => syntax(format!("expected {expected} at the end")),
        })
    }

    fn expr(&mut self) -> Result<Expr, MetricsKeyError> {
        let mut left = self.term()?;
        loop {
            let op = match self.peek() {
                Some(Token::Plus) => BinaryOp::Add,
                Some(Token::Minus) => BinaryOp::Subtract,
                _ => return Ok(left),
            };
            self.next += 1;
            left = Expr::binary(op, left, self.term()?);
        }
    }

    fn term(&mut self) -> Result<Expr, MetricsKeyError> {
        let mut left = self.factor()?;
        loop {
            let op = match self.peek() {
                Some(Token::Star) => BinaryOp::Multiply,
                Some(Token::Slash) => BinaryOp::Divide,
                _ => return Ok(left),
            };
            self.next += 1;
            left = Expr::binary(op, left, self.factor()?);
        }
    }

    fn factor(&mut self) -> Result<Expr, MetricsKeyError> {
        if self.eat(&Token::Minus) {
            return Ok(Expr::Negate(Box::new(self.factor()?)));
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Expr, MetricsKeyError> {
        if matches!(self.peek(), Some(Token::Name(_))) {
            return self.reference(MeasureSide::Same);
        }
        match self.take() {
            Some(Token::Number(value)) => Ok(Expr::Number(value)),
            Some(Token::Open) => {
                let inner = self.expr()?;
                self.expect(&Token::Close)?;
                Ok(inner)
            }
            Some(Token::Bar) => self.reference(MeasureSide::Opposite),
            Some(Token::Function(function)) => self.call(function),
            Some(token) => Err(syntax(format!("unexpected {token}"))),
            None => Err(syntax("expected a value")),
        }
    }

    /// A reference after any `|`: an optional glyph name, then an optional
    /// `@` height.
    fn reference(&mut self, side: MeasureSide) -> Result<Expr, MetricsKeyError> {
        let glyph = match self.peek() {
            Some(Token::Name(name)) => {
                let name = GlyphName::from(name.as_str());
                self.next += 1;
                Some(name)
            }
            _ => None,
        };
        let at = self.height()?;
        Ok(Expr::Measure(Measure { glyph, side, at }))
    }

    fn height(&mut self) -> Result<Option<f64>, MetricsKeyError> {
        if !self.eat(&Token::At) {
            return Ok(None);
        }
        let sign = if self.eat(&Token::Minus) { -1.0 } else { 1.0 };
        match self.take() {
            Some(Token::Number(value)) => Ok(Some(sign * value)),
            _ => Err(syntax("expected a height after `@`")),
        }
    }

    fn call(&mut self, function: FunctionName) -> Result<Expr, MetricsKeyError> {
        self.expect(&Token::Open)?;
        let side = match function {
            FunctionName::Lsb => Some(MeasureSide::Left),
            FunctionName::Rsb => Some(MeasureSide::Right),
            FunctionName::Width => Some(MeasureSide::Width),
            FunctionName::Min | FunctionName::Max | FunctionName::Round => None,
        };

        if let Some(side) = side {
            let glyph = match self.take() {
                Some(Token::Name(name)) => GlyphName::from(name.as_str()),
                _ => {
                    return Err(syntax(format!(
                        "`{}` takes a glyph name",
                        function.as_str()
                    )));
                }
            };
            let at = self.height()?;
            self.expect(&Token::Close)?;
            return Ok(Expr::Measure(Measure {
                glyph: Some(glyph),
                side,
                at,
            }));
        }

        let mut args = vec![self.expr()?];
        while self.eat(&Token::Comma) {
            args.push(self.expr()?);
        }
        self.expect(&Token::Close)?;
        let function = match function {
            FunctionName::Min => Function::Min,
            FunctionName::Max => Function::Max,
            _ => {
                let [value] =
                    <[Expr; 1]>::try_from(args).map_err(|_| syntax("`round` takes one value"))?;
                return Ok(Expr::Round(Box::new(value)));
            }
        };
        Ok(Expr::Call { function, args })
    }
}

impl Expr {
    fn binary(op: BinaryOp, left: Self, right: Self) -> Self {
        Self::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        }
    }
}

/// Every glyph name `text` might mean, read without the font: each word,
/// and each run of its `-`-separated pieces, so `=A-cy-10` gives `A-cy-10`,
/// `A-cy`, `A`, `cy-10`, `cy` and `10`. Parsing picks among these; this
/// over-approximates it, for finding the keys an edit may affect cheaply.
pub(super) fn candidate_names(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !is_name_char(c))
        .filter(|word| word.starts_with(is_name_start))
        .flat_map(hyphen_runs)
}

/// Each run of `word`'s `-`-separated pieces, the whole word included.
fn hyphen_runs(word: &str) -> Vec<&str> {
    let hyphens: Vec<usize> = word.match_indices('-').map(|(index, _)| index).collect();
    let starts = std::iter::once(0).chain(hyphens.iter().map(|index| index + 1));
    let ends: Vec<usize> = hyphens.iter().copied().chain([word.len()]).collect();
    starts
        .flat_map(|start| {
            ends.iter()
                .filter(move |&&end| end > start)
                .map(move |&end| &word[start..end])
        })
        .collect()
}
