// Release builds must not allocate a console window on Windows: the application is
// a GUI-only desktop tool and users launch it from a shortcut. Debug builds keep the
// console so panics and log output stay visible during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    microdroplet_spectrum_analyzer_lib::run();
}
