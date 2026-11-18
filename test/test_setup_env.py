import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_env', Path(__file__).resolve().parents[1] / 'scripts/setup-env.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupEnvTests(unittest.TestCase):
    def test_atomic_write_backs_up_existing_configuration_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.env'
            path.write_text('KEEP=old\n')
            with contextlib.redirect_stdout(io.StringIO()):
                setup.write_env(path, {'SESSION_ENCRYPTION_KEY': 'ab' * 32, 'PASSWORD': '$literal'})
            self.assertEqual(setup.read_env(path)['PASSWORD'], '$literal')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            backups = list(Path(folder).glob('.env.backup.*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), 'KEEP=old\n')
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(folder).glob('.env.setup.*')), [])

    def test_invalid_value_does_not_replace_current_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.env'
            path.write_text('EXISTING=value\n')
            with self.assertRaises(ValueError):
                setup.write_env(path, {'BAD': "can't"})
            self.assertEqual(path.read_text(), 'EXISTING=value\n')

    def test_wizard_preserves_key_and_encodes_smtp_password(self):
        original = Path.cwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path('.env.example').write_text('PUBLIC_SIGNUP=true\n')
                Path('.env').write_text('SESSION_ENCRYPTION_KEY=' + 'ab' * 32 + '\n')
                answers = ['', 'Test Company', 'owner@example.com', '', 'smtp.example.com', '', 'smtpuser', 'sender@example.com', 'BRI 123 Test']
                with patch('builtins.input', side_effect=answers), patch('getpass.getpass', return_value="p@ss$'word"), patch.dict(os.environ, {'WABLASTING_EXISTING_VOLUME': '1'}), contextlib.redirect_stdout(io.StringIO()):
                    setup.main()
                config = setup.read_env(Path('.env'))
                self.assertEqual(config['SESSION_ENCRYPTION_KEY'], 'ab' * 32)
                self.assertEqual(config['SMTP_URL'], 'smtp://smtpuser:p%40ss%24%27word@smtp.example.com:587')
                self.assertEqual(config['APP_URL'], 'https://whapi.avicennarabama.com')
                self.assertEqual(config['NODE_ENV'], 'production')
                self.assertEqual(config['COOKIE_SECURE'], 'true')
            finally:
                os.chdir(original)

    def test_missing_key_with_existing_data_refuses_to_overwrite(self):
        original = Path.cwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path('.env').write_text('BUSINESS_NAME=Existing\n')
                with patch.dict(os.environ, {'WABLASTING_EXISTING_VOLUME': '1'}), self.assertRaises(ValueError):
                    setup.main()
                self.assertEqual(Path('.env').read_text(), 'BUSINESS_NAME=Existing\n')
            finally:
                os.chdir(original)

    def test_minimal_setup_does_not_ask_for_business_smtp_or_bank(self):
        original = Path.cwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path('.env.example').write_text('PUBLIC_SIGNUP=true\n')
                with patch('builtins.input', side_effect=AssertionError('CLI prompt should not run')), patch.dict(os.environ, {'WABLASTING_EXISTING_VOLUME': '0'}), contextlib.redirect_stdout(io.StringIO()):
                    setup.minimal()
                config = setup.read_env(Path('.env'))
                self.assertEqual(config['APP_URL'], 'https://whapi.avicennarabama.com')
                self.assertEqual(len(config['SESSION_ENCRYPTION_KEY']), 64)
                self.assertNotIn('SMTP_URL', config)
            finally:
                os.chdir(original)


if __name__ == '__main__':
    unittest.main()
