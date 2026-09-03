import zipfile, sys
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def extract(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    out = []
    for p in root.iter(W + 'p'):
        texts = [t.text or '' for t in p.iter(W + 't')]
        out.append(''.join(texts))
    return '\n'.join(out)

for f in sys.argv[1:]:
    print('\n\n========== ' + f + ' ==========')
    try:
        print(extract(f))
    except Exception as e:
        print('[ERR] ' + str(e))
