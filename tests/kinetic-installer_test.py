"""Preflight checks for the public source installer; no network or compilation."""
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest

installer = Path(__file__).resolve().parents[1] / "downloads/kinetic-install.sh"


class InstallerTests(unittest.TestCase):
    def invoke(self, *args):
        return subprocess.run(["sh", str(installer), *args], text=True,
                              capture_output=True, timeout=15)

    def testHelp(self):
        result = self.invoke("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--replace", result.stdout)

    def testUnknownOption(self):
        self.assertNotEqual(self.invoke("--wrong").returncode, 0)

    @unittest.skipUnless(os.uname().sysname == "Darwin", "macOS installer")
    def testExistingHomebrewStyleLinkNeedsConsent(self):
        self.assertExistingIdentifierNeedsConsent("top.frameworksdev.kinetic")

    @unittest.skipUnless(os.uname().sysname == "Darwin", "macOS installer")
    def testCurrentIdentifierNeedsConsent(self):
        self.assertExistingIdentifierNeedsConsent("org.kinetic.app")

    def assertExistingIdentifierNeedsConsent(self, identifier):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "Cellar/kinetic/0.1.0/Kinetic.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": identifier,
            }))
            target = root / "Applications"
            target.mkdir()
            link = target / "Kinetic.app"
            link.symlink_to(app)
            result = self.invoke("--yes", "--app-dir", str(target),
                                 "--bin-dir", str(root / "bin"))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("explicit --replace", result.stderr)
            self.assertTrue(link.is_symlink())
            self.assertTrue(app.is_dir())

    @unittest.skipUnless(os.uname().sysname == "Darwin", "macOS installer")
    def testUnrelatedCliIsPreserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            cli = root / "bin/kinetic"
            cli.write_text("existing command")
            result = self.invoke("--yes", "--app-dir", str(root / "apps"),
                                 "--bin-dir", str(root / "bin"))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already owned", result.stderr)
            self.assertEqual(cli.read_text(), "existing command")


if __name__ == "__main__":
    unittest.main()
