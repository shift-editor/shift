use std::path::Path;

use rusqlite::Connection;

use crate::StoreError;

pub(super) fn attach_recovery(conn: &Connection, path: &Path) -> Result<(), StoreError> {
    let path = path
        .to_str()
        .ok_or_else(|| StoreError::InvalidDocument("recovery path is not valid UTF-8".into()))?;
    conn.execute("ATTACH DATABASE ?1 AS recovery", [path])?;
    Ok(())
}

pub(super) fn install_merged_views(conn: &Connection) -> Result<(), StoreError> {
    conn.execute_batch(MERGED_VIEWS_SQL)?;
    Ok(())
}

const MERGED_VIEWS_SQL: &str = r#"
CREATE TEMP VIEW font_info AS
SELECT * FROM recovery.font_info
UNION ALL SELECT * FROM main.font_info WHERE NOT EXISTS (SELECT 1 FROM recovery.font_info);

CREATE TEMP VIEW axes AS
SELECT r.* FROM recovery.axes r
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'axis' AND t.entity_id = r.id)
UNION ALL
SELECT m.* FROM main.axes m
WHERE NOT EXISTS (SELECT 1 FROM recovery.axes r WHERE r.id = m.id)
  AND NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'axis' AND t.entity_id = m.id);

CREATE TEMP VIEW axis_mappings AS
SELECT * FROM recovery.axis_mappings
UNION ALL SELECT * FROM main.axis_mappings
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'axis_mappings' AND owner_id = '');

CREATE TEMP VIEW metric_definitions AS
SELECT * FROM recovery.metric_definitions
UNION ALL SELECT * FROM main.metric_definitions
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'metric_definitions' AND owner_id = '');

CREATE TEMP VIEW named_instances AS
SELECT * FROM recovery.named_instances
UNION ALL SELECT * FROM main.named_instances
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'named_instances' AND owner_id = '');

CREATE TEMP VIEW sources AS
SELECT r.id, r.name,
       COALESCE(r.family_name, m.family_name) AS family_name,
       COALESCE(r.style_name, m.style_name) AS style_name,
       r.filename, r.color, r.layer_name, r.italic_angle, r.line_gap,
       r.underline_position, r.underline_thickness, r.kind, r.order_index
FROM recovery.sources r
LEFT JOIN main.sources m ON m.id = r.id
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'source' AND t.entity_id = r.id)
UNION ALL
SELECT m.* FROM main.sources m
WHERE NOT EXISTS (SELECT 1 FROM recovery.sources r WHERE r.id = m.id)
  AND NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'source' AND t.entity_id = m.id);

CREATE TEMP VIEW source_locations AS
SELECT r.* FROM recovery.source_locations r
WHERE EXISTS (SELECT 1 FROM sources s WHERE s.id = r.source_id)
  AND EXISTS (SELECT 1 FROM axes a WHERE a.id = r.axis_id)
UNION ALL
SELECT m.* FROM main.source_locations m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'source_locations' AND x.owner_id = m.source_id)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = m.source_id)
  AND EXISTS (SELECT 1 FROM axes a WHERE a.id = m.axis_id);

CREATE TEMP VIEW source_metric_values AS
SELECT r.* FROM recovery.source_metric_values r
WHERE EXISTS (SELECT 1 FROM sources s WHERE s.id = r.source_id)
  AND EXISTS (SELECT 1 FROM metric_definitions d WHERE d.id = r.metric_id)
UNION ALL
SELECT m.* FROM main.source_metric_values m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'source_metric_values' AND x.owner_id = m.source_id)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = m.source_id)
  AND EXISTS (SELECT 1 FROM metric_definitions d WHERE d.id = m.metric_id);

CREATE TEMP VIEW source_lib AS
SELECT r.* FROM recovery.source_lib r WHERE EXISTS (SELECT 1 FROM sources s WHERE s.id = r.source_id)
UNION ALL
SELECT m.* FROM main.source_lib m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'source_lib' AND x.owner_id = m.source_id)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = m.source_id);

