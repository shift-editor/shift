//! Kerning inspection over any font source the loader reads.
//!
//! Reads answer from Shift's kerning model: authored pairs and groups as
//! stored, and glyph pairs resolved the way export compiles them. Edits live
//! in the authoring module and go through semantic intents.

use std::collections::BTreeMap;
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, miette};
use shift_backends::font_loader::FontLoader;
use shift_font::variation::map_location;
use shift_font::{Font, GlyphId, KerningPair, KerningPosition, KerningSide, Location, Source};

use crate::authoring::{resolve_glyph_id, resolve_source_id};
use crate::cli::{GetKerningArgs, KerningGroupsArgs, ListKerningArgs};
use crate::glyph_inspect::parse_location;

mod report;
pub(crate) mod selector;

use report::{
    AxisValue, GlyphReference, GlyphSides, KerningOrigin, KerningRule, LocationKerning,
    MasterKerning, PairRow, SourceReference,
};
pub(crate) use report::{GroupReport, PairReport, SideReport};
pub use report::{KerningGroupsReport, KerningListReport, KerningResolutionReport};

/// Lists authored pairs with one value per master.
///
/// Without `--source`, the columns are the masters that author kerning, in
/// source order. With `--glyph`, only pairs whose sides are that glyph or one
/// of its groups are listed. Rows are ordered by their sides' names.
///
/// # Errors
///
/// Reports unreadable fonts and unresolved source or glyph selectors.
pub fn list_kerning(args: ListKerningArgs) -> Result<KerningListReport> {
    let font = read_font(&args.path)?;
    let kerning = font.kerning();
    let sources = match args.source.as_deref() {
        Some(selector) => {
            let source_id = resolve_source_id(&font, selector)?;
            vec![
                font.source(&source_id)
                    .ok_or_else(|| miette!("source does not exist"))?,
            ]
        }
        None => font
            .sources()
            .iter()
            .filter(|source| kerning.source(&source.id()).is_some())
            .collect(),
    };
    let glyph_sides = args
        .glyph
        .as_deref()
        .map(|selector| GlyphFilter::new(&font, selector))
        .transpose()?;

    let mut rows = BTreeMap::<(String, String), (KerningPair, Vec<Option<f64>>)>::new();
    for (column, source) in sources.iter().enumerate() {
        let Some(source_kerning) = kerning.source(&source.id()) else {
            continue;
        };
        for (pair, value) in source_kerning.pairs() {
            if glyph_sides
                .as_ref()
                .is_some_and(|filter| !filter.matches(pair))
            {
                continue;
            }
            let report = PairReport::from_pair(&font, pair);
            let key = (report.first.label(), report.second.label());
            let (_, values) = rows
                .entry(key)
                .or_insert_with(|| (pair.clone(), vec![None; sources.len()]));
            values[column] = Some(value);
        }
    }

    Ok(KerningListReport {
        document: args.path,
        sources: sources
            .iter()
            .map(|source| source_reference(source))
            .collect(),
        pairs: rows
            .into_values()
            .map(|(pair, values)| PairRow {
                pair: PairReport::from_pair(&font, &pair),
                values,
            })
            .collect(),
    })
}

/// Lists kerning groups, first-position groups before second, each by name.
///
/// # Errors
///
/// Reports unreadable fonts.
pub fn kerning_groups(args: KerningGroupsArgs) -> Result<KerningGroupsReport> {
    let font = read_font(&args.path)?;
    let position = args.position.map(KerningPosition::from);
    let mut groups = font
        .kerning()
        .all_groups()
        .filter(|(_, group)| position.is_none_or(|position| group.position == position))
        .map(|(group_id, group)| GroupReport::from_group(&font, group_id, group))
        .collect::<Vec<_>>();
    groups.sort_by(|a, b| (a.position, &a.name).cmp(&(b.position, &b.name)));

    Ok(KerningGroupsReport {
        document: args.path,
        groups,
    })
}

/// Resolves the kerning between two glyphs at every master, and at a
/// location when one is given.
///
/// A master that authors the pair reports its value and the pair that
/// supplied it. A master that authors other pairs kerns zero. A master that
/// authors no kerning reports the blend of the masters that do, matching the
/// compiled font.
///
/// # Errors
///
/// Reports unreadable fonts, unresolved glyphs, and invalid locations.
pub fn get_kerning(args: GetKerningArgs) -> Result<KerningResolutionReport> {
    let font = read_font(&args.path)?;
    let first = resolve_glyph_id(&font, &args.first)?;
    let second = resolve_glyph_id(&font, &args.second)?;

    let masters = font
        .masters()
        .map(|source| master_kerning(&font, source, &first, &second))
        .collect::<Result<Vec<_>>>()?;
    let location = if args.location.is_empty() {
        None
    } else {
        Some(location_kerning(&font, &args.location, &first, &second)?)
    };

    Ok(KerningResolutionReport {
        document: args.path,
        first: glyph_sides(&font, KerningPosition::First, &first),
        second: glyph_sides(&font, KerningPosition::Second, &second),
        masters,
        location,
    })
}

