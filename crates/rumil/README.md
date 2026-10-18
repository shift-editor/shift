# rumil

Lay out [MathML Core](https://www.w3.org/TR/mathml-core/) formulas from OpenType MATH data, and record why each glyph is placed.

The input is a formula tree and the output is a display list of glyphs and rules; applications render it themselves. MATH data and glyph metrics come through a trait, so layout can run on a compiled font or on live editor data.

The name comes from Rúmil, the Elf in Tolkien's legendarium who devised the first letters, made for speech and song, for graving on metal or stone, and for brush and pen. The items of a formula follow *The TeXbook*, where Knuth calls the items of a math list "noads".

The project is incubating in the [Shift](https://github.com/shift-editor/shift) monorepo and is not usable yet. It does not depend on Shift.

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.
