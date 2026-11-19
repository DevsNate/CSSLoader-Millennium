-- CSS Loader backend, as upstream's Python backend was: the theme engine
-- (backend/engine, from css_loader.py, css_theme.py, css_inject.py and friends),
-- settings import, DeckThemes requests and the serve-time hook. The frontend
-- calls it and delivers the resulting styles to windows.

---@class ThemeEnvironment
---@field themes_path string
---@field themes_url string
---@field steam_path string
---@field steam_beta boolean
---@field flags table<string, boolean>
---@field css_loader_version number

---@class EngineResult
---@field success boolean
---@field message? string

---@class TranslationsResult
---@field success boolean
---@field changed? boolean
---@field error? string

---@class WriteResult
---@field success boolean
---@field error? string

---@class StoreResponse
---@field success boolean
---@field status? number
---@field body? string
---@field error? string

---@class HeldBlob
---@field success boolean
---@field id? string
---@field chunks? number
---@field size? number
---@field error? string

local catalog = require("engine.catalog")
local classes = require("engine.classes")
local fs = require("fs")
local http = require("http")
local json = require("json")
local loader = require("engine.loader")
local logger = require("logger")
local millennium = require("millennium")
local output = require("engine.output")
local paths = require("engine.paths")
local pyjson = require("engine.pyjson")
local theme_module = require("engine.theme")
local utils = require("utils")

local USER_AGENT = "SDH-CSSLoader/9 (css-loader-millennium/1.0)"
local STORE_ORIGIN = "https://api.deckthemes.com"
-- Millennium cancels a backend call after 30 seconds.
local NETWORK_TIMEOUT_SECONDS = 20
local MAX_BLOB_BYTES = 64 * 1024 * 1024
local CHUNK_BYTES = 3 * 1024 * 1024

local themes_path = paths.themes_path
local STEAM_PATH = paths.STEAM_PATH

-- Settings ----------------------------------------------------------------
-- Upstream kept settings in a "key:value" file named STORE in the themes
-- folder. They live in Millennium's plugin config now; the keys below are
-- imported once.

local STORE_KEYS = {
    "shortToken", "unpinnedThemes", "hiddenMotd", "enableNavPatch",
    "beta_translations", "watch", "no_deps_install",
}

local function import_store_file()
    local ok, imported = pcall(millennium.config.get, "storeImported")
    if ok and imported then
        return
    end
    local body = utils.read_file(fs.join(themes_path(), "STORE"))
    local values = {}
    for line in string.gmatch(body or "", "[^\r\n]+") do
        local key, value = string.match(line, "^([^:]+):(.*)$")
        if key then
            values[key] = value
        end
    end
    local count = 0
    for _, key in ipairs(STORE_KEYS) do
        if values[key] ~= nil then
            local existing = millennium.config.get(key)
            if existing == nil then
                millennium.config.set(key, values[key])
                count = count + 1
            end
        end
    end
    millennium.config.set("storeImported", true)
    logger:info("Imported " .. count .. " settings from the CSS Loader STORE file")
end

-- Environment -------------------------------------------------------------

local store_import_done = false

local function steam_beta_active()
    local branch = utils.read_file(fs.join(STEAM_PATH, "package", "beta"))
    branch = branch and utils.trim(branch) or ""
    return branch ~= "" and branch ~= "steamdeck_stable"
end

---@ffi
---@return ThemeEnvironment
function get_environment()
    -- Here rather than in on_load: config writes belong after startup.
    if not store_import_done then
        store_import_done = true
        local ok, err = pcall(import_store_file)
        if not ok then
            logger:warn("Could not import the STORE file: " .. tostring(err))
        end
    end
    local path = themes_path()
    paths.ensure_dir(path)
    -- Upstream's flag files (e.g. NO_DEPS_INSTALL) in the themes folder.
    local flags = {}
    for _, name in ipairs({ "WATCH", "NO_DEPS_INSTALL" }) do
        flags[string.lower(name)] = fs.exists(fs.join(path, name))
    end
    return {
        themes_path = paths.slashes(path),
        themes_url = paths.themes_url(),
        steam_path = paths.slashes(STEAM_PATH),
        css_loader_version = theme_module.CSS_LOADER_VER,
        steam_beta = steam_beta_active(),
        flags = flags,
    }
