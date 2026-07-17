use cap_project::{
    MaskCoordinateSpace, MaskKind, MaskScalarKeyframe, MaskSegment, MaskVectorKeyframe, XY,
    mask_effect_contract,
};

use crate::{MaskRenderMode, PreparedMask};

const MASK_EFFECT_BASE_HEIGHT: f32 = 1080.0;

fn interpolate_vector(base: XY<f64>, keys: &[MaskVectorKeyframe], time: f64) -> XY<f64> {
    if keys.is_empty() {
        return base;
    }

    let mut sorted = keys.to_vec();
    sorted.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if time <= sorted[0].time {
        return XY::new(sorted[0].x, sorted[0].y);
    }

    for window in sorted.windows(2) {
        let prev = &window[0];
        let next = &window[1];
        if time <= next.time {
            let span = (next.time - prev.time).max(1e-6);
            let t = ((time - prev.time) / span).clamp(0.0, 1.0);
            let x = prev.x + (next.x - prev.x) * t;
            let y = prev.y + (next.y - prev.y) * t;
            return XY::new(x, y);
        }
    }

    let last = sorted.last().unwrap();
    XY::new(last.x, last.y)
}

fn interpolate_scalar(base: f64, keys: &[MaskScalarKeyframe], time: f64) -> f64 {
    if keys.is_empty() {
        return base;
    }

    let mut sorted = keys.to_vec();
    sorted.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if time <= sorted[0].time {
        return sorted[0].value;
    }

    for window in sorted.windows(2) {
        let prev = &window[0];
        let next = &window[1];
        if time <= next.time {
            let span = (next.time - prev.time).max(1e-6);
            let t = ((time - prev.time) / span).clamp(0.0, 1.0);
            return prev.value + (next.value - prev.value) * t;
        }
    }

    sorted.last().map(|k| k.value).unwrap_or(base)
}

/// Produces legacy final-output masks. These retain their original canvas
/// coordinate meaning for existing projects.
pub fn interpolate_output_masks(
    output_size: XY<u32>,
    frame_time: f64,
    segments: &[MaskSegment],
) -> Vec<PreparedMask> {
    interpolate_masks_for_space(
        output_size,
        frame_time,
        segments,
        MaskCoordinateSpace::Output,
    )
}

/// Produces source-space masks for new `displayContent` segments. The result
/// is applied directly to the decoded display texture before crop, zoom, and
/// split layout, so it follows the protected source pixels by construction.
pub fn interpolate_display_content_masks(
    source_size: XY<u32>,
    frame_time: f64,
    segments: &[MaskSegment],
) -> Vec<PreparedMask> {
    interpolate_masks_for_space(
        source_size,
        frame_time,
        segments,
        MaskCoordinateSpace::DisplayContent,
    )
}

fn interpolate_masks_for_space(
    output_size: XY<u32>,
    frame_time: f64,
    segments: &[MaskSegment],
    coordinate_space: MaskCoordinateSpace,
) -> Vec<PreparedMask> {
    let mut prepared = Vec::new();

    for segment in segments
        .iter()
        .filter(|s| s.enabled && s.coordinate_space == coordinate_space)
    {
        if frame_time < segment.start || frame_time > segment.end {
            continue;
        }

        let relative_time = (frame_time - segment.start).max(0.0);

        let position =
            interpolate_vector(segment.center, &segment.keyframes.position, relative_time);
        let size = interpolate_vector(segment.size, &segment.keyframes.size, relative_time);
        let (mode, opacity, effect_amount) = match segment.mask_type {
            MaskKind::Sensitive => {
                let (mode, effect_amount) = sensitive_effect(segment.pixelation);
                (mode, 1.0, effect_amount)
            }
            MaskKind::Highlight => {
                let mut intensity = interpolate_scalar(
                    segment.opacity,
                    &segment.keyframes.intensity,
                    relative_time,
                );
                let fade_duration = segment.fade_duration.max(0.0);
                if fade_duration > 0.0 {
                    let time_since_start = (frame_time - segment.start).max(0.0);
                    let time_until_end = (segment.end - frame_time).max(0.0);
                    let fade_in = (time_since_start / fade_duration).min(1.0);
                    let fade_out = (time_until_end / fade_duration).min(1.0);
                    intensity *= fade_in * fade_out;
                }
                (MaskRenderMode::Highlight, intensity.clamp(0.0, 1.0), 0.0)
            }
        };

        let clamped_size = XY::new(size.x.clamp(0.01, 2.0), size.y.clamp(0.01, 2.0));
        let min_axis = clamped_size.x.min(clamped_size.y).abs();
        let segment_feather = if let MaskKind::Highlight = segment.mask_type {
            0.0
        } else {
            segment.feather
        };
        let feather = (min_axis * 0.5 * segment_feather.max(0.0)).max(0.0001) as f32;

        let prepared_center = match coordinate_space {
            // Preserve historical output-canvas behaviour for saved projects.
            MaskCoordinateSpace::Output => XY::new(
                position.x.clamp(0.0, 1.0) as f32,
                position.y.clamp(0.0, 1.0) as f32,
            ),
            // A source region can move partially outside the output during a
            // zoom/pan. Keep its real geometry so the shader clips it instead
            // of moving the mask back over unrelated content.
            MaskCoordinateSpace::DisplayContent => XY::new(position.x as f32, position.y as f32),
        };

        prepared.push(PreparedMask {
            center: prepared_center,
            size: XY::new(
                clamped_size.x.clamp(0.0, 2.0) as f32,
                clamped_size.y.clamp(0.0, 2.0) as f32,
            ),
            feather,
            opacity: opacity as f32,
            effect_size: scaled_effect_size(output_size, effect_amount),
            darkness: segment.darkness.clamp(0.0, 1.0) as f32,
            mode,
            output_size,
        });
    }

    prepared
}