CREATE TEMP VIEW glyphs AS
SELECT r.* FROM recovery.glyphs r
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'glyph' AND t.entity_id = r.id)
UNION ALL
SELECT m.* FROM main.glyphs m
WHERE NOT EXISTS (SELECT 1 FROM recovery.glyphs r WHERE r.id = m.id)
  AND NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'glyph' AND t.entity_id = m.id);

CREATE TEMP VIEW glyph_unicodes AS
SELECT r.* FROM recovery.glyph_unicodes r WHERE EXISTS (SELECT 1 FROM glyphs g WHERE g.id = r.glyph_id)
UNION ALL
SELECT m.* FROM main.glyph_unicodes m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'glyph_unicodes' AND x.owner_id = m.glyph_id)
  AND EXISTS (SELECT 1 FROM glyphs g WHERE g.id = m.glyph_id);

CREATE TEMP VIEW glyph_lib AS
SELECT r.* FROM recovery.glyph_lib r WHERE EXISTS (SELECT 1 FROM glyphs g WHERE g.id = r.glyph_id)
UNION ALL
SELECT m.* FROM main.glyph_lib m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'glyph_lib' AND x.owner_id = m.glyph_id)
  AND EXISTS (SELECT 1 FROM glyphs g WHERE g.id = m.glyph_id);

CREATE TEMP VIEW glyph_layers AS
SELECT r.* FROM recovery.glyph_layers r
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'layer' AND t.entity_id = r.id)
  AND EXISTS (SELECT 1 FROM glyphs g WHERE g.id = r.glyph_id)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = r.source_id)
UNION ALL
SELECT m.* FROM main.glyph_layers m
WHERE NOT EXISTS (SELECT 1 FROM recovery.glyph_layers r WHERE r.id = m.id)
  AND NOT EXISTS (SELECT 1 FROM recovery.recovery_tombstones t WHERE t.entity_kind = 'layer' AND t.entity_id = m.id)
  AND EXISTS (SELECT 1 FROM glyphs g WHERE g.id = m.glyph_id)
  AND EXISTS (SELECT 1 FROM sources s WHERE s.id = m.source_id);

CREATE TEMP VIEW glyph_layer_payloads AS
SELECT r.* FROM recovery.glyph_layer_payloads r WHERE EXISTS (SELECT 1 FROM glyph_layers l WHERE l.id = r.layer_id)
UNION ALL
SELECT m.* FROM main.glyph_layer_payloads m
WHERE NOT EXISTS (SELECT 1 FROM recovery.glyph_layer_payloads r WHERE r.layer_id = m.layer_id)
  AND EXISTS (SELECT 1 FROM glyph_layers l WHERE l.id = m.layer_id);

CREATE TEMP VIEW glyph_components AS
SELECT r.* FROM recovery.glyph_components r WHERE EXISTS (SELECT 1 FROM glyph_layers l WHERE l.id = r.layer_id)
UNION ALL
SELECT m.* FROM main.glyph_components m
WHERE NOT EXISTS (SELECT 1 FROM recovery.recovery_replacements x WHERE x.collection = 'glyph_components' AND x.owner_id = m.layer_id)
  AND EXISTS (SELECT 1 FROM glyph_layers l WHERE l.id = m.layer_id);

CREATE TEMP VIEW feature_text AS SELECT * FROM main.feature_text;
CREATE TEMP VIEW font_guidelines AS SELECT * FROM main.font_guidelines;
CREATE TEMP VIEW kerning_groups AS SELECT * FROM main.kerning_groups;
CREATE TEMP VIEW kerning_group_members AS SELECT * FROM main.kerning_group_members;
CREATE TEMP VIEW kerning_pairs AS SELECT * FROM main.kerning_pairs;
CREATE TEMP VIEW font_lib AS SELECT * FROM main.font_lib;
CREATE TEMP VIEW fontinfo_remainder AS SELECT * FROM main.fontinfo_remainder;
CREATE TEMP VIEW font_binaries AS SELECT * FROM main.font_binaries;
CREATE TEMP VIEW document_metadata AS SELECT * FROM main.document_metadata;
"#;
