mod analyzer;
mod calibration_io;
mod commands;
mod csv_samples;
mod data;
mod export;
mod models;
mod sample_store;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::inspect_data_file,
            commands::load_data_file,
            commands::analyze_signal,
            commands::plot_view,
            commands::suggest_droplet_parameters,
            commands::export_results,
            commands::export_waveform,
            commands::export_chart,
            commands::save_sample,
            sample_store::list_samples,
            calibration_io::read_calibration_artifact,
            calibration_io::write_calibration_artifact,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Microdroplet Spectrum Analyzer");
}