fn sensitive_effect(stored_effect: f64) -> (MaskRenderMode, f64) {
    let contract = mask_effect_contract();
    let stored_effect = if stored_effect.is_finite() {
        stored_effect
    } else {
        contract.default_amount
    };
    if stored_effect >= contract.blur_encoding_offset {
        (
            MaskRenderMode::Blur,
            normalize_effect_amount(stored_effect - contract.blur_encoding_offset),
        )
    } else {
        (
            MaskRenderMode::Pixelate,
            normalize_effect_amount(stored_effect),
        )
    }
}

fn normalize_effect_amount(amount: f64) -> f64 {
    let contract = mask_effect_contract();
    if amount <= 0.0 {
        contract.default_amount
    } else {
        amount.clamp(contract.min_amount, contract.max_amount)
    }
}

fn scaled_effect_size(output_size: XY<u32>, amount: f64) -> f32 {
    let resolution_scale = output_size.y as f32 / MASK_EFFECT_BASE_HEIGHT;
    amount as f32 * resolution_scale
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_segment() -> MaskSegment {
        MaskSegment {
            start: 0.0,
            end: 10.0,
            track: 0,
            enabled: true,
            mask_type: MaskKind::Sensitive,
            coordinate_space: MaskCoordinateSpace::Output,
            center: XY::new(0.5, 0.5),
            size: XY::new(0.25, 0.25),
            feather: 0.1,
            opacity: 1.0,
            pixelation: 18.0,
            darkness: 0.5,
            fade_duration: 0.0,
            keyframes: Default::default(),
        }
    }

    #[test]
    fn sensitive_mask_effect_scales_with_output_height() {
        let segment = sample_segment();
        let smaller =
            interpolate_output_masks(XY::new(872, 720), 1.0, std::slice::from_ref(&segment));
        let low =
            interpolate_output_masks(XY::new(1308, 1080), 1.0, std::slice::from_ref(&segment));
        let high = interpolate_output_masks(XY::new(2616, 2160), 1.0, &[segment]);

        assert_eq!(smaller.len(), 1);
        assert_eq!(low.len(), 1);
        assert_eq!(high.len(), 1);
        assert_eq!(smaller[0].effect_size, 12.0);
        assert_eq!(low[0].effect_size, 18.0);
        assert_eq!(high[0].effect_size, 36.0);
    }

    #[test]
    fn sensitive_mask_never_blends_with_source_content() {
        let mut segment = sample_segment();
        segment.opacity = 0.01;
        segment.keyframes.intensity.push(MaskScalarKeyframe {
            time: 1.0,
            value: 0.01,
        });

        let masks = interpolate_output_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].opacity, 1.0);
        assert_eq!(masks[0].mode, MaskRenderMode::Pixelate);
    }

    #[test]
    fn persisted_effect_encoding_matches_the_desktop_contract() {
        for (stored_effect, expected_mode, expected_size) in [
            (18.0, MaskRenderMode::Pixelate, 18.0),
            (1001.0, MaskRenderMode::Blur, 4.0),
            (1024.0, MaskRenderMode::Blur, 24.0),
            (1080.0, MaskRenderMode::Blur, 80.0),
        ] {
            let mut segment = sample_segment();
            segment.pixelation = stored_effect;

            let masks = interpolate_output_masks(XY::new(1920, 1080), 1.0, &[segment]);

            assert_eq!(masks[0].mode, expected_mode);
            assert_eq!(masks[0].effect_size, expected_size);
            assert_eq!(masks[0].opacity, 1.0);
        }
    }

    #[test]
    fn missing_legacy_pixelation_uses_a_visible_safe_default() {
        let mut segment = sample_segment();
        segment.pixelation = 0.0;

        let masks = interpolate_output_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].mode, MaskRenderMode::Pixelate);
        assert_eq!(masks[0].effect_size, 16.0);
    }

    #[test]
    fn display_content_mask_stays_in_source_space_before_crop_and_zoom() {
        let mut segment = sample_segment();
        segment.coordinate_space = MaskCoordinateSpace::DisplayContent;
        segment.center = XY::new(0.25, 0.75);
        segment.size = XY::new(0.2, 0.1);
        let masks = interpolate_display_content_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks.len(), 1);
        assert_eq!(masks[0].center, XY::new(0.25, 0.75));
        assert_eq!(masks[0].size, XY::new(0.2, 0.1));
    }

    #[test]
    fn legacy_output_mask_ignores_display_placement() {
        let segment = sample_segment();
        let masks = interpolate_output_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].center, XY::new(0.5, 0.5));
        assert_eq!(masks[0].size, XY::new(0.25, 0.25));
    }

    #[test]
    fn display_content_masks_do_not_leak_into_legacy_output_pass() {
        let mut segment = sample_segment();
        segment.coordinate_space = MaskCoordinateSpace::DisplayContent;
        segment.center = XY::new(0.0, 0.5);
        let masks = interpolate_output_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert!(masks.is_empty());
    }
}
