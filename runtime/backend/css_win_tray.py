import ctypes, os, subprocess, webbrowser

import psutil
import pystray
from ctypes import wintypes
from PIL import Image, ImageDraw

import css_theme
import css_utils

ICON = None
MAIN = None
LOOP = None
DEV_MODE_STATE = False
DESKTOP_PROCESS_NAME = "CSS Loader for Millennium.exe"
RESTART_BACKEND_ARGUMENT = "--restart-backend"
WM_CLOSE = 0x0010

def reset():
    LOOP.create_task(MAIN.reset(MAIN))

def open_theme_dir():
    theme_dir = css_utils.get_theme_path()
    os.startfile(theme_dir)

def _desktop_processes():
    processes = []
    for process in psutil.process_iter(["name"]):
        try:
            if process.info["name"] == DESKTOP_PROCESS_NAME:
                processes.append(process)
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    return processes

def _request_desktop_window_close(process_ids):
    if not process_ids:
        return

    user32 = ctypes.windll.user32
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def close_window(window, _lparam):
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(window, ctypes.byref(process_id))
        if process_id.value in process_ids:
            user32.PostMessageW(window, WM_CLOSE, 0, 0)
        return True

    user32.EnumWindows(callback_type(close_window), 0)

def _stop_desktop_app():
    processes = _desktop_processes()
    if not processes:
        return

    _request_desktop_window_close({process.pid for process in processes})
    _, alive = psutil.wait_procs(processes, timeout=3)

    # A hidden, blocked, or unresponsive desktop window must not be allowed to
    # relaunch the backend after the user deliberately selected Exit.
    for process in alive:
        try:
            process.terminate()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass
    _, alive = psutil.wait_procs(alive, timeout=2)
    for process in alive:
        try:
            process.kill()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass

def exit_all():
    _stop_desktop_app()
    stop_icon()
    # sys.exit() raised inside the backend's asyncio task does not reliably
    # terminate the packaged GUI process. Exit the current backend process
    # directly after its tray icon and desktop companion have been closed.
    os._exit(0)

def restart_all():
    path = get_desktop_install_path()
    if path is None:
        return

    _stop_desktop_app()
    subprocess.Popen([path, RESTART_BACKEND_ARGUMENT])

def get_dev_mode_state(x) -> bool:
    return DEV_MODE_STATE

def toggle_dev_mode_state():
    global DEV_MODE_STATE
    DEV_MODE_STATE = not DEV_MODE_STATE
    LOOP.create_task(MAIN.toggle_watch_state(MAIN, get_dev_mode_state(None)))

def check_if_symlink_exists():
    return os.path.exists(os.path.join(css_utils.get_steam_path(), "steamui", "themes_custom"))

def open_install_docs():
    webbrowser.open_new_tab("https://docs.deckthemes.com/CSSLoader/Install/#windows")

def get_desktop_install_path() -> str|None:
    candidates = [
        os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Programs",
            "CSS Loader for Millennium",
            "CSS Loader for Millennium.exe",
        ),
        os.path.join(
            os.environ.get("PROGRAMFILES", "C:/Program Files"),
            "CSS Loader for Millennium",
            "CSS Loader for Millennium.exe",
        ),
        "C:/Program Files/CSSLoader Desktop/CSSLoader Desktop.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate

    return None

def open_desktop():
    path = get_desktop_install_path()
    if path != None:
        subprocess.Popen([path])

def start_icon(main, loop):
    global ICON, MAIN, LOOP, DEV_MODE_STATE
    MAIN = main
    LOOP = loop
    DEV_MODE_STATE = MAIN.observer != None
    symlink = check_if_symlink_exists()

    ICON = pystray.Icon(
    'CSS Loader',
    title='CSS Loader',
    icon=Image.open(os.path.join(os.path.dirname(__file__), "assets", "paint-roller-solid.png")),
    menu=pystray.Menu(
        pystray.MenuItem(f"CSS Loader v{css_theme.CSS_LOADER_VER}", action=None, enabled=False),
        pystray.MenuItem("Local Images/Fonts: Enabled" if symlink else "Local Images/Fonts: Disabled", action=None, enabled=None),
        pystray.MenuItem("Please enable Windows Developer Mode", action=open_install_docs, visible=not symlink),
        pystray.MenuItem("Open Desktop App", action=open_desktop, enabled=get_desktop_install_path() != None, default=True),
        pystray.MenuItem("Live CSS Editing", toggle_dev_mode_state, checked=get_dev_mode_state),
        pystray.MenuItem("Open Themes Folder", open_theme_dir),
        pystray.MenuItem("Reload Themes", reset),
        pystray.MenuItem("Restart CSS Loader", restart_all, enabled=get_desktop_install_path() != None),
        pystray.MenuItem("Exit", exit_all)
    ))
    ICON.run_detached()

def stop_icon():
    if ICON != None:
        ICON.stop()
