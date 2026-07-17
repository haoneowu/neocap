use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::ops::Range;

pub const SHORT_CURSOR_SHAPE_DEBOUNCE_MS: f64 = 1000.0;
use std::fs::File;
use std::path::{Path, PathBuf};

use crate::{GlideDirection, XY, ZoomMode, ZoomSegment};

const MS_PER_SECOND: f64 = 1000.0;
const AUTO_ZOOM_START_MIN_MS: f64 = 1.0;
const AUTO_ZOOM_CLICK_PRE_PADDING_MS: f64 = 300.0;
const AUTO_ZOOM_CLICK_POST_PADDING_MS: f64 = 2500.0;
const AUTO_ZOOM_CLICK_END_CLAMP_PADDING_MS: f64 = 800.0;
const AUTO_ZOOM_TRAILING_CLICK_IGNORE_MS: f64 = 1000.0;
const AUTO_ZOOM_MERGE_GAP_MS: f64 = 2500.0;
/// Prevents double-clicks and click bounce from producing repeated automatic
/// framing proposals. Manual zooms remain independently editable.
pub const AUTO_ZOOM_CLICK_COOLDOWN_MS: f64 = 700.0;
const AUTO_ZOOM_AMOUNT: f64 = 2.0;

#[derive(Serialize, Deserialize, Clone, Type, Debug, PartialEq)]
pub struct CursorMoveEvent {
    pub active_modifiers: Vec<String>,
    pub cursor_id: String,
    /// Monotonic time from the recording session anchor, when captured by a
    /// newer recorder. `time_ms` remains the rendering-compatible fallback for
    /// legacy projects that do not have this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_time_us: Option<u64>,
    pub time_ms: f64,
    pub x: f64,
    pub y: f64,
}

impl CursorMoveEvent {
    /// Returns the persisted, monotonic whole-session timestamp when available.
    ///
    /// `time_ms` deliberately remains this segment's media time: multi-segment
    /// renderers select cursor data per segment, so replacing it with the
    /// session clock would make resumed recordings render at the wrong time.
    pub fn session_time_ms(&self) -> Option<f64> {
        self.session_time_us.map(|time_us| time_us as f64 / 1_000.0)
    }

    /// Returns the segment-media timestamp consumed by legacy render/export
    /// paths. Kept for callers that previously used this helper.
    pub fn resolved_time_ms(&self) -> f64 {
        self.time_ms
    }
}

impl PartialOrd for CursorMoveEvent {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.time_ms.partial_cmp(&other.time_ms)
    }
}

#[derive(Serialize, Deserialize, Clone, Type, Debug, PartialEq)]
pub struct CursorClickEvent {
    pub active_modifiers: Vec<String>,
    pub cursor_num: u8,
    pub cursor_id: String,
    /// See `CursorMoveEvent::session_time_us`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_time_us: Option<u64>,
    pub time_ms: f64,
    pub down: bool,
}

impl CursorClickEvent {
    /// See [`CursorMoveEvent::session_time_ms`].
    pub fn session_time_ms(&self) -> Option<f64> {
        self.session_time_us.map(|time_us| time_us as f64 / 1_000.0)
    }

    /// See [`CursorMoveEvent::resolved_time_ms`].
    pub fn resolved_time_ms(&self) -> f64 {
        self.time_ms
    }
}

impl PartialOrd for CursorClickEvent {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.time_ms.partial_cmp(&other.time_ms)
    }
}

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
#[serde(transparent)]
pub struct CursorImages(pub HashMap<String, CursorImage>);

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
pub struct CursorImage {
    pub path: PathBuf,
    pub hotspot: XY<f64>,
}

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
pub struct CursorData {
    pub clicks: Vec<CursorClickEvent>,
    pub moves: Vec<CursorMoveEvent>,
    pub cursor_images: CursorImages,
}

impl CursorData {
    pub fn load_from_file(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open cursor file: {e}"))?;
        serde_json::from_reader(file).map_err(|e| format!("Failed to parse cursor data: {e}"))
    }
}

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
pub struct CursorEvents {
    pub clicks: Vec<CursorClickEvent>,
    pub moves: Vec<CursorMoveEvent>,
}

