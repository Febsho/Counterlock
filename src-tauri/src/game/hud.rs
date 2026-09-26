//! Crop a local capture to the selected game monitor before scoreboard OCR.
//! Tauri supplies physical monitor rectangles; the screenshot backend returns
//! one PNG for the virtual desktop.
use anyhow::{anyhow, bail, Result};
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::Serialize;
use std::io::Cursor;
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn monitors(app: &tauri::AppHandle) -> Result<Vec<MonitorInfo>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("main window is unavailable"))?;
    let mut screens = window
        .available_monitors()?
        .into_iter()
        .map(|monitor| MonitorInfo {
            index: 0,
            name: monitor.name().cloned().unwrap_or_else(|| "Display".into()),
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect::<Vec<_>>();
    screens.sort_by_key(|screen| (screen.x, screen.y));
    for (index, screen) in screens.iter_mut().enumerate() {
        screen.index = index;
    }
    Ok(screens)
}

pub fn crop_png(bytes: &[u8], screens: &[MonitorInfo], index: usize) -> Result<Vec<u8>> {
    let screen = screens
        .get(index)
        .ok_or_else(|| anyhow!("unknown monitor"))?;
    let image = image::load_from_memory_with_format(bytes, ImageFormat::Png)?;
    let bounds = screens
        .iter()
        .fold(None::<(i64, i64, i64, i64)>, |bounds, monitor| {
            let right = i64::from(monitor.x) + i64::from(monitor.width);
            let bottom = i64::from(monitor.y) + i64::from(monitor.height);
            Some(match bounds {
                None => (i64::from(monitor.x), i64::from(monitor.y), right, bottom),
                Some((left, top, max_right, max_bottom)) => (
                    left.min(i64::from(monitor.x)),
                    top.min(i64::from(monitor.y)),
                    max_right.max(right),
                    max_bottom.max(bottom),
                ),
            })
        });
    let Some((left, top, right, bottom)) = bounds else {
        bail!("no monitors were reported");
    };
    let scale_x = f64::from(image.width()) / (right - left) as f64;
    let scale_y = f64::from(image.height()) / (bottom - top) as f64;
    if (scale_x - scale_y).abs() > 0.05 || scale_x <= 0.0 {
        bail!("screenshot dimensions do not match the monitor layout");
    }
    let x = ((i64::from(screen.x) - left) as f64 * scale_x).round() as u32;
    let y = ((i64::from(screen.y) - top) as f64 * scale_y).round() as u32;
    let width = (f64::from(screen.width) * scale_x).round() as u32;
    let height = (f64::from(screen.height) * scale_y).round() as u32;
    if width == 0 || height == 0 || x + width > image.width() || y + height > image.height() {
        bail!("selected monitor lies outside the screenshot");
    }
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image.view(x, y, width, height).to_image())
        .write_to(&mut output, ImageFormat::Png)?;
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    #[test]
    fn crops_the_selected_monitor_with_relative_desktop_coordinates() {
        let screens = vec![
            MonitorInfo {
                index: 0,
                name: "Left".into(),
                x: -4,
                y: 0,
                width: 4,
                height: 3,
            },
            MonitorInfo {
                index: 1,
                name: "Right".into(),
                x: 0,
                y: 1,
                width: 6,
                height: 2,
            },
        ];
        let image = ImageBuffer::from_fn(10, 3, |x, _| {
            if x < 4 {
                Rgba([255, 0, 0, 255])
            } else {
                Rgba([0, 0, 255, 255])
            }
        });
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let cropped = crop_png(&encoded.into_inner(), &screens, 1).unwrap();
        let decoded = image::load_from_memory(&cropped).unwrap();
        assert_eq!(decoded.dimensions(), (6, 2));
        assert_eq!(decoded.get_pixel(0, 0), Rgba([0, 0, 255, 255]));
        assert!(crop_png(&cropped, &screens, 2).is_err());
    }
}
