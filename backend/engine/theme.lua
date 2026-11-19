-- A theme, its patches and their components. Ported from upstream's css_theme.py,
-- css_themepatch.py, css_themepatchcomponent.py and css_sfp_compat.py. Python's
-- exceptions are kept as errors; the loader records them as load errors.

local classes = require("engine.classes")
local fs = require("fs")
local inject_module = require("engine.inject")
local paths = require("engine.paths")
local pyjson = require("engine.pyjson")

local M = {}

M.CSS_LOADER_VER = 9
M.FLAG_KEEP_DEPENDENCIES = "KEEP_DEPENDENCIES"
M.FLAG_PRESET = "PRESET"

local NULL = pyjson.NULL

local SFP_DEFAULT_FILES = {
    { "libraryroot.custom.css", { "desktop", "desktopoverlay", "desktopcontextmenu" } },
    { "bigpicture.custom.css", { "bigpicture", "bigpictureoverlay" } },
    { "friends.custom.css", { "desktopchat" } },
    { "webkit.css", { "store" } },
}

local function raise(message)
    error(message, 0)
end

-- A value of a JSON key, with null read as missing.
local function field(object, key)
    local value = object[key]
    if value == NULL then
        return nil
    end
    return value
end

local function required(object, key)
    local value = object[key]
    if value == nil then
        raise("'" .. key .. "'")
    end
    return value
end

local function required_string(object, key)
    local value = required(object, key)
    if type(value) ~= "string" then
        raise("'" .. key .. "' is not text")
    end
    return value
end

-- Python's truth value, as upstream's `if config["active"]` used.
local function truthy(value)
    if value == nil or value == NULL or value == false or value == 0 or value == "" then
        return false
    end
    if pyjson.is_array(value) then
        return #value > 0
    end
    if pyjson.is_object(value) then
        return #pyjson.keys(value) > 0
    end
    return true
end

