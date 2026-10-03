package main

/*
// The host has the libXtst runtime package but not its development symlink.
// Link the installed soname directly so this POC needs no package install.
#cgo LDFLAGS: -lX11 -l:libXtst.so.6 -l:libxdo.so.3
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdio.h>
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>

// libxtst runtime is installed on the test host, but its development header is
// not. These are the stable public XTEST declarations we need.
extern Bool XTestQueryExtension(Display*, int*, int*, int*, int*);
extern int XTestFakeKeyEvent(Display*, unsigned int, Bool, unsigned long);
extern int XTestFakeButtonEvent(Display*, unsigned int, Bool, unsigned long);
extern int XTestFakeMotionEvent(Display*, int, int, int, unsigned long);

// libxdo's stable entry points. The host ships the runtime library through
// xdotool but not the development headers, so declare its opaque context here.
typedef struct xdo Xdo;
extern Xdo *xdo_new(const char *);
extern void xdo_free(Xdo *);
extern int xdo_enter_text_window(const Xdo *, Window, const char *, unsigned int);

typedef struct {
	Display *display;
	Xdo *xdo;
	int screen;
	Window selection_window;
	Atom clipboard;
	Atom targets;
	Atom utf8_string;
	Atom text;
	Atom compound_text;
	Atom text_plain;
	Atom text_plain_utf8;
} NativeX11;

static NativeX11 *native_x11_open(const char *display_name) {
	Display *display = XOpenDisplay(display_name);
	if (display == NULL) return NULL;
	int event_base, error_base, major, minor;
	if (!XTestQueryExtension(display, &event_base, &error_base, &major, &minor)) {
		XCloseDisplay(display);
		return NULL;
	}
	NativeX11 *client = calloc(1, sizeof(NativeX11));
	if (client == NULL) {
		XCloseDisplay(display);
		return NULL;
	}
	client->display = display;
	client->screen = DefaultScreen(display);
	client->selection_window = XCreateSimpleWindow(display, RootWindow(display, client->screen), 0, 0, 1, 1, 0, 0, 0);
	if (client->selection_window == None) {
		XCloseDisplay(display);
		free(client);
		return NULL;
	}
	client->clipboard = XInternAtom(display, "CLIPBOARD", False);
	client->targets = XInternAtom(display, "TARGETS", False);
	client->utf8_string = XInternAtom(display, "UTF8_STRING", False);
	client->text = XInternAtom(display, "TEXT", False);
	client->compound_text = XInternAtom(display, "COMPOUND_TEXT", False);
	client->text_plain = XInternAtom(display, "text/plain", False);
	client->text_plain_utf8 = XInternAtom(display, "text/plain;charset=utf-8", False);
	return client;
}

static void native_x11_close(NativeX11 *client) {
	if (client == NULL) return;
	if (client->display != NULL) {
		if (client->selection_window != None) XDestroyWindow(client->display, client->selection_window);
		XCloseDisplay(client->display);
	}
	if (client->xdo != NULL) xdo_free(client->xdo);
	free(client);
}

static int native_x11_width(NativeX11 *client) {
	return DisplayWidth(client->display, client->screen);
}

static int native_x11_height(NativeX11 *client) {
	return DisplayHeight(client->display, client->screen);
}

// Returns the nearest focused window's WM_CLASS class value. IBus may retain
// its last input context after another X11 window becomes active, so callers
// use this as an independent foreground-app guard before a direct commit.
static int native_x11_focus_class(NativeX11 *client, char *output, int output_len) {
	if (client == NULL || output == NULL || output_len < 2) return 0;
	output[0] = '\0';
	Window window;
	int revert_to;
	XGetInputFocus(client->display, &window, &revert_to);
	if (window == None || window == PointerRoot) return 0;
	for (int depth = 0; depth < 16 && window != None; depth++) {
		XClassHint hint;
		if (XGetClassHint(client->display, window, &hint)) {
			const char *value = hint.res_class != NULL ? hint.res_class : hint.res_name;
			if (value != NULL && value[0] != '\0') {
				strncpy(output, value, (size_t)output_len - 1);
				output[output_len - 1] = '\0';
				if (hint.res_name != NULL) XFree(hint.res_name);
				if (hint.res_class != NULL) XFree(hint.res_class);
				return 1;
			}
			if (hint.res_name != NULL) XFree(hint.res_name);
			if (hint.res_class != NULL) XFree(hint.res_class);
		}
		Window root, parent, *children = NULL;
		unsigned int child_count = 0;
		if (!XQueryTree(client->display, window, &root, &parent, &children, &child_count)) break;
		if (children != NULL) XFree(children);
		if (parent == window || parent == root) break;
		window = parent;
	}
	return 0;
}

static int native_x11_motion(NativeX11 *client, int x, int y) {
	int ok = XTestFakeMotionEvent(client->display, client->screen, x, y, CurrentTime);
	XFlush(client->display);
	return ok;
}

static int native_x11_button(NativeX11 *client, int x, int y, unsigned int button, int down) {
	int ok = XTestFakeMotionEvent(client->display, client->screen, x, y, CurrentTime);
	ok = XTestFakeButtonEvent(client->display, button, down ? True : False, CurrentTime) && ok;
	XFlush(client->display);
	return ok;
}

static int native_x11_click(NativeX11 *client, int x, int y, unsigned int button) {
	int ok = XTestFakeMotionEvent(client->display, client->screen, x, y, CurrentTime);
	ok = XTestFakeButtonEvent(client->display, button, True, CurrentTime) && ok;
	ok = XTestFakeButtonEvent(client->display, button, False, CurrentTime) && ok;
	XFlush(client->display);
	return ok;
}

static int native_x11_key(NativeX11 *client, const char *name, int down) {
	KeySym symbol = XStringToKeysym(name);
	if (symbol == NoSymbol) return 0;
	KeyCode code = XKeysymToKeycode(client->display, symbol);
	if (code == 0) return 0;
	int ok = XTestFakeKeyEvent(client->display, code, down ? True : False, CurrentTime);
	XFlush(client->display);
	return ok;
}

// X11 represents Unicode characters which are not legacy keysyms as
// 0x01000000 | Unicode code point. XTEST can only send a keycode, so when the
// active keymap has no matching keycode we temporarily assign the keysym to an
// otherwise unused keycode. This is the mechanism used by xdotool's `type`
// path. The mapping is global to this X server, which is why Go holds the X11
// mutex for the complete transaction and restores the exact original mapping.
static int native_x11_unused_keycode(NativeX11 *client, KeyCode *result,
		KeySym **original, int *keysyms_per_code) {
	int min_code, max_code, per_code;
	XDisplayKeycodes(client->display, &min_code, &max_code);
	for (int code = min_code; code <= max_code; code++) {
		KeySym *mapping = XGetKeyboardMapping(client->display, (KeyCode)code, 1, &per_code);
		if (mapping == NULL || per_code < 1) continue;
		int unused = 1;
		for (int index = 0; index < per_code; index++) {
			if (mapping[index] != NoSymbol) {
				unused = 0;
				break;
			}
		}
		if (unused) {
			*result = (KeyCode)code;
			*original = mapping;
			*keysyms_per_code = per_code;
			return 1;
		}
		XFree(mapping);
	}
	return 0;
}

static int native_x11_decode_utf8(const unsigned char *value, int value_len,
		int *offset, unsigned int *codepoint) {
	if (*offset >= value_len) return 0;
	unsigned char first = value[(*offset)++];
	if (first < 0x80) {
		*codepoint = first;
		return 1;
	}
	int count;
	unsigned int result;
	if (first >= 0xC2 && first <= 0xDF) {
		count = 1;
		result = first & 0x1F;
	} else if (first >= 0xE0 && first <= 0xEF) {
		count = 2;
		result = first & 0x0F;
	} else if (first >= 0xF0 && first <= 0xF4) {
		count = 3;
		result = first & 0x07;
	} else {
		return -1;
	}
	if (*offset + count > value_len) return -1;
	for (int index = 0; index < count; index++) {
		unsigned char next = value[(*offset)++];
		if ((next & 0xC0) != 0x80) return -1;
		result = (result << 6) | (next & 0x3F);
	}
	if ((result < 0x80) || (result < 0x800 && count > 1) ||
		(result < 0x10000 && count > 2) || result > 0x10FFFF ||
		(result >= 0xD800 && result <= 0xDFFF)) return -1;
	*codepoint = result;
	return 1;
}

static KeySym native_x11_keysym_for_codepoint(unsigned int codepoint) {
	switch (codepoint) {
	case '\n': return XK_Return;
	case '\t': return XK_Tab;
	case '\b': return XK_BackSpace;
	case 0x7F: return XK_Delete;
	default:
		if (codepoint <= 0xFF) return (KeySym)codepoint;
		return (KeySym)(0x01000000U | codepoint);
	}
}

static int native_x11_unicode_keysyms_manual(NativeX11 *client,
		const unsigned char *value, int value_len, int *sent_count) {
	if (client == NULL || value == NULL || value_len < 1) return 0;
	*sent_count = 0;
	int offset = 0;
	for (;;) {
		unsigned int codepoint;
		int decoded = native_x11_decode_utf8(value, value_len, &offset, &codepoint);
		if (decoded == 0) break;
		if (decoded < 0) return 0;
		KeySym symbol = native_x11_keysym_for_codepoint(codepoint);
		KeyCode code = XKeysymToKeycode(client->display, symbol);
		KeySym *original = NULL;
		int per_code = 0;
		if (code == 0) {
			if (!native_x11_unused_keycode(client, &code, &original, &per_code)) return 0;
			KeySym temporary[] = { symbol };
			XChangeKeyboardMapping(client->display, code, 1, temporary, 1);
			XSync(client->display, False);
		}
		int ok = XTestFakeKeyEvent(client->display, code, True, CurrentTime);
		if (original != NULL) {
			// A client must consume MappingNotify + KeyPress while the scratch
			// key still represents this Unicode keysym. XSync here is essential:
			// restoring the mapping earlier makes XLookupString see NoSymbol.
			XSync(client->display, False);
			XChangeKeyboardMapping(client->display, code, per_code, original, 1);
			XFree(original);
			XFlush(client->display);
		}
		ok = XTestFakeKeyEvent(client->display, code, False, CurrentTime) && ok;
		XFlush(client->display);
		if (!ok) return 0;
		(*sent_count)++;
	}
	return 1;
}

// libxdo implements the subtle scratch-key mapping, XSync, and XTEST event
// ordering needed for XLookupString to observe Unicode keysyms. Window 0 asks
// it to use the current X input focus (and therefore XTEST rather than
// XSendEvent).
static int native_x11_unicode_keysyms(NativeX11 *client, const char *value) {
	if (client == NULL || value == NULL || value[0] == '\0') return 0;
	if (client->xdo == NULL) client->xdo = xdo_new(DisplayString(client->display));
	if (client->xdo == NULL) return 0;
	return xdo_enter_text_window(client->xdo, 0, value, 0) == 0;
}

static int native_x11_text_target(NativeX11 *client, Atom target) {
	return target == client->utf8_string || target == client->text ||
		target == client->compound_text || target == client->text_plain ||
		target == client->text_plain_utf8;
}

static int native_x11_write_utf8(NativeX11 *client, Window requestor, Atom property,
		const unsigned char *value, int value_len) {
	XChangeProperty(client->display, requestor, property, client->utf8_string, 8,
		PropModeReplace, value, value_len);
	return 1;
}

// TEXT and COMPOUND_TEXT are not UTF-8 byte aliases. Convert them through
// libX11 so clients that request those ICCCM targets can decode Chinese text.
static int native_x11_write_compound(NativeX11 *client, Window requestor, Atom property,
		const unsigned char *value, int value_len) {
	char *utf8 = malloc((size_t)value_len + 1);
	if (utf8 == NULL) return 0;
	memcpy(utf8, value, value_len);
	utf8[value_len] = '\0';
	char *items[] = { utf8 };
	XTextProperty converted;
	int result = Xutf8TextListToTextProperty(client->display, items, 1,
		XCompoundTextStyle, &converted);
	free(utf8);
	if (result != Success || converted.value == NULL) return 0;
	XChangeProperty(client->display, requestor, property, converted.encoding,
		converted.format, PropModeReplace, converted.value, converted.nitems);
	XFree(converted.value);
	return 1;
}

static int native_x11_send_shift_insert(NativeX11 *client) {
	KeyCode shift = XKeysymToKeycode(client->display, XStringToKeysym("Shift_L"));
	KeyCode insert = XKeysymToKeycode(client->display, XStringToKeysym("Insert"));
	if (shift == 0 || insert == 0) return 0;
	int ok = XTestFakeKeyEvent(client->display, shift, True, CurrentTime);
	ok = XTestFakeKeyEvent(client->display, insert, True, CurrentTime) && ok;
	ok = XTestFakeKeyEvent(client->display, insert, False, CurrentTime) && ok;
	ok = XTestFakeKeyEvent(client->display, shift, False, CurrentTime) && ok;
	XFlush(client->display);
	return ok;
}

static void native_x11_selection_reply(NativeX11 *client, XSelectionRequestEvent *request,
		const unsigned char *value, int value_len, int *served_text) {
	XSelectionEvent reply;
	memset(&reply, 0, sizeof(reply));
	reply.type = SelectionNotify;
	reply.display = request->display;
	reply.requestor = request->requestor;
	reply.selection = request->selection;
	reply.target = request->target;
	reply.time = request->time;
	reply.property = None;
	Atom property = request->property == None ? request->target : request->property;
	if (request->target == client->targets) {
		Atom supported[] = {
			client->targets, client->utf8_string, client->text,
			client->compound_text, XA_STRING, client->text_plain,
			client->text_plain_utf8,
		};
		XChangeProperty(client->display, request->requestor, property, XA_ATOM, 32,
			PropModeReplace, (unsigned char *)supported, sizeof(supported) / sizeof(supported[0]));
		reply.property = property;
	} else if (native_x11_text_target(client, request->target)) {
		char *target_name = XGetAtomName(client->display, request->target);
		fprintf(stderr, "text input: X11 selection target=%s\n",
			target_name == NULL ? "(unknown)" : target_name);
		if (target_name != NULL) XFree(target_name);
		int written = 0;
		if (request->target == client->utf8_string ||
			request->target == client->text_plain ||
			request->target == client->text_plain_utf8) {
			written = native_x11_write_utf8(client, request->requestor, property, value, value_len);
		} else {
			written = native_x11_write_compound(client, request->requestor, property, value, value_len);
		}
		if (written) {
			reply.property = property;
			*served_text = 1;
		}
	}
	XSendEvent(client->display, request->requestor, False, 0, (XEvent *)&reply);
	XFlush(client->display);
}

// Own CLIPBOARD and PRIMARY for one Shift+Insert request. LibreOffice starts
// its PasteSpecial work after it has requested the selection; releasing the
// owner immediately lets a following keystroke replace the transfer while
// that work is still pending. Keep a small post-request settle window so each
// paste becomes a completed transaction, not a race with the next paste.
static int native_x11_clipboard_paste(NativeX11 *client, const unsigned char *value,
		int value_len, int timeout_ms, int *served_text) {
	if (client == NULL || value == NULL || value_len < 1 || timeout_ms < 1) return 0;
	*served_text = 0;
	XSetSelectionOwner(client->display, client->clipboard, client->selection_window, CurrentTime);
	XSetSelectionOwner(client->display, XA_PRIMARY, client->selection_window, CurrentTime);
	if (XGetSelectionOwner(client->display, client->clipboard) != client->selection_window) return 0;
	if (!native_x11_send_shift_insert(client)) return 0;

	struct timespec started, now, pause;
	clock_gettime(CLOCK_MONOTONIC, &started);
	long served_at_ms = -1;
	const long settle_ms = 25;
	pause.tv_sec = 0;
	pause.tv_nsec = 1000000;
	for (;;) {
		while (XPending(client->display) > 0) {
			XEvent event;
			XNextEvent(client->display, &event);
			if (event.type == SelectionRequest) {
				native_x11_selection_reply(client, &event.xselectionrequest, value, value_len, served_text);
				if (*served_text && served_at_ms < 0) {
					clock_gettime(CLOCK_MONOTONIC, &now);
					served_at_ms = (now.tv_sec - started.tv_sec) * 1000L +
						(now.tv_nsec - started.tv_nsec) / 1000000L;
				}
			}
		}
		clock_gettime(CLOCK_MONOTONIC, &now);
		long elapsed_ms = (now.tv_sec - started.tv_sec) * 1000L +
			(now.tv_nsec - started.tv_nsec) / 1000000L;
		if ((served_at_ms >= 0 && elapsed_ms - served_at_ms >= settle_ms) ||
			elapsed_ms >= timeout_ms) break;
		nanosleep(&pause, NULL);
	}
	if (XGetSelectionOwner(client->display, client->clipboard) == client->selection_window)
		XSetSelectionOwner(client->display, client->clipboard, None, CurrentTime);
	if (XGetSelectionOwner(client->display, XA_PRIMARY) == client->selection_window)
		XSetSelectionOwner(client->display, XA_PRIMARY, None, CurrentTime);
	XFlush(client->display);
	return 1;
}
*/
import "C"

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
	"unsafe"
)

