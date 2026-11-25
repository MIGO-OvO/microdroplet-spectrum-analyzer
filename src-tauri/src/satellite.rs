use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{
    StatusCode, Url,
    blocking::Client,
    header::{ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED},
};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Response};

const REFRESH_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_TILE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize)]
struct TileMetadata {
    checked_ms: u64,
    etag: Option<String>,
    modified: Option<String>,
}

#[derive(Clone)]
pub struct SatelliteTiles {
    directory: PathBuf,
    client: Client,
    refreshing: Arc<Mutex<HashSet<PathBuf>>>,
}

impl SatelliteTiles {
    pub fn new(cache: PathBuf) -> Result<Self, reqwest::Error> {
        Ok(Self {
            directory: cache.join("google").join("gsatellite"),
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!(
                    "MicrodropletSpectrumAnalyzer/",
                    env!("CARGO_PKG_VERSION")
                ))
                .build()?,
            refreshing: Arc::default(),
        })
    }

    fn tile(&self, z: u8, x: u32, y: u32) -> Result<Vec<u8>, String> {
        let url = satellite_url(z, x, y)?;
        let path = self
            .directory
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{y}.tile"));
        if let Some(bytes) = fs::read(&path).ok().filter(|bytes| valid_image(bytes)) {
            let metadata: TileMetadata = fs::read(path.with_extension("json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            if unix_ms().saturating_sub(metadata.checked_ms) >= REFRESH_MS
                && self.refreshing.lock().unwrap().insert(path.clone())
            {
                let cache = self.clone();
                std::thread::spawn(move || {
                    let _ = cache.fetch(url, &path, metadata);
                    cache.refreshing.lock().unwrap().remove(&path);
                });
            }
            return Ok(bytes);
        }
        self.fetch(url, &path, TileMetadata::default())
    }

    fn fetch(&self, url: Url, path: &Path, previous: TileMetadata) -> Result<Vec<u8>, String> {
        let mut request = self
            .client
            .get(url)
            .header(reqwest::header::REFERER, "https://www.google.com/maps/");
        if let Some(etag) = &previous.etag {
            request = request.header(IF_NONE_MATCH, etag);
        }
        if let Some(modified) = &previous.modified {
            request = request.header(IF_MODIFIED_SINCE, modified);
        }
        let response = request
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| error.to_string())?;
        let unchanged = response.status() == StatusCode::NOT_MODIFIED;
        let header = |name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        let metadata = TileMetadata {
            checked_ms: unix_ms(),
            etag: header(ETAG).or(if unchanged { previous.etag } else { None }),
            modified: header(LAST_MODIFIED).or(if unchanged { previous.modified } else { None }),
        };
        let bytes = if unchanged {
            fs::read(path).map_err(|error| error.to_string())?
        } else {
            let mut bytes = Vec::new();
            response
                .take(MAX_TILE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if !valid_image(&bytes) {
                return Err("Google 未返回有效的卫星瓦片。".into());
            }
            write_cache(path, &bytes).map_err(|error| error.to_string())?;
            bytes
        };
        let encoded = serde_json::to_vec(&metadata).map_err(|error| error.to_string())?;
        write_cache(&path.with_extension("json"), &encoded).map_err(|error| error.to_string())?;
        Ok(bytes)
    }
}

fn satellite_url(z: u8, x: u32, y: u32) -> Result<Url, String> {
    if z > 20 || x >= 1 << z || y >= 1 << z {
        return Err("Google 瓦片坐标超出范围。".into());
    }
    let server = (x + 2 * y) % 4;
    Url::parse(&format!(
        "https://mt{server}.google.com/vt?lyrs=s&hl=zh-CN&x={x}&y={y}&z={z}&scale=1"
    ))
    .map_err(|error| error.to_string())
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn valid_image(bytes: &[u8]) -> bool {
    bytes.len() <= MAX_TILE_BYTES
        && (bytes.starts_with(b"\xff\xd8\xff") || bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
}

fn write_cache(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let directory = path.parent().expect("tile cache path has a parent");
    fs::create_dir_all(directory)?;
    let mut temp = tempfile::NamedTempFile::new_in(directory)?;
    temp.write_all(bytes)?;
    temp.persist(path)?;
    Ok(())
}

#[tauri::command]
pub async fn satellite_tile(
    cache: State<'_, SatelliteTiles>,
    z: u8,
    x: u32,
    y: u32,
) -> Result<Response, String> {
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || cache.tile(z, x, y).map(Response::new))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn satellite_uses_ground_station_xyz_without_credentials() {
        assert_eq!(
            satellite_url(3, 2, 3).unwrap().as_str(),
            "https://mt0.google.com/vt?lyrs=s&hl=zh-CN&x=2&y=3&z=3&scale=1"
        );
        assert_eq!(
            satellite_url(3, 1, 3).unwrap().host_str(),
            Some("mt3.google.com")
        );
        assert!(satellite_url(21, 0, 0).is_err());
        assert!(satellite_url(3, 8, 0).is_err());
    }

    #[test]
    fn tile_survives_cache_restart_without_network() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("google/gsatellite/0/0/0.tile");
        let tile = b"\xff\xd8\xff\xe0";
        write_cache(&path, tile).unwrap();
        let metadata = TileMetadata {
            checked_ms: unix_ms(),
            ..Default::default()
        };
        write_cache(
            &path.with_extension("json"),
            &serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
        let cache = SatelliteTiles::new(directory.path().into()).unwrap();
        assert_eq!(cache.tile(0, 0, 0).unwrap(), tile);
        assert!(!valid_image(b"<html>"));
    }
}
