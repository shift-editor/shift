//! Component locations as interpolation reads them.
//!
//! A master stores only the axes its components set. Where another master's
//! matching component sets an axis this one doesn't, this one draws that
//! axis where it inherits it: the master's own location on the axis, or the
//! axis default for a component that uses the font's location. Reading every
//! master's components with those values filled in gives each the same axes,
//! so a glyph whose masters set different axes still interpolates, and
//! nothing is written back.
//!
//! When the masters' components take unset axes from different places, each
//! is filled on every font axis, applying its own inheritance, so its
//! inheritance no longer matters to how it draws.

use std::collections::BTreeSet;

use crate::{Axis, AxisId, AxisList, Component, ComponentInheritance, DesignLocation, GlyphLayer};

/// The axes, and the inheritance, one component carries in every master's
/// interpolation values.
#[derive(Clone, Debug, Default, PartialEq)]
struct LocationSlot {
    axes: BTreeSet<AxisId>,
    inheritance: ComponentInheritance,
}

/// How one glyph's masters carry their components' locations, so that
/// interpolation and export read every master with the same axes: one slot
/// per component position. Built from the masters' layers with
/// [`ComponentLocationFill::new`], applied to each with
/// [`ComponentLocationFill::fill`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ComponentLocationFill {
    slots: Vec<LocationSlot>,
}

impl ComponentLocationFill {
    /// One slot per component of `layers`, whose components match by
    /// position: the axes any of them sets, and their inheritance; every
    /// font axis, and `Parent`, where their inheritances differ.
    pub fn new(axes: &[Axis], layers: &[&GlyphLayer]) -> Self {
        let Some(first) = layers.first() else {
            return Self::default();
        };
        let slots = (0..first.components().len())
            .map(|index| {
                let components: Vec<&Component> = layers
                    .iter()
                    .filter_map(|layer| layer.components_iter().nth(index))
                    .collect();
                let inheritance = components
                    .first()
                    .map(|component| component.inheritance())
                    .unwrap_or_default();
                let mixed = components
                    .iter()
                    .any(|component| component.inheritance() != inheritance);
                let mut slot_axes: BTreeSet<AxisId> = components
                    .iter()
                    .flat_map(|component| component.location().iter().map(|(axis, _)| *axis))
                    .collect();
                if mixed {
                    slot_axes.extend(axes.iter().map(Axis::id));
                }
                LocationSlot {
                    axes: slot_axes,
                    inheritance: if mixed {
                        ComponentInheritance::Parent
                    } else {
                        inheritance
                    },
                }
            })
            .collect();
        Self { slots }
    }

    /// `layer`, a master drawn at `location`, with each component carrying
    /// its slot's axes: an axis it doesn't set takes the value it inherits
    /// there. `None` when no slot asks for anything the layer lacks.
    pub fn fill(
        &self,
        axes: &[Axis],
        layer: &GlyphLayer,
        location: &DesignLocation,
    ) -> Option<GlyphLayer> {
        let slots = &self.slots;
        let needs_fill = layer.components_iter().zip(slots).any(|(component, slot)| {
            component.inheritance() != slot.inheritance
                || slot
                    .axes
                    .iter()
                    .any(|axis| component.location().get(axis).is_none())
        });
        if !needs_fill {
            return None;
        }

        let mut filled = layer.clone();
        for (component, slot) in filled.components_iter_mut().zip(slots) {
            let mut component_location = component.location().clone();
            for axis_id in &slot.axes {
                if component_location.get(axis_id).is_some() {
                    continue;
                }
                let Some(axis) = axes.axis(*axis_id) else {
                    continue;
                };
                let inherited = match component.inheritance() {
                    ComponentInheritance::Parent => location.value_on(axis),
                    ComponentInheritance::Font => axis.default(),
                };
                component_location.set(*axis_id, inherited);
            }
            component.set_location(component_location);
            component.set_inheritance(slot.inheritance);
        }
        Some(filled)
    }
}
