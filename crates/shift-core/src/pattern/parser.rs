pub const TOKEN_NO_POINT: char = 'N';
pub const TOKEN_CORNER: char = 'C';
pub const TOKEN_HANDLE: char = 'H';
pub const TOKEN_SMOOTH: char = 'S';
pub const TOKEN_SELECTED: char = '@';
pub const TOKEN_ANY: char = 'X';
pub const TOKEN_SET_START: char = '[';
pub const TOKEN_SET_END: char = ']';

const ALL_POINT_TOKENS: &[char] = &[TOKEN_NO_POINT, TOKEN_CORNER, TOKEN_SMOOTH, TOKEN_HANDLE];

pub struct PatternParser;

impl PatternParser {
    pub fn new() -> Self {
        Self
    }

    fn cartesian_product(sets: &[Vec<char>]) -> Vec<String> {
        if sets.is_empty() {
            return vec![String::new()];
        }

        let mut result = vec![String::new()];

        for set in sets {
            let mut new_result = Vec::new();
            for prefix in &result {
                for &ch in set {
                    let mut s = prefix.clone();
                    s.push(ch);
                    new_result.push(s);
                }
            }
            result = new_result;
        }

        result
    }

    fn parse_set(&self, pattern: &str, start_index: usize) -> (Vec<char>, usize) {
        let mut set = Vec::new();
        let chars: Vec<char> = pattern.chars().collect();
        let mut i = start_index + 1; // Skip the opening bracket

        while i < chars.len() && chars[i] != TOKEN_SET_END {
            if chars[i] == TOKEN_ANY {
                set.extend(ALL_POINT_TOKENS);
            } else {
                set.push(chars[i]);
            }
            i += 1;
        }

        (set, i + 1) // +1 to skip the closing bracket
    }

    pub fn expand(&self, pattern: &str) -> Vec<String> {
        let mut sets: Vec<Vec<char>> = Vec::new();
        let chars: Vec<char> = pattern.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            match chars[i] {
                TOKEN_SET_START => {
                    let (set, new_index) = self.parse_set(pattern, i);
                    if set.is_empty() {
                        return vec![];
                    }
                    sets.push(set);
                    i = new_index;
                }
                TOKEN_ANY => {
                    sets.push(ALL_POINT_TOKENS.to_vec());
                    i += 1;
                }
                ch => {
                    sets.push(vec![ch]);
                    i += 1;
                }
            }
        }

        Self::cartesian_product(&sets)
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect()
    }
}

impl Default for PatternParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_simple_pattern() {
        let parser = PatternParser::new();
        let result = parser.expand("NCH");
        assert_eq!(result, vec!["NCH"]);
    }

    #[test]
    fn expand_set_pattern() {
        let parser = PatternParser::new();
        let mut result = parser.expand("[CS]H");
        result.sort();
        assert_eq!(result, vec!["CH", "SH"]);
    }

    #[test]
    fn expand_any_token() {
        let parser = PatternParser::new();
        let mut result = parser.expand("XH");
        result.sort();
        assert_eq!(result, vec!["CH", "HH", "NH", "SH"]);
    }

    #[test]
    fn expand_complex_pattern() {
        let parser = PatternParser::new();
        let result = parser.expand("[X@][CS]H");
        assert_eq!(result.len(), 10); // (N, C, S, H, @) * (C, S) = 10
        assert!(result.contains(&"NCH".to_string()));
        assert!(result.contains(&"@SH".to_string()));
    }

    #[test]
    fn expand_multiple_sets() {
        let parser = PatternParser::new();
        let result = parser.expand("H[CS]H");
        assert_eq!(result.len(), 2);
        assert!(result.contains(&"HCH".to_string()));
        assert!(result.contains(&"HSH".to_string()));
    }

    #[test]
    fn expand_five_point_pattern() {
        let parser = PatternParser::new();
        let result = parser.expand("HS[HC][@X][@X]");
        assert!(!result.is_empty());
        assert!(result.contains(&"HSHNN".to_string()));
        assert!(result.contains(&"HSH@C".to_string()));
    }
}