end

-- Theme library -----------------------------------------------------------
-- The calls upstream's frontend makes, by the same names. Each change is
-- committed here; the frontend then fetches the styles (get_styles).

local function committed(result)
    output.commit()
    return result
end

---@ffi
---@return string
function get_themes()
    local list = {}
    for index, theme in ipairs(loader.themes) do
        list[index] = theme:to_dict()
    end
    return pyjson.encode(pyjson.array(list))
end

local function load_errors()
    return pyjson.encode(pyjson.object({ { "fails", pyjson.array(loader.last_load_errors) } }))
end

---@ffi
---@return string
function get_last_load_errors()
    return load_errors()
end

---@ffi
---@param page number
---@return string
function get_styles(page)
    return output.styles_page(math.max(0, math.floor(tonumber(page) or 0)))
end

---@ffi
---@param name string
---@param state boolean
---@param set_deps boolean
---@param set_deps_value boolean
---@return EngineResult
function set_theme_state(name, state, set_deps, set_deps_value)
    return committed(loader.set_theme_state(name, state, set_deps, set_deps_value))
end

---@ffi
---@param theme_name string
---@param patch_name string
---@param value string
---@return EngineResult
function set_patch_of_theme(theme_name, patch_name, value)
    return committed(loader.set_patch_of_theme(theme_name, patch_name, value))
end

---@ffi
---@param theme_name string
---@param patch_name string
---@param component_name string
---@param value string
---@return EngineResult
function set_component_of_theme_patch(theme_name, patch_name, component_name, value)
    return committed(loader.set_component_of_theme_patch(theme_name, patch_name, component_name, value))
end

---@ffi
---@return string
function reset()
    loader.reset()
    output.commit()
    return load_errors()
end

---@ffi
---@param theme_name string
---@return EngineResult
function delete_theme(theme_name)
    return committed(loader.delete_theme(theme_name))
end

---@ffi
---@param name string
---@return EngineResult
function generate_preset_theme(name)
    return loader.generate_preset_theme(name)
end

---@ffi
---@param name string
---@param theme_names string
---@return EngineResult
function generate_preset_theme_from_theme_names(name, theme_names)
    local ok, names = pcall(pyjson.decode, theme_names)
    if not ok or not pyjson.is_array(names) then
        return { success = false, message = "Invalid theme list." }
    end
    return loader.generate_preset_theme_from_theme_names(name, names)
end

---@ffi
---@param mode string
---@return boolean
function set_ui_mode(mode)
    output.set_ui_mode(mode)
    return true
end

-- Writes one file of an unpacked theme zip. path is relative to the themes
-- folder; data is Base64.
---@ffi
---@param path string
---@param data string
---@return WriteResult
function write_theme_file(path, data)
    local full = paths.theme_file(path)
    if not full or type(data) ~= "string" or #data > paths.MAX_FILE_BYTES * 2 then
        return { success = false, error = "Invalid theme file: " .. tostring(path) }
    end
    local parent = fs.parent_path(full)
    if not paths.ensure_dir(parent) then
        return { success = false, error = "Could not create " .. tostring(parent) }
    end
    local ok, err = utils.write_file(full, utils.base64_decode(data))
    return { success = ok == true, error = ok and nil or tostring(err) }
end

-- Largest modification time under the themes folder, for live CSS editing.
---@ffi
---@return number
function themes_modified()
    local latest = 0
    for _, entry in ipairs(fs.list_recursive(themes_path()) or {}) do
        if entry.is_file and (string.match(entry.name, "%.css$") or entry.name == "theme.json") then
            local time = tonumber(fs.last_write_time(entry.path)) or 0
            if time > latest then
                latest = time
            end
        end
    end
    return latest
end

-- DeckThemes categories ---------------------------------------------------

-- record is the DeckThemes record of a theme that was just installed.
---@ffi
---@param record string
---@return boolean
function remember_catalog_record(record)
    local ok, decoded = pcall(json.decode, record)
    if ok and type(decoded) == "table" then
        catalog.remember({ decoded })
    end
    return true
end

-- Themes installed before this plugin: learn their categories. One request
-- per call, with a short timeout: backend calls run one at a time, so a slow
-- network must not hold up the theme list or a toggle. The frontend calls
-- again while more is true.

