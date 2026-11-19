-- What the rest of Steam gets from the theme engine, written after every change:
-- the styles for windows Steam opens before the frontend has loaded, and the
-- style files Millennium links into store and community pages as it serves them.

local fs = require("fs")
local inject_module = require("engine.inject")
local logger = require("logger")
local millennium = require("millennium")
local paths = require("engine.paths")
local pyjson = require("engine.pyjson")
local utils = require("utils")

local M = {}

M.STARTUP_FILE = fs.join(paths.DATA_DIR, "startup.js")
M.STARTUP_URL = "https://millennium.ftp/" .. paths.url_path(M.STARTUP_FILE)

local UI_MODE_FILE = fs.join(paths.DATA_DIR, "ui-mode")
local WEB_DIR = fs.join(paths.DATA_DIR, "web")
-- A backend reply is limited to 8 MB, and escaping can triple non-ASCII CSS.
local PAGE_BYTES = 2 * 1024 * 1024

-- Starts from the clock, so a restarted backend's list never looks like one
-- the frontend already has.
local revision = os.time() * 1000.0
local ui_mode = nil

-- Matches a window the way upstream's BrowserTabHook.compare does (same rules
-- as frontend/delivery/tabs.ts). Once the frontend is loaded it handles every
-- window itself, starting from the same styles (f.d) with the same ids.
local STARTUP_HEAD = [[(function(d){function m(t,u,c,s){if(s.length>2&&s[0]=='~'&&s[s.length-1]=='~')return u.indexOf(s.slice(1,-1))>=0;]]
    .. [[if(s[0]=='!')return c.indexOf(s.slice(1))>=0;try{return new RegExp('^('+s+')$').test(t)}catch(e){return false}}]]
    .. [[var f=function(n,w){try{var p=window.PLUGIN_LIST&&window.PLUGIN_LIST['css-loader'];]]
    .. [[if(p&&p.popupCreated)return p.popupCreated(n,w);var o=w.document,l=function(e){return e?[].slice.call(e.classList):[]},]]
    .. [[c=l(o.documentElement).concat(l(o.body),l(o.head)),t=o.title,g=/^SP BPM/.test(n)||t=='Steam Big Picture Mode',]]
    .. [[u=String(w.location.href)+(g?' Valve Steam Gamepad/default Valve%20Steam%20Gamepad/default':'');]]
    .. [[d.forEach(function(i){if(i.s==(g?'desktop':'gamepad'))return;if(i.t.some(function(s){return m(t,u,c,s)})){var e=o.createElement('style');]]
    .. [[e.id=i.i;e.className='css-loader-style';e.textContent=i.c;o.head.appendChild(e)}})}catch(e){}};f.d=d;return f})(]]

local function write_startup()
    local items = {}
    for index, item in ipairs(inject_module.active()) do
        items[index] = pyjson.object({
            { "i", item.id }, { "t", pyjson.array(item.tabs) }, { "c", item.css }, { "s", item.theme.scope },
        })
    end
    if not paths.ensure_dir(paths.DATA_DIR) then
        logger:warn("Could not create " .. paths.DATA_DIR)
        return
    end
    local written, err = paths.write_atomic(M.STARTUP_FILE, STARTUP_HEAD .. pyjson.encode(pyjson.array(items)) .. ")")
    if not written then
        logger:warn("Could not save the startup styles: " .. tostring(err))
    end
end

-- Web pages ---------------------------------------------------------------

local web_hooks = {}
local last_web = nil

local function scope_applies(scope)
    return scope == "all" or ui_mode == nil or scope == ui_mode
end

-- std::regex (ECMAScript grammar), matched against the whole URL.
local function escape_regex(text)
    return (string.gsub(text, "[\\%^%$%.%*%+%?%(%)%[%]{}|/]", "\\%0"))
end

-- Only URL specs (~text~) can be decided before a page exists.
local function web_groups()
    local groups, order = {}, {}
    for _, item in ipairs(inject_module.active()) do
        if scope_applies(item.theme.scope) then
            local seen = {}
            for _, tab in ipairs(item.tabs) do
                local spec = string.match(tab, "^~(https?://.+)~$")
                if spec and not seen[spec] then
                    seen[spec] = true
                    if not groups[spec] then
                        groups[spec] = {}
                        order[#order + 1] = spec
                    end
                    table.insert(groups[spec], item.css)
                end
            end
        end
    end
    local list = {}
    for index, spec in ipairs(order) do
        list[index] = { pattern = ".*" .. escape_regex(spec) .. ".*", css = table.concat(groups[spec], "\n") }
    end
    return list
end

local function write_web()
    local list = web_groups()
    local parts = {}
    for _, item in ipairs(list) do
        parts[#parts + 1] = item.pattern
        parts[#parts + 1] = item.css
    end
    local key = table.concat(parts, "\0")
    if key == last_web then
        return
    end
    last_web = key

    M.remove_web_hooks()
    if not paths.ensure_dir(WEB_DIR) then
        logger:warn("Could not create " .. WEB_DIR)
        return
    end
    for _, entry in ipairs(fs.list(WEB_DIR) or {}) do
        if entry.is_file then
            os.remove(entry.path)
        end
    end
    for index, item in ipairs(list) do
        local path = fs.join(WEB_DIR, string.format("%02d.css", index))
        if paths.write_atomic(path, item.css) then
            local registered, id = pcall(millennium.add_browser_css, paths.slashes(path), item.pattern)
            if registered and id and id > 0 then
                web_hooks[#web_hooks + 1] = id
            end
        end
    end
end

function M.remove_web_hooks()
    for _, id in ipairs(web_hooks) do
        pcall(millennium.remove_browser_module, id)
    end
    web_hooks = {}
end

-- UI mode -----------------------------------------------------------------
-- Store pages are shared between the modes; the last mode decides until the
-- frontend reports the current one.

function M.load_ui_mode()
    local text = paths.read_small(UI_MODE_FILE)
    text = text and utils.trim(text) or nil
    ui_mode = (text == "desktop" or text == "gamepad") and text or nil
end

function M.set_ui_mode(mode)
    if mode ~= "desktop" and mode ~= "gamepad" then
        mode = nil
    end
    if mode == ui_mode then
        return
    end
    ui_mode = mode
    if mode and paths.ensure_dir(paths.DATA_DIR) then
        paths.write_atomic(UI_MODE_FILE, mode)
    end
    local ok, err = pcall(write_web)
    if not ok then
        logger:warn("Could not save the store page styles: " .. tostring(err))
    end
end

-- Commit ------------------------------------------------------------------

-- upstream commit_all, for what doesn't need the frontend. Failing to save
-- never fails the change itself: the open windows still get it.
function M.commit()
    revision = revision + 1
    local ok, err = pcall(write_startup)
    if not ok then
        logger:warn("Could not save the startup styles: " .. tostring(err))
    end
    ok, err = pcall(write_web)
    if not ok then
        logger:warn("Could not save the store page styles: " .. tostring(err))
    end
end

-- One page of the styles, for the frontend: { revision, pages, styles }.
function M.styles_page(page)
    local pages, current, size = {}, {}, 0
    for _, item in ipairs(inject_module.active()) do
        if size > 0 and size + #item.css > PAGE_BYTES then
            pages[#pages + 1] = current
            current, size = {}, 0
        end
        current[#current + 1] = pyjson.object({
            { "id", item.id }, { "css", item.css }, { "tabs", pyjson.array(item.tabs) }, { "scope", item.theme.scope },
        })
        size = size + #item.css
    end
    pages[#pages + 1] = current
    return pyjson.encode(pyjson.object({
        { "revision", revision },
        { "pages", #pages },
        { "styles", pyjson.array(pages[page + 1] or {}) },
    }))
end

return M