impl CursorEvents {
    pub fn load_from_file(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open cursor file: {e}"))?;
        serde_json::from_reader(file).map_err(|e| format!("Failed to parse cursor data: {e}"))
    }

    /// Moves segment-local events onto a concatenated project-media timeline.
    /// The session clock is intentionally left untouched as audit telemetry.
    pub fn offset_timeline_time_ms(&mut self, offset_ms: f64) {
        if !offset_ms.is_finite() {
            return;
        }

        for event in &mut self.moves {
            event.time_ms += offset_ms;
        }
        for event in &mut self.clicks {
            event.time_ms += offset_ms;
        }
    }

    pub fn stabilize_short_lived_cursor_shapes(
        &mut self,
        pointer_ids: Option<&HashSet<String>>,
        threshold_ms: f64,
    ) {
        if self.moves.len() < 2 {
            return;
        }

        let mut segments: Vec<CursorSegment> = Vec::new();
        let mut idx = 0;

        while idx < self.moves.len() {
            let start_index = idx;
            let start_time = self.moves[idx].time_ms;
            let id = self.moves[idx].cursor_id.clone();

            idx += 1;
            while idx < self.moves.len() && self.moves[idx].cursor_id == id {
                idx += 1;
            }

            segments.push(CursorSegment {
                range: start_index..idx,
                start_time,
                end_time: 0.0,
                duration: 0.0,
                id,
            });
        }

        if segments.len() < 2 {
            return;
        }

        let last_move_time = self.moves.last().map(|event| event.time_ms).unwrap_or(0.0);

        for i in 0..segments.len() {
            let end_time = if i + 1 < segments.len() {
                segments[i + 1].start_time
            } else {
                last_move_time
            };

            let duration = (end_time - segments[i].start_time).max(0.0);
            segments[i].duration = duration;
            segments[i].end_time = if i + 1 < segments.len() {
                end_time
            } else {
                f64::MAX
            };
        }

        let mut duration_by_id = HashMap::<String, f64>::new();
        for segment in &segments {
            *duration_by_id.entry(segment.id.clone()).or_default() += segment.duration;
        }

        let preferred_pointer = pointer_ids.and_then(|set| {
            segments
                .iter()
                .find(|segment| set.contains(&segment.id))
                .map(|segment| segment.id.clone())
        });

        let global_fallback = duration_by_id
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(id, _)| id.clone());

        for i in 0..segments.len() {
            let segment_id = segments[i].id.clone();
            let is_pointer_segment = pointer_ids
                .map(|set| set.contains(&segment_id))
                .unwrap_or(false);

            if segments[i].duration >= threshold_ms || is_pointer_segment {
                continue;
            }

            let replacement = preferred_pointer
                .clone()
                .or_else(|| global_fallback.clone())
                .or_else(|| {
                    if i > 0 {
                        Some(segments[i - 1].id.clone())
                    } else {
                        None
                    }
                })
                .or_else(|| segments.get(i + 1).map(|segment| segment.id.clone()))
                .unwrap_or_else(|| segment_id.clone());

            if replacement == segment_id {
                continue;
            }

            for event in &mut self.moves[segments[i].range.clone()] {
                event.cursor_id = replacement.clone();
            }
            segments[i].id = replacement;
        }

        if self.clicks.is_empty() {
            return;
        }

