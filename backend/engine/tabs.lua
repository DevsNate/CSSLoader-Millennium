-- Tab names, ported from upstream's css_inject.py (DEFAULT_MAPPINGS, extend_tabs).
-- What a resolved tab matches is decided where the window is:
-- frontend/delivery/tabs.ts, and the startup file (engine/output.lua).

local pyjson = require("engine.pyjson")

local M = {}

local DEFAULT_MAPPINGS = {
    desktop = { "Steam|SteamLibraryWindow" },
    desktopchat = { "!friendsui-container" },
    desktoppopup = { "OverlayBrowser_Browser", "SP Overlay:.*", "notificationtoasts_.*", "SteamBrowser_Find", "OverlayTab\\d+_Find", "!ModalDialogPopup", "!FullModalOverlay" },
    desktopoverlay = { "desktoppopup" },
    desktopcontextmenu = { ".*Menu", ".*Supernav" },
    bigpicture = { "~Valve Steam Gamepad/default~", "~Valve%20Steam%20Gamepad~" },
    bigpictureoverlay = { "QuickAccess", "MainMenu" },
    store = { "~https://store.steampowered.com~", "~https://steamcommunity.com~" },

    -- Legacy
    SP = { "bigpicture" },
    ["Steam Big Picture Mode"] = { "bigpicture" },
    MainMenu = { "MainMenu.*" },
    ["MainMenu_.*"] = { "MainMenu" },
    QuickAccess = { "QuickAccess.*" },
    ["QuickAccess_.*"] = { "QuickAccess" },
    Steam = { "desktop" },
    SteamLibraryWindow = { "desktop" },
    All = { "bigpicture", "bigpictureoverlay" },
}

-- Python recursed without a limit; a theme mapping a name to itself crashed
-- the loader. The limit only stops such cycles.
local MAX_DEPTH = 16

-- mappings is the theme's "tabs" object from theme.json.
function M.extend(tabs, mappings, depth)
    depth = depth or 0
    if depth > MAX_DEPTH then
        error("Tab mappings refer to each other in a loop", 0)
    end
    if type(tabs) ~= "table" then
        error("Expected a list of tabs", 0)
    end
    if #tabs == 0 then
        local default = mappings.default
        if pyjson.is_array(default) then
            return M.extend(default, mappings, depth + 1)
        end
        return {}
    end
    local extended = {}
    for _, tab in ipairs(tabs) do
        local mapped = mappings[tab]
        if mapped == nil then
            mapped = DEFAULT_MAPPINGS[tab]
        end
        if mapped ~= nil then
            for _, item in ipairs(M.extend(mapped, mappings, depth + 1)) do
                extended[#extended + 1] = item
            end
        else
            extended[#extended + 1] = tab
        end
    end
    return extended
end

return M