// nativeX11 owns one X11 connection for the lifetime of the gateway. Unlike
// xdotool, no input event forks a helper or opens a new X connection.
type nativeX11 struct {
	client *C.NativeX11
	mu     sync.Mutex
}

func openNativeX11(display string) (*nativeX11, error) {
	name := C.CString(display)
	defer C.free(unsafe.Pointer(name))
	client := C.native_x11_open(name)
	if client == nil {
		return nil, fmt.Errorf("cannot open X11 display %q with XTEST", display)
	}
	return &nativeX11{client: client}, nil
}

func (x *nativeX11) close() {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client != nil {
		C.native_x11_close(x.client)
		x.client = nil
	}
}

func (x *nativeX11) size() (int, int) {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil {
		return 0, 0
	}
	return int(C.native_x11_width(x.client)), int(C.native_x11_height(x.client))
}

func (x *nativeX11) focusedClass() (string, error) {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil {
		return "", fmt.Errorf("X11 connection is closed")
	}
	buffer := make([]C.char, 128)
	if C.native_x11_focus_class(x.client, &buffer[0], C.int(len(buffer))) == 0 {
		return "", fmt.Errorf("no focused X11 application class")
	}
	return C.GoString(&buffer[0]), nil
}

func (x *nativeX11) move(xPos, yPos int) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil || C.native_x11_motion(x.client, C.int(xPos), C.int(yPos)) == 0 {
		return fmt.Errorf("XTEST pointer motion failed")
	}
	return nil
}

