//! Slug atlases, as the utility process prepares them for the window's GPU:
//! a generation of packed curves built natively, described here, and then
//! streamed in chunks by the napi stream exports.

use std::time::Instant;

use pack::Pack;
use shift_backends::{
  GlyphIndex, OpenedFont, SourceAtlasDescriptor, build_binary_atlas_page, variable_glyph_inputs,
};
use shift_font::{GlyphId, SourceId};
use shift_slug::length::OrOverflow;
use shift_slug::{
  AuthoredAtlas, Section, VariableAtlas, VariableLayout, build_authored_atlas_page_profiled,
  build_authored_atlas_profiled, retained::compile_page as compile_retained_page,
};
use shift_wire::InterpolationBasis;
use shift_workspace::AcquireScope;

use super::{Bridge, SlugAtlasGeneration, SourceIdentity, log_slug_atlas_profile};
use crate::errors::{BridgeError, BridgeResult, through_bridge_error};

/// The Slug atlases the utility process prepares, from the open workspace or
/// the retained font source. A prepared generation stays native until the
/// stream export for it sends its packed bytes; preparing another replaces it.
#[pack::interface]
pub(crate) trait NativeAtlas {
  /// Builds one complete authored generation of the open workspace's font,
  /// without resolving a location, and describes it.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open, its layers cannot be loaded, or the
  /// atlas cannot be built.
  fn prepare_slug_atlas(&mut self, alignment: u32) -> Result<SlugAtlas, NativeAtlasError>;

  /// The durable authored revision that addresses cached atlas pages.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or its store cannot be read.
  fn slug_atlas_cache_revision(&self) -> Result<String, NativeAtlasError>;

  /// Builds one page: `glyph_ids` in order, with the geometry of every
  /// component they use, in the same packed layout as a complete atlas, so
  /// the window can make its viewport resident first.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open, a glyph cannot be loaded, or the page
  /// cannot be built.
  fn prepare_slug_atlas_page(
    &mut self,
    glyph_ids: Vec<GlyphId>,
    alignment: u32,
  ) -> Result<SlugAtlas, NativeAtlasError>;

  /// Releases a prepared generation the window rejected; nothing for any
  /// other generation.
  fn discard_slug_atlas(&mut self, generation: u32);

  /// Releases a prepared page the window rejected.
  fn discard_slug_atlas_page(&mut self, generation: u32);

  /// Builds one catalog page of the retained font source, its weights
  /// evaluated at `coordinates`, one per source axis.
  ///
  /// # Errors
  ///
  /// Fails when no font source is open, a glyph is not in it, or the page
  /// cannot be built.
  fn prepare_source_atlas_page(
    &mut self,
    page_index: u32,
    glyph_ids: Vec<GlyphId>,
    coordinates: Vec<f64>,
    alignment: u32,
  ) -> Result<CatalogAtlasPage, NativeAtlasError>;

  /// Releases a rejected source page and its weight descriptor.
  fn discard_source_atlas_page(&mut self, page_index: u32, generation: u32);

  /// Every resident source page's weights, evaluated at `coordinates`.
  ///
  /// # Errors
  ///
  /// Fails when no font source is open or a page's weights cannot be
  /// evaluated.
  fn source_atlas_weights(
    &self,
    coordinates: Vec<f64>,
  ) -> Result<Vec<CatalogAtlasWeights>, NativeAtlasError>;
}

/// Why a [`NativeAtlas`] request failed. Every variant carries the Rust error's
/// text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub(crate) enum NativeAtlasError {
  /// The request builds from the open workspace, and none is open.
  #[error("{detail}")]
  NoWorkspace { detail: String },

  /// The request builds from the retained font source, and none is open.
  #[error("{detail}")]
  NoFontSource { detail: String },

  /// The request named something malformed or missing. `detail` is the
  /// error's text.
  #[error("{detail}")]
  InvalidInput { detail: String },

  /// The atlas or the font it is built from failed. `detail` is the error's
  /// text: the error itself cannot cross the boundary.
  #[error("{detail}")]
  Failed { detail: String },
}

impl From<BridgeError> for NativeAtlasError {
  fn from(error: BridgeError) -> Self {
    let detail = error.to_string();
    match error {
      BridgeError::NoWorkspace => Self::NoWorkspace { detail },
      BridgeError::NoFontSource => Self::NoFontSource { detail },
      BridgeError::InvalidInput { .. } | BridgeError::Wire(_) => Self::InvalidInput { detail },
      _ => Self::Failed { detail },
    }
  }
}

