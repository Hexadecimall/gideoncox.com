#!/usr/bin/env python3
"""Audit the vendored Zed build separately from first-party site content.

Upstream source legitimately names its AI integrations and contains synthetic
filesystem examples. Reject actual local paths in corresponding sources, and
all native absolute build paths in compiled distribution files.
"""
import argparse
from pathlib import Path
import re
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('bundle', type=Path)
args = parser.parse_args()
private = [str(Path.home()).encode()]
compiled_paths = re.compile(rb'/(?:Users|Volumes|private/var|private/tmp)/[^\s\x00]+')
credentials = re.compile(rb'\b(?:AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b')
errors = []
for path in args.bundle.rglob('*'):
    if not path.is_file():
        continue
    if path.name.endswith('.tar.gz'):
        with tarfile.open(path) as source:
            for member in source.getmembers():
                if member.uid or member.gid or member.uname or member.gname:
                    errors.append(f'{member.name}: archive ownership metadata')
                if member.name.startswith('/') or '..' in Path(member.name).parts or member.issym() or member.islnk():
                    errors.append(f'{member.name}: unsafe archive entry')
                if member.isfile():
                    data = source.extractfile(member).read()
                    if any(value in data for value in private):
                        errors.append(f'{member.name}: local build path')
                    if credentials.search(data):
                        errors.append(f'{member.name}: credential-shaped value')
        continue
    data = path.read_bytes()
    if compiled_paths.search(data) or any(value in data for value in private):
        errors.append(f'{path.name}: local build path')
    if credentials.search(data):
        errors.append(f'{path.name}: credential-shaped value')
if errors:
    raise SystemExit('\n'.join(errors))
print('Zed distribution path, archive, and credential audit passed.')