        let mut segment_index = 0;
        for click in &mut self.clicks {
            while segment_index + 1 < segments.len()
                && click.time_ms >= segments[segment_index].end_time
            {
                segment_index += 1;
            }

            click.cursor_id = segments[segment_index].id.clone();
        }
    }

    pub fn cursor_position_at(&self, time: f64) -> Option<XY<f64>> {
        // Debug print to understand what we're looking for
        println!("Looking for cursor position at time: {time}");
        println!("Total cursor events: {}", self.moves.len());

        // Check if we have any move events at all
        if self.moves.is_empty() {
            println!("No cursor move events available");
            return None;
        }

        // Find the move event closest to the given time, preferring events that happened before
        let filtered_events = self
            .moves
            .iter()
            .filter(|event| event.time_ms <= time * 1000.0)
            .collect::<Vec<_>>();

        println!(
            "Found {} events before or at time {}",
            filtered_events.len(),
            time
        );

        if !filtered_events.is_empty() {
            // Take the most recent one before the given time
            let closest = filtered_events
                .iter()
                .max_by(|a, b| {
                    a.time_ms
                        .partial_cmp(&b.time_ms)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap();

            println!(
                "Selected event at time {} with pos ({}, {})",
                closest.time_ms, closest.x, closest.y
            );

            return Some(XY::new(closest.x, closest.y));
        }

        // If no events happened before, find the earliest one
        let earliest = self.moves.iter().min_by(|a, b| {
            a.time_ms
                .partial_cmp(&b.time_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        if let Some(event) = earliest {
            println!(
                "No events before requested time, using earliest at {} with pos ({}, {})",
                event.time_ms, event.x, event.y
            );
            return Some(XY::new(event.x, event.y));
        }

        println!("Could not find any usable cursor position");
        None
    }
}

/// Generates deterministic, editable automatic zoom proposals from cursor
/// telemetry that has already been mapped onto project-media time.
///
/// Only primary-button down events are candidates. A 700 ms cooldown filters
/// double-click bounce before overlapping proposal intervals are merged.
pub fn generate_auto_zoom_segments(
    mut clicks: Vec<CursorClickEvent>,
    max_duration: f64,
) -> Vec<ZoomSegment> {
    if max_duration <= 0.0 {
        return Vec::new();
    }

    let duration_ms = max_duration * MS_PER_SECOND;
    let click_cutoff_ms = duration_ms - AUTO_ZOOM_TRAILING_CLICK_IGNORE_MS;
    let end_limit_ms = duration_ms - AUTO_ZOOM_CLICK_END_CLAMP_PADDING_MS;
    if click_cutoff_ms <= 0.0 || end_limit_ms <= AUTO_ZOOM_START_MIN_MS {
        return Vec::new();
    }

    clicks.retain(|click| click.cursor_num == 0 && click.down && click.time_ms.is_finite());
    clicks.sort_by(|a, b| {
        a.time_ms
            .partial_cmp(&b.time_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut intervals: Vec<(f64, f64)> = Vec::new();
    let mut last_candidate_ms: Option<f64> = None;
    for click in clicks {
        let time_ms = click.time_ms.floor();
        if time_ms >= click_cutoff_ms {
            continue;
        }
        if last_candidate_ms.is_some_and(|last| time_ms - last < AUTO_ZOOM_CLICK_COOLDOWN_MS) {
            continue;
        }
        last_candidate_ms = Some(time_ms);

        let start = (time_ms - AUTO_ZOOM_CLICK_PRE_PADDING_MS).max(AUTO_ZOOM_START_MIN_MS);
        let end = (time_ms + AUTO_ZOOM_CLICK_POST_PADDING_MS).min(end_limit_ms);

        if end > start {
            intervals.push((start, end));
        }
    }

    let mut merged: Vec<(f64, f64)> = Vec::new();
    for interval in intervals {
        if let Some(last) = merged.last_mut()
            && interval.0 <= last.1 + AUTO_ZOOM_MERGE_GAP_MS
        {
            last.1 = last.1.max(interval.1);
            continue;
        }
        merged.push(interval);
    }

    merged
        .into_iter()
        .map(|(start, end)| ZoomSegment {
            start: start.round() / MS_PER_SECOND,
            end: end.round() / MS_PER_SECOND,
            amount: AUTO_ZOOM_AMOUNT,
            mode: ZoomMode::Auto,
            glide_direction: GlideDirection::None,
            glide_speed: 0.5,
            instant_animation: false,
            edge_snap_ratio: 0.25,
        })
        .collect()
}

impl From<CursorData> for CursorEvents {
    fn from(value: CursorData) -> Self {
        Self {
            clicks: value.clicks,
            moves: value.moves,
        }
    }
}

#[derive(Clone)]
struct CursorSegment {
    range: Range<usize>,
    start_time: f64,
    end_time: f64,
    duration: f64,
    id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn move_event(time_ms: f64, cursor_id: &str) -> CursorMoveEvent {
        CursorMoveEvent {
            active_modifiers: vec![],
            cursor_id: cursor_id.to_string(),
            session_time_us: None,
            time_ms,
            x: 0.0,
            y: 0.0,
        }
    }

    fn click_event(time_ms: f64, cursor_id: &str) -> CursorClickEvent {
        CursorClickEvent {
            active_modifiers: vec![],
            cursor_id: cursor_id.to_string(),
            cursor_num: 0,
            session_time_us: None,
            down: true,
            time_ms,
        }
    }

    #[test]
    fn short_lived_segments_are_replaced_with_pointer() {
        let mut pointer_ids = HashSet::new();
        pointer_ids.insert("pointer".to_string());

        let mut events = CursorEvents {
            moves: vec![
                move_event(0.0, "pointer"),
                move_event(200.0, "ibeam"),
                move_event(400.0, "pointer"),
                move_event(900.0, "pointer"),
            ],
            clicks: vec![click_event(250.0, "ibeam")],
        };

        events.stabilize_short_lived_cursor_shapes(
            Some(&pointer_ids),
            SHORT_CURSOR_SHAPE_DEBOUNCE_MS,
        );

        assert!(
            events
                .moves
                .iter()
                .all(|event| event.cursor_id == "pointer")
        );
        assert!(
            events
                .clicks
                .iter()
                .all(|event| event.cursor_id == "pointer")
        );
    }

    #[test]
    fn longer_segments_are_preserved() {
        let mut pointer_ids = HashSet::new();
        pointer_ids.insert("pointer".to_string());

        let mut events = CursorEvents {
            moves: vec![
                move_event(0.0, "pointer"),
                move_event(200.0, "ibeam"),
                move_event(1500.0, "pointer"),
            ],
            clicks: vec![click_event(400.0, "ibeam")],
        };

        events.stabilize_short_lived_cursor_shapes(
            Some(&pointer_ids),
            SHORT_CURSOR_SHAPE_DEBOUNCE_MS,
        );

        assert_eq!(events.moves[1].cursor_id, "ibeam");
        assert_eq!(events.clicks[0].cursor_id, "ibeam");
    }

    #[test]
    fn falls_back_to_dominant_cursor_without_pointer_metadata() {
        let mut events = CursorEvents {
            moves: vec![
                move_event(0.0, "pointer"),
                move_event(200.0, "ibeam"),
                move_event(400.0, "pointer"),
                move_event(1200.0, "pointer"),
            ],
            clicks: vec![click_event(250.0, "ibeam")],
        };

        events.stabilize_short_lived_cursor_shapes(None, SHORT_CURSOR_SHAPE_DEBOUNCE_MS);

        assert!(
            events
                .moves
                .iter()
                .all(|event| event.cursor_id == "pointer")
        );
        assert!(
            events
                .clicks
                .iter()
                .all(|event| event.cursor_id == "pointer")
        );
    }

    #[test]
    fn legacy_cursor_json_loads_without_session_time() {
        let events: CursorEvents = serde_json::from_str(
            r#"{
                "clicks": [{
                    "active_modifiers": [],
                    "cursor_num": 0,
                    "cursor_id": "pointer",
                    "time_ms": 42.5,
                    "down": true
                }],
                "moves": [{
                    "active_modifiers": [],
                    "cursor_id": "pointer",
                    "time_ms": 42.0,
                    "x": 0.5,
                    "y": 0.5
                }]
            }"#,
        )
        .expect("legacy cursor event JSON should remain readable");

        assert_eq!(events.moves[0].session_time_us, None);
        assert_eq!(events.clicks[0].session_time_us, None);
    }

    #[test]
    fn serializes_session_time_when_present() {
        let mut event = move_event(42.0, "pointer");
        event.session_time_us = Some(42_000);

        let json = serde_json::to_string(&event).expect("cursor event serializes");

        assert!(json.contains("\"session_time_us\":42000"));
    }

    #[test]
    fn session_clock_load_keeps_segment_media_time() {
        let mut move_event = move_event(9.0, "pointer");
        move_event.session_time_us = Some(42_250);
        let mut click_event = click_event(8.0, "pointer");
        click_event.session_time_us = Some(42_500);
        let events = CursorEvents {
            moves: vec![move_event],
            clicks: vec![click_event],
        };
        let directory = tempfile::tempdir().expect("temporary directory is available");
        let path = directory.path().join("cursor.json");
        std::fs::write(
            &path,
            serde_json::to_string(&events).expect("cursor events serialize"),
        )
        .expect("cursor events are written");

        let events = CursorEvents::load_from_file(&path).expect("cursor events load");

        assert_eq!(events.moves[0].time_ms, 9.0);
        assert_eq!(events.clicks[0].time_ms, 8.0);
        assert_eq!(events.moves[0].resolved_time_ms(), 9.0);
        assert_eq!(events.clicks[0].resolved_time_ms(), 8.0);
        assert_eq!(events.moves[0].session_time_ms(), Some(42.25));
        assert_eq!(events.clicks[0].session_time_ms(), Some(42.5));
    }

    #[test]
    fn timeline_offset_preserves_session_clock_and_separates_segments() {
        let mut first = CursorEvents {
            moves: vec![],
            clicks: vec![click_event(1_000.0, "pointer")],
        };
        first.clicks[0].session_time_us = Some(1_000_000);

        let mut second = CursorEvents {
            moves: vec![],
            clicks: vec![click_event(1_500.0, "pointer")],
        };
        second.clicks[0].session_time_us = Some(9_500_000);
        second.offset_timeline_time_ms(5_000.0);

        assert_eq!(second.clicks[0].time_ms, 6_500.0);
        assert_eq!(second.clicks[0].session_time_us, Some(9_500_000));

        first.clicks.extend(second.clicks);
        let zooms = generate_auto_zoom_segments(first.clicks, 12.0);

        assert_eq!(zooms.len(), 2);
        assert_eq!((zooms[0].start, zooms[0].end), (0.7, 3.5));
        assert_eq!((zooms[1].start, zooms[1].end), (6.2, 9.0));
        assert!(zooms.windows(2).all(|pair| pair[0].end <= pair[1].start));
    }

    #[test]
    fn auto_zoom_accepts_only_primary_button_down_events() {
        let mut secondary = click_event(1_800.0, "pointer");
        secondary.cursor_num = 1;
        let mut primary_up = click_event(2_600.0, "pointer");
        primary_up.down = false;

        let zooms = generate_auto_zoom_segments(
            vec![secondary, primary_up, click_event(1_000.0, "pointer")],
            12.0,
        );

        assert_eq!(zooms.len(), 1);
        assert_eq!((zooms[0].start, zooms[0].end), (0.7, 3.5));
    }

    #[test]
    fn auto_zoom_enforces_seven_hundred_ms_cooldown() {
        let zooms = generate_auto_zoom_segments(
            vec![
                click_event(1_000.0, "pointer"),
                click_event(1_600.0, "pointer"),
            ],
            12.0,
        );

        assert_eq!(zooms.len(), 1);
        assert_eq!((zooms[0].start, zooms[0].end), (0.7, 3.5));
    }

    #[test]
    fn auto_zoom_is_deterministic_for_unordered_and_invalid_input() {
        let mut invalid = click_event(f64::NAN, "pointer");
        invalid.session_time_us = Some(9_999_999);

        let input = vec![
            click_event(7_000.0, "pointer"),
            invalid,
            click_event(1_000.0, "pointer"),
            click_event(4_000.0, "pointer"),
        ];
        let first = generate_auto_zoom_segments(input.clone(), 12.0);
        let second = generate_auto_zoom_segments(input.into_iter().rev().collect(), 12.0);

        assert_eq!(
            serde_json::to_vec(&first).expect("zoom output serializes"),
            serde_json::to_vec(&second).expect("zoom output serializes"),
        );
        assert!(first.iter().all(|zoom| {
            zoom.start.is_finite()
                && zoom.end.is_finite()
                && zoom.start >= 0.0
                && zoom.end > zoom.start
        }));
    }
}
