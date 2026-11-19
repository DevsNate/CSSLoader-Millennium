-- The theme library: loading, enabling with dependencies, patches, presets.
-- Ported from upstream's css_loader.py. Backend calls run one at a time, so
-- upstream's lock isn't needed. Callers commit the result (main.lua).

local catalog = require("engine.catalog")
local fs = require("fs")
local inject_module = require("engine.inject")
local logger = require("logger")
local paths = require("engine.paths")
local pyjson = require("engine.pyjson")
local theme_module = require("engine.theme")

local M = {
    themes = {},
    scores = {},
    last_load_errors = {},
}

local FLAG_PRESET = theme_module.FLAG_PRESET
local SFP_FILES = { "libraryroot.custom.css", "bigpicture.custom.css", "friends.custom.css", "webkit.css" }

local function ok(message)
    return { success = true, message = message or "Success" }
end

local function fail(message)
    message = tostring(message)
    logger:warn("[FAIL] " .. message)
    return { success = false, message = message }
end

-- table.sort isn't stable, and order among equals is cascade order here.
local function stable_sort(list, key)
    local decorated = {}
    for index, item in ipairs(list) do
        decorated[index] = { item = item, key = key(item), index = index }
    end
    table.sort(decorated, function(a, b)
        if a.key ~= b.key then
            return a.key < b.key
        end
        return a.index < b.index
    end)
    for index, entry in ipairs(decorated) do
        list[index] = entry.item
    end
end

function M.get_theme(name)
    for _, theme in ipairs(M.themes) do
        if theme.name == name then
            return theme
        end
    end
    return nil
end

