#include <arpa/inet.h>
#include <cassert>
#include <sys/socket.h>
#include <unistd.h>
#include "WuNetwork.h"

int main() {
  const int first = CreateSocket(0);
  assert(first >= 0);
  sockaddr_in address{};
  socklen_t length = sizeof(address);
  assert(getsockname(first, reinterpret_cast<sockaddr*>(&address), &length) == 0);
  assert(address.sin_addr.s_addr == htonl(INADDR_LOOPBACK));
  const auto port = ntohs(address.sin_port);
  assert(port != 0);
  assert(CreateSocket(port) == -1); // Another runtime cannot share the UDP slot.
  close(first);
  const int next = CreateSocket(port);
  assert(next >= 0);
  close(next);
}
