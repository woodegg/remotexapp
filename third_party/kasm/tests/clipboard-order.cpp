#include "NativeClipboardOrder.h"
#include <cassert>
#include <random>

int main() {
  char wire[37];
  NativeClipboardFence parsed;
  std::mt19937_64 random(119);
  for (unsigned i = 0; i < 10000; i++) {
    uint32_t request = random(); uint64_t revision = random();
    NativeClipboardFence::encode('A', request, revision, wire);
    assert(NativeClipboardFence::parse(wire, sizeof(wire), parsed));
    assert(parsed.op == 'A' && parsed.request == request && parsed.revision == revision);
    for (unsigned size = 0; size < sizeof(wire); size++)
      assert(!NativeClipboardFence::parse(wire, size, parsed));
    wire[36] = 'g'; assert(!NativeClipboardFence::parse(wire, sizeof(wire), parsed));
  }
  NativeClipboardOrder first, second;
  first.subscribed = second.subscribed = true;
  uint64_t current = 10;
  first.arm('A', 1, current); second.arm('A', 2, current);
  auto accepted = first.admit(current, true); assert(accepted.status == 'S' && accepted.request == 1);
  ++current; assert(first.finish() == 1 && first.finish() == 0);
  auto stale = second.admit(current, true); assert(stale.status == 'F' && stale.request == 2 && !second.finish());
  // Equal payloads have no role: a new A after B must use the new revision.
  for (unsigned i = 0; i < 1000; i++) {
    first.arm('A', 3, current - 1); assert(first.admit(current, true).status == 'F');
    first.arm('A', 4, current); assert(first.admit(current, true).status == 'S'); ++current;
    assert(first.finish() == 4);
  }
  first.arm('A', 5, current); first.cancel(4); ++current;
  assert(first.admit(current, true).status == 'F');
  first.arm('A', 6, 1); first.cancel(6); assert(first.admit(current, true).status == 'L');
  first.arm('U', 7, 0); assert(first.admit(current, true).status == 'S'); assert(first.finish() == 7);
  first.arm('A', 8, current); first.arm('A', 9, current);
  auto overlap = first.admit(current, true); assert(overlap.status == 'E' && overlap.request == 9);
  first.arm('A', 10, current); assert(first.admit(current, false).status == 'E');
  first.arm('A', 10, current); assert(first.admit(current, true, false).status == 'E');
  assert(first.admit(current, true, false).status == 'L'); // Explicit legacy choice still respects its upload permission.
  first.arm('A', 11, current); assert(first.admit(0, true).status == 'E');
  first.subscribed = false; first.arm('U', 12, 0); assert(first.admit(current, true).status == 'E');
  assert(first.admit(current, false).status == 'E'); assert(!first.finish());
  assert(!first.notify(20));first.subscribed=true;assert(first.notify(20));
  for(unsigned i=0;i<1000;i++)assert(!first.notify(21+i));
  assert(first.notificationPending&&first.notifiedRevision==20);
  assert(!first.acknowledge(19,1020)&&first.notificationPending);
  assert(first.acknowledge(20,1020)&&!first.notificationPending);
  assert(first.notify(1020));assert(!first.acknowledge(1020,1020)&&!first.notificationPending);
}