---@class CatalogStep
---@field changed boolean
---@field more boolean

local CATALOG_TIMEOUT_SECONDS = 8
local CATALOG_BATCH = 40

---@ffi
---@return CatalogStep
function refresh_catalog_scopes()
    local ids = catalog.unknown_ids(loader.themes)
    if #ids == 0 then
        return { changed = false, more = false }
    end
    local batch = {}
    for index = 1, math.min(CATALOG_BATCH, #ids) do
        batch[index] = ids[index]
    end
    local res = http.get(STORE_ORIGIN .. "/themes/ids?ids=" .. table.concat(batch, "."),
        { timeout = CATALOG_TIMEOUT_SECONDS, user_agent = USER_AGENT })
    local ok, records = pcall(json.decode, res and res.status == 200 and res.body or "")
    if not ok or type(records) ~= "table" then
        -- Offline, or DeckThemes is down: try again next start.
        return { changed = false, more = false }
    end
    local changed = catalog.remember(records, batch)
    if changed then
        catalog.apply(loader.themes)
        output.commit()
    end
    return { changed = changed, more = #ids > #batch }
end

-- Class translations ------------------------------------------------------
-- api.deckthemes.com publishes a map from each Steam class name to its newer
-- versions (upstream main.py fetch_class_mappings). The frontend downloads it,
-- so the backend never waits on the network for it, and hands it here.

---@ffi
---@param text string
---@return TranslationsResult
function save_translations(text)
    if type(text) ~= "string" or utils.trim(text) == "" or #text > paths.MAX_FILE_BYTES then
        return { success = false, error = "The translations are empty or too large." }
    end
    local ok, decoded = pcall(json.decode, text)
    if not ok or type(decoded) ~= "table" then
        return { success = false, error = "The translations are not valid JSON." }
    end
    local file = classes.translations_file()
    if paths.read_small(file) == text then
        return { success = true, changed = false }
    end
    local written, write_err = paths.write_atomic(file, text)
    if not written then
        return { success = false, error = tostring(write_err) }
    end
    logger:info("Saved new CSS translations")
    classes.load_translations()
    loader.reset()
    output.commit()
    return { success = true, changed = true }
end

-- DeckThemes API ----------------------------------------------------------
-- Upstream's fetchNoCors calls, limited to api.deckthemes.com.

local STORE_METHODS = { GET = true, POST = true, DELETE = true }

---@ffi
---@param method string
---@param path string
---@param token string
---@param body string
---@return StoreResponse
function store_request(method, path, token, body)
    method = string.upper(tostring(method or "GET"))
    if not STORE_METHODS[method] then
        return { success = false, error = "Unsupported method." }
    end
    if type(path) ~= "string" or string.sub(path, 1, 1) ~= "/" or string.sub(path, 1, 2) == "//"
        or #path > 4096 or string.find(path, "[%z\1-\32\127\\#]") then
        return { success = false, error = "Invalid DeckThemes path." }
    end
    local headers = { ["Accept"] = "application/json" }
    if type(token) == "string" and token ~= "" then
        if #token > 4096 or string.find(token, "[%z\1-\32\127]") then
            return { success = false, error = "Invalid token." }
        end
        headers["Authorization"] = "Bearer " .. token
    end
    local options = { method = method, headers = headers, timeout = NETWORK_TIMEOUT_SECONDS, user_agent = USER_AGENT }
    if type(body) == "string" and body ~= "" then
        headers["Content-Type"] = "application/json"
        options.data = body
    end
    local res, err = http.request(STORE_ORIGIN .. path, options)
    if not res then
        return { success = false, error = tostring(err) }
    end
    return { success = true, status = res.status, body = res.body or "" }
end

-- Theme zips are downloaded here and read by the frontend in chunks (a backend
-- reply is limited to 8 MB). A chunk is a multiple of 3 bytes, so the Base64
-- of each chunk joins without padding.
local held = {}

---@ffi
---@param blob_id string
---@return HeldBlob
function download_blob(blob_id)
    if type(blob_id) ~= "string" or not string.match(blob_id, "^[%w%-]+$") or #blob_id > 128 then
        return { success = false, error = "Invalid download id." }
    end
    local temp_dir = utils.getenv("TEMP") or utils.getenv("TMP") or paths.DATA_DIR
    local temp = fs.join(temp_dir, "css-loader-" .. utils.uuid() .. ".zip")
    local ok, result, err = pcall(http.download, STORE_ORIGIN .. "/blobs/" .. blob_id, temp, {
        timeout = NETWORK_TIMEOUT_SECONDS, follow_redirects = true, verify_ssl = true, user_agent = USER_AGENT,
    })
    if not ok or not result or not result.success or (result.status and result.status ~= 200) then
        os.remove(temp)
        return { success = false, error = "Download failed: " .. tostring(ok and (err or (result and result.status)) or result) }
    end
    local size = tonumber(fs.file_size(temp)) or 0
    local bytes = size > 0 and size <= MAX_BLOB_BYTES and utils.read_file(temp) or nil
    os.remove(temp)
    if not bytes or string.sub(bytes, 1, 2) ~= "PK" then
        return { success = false, error = "The download is not a zip file." }
    end
    for id in pairs(held) do
        held[id] = nil
    end
    local id = utils.uuid()
    held[id] = bytes
    return { success = true, id = id, size = #bytes, chunks = math.ceil(#bytes / CHUNK_BYTES) }
end

---@ffi
---@param id string
---@param index number
---@return string|boolean
function read_blob_chunk(id, index)
    local bytes = held[id]
    index = tonumber(index)
    if not bytes or not index or index < 0 or index ~= math.floor(index) then
        return false
    end
    local start = index * CHUNK_BYTES + 1
    if start > #bytes then
        return false
    end
    return utils.base64_encode(string.sub(bytes, start, start + CHUNK_BYTES - 1))
end

---@ffi
---@param id string
---@return boolean
function release_blob(id)
    if type(id) == "string" then
        held[id] = nil
    end
    return true
end

-- First paint -------------------------------------------------------------
-- The windows Steam opens before the frontend has loaded (the first desktop or
-- Big Picture window) get their styles from engine/output.lua's startup file,
-- which on_load builds from the theme files before Millennium lets anything
-- load. Steam's CreatePopup reads it the first time it runs, and synchronously,
-- so the styles are in the window before Steam renders into it. A script tag
-- can't do that: Millennium serves plugin scripts as deferred modules, and a
-- stylesheet added by script doesn't hold back rendering.
--
-- The patch stays small and fixed in size. Millennium v3.6.2 writes every
-- plugin's patches to a pipe of about 4 KB while Steam launches its web helper,
-- before anything reads it, so a longer list stops Steam from starting.
local STARTUP_HOOK = [[(window.__cssLoaderBoot||(window.__cssLoaderBoot=function(){try{var x=new XMLHttpRequest;x.open("GET","]]
    .. output.STARTUP_URL
    .. [[",!1);x.send();return(0,eval)(x.responseText)}catch(e){}}()||function(){}))]]

local patches = {
    -- Every window Steam's popup manager creates: after its document is
    -- written, before Steam renders into it.
    {
        file = [[sp\.js]],
        find = [[static CreatePopup\([\w$]+,[\w$]+\)\{[\s\S]*?,\{popup:[\w$]+,element:]],
        transforms = {
            {
                match = [[,\{popup:([\w$]+),element:]],
                replace = "," .. STARTUP_HOOK .. [[(arguments[0],\1),{popup:\1,element:]],
            },
        },
    },
}

-- Lifecycle ---------------------------------------------------------------

-- Config writes don't belong here (see get_environment), and nothing here may
-- keep millennium.ready() from being called.
local function on_load()
    local started = os.clock()
    local ok, err = pcall(function()
        output.load_ui_mode()
        classes.load_translations()
        loader.load()
        output.commit()
    end)
    if not ok then
        logger:error("Could not load the themes: " .. tostring(err))
    end
    logger:info(string.format("CSS Loader backend loaded %d themes from %s in %.0f ms",
        #loader.themes, themes_path(), (os.clock() - started) * 1000))
    millennium.ready()
end

local function on_unload()
    output.remove_web_hooks()
end

return {
    on_load = on_load,
    on_unload = on_unload,
    patches = patches,
}
