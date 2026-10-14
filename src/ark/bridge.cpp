#include "core/lexer.h"
#include "core/parser.h"
#include "core/expand.h"
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#define EXPORT(name) __attribute__((export_name(name)))
#define IMPORT(name) __attribute__((import_module("ark_host"), import_name(name)))

extern "C" IMPORT("error") void hostError(const char*, int, int, int, int);
extern "C" IMPORT("call") int hostCall(int, const char*, int);
extern "C" IMPORT("copy") void hostCopy(char*);

static std::vector<char> input;
static std::string output;

[[noreturn]] void arkFail(int line, int col, const std::string& message, bool incomplete) {
    hostError(message.data(), message.size(), line, col, incomplete);
    __builtin_trap();
}

static std::string hostRequest(int kind, const std::string& text) {
    int length = hostCall(kind, text.data(), text.size());
    if (length < 0 || length > 4 * 1024 * 1024) __builtin_trap();
    std::string result(length, '\0');
    if (length) hostCopy(result.data());
    return result;
}

static uint32_t number(const std::string& bytes, size_t& offset) {
    if (offset + 4 > bytes.size()) __builtin_trap();
    uint32_t value = 0;
    for (int i = 0; i < 4; ++i) value |= uint32_t(uint8_t(bytes[offset++])) << (8 * i);
    return value;
}

static std::string text(const std::string& bytes, size_t& offset) {
    uint32_t length = number(bytes, offset);
    if (length > bytes.size() - offset) __builtin_trap();
    std::string result = bytes.substr(offset, length);
    offset += length;
    return result;
}

std::vector<std::string> browserGlob(const std::string& pattern) {
    if (pattern.find_first_of("*?[") == std::string::npos) return {pattern};
    auto bytes = hostRequest(1, pattern);
    size_t offset = 0;
    auto count = number(bytes, offset);
    std::vector<std::string> result;
    for (uint32_t i = 0; i < count; ++i) result.push_back(text(bytes, offset));
    if (result.empty()) result.push_back(pattern);
    return result;
}

static std::string jsonString(const std::string& value) {
    std::string result = "\"";
    const char* hex = "0123456789abcdef";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { result += '\\'; result += c; }
        else if (c < 32) { result += "\\u00"; result += hex[c >> 4]; result += hex[c & 15]; }
        else result += c;
    }
    return result + '"';
}

static std::string strings(const std::vector<std::string>& values) {
    std::string result = "[";
    for (size_t i = 0; i < values.size(); ++i) {
        if (i) result += ',';
        result += jsonString(values[i]);
    }
    return result + ']';
}

static std::string nodeJson(const Node* node) {
    if (!node) return "null";
    std::string result = "{\"kind\":" + std::to_string(int(node->kind));
    result += ",\"join\":" + std::to_string(int(node->joinOp));
    result += ",\"background\":" + std::string(node->background ? "true" : "false");
    result += ",\"negate\":" + std::string(node->negate ? "true" : "false");
    result += ",\"words\":" + strings(node->words) + ",\"children\":[";
    for (size_t i = 0; i < node->children.size(); ++i) {
        if (i) result += ',';
        result += nodeJson(node->children[i].get());
    }
    result += "],\"redirects\":[";
    for (size_t i = 0; i < node->redirects.size(); ++i) {
        const auto& r = node->redirects[i];
        if (i) result += ',';
        result += "{\"kind\":" + std::to_string(int(r.kind)) + ",\"target\":" + jsonString(r.target);
        result += ",\"fd\":" + std::to_string(r.fd) + ",\"dup\":" + std::to_string(r.dupFd);
        result += ",\"expand\":" + std::string(r.heredocExpand ? "true" : "false") + '}';
    }
    result += "],\"forVar\":" + jsonString(node->forVar) + ",\"forWords\":" + strings(node->forWords);
    result += ",\"caseWord\":" + jsonString(node->caseWord) + ",\"clauses\":[";
    for (size_t i = 0; i < node->caseClauses.size(); ++i) {
        if (i) result += ',';
        result += '[' + jsonString(node->caseClauses[i].first) + ',' + nodeJson(node->caseClauses[i].second.get()) + ']';
    }
    result += "],\"name\":" + jsonString(node->funcName) + ",\"body\":" + nodeJson(node->funcBody.get()) + '}';
    return result;
}

extern "C" EXPORT("ark_input") char* arkInput(int length) {
    if (length < 0 || length > 4 * 1024 * 1024) __builtin_trap();
    input.resize(length);
    return input.data();
}
extern "C" EXPORT("ark_output") const char* arkOutput() { return output.data(); }
extern "C" EXPORT("ark_output_len") int arkOutputLen() { return output.size(); }

extern "C" EXPORT("ark_parse") void arkParse() {
    auto node = Parser(Lexer(std::string(input.begin(), input.end())).tokenize()).parse();
    output = nodeJson(node.get());
}

extern "C" EXPORT("ark_expand") void arkExpand(int single, int status) {
    std::string bytes(input.begin(), input.end());
    size_t offset = 0;
    ShellState state;
    state.lastStatus = status;
    auto count = number(bytes, offset);
    for (uint32_t i = 0; i < count; ++i) {
        auto key = text(bytes, offset);
        state.vars[key] = text(bytes, offset);
    }
    auto argc = number(bytes, offset);
    std::vector<std::string> args;
    for (uint32_t i = 0; i < argc; ++i) args.push_back(text(bytes, offset));
    state.argStack.push_back(args);
    count = number(bytes, offset);
    std::vector<std::string> words;
    for (uint32_t i = 0; i < count; ++i) words.push_back(text(bytes, offset));
    setCaptureHook([](const std::string& command) { return hostRequest(0, command); });
    if (single) output = jsonString(words.empty() ? "" : expandNoSplit(words[0], state));
    else output = strings(expandWords(words, state));
}
