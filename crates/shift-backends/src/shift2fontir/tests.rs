use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use fontdrasil::coords::{
    CoordConverter, DesignCoord, NormalizedCoord, NormalizedLocation, UserCoord, UserLocation,
};
use fontdrasil::types::{Axis, GlyphName, Tag};
use fontir::glyph::create_glyph_order_work;
use fontir::ir::{
    FeaturesSource, GlobalMetric, Glyph, GlyphInstance, KernGroup, KernSide, KerningGroups,
    KerningInstance, NamedInstance,
};
use fontir::orchestration::{Context, Flags, IrWork, WorkId};
use fontir::paths::Paths;
use fontir::source::Source;
use kurbo::BezPath;
use ordered_float::OrderedFloat;
use shift_font::test_support::sample_variable_font;

use super::source::ShiftIrSource;

#[derive(Debug, PartialEq)]
struct Compilation {
    units_per_em: u16,
    axes: Vec<Axis>,
    named_instances: Vec<NamedInstance>,
    features: FeaturesSource,
    glyph: Glyph,
    metrics: Metrics,
    kerning_groups: KerningGroups,
    kerning: KerningInstance,
}

#[derive(Debug, PartialEq)]
struct Metrics {
    ascender: OrderedFloat<f64>,
    descender: OrderedFloat<f64>,
    cap_height: OrderedFloat<f64>,
    x_height: OrderedFloat<f64>,
    line_gap: OrderedFloat<f64>,
    underline_position: OrderedFloat<f64>,
    underline_thickness: OrderedFloat<f64>,
}

#[test]
fn shift_source_produces_expected_fontir() {
    let actual = compile_ir(ShiftIrSource::from_font_view(&sample_variable_font()).unwrap());

    assert_eq!(actual, expected_ir());
}

fn compile_ir(source: ShiftIrSource) -> Compilation {
    let context = Context::new_root(Flags::empty(), Paths::new(Path::new("unused")));
    run(&context, source.create_static_metadata_work().unwrap());
    run(&context, source.create_global_metric_work().unwrap());
    run(&context, source.create_feature_ir_work().unwrap());
    for work in source.create_glyph_ir_work().unwrap() {
        run(&context, work);
    }
    run(&context, create_glyph_order_work());
    run(&context, source.create_kerning_group_ir_work().unwrap());

    let metadata = context.static_metadata.get();
    let default_location = metadata.default_location().clone();
    run(
        &context,
        source
            .create_kerning_instance_ir_work(default_location.clone())
            .unwrap(),
    );
    let global_metrics = context.global_metrics.get();

    Compilation {
        units_per_em: metadata.units_per_em,
        axes: metadata.all_source_axes.iter().cloned().collect(),
        named_instances: metadata.named_instances.clone(),
        features: context.features.get().as_ref().clone(),
        glyph: context.get_glyph("A").as_ref().clone(),
        metrics: Metrics {
            ascender: global_metrics.get(GlobalMetric::Ascender, &default_location),
            descender: global_metrics.get(GlobalMetric::Descender, &default_location),
            cap_height: global_metrics.get(GlobalMetric::CapHeight, &default_location),
            x_height: global_metrics.get(GlobalMetric::XHeight, &default_location),
            line_gap: global_metrics.get(GlobalMetric::HheaLineGap, &default_location),
            underline_position: global_metrics
                .get(GlobalMetric::UnderlinePosition, &default_location),
            underline_thickness: global_metrics
                .get(GlobalMetric::UnderlineThickness, &default_location),
        },
        kerning_groups: context.kerning_groups.get().as_ref().clone(),
        kerning: context
            .kerning_at
            .get(&WorkId::KernInstance(default_location))
            .as_ref()
            .clone(),
    }
}

fn run(context: &Context, work: Box<IrWork>) {
    let context = context.copy_for_work(work.read_access(), work.write_access());
    work.exec(&context).unwrap();
}

