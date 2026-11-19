-- Where things live, and validated file access. Ported from upstream's
-- css_utils.py; paths from the frontend and from theme.json files are checked
-- before they reach the file system.

local fs = require("fs")
local millennium = require("millennium")
local utils = require("utils")

local M = {}

local MAX_FILE_BYTES = 32 * 1024 * 1024

M.MAX_FILE_BYTES = MAX_FILE_BYTES
M.STEAM_PATH = millennium.steam_path()
-- Generated files (startup styles, web page styles). Millennium skips folders
-- without a plugin.json or millennium.toml.
M.DATA_DIR = fs.join(M.STEAM_PATH, "millennium", "plugins", "css-loader")

function M.slashes(path)
    return (string.gsub(path, "\\", "/"))
end

local function default_themes_path()
    local home = utils.getenv("USERPROFILE") or utils.getenv("HOME") or ""
    return fs.join(home, "homebrew", "themes")
end

-- Read from config once per library load (refresh), not once per file.
local cached_path, cached_url = nil, nil

function M.refresh()
    local ok, configured = pcall(millennium.config.get, "themesPath")
    if ok and type(configured) == "string" and configured ~= "" then
        cached_path = configured
    else
        cached_path = default_themes_path()
    end
    cached_url = nil
end

function M.themes_path()
    if not cached_path then
        M.refresh()
    end
    return cached_path
end

function M.ensure_dir(path)
    if fs.is_directory(path) then
        return true
    end
    local created, err = fs.create_directories(path)
    return created or fs.is_directory(path), err
end

-- A path relative to the themes folder (forward slashes). No absolute paths,
-- drive letters, empty, "." or ".." components, and none of the characters
-- Windows forbids in names.
function M.safe_relative(path)
    if type(path) ~= "string" or path == "" or #path > 1024 then
        return nil
    end
    if string.find(path, "[%c<>:\"|%?%*]") then
        return nil
    end
    path = M.slashes(path)
    if string.sub(path, 1, 1) == "/" then
        return nil
    end
    local parts = {}
    for part in string.gmatch(path, "[^/]+") do
        if part == "." or part == ".." or string.match(part, "^%s") or string.match(part, "[%s%.]$") then
            return nil
        end
        parts[#parts + 1] = part
    end
    if #parts == 0 then
        return nil
    end
    return table.concat(parts, "/")
end

function M.theme_file(path)
    local relative = M.safe_relative(path)
    if not relative then
        return nil
    end
    return fs.join(M.themes_path(), relative)
end

-- A single folder name directly inside the themes folder.
function M.theme_folder(name)
    local relative = M.safe_relative(name)
    if not relative or string.find(relative, "/", 1, true) then
        return nil
    end
    return fs.join(M.themes_path(), relative)
end

function M.read_small(path)
    if not fs.is_file(path) then
        return nil
    end
    local size = tonumber(fs.file_size(path)) or 0
    if size > MAX_FILE_BYTES then
        return nil
    end
    return utils.read_file(path)
end

-- Replaces the file in one step, so a reader sees the old text or the new.
function M.write_atomic(path, content)
    local temp = path .. ".tmp"
    local ok, err = utils.write_file(temp, content)
    if not ok then
        return false, err
    end
    -- Replaces the target in place. If that fails (the file is locked), the
    -- old file stays as it was.
    local renamed, rename_err = fs.rename(temp, path)
    if not renamed then
        os.remove(temp)
        return false, rename_err or ("Could not replace " .. path)
    end
    return true
end

-- Encodes an absolute path for Millennium's file route (https://millennium.ftp/).
-- The route decodes %XX and '+', so everything except unreserved characters
-- and '/' is escaped.
function M.url_path(path)
    return (string.gsub(M.slashes(path), "[^%w%-%._~/]", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

function M.themes_url()
    if not cached_url then
        cached_url = "https://millennium.ftp/" .. M.url_path(M.themes_path())
    end
    return cached_url
end

return M
