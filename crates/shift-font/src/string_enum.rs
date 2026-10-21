//! Enums whose variants each have one fixed name.

/// Declares an enum whose variants each have one fixed name, and derives
/// `ALL`, `as_str`, [`Display`](std::fmt::Display), and
/// [`FromStr`](std::str::FromStr) from that one list, so every name is
/// written once.
///
/// `parse_error` names the error type and builds it from the unrecognized
/// text.
///
/// ```
/// shift_font::string_enum! {
///     #[derive(Clone, Copy, Debug, PartialEq)]
///     pub enum Fruit {
///         Apple => "apple",
///         Pear => "pear",
///     }
///     parse_error: String = |text| format!("unknown fruit {text:?}");
/// }
///
/// assert_eq!(Fruit::Pear.as_str(), "pear");
/// assert_eq!("apple".parse::<Fruit>(), Ok(Fruit::Apple));
/// assert!("plum".parse::<Fruit>().is_err());
/// ```
#[macro_export]
macro_rules! string_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($(#[$variant_meta:meta])* $variant:ident => $text:literal,)+
        }
        parse_error: $error:ty = |$input:ident| $make_error:expr;
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$variant_meta])* $variant,)+
        }

        impl $name {
            /// Every variant, in declaration order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// The variant's name.
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text,)+
                }
            }
        }

        impl ::std::fmt::Display for $name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl ::std::str::FromStr for $name {
            type Err = $error;

            fn from_str($input: &str) -> ::std::result::Result<Self, Self::Err> {
                match $input {
                    $($text => Ok(Self::$variant),)+
                    _ => Err($make_error),
                }
            }
        }
    };
}
