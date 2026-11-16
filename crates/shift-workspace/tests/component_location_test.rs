//! Setting where components draw their base glyphs, across a glyph's masters.

use std::error::Error;

use shift_font::{
    AddComponent, Axis, AxisId, ComponentId, ComponentInheritance, CoreError, CreateAxis,
    CreateGlyph, CreateGlyphLayer, CreateSource, DesignLocation, FontIntent, FontIntentSet,
    GlyphId, LayerId, SetComponentLocations, SourceId,
};
use shift_workspace::{FontWorkspace, NewWorkspace, WorkspaceError};

type TestResult<T> = Result<T, Box<dyn Error>>;

/// A font with a Bleed axis and two masters, `dot`, and `H` holding one
/// `dot` component on each master.
struct Fixture {
    temp: tempfile::TempDir,
    workspace: FontWorkspace,
    axis: AxisId,
    /// `H`'s layer and its component, on each master.
    h: [(LayerId, ComponentId); 2],
}

fn bleed_font() -> TestResult<Fixture> {
    let temp = tempfile::tempdir()?;
    let mut workspace =
        FontWorkspace::create_untitled(temp.path().join("working.sqlite"), NewWorkspace::new())?;
    let regular = workspace
        .font()
        .default_source_id()
        .ok_or("a new font has a default source")?;
    let axis = Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0);
    let axis_id = axis.id();
    let bled = SourceId::new();
    let dot = GlyphId::new();
    let h = GlyphId::new();
    let h_layers = [LayerId::new(), LayerId::new()];
    let h_components = [ComponentId::new(), ComponentId::new()];

    let mut intents: Vec<FontIntent> = vec![
        CreateAxis { axis }.into(),
        CreateSource {
            source_id: bled,
            name: "Bled".into(),
            location: DesignLocation::from([(axis_id, 100.0)]),
        }
        .into(),
    ];
    for (glyph_id, name) in [(dot, "dot"), (h, "H")] {
        intents.push(
            CreateGlyph {
                glyph_id: Some(glyph_id),
                name: name.into(),
                unicodes: Vec::new(),
            }
            .into(),
        );
    }
    for source_id in [regular, bled] {
        intents.push(
            CreateGlyphLayer {
                layer_id: LayerId::new(),
                glyph_id: dot,
                source_id,
            }
            .into(),
        );
    }
    for ((source_id, layer_id), component_id) in [regular, bled]
        .into_iter()
        .zip(h_layers)
        .zip(h_components.clone())
    {
        intents.push(
            CreateGlyphLayer {
                layer_id,
                glyph_id: h,
                source_id,
            }
            .into(),
        );
        intents.push(
            AddComponent {
                layer_id,
                component_id,
                base_glyph_id: dot,
            }
            .into(),
        );
    }
    workspace.apply(&FontIntentSet { intents }, None)?;

    let [regular_layer, bled_layer] = h_layers;
    let [regular_component, bled_component] = h_components;
    Ok(Fixture {
        temp,
        workspace,
        axis: axis_id,
        h: [
            (regular_layer, regular_component),
            (bled_layer, bled_component),
        ],
    })
}

/// The component's location on `axis` and its inheritance, in each of `H`'s layers.
fn locations(
    workspace: &FontWorkspace,
    h: &[(LayerId, ComponentId); 2],
    axis: AxisId,
) -> TestResult<Vec<(Option<f64>, ComponentInheritance)>> {
    h.iter()
        .map(|(layer_id, component_id)| {
            let component = workspace
                .font()
                .layer(*layer_id)
                .and_then(|layer| layer.component(component_id))
                .ok_or("H's layer holds its component")?;
            Ok((component.location().get(&axis), component.inheritance()))
        })
        .collect()
}

/// One intent per master, applied together, as the editing set sends them.
fn set_bleed(f: &mut Fixture, value: f64, inheritance: ComponentInheritance) -> TestResult<()> {
    let intents =
        f.h.iter()
            .map(|(layer_id, component_id)| {
                SetComponentLocations {
                    layer_id: *layer_id,
                    component_ids: vec![component_id.clone()],
                    locations: vec![DesignLocation::from([(f.axis, value)])],
                    inheritances: vec![inheritance],
                }
                .into()
            })
            .collect();
    f.workspace.apply(&FontIntentSet { intents }, None)?;
    Ok(())
}

#[test]
fn setting_a_location_on_every_master_is_one_undo_step() {
    let mut f = bleed_font().unwrap();

    set_bleed(&mut f, 100.0, ComponentInheritance::Font).unwrap();
    assert_eq!(
        locations(&f.workspace, &f.h, f.axis).unwrap(),
        vec![(Some(100.0), ComponentInheritance::Font); 2]
    );

    f.workspace.undo().unwrap();
    assert_eq!(
        locations(&f.workspace, &f.h, f.axis).unwrap(),
        vec![(None, ComponentInheritance::Parent); 2]
    );
}

#[test]
fn a_component_location_is_saved_with_the_document() {
    let mut f = bleed_font().unwrap();
    set_bleed(&mut f, 100.0, ComponentInheritance::Font).unwrap();
    let path = f.temp.path().join("Solenoid.shift");
    f.workspace
        .save_as_document(&path, f.temp.path().join("save-recovery.sqlite"))
        .unwrap();
    drop(f.workspace);

    let mut reopened =
        FontWorkspace::open_document(&path, f.temp.path().join("recovery.sqlite")).unwrap();
    reopened.acquire_all_layers().unwrap();

    assert_eq!(
        locations(&reopened, &f.h, f.axis).unwrap(),
        vec![(Some(100.0), ComponentInheritance::Font); 2]
    );
}

#[test]
fn a_location_on_an_unknown_axis_is_rejected() {
    let mut f = bleed_font().unwrap();
    let (layer_id, component_id) = f.h[0].clone();

    let result = f.workspace.apply(
        &FontIntentSet::from(SetComponentLocations {
            layer_id,
            component_ids: vec![component_id],
            locations: vec![DesignLocation::from([(AxisId::new(), 1.0)])],
            inheritances: vec![ComponentInheritance::Parent],
        }),
        None,
    );

    assert!(matches!(
        result,
        Err(WorkspaceError::Font(CoreError::AxisNotFound(_)))
    ));
    assert_eq!(
        locations(&f.workspace, &f.h, f.axis).unwrap(),
        vec![(None, ComponentInheritance::Parent); 2]
    );
}

#[test]
fn setting_a_location_on_one_master_saves_only_that_master() {
    let mut f = bleed_font().unwrap();
    let (layer_id, component_id) = f.h[0].clone();
    f.workspace
        .apply(
            &FontIntentSet::from(SetComponentLocations {
                layer_id,
                component_ids: vec![component_id],
                locations: vec![DesignLocation::from([(f.axis, 0.0)])],
                inheritances: vec![ComponentInheritance::Parent],
            }),
            None,
        )
        .unwrap();
    let path = f.temp.path().join("Solenoid.shift");
    f.workspace
        .save_as_document(&path, f.temp.path().join("save-recovery.sqlite"))
        .unwrap();
    drop(f.workspace);

    let mut reopened =
        FontWorkspace::open_document(&path, f.temp.path().join("recovery.sqlite")).unwrap();
    reopened.acquire_all_layers().unwrap();

    assert_eq!(
        locations(&reopened, &f.h, f.axis).unwrap(),
        vec![
            (Some(0.0), ComponentInheritance::Parent),
            (None, ComponentInheritance::Parent),
        ]
    );
}