through_bridge_error!(NativeAtlasError);

/// Where one section of a packed atlas starts, and how long it is, in bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pack)]
pub(crate) struct SlugSection {
  pub offset: u32,
  pub length: u32,
}

impl TryFrom<Section> for SlugSection {
  type Error = BridgeError;

  fn try_from(section: Section) -> BridgeResult<Self> {
    Ok(Self {
      offset: u32::try_from(section.offset).or_overflow()?,
      length: u32::try_from(section.length).or_overflow()?,
    })
  }
}

/// The sections of a packed atlas, in the order its bytes stream.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct SlugLayout {
  pub base_curves: SlugSection,
  pub curve_deltas: SlugSection,
  pub sparse_deltas: SlugSection,
  pub glyphs: SlugSection,
  pub sources: SlugSection,
  pub source_advances: SlugSection,
  pub component_glyphs: SlugSection,
  pub component_parts: SlugSection,
  pub components: SlugSection,
  pub component_sources: SlugSection,
  pub line_bits: SlugSection,
  pub total_length: u32,
}

impl TryFrom<VariableLayout> for SlugLayout {
  type Error = BridgeError;

  fn try_from(layout: VariableLayout) -> BridgeResult<Self> {
    Ok(Self {
      base_curves: layout.base_curves.try_into()?,
      curve_deltas: layout.curve_deltas.try_into()?,
      sparse_deltas: layout.sparse_deltas.try_into()?,
      glyphs: layout.glyphs.try_into()?,
      sources: layout.sources.try_into()?,
      source_advances: layout.source_advances.try_into()?,
      component_glyphs: layout.component_glyphs.try_into()?,
      component_parts: layout.component_parts.try_into()?,
      components: layout.components.try_into()?,
      component_sources: layout.component_sources.try_into()?,
      line_bits: layout.line_bits.try_into()?,
      total_length: u32::try_from(layout.total_length).or_overflow()?,
    })
  }
}

/// A source whose authored shape a glyph uses exactly, rather than an
/// interpolated one.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct SlugExactSource {
  pub source_id: SourceId,
  pub glyph_index: u32,
}

/// One root glyph in an atlas: where its default shape is, and its exact
/// sources.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct SlugGlyph {
  pub glyph_id: GlyphId,
  pub default_glyph: u32,
  pub exact_sources: Vec<SlugExactSource>,
}

/// One interpolation basis an atlas evaluates, and where its sources'
/// weights sit in the atlas's weight buffer.
#[derive(Clone, Debug, Pack)]
pub(crate) struct SlugWeightSet {
  pub basis: InterpolationBasis,
  pub source_weight_indices: Vec<u32>,
}

/// How far an atlas's glyphs reach, for sizing their previews.
#[derive(Clone, Copy, Debug, PartialEq, Pack)]
pub(crate) struct SlugPreviewExtents {
  pub horizontal: f64,
  pub minimum_y: f64,
  pub maximum_y: f64,
}

/// A prepared generation of the workspace's Slug atlas, which its stream
/// export sends.
#[derive(Clone, Debug, Pack)]
pub(crate) struct SlugAtlas {
  pub generation: u32,
  pub band_count: u32,
  pub weight_count: u32,
  pub layout: SlugLayout,
  pub preview_extents: SlugPreviewExtents,
  pub glyphs: Vec<SlugGlyph>,
  pub weight_sets: Vec<SlugWeightSet>,
  pub atlas_glyph_count: u32,
  pub curve_count: u32,
  pub component_count: u32,
}

/// One root glyph on a catalog page.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct CatalogAtlasGlyph {
  pub glyph_id: GlyphId,
  pub default_glyph: u32,
  pub exact_sources: Vec<SlugExactSource>,
}

/// A prepared catalog page of the retained font source, which the source
/// stream export sends.
#[derive(Clone, Debug, Pack)]
pub(crate) struct CatalogAtlasPage {
  pub generation: u32,
  pub page_index: u32,
  pub band_count: u32,
  pub weight_count: u32,
  pub layout: SlugLayout,
  pub preview_extents: SlugPreviewExtents,
  pub glyphs: Vec<CatalogAtlasGlyph>,
  /// The page's weights at the location it was prepared for.
  pub weights: Vec<f64>,
  pub atlas_glyph_count: u32,
  pub curve_count: u32,
  pub component_count: u32,
}

