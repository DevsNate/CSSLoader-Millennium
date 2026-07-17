import asyncio, json, tempfile, os, aiohttp, zipfile, shutil, ssl, certifi
from css_utils import Result, Log, get_theme_path, store_or_file_config
from css_theme import CSS_LOADER_VER, Theme
from css_catalog import CATALOG_METADATA_FILE, SCOPE_OVERRIDE_FILE, cache_catalog_record

async def run(command : str) -> str:
    proc = await asyncio.create_subprocess_shell(command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await proc.communicate()

    if (proc.returncode != 0):
        raise Exception(f"Process exited with error code {proc.returncode}")

    return stdout.decode()

async def install(id : str, base_url : str, local_themes : list) -> Result:
    if not base_url.endswith("/"):
        base_url = base_url + "/"

    url = f"{base_url}themes/{id}"

    tls_context = ssl.create_default_context(cafile=certifi.where())
    async with aiohttp.ClientSession(headers={"User-Agent": f"css-loader-for-millennium/{CSS_LOADER_VER}"}, connector=aiohttp.TCPConnector(ssl=tls_context)) as session:
        try:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise Exception(f"Invalid status code {resp.status}")

                data = await resp.json()
        except Exception as e:
            return Result(False, str(e))

        if (data["manifestVersion"] > CSS_LOADER_VER):
            raise Exception("Manifest version of themedb entry is unsupported by this version of CSS_Loader")

        download_url = f"{base_url}blobs/{data['download']['id']}"
        tempDir = tempfile.TemporaryDirectory()

        Log(f"Downloading {download_url} to {tempDir.name}...")
        themeZipPath = os.path.join(tempDir.name, 'theme.zip')
        try:
            async with session.get(download_url) as resp:
                if resp.status != 200:
                    raise Exception(f"Got {resp.status} code from '{download_url}'")

                with open(themeZipPath, "wb") as out:
                    out.write(await resp.read())

        except Exception as e:
            return Result(False, str(e))

    Log(f"Unzipping {themeZipPath}")
    try:
        with zipfile.ZipFile(themeZipPath, 'r') as zip:
            zip.extractall(get_theme_path())
    except Exception as e:
        return Result(False, str(e))

    tempDir.cleanup()
    metadata_path = cache_catalog_record(data, get_theme_path())
    if metadata_path is None:
        Log(f"Could not associate catalog scope metadata with installed theme '{data.get('name', id)}'")

    if not store_or_file_config("no_deps_install"):
        for x in data["dependencies"]:
            if x["name"] in local_themes:
                continue

            dependency_result = await install(x["id"], base_url, local_themes)
            if not dependency_result.success:
                return Result(
                    False,
                    f"Installed '{data.get('name', id)}', but failed to install "
                    f"dependency '{x['name']}': {dependency_result.message}",
                )
            local_themes.append(x["name"])

    return Result(True)

async def upload(theme : Theme, base_url : str, bearer_token : str) -> Result:
    if not base_url.endswith("/"):
        base_url = base_url + "/"

    url = f"{base_url}blobs"

    with tempfile.TemporaryDirectory() as tmp:
        staging_path = os.path.join(tmp, "theme")
        shutil.copytree(
            theme.themePath,
            staging_path,
            ignore=shutil.ignore_patterns(CATALOG_METADATA_FILE, SCOPE_OVERRIDE_FILE),
        )
        themePath = os.path.join(tmp, "theme.zip")
        print(themePath[:-4])
        print(theme.themePath)
        shutil.make_archive(themePath[:-4], 'zip', staging_path)

        with open(themePath, "rb") as file:
            tls_context = ssl.create_default_context(cafile=certifi.where())
            async with aiohttp.ClientSession(headers={"User-Agent": f"css-loader-for-millennium/{CSS_LOADER_VER}", "Authorization": f"Bearer {bearer_token}"}, connector=aiohttp.TCPConnector(ssl=tls_context)) as session:
                try:
                    mp = aiohttp.FormData()
                    mp.add_field("file", file)
                    async with session.post(url, data=mp) as resp:
                        if resp.status != 200:
                            raise Exception(f"Invalid status code {resp.status}")

                        data = await resp.json()
                        return Result(True, data)
                except Exception as e:
                    return Result(False, str(e))
