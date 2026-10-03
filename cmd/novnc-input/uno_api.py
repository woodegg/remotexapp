"""Small local LibreOffice UNO adapter used by the Go gateway.

This process receives one allow-listed JSON request on stdin, talks to the
loopback-only UNO/URP socket, and writes one JSON result on stdout. It is not a
network listener: Go is the only public API surface. pyuno is used here because
LibreOffice ships Python UNO bindings, while the Go gateway owns HTTP, WebSocket
and access boundaries.
"""

import json
import sys

import uno


def connect(url):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    remote_context = resolver.resolve(url)
    desktop = remote_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.frame.Desktop", remote_context
    )
    document = desktop.getCurrentComponent()
    if document is None:
        raise RuntimeError("no active LibreOffice document")
    return document


def page_number(document, page):
    pages = document.getDrawPages()
    for index in range(pages.getCount()):
        if pages.getByIndex(index) == page:
            return index + 1
    return 0


def selection_text(controller):
    try:
        selection = controller.getSelection()
        if selection is not None and selection.supportsService(
            "com.sun.star.text.TextCursor"
        ):
            return selection.getString()
    except Exception:
        pass
    return ""


def state(document):
    controller = document.getCurrentController()
    return {
        "slides": document.getDrawPages().getCount(),
        "currentSlide": page_number(document, controller.getCurrentPage()),
        "selectionText": selection_text(controller),
        "documentURL": document.URL,
    }


def handle(document, request):
    action = request["action"]
    if action == "state":
        return state(document)
    if action == "gotoSlide":
        slide = request["slide"]
        pages = document.getDrawPages()
        if not isinstance(slide, int) or slide < 1 or slide > pages.getCount():
            raise ValueError("slide is outside the document")
        document.getCurrentController().setCurrentPage(pages.getByIndex(slide - 1))
        return state(document)
    if action == "replaceSelection":
        text = request["text"]
        if not isinstance(text, str) or not text:
            raise ValueError("text must be a non-empty string")
        selection = document.getCurrentController().getSelection()
        if selection is None or not selection.supportsService(
            "com.sun.star.text.TextCursor"
        ):
            raise ValueError("select text in LibreOffice before replacing it")
        if not selection.getString():
            raise ValueError("selection is empty; refusing to insert text")
        # insertString with bAbsorb=True replaces the selected text range. It
        # avoids synthesising desktop keystrokes and supports UTF-8 directly.
        selection.getText().insertString(selection, text, True)
        document.store()
        return state(document)
    raise ValueError("unsupported action")


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("UNO URL argument is required")
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or request.get("action") not in {
        "state",
        "gotoSlide",
        "replaceSelection",
    }:
        raise ValueError("unsupported request")
    print(json.dumps({"ok": True, "result": handle(connect(sys.argv[1]), request)}))


if __name__ == "__main__":
    main()
