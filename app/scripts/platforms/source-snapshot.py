#!/usr/bin/env python3
"""Copy an allowlisted, hash-checked source snapshot; never expose the checkout to Docker."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
FILES = ('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'electron-builder.yml')
DIRECTORIES = ('app', 'public')
EXCLUDED = {'.git', '.analysis', 'REF', 'node_modules', 'release', 'dist', '__pycache__', '.DS_Store'}

def collect():
    paths = [ROOT / name for name in FILES if (ROOT / name).is_file()]
    for name in DIRECTORIES:
        directory = ROOT / name
        if directory.exists():
            paths.extend(path for path in directory.rglob('*') if path.is_file() and not any(part in EXCLUDED for part in path.relative_to(ROOT).parts))
    if any(path.is_symlink() for path in paths):
        raise RuntimeError('Symbolic links are excluded from platform snapshots.')
    return {str(path.relative_to(ROOT)): path.read_bytes() for path in sorted(paths)}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / '.analysis/platforms/Linux'):
        raise RuntimeError('Output must be inside .analysis/platforms/Linux.')
    before = collect()
    output.mkdir(parents=True, exist_ok=False)
    tar_path = output / 'source.tar'
    with tarfile.open(tar_path, 'w') as archive:
        for path, content in before.items():
            info = tarfile.TarInfo(path)
            info.size = len(content)
            info.mode = 0o755 if path.endswith(('.sh', '.py')) else 0o644
            archive.addfile(info, io.BytesIO(content))
    after = collect()
    changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
    manifest = {'createdUtc': datetime.now(timezone.utc).isoformat(), 'stable': not changed, 'changedDuringCapture': changed,
                'archiveSha256': digest(tar_path.read_bytes()), 'archiveBytes': tar_path.stat().st_size,
                'files': [{'path': path, 'sha256': digest(content), 'bytes': len(content)} for path, content in before.items()],
                'excluded': sorted(EXCLUDED)}
    (output / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'path': str(output.relative_to(ROOT)), 'stable': not changed, 'files': len(before), 'archiveBytes': manifest['archiveBytes'], 'archiveSha256': manifest['archiveSha256'], 'changedDuringCapture': changed}))
    if changed:
        raise SystemExit('Source changed during capture. Do not run this snapshot; capture into a new directory.')

if __name__ == '__main__':
    main()