local function read_folder(entry)
    local dir = entry.path
    local theme_json_path = fs.join(dir, "theme.json")
    local config_path = fs.join(dir, "config_USER.json")
    local sfp = {}
    for _, name in ipairs(SFP_FILES) do
        if fs.is_file(fs.join(dir, name)) then
            sfp[#sfp + 1] = name
        end
    end
    return {
        folder = entry.name,
        theme_json = paths.read_small(theme_json_path),
        theme_css = fs.is_file(fs.join(dir, "theme.css")),
        sfp = sfp,
        config = paths.read_small(config_path),
        priority = paths.read_small(fs.join(dir, "PRIORITY")),
        scope = paths.read_small(fs.join(dir, ".css-loader-scope.json")),
        created = fs.is_file(theme_json_path) and tonumber(fs.last_write_time(theme_json_path)) or nil,
        modified = fs.is_file(config_path) and tonumber(fs.last_write_time(config_path)) or nil,
    }
end

local function parse_themes()
    local root = paths.themes_path()
    paths.ensure_dir(root)
    local folders = {}
    for _, entry in ipairs(fs.list(root) or {}) do
        if entry.is_directory then
            folders[#folders + 1] = entry
        end
    end
    -- Windows lists folders case-insensitively; keep that order everywhere.
    stable_sort(folders, function(entry) return string.upper(entry.name) end)

    local fails = {}
    for _, entry in ipairs(folders) do
        local parsed, result = pcall(function()
            local theme = theme_module.new(entry.name, read_folder(entry))
            theme:check_images()
            return theme
        end)
        if parsed then
            local theme = result
            if M.get_theme(theme.name) then
                for index = 0, 4 do
                    if not M.get_theme(theme.name .. "_" .. index) then
                        theme:add_prefix(index)
                        break
                    end
                end
            end
            if not M.get_theme(theme.name) then
                M.themes[#M.themes + 1] = theme
            end
        else
            -- Couldn't properly parse everything
            local message = tostring(result)
            logger:warn("Failed parsing '" .. entry.name .. "': " .. message)
            fails[#fails + 1] = pyjson.array({ entry.name, message })
        end
    end
    return fails
end

local function set_theme_score(theme, seen)
    if M.scores[theme.name] == nil then
        M.scores[theme.name] = theme.priority_mod
    end
    -- Python recursed without a guard; a dependency cycle crashed the loader.
    if seen[theme.name] then
        return
    end
    seen[theme.name] = true
    for _, name in ipairs(pyjson.keys(theme.dependencies)) do
        local dependency = M.get_theme(name)
        if dependency then
            set_theme_score(dependency, seen)
            M.scores[dependency.name] = M.scores[dependency.name] - 1
        end
    end
    seen[theme.name] = nil
end

function M.load()
    paths.refresh()
    M.themes = {}
    inject_module.clear_active()
    M.last_load_errors = parse_themes()
    catalog.apply(M.themes)

    M.scores = {}
    for _, theme in ipairs(M.themes) do
        set_theme_score(theme, {})
    end
    stable_sort(M.themes, function(theme) return M.scores[theme.name] end)

    for _, theme in ipairs(M.themes) do
        local loaded, err = pcall(theme.load_config, theme)
        if not loaded then
            M.last_load_errors[#M.last_load_errors + 1] = pyjson.array({ theme.folder, tostring(err) })
        end
    end
    stable_sort(M.themes, function(theme) return string.upper(theme:get_display_name()) end)
end

local function contains(list, value)
    for _, item in ipairs(list) do
        if item == value then
            return true
        end
    end
    return false
end

local function enable_theme(theme, set_deps, set_deps_value, ignore_dependencies)
    if set_deps then
        local names = {}
        for index, name in ipairs(pyjson.keys(theme.dependencies)) do
            names[index] = name
        end
        -- Make the top level control all dependencies it defines
        local ignore_next = {}
        for _, name in ipairs(ignore_dependencies) do
            ignore_next[#ignore_next + 1] = name
        end
        for _, name in ipairs(names) do
            ignore_next[#ignore_next + 1] = name
        end
        -- Disallow dependencies of a preset to override anything
        if theme:has_flag(FLAG_PRESET) then
            set_deps = false
        end
        -- Make sure higher priority themes are sorted right
        stable_sort(names, function(name) return M.scores[name] or 0 end)

        for _, name in ipairs(names) do
            -- Skip any themes that the previous iteration has control over
            local dependency = not contains(ignore_dependencies, name) and M.get_theme(name) or nil
            if dependency then
                if set_deps_value then
                    if dependency.enabled then
                        dependency:remove()
                    end
                    local values = theme.dependencies[name]
                    for _, patch_name in ipairs(pyjson.keys(values)) do
                        for _, patch in ipairs(dependency.patches) do
                            if patch.name == patch_name then
                                patch:set_value(values[patch_name])
                            end
                        end
                    end
                end
                enable_theme(dependency, set_deps, set_deps_value, ignore_next)
            end
        end
    end
    theme:inject()
end

local function disable_theme(theme, keep_dependencies)
    theme:remove()
    if keep_dependencies then
        return
    end
    for _, name in ipairs(pyjson.keys(theme.dependencies)) do
        local dependency = M.get_theme(name)
        if dependency then
            local used = false
            for _, other in ipairs(M.themes) do
                if other.enabled and other.dependencies[dependency.name] ~= nil then
                    used = true
                    break
                end
            end
            if not used then
                disable_theme(dependency, false)
            end
        end
    end
end

function M.set_theme_state(name, state, set_deps, set_deps_value)
    local theme = M.get_theme(name)
    if not theme then
        return fail("Did not find theme " .. tostring(name))
    end
    local done, err = pcall(function()
        if state then
            enable_theme(theme, set_deps, set_deps_value, {})
        else
            disable_theme(theme, theme:has_flag(theme_module.FLAG_KEEP_DEPENDENCIES))
        end
    end)
    return done and ok() or fail(err)
end

local function get_patch_of_theme(theme_name, patch_name)
    local theme = M.get_theme(theme_name)
    if not theme then
        return nil, "Did not find theme '" .. tostring(theme_name) .. "'"
    end
    for _, patch in ipairs(theme.patches) do
        if patch.name == patch_name then
            return patch
        end
    end
    return nil, "Did not find patch '" .. tostring(patch_name) .. "' for theme '" .. tostring(theme_name) .. "'"
end

function M.set_patch_of_theme(theme_name, patch_name, value)
    local patch, err = get_patch_of_theme(theme_name, patch_name)
    if not patch then
        return fail(err)
    end
    if patch.value == value then
        return ok("Already injected")
    end
    if patch.options[value] ~= nil then
        patch.value = value
    end
    local done, save_err = pcall(function()
        if patch.theme.enabled then
            patch:remove()
            patch:inject()
        end
        patch.theme:save()
    end)
    return done and ok() or fail(save_err)
end

function M.set_component_of_theme_patch(theme_name, patch_name, component_name, value)
    local patch, err = get_patch_of_theme(theme_name, patch_name)
    if not patch then
        return fail(err)
    end
    local component
    for _, item in ipairs(patch.components) do
        if item.name == component_name then
            component = item
            break
        end
    end
    if not component then
        return fail("Failed to find component '" .. tostring(component_name) .. "'")
    end
    local previous = component.value
    component.value = value
    local generated, generate_err = pcall(component.generate_and_reinject, component)
    if not generated then
        component.value = previous
        component:generate()
        return fail(generate_err)
    end
    local saved, save_err = pcall(patch.theme.save, patch.theme)
    return saved and ok() or fail(save_err)
end

function M.reset()
    local done, err = pcall(M.load)
    if not done then
        fail(err)
    end
end

function M.delete_theme(theme_name)
    local theme = M.get_theme(theme_name)
    if not theme then
        return fail("Could not find theme " .. tostring(theme_name))
    end
    local done, err = pcall(theme.delete, theme)
    if not done then
        return fail(err)
    end
    for index, item in ipairs(M.themes) do
        if item == theme then
            table.remove(M.themes, index)
            break
        end
    end
    return ok()
end

local function write_preset(folder, manifest)
    local dir = paths.theme_folder(folder)
    if not dir or not string.match(folder, "%.profile$") then
        error("Invalid preset.", 0)
    end
    if not paths.ensure_dir(dir) then
        error("Could not create the preset folder.", 0)
    end
    local written, err = paths.write_atomic(fs.join(dir, "theme.json"), manifest)
    if not written then
        error(tostring(err), 0)
    end
end

local function generate_preset(name, include)
    local deps = pyjson.new_object()
    for _, theme in ipairs(M.themes) do
        if include(theme) and not theme:has_flag(FLAG_PRESET) then
            local values = pyjson.new_object()
            for _, patch in ipairs(theme.patches) do
                pyjson.set(values, patch.name, patch:get_value())
            end
            pyjson.set(deps, theme.name, values)
        end
    end

    local display_name = name
    if string.sub(display_name, -8) == ".profile" then
        display_name = string.sub(display_name, 1, -9)
    end
    name = display_name .. ".profile"

    local existing = M.get_theme(name)
    if existing and not existing:has_flag(FLAG_PRESET) then
        return fail("Theme '" .. name .. "' already exists")
    end
    if not existing then
        existing = M.get_theme(display_name)
        if existing then
            if existing:has_flag(FLAG_PRESET) then
                name = existing.name
            else
                return fail("Theme '" .. display_name .. "' already exists")
            end
        end
    end

    write_preset(name, pyjson.encode(pyjson.object({
        { "display_name", display_name },
        { "name", name },
        { "manifest_version", theme_module.CSS_LOADER_VER },
        { "flags", pyjson.array({ FLAG_PRESET }) },
        { "dependencies", deps },
    })))

    local preset = M.get_theme(name)
    if preset then
        preset.dependencies = deps -- Hotpatch preset in memory
    end
    return ok()
end

local function guarded_preset(name, include)
    if type(name) ~= "string" then
        return fail("Invalid preset name.")
    end
    local done, result = pcall(generate_preset, name, include)
    return done and result or fail(result)
end

function M.generate_preset_theme(name)
    return guarded_preset(name, function(theme) return theme.enabled end)
end

function M.generate_preset_theme_from_theme_names(name, theme_names)
    return guarded_preset(name, function(theme) return contains(theme_names, theme.name) end)
end

return M
