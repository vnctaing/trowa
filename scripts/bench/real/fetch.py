import io, json, os, subprocess, time, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
UA = 'trowa-bench/0.1 (melody benchmark; see scripts/bench/real/manifest.json)'

def get(url):
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            return urllib.request.urlopen(req, timeout=120).read()
        except Exception as e:
            print('  retry', url, e); time.sleep(5 * (i + 1))
    raise SystemExit('failed ' + url)

def commons_original(page_url):
    title = urllib.parse.unquote(page_url.split('/wiki/')[1])
    q = urllib.parse.urlencode({'action': 'query', 'titles': title, 'prop': 'imageinfo', 'iiprop': 'url', 'format': 'json'})
    d = json.loads(get('https://commons.wikimedia.org/w/api.php?' + q))
    return next(iter(d['query']['pages'].values()))['imageinfo'][0]['url'].split('?')[0]

for e in json.load(open(f'{ROOT}/scripts/bench/real/manifest.json')):
    d = f"{ROOT}/.cache/real/{e['slug']}"; os.makedirs(d, exist_ok=True)
    src = f"{d}/{e['audio']['file']}"
    if not os.path.exists(src):
        open(src, 'wb').write(get(commons_original(e['audio']['url'])))
    subprocess.run(['/opt/homebrew/bin/ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', f'{d}/mix.wav'], check=True)
    url, _, member = e['score']['url'].partition('#')
    data = get(url)
    if member:
        data = zipfile.ZipFile(io.BytesIO(data)).read(member)
    open(f"{d}/{e['score']['file']}", 'wb').write(data)
    print('ok', e['slug'])
