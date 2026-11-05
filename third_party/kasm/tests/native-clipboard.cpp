// Harness for the applied reader, with an observable clipboard mutation boundary.
#include <rfb/NativeClipboard.h>
#include <vector>
#include <string>
#include <stdexcept>
#include <cassert>
#include <stdint.h>
namespace rdr { using U8=uint8_t; using U32=uint32_t; }
using Exception=std::runtime_error;
namespace rfb { namespace Server { int DLP_ClipAcceptMax=2097152; const char* DLP_Clip_Types="text/plain,text/html,image/png"; } }
struct Stream {
  std::vector<unsigned char> bytes; size_t at=0;
  unsigned readU8() { if(at==bytes.size())throw Exception("short"); return bytes[at++]; }
  unsigned readU32() { unsigned v=0; for(int i=0;i<4;i++)v=(v<<8)|readU8(); return v; }
  void readBytes(void* p,unsigned n) { if(n>bytes.size()-at)throw Exception("short");if(n)memcpy(p,bytes.data()+at,n);at+=n; }
};
struct Handler {
  unsigned mutations=0, announced=0, total=0;
  void clearBinaryClipboard(){mutations++;total=0;}
  void addBinaryClipboard(const char*,const unsigned char*,unsigned size,unsigned){mutations++;total+=size;}
  void handleClipboardAnnounceBinary(unsigned n,const char[][32]){mutations++;announced=n;}
};
struct SMsgReader { Stream* is; Handler* handler; void readBinaryClipboard(); };
// INSERT_APPLIED_READER
static void u32(std::vector<unsigned char>& b,unsigned n){for(int i=3;i>=0;i--)b.push_back(n>>(i*8));}
static void item(std::vector<unsigned char>& b,const char* type,const std::vector<unsigned char>& data){b.push_back(strlen(type));b.insert(b.end(),type,type+strlen(type));u32(b,data.size());b.insert(b.end(),data.begin(),data.end());}
static void rejected(std::vector<unsigned char> bytes){Stream s;s.bytes=bytes;Handler h;SMsgReader r{&s,&h};bool failed=false;try{r.readBinaryClipboard();}catch(const Exception&){failed=true;}assert(failed&&h.mutations==0);}
int main(){
 std::vector<unsigned char> good{3};item(good,"text/plain",{'a'});item(good,"text/html",{'<','b','>'});item(good,"image/png",{137,80,78,71});
 for(size_t i=0;i<good.size();i++)rejected(std::vector<unsigned char>(good.begin(),good.begin()+i));
 Stream s;s.bytes=good;Handler h;SMsgReader r{&s,&h};r.readBinaryClipboard();assert(h.announced==3&&h.total==8&&h.mutations==5);
 for(const char* type:{"text/rtf","text/plain"}){std::vector<unsigned char> b{2};item(b,"text/plain",{'a'});item(b,type,{'b'});rejected(b);}
 for(const std::vector<unsigned char> bad:{std::vector<unsigned char>{0},std::vector<unsigned char>{255},std::vector<unsigned char>{0xed,0xa0,0x80}}){std::vector<unsigned char>b{2};item(b,"image/png",{1});item(b,"text/html",bad);rejected(b);}
 std::vector<unsigned char> boundary{2};item(boundary,"text/plain",std::vector<unsigned char>(NATIVE_CLIPBOARD_LIMIT-1,'a'));item(boundary,"text/html",{'x'});
 s.bytes=boundary;s.at=0;h=Handler();r.readBinaryClipboard();assert(h.total==NATIVE_CLIPBOARD_LIMIT);
 boundary[0]=3;item(boundary,"image/png",{1});rejected(boundary);
 std::vector<unsigned char> huge{1,9};const char* png="image/png";huge.insert(huge.end(),png,png+9);u32(huge,0xffffffffU);rejected(huge);
 rfb::Server::DLP_Clip_Types="text/plain";rejected(good);
 rfb::Server::DLP_ClipAcceptMax=65536;std::vector<unsigned char> old{1};item(old,"text/plain",std::vector<unsigned char>(65537,'a'));rejected(old);
}
