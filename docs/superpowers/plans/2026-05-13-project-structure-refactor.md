# Project Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single-file PySide6 spectrum analyzer into a small Python package and provide a no-console Windows launcher that uses the project virtual environment.

**Architecture:** Move analysis logic, Qt canvas, dialogs, main window, and app entrypoint into `spectrum_signal_app/`. Keep `main.py` as a compatibility shim. Use `start.bat` plus `start_hidden.vbs` to launch `.venv\Scripts\pythonw.exe -m spectrum_signal_app` without a console window.

**Tech Stack:** Python 3.11, PySide6, Matplotlib QtAgg backend, NumPy, Pandas, SciPy, Windows batch/VBScript launchers, `unittest`.

---

### Task 1: Tests For New Package And Hidden Launcher

**Files:**
- Modify: `tests/test_main_window.py`
- Modify: `tests/test_start_script.py`

- [ ] Update `tests/test_main_window.py` to import `MainWindow` from `spectrum_signal_app.main_window`.
- [ ] Update `tests/test_start_script.py` to assert `start.bat` invokes `wscript` and `start_hidden.vbs`, and `start_hidden.vbs` invokes `.venv\Scripts\pythonw.exe -m spectrum_signal_app`.
- [ ] Run `.\.venv\Scripts\python.exe -m unittest discover -s tests`.
- [ ] Expected result before implementation: import/script assertions fail because the package and hidden launcher do not exist yet.

### Task 2: Package Split

**Files:**
- Create: `spectrum_signal_app/__init__.py`
- Create: `spectrum_signal_app/__main__.py`
- Create: `spectrum_signal_app/app.py`
- Create: `spectrum_signal_app/analyzer.py`
- Create: `spectrum_signal_app/canvas.py`
- Create: `spectrum_signal_app/dialogs.py`
- Create: `spectrum_signal_app/main_window.py`
- Create: `spectrum_signal_app/config.py`
- Modify: `main.py`

- [ ] Move `SpectrumAnalyzer` into `spectrum_signal_app/analyzer.py`.
- [ ] Move `MplCanvas` into `spectrum_signal_app/canvas.py`.
- [ ] Move `ColumnSelectDialog` into `spectrum_signal_app/dialogs.py`.
- [ ] Move `MainWindow` into `spectrum_signal_app/main_window.py` and replace same-file class references with package imports.
- [ ] Add `spectrum_signal_app/app.py` with the Qt application startup function.
- [ ] Add `spectrum_signal_app/__main__.py` to support `python -m spectrum_signal_app`.
- [ ] Replace root `main.py` with a compatibility wrapper that calls `spectrum_signal_app.app.main`.
- [ ] Run `.\.venv\Scripts\python.exe -m unittest discover -s tests`.
- [ ] Expected result after implementation: package import tests pass.

### Task 3: Hidden Windows Launcher

**Files:**
- Modify: `start.bat`
- Create: `start_hidden.vbs`

- [ ] Replace `start.bat` with a short launcher that calls `wscript.exe start_hidden.vbs` from the project root.
- [ ] Add `start_hidden.vbs` to validate `.venv\Scripts\pythonw.exe` and `spectrum_signal_app`, then launch without a visible console window.
- [ ] Run `.\.venv\Scripts\python.exe -m unittest discover -s tests`.
- [ ] Run `.\.venv\Scripts\python.exe -m py_compile main.py spectrum_signal_app\*.py tests\*.py`.
- [ ] Expected result: tests and compilation pass.