/// One resident catalog page's weights at a location.
#[derive(Clone, Debug, PartialEq, Pack)]
pub(crate) struct CatalogAtlasWeights {
  pub page_index: u32,
  pub weights: Vec<f64>,
}

impl NativeAtlas for Bridge {
  fn prepare_slug_atlas(&mut self, alignment: u32) -> Result<SlugAtlas, NativeAtlasError> {
    let total_started = Instant::now();
    let started = Instant::now();
    self.workspace_mut()?.acquire_all_layers()?;
    let acquisition = started.elapsed();
    let (authored, profile) =
      build_authored_atlas_profiled(self.font()?, shift_slug::DEFAULT_BAND_COUNT)?;
    let started = Instant::now();
    let layout = authored.atlas().layout(alignment as usize)?;
    let layout_elapsed = started.elapsed();
    self.slug_generation = self.slug_generation.checked_add(1).or_overflow()?;
    let generation = self.slug_generation;
    let result = slug_atlas(generation, &authored, layout)?;
    log_slug_atlas_profile(
      "complete",
      acquisition,
      profile,
      layout_elapsed,
      total_started.elapsed(),
    );
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas: authored.into_atlas(),
    });
    Ok(result)
  }

  fn slug_atlas_cache_revision(&self) -> Result<String, NativeAtlasError> {
    Ok(self.workspace()?.slug_atlas_cache_revision()?)
  }

  fn prepare_slug_atlas_page(
    &mut self,
    glyph_ids: Vec<GlyphId>,
    alignment: u32,
  ) -> Result<SlugAtlas, NativeAtlasError> {
    let total_started = Instant::now();
    let started = Instant::now();
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::ComponentClosure)?;
    let acquisition = started.elapsed();
    let (authored, profile) =
      build_authored_atlas_page_profiled(font, &glyph_ids, shift_slug::DEFAULT_BAND_COUNT)?;
    let started = Instant::now();
    let layout = authored.atlas().layout(alignment as usize)?;
    let layout_elapsed = started.elapsed();
    self.slug_generation = self.slug_generation.checked_add(1).or_overflow()?;
    let generation = self.slug_generation;
    let result = slug_atlas(generation, &authored, layout)?;
    log_slug_atlas_profile(
      "page",
      acquisition,
      profile,
      layout_elapsed,
      total_started.elapsed(),
    );
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas: authored.into_atlas(),
    });
    Ok(result)
  }

  fn discard_slug_atlas(&mut self, generation: u32) {
    if self
      .slug_atlas
      .as_ref()
      .is_some_and(|prepared| prepared.generation == generation)
    {
      self.slug_atlas = None;
    }
  }

  fn discard_slug_atlas_page(&mut self, generation: u32) {
    self.discard_slug_atlas(generation);
  }

  fn prepare_source_atlas_page(
    &mut self,
    page_index: u32,
    glyph_ids: Vec<GlyphId>,
    coordinates: Vec<f64>,
    alignment: u32,
  ) -> Result<CatalogAtlasPage, NativeAtlasError> {
    self.slug_generation = self.slug_generation.checked_add(1).or_overflow()?;
    let generation = self.slug_generation;
    let (atlas, descriptor, location, layout) = {
      let source = self.retained_source()?;
      let location = source.location(coordinates)?;
      let roots = glyph_ids
        .iter()
        .map(|glyph_id| source.identity.glyph_index(*glyph_id))
        .collect::<BridgeResult<Vec<_>>>()?;
      let page = match &source.font {
        OpenedFont::OpenType(font) => {
          build_binary_atlas_page(font, &roots, shift_slug::DEFAULT_BAND_COUNT)?
        }
        source => {
          let input = variable_glyph_inputs(source, &roots)?;
          compile_retained_page(&input, shift_slug::DEFAULT_BAND_COUNT)?
        }
      };
      let (atlas, descriptor) = page.into_parts();
      let layout = atlas.layout(alignment as usize)?;
      (atlas, descriptor, location, layout)
    };
    let result = source_atlas_page(
      generation,
      page_index,
      &atlas,
      &descriptor,
      &location,
      layout,
      &self.retained_source()?.identity,
    )?;
    self.source_atlas_descriptors.insert(page_index, descriptor);
    self.slug_atlas = Some(SlugAtlasGeneration {
      generation,
      alignment: alignment as usize,
      atlas,
    });
    Ok(result)
  }

  fn discard_source_atlas_page(&mut self, page_index: u32, generation: u32) {
    self.discard_slug_atlas(generation);
    self.source_atlas_descriptors.remove(&page_index);
  }

  fn source_atlas_weights(
    &self,
    coordinates: Vec<f64>,
  ) -> Result<Vec<CatalogAtlasWeights>, NativeAtlasError> {
    let location = self.retained_source()?.location(coordinates)?;

    self
      .source_atlas_descriptors
      .iter()
      .map(|(page_index, descriptor)| {
        Ok(CatalogAtlasWeights {
          page_index: *page_index,
          weights: descriptor
            .design_weights(&location)?
            .into_iter()
            .map(f64::from)
            .collect(),
        })
      })
      .collect()
  }
}

