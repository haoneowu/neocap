use std::path::PathBuf;

use base64::{Engine, engine::general_purpose::STANDARD};
use cap_project::{RecordingMeta, XY};
use cap_rendering::{
    FrameRenderer, ProjectUniforms, RenderedFrame, RendererLayers, ZoomTransformTimeline,
};
use image::codecs::jpeg::JpegEncoder;
use serde::{Deserialize, Serialize};

use crate::{ExportError, ExporterBase, make_cursor_only_project};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ExportPreviewSettings {
    pub fps: u32,
    pub resolution_base: XY<u32>,
    pub compression_bpp: f32,
    #[serde(default)]
    pub cursor_only: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPreviewResult {
    pub jpeg_base64: String,
    pub estimated_size_mb: f64,
    pub actual_width: u32,
    pub actual_height: u32,
    pub frame_render_time_ms: f64,
    pub total_frames: u32,
}

pub async fn render_preview(
    project_path: PathBuf,
    frame_time: f64,
    settings: ExportPreviewSettings,
    force_ffmpeg_decoder: bool,
) -> Result<ExportPreviewResult, ExportError> {
    let mut exporter_builder =
        ExporterBase::builder(project_path.clone()).with_force_ffmpeg_decoder(force_ffmpeg_decoder);

    if settings.cursor_only {
        let meta = RecordingMeta::load_for_project(&project_path)
            .map_err(|e| ExportError::Other(format!("Failed to load recording meta: {e}")))?;
        exporter_builder =
            exporter_builder.with_config(make_cursor_only_project(meta.project_config()));
    }

    let exporter_base = exporter_builder
        .build()
        .await
        .map_err(|e| ExportError::Other(format!("Exporter build error: {e}")))?;

    render_preview_with_base(exporter_base, frame_time, settings).await
}

async fn render_preview_with_base(
    exporter_base: ExporterBase,
    frame_time: f64,
    settings: ExportPreviewSettings,
) -> Result<ExportPreviewResult, ExportError> {
    let render_start = std::time::Instant::now();
    let (frame, duration_seconds) =
        render_preview_frame_with_base(exporter_base, frame_time, settings).await?;
    let frame_render_time_ms = render_start.elapsed().as_secs_f64() * 1000.0;
    let width = frame.width;
    let height = frame.height;

    let rgb_data: Vec<u8> = frame
        .data
        .chunks(frame.padded_bytes_per_row as usize)
        .flat_map(|row| {
            row[0..(frame.width * 4) as usize]
                .chunks(4)
                .flat_map(|chunk| [chunk[0], chunk[1], chunk[2]])
        })
        .collect();

    let mut jpeg_buffer = Vec::new();
    {
        let mut encoder = JpegEncoder::new_with_quality(
            &mut jpeg_buffer,
            bpp_to_jpeg_quality(settings.compression_bpp),
        );
        encoder
            .encode(&rgb_data, width, height, image::ExtendedColorType::Rgb8)
            .map_err(|e| ExportError::Other(format!("Failed to encode JPEG: {e}")))?;
    }

    let fps_f64 = settings.fps as f64;
    let total_frames = (duration_seconds * fps_f64).ceil() as u32;
    let total_pixels = (settings.resolution_base.x * settings.resolution_base.y) as f64;
    let estimated_size_mb = if settings.cursor_only {
        let total_frames_f64 = (duration_seconds * fps_f64).ceil();
        estimate_cursor_only_size_mb(total_pixels, total_frames_f64)
    } else {
        let effective_fps = ((fps_f64 - 30.0).max(0.0) * 0.6) + fps_f64.min(30.0);
        let video_bitrate = total_pixels * settings.compression_bpp as f64 * effective_fps;
        let audio_bitrate = 192_000.0;
        let total_bitrate = video_bitrate + audio_bitrate;
        let encoder_efficiency = 0.5;
        (total_bitrate * encoder_efficiency * duration_seconds) / (8.0 * 1024.0 * 1024.0)
    };

    Ok(ExportPreviewResult {
        jpeg_base64: STANDARD.encode(&jpeg_buffer),
        estimated_size_mb,
        actual_width: width,
        actual_height: height,
        frame_render_time_ms,
        total_frames,
    })
}

async fn render_preview_frame_with_base(
    exporter_base: ExporterBase,
    frame_time: f64,
    settings: ExportPreviewSettings,
) -> Result<(RenderedFrame, f64), ExportError> {
    let Some((segment_time, segment)) = exporter_base.project_config.get_segment_time(frame_time)
    else {
        return Err(ExportError::Other(
            "Frame time is outside video duration".to_string(),
        ));
    };

    let segment_media = exporter_base
        .segments
        .get(segment.recording_clip as usize)
        .ok_or_else(|| ExportError::Other("Recording clip is unavailable".to_string()))?;
    let clip_config = exporter_base
        .project_config
        .clips
        .iter()
        .find(|v| v.index == segment.recording_clip);

    let segment_frames = segment_media
        .decoders
        .get_frames(
            segment_time as f32,
            !exporter_base.project_config.camera.hide,
            !settings.cursor_only,
            clip_config.map(|v| v.offsets).unwrap_or_default(),
        )
        .await
        .ok_or_else(|| ExportError::Other("Failed to decode frame".to_string()))?;

    let frame_number = (frame_time * settings.fps as f64).floor() as u32;
    let total_duration = cap_rendering::get_duration(
        &exporter_base.recordings,
        &exporter_base.recording_meta,
        &exporter_base.studio_meta,
        &exporter_base.project_config,
    );

    let mut zoom_timeline = ZoomTransformTimeline::from_project(
        &exporter_base.project_config,
        &segment_media.cursor,
        total_duration,
        exporter_base.render_constants.options.screen_size,
    );
    zoom_timeline.ensure_precomputed_until((frame_number as f32 + 1.0) / settings.fps as f32);

    let uniforms = ProjectUniforms::new(
        &exporter_base.render_constants,
        &exporter_base.project_config,
        frame_number,
        settings.fps,
        settings.resolution_base,
        &segment_media.cursor,
        &segment_frames,
        total_duration,
        &zoom_timeline,
    );

    let mut frame_renderer = FrameRenderer::new(&exporter_base.render_constants);
    let mut layers = RendererLayers::new_with_options(
        &exporter_base.render_constants.device,
        &exporter_base.render_constants.queue,
        exporter_base.render_constants.is_software_adapter,
    );

    let frame = frame_renderer
        .render_immediate(
            segment_frames,
            uniforms,
            &segment_media.cursor,
            !settings.cursor_only,
            &mut layers,
        )
        .await?;

    Ok((frame, total_duration))
}

fn estimate_cursor_only_size_mb(total_pixels: f64, total_frames: f64) -> f64 {
    let bytes_per_frame = total_pixels * 0.4;
    (bytes_per_frame * total_frames) / (1024.0 * 1024.0)
}

fn bpp_to_jpeg_quality(bpp: f32) -> u8 {
    ((bpp - 0.04) / (0.3 - 0.04) * (95.0 - 40.0) + 40.0).clamp(40.0, 95.0) as u8
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::Path, process::Command};

    use cap_project::{
        AspectRatio, BackgroundSource, CameraShape, CaptionSegment, CaptionSettings,
        CaptionTrackSegment, CaptionWord, CaptionsData, CursorClickEvent, CursorEvents,
        CursorMoveEvent, GlideDirection, MaskCoordinateSpace, MaskKeyframes, MaskKind, MaskSegment,
        ProjectConfiguration, TimelineConfiguration, TimelineSegment, XY, ZoomMode, ZoomSegment,
    };
    use cap_rendering::RenderedFrame;
    use tempfile::TempDir;

    use super::{ExportPreviewSettings, render_preview_frame_with_base};
    use crate::ExporterBase;

    const FIXTURE_FPS: u32 = 30;
    const FIXTURE_DURATION_SECS: u32 = 2;
    const FIXTURE_OUTPUT_SIZE: XY<u32> = XY::new(360, 640);

    fn fixture_project_configuration() -> ProjectConfiguration {
        let mut project = ProjectConfiguration::default();
        project.aspect_ratio = Some(AspectRatio::Vertical);
        project.background.source = BackgroundSource::Color {
            value: [16, 22, 42],
            alpha: u8::MAX,
        };
        project.background.padding = 6.0;
        project.background.rounding = 10.0;
        project.camera.shape = CameraShape::Circle;
        project.camera.manual_position = Some(XY::new(0.8, 0.2));
        project.camera.size = 28.0;
        project.cursor = serde_json::from_value(serde_json::json!({
            "type": "circle",
            "useSvg": false,
            "hideWhenIdle": false,
            "raw": false,
        }))
        .expect("fixture cursor configuration must deserialize");
        project.captions = Some(CaptionsData {
            source_timed: true,
            settings: CaptionSettings {
                enabled: true,
                size: 64,
                position: "bottom-center".to_string(),
                background_opacity: 76,
                active_word_highlight: true,
                word_animation: true,
                preset: "reels-bounce".to_string(),
                animation: "pop".to_string(),
                ..Default::default()
            },
            segments: vec![CaptionSegment {
                id: "p0-caption".to_string(),
                start: 0.35,
                end: 1.55,
                text: "你好 NeoCap".to_string(),
                words: vec![
                    CaptionWord {
                        text: "你好".to_string(),
                        start: 0.35,
                        end: 0.9,
                    },
                    CaptionWord {
                        text: "NeoCap".to_string(),
                        start: 0.9,
                        end: 1.55,
                    },
                ],
            }],
        });
        project.timeline = Some(TimelineConfiguration {
            segments: vec![TimelineSegment {
                recording_clip: 0,
                start: 0.0,
                end: f64::from(FIXTURE_DURATION_SECS),
                timescale: 1.0,
                name: None,
            }],
            zoom_segments: vec![ZoomSegment {
                start: 0.35,
                end: 1.55,
                amount: 1.7,
                mode: ZoomMode::Auto,
                glide_direction: GlideDirection::None,
                glide_speed: 0.5,
                instant_animation: true,
                edge_snap_ratio: 0.25,
            }],
            scene_segments: Vec::new(),
            mask_segments: vec![MaskSegment {
                start: 0.35,
                end: 1.55,
                track: 0,
                enabled: true,
                mask_type: MaskKind::Sensitive,
                coordinate_space: MaskCoordinateSpace::DisplayContent,
                center: XY::new(0.68, 0.52),
                size: XY::new(0.26, 0.34),
                feather: 0.0,
                opacity: 1.0,
                pixelation: 24.0,
                darkness: 0.0,
                fade_duration: 0.0,
                keyframes: MaskKeyframes::default(),
            }],
            text_segments: Vec::new(),
            caption_segments: vec![CaptionTrackSegment {
                id: "p0-caption".to_string(),
                start: 0.35,
                end: 1.55,
                text: "你好 NeoCap".to_string(),
                words: vec![
                    CaptionWord {
                        text: "你好".to_string(),
                        start: 0.35,
                        end: 0.9,
                    },
                    CaptionWord {
                        text: "NeoCap".to_string(),
                        start: 0.9,
                        end: 1.55,
                    },
                ],
                fade_duration_override: Some(0.0),
                linger_duration_override: Some(0.0),
                position_override: None,
                color_override: None,
                background_color_override: None,
                font_size_override: None,
            }],
            keyboard_segments: Vec::new(),
            audio_segments: Vec::new(),
        });
        project
    }

    fn run_ffmpeg(output: &Path, source: &str) -> Result<(), Box<dyn std::error::Error>> {
        let output = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                source,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                output.to_str().ok_or("fixture output path is not UTF-8")?,
            ])
            .output()?;
        if output.status.success() {
            return Ok(());
        }

        Err(format!(
            "ffmpeg fixture generation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into())
    }

    fn create_fixture_project()
    -> Result<(TempDir, ProjectConfiguration), Box<dyn std::error::Error>> {
        let temp_dir = tempfile::tempdir()?;
        let project_path = temp_dir.path();
        let content_path = project_path.join("content");
        fs::create_dir_all(&content_path)?;

        run_ffmpeg(
            &content_path.join("display.mp4"),
            "testsrc2=size=320x180:rate=30:duration=2",
        )?;
        run_ffmpeg(
            &content_path.join("camera.mp4"),
            "color=c=0x16c172:size=160x120:rate=30:duration=2",
        )?;

        write_fixture_cursor_events(&content_path.join("cursor.json"), 0.68, 0.52)?;

        fs::write(
            project_path.join("recording-meta.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "pretty_name": "NeoCap P0 composition fixture",
                "sharing": null,
                "display": { "path": "content/display.mp4", "fps": FIXTURE_FPS, "start_time": 0.0 },
                "camera": { "path": "content/camera.mp4", "fps": FIXTURE_FPS, "start_time": 0.0 },
                "audio": null,
                "cursor": "content/cursor.json"
            }))?,
        )?;

        let project = fixture_project_configuration();
        project.write(project_path)?;
        Ok((temp_dir, project))
    }

    fn write_fixture_cursor_events(
        path: &Path,
        x: f64,
        y: f64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let cursor = CursorEvents {
            moves: vec![
                CursorMoveEvent {
                    active_modifiers: Vec::new(),
                    cursor_id: "fixture".to_string(),
                    session_time_us: Some(300_000),
                    time_ms: 300.0,
                    x,
                    y,
                },
                CursorMoveEvent {
                    active_modifiers: Vec::new(),
                    cursor_id: "fixture".to_string(),
                    session_time_us: Some(1_100_000),
                    time_ms: 1_100.0,
                    x,
                    y,
                },
            ],
            clicks: vec![CursorClickEvent {
                active_modifiers: Vec::new(),
                cursor_num: 0,
                cursor_id: "fixture".to_string(),
                session_time_us: Some(700_000),
                time_ms: 700.0,
                down: true,
            }],
        };
        fs::write(path, serde_json::to_vec_pretty(&cursor)?)?;
        Ok(())
    }

    async fn render_fixture(
        project_path: &Path,
        config: Option<ProjectConfiguration>,
    ) -> Result<RenderedFrame, Box<dyn std::error::Error>> {
        let mut builder =
            ExporterBase::builder(project_path.to_path_buf()).with_force_ffmpeg_decoder(true);
        if let Some(config) = config {
            builder = builder.with_config(config);
        }
        let base = builder
            .build()
            .await
            .map_err(|error| format!("failed to build P0 composition fixture exporter: {error}"))?;
        let (frame, _) = render_preview_frame_with_base(
            base,
            0.95,
            ExportPreviewSettings {
                fps: FIXTURE_FPS,
                resolution_base: FIXTURE_OUTPUT_SIZE,
                compression_bpp: 0.3,
                cursor_only: false,
            },
        )
        .await
        .map_err(|error| format!("failed to render P0 composition fixture: {error}"))?;
        Ok(frame)
    }

    fn mean_abs_difference(left: &RenderedFrame, right: &RenderedFrame) -> f64 {
        assert_eq!((left.width, left.height), (right.width, right.height));
        let row_bytes = left.width as usize * 4;
        let mut total = 0u64;
        let mut samples = 0u64;

        for row in 0..left.height as usize {
            let left_row = &left.data[row * left.padded_bytes_per_row as usize
                ..row * left.padded_bytes_per_row as usize + row_bytes];
            let right_row = &right.data[row * right.padded_bytes_per_row as usize
                ..row * right.padded_bytes_per_row as usize + row_bytes];
            for (left, right) in left_row.iter().zip(right_row) {
                total += u64::from(left.abs_diff(*right));
                samples += 1;
            }
        }

        total as f64 / samples as f64
    }

    fn dominant_green_pixels(frame: &RenderedFrame) -> usize {
        let row_bytes = frame.width as usize * 4;
        (0..frame.height as usize)
            .flat_map(|row| {
                frame.data[row * frame.padded_bytes_per_row as usize
                    ..row * frame.padded_bytes_per_row as usize + row_bytes]
                    .chunks_exact(4)
            })
            .filter(|pixel| {
                pixel[1] > pixel[0].saturating_add(35)
                    && pixel[1] > pixel[2].saturating_add(35)
                    && pixel[1] > 70
            })
            .count()
    }

    fn frame_image(frame: &RenderedFrame) -> image::RgbaImage {
        let row_bytes = frame.width as usize * 4;
        let mut data = Vec::with_capacity(row_bytes * frame.height as usize);
        for row in 0..frame.height as usize {
            data.extend_from_slice(
                &frame.data[row * frame.padded_bytes_per_row as usize
                    ..row * frame.padded_bytes_per_row as usize + row_bytes],
            );
        }
        image::RgbaImage::from_raw(frame.width, frame.height, data)
            .expect("rendered frame must have a complete RGBA image buffer")
    }

    fn compare_golden_reference(frame: &RenderedFrame) -> Result<(), Box<dyn std::error::Error>> {
        let Ok(path) = env::var("CAP_P0_GOLDEN_REFERENCE") else {
            return Ok(());
        };
        let actual = frame_image(frame);
        let expected = image::open(path)?.to_rgba8();
        assert_eq!(actual.dimensions(), expected.dimensions());
        let total = actual
            .as_raw()
            .iter()
            .zip(expected.as_raw())
            .map(|(actual, expected)| u64::from(actual.abs_diff(*expected)))
            .sum::<u64>();
        let mean_abs_difference = total as f64 / actual.as_raw().len() as f64;
        let tolerance = env::var("CAP_P0_GOLDEN_MAX_MAD")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(3.0);
        assert!(mean_abs_difference <= tolerance);
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn neocap_p0_composition_fixture_renders_all_local_layers()
    -> Result<(), Box<dyn std::error::Error>> {
        let (temp_dir, project) = create_fixture_project()?;
        let p0_frame = render_fixture(temp_dir.path(), None).await?;
        if let Ok(path) = env::var("CAP_P0_GOLDEN_CANDIDATE") {
            if let Some(parent) = Path::new(&path).parent() {
                fs::create_dir_all(parent)?;
            }
            frame_image(&p0_frame).save(path)?;
        }
        compare_golden_reference(&p0_frame)?;

        assert_eq!(p0_frame.width, FIXTURE_OUTPUT_SIZE.x);
        assert!(p0_frame.height > p0_frame.width);
        assert!(p0_frame.height <= FIXTURE_OUTPUT_SIZE.y);

        let mut camera_hidden = project.clone();
        camera_hidden.camera.hide = true;
        let camera_hidden_frame = render_fixture(temp_dir.path(), Some(camera_hidden)).await?;
        let p0_green = dominant_green_pixels(&p0_frame);
        let camera_hidden_green = dominant_green_pixels(&camera_hidden_frame);
        assert!(p0_green > camera_hidden_green + 2_000);

        let mut without_masks = project.clone();
        without_masks
            .timeline
            .as_mut()
            .expect("fixture timeline exists")
            .mask_segments
            .clear();
        let without_masks_frame = render_fixture(temp_dir.path(), Some(without_masks)).await?;
        assert!(mean_abs_difference(&p0_frame, &without_masks_frame) > 0.25);

        let mut without_zoom = project.clone();
        without_zoom
            .timeline
            .as_mut()
            .expect("fixture timeline exists")
            .zoom_segments
            .clear();
        let without_zoom_frame = render_fixture(temp_dir.path(), Some(without_zoom)).await?;
        assert!(mean_abs_difference(&p0_frame, &without_zoom_frame) > 1.0);

        let mut without_captions = project.clone();
        without_captions.captions = None;
        without_captions
            .timeline
            .as_mut()
            .expect("fixture timeline exists")
            .caption_segments
            .clear();
        let without_captions_frame =
            render_fixture(temp_dir.path(), Some(without_captions)).await?;
        assert!(mean_abs_difference(&p0_frame, &without_captions_frame) > 0.35);

        write_fixture_cursor_events(&temp_dir.path().join("content/cursor.json"), 0.22, 0.3)?;
        let cursor_follow_frame = render_fixture(temp_dir.path(), Some(project)).await?;
        assert!(mean_abs_difference(&p0_frame, &cursor_follow_frame) > 1.0);

        Ok(())
    }
}
