/**
 * @file string_convert.hpp
 * @brief Simple ASCII to UTF-16 string conversion utilities.
 *
 * These functions handle conversion between std::string (ASCII/UTF-8) and
 * std::u16string (UTF-16) for PE resource name operations.
 *
 * Note: These are designed for ASCII-only strings (like PE resource names
 * NODE_SEA_BLOB, SMOL_VFS_BLOB). For full Unicode support, use platform
 * APIs or ICU library.
 */

#ifndef STRING_CONVERT_HPP
#define STRING_CONVERT_HPP

#include <string>

namespace binject {

/**
 * Convert ASCII/UTF-8 string to UTF-16.
 * Works correctly for ASCII characters (0x00-0x7F).
 * For PE resource names which are ASCII constants.
 */
inline std::u16string to_u16string(const std::string& str) {
    std::u16string result;
    result.reserve(str.size());
    for (char c : str) {
        result.push_back(static_cast<char16_t>(static_cast<unsigned char>(c)));
    }
    return result;
}

/**
 * Convert UTF-16 string to ASCII/UTF-8.
 * Works correctly for ASCII characters (0x00-0x7F).
 * Non-ASCII characters are replaced with '?'.
 */
inline std::string from_u16string(const std::u16string& str) {
    std::string result;
    result.reserve(str.size());
    for (char16_t c : str) {
        if (c <= 0x7F) {
            result.push_back(static_cast<char>(c));
        } else {
            result.push_back('?');
        }
    }
    return result;
}

} // namespace binject

#endif // STRING_CONVERT_HPP
