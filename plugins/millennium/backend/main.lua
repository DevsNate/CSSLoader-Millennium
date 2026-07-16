local logger = require("logger")
local millennium = require("millennium")
local fs = require("fs")

local REPORT_FILE = fs.join(
    millennium.steam_path(),
    "millennium",
    "themes",
    "CSS Loader",
    "build-report.json"
)

local function read_file(path)
    local file = io.open(path, "rb")
    if not file then return "" end
    local body = file:read("*a")
    file:close()
    return body or ""
end

function get_css_loader_revision()
    return read_file(REPORT_FILE)
end

local function on_load()
    logger:info("CSS Loader runtime companion loaded")
    millennium.ready()
end

local function on_unload()
    logger:info("CSS Loader runtime companion unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