func (x *nativeX11) button(xPos, yPos, button int, down bool) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil || C.native_x11_button(x.client, C.int(xPos), C.int(yPos), C.uint(button), boolToCInt(down)) == 0 {
		return fmt.Errorf("XTEST button event failed")
	}
	return nil
}

func (x *nativeX11) click(xPos, yPos, button int) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil || C.native_x11_click(x.client, C.int(xPos), C.int(yPos), C.uint(button)) == 0 {
		return fmt.Errorf("XTEST click failed")
	}
	return nil
}

func (x *nativeX11) key(value string) error {
	parts := strings.Split(value, "+")
	modifiers := map[string]string{
		"ctrl":  "Control_L",
		"alt":   "Alt_L",
		"shift": "Shift_L",
		"super": "Super_L",
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil {
		return fmt.Errorf("X11 connection is closed")
	}
	pressed := make([]string, 0, len(parts)-1)
	for _, modifier := range parts[:len(parts)-1] {
		name := modifiers[modifier]
		if name == "" || !x.keyLocked(name, true) {
			return fmt.Errorf("XTEST modifier %q failed", modifier)
		}
		pressed = append(pressed, name)
	}
	if !x.keyLocked(parts[len(parts)-1], true) || !x.keyLocked(parts[len(parts)-1], false) {
		return fmt.Errorf("XTEST key %q failed", value)
	}
	for index := len(pressed) - 1; index >= 0; index-- {
		if !x.keyLocked(pressed[index], false) {
			return fmt.Errorf("XTEST modifier release failed")
		}
	}
	return nil
}

// clipboardPaste implements a short-lived in-process X11 selection owner. It
// avoids spawning xclip for every text commit and holds the selection for a
// short post-request settle window so slow clipboard consumers finish safely.
func (x *nativeX11) clipboardPaste(value string, timeout time.Duration) (bool, error) {
	if value == "" {
		return false, nil
	}
	payload := C.CBytes([]byte(value))
	defer C.free(payload)
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil {
		return false, fmt.Errorf("X11 connection is closed")
	}
	var served C.int
	if C.native_x11_clipboard_paste(
		x.client,
		(*C.uchar)(payload),
		C.int(len(value)),
		C.int(timeout.Milliseconds()),
		&served,
	) == 0 {
		return false, fmt.Errorf("X11 clipboard paste setup failed")
	}
	return served != 0, nil
}

// unicodeKeysyms inserts UTF-8 as ordinary XTEST keyboard input without taking
// ownership of CLIPBOARD or PRIMARY. It is intentionally a separate backend:
// target applications may distinguish key events from a true IME commit.
func (x *nativeX11) unicodeKeysyms(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	if strings.IndexByte(value, 0) >= 0 {
		return 0, fmt.Errorf("Unicode keysym injection does not accept NUL")
	}
	payload := C.CString(value)
	defer C.free(unsafe.Pointer(payload))
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.client == nil {
		return 0, fmt.Errorf("X11 connection is closed")
	}
	if C.native_x11_unicode_keysyms(x.client, payload) == 0 {
		return 0, fmt.Errorf("libxdo Unicode keysym injection failed")
	}
	return utf8.RuneCountInString(value), nil
}

func (x *nativeX11) keyLocked(name string, down bool) bool {
	key := C.CString(name)
	defer C.free(unsafe.Pointer(key))
	return C.native_x11_key(x.client, key, boolToCInt(down)) != 0
}

func boolToCInt(value bool) C.int {
	if value {
		return 1
	}
	return 0
}