fn expected_ir() -> Compilation {
    let tag = Tag::new(b"wght");
    let default_location: NormalizedLocation =
        [(tag, NormalizedCoord::new(0.0))].into_iter().collect();
    let bold_location = [(tag, NormalizedCoord::new(1.0))].into_iter().collect();
    let mut glyph_sources = HashMap::new();
    glyph_sources.insert(default_location.clone(), triangle_instance(600.0, 300.0));
    glyph_sources.insert(bold_location, triangle_instance(800.0, 380.0));

    Compilation {
        units_per_em: 1000,
        axes: vec![Axis {
            name: "Weight".to_string(),
            tag,
            min: UserCoord::new(100.0),
            default: UserCoord::new(400.0),
            max: UserCoord::new(900.0),
            hidden: false,
            converter: CoordConverter::new(
                vec![
                    (UserCoord::new(100.0), DesignCoord::new(100.0)),
                    (UserCoord::new(400.0), DesignCoord::new(400.0)),
                    (UserCoord::new(700.0), DesignCoord::new(600.0)),
                    (UserCoord::new(900.0), DesignCoord::new(800.0)),
                ],
                1,
            ),
            localized_names: HashMap::new(),
        }],
        named_instances: vec![NamedInstance {
            name: "Bold".to_string(),
            postscript_name: Some("UntitledFont-Bold".to_string()),
            location: UserLocation::from_iter([(tag, UserCoord::new(900.0))]),
        }],
        features: FeaturesSource::from_string(EXPECTED_STAT.to_string()),
        glyph: Glyph::new(
            GlyphName::new("A"),
            true,
            HashSet::from([0x0041]),
            glyph_sources,
        )
        .unwrap(),
        metrics: Metrics {
            ascender: OrderedFloat(800.0),
            descender: OrderedFloat(-200.0),
            cap_height: OrderedFloat(700.0),
            x_height: OrderedFloat(500.0),
            line_gap: OrderedFloat(20.0),
            underline_position: OrderedFloat(-100.0),
            underline_thickness: OrderedFloat(50.0),
        },
        kerning_groups: expected_kerning_groups(default_location.clone()),
        kerning: KerningInstance {
            location: default_location,
            kerns: BTreeMap::from([(
                (
                    KernSide::Group(KernGroup::Side1("A".into())),
                    KernSide::Group(KernGroup::Side2("A".into())),
                ),
                OrderedFloat(-50.0),
            )]),
        },
    }
}

fn triangle_instance(width: f64, apex_x: f64) -> GlyphInstance {
    let mut path = BezPath::new();
    path.move_to((100.0, 0.0));
    path.line_to((apex_x, 700.0));
    path.line_to((500.0, 0.0));
    path.line_to((100.0, 0.0));
    path.close_path();

    GlyphInstance {
        width,
        height: None,
        vertical_origin: None,
        contours: vec![path],
        components: Vec::new(),
    }
}

fn expected_kerning_groups(location: NormalizedLocation) -> KerningGroups {
    let side1 = KernGroup::Side1("A".into());
    let side2 = KernGroup::Side2("A".into());
    KerningGroups {
        groups: BTreeMap::from([
            (side1.clone(), BTreeSet::from([GlyphName::new("A")])),
            (side2.clone(), BTreeSet::from([GlyphName::new("A")])),
        ]),
        locations: BTreeSet::from([location]),
        old_to_new_group_names: BTreeMap::from([(side1.clone(), side1), (side2.clone(), side2)]),
    }
}

const EXPECTED_STAT: &str = r#"table STAT {
  ElidedFallbackName {
    name "Regular";
  };
  DesignAxis wght 0 {
    name "Weight";
  };
  AxisValue {
    location wght 400 700;
    name "Regular";
    flag ElidableAxisValueName;
  };
  AxisValue {
    location wght 900;
    name "Bold";
  };
} STAT;
"#;
