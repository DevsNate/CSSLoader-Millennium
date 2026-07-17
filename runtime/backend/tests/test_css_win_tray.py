import unittest
from unittest.mock import Mock, patch

import css_win_tray


class DesktopProcessCoordinationTests(unittest.TestCase):
    def test_stop_desktop_requests_close_then_terminates_survivor(self):
        process = Mock(pid=42)

        with (
            patch.object(css_win_tray, "_desktop_processes", return_value=[process]),
            patch.object(css_win_tray, "_request_desktop_window_close") as request_close,
            patch.object(
                css_win_tray.psutil,
                "wait_procs",
                side_effect=[([], [process]), ([], [])],
            ),
        ):
            css_win_tray._stop_desktop_app()

        request_close.assert_called_once_with({42})
        process.terminate.assert_called_once_with()
        process.kill.assert_not_called()

    def test_restart_closes_desktop_and_relaunches_with_restart_flag(self):
        desktop_path = r"C:\Program Files\CSS Loader for Millennium\CSS Loader for Millennium.exe"

        with (
            patch.object(css_win_tray, "get_desktop_install_path", return_value=desktop_path),
            patch.object(css_win_tray, "_stop_desktop_app") as stop_desktop,
            patch.object(css_win_tray.subprocess, "Popen") as popen,
        ):
            css_win_tray.restart_all()

        stop_desktop.assert_called_once_with()
        popen.assert_called_once_with([desktop_path, "--restart-backend"])

    def test_exit_closes_desktop_before_forcing_backend_exit(self):
        with (
            patch.object(css_win_tray, "_stop_desktop_app") as stop_desktop,
            patch.object(css_win_tray, "stop_icon") as stop_icon,
            patch.object(css_win_tray.os, "_exit") as process_exit,
        ):
            css_win_tray.exit_all()

        stop_desktop.assert_called_once_with()
        stop_icon.assert_called_once_with()
        process_exit.assert_called_once_with(0)


if __name__ == "__main__":
    unittest.main()
