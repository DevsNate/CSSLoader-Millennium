-- DeckThemes lists a theme under a desktop category (Desktop, Desktop-Store, ...)
-- or a Big Picture one, but theme.json doesn't say which. The category decides
-- the UI mode a theme applies in; this matters for the store pages, which both
-- modes share. Scopes are cached in plugin config by theme id; a
-- .css-loader-scope.json file in a theme folder overrides them. Not in upstream,
-- which had no desktop mode to tell apart.

local millennium = require("millennium")

local M = {}

local CACHE_KEY = "catalogScopes"

local function cache()
    local ok, value = pcall(millennium.config.get, CACHE_KEY)
    if ok and type(value) == "table" then
        return value
    end
    return {}
end

local function is_uuid(id)
    return type(id) == "string"
        and string.match(id, "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") ~= nil
end

function M.scope_for_targets(targets)
    local has_desktop, has_gamepad = false, false
    for _, target in ipairs(targets) do
        local lower = string.lower(tostring(target))
        if lower == "desktop" or string.sub(lower, 1, 8) == "desktop-" then
            has_desktop = true
        else
            has_gamepad = true
        end
    end
    if has_desktop and has_gamepad then
        return "all"
    end
    return has_desktop and "desktop" or has_gamepad and "gamepad" or "all"
end

local function scope_from_record(record)
    local targets = record.targets
    if type(targets) ~= "table" or #targets == 0 then
        targets = type(record.target) == "string" and { record.target } or {}
    end
    return M.scope_for_targets(targets)
end

local SCOPES = { all = true, desktop = true, gamepad = true }

function M.apply(themes)
    local scopes = cache()
    for _, theme in ipairs(themes) do
        local cached = type(theme.id) == "string" and scopes[theme.id] or nil
        if not SCOPES[cached] then
            cached = nil
        end
        theme.scope = theme.scope_override or cached or "all"
    end
end

-- records: DeckThemes theme records. True when the cache changed. asked: the
-- ids that were looked up. One DeckThemes doesn't know counts as "all", so it
-- isn't asked about again at every start.
function M.remember(records, asked)
    local scopes = cache()
    local changed = false
    for _, id in ipairs(asked or {}) do
        if scopes[id] == nil then
            scopes[id] = "all"
            changed = true
        end
    end
    for _, record in ipairs(records) do
        if type(record) == "table" and is_uuid(record.id) then
            local scope = scope_from_record(record)
            if scopes[record.id] ~= scope then
                scopes[record.id] = scope
                changed = true
            end
        end
    end
    if changed then
        millennium.config.set(CACHE_KEY, scopes)
    end
    return changed
end

-- Ids of installed DeckThemes themes whose category isn't known yet.
function M.unknown_ids(themes)
    local known = cache()
    local seen, ids = {}, {}
    for _, theme in ipairs(themes) do
        local id = theme.id
        if is_uuid(id) and known[id] == nil and not seen[id] then
            seen[id] = true
            ids[#ids + 1] = id
        end
    end
    return ids
end

return M
