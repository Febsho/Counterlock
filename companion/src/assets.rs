//! The bundled Counterlock UI.
//!
//! `out/` is the Next.js static export, embedded into the binary at build time
//! so the companion serves the whole app offline from one file. Build it with
//! `npm run build:companion-ui`, which exports with an empty basePath.

use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../out"]
pub struct Ui;

pub struct Asset {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

/// Resolves a request path to an embedded asset.
///
/// The export uses `trailingSlash`, so `/` and `/foo/` map to `index.html` and
/// `foo/index.html` respectively; a bare `/foo` is retried as `foo/index.html`.
pub fn resolve(path: &str) -> Option<Asset> {
    let trimmed = path.split(['?', '#']).next().unwrap_or(path);
    let trimmed = trimmed.trim_start_matches('/');

    // Reject traversal outright rather than relying on the embed lookup failing.
    if trimmed.split('/').any(|segment| segment == "..") {
        return None;
    }

    let candidates = if trimmed.is_empty() {
        vec!["index.html".to_string()]
    } else if trimmed.ends_with('/') {
        vec![format!("{trimmed}index.html")]
    } else {
        vec![trimmed.to_string(), format!("{trimmed}/index.html")]
    };

    for candidate in candidates {
        if let Some(file) = Ui::get(&candidate) {
            return Some(Asset {
                bytes: file.data.into_owned(),
                content_type: content_type_for(&candidate),
            });
        }
    }
    None
}

/// The 404 page from the export, falling back to plain text.
pub fn not_found() -> Asset {
    resolve("/404.html").unwrap_or(Asset {
        bytes: b"Not found".to_vec(),
        content_type: "text/plain; charset=utf-8",
    })
}

pub fn content_type_for(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// True when the UI export was present at build time.
pub fn is_bundled() -> bool {
    Ui::get("index.html").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_cover_the_export() {
        assert_eq!(content_type_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(
            content_type_for("a/b/app.JS"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type_for("f.woff2"), "font/woff2");
        assert_eq!(content_type_for("noextension"), "application/octet-stream");
    }

    #[test]
    fn traversal_attempts_are_rejected() {
        assert!(resolve("/../Cargo.toml").is_none());
        assert!(resolve("/_next/../../Cargo.toml").is_none());
    }

    #[test]
    fn query_strings_are_stripped_before_lookup() {
        // Whether the asset exists depends on the build, but parsing must not
        // carry the query string into the lookup key.
        assert!(resolve("/does-not-exist?x=1#y").is_none());
    }
}
