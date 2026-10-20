#!/usr/bin/env python3
"""Prepare an isolated, normal Eclipse workbench with original eXERD plugins.

Does not launch it, patch vendor files, change licensing, or touch installed DBeaver.
"""
from pathlib import Path
from zipfile import ZipFile
import argparse
import json
import hashlib
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
UI = ROOT / '.analysis/oracle/ui'
HOST = Path('/Applications/DBeaver.app/Contents/Eclipse/plugins')


def manifest(jar):
    if jar.is_dir():
        text=(jar/'META-INF/MANIFEST.MF').read_text().replace('\n ', '')
    else:
        with ZipFile(jar) as z:
            text = z.read('META-INF/MANIFEST.MF').decode().replace('\r\n ', '').replace('\n ', '')
    return dict(line.split(': ', 1) for line in text.splitlines() if ': ' in line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Prepare a NEW directory below .analysis, preserving previous configurations and workspace')
    parser.add_argument('--plugins', type=Path, default=HOST, help='Installed Eclipse host plugins directory (read only)')
    args = parser.parse_args()
    ui = args.output.resolve() if args.output else UI
    host_dir = args.plugins.resolve()
    if args.output and (not ui.is_relative_to(ROOT / '.analysis') or ui == ROOT / '.analysis' or ui.exists()):
        parser.error('--output must be a new directory below .analysis')
    if not host_dir.is_dir():
        parser.error('--plugins must be an existing Eclipse plugins directory')
    required = ['org.eclipse.equinox.simpleconfigurator_', 'org.eclipse.osgi_', 'org.eclipse.osgi.compatibility.state_', 'org.eclipse.equinox.launcher_']
    resolved = {}
    for prefix in required:
        matches = sorted(host_dir.glob(prefix + '*.jar'))
        if len(matches) != 1:
            parser.error(f'Expected exactly one host bundle matching {prefix}*.jar; found {len(matches)}')
        resolved[prefix] = matches[0]
    for p in ['plugins', 'configuration/org.eclipse.equinox.simpleconfigurator', 'workspace', 'input']:
        (ui / p).mkdir(parents=True, exist_ok=True)
    vendor = []
    with ZipFile(ROOT / 'REF/updateSite.zip') as archive:
        for n in archive.namelist():
            if n.startswith('plugins/') and n.endswith('.jar'):
                p = ui / n
                p.write_bytes(archive.read(n))
                vendor.append(p)
    # Missing EMF editing bundles; official Eclipse artifacts from Maven Central.
    downloads = []
    selected=[]
    for group,artifact,version in [('org/eclipse/emf','org.eclipse.emf.edit','2.23.0'),('org/eclipse/emf','org.eclipse.emf.ecore.edit','2.15.0'),('org/glassfish/hk2/external','javax.inject','2.5.0-b62'),('com/ibm/icu','icu4j','74.2')]:
        url = f'https://repo.maven.apache.org/maven2/{group}/{artifact}/{version}/{artifact}-{version}.jar'
        p = ui / 'plugins' / f'{artifact}_{version}.jar'
        if not p.exists():
            cached = UI / 'plugins' / p.name
            if cached.exists():
                p.write_bytes(cached.read_bytes())
            else:
                with urllib.request.urlopen(url, timeout=30) as r:
                    p.write_bytes(r.read())
        selected.append(p)
        downloads.append({'url': url, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
    # Exclude all DBeaver application/connection bundles. Reference Eclipse dependencies read-only.
    host = [p for p in sorted(host_dir.iterdir()) if (p.suffix=='.jar' or (p/'META-INF/MANIFEST.MF').is_file()) and not p.name.startswith(('org.jkiss.', 'com.dbeaver.'))]
    rows = []
    identities = set()
    for p in vendor + selected + host:
        m = manifest(p)
        name = m.get('Bundle-SymbolicName', '').split(';')[0]
        version = m.get('Bundle-Version')
        if not name or not version or (name, version) in identities:
            continue
        identities.add((name, version))
        start = name in ['org.eclipse.equinox.common', 'org.eclipse.equinox.simpleconfigurator', 'org.eclipse.core.runtime', 'org.apache.felix.scr', 'org.eclipse.equinox.event']
        level = 1 if name == 'org.eclipse.equinox.simpleconfigurator' else 2 if name in ['org.eclipse.equinox.common','org.apache.felix.scr','org.eclipse.equinox.event'] else 4
        rows.append(f'{name},{version},{p.as_uri()},{level},{str(start).lower()}')
    (ui / 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info').write_text('#version=1\n'+'\n'.join(rows)+'\n')
    simple = resolved['org.eclipse.equinox.simpleconfigurator_']
    framework = resolved['org.eclipse.osgi_']
    compat = resolved['org.eclipse.osgi.compatibility.state_']
    config = {
        'eclipse.application':'org.eclipse.ui.ide.workbench',
        'osgi.bundles':f'reference:{simple.as_uri()}@1:start',
        'osgi.framework':framework.as_uri(),
        'osgi.framework.extensions':f'reference:{compat.as_uri()}',
        'osgi.bundles.defaultStartLevel':'4',
        'osgi.configuration.cascaded':'false',
        'org.eclipse.equinox.simpleconfigurator.configUrl':(ui/'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info').as_uri(),
        'osgi.instance.area.default':(ui/'workspace').as_uri(),
    }
    (ui/'configuration/config.ini').write_text('\n'.join(f'{k}={v}' for k,v in config.items())+'\n')
    # Reopen only the generated verification copy; never pass the user's original to the GUI.
    sample = ROOT / '.analysis/compatibility/typescript-edited.exerd'
    if sample.exists():
        (ui/'input/typescript-edited.exerd').write_bytes(sample.read_bytes())
    launcher = resolved['org.eclipse.equinox.launcher_']
    command=['/Applications/DBeaver.app/Contents/MacOS/dbeaver','-startup',str(launcher),'-install',str(ui),'-configuration',str(ui/'configuration'),'-data',str(ui/'workspace'),'-application','org.eclipse.ui.ide.workbench','-clean','-showlocation']
    report={'downloads':downloads,'vendorPlugins':len(vendor),'bundleCount':len(rows),'hostPlugins':str(host_dir),'output':str(ui),'command':command,'guiReopenVerified':False}
    (ui/'preparation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
