use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(untagged)]
pub enum Cell {
    Number(f64),
    Text(String),
    Empty,
}

#[tauri::command]
pub async fn read_calibration_artifact(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if Path::new(&path).extension().and_then(|s| s.to_str()) != Some("json") {
            return Err("请选择 JSON 工作曲线文件。".into());
        }
        let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        use std::io::Read;
        let mut text = String::new();
        file.take(20_000_001)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() > 20_000_000 {
            return Err("曲线文件超过 20 MB。".into());
        }
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn write_artifact(
    path: &str,
    contents: &[u8],
    table: Option<Vec<Vec<Cell>>>,
) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "xlsx" {
        let rows = table.ok_or("缺少工作曲线表格。")?;
        if rows.len() > 100_000 || rows.iter().any(|r| r.len() > 100) {
            return Err("表格超过大小限制。".into());
        }
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.set_name("Calibration").map_err(|e| e.to_string())?;
        for (r, row) in rows.into_iter().enumerate() {
            for (c, value) in row.into_iter().enumerate() {
                match value {
                    Cell::Number(n) if n.is_finite() => {
                        sheet
                            .write_number(r as u32, c as u16, n)
                            .map_err(|e| e.to_string())?;
                    }
                    Cell::Text(s) => {
                        sheet
                            .write_string(r as u32, c as u16, s)
                            .map_err(|e| e.to_string())?;
                    }
                    Cell::Empty => {}
                    _ => return Err("表格包含非有限数值。".into()),
                }
            }
        }
        sheet
            .set_column_range_width(0, 10, 24)
            .map_err(|e| e.to_string())?;
        return workbook.save(path).map_err(|e| e.to_string());
    }
    if !["json", "csv", "svg", "png"].contains(&extension.as_str()) {
        return Err("不支持的导出格式。".into());
    }
    if contents.len() > 20_000_000 {
        return Err("导出超过 20 MB。".into());
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_calibration_artifact(
    path: String,
    contents: Vec<u8>,
    table: Option<Vec<Vec<Cell>>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_artifact(&path, &contents, table))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_numeric_workbook_and_roundtrips_json() {
        let dir = tempfile::tempdir().unwrap();
        let xlsx = dir.path().join("curve.xlsx");
        write_artifact(
            xlsx.to_str().unwrap(),
            &[],
            Some(vec![vec![
                Cell::Text("=not a formula".into()),
                Cell::Number(2.5),
                Cell::Empty,
            ]]),
        )
        .unwrap();
        use calamine::{Data, Reader, open_workbook_auto};
        let mut book = open_workbook_auto(xlsx).unwrap();
        let range = book.worksheet_range("Calibration").unwrap();
        assert_eq!(
            range.get_value((0, 0)),
            Some(&Data::String("=not a formula".into()))
        );
        assert_eq!(range.get_value((0, 1)), Some(&Data::Float(2.5)));
        let json = dir.path().join("curve.json");
        write_artifact(json.to_str().unwrap(), b"{\"version\":1}", None).unwrap();
        assert_eq!(std::fs::read(json).unwrap(), b"{\"version\":1}");
        assert!(write_artifact(dir.path().join("bad.exe").to_str().unwrap(), b"", None).is_err());
    }
}