fn read_font(path: &Path) -> Result<Font> {
    let path_text = path
        .to_str()
        .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
    FontLoader::new()
        .read_font(path_text)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to load font {}", path.display()))
}

fn source_reference(source: &Source) -> SourceReference {
    SourceReference {
        source_id: source.id().to_string(),
        name: source.name().to_string(),
    }
}

fn glyph_sides(font: &Font, position: KerningPosition, glyph_id: &GlyphId) -> GlyphSides {
    GlyphSides {
        glyph: GlyphReference::from_id(font, glyph_id),
        group: font
            .kerning()
            .group_of(position, glyph_id)
            .map(|group_id| SideReport::from_side(font, &KerningSide::Group(group_id.clone()))),
    }
}

fn master_kerning(
    font: &Font,
    source: &Source,
    first: &GlyphId,
    second: &GlyphId,
) -> Result<MasterKerning> {
    let source_id = source.id();
    let kerning = font.kerning();
    if let Some(resolved) = kerning.resolve(&source_id, first, second) {
        let rule = match (&resolved.pair.first, &resolved.pair.second) {
            (KerningSide::Glyph(_), KerningSide::Glyph(_)) => KerningRule::Glyph,
            (KerningSide::Group(_), KerningSide::Group(_)) => KerningRule::Group,
            _ => KerningRule::Exception,
        };
        return Ok(MasterKerning {
            source: source_reference(source),
            value: resolved.value,
            origin: KerningOrigin::Authored,
            rule,
            pair: Some(PairReport::from_pair(font, &resolved.pair)),
        });
    }

    let in_basis = kerning.source(&source_id).is_some()
        || font.default_source_id().as_ref() == Some(&source_id);
    let (value, origin) = if in_basis {
        (0.0, KerningOrigin::Unkerned)
    } else {
        let value = font
            .kerning_at(source.location(), first, second)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to interpolate kerning at {}", source.name()))?;
        (value, KerningOrigin::Interpolated)
    };
    Ok(MasterKerning {
        source: source_reference(source),
        value,
        origin,
        rule: KerningRule::None,
        pair: None,
    })
}

fn location_kerning(
    font: &Font,
    coordinates: &[String],
    first: &GlyphId,
    second: &GlyphId,
) -> Result<LocationKerning> {
    let external = parse_location(font, coordinates)?;
    let design = map_location(&external, font.axes(), font.axis_mappings())
        .into_diagnostic()
        .wrap_err("failed to map the external location into design space")?;
    let value = font
        .kerning_at(&design, first, second)
        .into_diagnostic()
        .wrap_err("failed to resolve kerning at the requested location")?;

    Ok(LocationKerning {
        external: axis_values(font, external.as_untyped()),
        design: axis_values(font, design.as_untyped()),
        value,
    })
}

fn axis_values(font: &Font, location: &Location) -> Vec<AxisValue> {
    font.axes()
        .iter()
        .map(|axis| AxisValue {
            axis_tag: axis.tag().to_string(),
            value: location.get(&axis.id()).unwrap_or(axis.default()),
        })
        .collect()
}

/// Matches pairs whose sides are one glyph or a group holding it.
struct GlyphFilter {
    glyph: GlyphId,
    first_group: Option<KerningSide>,
    second_group: Option<KerningSide>,
}

impl GlyphFilter {
    fn new(font: &Font, selector: &str) -> Result<Self> {
        let glyph = resolve_glyph_id(font, selector)?;
        let group = |position| {
            font.kerning()
                .group_of(position, &glyph)
                .map(|group_id| KerningSide::Group(group_id.clone()))
        };
        Ok(Self {
            first_group: group(KerningPosition::First),
            second_group: group(KerningPosition::Second),
            glyph,
        })
    }

    fn matches(&self, pair: &KerningPair) -> bool {
        let is_glyph =
            |side: &KerningSide| matches!(side, KerningSide::Glyph(id) if *id == self.glyph);
        is_glyph(&pair.first)
            || is_glyph(&pair.second)
            || self.first_group.as_ref() == Some(&pair.first)
            || self.second_group.as_ref() == Some(&pair.second)
    }
}
