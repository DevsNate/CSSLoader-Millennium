-- Class translations and asset URLs: the text passes upstream's css_inject.py
-- runs over a theme's CSS when it loads it (css_utils.py for the map).

local fs = require("fs")
local json = require("json")
local logger = require("logger")
local paths = require("engine.paths")

local M = {}

-- css_translations.json: { uid: [old, ..., latest] }. Every older class name
-- maps to the latest one.
local mappings = {}
local has_mappings = false

function M.translations_file()
    return fs.join(paths.themes_path(), "css_translations.json")
end

function M.load_translations()
    local text = paths.read_small(M.translations_file())
    if not text then
        return
    end
    local ok, data = pcall(json.decode, text)
    if not ok or type(data) ~= "table" then
        logger:warn("Could not read css_translations.json: " .. tostring(data))
        return
    end
    local map = {}
    for _, versions in pairs(data) do
        if type(versions) == "table" and #versions > 0 then
            local latest = versions[#versions]
            for index = 1, #versions - 1 do
                map[versions[index]] = latest
            end
        end
    end
    mappings = map
    has_mappings = next(map) ~= nil
end

-- Inject.load's two passes: `.class` selectors and [class*="..."] attributes.
function M.translate(css)
    if not has_mappings then
        return css
    end
    css = string.gsub(css, "%.[_%a]+[_%w%-]*", function(token)
        local mapped = mappings[string.sub(token, 2)]
        return mapped and ("." .. mapped) or nil
    end)
    css = string.gsub(css, '%[class[%*%^|~]="[_%w%-]*"%]', function(token)
        local mapped = mappings[string.sub(token, 10, -3)]
        return mapped and (string.sub(token, 1, 9) .. mapped .. string.sub(token, -2)) or nil
    end)
    return css
end

-- Where /themes_custom/ points. Stock CSS Loader serves it through a
-- steamui\themes_custom symlink, which needs Developer Mode or admin rights on
-- Windows; this port uses Millennium's file route instead.
function M.rewrite_assets(css)
    local base = paths.themes_url()
    return (string.gsub(css, "url%(%s*(['\"]?)/themes_custom/", function(quote)
        return "url(" .. quote .. base .. "/"
    end))
end

-- URL of a file in the themes folder (image picker components). Escaped, as
-- it goes into an unquoted url(); upstream only escaped spaces.
function M.themes_custom_url(relative_path)
    return paths.themes_url() .. "/" .. paths.url_path(relative_path)
end

return M
