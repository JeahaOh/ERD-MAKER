#!/usr/bin/env python3
"""Read-only inventory of user-provided eXERD distributions; selected resources stay under .analysis/ref."""
import hashlib, io, json, pathlib, re, struct, zipfile, zlib
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / '.analysis/ref'
OUT.mkdir(parents=True, exist_ok=True)

def digest(data): return hashlib.sha256(data).hexdigest()
def save(path, data):
    target = OUT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return str(target.relative_to(ROOT))
def inflate_entries(data):
    """eXERD stores ZIP local records without a central directory; do not use ZipFile."""
    offset = data.index(b'PK\x03\x04')
    result = []
    while offset < len(data) and data[offset:offset+4] == b'PK\x03\x04':
        flags, method = struct.unpack_from('<HH', data, offset+6)
        name_len, extra_len = struct.unpack_from('<HH', data, offset+26)
        name = data[offset+30:offset+30+name_len].decode('utf-8')
        start = offset+30+name_len+extra_len
        if method != 8: raise ValueError(f'Unsupported ZIP method {method}')
        inflater = zlib.decompressobj(-15)
        raw = inflater.decompress(data[start:]) + inflater.flush()
        consumed = len(data[start:])-len(inflater.unused_data)
        end = start+consumed
        if flags & 8:
            if data[end:end+4] == b'PK\x07\x08': end += 4
            crc, compressed, uncompressed = struct.unpack_from('<III', data, end)
            assert crc == zlib.crc32(raw), name
            assert compressed == consumed and uncompressed == len(raw), name
            end += 12
        result.append((name, raw, offset, end))
        offset = end
    return result

inventory = {'schemaVersion': 1, 'method': 'Python zipfile metadata; selected resources; local-entry raw DEFLATE with CRC/size checks', 'files': [], 'samples': []}
for source in sorted((ROOT/'REF').iterdir()):
    if not source.is_file(): continue
    data = source.read_bytes()
    item = {'path': str(source.relative_to(ROOT)), 'bytes': len(data), 'sha256': digest(data)}
    inventory['files'].append(item)
    if source.suffix != '.zip':
        item['magicHex'] = data[:16].hex()
        continue
    archive = zipfile.ZipFile(io.BytesIO(data))
    version = '3.3.56' if source.name == 'updateSite.zip' else '2.5.17'
    item.update({'version': version, 'members': len(archive.namelist()), 'bundles': []})
    for member in archive.namelist():
        if not member.endswith('.jar'): continue
        jar_data = archive.read(member)
        jar = zipfile.ZipFile(io.BytesIO(jar_data))
        names = jar.namelist()
        bundle = {'path': member, 'sha256': digest(jar_data), 'bytes':len(jar_data), 'members':len(names), 'classes':sum(n.endswith('.class') for n in names)}
        item['bundles'].append(bundle)
        resource_root = pathlib.Path(version) / pathlib.Path(member).stem
        for name in names:
            if name.endswith('/'): continue
            if name in ('META-INF/MANIFEST.MF','plugin.xml','feature.xml') or name.endswith('.ecore') or name.startswith('nl/ko/toc/'):
                save(resource_root/name, jar.read(name))
        if 'exerd.intro_' not in member: continue
        for name in names:
            if not name.endswith('.zip') or 'examples/' not in name: continue
            examples = zipfile.ZipFile(io.BytesIO(jar.read(name)))
            for example in examples.namelist():
                if not example.endswith(('.exerd','.xdic')): continue
                sample = examples.read(example)
                path = save(resource_root / name.replace('.zip','') / example,sample)
                record = {'archive':item['path'], 'bundle':member, 'container':name,'member':example,'bytes':len(sample),'sha256':digest(sample),'extractedPath':path,'entries':[]}
                inventory['samples'].append(record)
                entries = [('xml-content.xml', sample, 0, len(sample))] if sample.lstrip().startswith(b'<?xml') else inflate_entries(sample)
                for entry, xml, start, end in entries:
                    xml_path = save(pathlib.Path(path).relative_to('.analysis/ref').with_name(example+'.'+entry),xml)
                    detail = {'name':entry,'bytes':len(xml),'sha256':digest(xml),'start':start,'end':end,'extractedPath':xml_path}
                    record['entries'].append(detail)
                    if entry == 'xml-content.xml':
                        root=ET.fromstring(xml)
                        detail['rootTag']=root.tag
                        detail['rootAttributes']=root.attrib
                        detail['tables']=sum(x.tag=='tables' for x in root.iter())
                        detail['columns']=sum(x.tag=='columns' for x in root.iter())
                        detail['foreignKeyGroups']=sum(x.attrib.get('{http://www.w3.org/2001/XMLSchema-instance}type','').endswith(':ForeignKeyColumnGroup') for x in root.iter())
(ROOT/'docs/research/evidence').mkdir(parents=True, exist_ok=True)
(ROOT/'docs/research/evidence/reference-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files': [{k:v for k,v in f.items() if k!='bundles'} for f in inventory['files']], 'samples': len(inventory['samples']), 'inventory':'docs/research/evidence/reference-inventory.json'},ensure_ascii=False,indent=2))
