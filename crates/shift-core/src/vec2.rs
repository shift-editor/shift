use std::ops::{Add, Mul, Neg, Sub};

use crate::point::Point;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn length(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn length_squared(&self) -> f64 {
        self.x * self.x + self.y * self.y
    }

    pub fn normalize(&self) -> Self {
        let len = self.length();
        if len < 1e-10 {
            *self
        } else {
            Self {
                x: self.x / len,
                y: self.y / len,
            }
        }
    }

    pub fn dot(&self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }

    pub fn distance(&self, other: Self) -> f64 {
        (*self - other).length()
    }
}

impl From<(f64, f64)> for Vec2 {
    fn from((x, y): (f64, f64)) -> Self {
        Self { x, y }
    }
}

impl From<Vec2> for (f64, f64) {
    fn from(v: Vec2) -> Self {
        (v.x, v.y)
    }
}

impl From<&Point> for Vec2 {
    fn from(p: &Point) -> Self {
        Self { x: p.x(), y: p.y() }
    }
}

impl Add for Vec2 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl Sub for Vec2 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

impl Mul<f64> for Vec2 {
    type Output = Self;
    fn mul(self, scalar: f64) -> Self {
        Self {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

impl Neg for Vec2 {
    type Output = Self;
    fn neg(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_length() {
        let v = Vec2::new(3.0, 4.0);
        assert!((v.length() - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_normalize() {
        let v = Vec2::new(3.0, 4.0);
        let n = v.normalize();
        assert!((n.length() - 1.0).abs() < 1e-10);
        assert!((n.x - 0.6).abs() < 1e-10);
        assert!((n.y - 0.8).abs() < 1e-10);
    }

    #[test]
    fn test_normalize_zero_vector() {
        let v = Vec2::ZERO;
        let n = v.normalize();
        assert_eq!(n, Vec2::ZERO);
    }

    #[test]
    fn test_dot() {
        let a = Vec2::new(1.0, 0.0);
        let b = Vec2::new(0.0, 1.0);
        assert!((a.dot(b)).abs() < 1e-10);

        let c = Vec2::new(1.0, 0.0);
        let d = Vec2::new(-1.0, 0.0);
        assert!((c.dot(d) - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn test_distance() {
        let a = Vec2::new(0.0, 0.0);
        let b = Vec2::new(3.0, 4.0);
        assert!((a.distance(b) - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_operators() {
        let a = Vec2::new(1.0, 2.0);
        let b = Vec2::new(3.0, 4.0);

        let sum = a + b;
        assert_eq!(sum, Vec2::new(4.0, 6.0));

        let diff = b - a;
        assert_eq!(diff, Vec2::new(2.0, 2.0));

        let scaled = a * 2.0;
        assert_eq!(scaled, Vec2::new(2.0, 4.0));

        let neg = -a;
        assert_eq!(neg, Vec2::new(-1.0, -2.0));
    }

    #[test]
    fn test_tuple_conversion() {
        let tuple = (3.0, 4.0);
        let v: Vec2 = tuple.into();
        assert_eq!(v, Vec2::new(3.0, 4.0));

        let back: (f64, f64) = v.into();
        assert_eq!(back, tuple);
    }
}