local function starts_with(text, prefix)
    return string.sub(text, 1, #prefix) == prefix
end

local function trim(text)
    return (string.match(text, "^%s*(.-)%s*$"))
end

local function truncate(value)
    return value < 0 and math.ceil(value) or math.floor(value)
end

-- Colour helpers from css_themepatchcomponent.py, including its rounding ---

local function parse_hex(text)
    if text == "" or string.find(text, "%X") then
        raise("invalid literal for int() with base 16: '" .. text .. "'")
    end
    return tonumber(text, 16)
end

local function hex_to_rgb(hex)
    local values = string.sub(hex, 2)
    if #values < 6 then
        return parse_hex(string.sub(values, 1, 1)), parse_hex(string.sub(values, 2, 2)), parse_hex(string.sub(values, 3, 3))
    end
    return parse_hex(string.sub(values, 1, 2)), parse_hex(string.sub(values, 3, 4)), parse_hex(string.sub(values, 5, 6))
end

local function value_from_masks(m1, m2, hue)
    local ONE_SIXTH, TWO_THIRD = 1 / 6, 2 / 3
    hue = hue % 1
    if hue < ONE_SIXTH then
        return m1 + (m2 - m1) * hue * 6
    elseif hue < 0.5 then
        return m2
    elseif hue < TWO_THIRD then
        return m1 + (m2 - m1) * (TWO_THIRD - hue) * 6
    end
    return m1
end

local function python_float(text)
    local body = trim(text)
    local number = string.match(body, "^[+-]?%d+%.?%d*$") or string.match(body, "^[+-]?%.%d+$")
        or string.match(body, "^[+-]?%d+%.?%d*[eE][+-]?%d+$") or string.match(body, "^[+-]?%.%d+[eE][+-]?%d+$")
    local value = number and tonumber(number)
    if not value then
        raise("could not convert string to float: '" .. text .. "'")
    end
    return value
end

local function hsl_to_rgb(hue, saturation, lightness)
    local ONE_THIRD = 1 / 3
    local h = python_float(hue) / 360
    local l = python_float(lightness) / 100
    local s = python_float(saturation) / 100
    if s == 0 then
        local grey = truncate(l * 100)
        return grey, grey, grey
    end
    local m2 = l <= 0.5 and l * (1 + s) or l + s - l * s
    local m1 = 2 * l - m2
    return truncate(value_from_masks(m1, m2, h + ONE_THIRD) * 255),
        truncate(value_from_masks(m1, m2, h) * 255),
        truncate(value_from_masks(m1, m2, h - ONE_THIRD) * 255)
end

local function check_color(value)
    local length = #value
    if string.sub(value, 1, 1) ~= "#" or not (length == 4 or length == 5 or length == 7 or length == 9)
        or string.find(value, "%X", 2) then
        raise("Color picker default is not a valid hex value")
    end
end

local function check_image_path(path)
    if starts_with(trim(path), "/") then
        raise("Image Picker path cannot be absolute")
    end
    for part in string.gmatch(path .. "/", "(.-)/") do
        if trim(part) == ".." then
            raise("Going back in a relative path is not allowed")
        end
    end
end

local function assert_image_exists(path)
    check_image_path(path)
    local file = paths.theme_file(path)
    if not file or not fs.is_file(file) then
        raise("Image Picker specified image does not exist")
    end
end

local function rgb_from_value(value)
    if string.sub(value, 1, 1) == "#" then
        return hex_to_rgb(value)
    end
    if (starts_with(value, "hsla(") or starts_with(value, "hsl(")) and string.sub(value, -1) == ")" then
        local inner = string.sub(value, string.find(value, "(", 1, true) + 1, -2)
        local values = {}
        for part in string.gmatch(inner .. ",", "(.-),") do
            values[#values + 1] = trim(part)
        end
        if #values < 3 then
            raise("list index out of range")
        end
        return hsl_to_rgb(values[1], string.sub(values[2], 1, -2), string.sub(values[3], 1, -2))
    end
    raise("Unable to parse color-picker value '" .. value .. "'")
end

-- ThemePatchComponent -----------------------------------------------------

local Component = {}
Component.__index = Component

local function new_component(patch, data)
    if not pyjson.is_object(data) then
        raise("A patch component is not an object")
    end
    -- Intentionally not doing error checking here. This should error when loaded incorrectly
    local self = setmetatable({ patch = patch }, Component)
    self.name = required_string(data, "name")
    self.type = required_string(data, "type")
    if self.type ~= "color-picker" and self.type ~= "image-picker" then
        raise("Unknown component type '" .. self.type .. "'")
    end
    self.default = required_string(data, "default")
    if self.type == "color-picker" then
        if not pcall(check_color, self.default) then
            self.default = "#FFFFFF"
        end
    else
        check_image_path(self.default)
    end
    self.value = self.default
    self.on = required_string(data, "on")
    self.css_variable = required_string(data, "css_variable")
    if not starts_with(self.css_variable, "--") then
        self.css_variable = "--" .. self.css_variable
    end
    self.tabs = inject_module.as_string_list(required(data, "tabs"))
    self.inject = inject_module.to_inject("", self.tabs, "", patch.theme)
    self:generate()
    return self
end

function Component:generate()
    local value, variable = self.value, self.css_variable
    if type(value) ~= "string" then
        return false
    end
    if string.find(variable, ";", 1, true) or string.find(value, ";", 1, true) then
        return false
    end
    if self.type == "color-picker" then
        local ok, r, g, b = pcall(rgb_from_value, value)
        if ok then
            self.inject.css = string.format(":root { %s: %s; %s_r: %d; %s_g: %d; %s_b: %d; %s_rgb: %d, %d, %d; }",
                variable, value, variable, r, variable, g, variable, b, variable, r, g, b)
        else
            self.inject.css = ":root { " .. variable .. ": " .. value .. "; }"
        end
    elseif self.type == "image-picker" then
        if not pcall(check_image_path, value) then
            return false
        end
        -- /themes_custom/ is served through Millennium's file route.
        self.inject.css = ":root { " .. variable .. ": url(" .. classes.themes_custom_url(value) .. ") }"
    end
    return true
end

function Component:generate_and_reinject()
    if self.type == "image-picker" then
        assert_image_exists(self.value)
    end
    if not self:generate() then
        raise("???")
    end
    if self.inject.enabled then
        self.inject:inject()
    end
end

function Component:to_dict()
    return pyjson.object({
        { "name", self.name }, { "type", self.type }, { "on", self.on }, { "value", self.value },
    })
end

-- ThemePatch --------------------------------------------------------------

local Patch = {}
Patch.__index = Patch

local PATCH_TYPES = { dropdown = true, checkbox = true, slider = true, none = true }

local function new_patch(theme, data, name)
    if not pyjson.is_object(data) then
        raise("In patch '" .. name .. "' the definition is not an object")
    end
    local self = setmetatable({
        theme = theme, json = data, name = name, injects = {}, components = {},
        options = {}, option_names = {},
    }, Patch)
    self.default = field(data, "default")
    self.type = data.type ~= nil and data.type or "dropdown"

    local function add_option(option)
        self.options[option] = {}
        self.option_names[#self.option_names + 1] = option
    end
    if data.values ~= nil then -- Do we have a v2 or a v1 format?
        self.patch_version = 2
        if not pyjson.is_object(data.values) then
            raise("In patch '" .. name .. "' the values are not an object")
        end
        for _, option in ipairs(pyjson.keys(data.values)) do
            add_option(option)
        end
    else
        self.patch_version = 1
        for _, option in ipairs(pyjson.keys(data)) do
            if option ~= "default" then
                add_option(option)
            end
        end
    end
    if #self.option_names == 0 then
        raise("In patch '" .. name .. "' there is less than 1 value present")
    end
    if self.default == nil then
        self.default = self.option_names[1]
    end
    if self.options[self.default] == nil then
        raise("In patch '" .. name .. "', '" .. tostring(self.default) .. "' does not exist as a patch option")
    end
    self.value = self.default
    self:load()
    return self
end

function Patch:set_value(value)
    if type(value) == "string" then
        self.value = value
    elseif pyjson.is_object(value) then
        if value.value ~= nil then
            self.value = value.value
        end
        local components = value.components
        if components ~= nil then
            if not pyjson.is_object(components) then
                raise("???")
            end
            for _, component in ipairs(self.components) do
                if components[component.name] ~= nil then
                    component.value = components[component.name]
                    component:generate()
                end
            end
        end
    end
end

function Patch:get_value()
    if #self.components == 0 then
        return self.value
    end
    local components = pyjson.new_object()
    for _, component in ipairs(self.components) do
        pyjson.set(components, component.name, component.value)
    end
    return pyjson.object({ { "value", self.value }, { "components", components } })
end

function Patch:check_value()
    if self.options[self.value] == nil then
        self.value = self.default
    end
    if not PATCH_TYPES[self.type] then
        self.type = "dropdown"
    end
    if self.type == "checkbox" and not (self.options.No and self.options.Yes) then
        self.type = "dropdown"
    end
end

function Patch:load()
    for _, option in ipairs(self.option_names) do
        local data = self.patch_version == 1 and self.json[option] or self.json.values[option]
        for _, item in ipairs(inject_module.to_injects(data, self.theme.folder, self.theme)) do
            self.injects[#self.injects + 1] = item
            table.insert(self.options[option], item)
        end
    end
    local components = self.json.components
    if components ~= nil then
        if not pyjson.is_array(components) then
            raise("In patch '" .. self.name .. "' the components are not a list")
        end
        for _, data in ipairs(components) do
            local component = new_component(self, data)
            if self.options[component.on] == nil then
                raise("Component references non-existent value")
            end
            self.components[#self.components + 1] = component
            self.injects[#self.injects + 1] = component.inject
            table.insert(self.options[component.on], component.inject)
        end
    end
    self:check_value()
end

function Patch:inject()
    self:check_value()
    for _, item in ipairs(self.options[self.value] or {}) do
        -- Ignore result for now. It'll be logged but not acted upon
        local ok, err = pcall(item.inject, item)
        if not ok then
            require("logger"):warn(self.theme.name .. " / " .. self.name .. ": " .. tostring(err))
        end
    end
end

function Patch:remove()
    self:check_value()
    for _, item in ipairs(self.injects) do
        item:remove()
    end
end

function Patch:to_dict()
    local components = {}
    for index, component in ipairs(self.components) do
        components[index] = component:to_dict()
    end
    return pyjson.object({
        { "name", self.name }, { "default", self.default }, { "value", self.value },
        { "options", pyjson.array(self.option_names) }, { "type", self.type },
        { "components", pyjson.array(components) },
    })
end

-- Theme -------------------------------------------------------------------

local Theme = {}
Theme.__index = Theme

local function read_priority(text)
    local number = string.match(text or "", "^%s*([+-]?%d+)")
    return number and tonumber(number) or 0
end

local function read_scope_override(text)
    if not text then
        return nil
    end
    local ok, data = pcall(pyjson.decode, text)
    local scope = ok and pyjson.is_object(data) and data.scope or nil
    if scope == "all" or scope == "desktop" or scope == "gamepad" then
        return scope
    end
    return nil
end

-- source is what the loader read for one folder (see loader.lua).
function M.new(folder, source)
    local self = setmetatable({
        folder = folder, source = source, name = "", display_name = nil, id = "", version = "v1.0", author = "",
        require = 1, flags = {}, tab_mappings = {}, dependencies = pyjson.new_object(), injects = {}, patches = {},
        enabled = false, created = nil, modified = source.modified, saved_config = source.config,
        priority_mod = read_priority(source.priority), scope = "all",
    }, Theme)
    self.scope_override = read_scope_override(source.scope)

    if source.theme_json == nil then
        if source.theme_css then
            self.name, self.id = folder, folder
            self.injects = { inject_module.new(inject_module.join_theme_path(folder, "theme.css"), { ".*" }, self) }
            return self
        end
        if #source.sfp > 0 then
            self.name, self.id = folder, folder
            for _, entry in ipairs(SFP_DEFAULT_FILES) do
                for _, file in ipairs(source.sfp) do
                    if file == entry[1] then
                        self.injects[#self.injects + 1] = inject_module.to_inject(file, entry[2], folder, self)
                    end
                end
            end
            return self
        end
        raise("Folder does not look like a theme?")
    end

    local data = pyjson.decode(source.theme_json)
    if not pyjson.is_object(data) then
        raise("theme.json is not an object")
    end
    self.created = source.created
    self.name = required_string(data, "name")
    self.display_name = field(data, "display_name")
    self.id = data.id ~= nil and data.id or self.name
    self.version = data.version ~= nil and data.version or "v1.0"
    self.author = data.author ~= nil and data.author or ""
    if data.manifest_version ~= nil then
        self.require = tonumber(data.manifest_version) or 1
    end
    if data.flags ~= nil then
        if not pyjson.is_array(data.flags) then
            raise("'flags' is not a list")
        end
        for index, flag in ipairs(data.flags) do
            self.flags[index] = string.upper(tostring(flag))
        end
    end
    if data.tabs ~= nil then
        if not pyjson.is_object(data.tabs) then
            raise("'tabs' is not an object")
        end
        self.tab_mappings = data.tabs
    end

    if M.CSS_LOADER_VER < self.require then
        raise(string.format("A newer version of the CssLoader is required to load this theme (Read manifest version %d but only up to %d is supported)",
            self.require, M.CSS_LOADER_VER))
    end

    if data.dependencies ~= nil then
        if not pyjson.is_object(data.dependencies) then
            raise("'dependencies' is not an object")
        end
        self.dependencies = data.dependencies
    end
    if data.inject ~= nil then
        self.injects = inject_module.to_injects(data.inject, folder, self)
    end
    if data.patches ~= nil then
        if not pyjson.is_object(data.patches) then
            raise("'patches' is not an object")
        end
        for _, name in ipairs(pyjson.keys(data.patches)) do
            self.patches[#self.patches + 1] = new_patch(self, data.patches[name], name)
        end
    end
    return self
end

function Theme:has_flag(flag)
    for _, item in ipairs(self.flags) do
        if item == flag then
            return true
        end
    end
    return false
end

-- Runs the existence checks of image picker defaults.
function Theme:check_images()
    for _, patch in ipairs(self.patches) do
        for _, component in ipairs(patch.components) do
            if component.type == "image-picker" then
                assert_image_exists(component.default)
            end
        end
    end
end

-- Theme.load: applies config_USER.json and marks the theme active. Starting up
-- writes nothing: upstream rewrote config_USER.json here on every start.
function Theme:load_config()
    if not self.source.config then
        return
    end
    local config = pyjson.decode(self.source.config)
    if not pyjson.is_object(config) then
        raise("config_USER.json is not an object")
    end
    local activate = false
    for _, key in ipairs(pyjson.keys(config)) do
        if key == "active" then
            activate = truthy(config.active)
        else
            for _, patch in ipairs(self.patches) do
                if patch.name == key then
                    patch:set_value(config[key])
                end
            end
        end
    end
    if activate then
        self:activate()
    end
end

-- Writes config_USER.json only when it changes.
function Theme:save()
    local config = pyjson.object({ { "active", self.enabled } })
    for _, patch in ipairs(self.patches) do
        pyjson.set(config, patch.name, patch:get_value())
    end
    if self.saved_config then
        local ok, saved = pcall(pyjson.decode, self.saved_config)
        if ok and pyjson.canonical(saved) == pyjson.canonical(config) then
            return
        end
    end
    local dir = paths.theme_folder(self.folder)
    if not dir or not fs.is_directory(dir) then
        raise("The theme folder no longer exists.")
    end
    local text = pyjson.encode(config)
    local written, err = paths.write_atomic(fs.join(dir, "config_USER.json"), text)
    if not written then
        raise(tostring(err or "The file could not be written."))
    end
    self.saved_config = text
    self.modified = os.time()
end

function Theme:activate()
    for _, item in ipairs(self.injects) do
        -- Ignore result for now. It'll be logged but not acted upon
        local ok, err = pcall(item.inject, item)
        if not ok then
            require("logger"):warn(self.name .. ": " .. tostring(err))
        end
    end
    for _, patch in ipairs(self.patches) do
        patch:inject()
    end
    self.enabled = true
end

function Theme:inject()
    self:activate()
    self:save()
end

function Theme:all_injects()
    local list = {}
    for _, item in ipairs(self.injects) do
        list[#list + 1] = item
    end
    for _, patch in ipairs(self.patches) do
        for _, item in ipairs(patch.injects) do
            list[#list + 1] = item
        end
    end
    return list
end

function Theme:remove()
    for _, item in ipairs(self:all_injects()) do
        item:remove()
    end
    self.enabled = false
    self:save()
end

function Theme:delete()
    self:remove()
    local dir = paths.theme_folder(self.folder)
    if not dir or not fs.is_directory(dir) or fs.is_symlink(dir) then
        raise("Could not find that theme folder.")
    end
    local removed, err = fs.remove_all(dir)
    if not removed then
        raise(tostring(err))
    end
    require("logger"):info("Deleted theme folder " .. self.folder)
end

function Theme:get_display_name()
    return self.display_name ~= nil and self.display_name or self.name
end

function Theme:add_prefix(id)
    if self.display_name == nil then
        self.display_name = self.name
    end
    self.name = self.name .. "_" .. id
end

function Theme:to_dict()
    local patches = {}
    for index, patch in ipairs(self.patches) do
        patches[index] = patch:to_dict()
    end
    local dependencies = {}
    for index, name in ipairs(pyjson.keys(self.dependencies)) do
        dependencies[index] = name
    end
    return pyjson.object({
        { "id", self.id },
        { "name", self.name },
        { "display_name", self:get_display_name() },
        { "version", self.version },
        { "author", self.author },
        { "enabled", self.enabled },
        { "patches", pyjson.array(patches) },
        { "bundled", false },
        { "require", self.require },
        { "dependencies", pyjson.array(dependencies) },
        { "flags", pyjson.array(self.flags) },
        { "created", self.created },
        { "modified", self.modified },
    })
end

return M
