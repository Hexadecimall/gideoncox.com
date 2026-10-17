#!/usr/bin/env python3
"""Regression fixtures for the public artifact privacy audit."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit_public', Path(__file__).resolve().parents[1] / 'scripts/audit-public.py')
audit_public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_public)


class PublicAuditTests(unittest.TestCase):
    def test_native_paths_are_detected_without_exposing_their_values(self):
        fixtures = [
            'C:' + '\\Users\\sample\\project',
            'D:' + '/Workspace/project/source.cpp',
            '/' + 'Users/sample/project',
            '/' + 'Volumes/build/project',
            '/' + 'home/sample/project',
            '/' + 'root/project',
            '/' + 'mnt/c/' + 'Users/sample/project',
        ]
        for value in fixtures:
            with self.subTest(value=value):
                result = audit_public.inspect_data(('public\n' + value).encode(), 'fixture.txt')
                self.assertTrue(result)
                self.assertTrue(all(item.startswith('fixture.txt:2:') for item in result))
                self.assertNotIn(value, '\n'.join(result))

    def test_virtual_paths_and_toolchain_remaps_are_narrow_allowances(self):
        for suffix in ('web/file.txt', '.cargo/registry/source.rs', '.rustup/toolchains/library.rs'):
            value = '/' + 'home/' + suffix
            self.assertEqual(audit_public.inspect_data(value.encode(), 'fixture.txt'), [])
            for extra in ('-private', '.backup'):
                altered = value.replace(suffix.split('/')[0], suffix.split('/')[0] + extra, 1)
                self.assertTrue(audit_public.inspect_data(altered.encode(), 'fixture.txt'))

    def test_provider_secrets_and_private_keys_are_redacted(self):
        fixtures = [prefix + 'a' * 40 for prefix in (
            'gh' + 'p_', 'github_' + 'pat_', 'sk_' + 'live_', 'rk_' + 'test_',
            'wh' + 'sec_', 'sk-' + 'proj-', 'xox' + 'b-', 'x' + 'app-',
        )]
        fixtures += ['A' + 'KIA' + 'A' * 16, 'A' + 'SIA' + 'A' * 16, 'AI' + 'za' + 'a' * 35]
        fixtures += ['-----BEGIN ' + kind + 'PRIVATE KEY-----' for kind in ('', 'RSA ', 'OPENSSH ', 'ENCRYPTED ')]
        for value in fixtures:
            with self.subTest(prefix=value[:8]):
                result = audit_public.inspect_data(value.encode(), 'fixture.txt')
                self.assertTrue(result)
                self.assertNotIn(value, '\n'.join(result))

    def test_public_identity_license_emails_and_short_dummy_values_are_allowed(self):
        value = 'example.invalid PublicHandle\nCopyright Example Author <author@example.org>\nbuyer@example.invalid\nsk_' + 'test_example'
        self.assertEqual(audit_public.inspect_data(value.encode(), 'LICENSE'), [])

    def test_compiled_strings_and_utf16_text_are_checked(self):
        value = 'E:' + '\\Projects\\sample\\source.cpp'
        self.assertTrue(audit_public.inspect_data(b'\0asm\0' + value.encode() + b'\0', 'fixture.wasm'))
        self.assertTrue(audit_public.inspect_data(value.encode('utf-16'), 'fixture.txt'))
        self.assertEqual(audit_public.inspect_data(b'\xffC:' + b'\xff/Users\xff/sample', 'fixture.wasm'), [])
        self.assertEqual(audit_public.inspect_data(b'\xff/home/' + b'web\xff' + b'private', 'fixture.wasm'), [])
        joined_home = b'\xff/home' + b'/home/' + b'web'
        self.assertEqual(audit_public.inspect_data(joined_home + b"'\0", 'assets/wasm/terminal.wasm'), [])
        self.assertTrue(audit_public.inspect_data(joined_home + b'/private\0', 'assets/wasm/terminal.wasm'))

    def test_archives_are_scanned_and_local_metadata_is_excluded(self):
        private = ('/' + 'home/sample/private.txt').encode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for directory in ('.git', '.cache', 'target', 'vendor'):
                (root / directory).mkdir()
                (root / directory / 'local.txt').write_bytes(private)
            self.assertEqual(audit_public.audit(root), [])
            with tarfile.open(root / 'bundle.tar.gz', 'w:gz') as archive:
                member = tarfile.TarInfo('binary')
                member.size = len(private)
                member.uid = 1000
                archive.addfile(member, io.BytesIO(private))
            result = audit_public.audit(root)
            self.assertEqual(len(result), 2)
            self.assertTrue(any('owner metadata' in item for item in result))
            self.assertTrue(any('native user home path' in item for item in result))
            self.assertNotIn(private.decode(), '\n'.join(result))


if __name__ == '__main__':
    unittest.main()