/// How far `extents` reach, in font units.
fn preview_extents(extents: shift_slug::SlugPreviewExtents) -> SlugPreviewExtents {
  SlugPreviewExtents {
    horizontal: f64::from(extents.horizontal),
    minimum_y: f64::from(extents.minimum_y),
    maximum_y: f64::from(extents.maximum_y),
  }
}

/// The description of a prepared catalog page.
fn source_atlas_page(
  generation: u32,
  page_index: u32,
  atlas: &VariableAtlas,
  descriptor: &SourceAtlasDescriptor,
  location: &[f64],
  layout: VariableLayout,
  identity: &SourceIdentity,
) -> BridgeResult<CatalogAtlasPage> {
  let statistics = atlas.statistics();
  let weights = descriptor
    .design_weights(location)?
    .into_iter()
    .map(f64::from)
    .collect::<Vec<_>>();

  Ok(CatalogAtlasPage {
    generation,
    page_index,
    band_count: atlas.band_count(),
    weight_count: u32::try_from(weights.len()).or_overflow()?,
    layout: layout.try_into()?,
    preview_extents: preview_extents(descriptor.preview_extents(atlas)?),
    glyphs: descriptor
      .glyphs()
      .iter()
      .map(|(glyph, default_glyph)| {
        Ok(CatalogAtlasGlyph {
          glyph_id: identity.glyph_id(GlyphIndex::new(*glyph))?,
          default_glyph: default_glyph.get(),
          exact_sources: descriptor
            .exact_glyphs()
            .iter()
            .filter(|(root, _, _)| root == glyph)
            .map(|(_, source, glyph_index)| {
              Ok(SlugExactSource {
                source_id: identity.source_id(shift_backends::SourceIndex::new(*source))?,
                glyph_index: glyph_index.get(),
              })
            })
            .collect::<BridgeResult<Vec<_>>>()?,
        })
      })
      .collect::<BridgeResult<Vec<_>>>()?,
    weights,
    atlas_glyph_count: u32::try_from(statistics.glyph_count).or_overflow()?,
    curve_count: u32::try_from(statistics.curve_count).or_overflow()?,
    component_count: u32::try_from(statistics.component_count).or_overflow()?,
  })
}

/// The description of a prepared workspace generation.
fn slug_atlas(
  generation: u32,
  authored: &AuthoredAtlas,
  layout: VariableLayout,
) -> BridgeResult<SlugAtlas> {
  let statistics = authored.atlas().statistics();
  let glyphs = authored
    .glyphs()
    .iter()
    .map(|glyph| SlugGlyph {
      glyph_id: glyph.glyph_id,
      default_glyph: glyph.authored.default_glyph.get(),
      exact_sources: glyph
        .authored
        .exact_sources
        .iter()
        .map(|source| SlugExactSource {
          source_id: source.source_id,
          glyph_index: source.glyph_index.get(),
        })
        .collect(),
    })
    .collect();
  let weight_sets = authored
    .weight_sets()
    .iter()
    .map(|set| SlugWeightSet {
      basis: InterpolationBasis::from(set.basis()),
      source_weight_indices: set.source_weight_indices().to_vec(),
    })
    .collect();

  Ok(SlugAtlas {
    generation,
    band_count: authored.atlas().band_count(),
    weight_count: authored.weight_count(),
    layout: layout.try_into()?,
    preview_extents: preview_extents(authored.preview_extents()?),
    glyphs,
    weight_sets,
    atlas_glyph_count: u32::try_from(statistics.glyph_count).or_overflow()?,
    curve_count: u32::try_from(statistics.curve_count).or_overflow()?,
    component_count: u32::try_from(statistics.component_count).or_overflow()?,
  })
}
