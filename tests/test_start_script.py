import unittest
from pathlib import Path


class StartScriptTests(unittest.TestCase):
    def setUp(self):
        self.project_root = Path(__file__).resolve().parents[1]

    def test_start_script_delegates_to_hidden_launcher(self):
        script_path = self.project_root / "start.bat"
        self.assertTrue(script_path.exists(), "start.bat should exist in the project root")

        script = script_path.read_text(encoding="utf-8")
        self.assertIn("wscript.exe", script)
        self.assertIn("start_hidden.vbs", script)

    def test_hidden_launcher_uses_venv_pythonw_and_package_entrypoint(self):
        script_path = self.project_root / "start_hidden.vbs"
        self.assertTrue(script_path.exists(), "start_hidden.vbs should exist in the project root")

        script = script_path.read_text(encoding="utf-8")
        self.assertIn(".venv\\Scripts\\pythonw.exe", script)
        self.assertIn("-m spectrum_signal_app", script)


if __name__ == "__main__":
    unittest.main()
