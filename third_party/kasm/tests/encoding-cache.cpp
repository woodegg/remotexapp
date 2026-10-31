// Regression against the actual patched upstream cache (GPL-2.0-or-later).
#include <rfb/EncCache.h>
#include <algorithm>
#include <cassert>
#include <cstring>
#include <vector>

static void *payload(size_t size, unsigned char value) {
  void *p = malloc(size);
  assert(p);
  memset(p, value, size);
  return p;
}

int main() {
  // Conflicting x/y orders used to make a < b and b < a both true.
  const std::vector<rfb::EncId> keys = {
    {7, 0, 20, 63, 24, 0}, {7, 20, 0, 63, 24, 0},
    {7, 0, 20, 64, 23, 0}, {8, 0, 0, 63, 24, 0},
    {7, 0, 20, 63, 25, 0}
  };
  for (const auto &a : keys) for (const auto &b : keys) {
    assert(!(a < b && b < a));
    for (const auto &c : keys) if (a < b && b < c) assert(a < c);
  }
  std::vector<int> order = {0, 1, 2, 3, 4};
  do {
    rfb::EncCache cache;
    for (int i : order) {
      const auto &k = keys[i];
      cache.add(k.type, k.x, k.y, k.w, k.h, 20 + i, payload(20 + i, i));
    }
    for (int i = 0; i < 5; ++i) {
      const auto &k = keys[i];
      uint32_t length = 0;
      auto p = static_cast<const unsigned char *>(cache.get(k.type, k.x, k.y, k.w, k.h, length));
      assert(p && length == unsigned(20 + i));
      for (unsigned j = 0; j < length; ++j) assert(p[j] == i);
    }
    // Growing and shrinking replacements must update length and free old data.
    for (unsigned size : {1714, 3200, 8, 2000}) {
      const auto &k = keys[0];
      cache.add(k.type, k.x, k.y, k.w, k.h, size, payload(size, 42));
      uint32_t length = 0;
      auto p = static_cast<const unsigned char *>(cache.get(k.type, k.x, k.y, k.w, k.h, length));
      assert(p && length == size);
      for (unsigned j = 0; j < length; ++j) assert(p[j] == 42);
    }
    cache.clear();
    cache.clear();
    uint32_t length = 0;
    assert(!cache.get(7, 0, 20, 63, 24, length));
    cache.add(7, 0, 0, 1, 1, 1, payload(1, 1)); // destructor owns the last entry
  } while (std::next_permutation(order.begin(), order.end()));
}
