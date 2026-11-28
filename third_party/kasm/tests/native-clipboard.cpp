// Harness for the applied reader, with an observable clipboard mutation boundary.
#include <rfb/NativeClipboard.h>
#include <rfb/NativeClipboardOrder.h>
#include <rfb/NativeClipboardRead.h>
#include <algorithm>
#include <vector>
#include <string>
#include <stdexcept>
#include <cassert>
#include <stdint.h>
namespace rdr { using U8=uint8_t; using U32=uint32_t; }
using Exception=std::runtime_error;
namespace rfb { namespace Server { int DLP_ClipAcceptMax=10*1024*1024; const char* DLP_Clip_Types="text/plain,text/html,image/png"; } }
struct Stream {
  std::vector<unsigned char> bytes; size_t at=0, exposed=~size_t(0);
  size_t avail() const { return std::min(bytes.size(),exposed)-at; }
  bool checkNoWait(size_t n) const { return n<=avail(); }
  unsigned readU8() { if(!avail())throw Exception("blocking read"); return bytes[at++]; }
  unsigned readU32() { unsigned v=0; for(int i=0;i<4;i++)v=(v<<8)|readU8(); return v; }
  void readBytes(void* p,unsigned n) { if(n>avail())throw Exception("blocking read");if(n)memcpy(p,bytes.data()+at,n);at+=n; }
};
struct Handler {
  unsigned mutations=0, announced=0, total=0;
  unsigned admissions=0, finishes=0, ack=0; uint64_t revision=7; bool allowed=true;
  NativeClipboardOrder order; char status=0;
  bool acceptBinaryClipboard(){admissions++;const auto r=order.admit(revision,allowed);status=r.status;ack=r.request;return status=='S'||status=='L';}
  void finishBinaryClipboard(){finishes++;if(order.finish())revision++;}
  void clearBinaryClipboard(){mutations++;total=0;}
  void addBinaryClipboard(const char*,const unsigned char*,unsigned size,unsigned){mutations++;total+=size;}
  void handleClipboardAnnounceBinary(unsigned n,const char[][32]){mutations++;announced=n;}
};
struct SMsgReader { Stream* is; Handler* handler; NativeClipboardRead clipboardRead; bool readBinaryClipboard(); };
// INSERT_APPLIED_READER
static void u32(std::vector<unsigned char>& b,unsigned n){for(int i=3;i>=0;i--)b.push_back(n>>(i*8));}
static void item(std::vector<unsigned char>& b,const char* type,const std::vector<unsigned char>& data){b.push_back(strlen(type));b.insert(b.end(),type,type+strlen(type));u32(b,data.size());b.insert(b.end(),data.begin(),data.end());}
static void rejected(std::vector<unsigned char> bytes){Stream s;s.bytes=bytes;Handler h;SMsgReader r{&s,&h};bool failed=false;try{r.readBinaryClipboard();}catch(const Exception&){failed=true;}assert(failed&&h.mutations==0);}
int main(){
 std::vector<unsigned char> good{3};item(good,"text/plain",{'a'});item(good,"text/html",{'<','b','>'});item(good,"image/png",{137,80,78,71});
 // Every truncation yields without waiting, mutation, or admission. Subsequent
 // bytes resume the same transaction and cannot be parsed as new message types.
 for(size_t i=0;i<good.size();i++){
  Stream partial;partial.bytes=std::vector<unsigned char>(good.begin(),good.begin()+i);Handler owner;SMsgReader reader{&partial,&owner};
  assert(!reader.readBinaryClipboard());assert(owner.mutations==0&&owner.admissions==0&&reader.clipboardRead.active);
 }
 Stream fragments;fragments.bytes=good;fragments.exposed=0;Handler fragmentedOwner;SMsgReader fragmented{&fragments,&fragmentedOwner};
 for(size_t i=0;i<good.size();i++){
  fragments.exposed=i;assert(!fragmented.readBinaryClipboard());assert(fragmentedOwner.mutations==0&&fragmentedOwner.admissions==0);
 }
 fragments.exposed=good.size();assert(fragmented.readBinaryClipboard());assert(fragmentedOwner.mutations==5&&!fragmented.clipboardRead.active);
 for(const auto& part:fragmented.clipboardRead.data)assert(part.capacity()==0);
 // Absolute expiry cannot be extended by a peer sending occasional fragments.
 Stream expired;expired.bytes=good;expired.exposed=10;Handler expiredOwner;SMsgReader timeout{&expired,&expiredOwner};assert(!timeout.readBinaryClipboard());
 timeout.clipboardRead.started-=std::chrono::seconds(51);expired.exposed=good.size();bool timedOut=false;
 try{timeout.readBinaryClipboard();}catch(const Exception&){timedOut=true;}
 assert(timedOut&&expiredOwner.mutations==0&&expiredOwner.admissions==0);
 // An X11 owner change while a body is incomplete is visible at final CAS.
 Stream raced;raced.bytes=good;raced.exposed=good.size()-1;Handler racedOwner;racedOwner.order.subscribed=true;racedOwner.order.arm('A',8,7);SMsgReader race{&raced,&racedOwner};
 assert(!race.readBinaryClipboard());racedOwner.revision=8;raced.exposed=good.size();assert(race.readBinaryClipboard());assert(racedOwner.status=='F'&&racedOwner.mutations==0);

 // Configuration may change while staging now yields. Revalidate current
 // limits and format policy at commit, rather than trusting parsed headers.
 for(bool formats:{false,true}){
  Stream input;input.bytes=good;input.exposed=good.size()-1;Handler owner;SMsgReader reader{&input,&owner};assert(!reader.readBinaryClipboard());
  if(formats)rfb::Server::DLP_Clip_Types="text/plain";else rfb::Server::DLP_ClipAcceptMax=4;
  input.exposed=good.size();bool denied=false;try{reader.readBinaryClipboard();}catch(const Exception&){denied=true;}
  assert(denied&&owner.mutations==0&&owner.admissions==0);
  rfb::Server::DLP_Clip_Types="text/plain,text/html,image/png";rfb::Server::DLP_ClipAcceptMax=NATIVE_CLIPBOARD_LIMIT;
 }
 Stream s;s.bytes=good;Handler h;SMsgReader r{&s,&h};r.readBinaryClipboard();assert(h.announced==3&&h.total==8&&h.mutations==5);
 // The applied reader must consult admission after complete staging and before
 // touching old connection buffers or selection ownership.
 s.at=0;h=Handler();h.total=42;h.order.subscribed=true;h.order.arm('A',1,6);r.readBinaryClipboard();
 assert(s.at==good.size()&&h.status=='F'&&h.ack==1&&h.mutations==0&&h.total==42&&h.finishes==0);
 s.at=0;h.order.arm('A',2,7);r.readBinaryClipboard();assert(h.status=='S'&&h.mutations==5&&h.total==8&&h.finishes==1&&h.revision==8);
 s.at=0;h.mutations=0;h.order.arm('A',3,7);r.readBinaryClipboard();assert(h.status=='F'&&h.mutations==0&&h.revision==8);
 s.at=0;h=Handler();h.allowed=false;r.readBinaryClipboard();assert(h.status=='E'&&h.mutations==0);
 for(const char* type:{"text/rtf","text/plain"}){std::vector<unsigned char> b{2};item(b,"text/plain",{'a'});item(b,type,{'b'});rejected(b);}
 for(const std::vector<unsigned char> bad:{std::vector<unsigned char>{0},std::vector<unsigned char>{255},std::vector<unsigned char>{0xed,0xa0,0x80}}){std::vector<unsigned char>b{2};item(b,"image/png",{1});item(b,"text/html",bad);rejected(b);}
 std::vector<unsigned char> boundary{2};item(boundary,"text/plain",std::vector<unsigned char>(NATIVE_CLIPBOARD_LIMIT-1,'a'));item(boundary,"text/html",{'x'});
 s.bytes=boundary;s.at=0;h=Handler();r.readBinaryClipboard();assert(h.total==NATIVE_CLIPBOARD_LIMIT);
 boundary[0]=3;item(boundary,"image/png",{1});rejected(boundary);
 std::vector<unsigned char> huge{1,9};const char* png="image/png";huge.insert(huge.end(),png,png+9);u32(huge,0xffffffffU);rejected(huge);
 rfb::Server::DLP_Clip_Types="text/plain";rejected(good);
 rfb::Server::DLP_ClipAcceptMax=65536;std::vector<unsigned char> old{1};item(old,"text/plain",std::vector<unsigned char>(65537,'a'));rejected(old);
}
