-- One piece of CSS and the tabs it targets. Ported from upstream's css_inject.py
-- (Inject, to_inject, to_injects) and the transaction order of css_browserhook.py:
-- enabled injects are kept in activation order, and an inject that is injected
-- again moves to the end of the cascade.

local classes = require("engine.classes")
local paths = require("engine.paths")
local pyjson = require("engine.pyjson")
local tabs_module = require("engine.tabs")

local M = {}

-- Enabled injects, in cascade order.
local active = {}

-- A fresh id per injection, as upstream's uuids. The time keeps ids from
-- repeating across backend restarts, while windows may still hold old styles.
local session = string.format("%x", os.time())
local next_id = 0

local Inject = {}
Inject.__index = Inject

-- css_path is relative to the themes folder; "" for generated CSS.
function M.new(css_path, tabs, theme)
    return setmetatable({ css_path = css_path, tabs = tabs, theme = theme, css = nil, enabled = false, id = "" }, Inject)
end

function Inject:load()
    if self.css_path == "" then
        return
    end
    local file = paths.theme_file(self.css_path)
    local source = file and paths.read_small(file)
    if type(source) ~= "string" then
        error("Could not read " .. self.css_path, 0)
    end
    -- CSS is used as written. Upstream escaped backslashes and backticks twice
    -- for an old JavaScript-string transport.
    self.css = classes.rewrite_assets(classes.translate(source))
end

function Inject:deactivate()
    for index, item in ipairs(active) do
        if item == self then
            table.remove(active, index)
            return
        end
    end
end

function Inject:inject()
    if self.css == nil then
        self:load()
    end
    self.enabled = true
    self:deactivate()
    next_id = next_id + 1
    self.id = "css-loader-" .. session .. "-" .. next_id
    active[#active + 1] = self
end

function Inject:remove()
    self.enabled = false
    self:deactivate()
end

-- Enabled injects that have CSS, in cascade order.
function M.active()
    local list = {}
    for _, item in ipairs(active) do
        if item.css ~= nil then
            list[#list + 1] = item
        end
    end
    return list
end

function M.clear_active()
    active = {}
end

function M.as_string_list(value)
    if not pyjson.is_array(value) then
        error("Expected a list of tabs", 0)
    end
    local list = {}
    for index, item in ipairs(value) do
        list[index] = tostring(item)
    end
    return list
end

-- folder/key, normalised; a path that leaves the themes folder is refused.
function M.join_theme_path(folder, key)
    local parts = {}
    for part in string.gmatch(paths.slashes(folder .. "/" .. key), "[^/]+") do
        if part == ".." then
            if #parts == 0 then
                error(key .. " is outside the themes folder", 0)
            end
            parts[#parts] = nil
        elseif part ~= "." then
            parts[#parts + 1] = part
        end
    end
    return table.concat(parts, "/")
end

-- A theme.json "inject" entry: a file and its tabs, or a CSS variable whose
-- first "tab" is the value.
function M.to_inject(key, tabs, folder, theme)
    if string.sub(key, 1, 2) == "--" then
        if #tabs == 0 then
            error("list index out of range", 0)
        end
        local rest = {}
        for index = 2, #tabs do
            rest[index - 1] = tabs[index]
        end
        local item = M.new("", tabs_module.extend(rest, theme.tab_mappings), theme)
        item.css = ":root { " .. key .. ": " .. tostring(tabs[1]) .. "; }"
        return item
    end
    return M.new(M.join_theme_path(folder, key), tabs_module.extend(tabs, theme.tab_mappings), theme)
end

function M.to_injects(items, folder, theme)
    if not pyjson.is_object(items) then
        error("Expected an object of CSS files and their tabs", 0)
    end
    local list = {}
    for _, key in ipairs(pyjson.keys(items)) do
        list[#list + 1] = M.to_inject(key, M.as_string_list(items[key]), folder, theme)
    end
    return list
end

return M
