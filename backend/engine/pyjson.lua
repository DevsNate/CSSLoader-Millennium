-- JSON that keeps the order of object keys, which Millennium's json module
-- doesn't. Order matters here as it does in upstream's Python dicts: a patch's
-- first option is its default, inject order is cascade order, and files this
-- port writes must look like the ones Decky CSS Loader writes (json.dumps
-- defaults: ", " and ": " separators, ASCII only).

local M = {}

-- JSON null. Plain nil can't sit in a table or say "the key exists".
M.NULL = setmetatable({}, { __tostring = function() return "null" end })

local key_order = setmetatable({}, { __mode = "k" })
local array_mark = setmetatable({}, { __mode = "k" })

function M.is_array(value)
    return type(value) == "table" and array_mark[value] == true
end

function M.is_object(value)
    return type(value) == "table" and key_order[value] ~= nil
end

-- An object's keys in file order; an empty list for anything else.
function M.keys(value)
    return key_order[value] or {}
end

-- Marks a Lua list as a JSON array, so an empty one isn't written as {}.
function M.array(list)
    list = list or {}
    array_mark[list] = true
    return list
end

function M.new_object()
    local object = {}
    key_order[object] = {}
    return object
end

function M.set(object, key, value)
    if object[key] == nil then
        local order = key_order[object]
        order[#order + 1] = key
    end
    object[key] = value
end

-- An object from { key, value } pairs; a nil value becomes null.
function M.object(pairs_list)
    local object = M.new_object()
    for _, pair in ipairs(pairs_list) do
        local value = pair[2]
        if value == nil then
            value = M.NULL
        end
        M.set(object, pair[1], value)
    end
    return object
end

-- Decoding ----------------------------------------------------------------

local MAX_DEPTH = 64

local function fail(position, message)
    error("JSON: " .. message .. " at byte " .. position, 0)
end

local function utf8_bytes(code)
    if code < 0x80 then
        return string.char(code)
    elseif code < 0x800 then
        return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
    elseif code < 0x10000 then
        return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    end
    return string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40,
        0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
end

local SIMPLE_ESCAPES = {
    ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t",
}

local function read_hex4(text, position)
    local digits = string.match(text, "^%x%x%x%x", position)
    if not digits then
        fail(position, "bad \\u escape")
    end
    return tonumber(digits, 16)
end

-- position is just after the opening quote.
local function decode_string(text, position)
    local parts = {}
    local start = position
    while true do
        local stop = string.find(text, '["\\%c]', start)
        if not stop then
            fail(position, "unterminated string")
        end
        local char = string.sub(text, stop, stop)
        if char == '"' then
            parts[#parts + 1] = string.sub(text, start, stop - 1)
            return table.concat(parts), stop + 1
        elseif char == "\\" then
            parts[#parts + 1] = string.sub(text, start, stop - 1)
            local escape = string.sub(text, stop + 1, stop + 1)
            if escape == "u" then
                local code = read_hex4(text, stop + 2)
                start = stop + 6
                if code >= 0xD800 and code < 0xDC00 and string.sub(text, start, start + 1) == "\\u" then
                    local low = read_hex4(text, start + 2)
                    if low >= 0xDC00 and low < 0xE000 then
                        code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
                        start = start + 6
                    end
                end
                parts[#parts + 1] = utf8_bytes(code)
            else
                local simple = SIMPLE_ESCAPES[escape]
                if not simple then
                    fail(stop, "bad escape")
                end
                parts[#parts + 1] = simple
                start = stop + 2
            end
        elseif string.byte(char) == 127 then
            -- %c includes DEL, which JSON allows.
            parts[#parts + 1] = string.sub(text, start, stop)
            start = stop + 1
        else
            fail(stop, "control character in string")
        end
    end
end

local decode_value

local function skip_space(text, position)
    return string.find(text, "[^ \t\r\n]", position) or #text + 1
end

local function decode_object(text, position, depth)
    local object = M.new_object()
    position = skip_space(text, position)
    if string.sub(text, position, position) == "}" then
        return object, position + 1
    end
    while true do
        if string.sub(text, position, position) ~= '"' then
            fail(position, "expected a key")
        end
        local key, value
        key, position = decode_string(text, position + 1)
        position = skip_space(text, position)
        if string.sub(text, position, position) ~= ":" then
            fail(position, "expected ':'")
        end
        value, position = decode_value(text, skip_space(text, position + 1), depth + 1)
        M.set(object, key, value)
        position = skip_space(text, position)
        local char = string.sub(text, position, position)
        if char == "}" then
            return object, position + 1
        elseif char ~= "," then
            fail(position, "expected ',' or '}'")
        end
        position = skip_space(text, position + 1)
    end
end

local function decode_array(text, position, depth)
    local list = M.array({})
    position = skip_space(text, position)
    if string.sub(text, position, position) == "]" then
        return list, position + 1
    end
    while true do
        local value
        value, position = decode_value(text, position, depth + 1)
        list[#list + 1] = value
        position = skip_space(text, position)
        local char = string.sub(text, position, position)
        if char == "]" then
            return list, position + 1
        elseif char ~= "," then
            fail(position, "expected ',' or ']'")
        end
        position = skip_space(text, position + 1)
    end
end

decode_value = function(text, position, depth)
    if depth > MAX_DEPTH then
        fail(position, "nested too deeply")
    end
    local char = string.sub(text, position, position)
    if char == "{" then
        return decode_object(text, position + 1, depth)
    elseif char == "[" then
        return decode_array(text, position + 1, depth)
    elseif char == '"' then
        return decode_string(text, position + 1)
    elseif string.sub(text, position, position + 3) == "true" then
        return true, position + 4
    elseif string.sub(text, position, position + 4) == "false" then
        return false, position + 5
    elseif string.sub(text, position, position + 3) == "null" then
        return M.NULL, position + 4
    end
    local number = string.match(text, "^-?%d+%.?%d*[eE]?[+-]?%d*", position)
    local value = number and tonumber(number)
    if value == nil then
        fail(position, "unexpected character")
    end
    return value, position + #number
end

function M.decode(text)
    if type(text) ~= "string" then
        error("JSON: not a string", 0)
    end
    -- Windows editors like to start a file with a byte order mark.
    if string.sub(text, 1, 3) == "\239\187\191" then
        text = string.sub(text, 4)
    end
    local value, position = decode_value(text, skip_space(text, 1), 0)
    position = skip_space(text, position)
    if position <= #text then
        fail(position, "trailing data")
    end
    return value
end

-- Encoding ----------------------------------------------------------------

local SHORT_ESCAPES = {
    ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function escape_control(char)
    return SHORT_ESCAPES[char] or string.format("\\u%04x", string.byte(char))
end

local function escape_code(code)
    if code >= 0x10000 then
        code = code - 0x10000
        return string.format("\\u%04x\\u%04x", 0xD800 + math.floor(code / 0x400), 0xDC00 + code % 0x400)
    end
    return string.format("\\u%04x", code)
end

-- A run of non-ASCII bytes. Bytes that aren't valid UTF-8 become U+FFFD, so one
-- badly encoded theme file can't break a reply.
local function escape_high(run)
    local out = {}
    local index, length = 1, #run
    while index <= length do
        local lead = string.byte(run, index)
        local extra, code = 0, nil
        if lead >= 0xC2 and lead <= 0xDF then
            extra, code = 1, lead - 0xC0
        elseif lead >= 0xE0 and lead <= 0xEF then
            extra, code = 2, lead - 0xE0
        elseif lead >= 0xF0 and lead <= 0xF4 then
            extra, code = 3, lead - 0xF0
        end
        local valid = code ~= nil and index + extra <= length
        if valid then
            for offset = 1, extra do
                local byte = string.byte(run, index + offset)
                if byte < 0x80 or byte > 0xBF then
                    valid = false
                    break
                end
                code = code * 0x40 + (byte - 0x80)
            end
        end
        if valid then
            out[#out + 1] = escape_code(code)
            index = index + extra + 1
        else
            out[#out + 1] = "\\ufffd"
            index = index + 1
        end
    end
    return table.concat(out)
end

local function encode_string(text)
    local escaped = string.gsub(text, '[%c"\\]', escape_control)
    if string.find(escaped, "[\128-\255]") then
        escaped = string.gsub(escaped, "[\128-\255]+", escape_high)
    end
    return '"' .. escaped .. '"'
end

local function encode_number(value)
    if value ~= value or value == math.huge or value == -math.huge then
        return "null"
    end
    if value == math.floor(value) and math.abs(value) < 1e15 then
        return string.format("%.0f", value)
    end
    return string.format("%.17g", value)
end

local function encode_value(value, sort_keys, out)
    local kind = type(value)
    if value == M.NULL or value == nil then
        out[#out + 1] = "null"
    elseif kind == "string" then
        out[#out + 1] = encode_string(value)
    elseif kind == "number" then
        out[#out + 1] = encode_number(value)
    elseif kind == "boolean" then
        out[#out + 1] = value and "true" or "false"
    elseif M.is_array(value) then
        out[#out + 1] = "["
        for index, item in ipairs(value) do
            if index > 1 then
                out[#out + 1] = ", "
            end
            encode_value(item, sort_keys, out)
        end
        out[#out + 1] = "]"
    elseif M.is_object(value) then
        local keys = M.keys(value)
        if sort_keys then
            local sorted = {}
            for index, key in ipairs(keys) do
                sorted[index] = key
            end
            table.sort(sorted)
            keys = sorted
        end
        out[#out + 1] = "{"
        for index, key in ipairs(keys) do
            if index > 1 then
                out[#out + 1] = ", "
            end
            out[#out + 1] = encode_string(key)
            out[#out + 1] = ": "
            encode_value(value[key], sort_keys, out)
        end
        out[#out + 1] = "}"
    else
        error("JSON: cannot encode a plain " .. kind, 0)
    end
end

function M.encode(value)
    local out = {}
    encode_value(value, false, out)
    return table.concat(out)
end

-- Text that is equal for values that are equal, whatever their key order.
function M.canonical(value)
    local out = {}
    encode_value(value, true, out)
    return table.concat(out)
end

return M
