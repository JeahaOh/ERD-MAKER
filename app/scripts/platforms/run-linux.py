#!/usr/bin/env python3
"""Run an isolated Linux snapshot. No checkout mounts and no published ports."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[3]

def command(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['linux/arm64', 'linux/amd64'], required=True)
    parser.add_argument('--image', default='mcr.microsoft.com/playwright:v1.64.1-noble')
    parser.add_argument('--seccomp', type=Path, required=True, help='Official Playwright Docker seccomp profile; do not disable sandbox.')
    args = parser.parse_args()
    profile = args.seccomp.resolve()
    if not profile.is_file():
        parser.error('--seccomp must name a readable profile file.')
    image = json.loads(command('docker', 'image', 'inspect', args.image, capture_output=True, text=True).stdout)[0]
    if f"linux/{image['Architecture']}" != args.platform:
        parser.error('Local image architecture does not match --platform. Pull the requested architecture first.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = f"erd-maker-linux-{args.platform.split('/')[-1]}-{stamp.lower()}"
    output = ROOT / '.analysis/platforms/Linux' / name
    command(sys.executable, 'app/scripts/platforms/source-snapshot.py', '--output', str(output))
    (output / 'image.json').write_text(json.dumps({key: image.get(key) for key in ['Id', 'RepoDigests', 'Architecture', 'Os', 'Size']}, indent=2))
    (output / 'seccomp_profile.json').write_bytes(profile.read_bytes())
    created = False
    status = 1
    try:
        command('docker', 'create', '--name', name, '--platform', args.platform, '--init', '--user', 'pwuser', '--workdir', '/workspace', '--shm-size=1g', '--security-opt', f'seccomp={profile}', '--tmpfs', '/workspace:rw,exec,size=4294967296,uid=1001,gid=1001', args.image, 'sleep', 'infinity')
        created = True
        command('docker', 'start', name)
        command('docker', 'cp', str(output / 'source.tar'), f'{name}:/tmp/source.tar')
        command('docker', 'exec', name, 'tar', '-xf', '/tmp/source.tar', '-C', '/workspace')
        run = subprocess.run(['docker', 'exec', name, 'bash', 'app/scripts/platforms/verify-linux.sh'], cwd=ROOT)
        status = run.returncode
    finally:
        if created:
            # Docker cp cannot reliably traverse a tmpfs mount. Stream via exec
            # before stopping the container, because stopping discards tmpfs.
            with (output / 'artifacts.tar').open('wb') as stream:
                command('docker', 'exec', name, 'tar', '-C', '/workspace', '-cf', '-', 'platform-artifacts', stdout=stream)
            with tarfile.open(output / 'artifacts.tar') as archive:
                members = archive.getmembers()
                if any(not (member.name == 'platform-artifacts' or member.name.startswith('platform-artifacts/')) or '..' in Path(member.name).parts or member.issym() or member.islnk() for member in members):
                    raise RuntimeError('Unexpected artifact archive entry; container retained for inspection.')
                archive.extractall(output, members=members, filter='data')
            (output / 'platform-artifacts').rename(output / 'artifacts')
            subprocess.run(['docker', 'stop', '--time', '5', name], cwd=ROOT)
            subprocess.run(['docker', 'rm', name], cwd=ROOT)
    # Live checkout drift is informational. Evidence remains bound to source.tar.
    manifest = json.loads((output / 'source-manifest.json').read_text())
    changed = [item['path'] for item in manifest['files'] if not (ROOT / item['path']).is_file() or hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']]
    (output / 'run-summary.json').write_text(json.dumps({'container': name, 'platform': args.platform, 'exitCode': status, 'sourceArchiveSha256': manifest['archiveSha256'], 'liveCheckoutChangedAfterSnapshot': changed, 'checkoutMounted': False, 'publishedPorts': [], 'sourceOriginalsIncluded': False}, indent=2) + '\n')
    print(json.dumps({'output': str(output.relative_to(ROOT)), 'exitCode': status, 'liveChangedFiles': len(changed)}))
    raise SystemExit(status)

if __name__ == '__main__':
    main()
