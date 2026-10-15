#!/usr/bin/env python3
"""Package an installed, audited Apple Silicon Astral CLI with its licenses."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('prefix', type=Path, help='CMake installation prefix')
parser.add_argument('source', type=Path, help='Pinned source checkout used for the build')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
name = 'astral-2.3.0-macos-arm64'
binary = args.prefix / 'bin/astral'
strings = subprocess.check_output(['strings', str(binary)], text=True)
if re.search(r'/(Users|Volumes)/|/private/tmp/|/home/Documents/|/tmp/site-', strings):
    raise SystemExit('Binary still contains private build residue; fix the path mappings.')
subprocess.run([str(binary), '--version'], check=True)
metadata = json.loads(subprocess.check_output([
    'cargo', 'metadata', '--manifest-path', str(args.source / 'cli/Cargo.toml'),
    '--format-version=1', '--locked', '--offline',
]))

with tempfile.TemporaryDirectory(prefix='astral-package-') as temporary:
    stage = Path(temporary) / name
    (stage / 'bin').mkdir(parents=True)
    (stage / 'share/astral').mkdir(parents=True)
    licenses = stage / 'licenses'
    (licenses / 'rust').mkdir(parents=True)
    shutil.copy2(binary, stage / 'bin/astral')
    shutil.copytree(args.prefix / 'share/astral/specs', stage / 'share/astral/specs')
    for document in ['LICENSE', 'NOTICE']:
        shutil.copy2(args.prefix / 'share/astral' / document, licenses / document)
    for document in ['install.sh', 'README.txt']:
        shutil.copy2(root / 'packaging/astral' / document, stage / document)
    for package in metadata['packages']:
        if not package.get('source'):
            continue
        directory = Path(package['manifest_path']).parent
        for file in directory.rglob('*'):
            if not file.is_file() or len(file.relative_to(directory).parts) > 2:
                continue
            if not file.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'COPYRIGHT')):
                continue
            filename = f"{package['name']}-{package['version']}-{str(file.relative_to(directory)).replace('/', '-')}"
            shutil.copyfile(file, licenses / 'rust' / filename)

    def anonymous(member):
        member.uid = member.gid = member.mtime = 0
        member.uname = member.gname = ''
        member.pax_headers = {}
        return member

    output = root / 'downloads' / f'{name}.tar.gz'
    with output.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                archive.add(stage, arcname=name, filter=anonymous)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_name(f'{name}.sha256').write_text(f'{digest}  {output.name}\n')
    print(f'{output.name}: {output.stat().st_size} bytes, sha256 {digest}')
